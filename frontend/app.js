const API = "/api";
const STANDARD_SIZES = ["S", "M", "L", "XL", "XXL"];
const PAGE_SIZE = 100;

const $ = (id) => document.getElementById(id);

// A saved image can become unavailable if its file was removed or the hosting
// service lost its local image directory. Keep the product visible and show a
// clear fallback instead of leaving an empty/broken image area.
document.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  if (image.classList.contains("pcard-photo")) {
    const placeholder = document.createElement("div");
    placeholder.className = "pcard-photo-ph image-unavailable";
    placeholder.innerHTML = '<i class="fa-solid fa-image" aria-hidden="true"></i><span>Photo unavailable</span>';
    image.replaceWith(placeholder);
  } else if (image.matches(".detail-photo-box img")) {
    const placeholder = document.createElement("span");
    placeholder.className = "detail-photo-failed";
    placeholder.textContent = "Photo unavailable · click to replace";
    image.replaceWith(placeholder);
  } else if (image.classList.contains("detail-photo-thumb-image")) {
    const button = image.closest("button");
    if (button) {
      button.disabled = true;
      button.classList.add("is-unavailable");
      image.remove();
      button.append("Unavailable");
    }
  } else if (image.classList.contains("thumb")) {
    const placeholder = document.createElement("div");
    placeholder.className = "thumb-placeholder";
    image.replaceWith(placeholder);
  } else if (image.classList.contains("trash-photo")) {
    const placeholder = document.createElement("div");
    placeholder.className = "trash-photo placeholder";
    placeholder.innerHTML = '<i class="fa-solid fa-image" aria-hidden="true"></i>';
    image.replaceWith(placeholder);
  }
}, true);

// A small, non-blocking sweep tells staff when any app API request is taking
// longer than a quick response. Keep it local to /api so static assets do not
// flash the indicator while rendering a page.
const appLoadingIndicator = $("app-loading-indicator");
const nativeFetch = window.fetch.bind(window);
let appApiRequests = 0;
let appLoadingTimer = null;
window.fetch = (input, init) => {
  let isAppApi = false;
  try {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
    isAppApi = url.origin === window.location.origin && url.pathname.startsWith("/api/");
  } catch {}
  if (!isAppApi) return nativeFetch(input, init);
  appApiRequests += 1;
  if (appApiRequests === 1) appLoadingTimer = setTimeout(() => appLoadingIndicator?.classList.add("is-visible"), 320);
  return nativeFetch(input, init).finally(() => {
    appApiRequests = Math.max(0, appApiRequests - 1);
    if (!appApiRequests) {
      clearTimeout(appLoadingTimer);
      appLoadingIndicator?.classList.remove("is-visible");
    }
  });
};

// Theme choice is local to this browser and is restored before the page paints.
function setTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  try { localStorage.setItem("inventoryTheme", isDark ? "dark" : "light"); } catch (e) {}
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    const label = isDark ? "Switch to light mode" : "Switch to dark mode";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.setAttribute("aria-pressed", String(isDark));
    button.innerHTML = `<i class="fa-solid ${isDark ? "fa-sun" : "fa-moon"}" aria-hidden="true"></i>${button.classList.contains("rail-link") ? `<span class="rail-label">${isDark ? "Light mode" : "Dark mode"}</span>` : ""}`;
  });
}
setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
document.querySelectorAll("[data-theme-toggle]").forEach((button) => button.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}));

function setAlertBadge(n) {
  [$("alert-count"), $("alert-count-mobile")].forEach((el) => { if (el) { el.textContent = n; el.hidden = !(n > 0); } });
}

// Unlock/resume audio after the first real user interaction on mobile browsers.
document.addEventListener("pointerdown", () => {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) {}
}, { once: false, passive: true });

// ---------------- Confirm modal ----------------
let confirmAction = null;
$("confirm-cancel").addEventListener("click", () => { $("confirm-modal").hidden = true; });
$("confirm-ok").addEventListener("click", async () => { $("confirm-modal").hidden = true; if (confirmAction) await confirmAction(); });
function askConfirm(title, body, action, okLabel = "Delete") {
  $("confirm-title").textContent = title;
  $("confirm-body").textContent = body;
  $("confirm-ok").textContent = okLabel;
  confirmAction = action;
  $("confirm-modal").hidden = false;
}

// ---------------- Nav: drawer + view switching ----------------
function openDrawer() { $("sidebar").classList.add("is-open"); $("nav-backdrop").hidden = false; }
function closeDrawer() { $("sidebar").classList.remove("is-open"); $("nav-backdrop").hidden = true; }
$("menu-toggle").addEventListener("click", openDrawer);
$("sidebar-collapse").addEventListener("click", () => {
  const collapsed = $("shell").classList.toggle("sidebar-collapsed");
  localStorage.setItem("sidebarCollapsed", String(collapsed));
  $("sidebar-collapse").setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  $("sidebar-collapse").title = collapsed ? "Expand sidebar" : "Collapse sidebar";
});
if (localStorage.getItem("sidebarCollapsed") === "true") $("shell").classList.add("sidebar-collapsed");
$("nav-backdrop").addEventListener("click", closeDrawer);
$("topbar-alerts").addEventListener("click", () => switchView("alerts"));

document.querySelectorAll(".rail-link[data-view]").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));

const APP_VIEW_NAMES = new Set([...document.querySelectorAll(".view")].map((view) => view.id.replace(/^view-/, "")));
function viewFromLocation() {
  const requested = decodeURIComponent(window.location.hash.replace(/^#\/?/, "").split(/[?&]/, 1)[0] || "");
  return APP_VIEW_NAMES.has(requested) ? requested : "dashboard";
}

function switchView(name, { updateUrl = true } = {}) {
  if (!APP_VIEW_NAMES.has(name)) name = "dashboard";
  if (updateUrl && viewFromLocation() !== name) window.history.pushState({ view: name }, "", `#${encodeURIComponent(name)}`);
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  $("stage")?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
  document.querySelectorAll(".rail-link").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("is-active", v.id === `view-${name}`));
  closeDrawer();
  if (name !== "scan") stopCamera();
  if (name !== "visual") stopVisualCamera();
  if (name === "dashboard") { loadSummary(); loadInventory(); loadMoversChart(); }
  if (name === "products" && !window.__keepProductSearch) {
    $("product-search").value = "";
    loadLatestProducts();
  }
  window.__keepProductSearch = false;
  if (name === "orders") loadOrderHistory();
  if (name === "reorder") loadReorderList();
  if (name === "alerts") loadAlerts();
  if (name === "trash") loadTrash();
  if (name === "visual") loadVisualSearchStatus();
  if (name === "history") { history.offset = 0; loadHistory(true); }
}

window.addEventListener("popstate", () => switchView(viewFromLocation(), { updateUrl: false }));

// Keep dashboard counters and alert state fresh without creating a new timer
// every time the user changes sidebar pages.
setInterval(() => {
  loadSummary();
}, 30000);

// ================================================================ //
// DASHBOARD
// ================================================================ //
const inv = { q: "", status: "", offset: 0, total: 0 };
const STATUS_LABEL = { UNCOUNTED: "Not counted", OUT: "Out of stock", LOW: "Low stock", OK: "In stock" };

async function loadSummary() {
  try {
    const s = await getJSON(`${API}/summary`);
    const chips = [
      { key: "", label: "All sizes", n: s.variants },
      { key: "UNCOUNTED", label: "Not counted", n: s.uncounted },
      { key: "OUT", label: "Out of stock", n: s.out },
      { key: "LOW", label: "Low stock", n: s.low },
      { key: "OK", label: "In stock", n: s.ok },
    ];
    $("summary-row").innerHTML = chips.map((c) => `
      <button type="button" class="chip ${inv.status === c.key ? "is-on" : ""}" data-status="${c.key}">
        <span class="chip-n">${c.n.toLocaleString()}</span><span class="chip-l">${c.label}</span>
      </button>`).join("") + `<div class="chip-meta">${s.products.toLocaleString()} designs</div>`;
    $("summary-row").querySelectorAll(".chip").forEach((btn) => btn.addEventListener("click", () => {
      inv.status = btn.dataset.status; $("status-filter").value = inv.status; inv.offset = 0;
      loadSummary(); loadInventory();
    }));
    noteAlertCount(s.open_alerts);
  } catch (e) { /* decorative */ }
}

async function loadInventory() {
  const params = new URLSearchParams({ limit: PAGE_SIZE, offset: inv.offset });
  if (inv.q) params.set("q", inv.q);
  if (inv.status) params.set("status", inv.status);
  const body = $("inventory-body");
  try {
    const page = await getJSON(`${API}/variants?${params}`);
    inv.total = page.total;
    renderInventory(page.items);
    const from = page.total ? page.offset + 1 : 0, to = Math.min(page.offset + page.limit, page.total);
    $("pg-info").textContent = `${from.toLocaleString()}–${to.toLocaleString()} of ${page.total.toLocaleString()}`;
    $("pg-prev").disabled = page.offset === 0;
    $("pg-next").disabled = page.offset + page.limit >= page.total;
  } catch (e) { body.innerHTML = `<tr><td colspan="7" class="empty">Could not load inventory.</td></tr>`; }
}

function renderInventory(items) {
  const body = $("inventory-body");
  if (!items.length) { body.innerHTML = `<tr><td colspan="7" class="empty">Nothing matches these filters.</td></tr>`; return; }
  body.innerHTML = items.map((v) => `
    <tr>
      <td class="col-img">${v.image_path ? `<img class="thumb" src="${esc(v.image_path)}" alt="">` : `<div class="thumb-placeholder"></div>`}</td>
      <td class="sku-tag">${esc(v.sku)}</td>
      <td class="name-cell" title="${esc(v.product_name)}">${esc(v.product_name)}</td>
      <td><span class="size-chip">${esc(v.size)}</span></td>
      <td class="num">${v.status === "UNCOUNTED" ? "—" : v.current_stock}</td>
      <td class="num hide-sm">${v.reorder_threshold}</td>
      <td><span class="status-pill status-${v.status}">${STATUS_LABEL[v.status] || v.status}</span></td>
    </tr>`).join("");
}

$("search-box").addEventListener("input", debounce((e) => { inv.q = e.target.value.trim(); inv.offset = 0; loadInventory(); }));
$("status-filter").addEventListener("change", (e) => { inv.status = e.target.value; inv.offset = 0; loadSummary(); loadInventory(); });
$("pg-prev").addEventListener("click", () => { inv.offset = Math.max(0, inv.offset - PAGE_SIZE); loadInventory(); });
$("pg-next").addEventListener("click", () => { inv.offset += PAGE_SIZE; loadInventory(); });

// ---------------- Movers chart (hand-drawn bars, no chart library needed) ----------------
$("movers-days").addEventListener("change", loadMoversChart);
async function loadMoversChart() {
  const box = $("movers-chart");
  try {
    const days = $("movers-days").value;
    const movers = await getJSON(`${API}/analytics/movers?days=${days}&limit=8`);
    if (!movers.length) { box.innerHTML = `<p class="hint">No orders processed yet in this period.</p>`; return; }
    const max = Math.max(...movers.map((m) => m.units_moved), 1);
    box.innerHTML = movers.map((m) => `
      <div class="chart-row">
        <div class="chart-label" title="${esc(m.name)}">${esc(m.sku)}</div>
        <div class="chart-bar-track"><div class="chart-bar" style="width:${Math.max(4, (m.units_moved / max) * 100)}%"></div></div>
        <div class="chart-val">${m.units_moved}</div>
      </div>`).join("");
  } catch (e) { box.innerHTML = `<p class="hint">Could not load chart.</p>`; }
}

// ================================================================ //
// PRODUCTS (search) -> PRODUCT DETAIL
// ================================================================ //
$("product-search").addEventListener("input", debounce((e) => {
  productPage.q = e.target.value.trim();
  productPage.offset = 0;
  loadProductsPage();
}, 300));

const productPage = { q: "", offset: 0, limit: 12, requestId: 0 };
async function loadLatestProducts() {
  productPage.q = "";
  productPage.offset = 0;
  $("product-search").value = "";
  await loadProductsPage();
}

async function loadProductsPage() {
  const grid = $("product-cards"), hint = $("product-search-hint");
  const requestId = ++productPage.requestId;
  try {
    const params = new URLSearchParams({ limit: productPage.limit, offset: productPage.offset, paged: "true" });
    if (productPage.q) params.set("q", productPage.q);
    const page = await getJSON(`${API}/products?${params}`);
    if (requestId !== productPage.requestId) return;
    const products = page.items;
    if (!products.length) {
      grid.innerHTML = "";
      hint.hidden = false;
      hint.textContent = productPage.q ? `No design matches "${productPage.q}".` : "No products yet. Add your first product.";
      $("product-result-count").textContent = "";
      $("products-page-info").textContent = "";
      $("products-prev").disabled = $("products-next").disabled = true;
      return;
    }
    hint.hidden = true;
    $("product-result-count").textContent = productPage.q ? `Search results · ${page.total} designs` : `${page.total} designs`;
    $("products-page-info").textContent = `${productPage.offset + 1}–${Math.min(productPage.offset + products.length, page.total)} of ${page.total}`;
    $("products-prev").disabled = productPage.offset === 0;
    $("products-next").disabled = productPage.offset + products.length >= page.total;
    grid.innerHTML = products.map(productCardHTML).join("");
    grid.querySelectorAll(".pcard").forEach((card) => card.addEventListener("click", () => openProductDetail(card.dataset.sku)));
  } catch (e) {
    if (requestId !== productPage.requestId) return;
    grid.innerHTML = "";
    hint.hidden = false;
    hint.textContent = "Could not load products right now.";
  }
}

async function searchProducts(q) {
  productPage.q = q;
  productPage.offset = 0;
  await loadProductsPage();
}
$("products-prev").addEventListener("click", () => { productPage.offset = Math.max(0, productPage.offset - productPage.limit); loadProductsPage(); });
$("products-next").addEventListener("click", () => { productPage.offset += productPage.limit; loadProductsPage(); });

function productCardHTML(p) {
  const sizes = p.variants.map((v) => `<span class="size-chip status-${v.status}">${esc(v.size)}: ${v.status === "UNCOUNTED" ? "—" : v.current_stock}</span>`).join("");
  return `
    <article class="pcard" data-sku="${esc(p.sku)}">
      <div class="pcard-photo-wrap">
        ${p.image_path ? `<img class="pcard-photo" src="${esc(p.image_path)}?v=${Date.now()}" alt="${esc(p.name)}" loading="lazy">` : `<div class="pcard-photo-ph"><i class="fa-solid fa-image"></i><span>No image</span></div>`}
      </div>
      <div class="pcard-body">
        <div class="pcard-name" title="${esc(p.name)}">${esc(p.name)}</div>
        <div class="pcard-meta"><span class="sku-tag">${esc(p.sku)}</span>${p.category ? " · " + esc(p.category) : ""}</div>
        <div class="pcard-sizes">${sizes}</div>
      </div>
    </article>`;
}

$("detail-back").addEventListener("click", () => switchView("products"));

async function openProductDetail(sku) {
  try {
    const product = await getJSON(`${API}/products/${encodeURIComponent(sku)}`);
    document.querySelectorAll(".rail-link").forEach((b) => b.classList.toggle("is-active", b.dataset.view === "products"));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("is-active", v.id === "view-detail"));
    renderDetail(product, $("detail-content"), { showDelete: true });
  } catch (e) { showToast("Could not open product", true); }
}

// Shared renderer: used by both the Product Detail page and the Scan result
// panel, so updating a size works identically everywhere.
function renderDetail(product, container, opts = {}) {
  const seats = product.variants.map((v) => `
    <div class="seat" data-code="${esc(v.variant_code)}">
      <div class="seat-size">${esc(v.size)}</div>
      <div class="seat-status"><span class="status-pill status-${v.status}">${STATUS_LABEL[v.status] || v.status}</span></div>
      <div class="seat-row">
        <input type="number" min="0" class="input seat-count" placeholder="${v.status === "UNCOUNTED" ? "count" : v.current_stock}">
        <button class="btn-secondary seat-save" type="button">Save</button>
      </div>
      <button class="seat-del" type="button"><i class="fa-solid fa-trash-can"></i> Delete size</button>
    </div>`).join("");
  const productPhotos = [...new Set([...(product.images || []), product.image_path].filter(Boolean))];

  container.innerHTML = `
    <div class="detail-head">
      <div class="detail-photo-gallery">
        <label class="detail-photo-box" id="detail-photo-box" role="button" tabindex="0" aria-label="Change product photo">
          ${product.image_path ? `<img src="${esc(product.image_path)}?v=${Date.now()}" alt="${esc(product.name)}">` : `<i class="fa-solid fa-image"></i><br><small>Add photo</small>`}
          <input type="file" accept="image/*" id="detail-photo-input" hidden>
        </label>
        ${productPhotos.length > 1 ? `<div class="detail-photo-thumbnails" aria-label="All product photos">${productPhotos.map((path, index) => `<button type="button" class="detail-photo-thumb${path === product.image_path ? " is-active" : ""}" data-photo-path="${esc(path)}" aria-label="Show photo ${index + 1}"><img class="detail-photo-thumb-image" src="${esc(path)}?v=${Date.now()}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
      </div>
      <div class="detail-info">
        <input class="input" id="detail-name" value="${esc(product.name)}" placeholder="Product name">
        <div class="detail-info-row">
          <input class="input" id="detail-sku" value="${esc(product.sku)}" placeholder="Canonical SKU">
          <input class="input" id="detail-category" placeholder="Category" value="${esc(product.category || "")}">
        </div>
        <div class="detail-actions">
          <button class="btn-secondary" id="detail-save" type="button"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
          <div class="product-label-actions" aria-label="Product labels">
            <a class="btn-ghost product-label-link" href="${API}/products/${encodeURIComponent(product.sku)}/barcode" target="_blank" rel="noopener" title="Open product barcode label"><i class="fa-solid fa-barcode"></i><span>Barcode</span></a>
            <a class="btn-ghost product-label-link" href="${API}/products/${encodeURIComponent(product.sku)}/qr" target="_blank" rel="noopener" title="Open product QR label"><i class="fa-solid fa-qrcode"></i><span>QR code</span></a>
          </div>
          <span class="sku-tag" style="align-self:center;">${esc(product.sku)}</span>
          ${opts.showDelete ? `<button class="btn-danger" id="detail-delete" type="button" style="margin-left:auto;"><i class="fa-solid fa-trash-can"></i> Delete Product</button>` : ""}
        </div>
        <div id="detail-msg" class="msg"></div>
      </div>
    </div>
    <h3 class="sub-head">Sizes</h3>
    <div class="seat-grid">
      ${seats}
      <div class="seat-add" id="seat-add"><i class="fa-solid fa-plus"></i> Add size</div>
    </div>`;

  container.querySelectorAll(".seat").forEach((seat) => {
    const code = seat.dataset.code;
    seat.querySelector(".seat-save").addEventListener("click", async () => {
      const input = seat.querySelector(".seat-count");
      if (input.value === "") { showToast("Enter a count first", true); return; }
      try {
        const updated = await apiPost(`${API}/inventory/adjust`, { variant_code: code, new_count: Number(input.value), note: "manual update" });
        input.value = ""; input.placeholder = updated.current_stock;
        seat.querySelector(".seat-status").innerHTML = `<span class="status-pill status-${updated.status}">${STATUS_LABEL[updated.status]}</span>`;
        showToast(`${code} set to ${updated.current_stock}`);
        await refreshInventoryViews();
      } catch (err) { showToast("Update failed: " + err.message, true); }
    });
    seat.querySelector(".seat-del").addEventListener("click", () => {
      askConfirm(`Delete size ${code}?`, "Moves this size to Trash. You can restore it later.", async () => {
        try {
          const r = await apiDelete(`${API}/variants/${encodeURIComponent(code)}`);
          if (r.product_also_deleted) { switchView(opts.showDelete ? "products" : "scan"); showToast(`${product.sku} deleted (last size removed)`); }
          else { seat.remove(); showToast(`${code} deleted`); }
          loadSummary();
        } catch (err) { showToast("Could not delete: " + err.message, true); }
      });
    });
  });

  // Fast warehouse counting: Enter saves and moves to the next size; Tab keeps
  // the browser's natural next-field behavior. ArrowUp/ArrowDown also move.
  const seatInputs = Array.from(container.querySelectorAll(".seat-count"));
  seatInputs.forEach((input, idx) => input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.closest(".seat")?.querySelector(".seat-save")?.click();
      setTimeout(() => seatInputs[idx + 1]?.focus(), 80);
    } else if (e.key === "ArrowDown") {
      e.preventDefault(); seatInputs[idx + 1]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); seatInputs[idx - 1]?.focus();
    }
  }));

  container.querySelector("#seat-add").addEventListener("click", () => openAddSizeModal(product, container, opts));

  const photoBox = container.querySelector("#detail-photo-box");
  const photoInput = container.querySelector("#detail-photo-input");
  photoBox.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    photoInput.click();
  });
  container.querySelectorAll(".detail-photo-thumb").forEach((button) => button.addEventListener("click", () => {
    const path = button.dataset.photoPath;
    let image = photoBox.querySelector("img");
    if (!image) {
      photoBox.querySelector(".detail-photo-failed")?.remove();
      image = document.createElement("img");
      photoBox.insertBefore(image, photoInput);
    }
    image.alt = `${product.name} product photo`;
    image.src = `${path}?v=${Date.now()}`;
    container.querySelectorAll(".detail-photo-thumb").forEach((thumbnail) => thumbnail.classList.toggle("is-active", thumbnail === button));
  }));
  photoInput.addEventListener("change", async () => {
    const file = photoInput.files[0];
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      const res = await fetch(`${API}/products/${encodeURIComponent(product.sku)}/image`, { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).detail || res.status);
      const data = await res.json();
      let image = photoBox.querySelector("img");
      photoBox.querySelector(".detail-photo-failed")?.remove();
      if (!image) {
        image = document.createElement("img");
        photoBox.insertBefore(image, photoInput);
      }
      image.src = `${data.image_path}?v=${Date.now()}`;
      image.alt = `${product.name} product photo`;
      product.image_path = data.image_path;
      photoInput.value = "";
      showToast("Photo updated");
    } catch (err) { photoInput.value = ""; showToast("Upload failed: " + err.message, true); }
  });

  container.querySelector("#detail-save").addEventListener("click", async () => {
    const msg = container.querySelector("#detail-msg");
    try {
      const res = await fetch(`${API}/products/${encodeURIComponent(product.sku)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: container.querySelector("#detail-sku").value.trim().toUpperCase(),
          name: container.querySelector("#detail-name").value,
          category: container.querySelector("#detail-category").value,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail);
      msg.textContent = "Saved"; msg.className = "msg success";
      showToast("Product + canonical SKU updated");
      const saved = await res.json();
      renderDetail(saved, container, opts);
      if (opts.showDelete) {
        window.__keepProductSearch = true;
        loadLatestProducts();
      }
    } catch (err) { msg.textContent = "Could not save"; msg.className = "msg error"; }
  });

  const delBtn = container.querySelector("#detail-delete");
  if (delBtn) delBtn.addEventListener("click", () => {
    askConfirm(`Delete ${product.name}?`, `Moves ${product.sku} and all its sizes to Trash. You can restore it from the Trash tab.`, async () => {
      try { await apiDelete(`${API}/products/${encodeURIComponent(product.sku)}`); showToast(`${product.sku} moved to Trash`); switchView("products"); loadSummary(); }
      catch (err) { showToast("Could not delete: " + err.message, true); }
    });
  });
}

let pendingAddSize = null;
function openAddSizeModal(product, container, opts) {
  pendingAddSize = { product, container, opts };
  $("add-size-product-name").textContent = `${product.name} · ${product.sku}`;
  $("add-size-form").reset();
  $("new-size-stock").value = "0";
  $("new-size-threshold").value = "5";
  $("new-size-target").value = "20";
  $("add-size-msg").textContent = "";
  $("add-size-msg").className = "msg";
  $("submit-add-size").disabled = false;
  $("add-size-modal").hidden = false;
  setTimeout(() => $("new-size-value").focus(), 0);
}
function closeAddSizeModal() {
  $("add-size-modal").hidden = true;
  pendingAddSize = null;
}
$("close-add-size")?.addEventListener("click", closeAddSizeModal);
$("cancel-add-size")?.addEventListener("click", closeAddSizeModal);
$("add-size-modal")?.addEventListener("click", (event) => {
  if (event.target.id === "add-size-modal") closeAddSizeModal();
});
$("add-size-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pending = pendingAddSize;
  const size = $("new-size-value").value.trim();
  const message = $("add-size-msg"), button = $("submit-add-size");
  if (!pending || !size) return;
  button.disabled = true;
  button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Adding…';
  message.textContent = "Saving this size and its stock settings…";
  message.className = "msg";
  try {
    const updated = await apiPost(`${API}/products/${encodeURIComponent(pending.product.sku)}/variants`, {
      size,
      initial_stock: Number($("new-size-stock").value) || 0,
      reorder_threshold: $("new-size-threshold").value === "" ? 5 : Number($("new-size-threshold").value),
      target_stock_level: $("new-size-target").value === "" ? 20 : Number($("new-size-target").value),
    });
    closeAddSizeModal();
    renderDetail(updated, pending.container, pending.opts);
    showToast(`Size ${size.toUpperCase()} added`, "success");
    await refreshInventoryViews();
  } catch (error) {
    message.textContent = error.message || "Could not add this size.";
    message.className = "msg error";
  } finally {
    button.disabled = false;
    button.innerHTML = '<i class="fa-solid fa-plus"></i> Add size';
  }
});

// ---------------- Add Product modal ----------------
let addPhotoFiles = [];
let addPhotoSlots = { front: null, back: null, closeup: null, extra: [] };
let addPhotoObjectUrls = new Map();
function selectAddMode(mode) {
  const bulk = mode === "bulk";
  $("bulk-product-panel").hidden = !bulk;
  $("add-product-form").hidden = bulk;
  document.querySelectorAll(".add-mode-tab").forEach((button) => {
    const selected = button.dataset.addMode === mode;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
}
document.querySelectorAll(".add-mode-tab").forEach((button) => button.addEventListener("click", () => selectAddMode(button.dataset.addMode)));
$("open-add-product").addEventListener("click", () => {
  $("add-product-form").reset();
  resetAddForm();
  selectAddMode("single");
  $("add-product-msg").textContent = "";
  $("add-product-msg").className = "msg";
  $("bulk-product-file").value = "";
  bulkProductFile = null;
  $("bulk-product-file-title").textContent = "Choose your filled Excel file";
  $("bulk-product-file-meta").textContent = ".xlsx, .xls or .csv · up to 20,000 rows";
  $("bulk-product-submit").disabled = true;
  $("bulk-product-result").innerHTML = "";
  $("add-product-modal").hidden = false;
  setTimeout(() => $("add-product-form").querySelector('input[name="sku"]')?.focus(), 0);
});
$("close-add-product").addEventListener("click", () => { $("add-product-modal").hidden = true; });
$("add-product-modal").addEventListener("click", (e) => { if (e.target.id === "add-product-modal") $("add-product-modal").hidden = true; });

$("add-photo-box").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  $("add-photo-input").click();
});
function selectedProductPhotos() {
  return [...new Set([addPhotoSlots.front, addPhotoSlots.back, addPhotoSlots.closeup, ...addPhotoSlots.extra].filter(Boolean))];
}
function makePhotoPreviewUrl(file) {
  if (!addPhotoObjectUrls.has(file)) addPhotoObjectUrls.set(file, URL.createObjectURL(file));
  const url = addPhotoObjectUrls.get(file);
  return url;
}
function releaseUnusedPhotoPreviewUrls() {
  const selected = new Set(addPhotoFiles);
  for (const [file, url] of addPhotoObjectUrls) {
    if (selected.has(file)) continue;
    URL.revokeObjectURL(url);
    addPhotoObjectUrls.delete(file);
  }
}
function updatePhotoAngle(role, file) {
  const key = role === "closeup" ? "closeup" : role;
  const thumb = $(`add-${key}-photo-thumb`);
  const label = $(`add-${key}-photo-label`);
  if (!thumb || !label) return;
  thumb.replaceChildren();
  if (file) {
    const image = document.createElement("img");
    image.src = makePhotoPreviewUrl(file);
    image.alt = `${role} product photo preview`;
    image.onerror = () => { image.remove(); thumb.innerHTML = '<i class="fa-solid fa-image"></i>'; };
    thumb.appendChild(image);
    label.textContent = file.name;
  } else {
    const icon = document.createElement("i");
    icon.className = role === "back" ? "fa-solid fa-shirt" : "fa-solid fa-magnifying-glass-plus";
    thumb.appendChild(icon);
    label.textContent = role === "back" ? "Add back view" : "Fabric or detail";
  }
}
function refreshProductPhotoSelection() {
  addPhotoFiles = selectedProductPhotos();
  releaseUnusedPhotoPreviewUrls();
  $("photo-selection-count").textContent = `${addPhotoFiles.length} of 8 photos`;
  const mainPhoto = addPhotoSlots.front || addPhotoFiles[0] || null;
  $("add-photo-preview").hidden = !mainPhoto;
  $("add-photo-placeholder").hidden = Boolean(mainPhoto);
  if (mainPhoto) {
    const preview = $("add-photo-preview");
    preview.onerror = () => {
      preview.hidden = true;
      $("add-photo-placeholder").hidden = false;
      $("add-photo-placeholder").querySelector("strong").textContent = "Preview unavailable";
    };
    preview.src = makePhotoPreviewUrl(mainPhoto);
  } else {
    $("add-photo-preview").removeAttribute("src");
    $("add-photo-placeholder").querySelector("strong").textContent = "Select product photos";
  }
  updatePhotoAngle("back", addPhotoSlots.back);
  updatePhotoAngle("closeup", addPhotoSlots.closeup);
  const thumbnailStrip = $("add-photo-thumbnails");
  thumbnailStrip.replaceChildren();
  for (const [index, file] of addPhotoFiles.entries()) {
    const role = file === addPhotoSlots.front ? "Main" : file === addPhotoSlots.back ? "Back" : file === addPhotoSlots.closeup ? "Close-up" : "Other";
    const card = document.createElement("div");
    card.className = "add-photo-thumbnail";
    const image = document.createElement("img");
    image.src = makePhotoPreviewUrl(file);
    image.alt = `${role} photo preview ${index + 1}`;
    image.onerror = () => { image.replaceWith(Object.assign(document.createElement("span"), { className: "add-photo-thumbnail-fallback", textContent: "Preview unavailable" })); };
    const caption = document.createElement("span");
    caption.textContent = `${role} · ${file.name}`;
    caption.title = file.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "add-photo-remove";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    remove.addEventListener("click", () => removeProductPhoto(file));
    card.append(image, caption, remove);
    thumbnailStrip.appendChild(card);
  }
  $("add-extra-photo-label").textContent = addPhotoSlots.extra.length ? `${addPhotoSlots.extra.length} selected` : "Add more views";
}
function removeProductPhoto(file) {
  for (const role of ["front", "back", "closeup"]) {
    if (addPhotoSlots[role] === file) addPhotoSlots[role] = null;
  }
  addPhotoSlots.extra = addPhotoSlots.extra.filter((photo) => photo !== file);
  refreshProductPhotoSelection();
}
function handleProductPhotoInput(event, role) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  if (role === "front") {
    addPhotoSlots.front = files[0];
    const otherFixed = [addPhotoSlots.back, addPhotoSlots.closeup].filter(Boolean).length;
    const extraCapacity = Math.max(0, 8 - otherFixed - 1);
    addPhotoSlots.extra = files.slice(1, 1 + extraCapacity);
    if (files.length > extraCapacity + 1) showToast("Only the first 8 selected photos can be used for one product.", "info");
  } else if (role === "extra") {
    const selectedFixed = [addPhotoSlots.front, addPhotoSlots.back, addPhotoSlots.closeup].filter(Boolean).length;
    const capacity = Math.max(0, 8 - selectedFixed);
    const isAlreadySelected = (file) => [addPhotoSlots.front, addPhotoSlots.back, addPhotoSlots.closeup, ...addPhotoSlots.extra].some((selected) =>
      selected && selected.name === file.name && selected.size === file.size && selected.lastModified === file.lastModified
    );
    const additions = files.filter((file) => !isAlreadySelected(file));
    const room = Math.max(0, capacity - addPhotoSlots.extra.length);
    addPhotoSlots.extra = [...addPhotoSlots.extra, ...additions.slice(0, room)];
    if (additions.length > room) showToast("Up to 8 photos total are allowed for one product.", "info");
  } else {
    const replacing = Boolean(addPhotoSlots[role]);
    if (addPhotoFiles.length - (replacing ? 1 : 0) >= 8) {
      event.target.value = "";
      showToast("Up to 8 photos total are allowed for one product.", "error");
      return;
    }
    addPhotoSlots[role] = files[0];
  }
  event.target.value = "";
  refreshProductPhotoSelection();
}
$("add-photo-input").addEventListener("change", (event) => handleProductPhotoInput(event, "front"));
$("add-back-photo-input").addEventListener("change", (event) => handleProductPhotoInput(event, "back"));
$("add-closeup-photo-input").addEventListener("change", (event) => handleProductPhotoInput(event, "closeup"));
$("add-extra-photo-input").addEventListener("change", (event) => handleProductPhotoInput(event, "extra"));

function addSizeRow(size = "") {
  const row = document.createElement("div");
  row.className = "size-row";
  row.innerHTML = `
    <input class="input sz size-size" value="${esc(size)}" placeholder="Size">
    <div><div class="lbl">Stock</div><input class="input num-in size-stock" type="number" value="" placeholder="0" min="0" inputmode="numeric"></div>
    <div><div class="lbl">Alert below</div><input class="input num-in size-threshold" type="number" value="5" min="0"></div>
    <div><div class="lbl">Target</div><input class="input num-in size-target" type="number" value="20" min="0"></div>
    <button type="button" class="row-remove" aria-label="Remove size"><i class="fa-solid fa-trash-can"></i></button>`;
  row.querySelector(".row-remove").addEventListener("click", () => row.remove());
  row.querySelectorAll("input").forEach((input) => input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const rows = Array.from(document.querySelectorAll("#size-rows .size-row"));
    const index = rows.indexOf(row);
    if (input.classList.contains("size-stock")) {
      const next = rows[index + 1]?.querySelector(".size-stock");
      if (next) next.focus();
      else $("add-product-form").querySelector('button[type="submit"]')?.focus();
    } else if (input.classList.contains("size-size")) {
      row.querySelector(".size-stock")?.focus();
    } else if (input.classList.contains("size-threshold")) {
      row.querySelector(".size-target")?.focus();
    } else if (input.classList.contains("size-target")) {
      const next = rows[index + 1]?.querySelector(".size-size");
      if (next) next.focus();
      else $("add-product-form").querySelector('button[type="submit"]')?.focus();
    }
  }));
  $("size-rows").appendChild(row);
}
function resetAddForm() {
  $("size-rows").innerHTML = "";
  STANDARD_SIZES.forEach((s) => addSizeRow(s));
  addPhotoFiles = [];
  addPhotoSlots = { front: null, back: null, closeup: null, extra: [] };
  addPhotoObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  addPhotoObjectUrls = new Map();
  $("add-photo-preview").src = "";
  $("add-photo-preview").hidden = true;
  $("add-photo-placeholder").hidden = false;
  $("add-photo-placeholder").querySelector("strong").textContent = "Select product photos";
  $("add-photo-input").value = "";
  $("add-back-photo-input").value = "";
  $("add-closeup-photo-input").value = "";
  $("add-extra-photo-input").value = "";
  updatePhotoAngle("back", null);
  updatePhotoAngle("closeup", null);
  $("add-extra-photo-label").textContent = "Add more views";
  $("add-photo-thumbnails").replaceChildren();
  $("photo-selection-count").textContent = "0 of 8 photos";
}
resetAddForm();
$("add-size-row").addEventListener("click", () => addSizeRow());

$("add-product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target, msg = $("add-product-msg");
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton.disabled) return;
  const variants = Array.from(document.querySelectorAll("#size-rows .size-row")).map((row) => ({
    size: row.querySelector(".size-size").value.trim(),
    initial_stock: Number(row.querySelector(".size-stock").value) || 0,
    reorder_threshold: Number(row.querySelector(".size-threshold").value) || 5,
    target_stock_level: Number(row.querySelector(".size-target").value) || 20,
  })).filter((v) => v.size);
  if (!variants.length) { msg.textContent = "Add at least one size."; msg.className = "msg error"; return; }

  submitButton.disabled = true;
  submitButton.dataset.originalText = submitButton.textContent;
  submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving product…';
  try {
    const data = await apiPost(`${API}/products`, {
      sku: form.elements.namedItem("sku").value,
      name: form.elements.namedItem("name").value,
      category: form.elements.namedItem("category").value,
      variants,
    });
    let photoWarning = "";
    if (addPhotoFiles.length) {
      try {
        const fd = new FormData(); fd.append("file", addPhotoFiles[0]);
        submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving main photo…';
        const imageResponse = await fetch(`${API}/products/${encodeURIComponent(data.sku)}/image`, { method: "POST", body: fd });
        if (!imageResponse.ok) {
          const imageError = await imageResponse.json().catch(() => ({}));
          throw new Error(imageError.detail || `Photo upload failed (${imageResponse.status})`);
        }
        if (addPhotoFiles.length > 1) {
          const extras = new FormData();
          addPhotoFiles.slice(1).forEach((file) => extras.append("files", file));
          submitButton.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving ${addPhotoFiles.length - 1} more photo${addPhotoFiles.length > 2 ? "s" : ""}…`;
          const extraResponse = await fetch(`${API}/products/${encodeURIComponent(data.sku)}/images`, { method: "POST", body: extras });
          if (!extraResponse.ok) {
            const imageError = await extraResponse.json().catch(() => ({}));
            throw new Error(imageError.detail || `Additional photo upload failed (${extraResponse.status})`);
          }
        }
      } catch (error) {
        photoWarning = ` Some product photos may not have uploaded: ${error.message || "retry them from Edit"}.`;
      }
    }
    const newSku = data.sku;
    form.reset(); resetAddForm(); msg.textContent = "";
    $("add-product-modal").hidden = true;
    showToast(photoWarning ? `Product added — ${newSku}.${photoWarning}` : `Product added successfully — ${newSku}`, photoWarning ? "info" : "success", photoWarning ? 4200 : 1500);
    window.__keepProductSearch = true;
    switchView("products");
    $("product-search").value = "";
    await Promise.allSettled([loadLatestProducts(), loadSummary(), loadAlerts(), loadReorderList()]);
  } catch (err) { msg.textContent = err.message; msg.className = "msg error"; showToast(err.message || "Could not add product", "error", 2200); }
  finally { submitButton.disabled = false; submitButton.textContent = submitButton.dataset.originalText || "Save Product"; }
});

// ---------------- Bulk product import ----------------
let bulkProductFile = null;
const bulkProductInput = $("bulk-product-file");
const bulkProductDropzone = $("bulk-product-dropzone");
function showBulkProductFile(file) {
  bulkProductFile = file || null;
  const submit = $("bulk-product-submit");
  if (!file) {
    $("bulk-product-file-title").textContent = "Choose your filled Excel file";
    $("bulk-product-file-meta").textContent = ".xlsx, .xls or .csv · up to 20,000 rows";
    submit.disabled = true;
    return;
  }
  const size = file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`;
  $("bulk-product-file-title").textContent = file.name;
  $("bulk-product-file-meta").textContent = `${size} · Ready to import`;
  submit.disabled = false;
}
bulkProductInput.addEventListener("change", () => showBulkProductFile(bulkProductInput.files[0]));
bulkProductDropzone.addEventListener("dragover", (event) => { event.preventDefault(); bulkProductDropzone.classList.add("is-dragover"); });
bulkProductDropzone.addEventListener("dragleave", () => bulkProductDropzone.classList.remove("is-dragover"));
bulkProductDropzone.addEventListener("drop", (event) => {
  event.preventDefault(); bulkProductDropzone.classList.remove("is-dragover");
  const file = event.dataTransfer.files[0];
  if (!file) return;
  try { bulkProductInput.files = event.dataTransfer.files; } catch (e) {}
  showBulkProductFile(file);
});

function renderBulkProductResult(data) {
  const box = $("bulk-product-result");
  const hasErrors = data.errors.length > 0;
  const changed = data.variants_created || data.variants_merged;
  const title = changed
    ? (hasErrors ? "Import complete with a few rows to fix" : "Your products are ready!")
    : "No products were added";
  const summary = `${data.products_created} new product${data.products_created === 1 ? "" : "s"}; ${data.products_merged || 0} old size-product${data.products_merged === 1 ? "" : "s"} grouped into designs. ${data.variants_created} sizes added, ${data.variants_merged || 0} existing sizes kept. ${data.duplicate_rows_merged || 0} duplicate listing rows matched; ${data.free_size_rows || 0} missing-size rows imported as FREE SIZE. ${data.rows_skipped} row${data.rows_skipped === 1 ? "" : "s"} skipped.`;
  const errors = data.errors.length ? `<div class="bulk-row-errors"><strong>Rows to review</strong>${data.errors.map((item) => `<div>Row ${item.row}${item.sku ? ` · ${esc(item.sku)}` : ""}: ${esc(item.message)}</div>`).join("")}${data.errors_truncated ? "<div>More row errors were omitted. Correct these and upload again.</div>" : ""}</div>` : "";
  box.innerHTML = `<div class="bulk-import-result ${hasErrors ? "has-errors" : ""}"><div class="bulk-result-mark"><i class="fa-solid ${changed ? "fa-check" : "fa-triangle-exclamation"}"></i></div><div class="bulk-result-copy"><strong>${title}</strong><p>${summary}</p><div class="bulk-result-numbers"><span class="bulk-result-pill">${data.products_created} new designs</span><span class="bulk-result-pill">${data.variants_created + (data.variants_merged || 0)} sizes grouped</span><span class="bulk-result-pill">${data.blank_rows} blank rows</span></div></div></div>${errors}`;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$("bulk-product-submit").addEventListener("click", async () => {
  if (!bulkProductFile) return;
  const button = $("bulk-product-submit"), box = $("bulk-product-result");
  if (bulkProductFile.size > 12 * 1024 * 1024) {
    box.innerHTML = `<div class="msg error">This file is over 12 MB. Split the workbook and upload it in smaller parts.</div>`;
    return;
  }
  button.disabled = true;
  const original = button.innerHTML;
  button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Importing…`;
  bulkProductDropzone.classList.add("is-loading");
  box.innerHTML = `<p class="hint">Checking sizes and saving products safely…</p>`;
  try {
    const body = new FormData(); body.append("file", bulkProductFile);
    const response = await fetch(`${API}/products/bulk`, { method: "POST", body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Import failed (HTTP ${response.status})`);
    renderBulkProductResult(data);
    bulkProductFile = null;
    bulkProductInput.value = "";
    $("bulk-product-file-title").textContent = "Import finished — choose another file";
    $("bulk-product-file-meta").textContent = "Select a new workbook to start the next import";
    if (data.variants_created || data.variants_merged) {
      playSuccessSound();
      showToast(`${data.products_created} new products; ${data.variants_created} sizes added and ${data.variants_merged || 0} grouped`, "success", 2600);
      $("product-search").value = "";
      window.__keepProductSearch = true;
      await refreshInventoryViews();
    }
  } catch (error) {
    box.innerHTML = `<div class="msg error">${esc(error.message || "Import failed. Check the file and try again.")}</div>`;
  } finally {
    button.innerHTML = original;
    button.disabled = !bulkProductFile;
    bulkProductDropzone.classList.remove("is-loading");
  }
});

// ================================================================ //
// SCAN & RECOUNT  (html5-qrcode: reads both barcodes and QR codes)
// ================================================================ //
let html5QrCode = null;
let scanning = false;
let lastCameraCode = "";
let lastCameraScanAt = 0;

$("scan-toggle").addEventListener("click", () => { scanning ? stopCamera() : startCamera(); });

async function startCamera() {
  const msg = $("scan-msg");
  try {
    // Always cleanly stop an older scanner instance before starting again.
    if (html5QrCode && scanning) {
      await html5QrCode.stop().catch(() => {});
      scanning = false;
    }
    html5QrCode = html5QrCode || new Html5Qrcode("scan-reader");

    const formats = [];
    const F = window.Html5QrcodeSupportedFormats;
    if (F) ["QR_CODE", "CODE_128", "CODE_39", "EAN_13", "EAN_8", "UPC_A", "UPC_E"].forEach((k) => {
      if (F[k] !== undefined) formats.push(F[k]);
    });
    const config = {
      fps: 12,
      qrbox: (vw, vh) => ({
        width: Math.min(Math.floor(vw * 0.82), 420),
        height: Math.min(Math.floor(vh * 0.34), 220)
      }),
      ...(formats.length ? { formatsToSupport: formats } : {})
    };

    // Do NOT force a facingMode constraint. Some Android/Chrome devices
    // expose no "environment" camera and throw OverconstrainedError.
    // We first ask the browser for any usable camera, then give html5-qrcode
    // an actual deviceId when possible. This works with front/rear/USB cameras.
    let cameraCandidates = [];
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API unavailable");
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      probe.getTracks().forEach((track) => track.stop());
    } catch (probeErr) {
      // Permission/security errors are more useful than an opaque constraint error.
      const name = probeErr?.name || "CameraError";
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new Error("Camera permission denied. Allow camera access for this site and reload the page.");
      }
      if (name === "NotFoundError") {
        throw new Error("No camera was found on this device. You can use a scanner gun or Type Instead.");
      }
    }

    try {
      cameraCandidates = await Html5Qrcode.getCameras();
    } catch (_) {
      cameraCandidates = [];
    }

    const rear = cameraCandidates.find((c) => /back|rear|environment|world/i.test(c.label || ""));
    const ordered = [rear, ...cameraCandidates.filter((c) => c && c !== rear)].filter(Boolean);
    let lastErr = null;

    // Try every real camera ID. If a browser rejects one device constraint,
    // immediately try the next one instead of showing an OverconstrainedError.
    for (const cam of ordered) {
      try {
        await html5QrCode.start(
          cam.id,
          config,
          (decodedText) => {
            const code = decodedText.trim().toUpperCase();
            const now = Date.now();
            if (!code || (code === lastCameraCode && now - lastCameraScanAt < 1200)) return;
            lastCameraCode = code;
            lastCameraScanAt = now;
            handleScannedCode(code);
            showToast(`Scanned: ${code}`, "success", 900);
          },
          () => {}
        );
        scanning = true;
        $("scan-toggle").innerHTML = '<i class="fa-solid fa-stop"></i> Stop Camera';
        msg.textContent = `Camera ready — ${rear && cam.id === rear.id ? "rear camera" : "camera"} active. Keep scanning; camera stays on.`;
        msg.className = "msg success";
        return;
      } catch (err) {
        lastErr = err;
        await html5QrCode.stop().catch(() => {});
      }
    }

    // Last fallback: let the library/browser choose any camera without a
    // facingMode/device constraint. This avoids the common OverconstrainedError.
    for (const mode of ["user", "environment"]) {
      try {
        await html5QrCode.start(mode, config, (decodedText) => {
          const code = decodedText.trim().toUpperCase();
          const now = Date.now();
          if (!code || (code === lastCameraCode && now - lastCameraScanAt < 1200)) return;
          lastCameraCode = code;
          lastCameraScanAt = now;
          handleScannedCode(code);
          showToast(`Scanned: ${code}`, "success", 900);
        }, () => {});
        scanning = true;
        $("scan-toggle").innerHTML = '<i class="fa-solid fa-stop"></i> Stop Camera';
        msg.textContent = "Camera ready — keep scanning continuously.";
        msg.className = "msg success";
        return;
      } catch (err) {
        lastErr = err;
        await html5QrCode.stop().catch(() => {});
      }
    }

    throw lastErr || new Error("No compatible camera could be opened.");
  } catch (err) {
    scanning = false;
    const raw = String(err?.message || err || "Camera unavailable");
    const friendly = /OverconstrainedError|constraint/i.test(raw)
      ? "This camera does not support the requested camera mode. Try another camera, or use the scanner gun / Type Instead."
      : raw;
    msg.textContent = `Could not access the camera: ${friendly}`;
    msg.className = "msg error";
  }
}
function stopCamera() {
  if (html5QrCode && scanning) { html5QrCode.stop().catch(() => {}); }
  scanning = false;
  $("scan-toggle").textContent = "Start Camera";
}

// USB/Bluetooth barcode-gun support. Scanner guns behave like a very fast
// keyboard and normally finish with Enter. We only intercept fast input while
// the Scan screen is open, so normal typing elsewhere remains untouched.
let gunBuffer = "", gunStartedAt = 0, gunTimer = null;
document.addEventListener("keydown", (e) => {
  if (!$("view-scan")?.classList.contains("is-active")) return;
  const now = performance.now();
  if (e.key === "Enter") {
    const value = gunBuffer.trim();
    const elapsed = gunStartedAt ? now - gunStartedAt : Infinity;
    if (value && value.length >= 4 && elapsed < 1000) {
      e.preventDefault();
      handleScannedCode(value.toUpperCase());
      showToast(`Scanned: ${value}`, "success", 1000);
    }
    gunBuffer = ""; gunStartedAt = 0;
    return;
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    if (!gunBuffer) gunStartedAt = now;
    if (now - gunStartedAt > 1000) { gunBuffer = ""; gunStartedAt = now; }
    gunBuffer += e.key;
    clearTimeout(gunTimer);
    gunTimer = setTimeout(() => { gunBuffer = ""; gunStartedAt = 0; }, 1300);
  }
});
const manualProductSearch = $("manual-product-search");
const manualProductResults = $("manual-product-results");

function scanStockCard(product, onlyVariantCode = null, includeHeader = true) {
  const variants = (product.variants || []).filter((variant) => !onlyVariantCode || variant.variant_code.toUpperCase() === onlyVariantCode.toUpperCase());
  const photos = [...new Set([...(product.images || []), product.image_path].filter(Boolean))];
  return `<section class="scan-product-card">
    ${includeHeader ? `<header><strong>${esc(product.name)}</strong><span class="sku-tag">${esc(product.sku)}</span></header>` : ""}
    ${product.category ? `<small class="scan-product-category">${esc(product.category)}</small>` : ""}
    ${photos.length ? `<div class="scan-product-photos" aria-label="${esc(product.name)} catalog photos">${photos.map((path, index) => `<img src="${esc(path)}" alt="${esc(product.name)} photo ${index + 1}" loading="lazy">`).join("")}</div>` : ""}
    <div class="scan-size-list">${variants.map((variant) => `<form class="scan-stock-form" data-code="${esc(variant.variant_code)}" data-current="${Number(variant.current_stock)}">
      <span class="size-chip">${esc(variant.size)}</span>
      <span class="scan-current-stock">Current: <b>${Number(variant.current_stock)}</b></span>
      <div class="stock-stepper"><button class="stock-step" type="button" data-step="-1" aria-label="Decrease ${esc(product.name)} size ${esc(variant.size)} count">−</button><input class="input scan-new-count" type="number" min="0" step="1" inputmode="numeric" required value="${Number(variant.current_stock)}" aria-label="Final physical stock count for ${esc(product.name)} size ${esc(variant.size)}"><button class="stock-step" type="button" data-step="1" aria-label="Increase ${esc(product.name)} size ${esc(variant.size)} count">+</button></div>
      <button class="btn-primary scan-stock-save" type="submit">Update</button>
      <small class="scan-stock-feedback" aria-live="polite"></small>
    </form>`).join("") || '<p class="hint">No active sizes are available.</p>'}</div>
  </section>`;
}

function attachScanStockForms(container) {
  container.querySelectorAll(".scan-stock-form").forEach((form) => {
    const input = form.querySelector(".scan-new-count");
    form.querySelectorAll(".stock-step").forEach((step) => step.addEventListener("click", () => {
      const current = Number(input.value || 0), next = Math.max(0, current + Number(step.dataset.step));
      input.value = String(next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }));
    form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector(".scan-stock-save"), feedback = form.querySelector(".scan-stock-feedback");
    const newCount = Number(input.value);
    if (!Number.isInteger(newCount) || newCount < 0) { feedback.textContent = "Enter a whole count of zero or more."; return; }
    const oldCount = Number(form.dataset.current);
    button.disabled = true;
    feedback.textContent = "Saving…";
    try {
      const updated = await apiPost(`${API}/inventory/adjust`, {
        variant_code: form.dataset.code, operation: "set", new_count: newCount,
        expected_current_stock: oldCount, note: "scan and recount"
      });
      form.dataset.current = String(updated.current_stock);
      form.querySelector(".scan-current-stock b").textContent = updated.current_stock;
      input.value = String(updated.current_stock);
      feedback.textContent = "Stock updated.";
      showToast(`${form.dataset.code}: stock updated to ${updated.current_stock}`, "success", 2200);
      await refreshInventoryViews();
    } catch (error) {
      feedback.textContent = error.message || "Update failed. Refresh and try again.";
    } finally { button.disabled = false; }
    });
  });
}

async function searchManualProducts() {
  const query = manualProductSearch.value.trim();
  manualProductResults.hidden = true;
  if (query.length < 2) return;
  manualProductResults.hidden = false;
  manualProductResults.innerHTML = '<div class="manual-product-empty">Searching designs…</div>';
  try {
    const params = new URLSearchParams({ q: query, limit: "12", paged: "true" });
    const page = await getJSON(`${API}/products?${params}`);
    // Ignore a response for an older input value if the user has kept typing.
    if (manualProductSearch.value.trim() !== query) return;
    if (!page.items.length) {
      manualProductResults.innerHTML = '<div class="manual-product-empty">No matching design. Try another name or colour.</div>';
      return;
    }
    manualProductResults.innerHTML = page.items.map((product) => scanStockCard(product)).join("");
    attachScanStockForms(manualProductResults);
  } catch (error) {
    if (manualProductSearch.value.trim() === query) manualProductResults.innerHTML = '<div class="manual-product-empty">Could not search products. Try again.</div>';
  }
}
manualProductSearch.addEventListener("input", debounce(searchManualProducts, 220));
manualProductSearch.addEventListener("focus", () => { if (manualProductSearch.value.trim().length >= 2) searchManualProducts(); });

async function lookupVariant(variantCode) {
  const msg = $("scan-msg"), box = $("scan-result");
  try {
    const product = await getJSON(`${API}/variants/${encodeURIComponent(variantCode)}/product`);
    msg.textContent = "";
    box.hidden = false;
    renderScanProduct(product, variantCode);
  } catch (e) {
    box.hidden = true;
    msg.textContent = `"${variantCode}" not found — check the SKU and size, or add it from Products first.`;
    msg.className = "msg error";
  }
}

function handleScannedCode(scannedValue) {
  const code = String(scannedValue || "").trim().toUpperCase();
  const productQr = code.match(/^(?:PRODUCT|DESIGN):(.+)$/);
  if (productQr) return lookupProduct(productQr[1]);
  return lookupVariant(code);
}

async function lookupProduct(sku) {
  const msg = $("scan-msg"), box = $("scan-result");
  try {
    const product = await getJSON(`${API}/products/${encodeURIComponent(sku)}`);
    msg.textContent = `Product code scanned: ${product.name} · ${product.variants.length} sizes`;
    msg.className = "msg success";
    renderScanProduct(product);
  } catch (error) {
    box.hidden = true;
    msg.textContent = `Product code “${sku}” not found. Check that the design is active.`;
    msg.className = "msg error";
  }
}

function renderScanProduct(product, onlyVariantCode = null) {
  const box = $("scan-result");
  const normalizedVariantCode = String(onlyVariantCode || "").toUpperCase();
  const variants = (product.variants || []).filter((variant) => !normalizedVariantCode || String(variant.variant_code || "").toUpperCase() === normalizedVariantCode);
  box.hidden = false;
  box.innerHTML = `<div class="scan-result-head"><div><h2>${esc(product.name)}</h2><span class="sku-tag">${esc(product.sku)}</span></div><span class="hint">${onlyVariantCode ? "Size barcode · one size" : "Product QR/barcode · all sizes"}</span></div>${scanStockCard({ ...product, variants }, null, false)}`;
  attachScanStockForms(box);
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ================================================================ //
// VISUAL PRODUCT SEARCH — local catalog matching, never changes stock
// ================================================================ //
let visualCameraStream = null;
let visualSelectedFile = null;
let visualPreviewUrl = null;

async function loadVisualSearchStatus() {
  const el = $("visual-runtime-status");
  if (!el) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    el.textContent = attempt ? "Photo search API is starting; retrying…" : "Checking photo search setup…";
    el.className = "visual-runtime-status";
    try {
      const status = await getJSON(`${API}/visual-search/status`);
      el.textContent = status.message;
      const ready = status.index_ready === true && status.status === "ready";
      el.classList.toggle("is-ready", ready);
      el.classList.toggle("is-warning", !ready);
      el.title = [
        `Database: ${status.database}${status.database_url_configured ? " (DATABASE_URL configured)" : " (SQLite fallback; DATABASE_URL missing)"}`,
        `PostgreSQL connected: ${status.postgres_connected ? "yes" : "no"}`,
        `pgvector extension: ${status.pgvector_extension_installed ? "installed" : "missing"}`,
        status.database === "postgresql"
          ? `Photo index: ${status.indexed_photos} / ${status.catalog_photos}${status.index_ready ? " (ready)" : " (not ready)"}`
          : `Local photo matcher: ${status.index_ready ? `ready; ${status.catalog_photos} reference photos` : "no usable photos or development catalog limit exceeded"}`,
        `Model runtime: ${status.runtime_installed ? "installed" : "missing"}; weights loaded: ${status.model_weights_loaded ? "yes" : "no"}`,
        `Private model service: ${status.external_model_service_configured ? "configured" : "not configured"}`,
      ].join("\n");
      return;
    } catch (error) {
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      else {
        const detail = String(error?.message || "");
        el.textContent = detail.includes("502")
          ? "Photo search API is returning 502. The service may be restarting; check Railway deploy/runtime logs and retry."
          : "Photo search setup could not be reached after 3 attempts. Check the Railway app service, then retry.";
        el.classList.add("is-warning");
      }
    }
  }
}

function setVisualMessage(message = "", kind = "") {
  const el = $("visual-scan-msg");
  if (!el) return;
  el.textContent = message;
  el.className = `msg ${kind}`.trim();
}

function stopVisualCamera() {
  visualCameraStream?.getTracks().forEach((track) => track.stop());
  visualCameraStream = null;
  const video = $("visual-camera");
  if (video) video.srcObject = null;
  if ($("visual-camera-wrap")) $("visual-camera-wrap").hidden = true;
  if ($("visual-camera-toggle")) $("visual-camera-toggle").innerHTML = '<i class="fa-solid fa-camera"></i> Open camera';
  if ($("visual-capture")) $("visual-capture").disabled = true;
}

function chooseVisualFile(file) {
  if (!file) return;
  if (!/^image\/(?:jpeg|png|webp)$/i.test(file.type) || file.size > 10 * 1024 * 1024) {
    setVisualMessage("Choose a clear JPG, PNG, or WEBP photo (maximum 10 MB).", "error");
    return;
  }
  visualSelectedFile = file;
  if (visualPreviewUrl) URL.revokeObjectURL(visualPreviewUrl);
  visualPreviewUrl = URL.createObjectURL(file);
  $("visual-preview").src = visualPreviewUrl;
  $("visual-preview-wrap").hidden = false;
  $("visual-results").hidden = true;
  matchVisualProduct();
}

async function toggleVisualCamera() {
  if (visualCameraStream) { stopVisualCamera(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { setVisualMessage("Camera access is unavailable in this browser. Upload a photo instead.", "error"); return; }
  try {
    visualCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    const video = $("visual-camera");
    video.srcObject = visualCameraStream;
    await video.play();
    $("visual-camera-wrap").hidden = false;
    $("visual-camera-toggle").innerHTML = '<i class="fa-solid fa-video-slash"></i> Close camera';
    $("visual-capture").disabled = false;
    setVisualMessage("Center one product in the frame and take a clear photo.");
  } catch (error) {
    stopVisualCamera();
    setVisualMessage(error?.name === "NotAllowedError" ? "Camera permission is blocked. Allow access in browser settings and try again." : "Camera did not start. Upload a photo to search instead.", "error");
  }
}

function captureVisualPhoto() {
  const video = $("visual-camera");
  if (!visualCameraStream || !video?.videoWidth) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  canvas.toBlob((blob) => { if (blob) chooseVisualFile(new File([blob], "visual-product.jpg", { type: "image/jpeg" })); }, "image/jpeg", 0.92);
  stopVisualCamera();
}

async function matchVisualProduct() {
  if (!visualSelectedFile) return;
  const results = $("visual-results");
  setVisualMessage("Comparing with saved product photos…");
  try {
    const data = new FormData(); data.append("file", visualSelectedFile);
    const response = await fetch(`${API}/products/visual-match?limit=5`, { method: "POST", body: data });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = typeof payload.detail === "string" ? payload.detail : "";
      const statusHint = response.status === 502 || response.status === 503
        ? " Check the app's Railway runtime logs and the photo-search setup status above."
        : "";
      if (response.status === 502 || response.status === 503) void loadVisualSearchStatus();
      throw new Error(`${details || `Photo search returned HTTP ${response.status}.`}${statusHint}`);
    }
    if (payload.status === "no_match" || !payload.matches?.length) {
      results.hidden = true;
      setVisualMessage(payload.message || "No catalog photo was similar enough. Try a clear, front-facing photo.", "error");
      return;
    }
    results.hidden = false;
    const ambiguous = payload.status === "ambiguous";
    const title = ambiguous ? "Match is uncertain" : "Strong visual match";
    const hint = ambiguous ? "Suggestions only. Review the photo before opening a design." : "Product identity matched visually; stock is read live from the database.";
    results.innerHTML = `<h3>${title} <span class="hint">${hint}</span></h3><div class="visual-result-grid">${payload.matches.map((match, index) => {
      const product = match.product;
      const stock = (product.variants || []).map((variant) => `<span class="size-chip status-${variant.status}">${esc(variant.size)}: ${variant.status === "UNCOUNTED" ? "—" : esc(variant.current_stock)}</span>`).join("");
      const score = Number(match.similarity);
      const matchPhoto = match.reference_image_path || product.image_path;
      return `<article class="visual-match-card"><div class="visual-match-photo">${matchPhoto ? `<img src="${esc(matchPhoto)}" alt="${esc(product.name)} reference photo">` : ""}</div><div class="visual-match-body"><div><span class="visual-rank">#${index + 1}</span><strong>${esc(product.name)}</strong></div><span class="visual-score">Cosine similarity ${Number.isFinite(score) ? score.toFixed(3) : "—"} · not a probability</span><div class="pcard-sizes">${stock}</div><button type="button" class="btn-secondary visual-open-product" data-sku="${esc(product.sku)}">${ambiguous ? "Review this design" : "Open all sizes"}</button></div></article>`;
    }).join("")}</div>`;
    results.querySelectorAll(".visual-open-product").forEach((button) => button.addEventListener("click", async () => {
      try {
        const product = await getJSON(`${API}/products/${encodeURIComponent(button.dataset.sku)}`);
        switchView("scan");
        renderScanProduct(product);
      } catch (_) { setVisualMessage("Could not open that product.", "error"); }
    }));
    setVisualMessage(payload.message || (ambiguous ? "Review the candidates before opening sizes." : "Review the match before updating stock."), ambiguous ? "error" : "success");
  } catch (error) {
    results.hidden = true;
    loadVisualSearchStatus();
    setVisualMessage(error.message || "Photo search failed. Try another clear photo.", "error");
  }
}

$("visual-camera-toggle")?.addEventListener("click", toggleVisualCamera);
$("visual-capture")?.addEventListener("click", captureVisualPhoto);
$("visual-upload")?.addEventListener("change", (event) => chooseVisualFile(event.target.files?.[0]));
$("visual-clear")?.addEventListener("click", () => {
  visualSelectedFile = null;
  if (visualPreviewUrl) URL.revokeObjectURL(visualPreviewUrl);
  visualPreviewUrl = null;
  $("visual-preview").removeAttribute("src");
  $("visual-preview-wrap").hidden = true;
  $("visual-results").hidden = true;
  setVisualMessage("Choose a photo or take one with the camera.");
});

// ================================================================ //
// BULK STOCK COUNT
// ================================================================ //
function updateBulkDownloadLink() {
  const params = new URLSearchParams();
  if ($("bulk-only-uncounted").checked) params.set("only_uncounted", "true");
  $("bulk-download").href = `${API}/inventory/count-sheet?${params}`;
}
$("bulk-only-uncounted").addEventListener("change", updateBulkDownloadLink);

$("bulk-file-input").addEventListener("change", async () => {
  const input = $("bulk-file-input"), file = input.files[0];
  if (!file) return;
  const box = $("bulk-result");
  box.innerHTML = `<p class="hint">Loading ${esc(file.name)}…</p>`;
  const fd = new FormData(); fd.append("file", file);
  try {
    const res = await fetch(`${API}/inventory/bulk-set`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) { box.innerHTML = `<div class="msg error">${esc(data.detail)}</div>`; return; }
    box.innerHTML = `
      <div class="stat-row">
        <div class="stat-card"><div class="n">${data.updated_count}</div><div class="l">Sizes updated</div></div>
        <div class="stat-card"><div class="n">${data.skipped_blank_count}</div><div class="l">Blank, skipped</div></div>
        <div class="stat-card"><div class="n">${data.not_found_count}</div><div class="l">Code not found</div></div>
        <div class="stat-card"><div class="n">${data.duplicate_rows_ignored}</div><div class="l">Repeat rows ignored</div></div>
      </div>
      ${data.not_found_count ? `<div class="msg error">Not found: ${data.not_found_sample.map(esc).join(", ")}${data.not_found_count > data.not_found_sample.length ? " …" : ""}</div>` : ""}`;
      await refreshInventoryViews();
    showToast(`${data.updated_count} sizes updated`);
  } catch (err) { box.innerHTML = `<div class="msg error">Upload failed: ${esc(err)}</div>`; }
  finally { input.value = ""; }
});

// ================================================================ //
// ORDERS
// ================================================================ //
const ordersPage = { offset: 0, limit: 25 };
const orderLinePageSize = 25;
const uploadResultPage = { offset: 0, limit: 25, data: null, notice: "" };
const orderLinePages = new Map();
const selectedOrderLineIdsByBatch = new Map();
let lastProcessedOrderUploadId = null;
$("refresh-order-readiness")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    ordersPage.offset = 0;
    await loadOrderHistory();
    showToast("Dispatch readiness refreshed from current inventory.");
  } catch (error) {
    showToast(`Could not refresh dispatch readiness: ${error.message || error}`, true);
  } finally { button.disabled = false; }
});
$("retry-order-matches").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  try {
    const result = await apiPost(`${API}/orders/reconcile-unmapped`, {});
    showToast(`${result.matched_lines} order lines matched. Stock was not changed.`, "success", 3200);
    await Promise.all([loadOrderHistory(), loadReorderList(), loadSummary()]);
  } catch (error) {
    showToast(`SKU matching retry failed: ${error.message}`, true);
  } finally { button.disabled = false; }
});
$("orders-prev").addEventListener("click", () => { ordersPage.offset = Math.max(0, ordersPage.offset - ordersPage.limit); loadOrderHistory(); });
$("orders-next").addEventListener("click", () => { ordersPage.offset += ordersPage.limit; loadOrderHistory(); });
function orderBatchSelection(batchId) {
  const id = Number(batchId);
  if (!selectedOrderLineIdsByBatch.has(id)) selectedOrderLineIdsByBatch.set(id, new Set());
  return selectedOrderLineIdsByBatch.get(id);
}
function renderOrderBatchLines(batch) {
  const pageCount = Math.max(1, Math.ceil(batch.lines.length / orderLinePageSize));
  const linePage = Math.min(orderLinePages.get(batch.order_upload_id) || 0, pageCount - 1);
  orderLinePages.set(batch.order_upload_id, linePage);
  const start = linePage * orderLinePageSize;
  const visibleLines = batch.lines.slice(start, start + orderLinePageSize);
  const selection = orderBatchSelection(batch.order_upload_id);
  const selectableLines = visibleLines.filter((line) => line.pending_qty > 0 && line.dispatchable_qty > 0);
  const pageAllSelected = selectableLines.length > 0 && selectableLines.every((line) => selection.has(line.id));
  const rows = visibleLines.map((line) => {
    const canDispatch = line.pending_qty > 0 && line.dispatchable_qty > 0;
    let dispatchLabel = "";
    if (line.status === "SKU_NOT_FOUND") dispatchLabel = `<span class="dispatch-line-waiting">SKU not found · cannot dispatch</span>`;
    else if (line.pending_qty <= 0) dispatchLabel = `<span class="dispatch-line-done"><i class="fa-solid fa-circle-check"></i> Dispatched</span>`;
    else if (line.dispatchable_qty >= line.pending_qty) dispatchLabel = `<span class="dispatch-line-ready"><i class="fa-solid fa-circle-check"></i> Ready · ${line.pending_qty}</span>`;
    else if (line.dispatchable_qty > 0) dispatchLabel = `<span class="dispatch-line-partial">${line.dispatchable_qty} ready · ${line.pending_qty} pending</span>`;
    else dispatchLabel = `<span class="dispatch-line-waiting">Waiting for stock</span>`;
    const lineStatus = line.status === "PARTIALLY_DISPATCHED" ? "Partially dispatched" : line.status.replace(/_/g, " ");
    return `<tr>
      <td class="order-select-cell"><input class="order-line-select" type="checkbox" data-line-id="${line.id}" aria-label="Select ${esc(line.sku)} size ${esc(line.size || "—")}" ${canDispatch ? "" : "disabled"} ${selection.has(line.id) ? "checked" : ""}></td>
      <td class="sku-tag">${esc(line.sku)}</td><td><span class="size-chip">${esc(line.size || "—")}</span></td>
      <td class="hide-sm">${esc(line.product_name || "—")}</td><td class="num">${line.qty_ordered}</td>
      <td class="num">${line.qty_fulfilled || 0}</td><td class="num">${line.pending_qty || 0}</td>
      <td>${dispatchLabel}<div class="hint order-line-status">${esc(lineStatus)}</div></td>
    </tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="grid"><thead><tr><th class="order-select-cell"><label class="order-page-select-label"><input class="order-page-select" type="checkbox" aria-label="Select all ready lines on this page" title="Select all ready lines on this page" ${selectableLines.length ? "" : "disabled"} ${pageAllSelected ? "checked" : ""}><span>All ready</span></label></th><th>SKU</th><th>Size</th><th class="hide-sm">Product</th><th class="num">Orders</th><th class="num">Dispatched</th><th class="num">Pending</th><th>Dispatch status</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${pageCount > 1 ? `<div class="pager order-lines-pager"><button class="btn-secondary pager-btn order-line-prev" type="button" data-id="${batch.order_upload_id}" ${linePage === 0 ? "disabled" : ""}>← Previous</button><span>${start + 1}–${Math.min(start + orderLinePageSize, batch.lines.length)} of ${batch.lines.length}</span><button class="btn-secondary pager-btn order-line-next" type="button" data-id="${batch.order_upload_id}" ${linePage + 1 >= pageCount ? "disabled" : ""}>Next →</button></div>` : ""}`;
}
async function loadOrderHistory() {
  const box = $("order-history");
  if (!box) return;
  try {
    const page = await getJSON(`${API}/orders/history?limit=${ordersPage.limit}&offset=${ordersPage.offset}&paged=true`);
    const batches = page.items;
    const latestBatch = batches.find((batch) => batch.order_upload_id === lastProcessedOrderUploadId);
    if (latestBatch) refreshUploadResultFromHistory(latestBatch);
    if (!batches.length && page.total && ordersPage.offset >= page.total) {
      ordersPage.offset = Math.max(0, Math.floor((page.total - 1) / ordersPage.limit) * ordersPage.limit);
      return loadOrderHistory();
    }
    $("orders-page-info").textContent = batches.length ? `${ordersPage.offset + 1}–${Math.min(ordersPage.offset + batches.length, page.total)} of ${page.total}` : "";
    $("orders-prev").disabled = ordersPage.offset === 0;
    $("orders-next").disabled = ordersPage.offset + batches.length >= page.total;
    $("orders-pager").hidden = page.total <= ordersPage.limit;
    if (!batches.length) {
      box.innerHTML = `<div class="panel"><p class="hint center">No order batches processed yet.</p></div>`;
      return;
    }
    box.innerHTML = `<div class="section-title-row"><h2>Processed Order Batches</h2><span class="hint">Green tick = stock ready · partial dispatch leaves the balance pending</span></div>` + batches.map((b) => {
      const selection = orderBatchSelection(b.order_upload_id);
      const readyLineIds = new Set(b.lines.filter((line) => line.pending_qty > 0 && line.dispatchable_qty > 0).map((line) => line.id));
      for (const lineId of selection) if (!readyLineIds.has(lineId)) selection.delete(lineId);
      const selectedCount = selection.size;
      const readiness = b.pending_count
        ? (b.dispatch_state === "READY" ? "READY TO DISPATCH" : b.dispatch_state === "PARTIAL" ? `PARTIAL · ${b.dispatchable_units} READY` : "WAITING FOR STOCK")
        : b.status;
      const readinessClass = b.pending_count
        ? (b.dispatch_state === "READY" ? "batch-ready" : b.dispatch_state === "PARTIAL" ? "batch-partial" : "batch-waiting")
        : (b.status === "DISPATCHED" ? "batch-done" : "batch-warn");
      return `<div class="order-batch panel" data-upload-id="${b.order_upload_id}">
        <div class="order-batch-head">
          <div><strong>${esc(b.filename || "Order file")}</strong><div class="hint">${new Date(b.uploaded_at).toLocaleString()} · Batch #${b.order_upload_id}</div></div>
          <div class="order-batch-actions"><span class="status-pill ${readinessClass}">${readiness === "READY TO DISPATCH" ? '<i class="fa-solid fa-circle-check"></i> ' : ""}${esc(readiness)}</span><button class="btn-secondary select-all-ready" type="button" data-id="${b.order_upload_id}" ${readyLineIds.size ? "" : "disabled"}><i class="fa-regular fa-square-check"></i> Select All Ready (${readyLineIds.size})</button>${b.pending_count ? `<button class="btn-primary batch-dispatch" type="button" data-id="${b.order_upload_id}" ${b.dispatchable_units ? "" : "disabled"}><i class="fa-solid fa-truck-fast"></i> Dispatch Ready (${b.dispatchable_units})</button>` : ""}${b.pending_count ? `<button class="btn-secondary dispatch-selected" type="button" data-id="${b.order_upload_id}" ${selectedCount ? "" : "disabled"}><i class="fa-regular fa-square-check"></i> Dispatch Selected (${selectedCount})</button>` : ""}<button class="btn-danger batch-delete" type="button" data-id="${b.order_upload_id}" data-filename="${esc(b.filename || "Order file")}"><i class="fa-solid fa-trash-can"></i> Delete batch</button></div>
        </div>
        <div class="order-stats"><span>${b.total_rows} rows</span><span>${b.pending_units} pieces pending</span><span>${b.dispatched_units} pieces dispatched</span><span>${b.dispatchable_units} pieces ready</span><span>${b.not_found_count} not found</span></div>
        <div class="order-lines-content">${renderOrderBatchLines(b)}</div>
      </div>`;
    }).join("");
    box.querySelectorAll(".batch-dispatch").forEach((btn) => btn.addEventListener("click", () => dispatchOrderBatch(Number(btn.dataset.id), true)));
    box.querySelectorAll(".select-all-ready").forEach((btn) => btn.addEventListener("click", () => {
      const uploadId = Number(btn.dataset.id);
      const batch = batches.find((item) => item.order_upload_id === uploadId);
      if (!batch) return;
      const selection = orderBatchSelection(uploadId);
      const readyLines = batch.lines.filter((line) => line.pending_qty > 0 && line.dispatchable_qty > 0);
      const allReadySelected = readyLines.length > 0 && readyLines.every((line) => selection.has(line.id));
      if (allReadySelected) readyLines.forEach((line) => selection.delete(line.id));
      else readyLines.forEach((line) => selection.add(line.id));
      const card = btn.closest(".order-batch");
      if (card) syncBatchOrderSelection(card, card.querySelector(".order-lines-content"), batch);
    }));
    box.querySelectorAll(".dispatch-selected").forEach((btn) => btn.addEventListener("click", () => {
      const uploadId = Number(btn.dataset.id);
      dispatchOrderBatch(uploadId, true, [...orderBatchSelection(uploadId)]);
    }));
    const batchById = new Map(batches.map((batch) => [String(batch.order_upload_id), batch]));
    box.querySelectorAll(".order-batch").forEach((batchElement) => {
      const batch = batchById.get(batchElement.dataset.uploadId);
      if (batch) bindOrderLinePager(batchElement.querySelector(".order-lines-content"), batch, batchElement);
    });
    box.querySelectorAll(".batch-delete").forEach((btn) => btn.addEventListener("click", () => deleteOrderBatch(Number(btn.dataset.id), btn.dataset.filename || "Order file")));
  } catch (e) { box.innerHTML = `<div class="panel"><p class="hint">Could not load order history.</p></div>`; }
}

async function deleteOrderBatch(uploadId, filename) {
  if (!confirm(`Delete batch “${filename}” and all its order lines? This removes its pending reorder demand. If it was dispatched, ${"\n"}the dispatched quantity will be restored to inventory so you can correct the file and process it again.`)) return;
  try {
    const result = await apiDelete(`${API}/orders/${uploadId}`);
    if (lastProcessedOrderUploadId === uploadId) {
      $("upload-result").innerHTML = "";
      lastProcessedOrderUploadId = null;
    }
    showToast(`Batch deleted · ${result.restored_units || 0} dispatched units restored`);
    await loadOrderHistory();
    await refreshInventoryViews();
  } catch (err) { showToast(`Could not delete batch: ${err.message || err}`, true); }
}

function syncBatchOrderSelection(card, content, batch) {
  const selection = orderBatchSelection(batch.order_upload_id);
  const readyLineIds = new Set(batch.lines.filter((line) => line.pending_qty > 0 && line.dispatchable_qty > 0).map((line) => line.id));
  for (const lineId of selection) if (!readyLineIds.has(lineId)) selection.delete(lineId);
  const visible = Math.min(orderLinePages.get(batch.order_upload_id) || 0, Math.max(0, Math.ceil(batch.lines.length / orderLinePageSize) - 1));
  const visibleLines = batch.lines.slice(visible * orderLinePageSize, (visible + 1) * orderLinePageSize);
  const eligible = visibleLines.filter((line) => readyLineIds.has(line.id));
  const selectedVisible = eligible.filter((line) => selection.has(line.id)).length;
  const pageCheckbox = content.querySelector(".order-page-select");
  if (pageCheckbox) {
    pageCheckbox.checked = eligible.length > 0 && selectedVisible === eligible.length;
    pageCheckbox.indeterminate = selectedVisible > 0 && selectedVisible < eligible.length;
  }
  content.querySelectorAll(".order-line-select").forEach((checkbox) => {
    checkbox.checked = selection.has(Number(checkbox.dataset.lineId));
  });
  const dispatchSelected = card.querySelector(".dispatch-selected");
  if (dispatchSelected) {
    dispatchSelected.disabled = selection.size === 0;
    dispatchSelected.innerHTML = `<i class="fa-regular fa-square-check"></i> Dispatch Selected (${selection.size})`;
  }
  const selectAllReady = card.querySelector(".select-all-ready");
  if (selectAllReady) {
    const allReadySelected = readyLineIds.size > 0 && [...readyLineIds].every((lineId) => selection.has(lineId));
    selectAllReady.disabled = readyLineIds.size === 0;
    selectAllReady.innerHTML = allReadySelected
      ? `<i class="fa-regular fa-square-check"></i> Clear Ready Selection`
      : `<i class="fa-regular fa-square-check"></i> Select All Ready (${readyLineIds.size})`;
  }
}

function bindOrderLinePager(content, batch, card) {
  content.querySelectorAll(".order-line-prev, .order-line-next").forEach((btn) => btn.addEventListener("click", () => {
    const delta = btn.classList.contains("order-line-next") ? 1 : -1;
    orderLinePages.set(batch.order_upload_id, Math.max(0, (orderLinePages.get(batch.order_upload_id) || 0) + delta));
    content.innerHTML = renderOrderBatchLines(batch);
    bindOrderLinePager(content, batch, card);
  }));
  const selection = orderBatchSelection(batch.order_upload_id);
  content.querySelector(".order-page-select")?.addEventListener("change", (event) => {
    const linePage = orderLinePages.get(batch.order_upload_id) || 0;
    const visibleLines = batch.lines.slice(linePage * orderLinePageSize, (linePage + 1) * orderLinePageSize);
    visibleLines.filter((line) => line.pending_qty > 0 && line.dispatchable_qty > 0).forEach((line) => {
      if (event.target.checked) selection.add(line.id);
      else selection.delete(line.id);
    });
    syncBatchOrderSelection(card, content, batch);
  });
  content.querySelectorAll(".order-line-select").forEach((checkbox) => checkbox.addEventListener("change", (event) => {
    const lineId = Number(event.target.dataset.lineId);
    if (event.target.checked) selection.add(lineId);
    else selection.delete(lineId);
    syncBatchOrderSelection(card, content, batch);
  }));
  syncBatchOrderSelection(card, content, batch);
}

const dropzone = $("dropzone"), fileInput = $("order-file-input");
dropzone.addEventListener("dragover", (e) => e.preventDefault());
dropzone.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; handleOrderUpload(); } });
fileInput.addEventListener("change", handleOrderUpload);

async function handleOrderUpload() {
  const file = fileInput.files[0];
  if (!file) return;
  const box = $("upload-result");
  box.innerHTML = `<p class="hint">Processing ${esc(file.name)}…</p>`;
  const fd = new FormData(); fd.append("file", file);
  try {
    const res = await fetch(`${API}/orders/upload`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) { box.innerHTML = `<div class="msg error">${esc(data.detail)}</div>`; return; }
    lastProcessedOrderUploadId = data.order_upload_id;
    renderUploadResult(data);
    ordersPage.offset = 0;
    await refreshInventoryViews();
  } catch (err) { box.innerHTML = `<div class="msg error">Upload failed: ${esc(err)}</div>`; }
  finally { fileInput.value = ""; }
}

function renderUploadResult(data) {
  uploadResultPage.data = data;
  uploadResultPage.offset = 0;
  uploadResultPage.notice = "";
  renderUploadResultPage();
}

function refreshUploadResultFromHistory(batch) {
  if (!uploadResultPage.data || batch.order_upload_id !== uploadResultPage.data.order_upload_id) return;
  uploadResultPage.data = {
    ...uploadResultPage.data,
    total_rows: batch.total_rows,
    unique_skus: batch.lines.length,
    pending_count: batch.pending_count,
    not_found_count: batch.not_found_count,
    lines: batch.lines.map((line) => ({
      ...line,
      pending_qty: line.pending_qty,
      dispatchable_qty: line.dispatchable_qty,
    })),
  };
  renderUploadResultPage();
}

function renderUploadResultPage() {
  const data = uploadResultPage.data;
  if (!data) return;
  const lines = data.lines || [];
  const uploadId = Number(data.order_upload_id);
  const selection = orderBatchSelection(uploadId);
  const readyLines = lines.filter((line) => line.pending_qty > 0 && line.dispatchable_qty > 0);
  const readyIds = new Set(readyLines.map((line) => line.id));
  for (const lineId of selection) if (!readyIds.has(lineId)) selection.delete(lineId);
  const pageCount = Math.max(1, Math.ceil(lines.length / uploadResultPage.limit));
  uploadResultPage.offset = Math.min(uploadResultPage.offset, (pageCount - 1) * uploadResultPage.limit);
  const start = uploadResultPage.offset;
  const visibleLines = lines.slice(start, start + uploadResultPage.limit);
  const visibleReady = visibleLines.filter((line) => readyIds.has(line.id));
  const selectedCount = selection.size;
  const pageAllSelected = visibleReady.length > 0 && visibleReady.every((line) => selection.has(line.id));
  const rows = visibleLines.map((line) => {
    const canDispatch = line.pending_qty > 0 && line.dispatchable_qty > 0;
    const status = line.pending_qty <= 0
      ? "Dispatched"
      : line.dispatchable_qty >= line.pending_qty
        ? `Ready · ${line.pending_qty}`
        : line.dispatchable_qty > 0
          ? `${line.dispatchable_qty} ready · ${line.pending_qty} pending`
          : line.status === "SKU_NOT_FOUND" ? "SKU not found" : "Waiting for stock";
    const statusClass = line.pending_qty <= 0 ? "status-OK" : canDispatch ? "status-LOW" : "status-OUT";
    return `<tr>
      <td class="order-select-cell"><input class="upload-line-select" type="checkbox" data-line-id="${line.id}" aria-label="Select ${esc(line.sku)} size ${esc(line.size || "—")}" ${canDispatch ? "" : "disabled"} ${selection.has(line.id) ? "checked" : ""}></td>
      <td class="sku-tag">${esc(line.sku)}</td>
      <td><span class="size-chip">${esc(line.size || "—")}</span></td>
      <td class="name-cell hide-sm" title="${esc(line.product_name || "")}">${esc(line.product_name || "—")}</td>
      <td class="num">${line.qty_ordered}</td><td class="num">${line.qty_fulfilled || 0}</td>
      <td class="num">${line.pending_qty || 0}</td><td class="num">${line.dispatchable_qty || 0}</td>
      <td><span class="status-pill ${statusClass}">${esc(status)}</span></td>
    </tr>`;
  }).join("");
  const pendingUnits = lines.reduce((sum, line) => sum + (Number(line.pending_qty) || 0), 0);
  $("upload-result").innerHTML = `
    ${data.file_note ? `<div class="msg note" style="margin-bottom:10px;">${esc(data.file_note)}</div>` : ""}
    <div class="stat-row">
      <div class="stat-card"><div class="n">${data.unique_skus}</div><div class="l">Sizes in file</div></div>
      <div class="stat-card"><div class="n">${pendingUnits}</div><div class="l">Pieces pending</div></div>
      <div class="stat-card"><div class="n">${data.not_found_count}</div><div class="l">Not found</div></div>
    </div>
    ${uploadResultPage.notice ? `<div class="msg success" style="margin-bottom:10px;">Batch #${uploadId}: ${esc(uploadResultPage.notice)} Stock and readiness were refreshed.</div>` : ""}
    <div class="msg note" style="margin-bottom:10px;">Only checked, counted pieces can dispatch. Any remaining quantity stays pending; add stock and refresh readiness to dispatch again.</div>
    ${data.new_alerts?.length ? `<div class="msg error" style="margin-bottom:10px;">New low-stock alerts: ${data.new_alerts.map(esc).join(", ")}</div>` : ""}
    <div class="order-batch-actions upload-order-actions">
      <button class="btn-secondary upload-select-all-ready" type="button" ${readyLines.length ? "" : "disabled"}><i class="fa-regular fa-square-check"></i> ${selectedCount === readyLines.length && readyLines.length ? "Clear Ready Selection" : "Select All Ready (" + readyLines.length + ")"}</button>
      ${pendingUnits ? `<button class="btn-primary upload-dispatch-ready" type="button" ${readyLines.length ? "" : "disabled"}><i class="fa-solid fa-truck-fast"></i> Dispatch Ready (${readyLines.reduce((sum, line) => sum + line.dispatchable_qty, 0)})</button>` : ""}
      ${pendingUnits ? `<button class="btn-secondary upload-dispatch-selected" type="button" ${selectedCount ? "" : "disabled"}><i class="fa-regular fa-square-check"></i> Dispatch Selected (${selectedCount})</button>` : ""}
    </div>
    <div class="table-wrap"><table class="grid">
      <thead><tr><th class="order-select-cell"><label class="order-page-select-label"><input class="upload-page-select" type="checkbox" aria-label="Select all ready lines on this page" ${visibleReady.length ? "" : "disabled"} ${pageAllSelected ? "checked" : ""}><span>All ready</span></label></th><th>SKU</th><th>Size</th><th class="hide-sm">Product</th><th class="num">Ordered</th><th class="num">Dispatched</th><th class="num">Pending</th><th class="num">Ready</th><th>Dispatch status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pageCount > 1 ? `<div class="pager upload-result-pager"><button class="btn-secondary pager-btn upload-result-prev" type="button" ${start === 0 ? "disabled" : ""}>← Previous</button><span>${start + 1}–${Math.min(start + uploadResultPage.limit, lines.length)} of ${lines.length}</span><button class="btn-secondary pager-btn upload-result-next" type="button" ${start + uploadResultPage.limit >= lines.length ? "disabled" : ""}>Next →</button></div>` : ""}`;
  $("upload-result").querySelector(".upload-result-prev")?.addEventListener("click", () => {
    uploadResultPage.offset = Math.max(0, uploadResultPage.offset - uploadResultPage.limit);
    renderUploadResultPage();
  });
  $("upload-result").querySelector(".upload-result-next")?.addEventListener("click", () => {
    uploadResultPage.offset = Math.min((pageCount - 1) * uploadResultPage.limit, uploadResultPage.offset + uploadResultPage.limit);
    renderUploadResultPage();
  });
  $("upload-result").querySelector(".upload-select-all-ready")?.addEventListener("click", () => {
    const alreadySelected = readyLines.length > 0 && readyLines.every((line) => selection.has(line.id));
    readyLines.forEach((line) => alreadySelected ? selection.delete(line.id) : selection.add(line.id));
    renderUploadResultPage();
  });
  $("upload-result").querySelector(".upload-dispatch-ready")?.addEventListener("click", () => dispatchOrderBatch(uploadId));
  $("upload-result").querySelector(".upload-dispatch-selected")?.addEventListener("click", () => dispatchOrderBatch(uploadId, false, [...selection]));
  $("upload-result").querySelector(".upload-page-select")?.addEventListener("change", (event) => {
    visibleReady.forEach((line) => event.target.checked ? selection.add(line.id) : selection.delete(line.id));
    renderUploadResultPage();
  });
  $("upload-result").querySelectorAll(".upload-line-select").forEach((checkbox) => checkbox.addEventListener("change", (event) => {
    const lineId = Number(event.target.dataset.lineId);
    if (event.target.checked) selection.add(lineId);
    else selection.delete(lineId);
    renderUploadResultPage();
  }));
}

async function dispatchOrderBatch(uploadId, fromHistory = false, lineIds = null) {
  const selectedIds = Array.isArray(lineIds) ? [...new Set(lineIds.map(Number))] : null;
  const selectedOnly = selectedIds !== null;
  const question = selectedOnly
    ? `Dispatch the currently available stock for ${selectedIds.length} selected line(s)? Any unavailable quantity will remain pending.`
    : "Dispatch the counted stock currently available for this batch? Any unavailable quantity will remain pending.";
  if (!selectedIds?.length && selectedOnly) return;
  if (!confirm(question)) return;
  const batchCard = document.querySelector(`.order-batch[data-upload-id="${uploadId}"]`);
  const btn = fromHistory
    ? batchCard?.querySelector(selectedOnly ? ".dispatch-selected" : ".batch-dispatch")
    : $("upload-result")?.querySelector(selectedOnly ? ".upload-dispatch-selected" : ".upload-dispatch-ready");
  if (btn) { btn.disabled = true; btn.textContent = "Dispatching…"; }
  try {
    const request = { method: "POST" };
    if (selectedOnly) {
      request.headers = { "Content-Type": "application/json" };
      request.body = JSON.stringify({ line_ids: selectedIds });
    }
    const res = await fetch(`${API}/orders/${uploadId}/dispatch`, request);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Dispatch failed");
    selectedOrderLineIdsByBatch.delete(uploadId);
    const resultMessage = `${data.dispatched_units} pieces dispatched. ${data.pending_units} pieces remain pending.`;
    showToast(resultMessage);
    if (!fromHistory && lastProcessedOrderUploadId === uploadId) uploadResultPage.notice = resultMessage;
    await refreshInventoryViews();
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = selectedOnly
        ? `<i class="fa-regular fa-square-check"></i> Dispatch Selected (${selectedIds.length})`
        : '<i class="fa-solid fa-truck-fast"></i> Dispatch Ready';
    }
    if (!fromHistory) $("upload-result").insertAdjacentHTML("afterbegin", `<div class="msg error" style="margin-bottom:10px;">${esc(err.message || err)}</div>`);
    else showToast(`Dispatch failed: ${err.message || err}`, true);
  }
}

// ================================================================ //
// REORDER LIST
// ================================================================ //
let reorderPart = "";
$("reorder-prev").addEventListener("click", () => { reorderPage.offset = Math.max(0, reorderPage.offset - reorderPage.limit); loadReorderList(); });
$("reorder-next").addEventListener("click", () => { reorderPage.offset += reorderPage.limit; loadReorderList(); });
$("reorder-part").addEventListener("input", debounce((e) => {
  reorderPart = e.target.value.trim().toUpperCase();
  reorderPage.offset = 0;
  loadReorderList();
}, 250));

const reorderPage = { offset: 0, limit: 50, requestId: 0 };
async function loadReorderList() {
  const body = $("reorder-body");
  const requestId = ++reorderPage.requestId;
  try {
    const params = new URLSearchParams();
    params.set("limit", reorderPage.limit);
    params.set("offset", reorderPage.offset);
    if (reorderPart) params.set("part", reorderPart);
    const page = await getJSON(`${API}/reorder-list?${params}`);
    if (requestId !== reorderPage.requestId) return;
    const exportUrl = `${API}/reorder-list/export${reorderPart ? `?part=${encodeURIComponent(reorderPart)}` : ""}`;
    $("export-reorder").href = exportUrl;
    $("reorder-page-info").textContent = page.total ? `${page.offset + 1}–${Math.min(page.offset + page.items.length, page.total)} of ${page.total} sizes` : "";
    $("reorder-prev").disabled = page.offset === 0;
    $("reorder-next").disabled = page.offset + page.limit >= page.total;
    if (!page.items.length) { body.innerHTML = `<tr><td colspan="6" class="empty">No pending orders to restock right now.</td></tr>`; $("reorder-note").textContent = reorderPart ? `No pending orders for SKU part "${esc(reorderPart)}".` : ""; return; }
    $("reorder-note").textContent = `Restock = pending order quantity minus usable stock. Any existing negative balance is included in the required quantity.`;
    body.innerHTML = page.items.map((i) => `
      <tr class="${i.is_new ? "picklist-new-row" : ""}"><td class="sku-tag">${esc(i.sku)} ${i.is_new ? '<span class="picklist-new-badge">NEW</span>' : ""}</td><td><span class="size-chip">${esc(i.size)}</span></td><td class="num">${i.current_stock < 0 ? `<span class="negative-stock" title="Legacy stock deficit">${Math.abs(i.current_stock)} short</span>` : i.current_stock}</td><td class="num">${i.ordered_qty}</td><td class="num">${i.dispatched_qty || 0}</td><td class="num" style="font-weight:800;">${i.required_qty}</td></tr>`).join("");
  } catch (e) { if (requestId === reorderPage.requestId) body.innerHTML = `<tr><td colspan="6" class="empty">Could not load the picklist.</td></tr>`; }
}

// ================================================================ //
// ALERTS (with inline quick-update)
// ================================================================ //
async function refreshInventoryViews() {
  await Promise.allSettled([loadSummary(), loadInventory(), loadReorderList(), loadAlerts()]);
  if ($("view-products")?.classList.contains("is-active")) await loadLatestProducts();
  if ($("view-dashboard")?.classList.contains("is-active")) await loadMoversChart();
  if ($("view-orders")?.classList.contains("is-active")) await loadOrderHistory();
}

// ---------------- AI assistant (Dograh voice/chat widget) ----------------
// Dograh hosts the agent. We only load its embed script (URL comes from the
// backend so the same build works on every deployment) and tell it which
// page the user is on. The agent reads/changes stock through /api/agent/*.
(async function loadDograhAssistant() {
  try {
    const response = await fetch(`${API}/agent/config`);
    if (!response.ok) return;
    const config = await response.json();
    if (!config.enabled || !config.embed_script_url || document.getElementById("dograh-widget")) return;
    const script = document.createElement("script");
    script.id = "dograh-widget";
    script.src = config.embed_script_url;
    script.async = true;
    script.setAttribute("data-dograh-context", JSON.stringify({
      page_url: window.location.href,
      today: new Date().toISOString().slice(0, 10),
      app: "inventory-management",
    }));
    document.body.appendChild(script);
  } catch (error) { /* the app works fine without the assistant */ }
})();


// ---------------- Init ----------------
const initialView = viewFromLocation();
if (!window.location.hash || !APP_VIEW_NAMES.has(decodeURIComponent(window.location.hash.replace(/^#\/?/, "").split(/[?&]/, 1)[0] || ""))) {
  window.history.replaceState({ view: initialView }, "", `#${encodeURIComponent(initialView)}`);
}
switchView(initialView, { updateUrl: false });
if (initialView !== "dashboard") loadSummary();
