"""MCP server exposing the inventory agent tools (Streamable HTTP, mounted at /mcp/).

Same tools and the same safety rules as /api/agent/*: reads answer from the
database, writes are two-step (prepare_* then confirm_action). Auth is the same
``Authorization: Bearer <DOGRAH_TOOL_API_KEY>`` header, so one secret protects
both the REST tools and MCP. In Dograh: Tools > MCP Server > URL
``https://<inventory-domain>/mcp/`` with a Bearer Token credential.
"""
import hmac
import json
import os
from contextlib import contextmanager

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

import agent_api
from database import SessionLocal

# Bearer auth protects the endpoint; Host-header allow-listing would only break
# deployments behind a custom domain/proxy.
mcp = FastMCP(
    "inventory",
    instructions=(
        "Clothing inventory tools. Stock is per design and size. Never invent numbers. "
        "To change data call a prepare_* tool, read its summary to the user, and call "
        "confirm_action ONLY after the user clearly says yes."
    ),
    streamable_http_path="/",
    stateless_http=True,
    json_response=True,
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


@contextmanager
def _db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _json(result) -> str:
    return json.dumps(result, default=str, ensure_ascii=False)


@mcp.tool()
def search_products(query: str, size: str = "") -> str:
    """Look up designs and live size-wise stock. Use for any stock/size/design question and before changing anything. If several designs come back, ask the user which one."""
    with _db() as db:
        return _json(agent_api.search_products(agent_api.SearchIn(query=query, size=size), db))


@mcp.tool()
def daily_sales() -> str:
    """Today's dispatched units and top designs (no revenue data exists)."""
    with _db() as db:
        return _json(agent_api.daily_sales(db))


@mcp.tool()
def app_status() -> str:
    """Overall live status: designs, sizes, total stock, low/out counts, alerts, pending orders."""
    with _db() as db:
        return _json(agent_api.app_status(db))


@mcp.tool()
def alerts(query: str = "") -> str:
    """Open low-stock, out-of-stock and order-shortage alerts, optionally filtered by design/SKU/size."""
    with _db() as db:
        return _json(agent_api.alerts(agent_api.OptionalQueryIn(query=query), db))


@mcp.tool()
def reorder(query: str = "") -> str:
    """What must be re-ordered for pending marketplace orders, optionally filtered."""
    with _db() as db:
        return _json(agent_api.reorder(agent_api.OptionalQueryIn(query=query), db))


@mcp.tool()
def pending_orders() -> str:
    """Pending order lines/units and the latest batch ids."""
    with _db() as db:
        return _json(agent_api.pending_orders(db))


@mcp.tool()
def recent_activity(query: str = "") -> str:
    """Most recent stock changes, optionally for one design."""
    with _db() as db:
        return _json(agent_api.recent_activity(agent_api.OptionalQueryIn(query=query), db))


@mcp.tool()
def prepare_stock_update(sku: str, size: str, operation: str, quantity: int, workflow_run_id: str = "") -> str:
    """STEP 1 of changing stock; changes nothing. operation: 'add' (increase by quantity) or 'set' (final total). Returns a summary to read to the user and a confirmation_token."""
    with _db() as db:
        return _json(agent_api.prepare_stock_update(agent_api.StockUpdateIn(
            sku=sku, size=size, operation=operation, quantity=quantity,
            workflow_run_id=workflow_run_id or None), db))


@mcp.tool()
def prepare_product_create(sku: str, name: str, sizes: str, category: str = "", workflow_run_id: str = "") -> str:
    """STEP 1 of creating a new design; creates nothing. sizes like 'S M L'. Returns a summary and confirmation_token."""
    with _db() as db:
        return _json(agent_api.prepare_product_create(agent_api.ProductCreateIn(
            sku=sku, name=name, category=category, sizes=sizes,
            workflow_run_id=workflow_run_id or None), db))


@mcp.tool()
def prepare_dispatch(order_id: int, workflow_run_id: str = "") -> str:
    """STEP 1 of dispatching a pending order batch; dispatches nothing. Returns a summary and confirmation_token."""
    with _db() as db:
        return _json(agent_api.prepare_dispatch(agent_api.DispatchIn(
            order_id=order_id, workflow_run_id=workflow_run_id or None), db))


@mcp.tool()
def confirm_action(confirmation_token: str, workflow_run_id: str = "") -> str:
    """STEP 2: apply a prepared change. Call ONLY after the user clearly said yes to the summary, with the exact token from the prepare tool, never in the same turn as the prepare call."""
    with _db() as db:
        return _json(agent_api.confirm_action(agent_api.ConfirmIn(
            confirmation_token=confirmation_token, workflow_run_id=workflow_run_id or None), db))


class BearerAuth:
    """ASGI wrapper: require the shared tool key before anything reaches MCP."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        expected = agent_api.tool_key()
        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        supplied = headers.get("authorization", "").removeprefix("Bearer ").strip()
        if not expected or not hmac.compare_digest(supplied.encode(), expected.encode()):
            status = 503 if not expected else 401
            body = b'{"detail":"MCP tools disabled or invalid key."}'
            await send({"type": "http.response.start", "status": status,
                        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)


def build_asgi_app():
    return BearerAuth(mcp.streamable_http_app())
