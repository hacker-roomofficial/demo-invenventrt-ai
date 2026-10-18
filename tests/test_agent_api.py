"""Dograh agent tool API checks (isolated SQLite DB). Run: python tests/test_agent_api.py"""
import os
import sys
import tempfile
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
_db = os.path.join(tempfile.gettempdir(), f"agent_{uuid.uuid4().hex}.db")
os.environ["DATABASE_URL"] = f"sqlite:///{_db.replace(os.sep, '/')}"
os.environ["DOGRAH_TOOL_API_KEY"] = "test-key-123456"
os.environ["DOGRAH_EMBED_SCRIPT_URL"] = "https://dograh.example.com/embed/dograh-widget.js?token=abc"

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

client = TestClient(main.app)
H = {"Authorization": "Bearer test-key-123456"}
failures = []


def check(cond, label):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        failures.append(label)


def call(path, body=None, headers=H):
    return client.post(f"/api/agent/{path}", json=body or {}, headers=headers)


# --- auth ---
check(call("daily_sales", headers={}).status_code == 401, "missing key rejected")
check(call("daily_sales", headers={"Authorization": "Bearer wrong"}).status_code == 401, "wrong key rejected")
cfg = client.get("/api/agent/config").json()
check(cfg["enabled"] and "dograh-widget.js" in cfg["embed_script_url"] and "key" not in str(cfg).lower().replace("tools_ready", ""), "public config exposes only widget url")

# tools without parameters must accept an empty POST and numeric run ids
for tool in ("alerts", "reorder", "recent_activity", "daily_sales"):
    check(client.post(f"/api/agent/{tool}", headers=H).status_code == 200, f"{tool} accepts empty POST")

# --- seed a product through the real API ---
r = client.post("/api/products", json={"sku": "KRT-1", "name": "Blue Kurta", "category": "Kurta",
                                      "variants": [{"size": "M", "initial_stock": 10}, {"size": "L", "initial_stock": 4}]})
check(r.status_code == 200, "product created")
client.post("/api/products", json={"sku": "KRT-2", "name": "Red Kurta", "category": "Kurta",
                                  "variants": [{"size": "M", "initial_stock": 7}]})

# --- reads ---
res = call("search_products", {"query": "blue kurta"}).json()
check(res["status"] == "ok" and res["products"][0]["sku"] == "KRT-1", "search finds design")
check({s["size"]: s["stock"] for s in res["products"][0]["sizes"]} == {"M": 10, "L": 4}, "search returns live size stock")
res = call("search_products", {"query": "kurta", "size": "m"}).json()
check(res["count"] == 2 and all(len(p["sizes"]) == 1 for p in res["products"]), "size filter works across designs")
check(call("search_products", {"query": "zzzzqq"}).json()["status"] == "error", "unknown product reported")
for tool in ("daily_sales", "app_status", "pending_orders"):
    check(call(tool).json().get("status") == "ok", f"{tool} ok")
for tool in ("alerts", "reorder", "recent_activity"):
    check(call(tool, {"query": ""}).json().get("status") == "ok", f"{tool} ok")

# --- write needs confirmation ---
prep = call("prepare_stock_update", {"sku": "KRT-1", "size": "M", "operation": "add", "quantity": 5}).json()
check(prep["status"] == "needs_confirmation" and prep["proposed_stock"] == 15, "prepare add shows 10 -> 15")
stock = lambda: call("search_products", {"query": "KRT-1", "size": "M"}).json()["products"][0]["sizes"][0]["stock"]
check(stock() == 10, "prepare alone does not change stock")
check(call("prepare_stock_update", {"sku": "kurta", "size": "M", "operation": "add", "quantity": 1}).json().get("choices"),
      "ambiguous design asks user to choose, no guess")
check(call("prepare_stock_update", {"sku": "KRT-1", "size": "XL", "operation": "add", "quantity": 1}).json()["status"] == "error", "missing size rejected")

bad = call("confirm_action", {"confirmation_token": "does-not-exist-1"}).json()
check(bad["status"] == "error", "unknown token rejected")
done = call("confirm_action", {"confirmation_token": prep["confirmation_token"]}).json()
check(done["status"] == "ok" and stock() == 15, "confirm applies change")
again = call("confirm_action", {"confirmation_token": prep["confirmation_token"]}).json()
check(again["status"] == "error" and stock() == 15, "token is single-use")

# stale-stock protection: prepare, then stock changes, then confirm
p1 = call("prepare_stock_update", {"sku": "KRT-1", "size": "M", "operation": "add", "quantity": 1}).json()
client.post("/api/inventory/adjust", json={"variant_code": main._make_variant_code("KRT-1", "M"), "operation": "set", "new_count": 99})
stale = call("confirm_action", {"confirmation_token": p1["confirmation_token"]}).json()
check(stale["status"] == "error" and stock() == 99, "stale stock blocks confirm")

# conversation binding + expiry
p2 = call("prepare_stock_update", {"sku": "KRT-1", "size": "L", "operation": "set", "quantity": 8, "workflow_run_id": 100}).json()
check(call("confirm_action", {"confirmation_token": p2["confirmation_token"], "workflow_run_id": 999}).json()["status"] == "error", "other conversation cannot confirm")
check(call("confirm_action", {"confirmation_token": p2["confirmation_token"], "workflow_run_id": 100}).json()["status"] == "ok", "same conversation confirms set")
from datetime import datetime, timedelta, timezone  # noqa: E402
from database import SessionLocal  # noqa: E402
import models  # noqa: E402
p3 = call("prepare_stock_update", {"sku": "KRT-1", "size": "L", "operation": "add", "quantity": 1}).json()
with SessionLocal() as db:
    row = db.query(models.AgentPendingAction).filter_by(token=p3["confirmation_token"]).one()
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()
check(call("confirm_action", {"confirmation_token": p3["confirmation_token"]}).json()["status"] == "error", "expired token rejected")

# product create
pc = call("prepare_product_create", {"sku": "dr-9", "name": "Green Dress", "category": "Dress", "sizes": "S M L"}).json()
check(pc["status"] == "needs_confirmation", "product create prepared")
check(client.get("/api/products/DR-9").status_code == 404, "product not created before confirm")
check(call("confirm_action", {"confirmation_token": pc["confirmation_token"]}).json()["status"] == "ok", "product created on confirm")
check(len(client.get("/api/products/DR-9").json()["variants"]) == 3, "created with 3 sizes")
check(call("prepare_product_create", {"sku": "DR-9", "name": "x", "sizes": "S"}).json()["status"] == "error", "duplicate SKU rejected")

# disabled when key unset
os.environ["DOGRAH_TOOL_API_KEY"] = ""
check(call("daily_sales").status_code == 503, "tools disabled without configured key")

print("\nFAILED:" if failures else "\nAll agent API checks passed.", failures or "")
sys.exit(1 if failures else 0)
