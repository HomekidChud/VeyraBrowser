// Veyra Developer Platform portal.
// Static ES module following the VeyraBrowser conventions: no build step,
// versioned query imports (see index.html), and the same request/auth pattern
// as `api()` in web/src/core.js — a Bearer session token from localStorage
// ("veyra-auth"), JSON envelopes, and { error, code } error payloads.
"use strict";

const API = (document.querySelector('meta[name="veyra-api"]')?.content || "https://veyraserver-xscy.onrender.com").replace(/\/$/, "");
const $ = id => document.getElementById(id);

class ApiError extends Error {
  constructor(message, status = 0, code = "API_ERROR") { super(message); this.status = status; this.code = code; }
}

/* ---------- auth: reuse the main app's stored session (same origin) ---------- */
const readAuth = () => { try { return JSON.parse(localStorage.getItem("veyra-auth") || "null"); } catch { return null; } };
let authToken = readAuth()?.token || "";

function api(path, options = {}) {
  const method = String(options.method || (options.json !== undefined ? "POST" : "GET")).toUpperCase();
  const headers = new Headers(options.headers || {});
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  let body = options.body;
  if (options.json !== undefined) { headers.set("content-type", "application/json"); body = JSON.stringify(options.json); }
  return fetch(API + path, { method, headers, body, credentials: "omit", cache: "no-store" })
    .then(async r => {
      const text = await r.text();
      let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
      if (!r.ok) throw new ApiError(data?.error || (typeof data === "string" ? data.slice(0, 200) : `HTTP ${r.status}`), r.status, data?.code || "HTTP_ERROR");
      return data;
    });
}

/* ---------- tiny helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const timeAgo = t => { if (!t) return "never"; const d = (Date.now() - new Date(t).getTime()) / 1000; if (d < 60) return "just now"; if (d < 3600) return `${Math.floor(d / 60)} min ago`; if (d < 86400) return `${Math.floor(d / 3600)} h ago`; return new Date(t).toLocaleDateString(); };
let toastTimer = null;
function toast(message, isErr = false) {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = message; el.classList.toggle("err", isErr);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 3600);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); }
  catch { toast("Copy failed — select the text manually", true); }
}

/* ---------- state ---------- */
const state = { overview: null, workspaces: [], selectedWorkspaceId: "" };

/* ---------- boot ----------
   boot() is invoked at the END of the module: it wires the playground and
   reference UI, which read the V1_ENDPOINTS catalog declared further down —
   calling it before those const declarations are evaluated throws a
   temporal-dead-zone ReferenceError and leaves the portal on "Loading…". */
async function boot() {
  wireEvents();
  if (authToken) {
    try { await api("/api/auth/me"); return await openPortal(); }
    catch { /* stale token — fall through to the sign-in card */ }
  }
  $("authShell").hidden = false;
}

function wireEvents() {
  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const status = $("loginStatus"), button = $("loginButton");
    button.disabled = true; status.textContent = "Signing in…"; status.className = "status-line";
    try {
      const r = await api("/api/auth/login", { json: { email: $("loginEmail").value.trim(), password: $("loginPassword").value } });
      authToken = r.token;
      localStorage.setItem("veyra-auth", JSON.stringify({ token: r.token, user: r.user }));
      status.textContent = ""; await openPortal();
    } catch (err) {
      status.textContent = err.message; status.className = "status-line err";
    } finally { button.disabled = false; }
  });
  $("signOutButton").addEventListener("click", () => {
    localStorage.removeItem("veyra-auth"); authToken = ""; location.reload();
  });

  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", String(t === tab)));
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${tab.dataset.view}`));
    if (tab.dataset.view === "usage") renderUsage();
  }));

  $("workspaceForm").addEventListener("submit", onCreateWorkspace);
  $("billingForm").addEventListener("submit", onSaveBilling);
  $("keyForm").addEventListener("submit", onCreateKey);
  $("keyWorkspace").addEventListener("change", e => { state.selectedWorkspaceId = e.target.value; renderKeys(); });
  $("usageRefresh").addEventListener("click", () => { refreshOverview().then(renderUsage).catch(() => {}); });
  $("waitlistForm").addEventListener("submit", onJoinWaitlist);

  $("secretCopy").addEventListener("click", () => copyText(currentSecret));
  $("secretDone").addEventListener("click", () => { $("secretOverlay").hidden = true; currentSecret = ""; });
  wireSecretEye();
  wirePlayground();
  wireReferenceFilter();
}

/* ---------- portal ---------- */
async function openPortal() {
  $("authShell").hidden = true; $("portal").hidden = false;
  await refreshOverview();
  renderOverview(); renderWorkspaces(); renderKeyWorkspaceOptions(); renderKeys(); renderPlans(); checkWaitlistStatus();
}

async function refreshOverview() {
  const overview = await api("/api/platform/overview");
  state.overview = overview;
  state.workspaces = overview.workspaces || [];
  if (!state.selectedWorkspaceId && state.workspaces.length) state.selectedWorkspaceId = state.workspaces[0].id;
}

/* ---------- overview / billing ---------- */
function renderOverview() {
  const o = state.overview; if (!o) return;
  $("accountEmail").textContent = "";
  $("metricWorkspaces").textContent = state.workspaces.length;
  $("metricWorkspaceLimit").textContent = o.owner ? "unlimited (owner)" : `of ${o.limits.workspaces} allowed`;
  const keys = state.workspaces.flatMap(w => w.keys || []);
  $("metricKeys").textContent = keys.length;
  $("metricRequests24h").textContent = keys.reduce((n, k) => n + (k.usage?.last24h || 0), 0);
  $("metricRequestsTotal").textContent = keys.reduce((n, k) => n + (k.usage?.requests || 0), 0);

  $("accountEmail").textContent = readAuth()?.user?.email || "";
  const plan = o.owner ? "owner" : (o.billing?.status === "configured" ? "developer" : "setup");
  $("planPill").textContent = o.owner ? "Owner" : "Developer";
  $("planPill").className = "pill " + (o.owner ? "ok" : plan === "developer" ? "ok" : "warn");
  $("accountDetails").innerHTML =
    `Signed in as <span class="mono">${esc(readAuth()?.user?.email || "")}</span> · role <span class="mono">${esc(readAuth()?.user?.role || "user")}</span><br>` +
    `Key limits: ${o.owner ? "unlimited" : `${o.limits.keysPerWorkspace} per workspace`}`;

  const b = o.billing || { status: "required" };
  $("billingDetails").innerHTML = o.owner
    ? "Owners and administrators build for free — no billing profile needed."
    : b.status === "configured"
      ? `Billing profile configured (${esc(b.billingEmail || "")}${b.company ? ` · ${esc(b.company)}` : ""}). No payment method is collected during beta.`
      : "A billing profile is required before you can create API keys on the Developer plan.";
  const form = $("billingForm");
  form.hidden = o.owner || b.status === "configured";
  if (!form.hidden) $("billingEmail").value = readAuth()?.user?.email || "";
}

async function onSaveBilling(e) {
  e.preventDefault();
  try {
    await api("/api/platform/billing/setup", { json: { billingEmail: $("billingEmail").value.trim(), company: $("billingCompany").value.trim() } });
    toast("Billing profile saved"); await refreshOverview(); renderOverview();
  } catch (err) { toast(err.message, true); }
}

/* ---------- workspaces ---------- */
function renderWorkspaces() {
  const list = $("workspaceList");
  $("workspaceCount").textContent = state.workspaces.length;
  if (!state.workspaces.length) { list.innerHTML = `<div class="empty">No workspaces yet — create your first above.</div>`; return; }
  list.innerHTML = state.workspaces.map(w => `
    <div class="card" data-id="${esc(w.id)}">
      <div class="card-head">
        <div><b>${esc(w.name)}</b><small><span class="mono">${esc(w.slug)}</span>${w.description ? ` — ${esc(w.description)}` : ""} · ${w.keys.length} active key${w.keys.length === 1 ? "" : "s"}</small></div>
        <div class="card-actions">
          <button class="btn" data-edit="${esc(w.id)}" type="button">Rename</button>
          <button class="btn danger" data-delete="${esc(w.id)}" type="button">Delete</button>
        </div>
      </div>
      <form data-rename="${esc(w.id)}" hidden>
        <div class="field-row">
          <div class="field"><label>Name</label><input name="name" maxlength="80" value="${esc(w.name)}" required></div>
          <div class="field"><label>Description</label><input name="description" maxlength="240" value="${esc(w.description || "")}"></div>
        </div>
        <div class="actions"><button class="btn primary" type="submit">Save</button><button class="btn" type="reset">Cancel</button></div>
      </form>
    </div>`).join("");
  list.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => {
    const form = list.querySelector(`[data-rename="${CSS.escape(btn.dataset.edit)}"]`); form.hidden = !form.hidden;
  }));
  list.querySelectorAll("[data-rename]").forEach(form => form.addEventListener("submit", async e => {
    e.preventDefault();
    const id = form.dataset.rename;
    try {
      await api(`/api/platform/workspaces/${id}`, { method: "PATCH", json: { name: form.elements.name.value, description: form.elements.description.value } });
      toast("Workspace updated"); await refreshOverview(); renderWorkspaces(); renderKeyWorkspaceOptions();
    } catch (err) { toast(err.message, true); }
  }));
  list.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", async () => {
    const w = state.workspaces.find(x => x.id === btn.dataset.delete);
    if (!confirm(`Delete workspace “${w.name}”? Its API keys stop working immediately.`)) return;
    try {
      await api(`/api/platform/workspaces/${btn.dataset.delete}`, { method: "DELETE" });
      toast("Workspace deleted");
      if (state.selectedWorkspaceId === btn.dataset.delete) state.selectedWorkspaceId = "";
      await refreshOverview(); renderWorkspaces(); renderKeyWorkspaceOptions(); renderKeys();
    } catch (err) { toast(err.message, true); }
  }));
}

async function onCreateWorkspace(e) {
  e.preventDefault();
  try {
    await api("/api/platform/workspaces", { json: { name: $("workspaceName").value, description: $("workspaceDescription").value } });
    $("workspaceForm").reset(); toast("Workspace created");
    await refreshOverview(); renderWorkspaces(); renderKeyWorkspaceOptions();
  } catch (err) { toast(err.message, true); }
}

/* ---------- keys ---------- */
function renderKeyWorkspaceOptions() {
  const select = $("keyWorkspace");
  select.innerHTML = state.workspaces.map(w => `<option value="${esc(w.id)}">${esc(w.name)} (${esc(w.slug)})</option>`).join("") || `<option value="">— create a workspace first —</option>`;
  if (state.selectedWorkspaceId && state.workspaces.some(w => w.id === state.selectedWorkspaceId)) select.value = state.selectedWorkspaceId;
  else if (state.workspaces.length) { state.selectedWorkspaceId = state.workspaces[0].id; select.value = state.selectedWorkspaceId; }
  renderKeys();
}

function currentWorkspace() { return state.workspaces.find(w => w.id === state.selectedWorkspaceId) || null; }

function renderKeys() {
  const rows = $("keyRows"), w = currentWorkspace();
  $("keyCount").textContent = w ? w.keys.length : 0;
  if (!w) { rows.innerHTML = `<tr><td colspan="7" class="muted">No workspace selected.</td></tr>`; return; }
  if (!w.keys.length) { rows.innerHTML = `<tr><td colspan="7" class="muted">No active keys in this workspace.</td></tr>`; return; }
  const max = Math.max(1, ...w.keys.map(k => k.usage?.requests || 0));
  rows.innerHTML = w.keys.map(k => `
    <tr data-id="${esc(k.id)}">
      <td><b>${esc(k.name)}</b></td>
      <td class="mono">vyr_live_••••${esc(k.last4 || "????")}</td>
      <td>${k.usage?.requests || 0}</td>
      <td>${k.usage?.last24h || 0}</td>
      <td class="small muted">${timeAgo(k.lastUsedAt)}</td>
      <td class="small muted">${timeAgo(k.createdAt)}</td>
      <td>
        <div class="card-actions">
          <button class="btn" data-rename-key="${esc(k.id)}" type="button">Rename</button>
          <button class="btn" data-rotate-key="${esc(k.id)}" type="button">Rotate</button>
          <button class="btn danger" data-revoke-key="${esc(k.id)}" type="button">Revoke</button>
        </div>
      </td>
    </tr>`).join("");
  rows.querySelectorAll("[data-rename-key]").forEach(btn => btn.addEventListener("click", async () => {
    const k = w.keys.find(x => x.id === btn.dataset.renameKey);
    const name = prompt("New key name:", k.name); if (!name) return;
    try { await api(`/api/platform/workspaces/${w.id}/keys/${k.id}`, { method: "PATCH", json: { name } }); toast("Key renamed"); await refreshOverview(); renderKeys(); }
    catch (err) { toast(err.message, true); }
  }));
  rows.querySelectorAll("[data-rotate-key]").forEach(btn => btn.addEventListener("click", () => rotateKey(w, btn.dataset.rotateKey)));
  rows.querySelectorAll("[data-revoke-key]").forEach(btn => btn.addEventListener("click", async () => {
    const k = w.keys.find(x => x.id === btn.dataset.revokeKey);
    if (!confirm(`Revoke “${k.name}”? Calls with this key start failing immediately.`)) return;
    try { await api(`/api/platform/workspaces/${w.id}/keys/${k.id}`, { method: "DELETE" }); toast("Key revoked"); await refreshOverview(); renderKeys(); }
    catch (err) { toast(err.message, true); }
  }));
}

async function onCreateKey(e) {
  e.preventDefault();
  const w = currentWorkspace(); if (!w) return toast("Create a workspace first", true);
  try {
    const r = await api(`/api/platform/workspaces/${w.id}/keys`, { json: { name: $("keyName").value.trim() } });
    $("keyForm").reset();
    showSecret(r.key, "Your new API key");
    await refreshOverview(); renderKeys();
  } catch (err) { toast(err.message, true); }
}

async function rotateKey(w, keyId) {
  const k = w.keys.find(x => x.id === keyId);
  if (!confirm(`Rotate “${k.name}”? The current secret stops working and a replacement is shown once.`)) return;
  try {
    const r = await api(`/api/platform/workspaces/${w.id}/keys/${keyId}/rotate`, { json: {} });
    showSecret(r.key, "Your replacement API key");
    await refreshOverview(); renderKeys();
  } catch (err) { toast(err.message, true); }
}

/* ---------- secret modal: eye mode ----------
   The raw key is kept in a closure-scoped variable only; the visible
   element shows a masked form until the eye toggle reveals it. Copy
   always uses the real secret. */
let currentSecret = "";
function maskSecret(secret) {
  const i = secret.indexOf("_");
  return i >= 0 ? secret.slice(0, i + 1) + "•".repeat(Math.max(4, secret.length - i - 1)) : "•".repeat(secret.length);
}
function showSecret(secret, title) {
  currentSecret = secret;
  $("secretTitle").textContent = title;
  $("secretEye")?.classList.remove("revealed");
  $("secretValue").textContent = maskSecret(secret);
  $("secretOverlay").hidden = false;
}
function wireSecretEye() {
  const eye = $("secretEye"); if (!eye) return;
  eye.addEventListener("click", () => {
    const revealed = eye.classList.toggle("revealed");
    $("secretValue").textContent = revealed ? currentSecret : maskSecret(currentSecret);
  });
}

/* ---------- usage ---------- */
function renderUsageChart(keys) {
  const wrap = $("usageChartWrap"); if (!wrap) return;
  // Aggregate the rolling 24h byHour buckets across every key.
  const buckets = {};
  for (const k of keys) for (const [hour, n] of Object.entries(k.usage?.byHour || {})) buckets[hour] = (buckets[hour] || 0) + n;
  const hours = [];
  const now = Date.now();
  for (let i = 23; i >= 0; i--) hours.push(new Date(now - i * 3600000).toISOString().slice(0, 13) + ":00:00Z");
  const series = hours.map(h => buckets[h] || 0);
  if (!series.some(n => n > 0)) { wrap.innerHTML = `<div class="empty">No usage yet — create an API key and call the public API.</div>`; return; }
  const max = Math.max(1, ...series);
  const W = 720, H = 160, padB = 22, padT = 10;
  const bw = Math.max(4, Math.floor((W - 20) / series.length) - 3);
  const bars = series.map((n, i) => {
    const x = 10 + i * ((W - 20) / series.length);
    const h = Math.round((n / max) * (H - padB - padT));
    return `<g><rect x="${x.toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${bw}" height="${h}" rx="2" class="chart-bar${n === max ? " peak" : ""}"><title>${hours[i]} — ${n} request${n === 1 ? "" : "s"}</title></rect>${i % 3 === 0 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" class="chart-label">${hours[i].slice(11, 13)}</text>` : ""}</g>`;
  }).join("");
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Requests per hour over the last 24 hours">${bars}</svg>`;
}
function renderUsage() {
  const rows = $("usageRows");
  const keys = [];
  for (const w of state.workspaces) for (const k of w.keys || []) keys.push({ ...k, workspace: w });
  const total = keys.reduce((n, k) => n + (k.usage?.requests || 0), 0);
  const last24 = keys.reduce((n, k) => n + (k.usage?.last24h || 0), 0);
  $("usageTotal").textContent = total; $("usage24h").textContent = last24;
  $("usageKeys").textContent = keys.length;
  renderUsageChart(keys);
  const top = keys.slice().sort((a, b) => (b.usage?.requests || 0) - (a.usage?.requests || 0))[0];
  $("usageTop").textContent = top ? top.name : "—";
  $("usageTopNote").textContent = top ? `vyr_live_••••${top.last4 || "????"}` : "no keys yet";
  if (!keys.length) { rows.innerHTML = `<tr><td colspan="6" class="muted">No usage yet — create an API key and call the public API.</td></tr>`; return; }
  rows.innerHTML = keys.sort((a, b) => (b.usage?.requests || 0) - (a.usage?.requests || 0)).map(k => {
    const req = k.usage?.requests || 0, share = total ? Math.round(req / total * 100) : 0;
    return `<tr>
      <td>${esc(k.workspace.name)}</td>
      <td><b>${esc(k.name)}</b> <span class="mono small muted">••••${esc(k.last4 || "????")}</span></td>
      <td>${req}</td>
      <td><div class="usage-bar"><div class="bar"><i data-share="${share}"></i></div><span>${share}%</span></div></td>
      <td>${k.usage?.last24h || 0}</td>
      <td class="small muted">${timeAgo(k.lastUsedAt)}</td>
    </tr>`;
  }).join("");
  rows.querySelectorAll(".bar i").forEach(el => { el.style.width = `${el.dataset.share}%`; });
}

/* ---------- plans & waitlist ---------- */
function renderPlans() {
  const grid = $("planGrid"), plans = state.overview?.pricing || [];
  if (!plans.length) { grid.innerHTML = `<div class="empty">Plans unavailable.</div>`; return; }
  grid.innerHTML = plans.map(p => `
    <div class="plan${p.id === "owner" && state.overview.owner ? " current" : ""}">
      <b>${esc(p.name)}</b>
      <div class="price">${p.price ? `$${p.price.toFixed(2)}` : "Free"} <small>${esc(p.unit)}</small></div>
      <p class="small muted plan-desc">${esc(p.description)}</p>
      <ul>${p.features.map(f => `<li>${esc(f)}</li>`).join("")}</ul>
      ${p.id === "early_access" ? `<button class="btn plan-cta" type="button" data-plan="early_access">Join early access</button>` : ""}
    </div>`).join("");
  grid.querySelectorAll("[data-plan]").forEach(btn => btn.addEventListener("click", () => {
    $("waitlistPlan").value = btn.dataset.plan;
    document.querySelector('[data-view="plans"]')?.scrollIntoView();
    $("waitlistEmail").focus();
  }));
}

async function onJoinWaitlist(e) {
  e.preventDefault();
  try {
    const r = await api("/api/platform/waitlist", { json: { email: $("waitlistEmail").value.trim(), name: $("waitlistName").value.trim(), plan: $("waitlistPlan").value } });
    $("waitlistForm").reset();
    renderWaitlistEntry(r.entry, r.alreadyJoined ? "You are already on the list." : "You're on the list.");
  } catch (err) { toast(err.message, true); }
}

async function checkWaitlistStatus() {
  const email = readAuth()?.user?.email; if (!email) return;
  try {
    const r = await api(`/api/platform/waitlist/status?email=${encodeURIComponent(email)}`);
    if (r.entry) renderWaitlistEntry(r.entry);
  } catch { /* status lookup is best-effort */ }
}

function renderWaitlistEntry(entry, prefix = "You're on the waitlist.") {
  const status = entry.status === "accepted" ? `<span class="pill ok">accepted</span>` : `<span class="pill">pending</span>`;
  $("waitlistStatus").innerHTML = `${esc(prefix)} ${status} — position #${entry.position ?? "?"}, plan ${esc(entry.plan)}.`;
}

/* ---------- API playground ----------
   Endpoint catalog for the public /api/v1 surface — the single source of
   truth for the endpoint picker, the request sender and the live code
   generator. The pasted key lives in the input only; it is never stored. */
const V1_ENDPOINTS = [
  { id: "status", method: "GET", path: "/api/v1/status", label: "GET /api/v1/status — API status (public)", auth: "none", desc: "API liveness, version and rate limits.", params: [] },
  { id: "verify", method: "GET", path: "/api/v1/verify", label: "GET /api/v1/verify — verify the key", auth: "key", desc: "Key check: identity + usage snapshot.", params: [] },
  { id: "me", method: "GET", path: "/api/v1/me", label: "GET /api/v1/me — key identity", auth: "key", desc: "The key’s workspace, metadata and usage.", params: [] },
  { id: "keys", method: "GET", path: "/api/v1/keys", label: "GET /api/v1/keys — list workspace keys", auth: "key", desc: "The active keys in this key’s workspace.", params: [] },
  { id: "key", method: "GET", path: "/api/v1/keys/:id", label: "GET /api/v1/keys/:id — key detail", auth: "key", desc: "One key’s metadata and usage.", params: [{ name: "id", place: "path", required: true, placeholder: "key UUID from GET /api/v1/keys", example: "c1d2e3f4-…" }] },
  { id: "usage", method: "GET", path: "/api/v1/usage", label: "GET /api/v1/usage — key usage", auth: "key", desc: "Usage totals and per-hour buckets.", params: [] },
  { id: "usage-hours", method: "GET", path: "/api/v1/usage/hours", label: "GET /api/v1/usage/hours — 24 hourly buckets", auth: "key", desc: "Zero-filled hourly buckets for the rolling 24h.", params: [] },
  { id: "search", method: "GET", path: "/api/v1/search", label: "GET /api/v1/search — search the Veyra index", auth: "key", desc: "Search the Veyra index.", params: [{ name: "q", place: "query", required: true, placeholder: "search term", example: "veyra" }, { name: "limit", place: "query", required: false, placeholder: "max results (1-20)", example: "5" }] },
  { id: "suggest", method: "GET", path: "/api/v1/suggest", label: "GET /api/v1/suggest — search suggestions", auth: "key", desc: "Autocomplete suggestions.", params: [{ name: "q", place: "query", required: true, placeholder: "partial term", example: "vey" }] },
  { id: "fetch", method: "POST", path: "/api/v1/fetch", label: "POST /api/v1/fetch — fetch a URL through Veyra", auth: "key", desc: "Fetch any public URL through Veyra’s proxy.", params: [{ name: "url", place: "body", required: true, placeholder: "https://example.com/", example: "https://example.com/" }, { name: "format", place: "body", required: false, placeholder: "text or json", example: "text" }] }
];
function pgEndpoint() { return V1_ENDPOINTS.find(e => e.id === $("pgEndpoint").value) || V1_ENDPOINTS[0]; }
function pgParams() {
  const ep = pgEndpoint(), out = {};
  for (const p of ep.params) {
    const el = document.querySelector(`#pgParams [data-pg-param="${p.name}"]`);
    if (el && el.value.trim()) out[p.name] = el.value.trim();
  }
  return out;
}
function pgBuildRequest() {
  const ep = pgEndpoint(), params = pgParams();
  let path = ep.path;
  for (const [k, v] of Object.entries(params)) if (ep.params.find(p => p.name === k)?.place === "path") path = path.replace(`:${k}`, encodeURIComponent(v));
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (ep.params.find(p => p.name === k)?.place === "query") query.set(k, v);
  const body = {};
  for (const [k, v] of Object.entries(params)) if (ep.params.find(p => p.name === k)?.place === "body") body[k] = v;
  return { ep, url: `${API}${path}${query.toString() ? `?${query}` : ""}`, body: Object.keys(body).length ? body : null, needsKey: ep.auth === "key" };
}
async function pgSend() {
  const { ep, url, body } = pgBuildRequest();
  const key = $("pgKey").value.trim();
  if (ep.auth === "key" && !key) { toast("Paste an API key first — create one in the API keys tab", true); $("pgKey").focus(); return; }
  const started = performance.now();
  $("pgResponseMeta").textContent = "Sending…";
  $("pgResponseBody").textContent = "";
  try {
    const headers = { "content-type": "application/json" };
    if (ep.auth === "key") headers.authorization = `Bearer ${key}`;
    const r = await fetch(url, { method: ep.method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const ms = Math.round(performance.now() - started);
    let data = null; try { data = await r.json(); } catch {}
    $("pgResponseMeta").innerHTML = `<span class="pill ${r.ok ? "ok" : "err"}">${r.status} ${r.statusText || ""}</span> · ${ms} ms`;
    $("pgResponseBody").textContent = JSON.stringify(data, null, 2) || "(empty response)";
  } catch (err) {
    $("pgResponseMeta").textContent = "";
    $("pgResponseBody").textContent = `Request failed: ${err.message}`;
  }
}
function pgCode(lang) {
  const { ep, url, body } = pgBuildRequest();
  const key = $("pgKey").value.trim() || "$VYR_KEY";
  const keyLiteral = key.startsWith("$") ? key : "vyr_live_…"; // never print a real key into samples
  const auth = ep.auth === "key" ? `authorization: Bearer ${keyLiteral}` : "";
  if (lang === "curl") {
    return [`curl -s ${ep.method === "GET" ? "" : `-X ${ep.method} `}"${url}"`,
      auth ? `  -H "authorization: Bearer ${keyLiteral}"` : "",
      body ? `  -H 'content-type: application/json' \\\n  -d '${JSON.stringify(body)}'` : ""].filter(Boolean).join(" \\\n");
  }
  if (lang === "js" || lang === "node") {
    return [`const API = "${API}";`,
      `const key = "${keyLiteral}";`,
      ``,
      `const r = await fetch("${url}", {`,
      `  method: "${ep.method}",`,
      ep.auth === "key" ? `  headers: { authorization: \`Bearer \${key}\`${body ? `, "content-type": "application/json"` : ""} },` : (body ? `  headers: { "content-type": "application/json" },` : ""),
      body ? `  body: JSON.stringify(${JSON.stringify(body)})` : "",
      `});`,
      `console.log(await r.json());`].filter(l => l !== "").join("\n");
  }
  // python
  return [`import requests`, ``, `API = "${API}"`, `key = "${keyLiteral}"`, ``, `r = requests.${ep.method.toLowerCase()}(`,
    `    "${url}",`,
    ep.auth === "key" ? `    headers={"authorization": f"Bearer {key}"},` : "",
    body ? `    json=${JSON.stringify(body).replace(/"(\w+)":/g, '"$1": ')} ,` : "",
    `)`, `print(r.json())`].filter(l => l !== "").join("\n");
}
function pgRenderCode() {
  $("pgCodeCurl").textContent = pgCode("curl");
  $("pgCodeJs").textContent = pgCode("js");
  $("pgCodePython").textContent = pgCode("python");
  $("pgCodeNode").textContent = pgCode("node");
}
function pgRenderParams() {
  const ep = pgEndpoint(), host = $("pgParams");
  host.innerHTML = ep.params.length ? ep.params.map(p => `
    <div class="field"><label for="pgp-${esc(p.name)}">${esc(p.name)} <span class="muted">(${esc(p.place)}${p.required ? ", required" : ", optional"}) — ${esc(p.placeholder)}</span></label>
      <input id="pgp-${esc(p.name)}" data-pg-param="${esc(p.name)}" class="mono" placeholder="${esc(p.example || p.placeholder || "")}"></div>`).join("") : "";
  host.querySelectorAll("input").forEach(el => el.addEventListener("input", pgRenderCode));
}
function wirePlayground() {
  if (!$("pgEndpoint")) return;
  $("pgEndpoint").innerHTML = V1_ENDPOINTS.map(e => `<option value="${esc(e.id)}">${esc(e.label)}</option>`).join("");
  $("pgEndpoint").addEventListener("change", () => { pgRenderParams(); pgRenderCode(); });
  $("pgKey").addEventListener("input", pgRenderCode);
  $("pgSend").addEventListener("click", pgSend);
  $("pgCopyCode").addEventListener("click", () => {
    const active = document.querySelector('[data-code-tabs="playground"] .code-tab.active')?.dataset.lang || "curl";
    copyText(pgCode(active));
  });
  // Eye mode for the pasted key: password field until the eye reveals it.
  $("pgKeyEye").addEventListener("click", () => {
    const input = $("pgKey");
    const revealed = $("pgKeyEye").classList.toggle("revealed");
    input.type = revealed ? "text" : "password";
  });
  pgRenderParams(); pgRenderCode();
}

/* ---------- code tabs (quickstart + playground) ---------- */
function wireCodeTabs() {
  document.querySelectorAll("[data-code-tabs]").forEach(group => {
    group.querySelectorAll(".code-tab").forEach(tab => tab.addEventListener("click", () => {
      group.querySelectorAll(".code-tab").forEach(t => t.classList.toggle("active", t === tab));
      group.querySelectorAll(":scope > .code-block").forEach(block => { block.hidden = block.dataset.lang !== tab.dataset.lang; });
    }));
  });
}

/* ---------- API reference filter ---------- */
function wireReferenceFilter() {
  const input = $("referenceFilter"); if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll("#referenceGroups .endpoint").forEach(el => {
      const hay = `${el.dataset.search || ""} ${el.querySelector("code")?.textContent || ""}`.toLowerCase();
      el.hidden = !!q && !hay.includes(q);
    });
  });
}

/* ---------- errors surfaced globally ---------- */
window.addEventListener("unhandledrejection", e => {
  const err = e.reason;
  if (err instanceof ApiError && err.code === "AUTH_REQUIRED") {
    authToken = ""; localStorage.removeItem("veyra-auth");
    $("portal").hidden = true; $("authShell").hidden = false;
  }
});
wireCodeTabs();

/* boot the portal once every declaration above has been evaluated. */
boot();
