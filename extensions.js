// Veyra extensions: built-in page extensions (run through the page bridge) + developer CSS manifests.
import { $, esc, hostOf, uid, load, save, settings, saveSettings, hooks, toast, openFloating, closeFloating, api, addLog, copyText } from "./core.js";
import { dtCall, isRemote } from "./bridge.js";

let B;
const BUILTIN = [];
const state = () => load("veyra-extensions", {});
const setState = s => { save("veyra-extensions", s); hooks.scheduleSync?.(); };
const isOn = id => !!state()[id];
const devExts = () => load("veyra-dev-extensions", []);
const LEGACY_BUILTIN_IDS = ["dark", "adblock", "focus", "readable", "links", "grayscale", "reader", "stats", "notes", "zoom", "compact"];
const storeCache = { data: null, at: 0, loading: null };
function safeCss(css) {
  const v = String(css ?? "");
  if (!v.trim()) throw new Error("css is required.");
  if (v.length > 120000) throw new Error("CSS is too large (120 KB max).");
  if (/[/]\*[^]*?\*[/]/g.test(v)) { /* comments are fine; keep scanning below */ }
  if (/@import\b|url\s*\(|javascript\s*:|expression\s*\(|-moz-binding|behavior\s*:|@font-face|@namespace\b/i.test(v)) throw new Error("This extension can only contain isolated CSS; imports, URLs, scripts and font/network loaders are blocked.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw new Error("CSS contains unsupported control characters.");
  let depth = 0;
  for (let i = 0; i < v.length; i++) { if (v[i] === "{") depth++; else if (v[i] === "}" && --depth < 0) throw new Error("CSS braces are unbalanced."); }
  if (depth !== 0) throw new Error("CSS braces are unbalanced.");
  return v;
}
function normalizePackage(m, source = "local") {
  if (m && m.schema === "veyra-extension/v1") {
    const files = m.files && typeof m.files === "object" ? m.files : {};
    m = { ...m, css: files["style.css"] ?? "", permissions: Array.isArray(m.permissions) ? m.permissions : [] };
  }
  const v = validateManifest(m);
  return { ...v, source, verified: source === "store" || source === "local", publisher: String(m?.publisher || (source === "store" ? "Veyra Store" : "Local") ).slice(0, 100), author: String(m?.author || "").slice(0, 100) };
}
async function fetchStore(force = false) {
  if (!force && storeCache.data && Date.now() - storeCache.at < 300000) return storeCache.data;
  if (storeCache.loading) return storeCache.loading;
  storeCache.loading = api("/api/extensions/store", { timeoutMs: 12000 }).then(r => { storeCache.data = Array.isArray(r?.extensions) ? r.extensions : []; storeCache.at = Date.now(); return storeCache.data; }).catch(e => { throw new Error(e.message || "Extension store unavailable."); }).finally(() => { storeCache.loading = null; });
  return storeCache.loading;
}
function installExtension(pkg) {
  const v = normalizePackage(pkg, pkg?.source || "store");
  const cur = devExts(); const i = cur.findIndex(x => x.id === v.id);
  const installed = { ...v, enabled: true, installedAt: Date.now() };
  if (i >= 0) cur[i] = installed; else cur.unshift(installed);
  save("veyra-dev-extensions", cur.slice(0, 50)); hooks.scheduleSync?.(); applyAll(); renderExtensions();
  toast(`${v.name} installed`);
}
function clearLegacyBuiltins() {
  const s = state(); let changed = false; for (const id of LEGACY_BUILTIN_IDS) if (id in s) { delete s[id]; changed = true; } if (changed) setState(s);
}

// Match patterns like "*.example.com", "example.com", "<all_urls>".
function matches(ext, url) {
  const list = Array.isArray(ext.matches) && ext.matches.length ? ext.matches : ["<all_urls>"];
  const h = hostOf(url);
  return list.some(p => { p = String(p).trim().toLowerCase(); if (p === "<all_urls>" || p === "*") return true; p = p.replace(/^\*:\/\//, "").replace(/^https?:\/\//, "").replace(/\/.*$/, ""); if (p.startsWith("*.")) { const base = p.slice(2); return h === base || h.endsWith("." + base); } return h === p || h === "www." + p; });
}
export function validateManifest(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error("The manifest must be a JSON object.");
  const id = String(m.id || "").trim(); if (!/^[a-z0-9][a-z0-9-_.]{1,63}$/i.test(id)) throw new Error("id must be 2–64 letters, numbers, dashes or dots.");
  const name = String(m.name || "").trim(); if (!name || name.length > 80) throw new Error("name is required (80 characters max).");
  const forbidden = ["js", "script", "scripts", "content_scripts", "background", "service_worker", "web_accessible_resources", "externally_connectable"];
  for (const k of forbidden) if (m[k]) throw new Error(`Published Veyra extensions cannot use ${k}.`);
  if (m.permissions != null) { const perms = Array.isArray(m.permissions) ? m.permissions.map(x => String(x)) : []; if (perms.some(x => x !== "styles")) throw new Error("Only the styles permission is available to Veyra extensions."); }
  const css = safeCss(m.css ?? m.page_css ?? "");
  const matchesList = m.matches == null ? [] : Array.isArray(m.matches) ? m.matches.map(String).slice(0, 30) : (() => { throw new Error("matches must be an array of host patterns."); })();
  if (matchesList.some(x => x.length > 120 || /[\r\n]/.test(x))) throw new Error("matches contains an invalid host pattern.");
  return { id, name, version: String(m.version || "1.0.0").slice(0, 20), description: String(m.description || "").slice(0, 300), css, matches: matchesList, enabled: m.enabled !== false, installedAt: Date.now() };
}

// Apply everything that's enabled to one tab (called after each page load).
export async function applyToTab(t) {
  if (!t || t.view !== "page" || !t.url) return;
  const s = state();
  const calls = [];
  for (const e of BUILTIN) if (e.feature) { calls.push(["ext.feature", { name: e.feature, on: !!s[e.id] }]); for (const a of e.also || []) if (s[e.id]) calls.push(["ext.feature", { name: a, on: true }]); }
  for (const d of devExts()) calls.push(["ext.css", { key: d.id, css: d.enabled && matches(d, t.url) ? d.css : "" }]);
  if (s.zoom && settings.zoomDefault && settings.zoomDefault !== 1 && t.zoom === 1) { t.zoom = settings.zoomDefault; calls.push(["ext.zoom", { zoom: t.zoom }]); }
  for (const [m, p] of calls) { try { await dtCall(t, m, p, 4000); } catch (e) { if (!/unsupported|timed out/i.test(e.message)) addLog("debug", `Extension call ${m} failed: ${e.message}`); break; } }
  hooks.onExtensionsApplied?.(t);
}
hooks.applyExtensionsToTab = applyToTab;
const applyAll = () => B.state.tabs.forEach(t => applyToTab(t));

async function toggle(id, on) {
  const s = state(); s[id] = on; setState(s);
  const e = BUILTIN.find(x => x.id === id);
  if (e?.server) { settings.blockTrackers = on; saveSettings(); const sid = B.state.session?.id; if (sid) api(`/api/session/${sid}/prefs`, { json: { blockTrackers: on } }).catch(() => {}); }
  if (e?.chrome) document.body.classList.toggle("compact", on || !!settings.compact);
  if (e?.id === "notes" && !on) closeNotes();
  applyAll(); renderExtensions(); B.renderActive({ push: false });
}

// ---------------------------------------------------------------- actions
export async function readerMode(t = B.activeTab()) {
  if (!(t?.view === "page" && t.url)) return toast("Open an article first");
  if (isRemote(t)) return toast("Reader view isn't available in Chromium tabs", { kind: "warn" });
  const box = $("readerView"); box.classList.remove("hidden"); box.innerHTML = `<div class="reader-bar"><span style="margin-right:auto;opacity:.7">Reader view</span><button id="rdClose">Close</button></div><article><p>Preparing…</p></article>`;
  $("rdClose").onclick = closeReader; t.readerOpen = true;
  try {
    const r = await dtCall(t, "ext.reader", {}, 8000);
    const dark = document.documentElement.dataset.theme === "dark";
    box.classList.toggle("dark", dark);
    const words = (r.blocks || []).reduce((n, b) => n + (b.text ? b.text.split(/\s+/).length : 0), 0);
    box.innerHTML = `<div class="reader-bar"><span style="margin-right:auto;opacity:.7">${esc(hostOf(t.url))} · ${Math.max(1, Math.round(words / 230))} min read</span><button id="rdSmaller">A−</button><button id="rdBigger">A+</button><button id="rdTheme">${dark ? "Light" : "Dark"}</button><button id="rdClose">Close</button></div>
      <article><h1>${esc(r.title || t.title)}</h1>${r.byline ? `<div class="byline">${esc(r.byline)}</div>` : ""}${(r.blocks || []).map(b => b.t === "img" ? `<img src="${esc(b.src)}" alt="" loading="lazy" onerror="this.remove()">` : b.t === "h" || /^h[1-6]$/.test(b.t) ? `<h2>${esc(b.text)}</h2>` : b.t === "blockquote" ? `<blockquote>${esc(b.text)}</blockquote>` : b.t === "li" ? `<p>• ${esc(b.text)}</p>` : b.t === "pre" ? `<pre>${esc(b.text)}</pre>` : `<p>${esc(b.text)}</p>`).join("")}</article>`;
    let size = 1.14; const art = box.querySelector("article");
    $("rdSmaller").onclick = () => { size = Math.max(.9, size - .08); art.style.fontSize = size + "rem"; };
    $("rdBigger").onclick = () => { size = Math.min(1.8, size + .08); art.style.fontSize = size + "rem"; };
    $("rdTheme").onclick = () => { box.classList.toggle("dark"); $("rdTheme").textContent = box.classList.contains("dark") ? "Light" : "Dark"; };
    $("rdClose").onclick = closeReader;
  } catch (e) { box.querySelector("article").innerHTML = `<p>Reader view couldn't read this page: ${esc(e.message)}</p>`; }
}
export function closeReader() { const t = B.activeTab(); if (t) t.readerOpen = false; $("readerView").classList.add("hidden"); $("readerView").innerHTML = ""; }
hooks.closeReader = closeReader;
async function pageStats(anchor) {
  const t = B.activeTab(); if (!(t?.view === "page" && t.url)) return toast("Open a website first");
  try {
    const s = await dtCall(t, "ext.stats", {}, 6000);
    const p = $("popover"); p.innerHTML = `<h4>Page stats</h4><p class="pop-sub">${esc(hostOf(t.url))}</p><dl class="kv">${Object.entries(s).map(([k, v]) => `<dt>${esc(k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()))}</dt><dd>${esc(typeof v === "number" ? v.toLocaleString() : v)}</dd>`).join("")}</dl>`;
    openFloating(p, anchor || $("extBtn"));
  } catch (e) { toast(`Couldn't read page stats: ${e.message}`, { kind: "err" }); }
}

// Quick notes side panel
function notesKey(t) { return hostOf(t?.url) || "_"; }
export function openNotes() { const t = B.activeTab(); if (!(t?.view === "page" && t.url)) return toast("Open a website to take notes about it"); t.notesOpen = true; renderSidePanel(t); }
function closeNotes() { B.state.tabs.forEach(t => t.notesOpen = false); $("sidePanel").classList.add("hidden"); }
function renderSidePanel(t) {
  const p = $("sidePanel");
  if (!(t?.view === "page" && t.notesOpen && isOn("notes"))) { p.classList.add("hidden"); return; }
  const notes = load("veyra-notes", {}); const k = notesKey(t);
  p.classList.remove("hidden");
  p.innerHTML = `<header><h3>Notes · ${esc(k)}</h3><div><button class="icon-btn sm" id="noteCopy" title="Copy"><svg><use href="#i-copy"/></svg></button><button class="icon-btn sm" id="noteClose" title="Close"><svg><use href="#i-x"/></svg></button></div></header><textarea id="noteText" placeholder="Notes for ${esc(k)}. Saved automatically."></textarea><small class="muted" style="padding:0 14px 12px" id="noteState">${notes[k] ? `Saved` : ""}</small>`;
  const ta = $("noteText"); ta.value = notes[k] || "";
  let timer; ta.oninput = () => { clearTimeout(timer); $("noteState").textContent = "Saving…"; timer = setTimeout(() => { const n = load("veyra-notes", {}); if (ta.value.trim()) n[k] = ta.value.slice(0, 20000); else delete n[k]; save("veyra-notes", n); hooks.scheduleSync?.(); $("noteState").textContent = "Saved"; }, 400); };
  $("noteClose").onclick = () => { t.notesOpen = false; p.classList.add("hidden"); };
  $("noteCopy").onclick = () => copyText(ta.value);
}
hooks.renderSidePanel = renderSidePanel;

// ---------------------------------------------------------------- UI
function card(e, on, dev = false) {
  return `<article class="ext-card ${on ? "on" : ""}" data-ext="${esc(e.id)}"><div class="ext-top"><span class="ext-ico"><svg><use href="#${e.icon || "i-puzzle"}"/></svg></span><div><h3>${esc(e.name)}</h3><p>${esc(e.desc || e.description || "")}</p></div></div>
    ${e.zoom ? `<label class="field" style="margin:0"><span>Zoom for new pages: <b id="zoomVal">${Math.round((settings.zoomDefault || 1) * 100)}%</b></span><input type="range" min="50" max="200" step="10" value="${Math.round((settings.zoomDefault || 1) * 100)}" id="zoomRange"></label>` : ""}
    ${dev ? `<p class="muted small mono" style="margin:0">${esc(e.version)} · ${esc(e.matches?.length ? e.matches.join(", ") : "all sites")}</p>` : ""}
    <div class="ext-foot">${dev ? `<button class="btn ghost sm" data-edit="${esc(e.id)}">Edit CSS</button><button class="btn ghost sm" data-remove="${esc(e.id)}">Remove</button>` : e.action && on ? `<button class="btn ghost sm" data-run="${esc(e.action)}">${e.action === "reader" ? "Open reader" : e.action === "stats" ? "Show stats" : "Open notes"}</button>` : `<span class="muted small">${e.server ? "Runs on the server + page" : e.chrome ? "Changes Veyra's interface" : "Runs in the page"}</span>`}
      <span class="spacer"></span><input type="checkbox" class="switch" data-toggle="${esc(e.id)}" ${dev ? "data-dev" : ""} ${on ? "checked" : ""} aria-label="Enable ${esc(e.name)}"></div></article>`;
}
export async function renderExtensions() {
  const grid = $("extensionsGrid"); if (!grid) return;
  $("extDevMode").checked = !!settings.extensionDeveloperMode; $("extDevBar").classList.toggle("hidden", !!B?.activeTab?.()?.section && B.activeTab().section === "store" ? true : !settings.extensionDeveloperMode);
  const storeOpen = B?.activeTab?.()?.section === "store";
  const nav = `<div class="ext-dev" style="border-style:solid"><button class="btn ${storeOpen ? "ghost" : ""}" data-ext-view="installed">Installed</button><button class="btn ${storeOpen ? "" : "ghost"}" data-ext-view="store">Store</button><span class="muted small" style="margin-left:auto">Published packages are CSS-only and sandboxed.</span></div>`;
  if (storeOpen) {
    grid.innerHTML = nav + `<div class="empty"><b>Loading Veyra Extension Store…</b><span>Only verified, script-free CSS packages can be installed.</span></div>`;
    try {
      const list = await fetchStore(); const installed = new Set(devExts().map(x => x.id));
      grid.innerHTML = nav + (list.length ? `<div class="ext-grid">${list.map(e => `<article class="ext-card"><div class="ext-top"><span class="ext-ico"><svg><use href="#i-puzzle"/></svg></span><div><h3>${esc(e.name)}</h3><p>${esc(e.description || "")}</p></div></div><p class="muted small mono">${esc(e.version || "1.0.0")} · ${esc(e.publisher || "Veyra Store")} · ${e.verified ? "Verified CSS-only" : "Sandboxed"}</p><div class="ext-foot"><span class="muted small">${esc((e.matches || []).join(", ") || "all sites")}</span><span class="spacer"></span><button class="btn ${installed.has(e.id) ? "ghost" : ""} sm" data-install-store="${esc(e.id)}">${installed.has(e.id) ? "Reinstall" : "Install"}</button></div></article>`).join("")}</div>` : `<div class="empty"><b>No published extensions yet</b><span>Developer mode can load a verified CSS package for testing.</span></div>`);
    } catch (e) { grid.innerHTML = nav + `<div class="empty"><b>Extension Store unavailable</b><span>${esc(e.message)}</span><button class="btn ghost sm" data-ext-refresh>Retry</button></div>`; }
    return;
  }
  const s = state(); const dev = devExts();
  grid.innerHTML = nav + (dev.length ? dev.map(d => card({ ...d, icon: "i-code" }, d.enabled, true)).join("") : `<div class="empty"><b>No installed extensions</b><span>Open the Store to install verified CSS extensions, or enable Developer mode to load your own package.</span></div>`);
  grid.onchange = e => {
    const sw = e.target.closest("[data-toggle]");
    if (sw) { const list = devExts(); const d = list.find(x => x.id === sw.dataset.toggle); if (d) { d.enabled = sw.checked; save("veyra-dev-extensions", list); hooks.scheduleSync?.(); applyAll(); renderExtensions(); } return; }
    if (e.target.id === "zoomRange") { settings.zoomDefault = Number(e.target.value) / 100; saveSettings(); }
  };
  grid.oninput = e => { if (e.target.id === "zoomRange") $("zoomVal").textContent = e.target.value + "%"; };
  grid.onclick = async e => {
    const navBtn = e.target.closest("[data-ext-view]"); if (navBtn) { if (navBtn.dataset.extView === "store") B.openInternal("extensions", { section: "store" }); else B.openInternal("extensions", { section: "" }); return; }
    const inst = e.target.closest("[data-install-store]"); if (inst) { try { const list = await fetchStore(); const pkg = list.find(x => x.id === inst.dataset.installStore); if (!pkg) throw new Error("Extension is no longer published."); const checked = await api("/api/extensions/verify", { method: "POST", json: { ...pkg } }); if (!checked?.safe) throw new Error(checked?.reason || "Extension package failed security validation."); installExtension(pkg); } catch (err) { toast(err.message, { kind: "err", ms: 6000 }); } return; }
    if (e.target.closest("[data-ext-refresh]")) { await fetchStore(true).catch(() => {}); renderExtensions(); return; }
    const r = e.target.closest("[data-run]"); if (r) { runAction(r.dataset.run, r); return; }
    const rm = e.target.closest("[data-remove]"); if (rm) { const list = devExts().filter(x => x.id !== rm.dataset.remove); save("veyra-dev-extensions", list); hooks.scheduleSync?.(); B.state.tabs.forEach(t => t.view === "page" && dtCall(t, "ext.css", { key: rm.dataset.remove, css: "" }).catch(() => {})); renderExtensions(); return; }
    const ed = e.target.closest("[data-edit]"); if (ed) { const list = devExts(); const d = list.find(x => x.id === ed.dataset.edit); const { promptDialog } = await import("./core.js"); const res = await promptDialog({ title: `Edit ${d.name}`, fields: [{ name: "css", label: "CSS", type: "textarea", value: d.css }, { name: "matches", label: "Sites (comma separated, blank for all)", value: (d.matches || []).join(", ") }] }); if (!res) return; try { const v = normalizePackage({ ...d, css: res.css, matches: res.matches.split(",").map(x => x.trim()).filter(Boolean) }, d.source || "local"); Object.assign(d, v); save("veyra-dev-extensions", list); hooks.scheduleSync?.(); applyAll(); renderExtensions(); toast("Extension updated"); } catch (err) { toast(err.message, { kind: "err" }); } }
  };
}

hooks.renderExtensions = renderExtensions;
function runAction(a, anchor) { closeFloating(); if (a === "reader") readerMode(); else if (a === "stats") pageStats(anchor); else if (a === "notes") openNotes(); }
function openPuzzle() {
  const s = state(); const t = B.activeTab(); const onPage = t?.view === "page" && !!t.url;
  const p = $("popover");
  p.innerHTML = `<h4>Extensions</h4><p class="pop-sub">${onPage ? `Acting on ${esc(hostOf(t.url))}` : "Install verified CSS-only extensions from the Veyra Store."}</p>
    ${devExts().map(d => `<div class="ext-pop-row"><span class="ext-ico" style="width:30px;height:30px;border-radius:9px"><svg style="width:16px;height:16px"><use href="#i-code"/></svg></span><div class="n"><b>${esc(d.name)}</b><small>${t?.url && matches(d, t.url) ? "Runs on this site" : "Not for this site"}</small></div></div>`).join("")}
    <div style="margin-top:10px;display:grid;gap:8px"><button class="btn ghost sm block" data-go="/extensions/store">Open extension store</button><button class="btn ghost sm block" data-go="/extensions">Manage installed</button></div>`;
  p.onchange = e => { const sw = e.target.closest("[data-toggle]"); if (sw) { toggle(sw.dataset.toggle, sw.checked); setTimeout(openPuzzle, 0); } };
  p.onclick = e => { const r = e.target.closest("[data-run]"); if (r) runAction(r.dataset.run, $("extBtn")); if (e.target.closest("[data-go]")) closeFloating(); };
  openFloating(p, $("extBtn"));
}
async function loadManifestFile(file) {
  try {
    if (file.size > 180000) throw new Error("That package is too large.");
    const raw = JSON.parse(await file.text()); const list = Array.isArray(raw) ? raw : [raw];
    const checked = [];
    for (const x of list) { const v = normalizePackage(x, "local"); const r = await api("/api/extensions/verify", { method: "POST", json: x }); if (!r?.safe) throw new Error(r?.reason || `Extension ${v.id} failed security validation.`); checked.push(v); }
    const cur = devExts(); for (const v of checked) { const i = cur.findIndex(c => c.id === v.id); const installed = { ...v, enabled: true, installedAt: Date.now() }; if (i >= 0) cur[i] = installed; else cur.unshift(installed); }
    save("veyra-dev-extensions", cur.slice(0, 50)); hooks.scheduleSync?.(); applyAll(); renderExtensions(); toast(`Installed ${checked.length} extension${checked.length === 1 ? "" : "s"}`);
  } catch (e) { toast(`Couldn't install package: ${e.message}`, { kind: "err", ms: 6000 }); }
}

export function initExtensions(b) {
  B = b; clearLegacyBuiltins();
  $("extBtn").onclick = () => $("popover").classList.contains("hidden") ? openPuzzle() : closeFloating();
  $("extDevMode").onchange = e => { settings.extensionDeveloperMode = e.target.checked; saveSettings(); renderExtensions(); };
  $("loadExtensionBtn").onclick = () => $("extensionFile").click();
  $("extensionFile").onchange = e => { const f = e.target.files?.[0]; if (f) loadManifestFile(f); e.target.value = ""; };
  $("exportExtensionsBtn").onclick = () => { const packages = devExts().map(({ installedAt, source, verified, publisher, author, ...x }) => ({ schema: "veyra-extension/v1", id: x.id, name: x.name, version: x.version, description: x.description, author, publisher, permissions: ["styles"], matches: x.matches, files: { "style.css": x.css }, published: false })); const blob = new Blob([JSON.stringify(packages.length === 1 ? packages[0] : packages, null, 2)], { type: "application/json" }); const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "veyra-extension-packages.json" }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  renderExtensions();
}
export { BUILTIN };
