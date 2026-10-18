"""Tool API for the Dograh voice/chat agent.

Dograh hosts the conversation (speech-to-text, LLM, text-to-speech). This
module is the only door the agent has into the inventory. Rules:

* Every route needs ``Authorization: Bearer <DOGRAH_TOOL_API_KEY>``.
* Read tools answer from the live database; the agent never guesses stock.
* Write tools only *prepare* a change and return a single-use token. Nothing
  changes until ``/api/agent/confirm`` is called with that token, which the
  agent prompt allows only after the user clearly says yes.
* Business problems (unknown size, stale stock, ...) are returned as
  ``{"status": "error", "message": ...}`` with HTTP 200 so the agent can
  explain them in plain words.
"""
import hmac
import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Union

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

import models
import schemas
from database import get_db
from services import reorder_service

router = APIRouter(prefix="/api/agent", tags=["dograh-agent"])

CONFIRM_TTL_MINUTES = 5
MAX_RESULTS = 8


def _main():
    # Imported lazily: main.py imports this module while it is being built.
    import main
    return main


def tool_key() -> str:
    return os.getenv("DOGRAH_TOOL_API_KEY", "").strip()


def require_tool_key(authorization: str = Header(default="")):
    expected = tool_key()
    if not expected:
        raise HTTPException(503, "Agent tools are disabled: set DOGRAH_TOOL_API_KEY.")
    supplied = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(401, "Invalid agent tool key.")


router_deps = [Depends(require_tool_key)]


# ----------------------------- request models ----------------------------- #
class SearchIn(BaseModel):
    query: str = Field(min_length=1, max_length=160)
    size: str = Field(default="", max_length=40)


class OptionalQueryIn(BaseModel):
    query: str = Field(default="", max_length=160)


class StockUpdateIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    size: str = Field(min_length=1, max_length=40)
    operation: str = Field(description="'add' (increase by quantity) or 'set' (final total)")
    quantity: int = Field(ge=0, le=100000)
    workflow_run_id: Optional[Union[int, str]] = None


class ProductCreateIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=300)
    category: str = Field(default="", max_length=120)
    sizes: str = Field(min_length=1, max_length=200, description="e.g. 'S M L' or 'S, M, L, XL'")
    workflow_run_id: Optional[Union[int, str]] = None


class DispatchIn(BaseModel):
    order_id: int = Field(ge=1)
    workflow_run_id: Optional[Union[int, str]] = None


class ConfirmIn(BaseModel):
    confirmation_token: str = Field(min_length=8, max_length=64)
    workflow_run_id: Optional[Union[int, str]] = None


def _err(message: str, **extra) -> dict:
    return {"status": "error", "message": message, **extra}


def _ok(message: str, **extra) -> dict:
    return {"status": "ok", "message": message, **extra}


# ------------------------------- product lookup --------------------------- #
def _find_products(db: Session, query: str, limit: int = 30):
    m = _main()
    base = db.query(models.Product).options(selectinload(models.Product.variants)).filter(
        models.Product.is_deleted == False  # noqa: E712
    )
    sku_exact = base.filter(models.Product.sku == query.strip().upper()).all()
    if sku_exact:
        return sku_exact
    found = m._apply_smart_search(base, (models.Product.sku, models.Product.name, models.Product.category), query)
    products = found.order_by(models.Product.name.asc()).limit(limit).all()
    if products:
        return products
    ranked = [(m._fuzzy_product_score(query, p), p) for p in base.all()]
    ranked = [(s, p) for s, p in ranked if s > 0]
    ranked.sort(key=lambda item: (item[0], item[1].name.casefold()), reverse=True)
    return [p for _, p in ranked[:limit]]


def _live_variants(product):
    return [v for v in product.variants if not v.is_deleted]


def _product_card(product) -> dict:
    return {
        "sku": product.sku, "name": product.name, "category": product.category,
        "sizes": [
            {"size": v.size,
             "stock": v.current_stock if v.last_counted_at is not None else None,
             "counted": v.last_counted_at is not None}
            for v in _live_variants(product)
        ],
    }


def _resolve_variant(db: Session, sku: str, size: str):
    """Return (product, variant) or an error dict. Never guesses between designs."""
    m = _main()
    products = _find_products(db, sku)
    if not products:
        return None, None, _err(f"'{sku}' naam ya SKU ka design catalog mein nahi mila.")
    wanted = m._assistant_size(size)
    matches = []
    for product in products:
        for variant in _live_variants(product):
            if m._assistant_size(variant.size) == wanted:
                matches.append((product, variant))
    if not matches:
        return None, None, _err(
            f"Size {wanted} in designs mein nahi mila.",
            designs=[_product_card(p) for p in products[:MAX_RESULTS]],
        )
    if len(matches) > 1:
        return None, None, _err(
            "Kai designs match hue. User se poochhein ki kaunsa design chahiye, phir sahi SKU ke saath dobara try karein.",
            choices=[{"sku": p.sku, "name": p.name, "size": v.size,
                      "stock": v.current_stock if v.last_counted_at is not None else None}
                     for p, v in matches[:MAX_RESULTS]],
        )
    return matches[0][0], matches[0][1], None


# --------------------------------- read tools ----------------------------- #
@router.post("/search_products", dependencies=router_deps)
def search_products(payload: SearchIn, db: Session = Depends(get_db)):
    """Find designs and current size-wise stock (optionally for one size)."""
    m = _main()
    products = _find_products(db, payload.query, limit=MAX_RESULTS)
    if not products:
        return _err(f"'{payload.query}' ke matching designs nahi mile. SKU, colour ya naam ka koi aur hissa poochhein.")
    cards = [_product_card(p) for p in products[:MAX_RESULTS]]
    if payload.size.strip():
        wanted = m._assistant_size(payload.size)
        for card in cards:
            card["sizes"] = [s for s in card["sizes"] if m._assistant_size(s["size"]) == wanted]
    return {"status": "ok", "count": len(cards), "products": cards,
            "note": "stock null = abhi physical count nahi hua. Ek se zyada design mile to user se sahi design poochhein."}


@router.post("/daily_sales", dependencies=router_deps)
def daily_sales(db: Session = Depends(get_db)):
    s = _main()._daily_sales_summary(db)
    return {"status": "ok", **s, "note": "Sirf dispatched units; rupee revenue app mein record nahi hota."}


@router.post("/app_status", dependencies=router_deps)
def app_status(db: Session = Depends(get_db)):
    m = _main()
    dash = m.summary(db)
    lines, units = db.query(
        func.count(models.OrderLine.id),
        func.coalesce(func.sum(models.OrderLine.qty_ordered - models.OrderLine.qty_fulfilled), 0),
    ).filter(models.OrderLine.status.in_(m.ACTIVE_ORDER_STATUSES)).one()
    total_stock = db.query(func.coalesce(func.sum(models.Variant.current_stock), 0)).join(models.Product).filter(
        models.Variant.is_deleted == False, models.Product.is_deleted == False  # noqa: E712
    ).scalar()
    sales = m._daily_sales_summary(db)
    return {"status": "ok", **dash, "total_stock": int(total_stock or 0),
            "pending_order_lines": int(lines or 0), "pending_order_units": int(units or 0),
            "today_dispatched_units": sales["dispatched_units"]}


@router.post("/alerts", dependencies=router_deps)
def alerts(payload: OptionalQueryIn = OptionalQueryIn(), db: Session = Depends(get_db)):
    rows = _main()._collect_alerts(db, payload.query.strip() or None)
    return {"status": "ok", "total": len(rows), "alerts": [
        {"sku": a["sku"], "product_name": a["product_name"], "size": a["size"],
         "type": a["alert_type"], "stock": a["stock_at_alert"],
         "ordered_qty": a["ordered_qty"], "restock_needed": a["required_qty"]}
        for a in rows[:MAX_RESULTS]]}


@router.post("/reorder", dependencies=router_deps)
def reorder(payload: OptionalQueryIn = OptionalQueryIn(), db: Session = Depends(get_db)):
    items = reorder_service.generate_reorder_list(db, save_batch=False, part=payload.query.strip() or None)
    needed = [i for i in items if i["required_qty"] > 0]
    return {"status": "ok", "total": len(needed), "items": [
        {"sku": i["sku"], "name": i["name"], "size": i["size"], "stock": i["current_stock"],
         "pending_orders": i["ordered_qty"], "to_order": i["required_qty"]}
        for i in needed[:MAX_RESULTS]]}


@router.post("/pending_orders", dependencies=router_deps)
def pending_orders(db: Session = Depends(get_db)):
    m = _main()
    lines, units = db.query(
        func.count(models.OrderLine.id),
        func.coalesce(func.sum(models.OrderLine.qty_ordered - models.OrderLine.qty_fulfilled), 0),
    ).filter(models.OrderLine.status.in_(m.ACTIVE_ORDER_STATUSES)).one()
    batches = db.query(models.OrderUpload).join(models.OrderLine).filter(
        models.OrderLine.status.in_(m.ACTIVE_ORDER_STATUSES)
    ).distinct().order_by(models.OrderUpload.uploaded_at.desc()).limit(5).all()
    return {"status": "ok", "pending_lines": int(lines or 0), "pending_units": int(units or 0),
            "recent_batches": [{"batch_id": b.id, "filename": b.filename} for b in batches]}


@router.post("/recent_activity", dependencies=router_deps)
def recent_activity(payload: OptionalQueryIn = OptionalQueryIn(), db: Session = Depends(get_db)):
    from sqlalchemy.orm import contains_eager
    m = _main()
    T, V, P = models.InventoryTransaction, models.Variant, models.Product
    query = db.query(T).join(V, T.variant_id == V.id).join(P, V.product_id == P.id)
    if payload.query.strip():
        query = m._apply_smart_search(query, (P.sku, P.name, V.variant_code, V.size), payload.query)
    rows = query.options(contains_eager(T.variant).contains_eager(V.product)).order_by(
        T.created_at.desc(), T.id.desc()).limit(MAX_RESULTS).all()
    return {"status": "ok", "changes": [
        {"name": t.variant.product.name, "sku": t.variant.product.sku, "size": t.variant.size,
         "change": t.change_qty, "type": t.transaction_type.value, "balance": t.balance_after}
        for t in rows]}


# ------------------------------ prepare (write) --------------------------- #
def _store_pending(db: Session, action_type: str, payload: dict, summary: str, run_id: Optional[str]) -> dict:
    token = secrets.token_urlsafe(18)
    db.add(models.AgentPendingAction(
        token=token, action_type=action_type, payload=json.dumps(payload), summary=summary,
        workflow_run_id=str(run_id) if run_id else None,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=CONFIRM_TTL_MINUTES),
    ))
    db.commit()
    return {
        "status": "needs_confirmation", "confirmation_token": token, "summary": summary,
        "instruction": "Ye summary user ko bolkar poochhein 'confirm karun?'. Sirf user ke clear 'haan/yes' ke baad hi confirm_action call karein. Agar user mana kare to kuch na karein.",
    }


@router.post("/prepare_stock_update", dependencies=router_deps)
def prepare_stock_update(payload: StockUpdateIn, db: Session = Depends(get_db)):
    op = payload.operation.strip().lower()
    if op not in {"add", "set"}:
        return _err("operation 'add' ya 'set' hona chahiye.")
    product, variant, error = _resolve_variant(db, payload.sku, payload.size)
    if error:
        return error
    counted = variant.last_counted_at is not None
    if op == "add" and not counted:
        return _err(f"{product.name}, size {variant.size} ka stock abhi count nahi hua. Pehle kul physical count batane ko kahein (operation 'set').")
    current = int(variant.current_stock) if counted else 0
    proposed = current + payload.quantity if op == "add" else payload.quantity
    summary = f"{product.name} ({product.sku}), size {variant.size}: abhi {current}, update ke baad {proposed} pieces."
    return _store_pending(db, "stock_update", {
        "variant_code": variant.variant_code, "operation": op, "quantity": payload.quantity,
        "expected_current_stock": current if counted else None, "proposed": proposed,
    }, summary, payload.workflow_run_id) | {"current_stock": current, "proposed_stock": proposed}


@router.post("/prepare_product_create", dependencies=router_deps)
def prepare_product_create(payload: ProductCreateIn, db: Session = Depends(get_db)):
    m = _main()
    sku = payload.sku.strip().upper()
    raw = re.findall(r"FREE\s+SIZE|ONE\s+SIZE|[A-Za-z0-9-]+", payload.sizes.upper())
    sizes = list(dict.fromkeys(s for s in (m._assistant_size(x) for x in raw) if s))
    if not sizes:
        return _err("Kam se kam ek size chahiye, jaise S M L.")
    if db.query(models.Product).filter(models.Product.sku == sku).first():
        return _err(f"SKU {sku} pehle se catalog ya Trash mein hai. Dusra SKU batayein.")
    summary = f"Naya design '{payload.name.strip()}', SKU {sku}, sizes {', '.join(sizes)}; har size ka shuruaati stock 0."
    return _store_pending(db, "product_create", {
        "sku": sku, "name": payload.name.strip(), "category": payload.category.strip() or None, "sizes": sizes,
    }, summary, payload.workflow_run_id)


@router.post("/prepare_dispatch", dependencies=router_deps)
def prepare_dispatch(payload: DispatchIn, db: Session = Depends(get_db)):
    m = _main()
    batch = db.query(models.OrderUpload).filter(models.OrderUpload.id == payload.order_id).first()
    if not batch:
        return _err(f"Order batch {payload.order_id} nahi mila.")
    lines = db.query(models.OrderLine).options(selectinload(models.OrderLine.variant)).filter(
        models.OrderLine.order_upload_id == payload.order_id,
        models.OrderLine.status.in_(m.ACTIVE_ORDER_STATUSES)).all()
    if not lines:
        return _err(f"Batch {payload.order_id} mein koi pending order line nahi hai.")
    pending_units = sum(max(l.qty_ordered - l.qty_fulfilled, 0) for l in lines)
    available = sum(m._order_line_dispatchability(db, lines).values())
    if available <= 0:
        return _err(f"Batch {payload.order_id} mein {pending_units} pieces pending hain, par counted stock available nahi hai.")
    summary = (f"Batch {payload.order_id} ({batch.filename or 'orders'}): {pending_units} pieces baaki, "
               f"abhi {available} available pieces dispatch honge; bacha hua pending rahega.")
    return _store_pending(db, "order_dispatch", {"order_id": payload.order_id}, summary, payload.workflow_run_id)


# -------------------------------- confirm --------------------------------- #
@router.post("/confirm_action", dependencies=router_deps)
def confirm_action(payload: ConfirmIn, db: Session = Depends(get_db)):
    from fastapi import HTTPException as HE
    m = _main()
    row = db.query(models.AgentPendingAction).filter(
        models.AgentPendingAction.token == payload.confirmation_token).with_for_update().first()
    if row is None:
        return _err("Ye confirmation token galat hai. Pehle change dobara prepare karein.")
    if row.consumed_at is not None:
        return _err("Ye change pehle hi ho chuka hai ya cancel ho chuka hai.")
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        return _err("Confirmation ka time (5 minute) nikal gaya. Change dobara prepare karein.")
    if row.workflow_run_id and payload.workflow_run_id and row.workflow_run_id != str(payload.workflow_run_id):
        return _err("Ye confirmation kisi aur conversation ka hai.")
    data = json.loads(row.payload)
    row.consumed_at = datetime.now(timezone.utc)  # single use, even if the write fails
    db.commit()
    try:
        if row.action_type == "stock_update":
            if data["operation"] == "add":
                adj = schemas.StockAdjustment(
                    variant_code=data["variant_code"], operation="delta", delta=data["quantity"],
                    expected_current_stock=data["expected_current_stock"], note="Dograh agent stock add")
            else:
                adj = schemas.StockAdjustment(
                    variant_code=data["variant_code"], operation="set", new_count=data["quantity"],
                    expected_current_stock=data["expected_current_stock"], note="Dograh agent stock set")
            if adj.operation == "delta" and data["quantity"] == 0:
                return _err("0 pieces add karne se kuch nahi badlega.")
            out = m.adjust_stock(adj, db)
            return _ok(f"Ho gaya. {row.summary}", current_stock=out["current_stock"] if isinstance(out, dict) else None)
        if row.action_type == "product_create":
            body = schemas.ProductCreate(
                sku=data["sku"], name=data["name"], category=data["category"],
                variants=[schemas.VariantCreate(size=s) for s in data["sizes"]])
            m.create_product(body, db)
            return _ok(f"Naya design {data['name']} ({data['sku']}) ban gaya.")
        if row.action_type == "order_dispatch":
            result = m.dispatch_order_upload(data["order_id"], None, db)
            return _ok(f"Batch {data['order_id']}: {result['dispatched_units']} pieces dispatch hue, {result['pending_units']} pending.", result=result)
        return _err("Unknown action.")
    except HE as exc:
        db.rollback()
        return _err(str(exc.detail))
