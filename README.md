# Inventory Management System

A production-structured inventory system for a product catalog: live stock
tracked **size-wise** (every size of every design counted separately), a real-catalog
importer for your marketplace seller-listings export, Excel/CSV order deduction that
matches on your actual marketplace SKU codes, QR-code scan-to-recount, bulk physical
stock counting, Excel bulk product/size import, automatic low-stock alerts, a daily reorder list, a searchable
**Products** view with photo upload and delete, a modern Tailwind CSS interface, and a
a Dograh-powered voice/chat AI assistant with confirmation-gated stock/product operations, and
photo-to-catalog visual search with size-wise live stock.

## 1. Architecture

```
BROWSER  frontend/  (HTML/CSS/JS + Tailwind CSS via CDN, no build step, no framework)
  Live Inventory (filters, search, pagination) - Products (single or Excel bulk add,
  manage sizes, edit photos, delete) - Scan & Recount (camera QR) -
  Bulk Stock Count - Process Orders - Reorder List - Alerts - Print Labels
        |  fetch() - same-origin REST calls
API LAYER  backend/main.py  (FastAPI, also serves the frontend + /docs)
        |
SERVICE LAYER  backend/services/
  inventory_service   atomic per-variant stock changes - the one place that
                       touches current_stock; every other service calls this
  table_reader         one shared .xlsx / .xls / .csv reader (all-text dtype,
                       so "3202" never becomes 3202.0); used by every uploader
  excel_service         orders -> deduction. Matches each row on whichever
                       code your marketplace export uses (seller SKU code,
                       marketplace SKU code, or your own SKU + Size)
  bulk_stock_service    a full physical count, loaded in one upload -
                       set-based SQL, ~1,900 sizes/second
  bulk_product_service  creates designs and size variants from one Excel upload,
                       with per-row validation and a downloadable template
  alert_service          opens/resolves low-stock alerts (skips sizes never
                       counted - see "not counted" below)
  reorder_service       pending marketplace orders -> a shortage picklist / vendor-ready reorder list
  barcode_service        one Code128 barcode per design; scan it to open all
                       sizes together
  agent_api.py           secured /api/agent/* tools used by the Dograh voice/chat agent
                         (read tools + prepare/confirm write tools)
  visual_search_service  SigLIP 2 embeddings for product-linked reference images + versioned pgvector index
        |  SQLAlchemy ORM
DATA LAYER  backend/models.py
  SQLite file today (inventory.db) -> PostgreSQL later via one env var

  Product (a design/style)
    - sku, name, category, image_path, vendor
    - variants: one per size
        Variant (the actual stockable unit)
          - size, variant_code ("392-M"), current_stock
          - reorder_threshold, target_stock_level
          - last_counted_at  (NULL = never counted - see #3)
          - seller_sku_code, marketplace_sku_code  (marketplace aliases)
          -> InventoryTransaction (append-only ledger, never edited)
          -> Alert
          -> OrderLine
          -> ReorderBatchItem
```

**Why this shape:** "SKU 392" alone was never a stockable thing - "392, size M" is.
The schema splits **Product** (the design: name and image shared across sizes)
from **Variant** (one row per size: the count, the threshold, the QR code). Every
transaction, alert, order line and reorder line points at a Variant, so a low-stock
signal always means one specific size, never a whole design smeared across five sizes.

**Why not Next.js:** Next.js needs its own Node.js server running alongside the
Python one - a second service to deploy, keep in sync, and pay for, with a CORS
boundary between them. For an internal tool with no public pages and no SEO need,
that buys nothing a plain page doesn't already have. Tailwind (via CDN, no build
step) gets the same modern look without any of that - one Python process, one
deployment, matching what's already connected on Railway.

The service layer is the only part of the system that knows business rules. `main.py`
never touches the database directly - it only calls services - so the same logic could
later sit behind a scheduled job or a direct marketplace order-API pull without being
rewritten, only the layer that calls it.

## 2. Setup

```bash
cd inventory-system
python3 -m venv venv
source venv/bin/activate            # Windows: venv\Scripts\activate
pip install -r requirements.txt
cd backend
```

Then pick one starting point:

```bash
# A) A handful of sample products, to try the system immediately
python seed_data.py

# B) Your real catalog, from a marketplace seller-listings export
#    (a copy of the one you sent is already in sample_data/)
python scripts/import_seller_listings.py ../sample_data/seller_listings_export.csv
```

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Open **http://localhost:8000/app/** for the dashboard, **http://localhost:8000/docs**
for the auto-generated API reference. `--host 0.0.0.0` means any PC on the same office
network can reach it at your machine's LAN IP (e.g. `http://192.168.1.20:8000/app/`).

**Moving to PostgreSQL later** (multi-user / networked / cloud): set one environment
variable before starting the server -
`export DATABASE_URL="postgresql://user:password@host:5432/inventory"` - no code
changes; `database.py` reads it automatically. This is required for #10 below.

## 3. Products: search a design, see every size, photo, delete

The *Products* tab is the catalog-management view - separate from *Live Inventory*,
which stays focused on flat, filterable stock monitoring across every size. Type a
SKU or product name (2+ characters) and every matching **design** appears as a card:
its photo, every size with its current count in one place, an upload control for the
photo, a delete button for the whole design, and a small × on each size chip to
remove just that one size. Deleting is permanent - it removes the design/size and its
full ledger history, not just the stock number - the delete button asks for
confirmation before doing it (`DELETE /api/products/{sku}` and
`DELETE /api/variants/{variant_code}` under the hood; see `main.py`).

## 3.1 "Not counted" is not the same as "zero"

A marketplace listings export tells you *which* SKUs and sizes exist - it carries no
stock numbers. So every size the importer creates starts as **NOT COUNTED**, not as
zero: its `last_counted_at` is NULL. A never-counted size:
- shows as a distinct grey "Not counted" status on the dashboard (not "Out of stock")
- raises **no alert**
- never appears on the reorder list

A size becomes counted the moment a real number is entered for it - a manual recount,
a Scan & Recount, or a **Bulk Stock Count** upload - and only then does it start
taking part in alerts and reordering. This matters: without it, importing a catalog
of 1,561 designs would instantly raise ~7,800 false "out of stock" alerts and put
every single size on the reorder list at its full restock target, on day one, before
anyone has counted anything.

## 4. Getting from "just imported" to "fully counted"

**Bulk Stock Count** (for the initial count, or a full recount):
1. Dashboard -> *Bulk Stock Count* -> download the count sheet (optionally filtered
   to only the sizes not yet counted).
2. Walk the hub, type each size's real count into the **Count** column. Leave a row
   blank to skip it for now; enter `0` if you counted and found none.
3. Upload the filled sheet. Every filled row sets that size's stock, logs it to the
   ledger, marks it counted, and opens/resolves its alert - in one pass
   (~1,900 sizes/second; the full 7,862-size catalog took 1.4s in testing).

**Scan & Recount** (for one size at a time, day to day): open *Scan & Recount*, point
the camera at a size's printed QR label (or type its SKU + size), see what the system
currently shows, type the real count. *Print Labels* generates and prints those QR
codes, one per size.

### Add products from Excel

1. Open **Products -> Add Product -> Bulk from Excel** and download the template.
2. Enter one row per size. Repeat the SKU and product name for every size; enter the
   opening stock for each size. Category, alert threshold and target stock can be set
   per design/size. The template's **Instructions** sheet lists the accepted columns.
3. Upload the completed `.xlsx`, `.xls` or `.csv`. The result reports added products,
   added sizes and row-level errors. A bad row skips its whole SKU group so a design
   is never left half-imported. Existing SKUs are skipped safely.

Product photos are intentionally left blank in the template; add them later from the
product's Edit screen. Blank alert/target fields use defaults of 5 and 20.

## 5. Processing orders

*Process Orders* accepts an Excel **or CSV** file and matches each row on your own
`variant_code`, seller SKU code, marketplace SKU code, or SKU + Size. Uploading an
order creates a **PENDING/RESERVED** order line; it does **not** reduce physical stock.
The Picklist / Reorder Shortage view sums each line's unfulfilled remainder by size and calculates
`Required = max(Pending Orders - Physical Stock, 0)`. Process Orders shows FIFO-allocated
dispatch availability with a green ready check or a partial-availability count. **Dispatch Ready**
deducts only counted stock that is available; any remainder stays pending for the next dispatch.
Use **All ready** to select eligible lines on the current line page, then **Dispatch Selected**
to process that subset. Deleting a partially dispatched batch restores every already-dispatched piece.

## 6. Data structures & algorithms - the decisions that matter at ~8,000 rows

- **Batch resolution, not one query per row.** Every order/count upload first collects
  every distinct code in the file, resolves them in a handful of chunked `IN (...)`
  queries into hash maps, then aggregates quantities per resolved variant in one linear
  pass. A 500-row order file with repeated SKUs becomes tens of database writes, not
  hundreds - and a 7,862-row bulk count runs as one set-based `INSERT`/`UPDATE` pair
  instead of 7,862 individual ORM calls (an early version took 140s doing it the naive
  way; the set-based version takes about 1.4s).
- **Stock deduction is atomic at the database level** (`inventory_service.py`), not
  "read in Python, check, write back" - so two staff processing an order and a recount
  at the same moment can't both succeed against the same last few pieces.
- **Idempotent uploads.** Every uploaded order file's SHA-256 hash is stored; the same
  file uploaded twice is rejected instead of silently double-deducting.
- **Alerts are idempotent by rule**, not by remembered state: "should an alert be open
  right now?" is re-derived from current stock vs. threshold every time, so it can
  never drift out of sync with reality.
- **Append-only ledger + cached running balance.** `Variant.current_stock` is a
  fast-read cache; `InventoryTransaction` is the permanent, never-edited audit trail -
  if a number is ever in doubt, it can be rebuilt exactly by summing that variant's
  transactions.
- **Reorder list is an `O(n log n)` sort** by current stock (most urgent first) -
  plenty at this catalog size; no need for a fancier structure.
- **The catalog importer groups by `style id`**, not by the marketplace's own "base
  SKU" column, because on the real export that base-SKU column was constant per style
  only ~72% of the time (verified against the 8,313-row file before writing the
  importer) - `style id` was the one column that was reliably constant every time.
  Two genuine data problems the importer catches rather than crashes on or silently
  mis-imports: two different designs that happened to share a derived SKU (resolved by
  appending the style id), and one design with two rows both claiming the same size
  (kept the first, flagged the rest for you to check in your seller panel).

## 7. AI assistant and visual product search

### AI assistant (Dograh)

The voice/chat agent is [Dograh](https://github.com/dograh-hq/dograh), a
self-hostable open-source voice-agent platform. Dograh runs the conversation
(speech-to-text, LLM, text-to-speech, web widget); this app exposes the
inventory to it through a small authenticated tool API:

| Tool endpoint (`POST /api/agent/...`) | Purpose |
| --- | --- |
| `search_products`, `app_status`, `daily_sales`, `alerts`, `reorder`, `pending_orders`, `recent_activity` | read-only answers from the live database |
| `prepare_stock_update`, `prepare_product_create`, `prepare_dispatch` | validate a change and return a single-use `confirmation_token`; **nothing is written** |
| `confirm_action` | applies the prepared change (token expires in 5 minutes, works once, rejects stale stock) |

The same tools are also served as an **MCP server** (Streamable HTTP) at `/mcp/`, so Dograh can attach one MCP tool instead of 11 HTTP tools. All routes and `/mcp/` require `Authorization: Bearer $DOGRAH_TOOL_API_KEY`. The browser only
learns the widget script URL from `GET /api/agent/config`. Full hosting and
Dograh configuration steps: [DOGRAH_SETUP_HI.md](DOGRAH_SETUP_HI.md); ready-to-paste
agent prompt and tool definitions are in [`dograh/`](dograh/).

