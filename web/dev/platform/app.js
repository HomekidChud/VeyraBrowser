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

/* ---------- boot ---------- */
boot();

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

  $("secretCopy").addEventListener("click", () => copyText($("secretValue").textContent));
  $("secretDone").addEventListener("click", () => { $("secretOverlay").hidden = true; });
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

function showSecret(secret, title) {
  $("secretTitle").textContent = title;
  $("secretValue").textContent = secret;
  $("secretOverlay").hidden = false;
}

/* ---------- usage ---------- */
function renderUsage() {
  const rows = $("usageRows");
  const keys = [];
  for (const w of state.workspaces) for (const k of w.keys || []) keys.push({ ...k, workspace: w });
  const total = keys.reduce((n, k) => n + (k.usage?.requests || 0), 0);
  const last24 = keys.reduce((n, k) => n + (k.usage?.last24h || 0), 0);
  $("usageTotal").textContent = total; $("usage24h").textContent = last24;
  $("usageKeys").textContent = keys.length;
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

/* ---------- errors surfaced globally ---------- */
window.addEventListener("unhandledrejection", e => {
  const err = e.reason;
  if (err instanceof ApiError && err.code === "AUTH_REQUIRED") {
    authToken = ""; localStorage.removeItem("veyra-auth");
    $("portal").hidden = true; $("authShell").hidden = false;
  }
});
