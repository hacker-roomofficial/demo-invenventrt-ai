"""MCP server checks (JSON-RPC over Streamable HTTP). Run: python tests/test_mcp_server.py"""
import json
import os
import sys
import tempfile
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
_db = os.path.join(tempfile.gettempdir(), f"mcp_{uuid.uuid4().hex}.db")
os.environ["DATABASE_URL"] = f"sqlite:///{_db.replace(os.sep, '/')}"
os.environ["DOGRAH_TOOL_API_KEY"] = "mcp-key-123456"

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

failures = []


def check(cond, label):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        failures.append(label)


HDR = {"Authorization": "Bearer mcp-key-123456", "Content-Type": "application/json",
       "Accept": "application/json, text/event-stream"}
_id = [0]


def rpc(client, method, params=None, headers=HDR):
    _id[0] += 1
    return client.post("/mcp/", headers=headers, json={"jsonrpc": "2.0", "id": _id[0], "method": method, "params": params or {}})


def tool(client, name, **args):
    r = rpc(client, "tools/call", {"name": name, "arguments": args})
    result = r.json()["result"]
    return json.loads(result["content"][0]["text"])


with TestClient(main.app) as client:
    check(rpc(client, "tools/list", headers={**HDR, "Authorization": "Bearer nope"}).status_code == 401, "wrong key rejected")
    check(client.post("/mcp/", json={}).status_code == 401, "missing key rejected")
    init = rpc(client, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}})
    check(init.status_code == 200 and init.json()["result"]["serverInfo"]["name"] == "inventory", "initialize works")
    names = {t["name"] for t in rpc(client, "tools/list").json()["result"]["tools"]}
    expected = {"search_products", "daily_sales", "app_status", "alerts", "reorder", "pending_orders", "recent_activity",
                "prepare_stock_update", "prepare_product_create", "prepare_dispatch", "confirm_action"}
    check(names == expected, f"11 tools listed ({sorted(names ^ expected)})")

    client.post("/api/products", json={"sku": "KRT-1", "name": "Blue Kurta", "variants": [{"size": "M", "initial_stock": 10}]})
    res = tool(client, "search_products", query="blue kurta")
    check(res["products"][0]["sizes"][0]["stock"] == 10, "search via MCP returns live stock")
    check(tool(client, "app_status")["status"] == "ok", "app_status via MCP")
    prep = tool(client, "prepare_stock_update", sku="KRT-1", size="M", operation="add", quantity=5)
    check(prep["status"] == "needs_confirmation" and prep["proposed_stock"] == 15, "prepare via MCP")
    check(tool(client, "search_products", query="KRT-1")["products"][0]["sizes"][0]["stock"] == 10, "prepare changes nothing")
    done = tool(client, "confirm_action", confirmation_token=prep["confirmation_token"])
    check(done["status"] == "ok", "confirm via MCP")
    check(tool(client, "search_products", query="KRT-1")["products"][0]["sizes"][0]["stock"] == 15, "stock updated to 15")
    check(tool(client, "confirm_action", confirmation_token=prep["confirmation_token"])["status"] == "error", "token single-use over MCP")
    # the REST API keeps working next to MCP
    check(client.get("/api/health").status_code == 200, "REST API still served")

print("\nFAILED:" if failures else "\nAll MCP checks passed.", failures or "")
sys.exit(1 if failures else 0)
