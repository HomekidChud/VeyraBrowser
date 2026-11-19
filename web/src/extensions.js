import { $, esc, hostOf, uid, load, save, settings, saveSettings, hooks, toast, openFloating, closeFloating, api, addLog, copyText, INCOGNITO } from "./core.js?v=8.34.0-actions";
import { dtCall, isRemote } from "./bridge.js?v=8.34.0-actions";
import { parseChromeManifest, buildContentScriptSource, buildBackgroundWorkerSource, matchesUrl, readExtensionFolder, isBinaryPath, FOLDER_LIMITS } from "./extension-manifest.js?v=8.34.0";
import { actionAvailability, actionBadge, extensionPins, pinExtension, safeExtensionIcon } from "./extension-actions.js?v=8.34.0";

let B;
const BUILTIN = [];
const state = () => load("veyra-extensions", {});
const setState = s => { save("veyra-extensions", s); hooks.scheduleSync?.(); };
const isOn = id => !!state()[id];
const devExts = () => load("veyra-dev-extensions", []);
const PINS_KEY = "veyra-extension-pins";
let privatePins = [];
const pins = () => extensionPins(INCOGNITO ? privatePins : load(PINS_KEY, []));
const savePins = list => { if (INCOGNITO) privatePins = list; else save(PINS_KEY, list); };
const LEGACY_BUILTIN_IDS = ["dark", "adblock", "focus", "readable", "links", "grayscale", "reader", "stats", "notes", "zoom", "compact"];
const storeCache = { data: null, at: 0, loading: null };
function safeCss(css) {
  const v = String(css ?? "");
  if (!v.trim()) throw new Error("css is required.");
  if (v.length > 120000) throw new Error("CSS is too large (120 KB max).");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw new Error("CSS contains unsupported control characters.");

  let code = "", depth = 0, quote = "", comment = false;
  const unescape = (input, i) => {
    if (input[i] !== "\\") return [input[i], i + 1];
    const m = input.slice(i + 1).match(/^[0-9a-f]{1,6}[ \t\r\n\f]?/i);
    if (m) return [String.fromCodePoint(parseInt(m[0], 16)), i + 1 + m[0].length];
    return [input[i + 1] || "", i + 2];
  };
  for (let i = 0; i < v.length;) {
    const c = v[i], n = v[i + 1];
    if (comment) { if (c === "*" && n === "/") { comment = false; i += 2; code += " "; } else i++; continue; }
    if (quote) {
      if (c === "\\") { i += 2; continue; }
      if (c === quote) quote = "";
      i++; continue;
    }
    if (c === "/" && n === "*") { comment = true; i += 2; code += " "; continue; }
    if (c === "'" || c === '"') { quote = c; code += " "; i++; continue; }
    if (c === "\\") { const [decoded, next] = unescape(v, i); code += decoded; i = next; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth < 0) throw new Error("CSS braces are unbalanced.");
    code += c; i++;
  }
  if (comment || quote || depth !== 0) throw new Error("CSS braces are unbalanced.");
  const compact = code.toLowerCase();
  if (/@\s*(?:import|font-face|namespace)\b|(?:^|[^\w-])url\s*\(|(?:^|[^\w-])expression\s*\(|(?:^|[^\w-])-moz-binding\s*:|(?:^|[^\w-])behavior\s*:|javascript\s*:/i.test(compact)) {
    throw new Error("This extension can only contain isolated CSS; imports, URLs, scripts and font/network loaders are blocked.");
  }
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
function normalizeUserscript(raw, source = "local") {
  const text = String(raw || "");
  const meta = text.match(/==UserScript==([\s\S]*?)==\/UserScript==/i)?.[1] || "";
  const get = key => meta.match(new RegExp(`^\s*//\s*@${key}\s+(.+)$`, "mi"))?.[1]?.trim() || "";
  if (/^\s*\/\/\s*@(require|resource|connect|ant-include)\b/im.test(meta)) throw new Error("Remote userscript dependencies and network grants are blocked.");
  const name = get("name") || "Unnamed userscript";
  const slug = (get("namespace") + ":" + name).toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || uid();
  const matchesList = [...meta.matchAll(/^\s*\/\/\s*@(?:match|include)\s+(.+)$/gmi)].map(x => x[1].trim()).filter(Boolean).slice(0, 30);
  if (!text.trim() || text.length > 200000) throw new Error("Userscript is empty or exceeds 200 KB.");
  const grants = [...meta.matchAll(/^\s*\/\/\s*@grant\s+(.+)$/gmi)].map(x => x[1].trim()).filter(Boolean);
  const allowedGrants = new Set(["none", "GM_getValue", "GM_setValue", "GM_deleteValue", "GM_listValues", "GM_addStyle"]);
  if (grants.some(x => !allowedGrants.has(x))) throw new Error("This userscript requests an unsupported privilege.");
  return { id: `userscript-${slug}`, name, version: get("version") || "1.0.0", description: "Developer-mode userscript", css: "", script: text, matches: matchesList, grants, runAt: get("run-at") || "document-idle", enabled: true, installedAt: Date.now(), source, verified: false, publisher: "Local userscript", author: get("author") };
}

function normalizeBrowserManifest(manifest, files = {}, source = "browser-manifest") {
  if (!settings.extensionDeveloperMode) throw new Error("Enable Developer mode before importing Chrome or Edge extensions.");
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("The extension manifest must be a JSON object.");
  const filesMap = files && typeof files === "object" && !Array.isArray(files) ? files : {};
  const rec = parseChromeManifest(manifest, filesMap);
  const total = Object.values(filesMap).reduce((n, v) => n + (typeof v === "string" ? v.length : 0), 0);
  if (total > FOLDER_LIMITS.maxTotalKb * 1000) throw new Error(`The Chrome extension bundle is too large (${FOLDER_LIMITS.maxTotalKb} KB max).`);
  return {
    id: rec.id, kind: "chrome", manifestVersion: rec.manifestVersion,
    name: rec.name, version: rec.version, description: rec.description,
    matches: rec.matches, excludeMatches: rec.excludeMatches,
    permissions: rec.permissions, hostPermissions: rec.hostPermissions,
    iconData: rec.iconData || {}, action: rec.action || null,
    warnings: rec.warnings, backgroundKind: rec.background?.kind || null,
    minimumChromeVersion: rec.minimumChromeVersion,
    enabled: true, installedAt: Date.now(), source, verified: false,
    publisher: "Local import", author: rec.author,
    manifest, files: filesMap
  };
}

const chromeCache = new Map();
function chromeRecord(d) {
  if (d?.kind !== "chrome" || !d.manifest) return d;
  const key = `${d.id}:${d.installedAt || 0}`;
  if (!chromeCache.has(key)) {
    try { chromeCache.set(key, parseChromeManifest(d.manifest, d.files || {})); }
    catch (e) { addLog("warn", `Extension ${d.name} failed to load: ${e.message}`); chromeCache.set(key, d); }
  }
  return chromeCache.get(key);
}

const bgWorkers = new Map();
const EXT_STORAGE_KEY = "veyra-ext-storage";
const extMessageListeners = new Set();
function extStorageAll() { return load(EXT_STORAGE_KEY, {}); }
function extStoreArea(id, area) { return extStorageAll()[id]?.[area] || {}; }
function extSaveArea(id, area, value) { const all = extStorageAll(); all[id] = all[id] || {}; all[id][area] = value; save(EXT_STORAGE_KEY, all); hooks.scheduleSync?.(); }
function backgroundStatusOf(id) { return bgWorkers.get(id)?.status || "off"; }
async function deliverExtMessage(d, msg) {
  if (!extMessageListeners.size) return { response: undefined, lastError: { message: "Could not establish connection. Receiving end does not exist." } };
  for (const fn of extMessageListeners) { try { const r = await fn(msg, { id: d.id, name: d.name }); if (r !== undefined) return { response: r }; } catch (e) {} }
  return { response: undefined };
}
function startBackground(d) {
  const rec = chromeRecord(d);
  if (d.kind !== "chrome" || !rec.background || bgWorkers.has(d.id)) return;
  let worker, url;
  try {
    const src = buildBackgroundWorkerSource(rec);
    url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    worker = new Worker(url, rec.background.type === "module" ? { type: "module" } : undefined);
  } catch (e) { bgWorkers.set(d.id, { status: "error", error: e.message }); return; }
  const entry = { worker, url, status: "running", error: "" };
  worker.onmessage = async ev => {
    const m = ev.data; if (!m || !m.__veyraRpc) return;
    let result, error;
    try {
      if (String(m.kind || "").startsWith("storage.")) {
        const area = String(m.kind).startsWith("storage.sync") ? "sync" : "local";
        if (m.kind.endsWith(".get")) result = extStoreArea(d.id, area);
        else if (m.kind.endsWith(".set")) { extSaveArea(d.id, area, { ...extStoreArea(d.id, area), ...(m.payload || {}) }); result = true; }
        else if (m.kind.endsWith(".remove")) { const store = extStoreArea(d.id, area); for (const k of m.payload || []) delete store[k]; extSaveArea(d.id, area, store); result = true; }
        else if (m.kind.endsWith(".clear")) { extSaveArea(d.id, area, {}); result = true; }
        else result = null;
      } else if (m.kind === "sendMessage") result = await deliverExtMessage(d, m.payload);
      else if (m.kind === "tabs.query") result = veyraTabsQuery(m.payload);
      else if (m.kind === "tabs.get") result = veyraTabGet(m.payload);
      else if (m.kind === "tabs.create") result = veyraTabCreate(m.payload);
      else if (m.kind === "tabs.sendMessage") result = await veyraTabSendMessage(d, m.payload);
      else if (m.kind === "scripting.executeScript") result = await veyraExecuteScript(d, m.payload);
      else if (m.kind === "action.getUserSettings") result = { isOnToolbar: pins().includes(d.id) };
      else if (m.kind === "action.getBadgeText" || m.kind === "action.setBadgeText") {
        if (!rec.action) throw new Error("This extension has no declared toolbar action.");
        if (m.payload?.tabId != null) throw new Error("Veyra supports extension-wide badge text, not per-tab badges.");
        if (m.kind === "action.getBadgeText") result = entry.badge || "";
        else {
          if (bgWorkers.get(d.id) !== entry) return;
          const text = actionBadge(m.payload?.text);
          if (text !== entry.badge) {
            entry.badge = text;
            for (const badge of document.querySelectorAll("[data-extension-badge]")) {
              if (badge.dataset.extensionBadge === d.id) badge.textContent = text;
            }
          }
        }
      }
      else result = null;
    } catch (e) { error = e.message; }
    try { worker.postMessage({ __veyraRpcReply: m.__veyraRpc, result, error }); } catch (e) {}
  };
  worker.onerror = e => {
    entry.status = "error"; entry.error = e.message || "background worker crashed";
    addLog("warn", `Extension ${d.name} background failed: ${entry.error}`);
    renderExtensions();
  };
  bgWorkers.set(d.id, entry);
  renderPinnedExtensions();
}
function stopBackground(id) {
  const e = bgWorkers.get(id); if (!e) return;
  try { e.worker.terminate(); } catch {}
  try { URL.revokeObjectURL(e.url); } catch {}
  bgWorkers.delete(id);
}

function fireActionClick(d) {
  const e = bgWorkers.get(d.id);
  if (actionAvailability(d, e?.status)) return false;
  const t = B.activeTab();
  const tab = t ? tabInfo(t, B.state.tabs.indexOf(t)) : {};
  if (t?.view !== "page" || !chromeRecord(d).hostPermissions?.some(pattern => matchesUrl([pattern], t.url))) {
    delete tab.url;
    delete tab.title;
  }
  try { e.worker.postMessage({ __veyraActionClick: true, tab }); return true; } catch { return false; }
}

function tabInfo(t, i) {
  const active = t.id === B.state.activeId;
  return {
    id: t.id, index: i, windowId: 1, active,
    highlighted: active, selected: active, currentWindow: true, lastFocusedWindow: true,
    pinned: !!t.pinned, incognito: INCOGNITO, discarded: false, audible: false, muted: false,
    status: t.loading ? "loading" : "complete",
    title: String(t.title || t.url || ""), url: t.view === "page" ? String(t.url || "") : "",
    favIconUrl: "", width: 0, height: 0
  };
}
function veyraTabsQuery(q) {
  const info = q || {};
  const tabs = B.state.tabs.map(tabInfo);
  return tabs.filter(t => {
    if (info.active === true && !t.active) return false;
    if (info.active === false && t.active) return false;
    if (info.currentWindow === false) return false;
    if (info.pinned === true && !t.pinned) return false;
    if (info.pinned === false && t.pinned) return false;
    if (info.windowId != null && Number(info.windowId) !== 1) return false;
    if (info.url != null) {
      const pats = Array.isArray(info.url) ? info.url : [info.url];
      const hit = pats.some(p => {
        const pat = String(p).replace(/[.+?^${}()|[\\]]/g, "\\$&").replace(/\\*/g, ".*");
        try { return new RegExp(`^${pat}$`).test(t.url) || t.url.includes(String(p)); } catch { return t.url.includes(String(p)); }
      });
      if (!hit) return false;
    }
    if (info.title != null && !String(t.title).toLowerCase().includes(String(info.title).toLowerCase())) return false;
    return true;
  });
}
function veyraTabGet(id) {
  const i = B.state.tabs.findIndex(t => t.id === id);
  if (i < 0) throw new Error(`No tab with id: ${id}`);
  return tabInfo(B.state.tabs[i], i);
}
function veyraTabCreate(props) {
  const p = props || {};
  let url = String(p.url || "");
  if (url && !/^https?:/i.test(url)) throw new Error(`Invalid url: "${url.slice(0, 80)}" — Veyra extensions can only open http(s) pages.`);
  const t = B.newTab({ url, background: p.active === false });
  return tabInfo(t, B.state.tabs.indexOf(t));
}
async function veyraTabSendMessage(d, payload) {
  const p = payload || {};
  const t = B.state.tabs.find(x => x.id === p.tabId && x.view === "page");
  if (!t) return { response: undefined, lastError: { message: `Could not establish connection. Receiving end does not exist.` } };
  const rec = chromeRecord(d);

  const nonce = `msg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const script = `(function(){try{var bus=window.__veyraChromeExtBus;var set=bus&&bus.get(${JSON.stringify(d.id)});if(set){var respond=function(){};set.forEach(function(fn){try{fn(${JSON.stringify(p.message ?? null)},{id:${JSON.stringify(d.id)},tab:null},respond)}catch(e){}})}}catch(e){}})();/*${nonce}*/`;
  await dtCall(t, "ext.script", { key: `${d.id}:${nonce}`, script }, 4000);
  return { response: undefined };
}
async function veyraExecuteScript(d, details) {
  const det = details || {};
  const target = det.target || {};
  let tabs = [];
  if (target.tabId != null) tabs = B.state.tabs.filter(t => t.id === target.tabId && t.view === "page");
  else tabs = B.state.tabs.filter(t => t.view === "page" && matches(d, t.url));
  if (!tabs.length) return [];
  const sources = [];
  for (const f of Array.isArray(det.files) ? det.files : []) {
    const code = d.files?.[String(f)];
    if (typeof code === "string" && !code.startsWith("data:")) sources.push(code);
  }
  if (typeof det.func === "function") {
    sources.push(`(${det.func.toString()})(${(det.args || []).map(a => JSON.stringify(a)).join(",")});`);
  }
  if (!sources.length) throw new Error("executeScript needs target.files or target.func.");
  const nonce = `inj${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await Promise.all(tabs.map(t => dtCall(t, "ext.script", { key: `${d.id}:${nonce}`, script: sources.join("\n;\n") }, 4000).catch(() => {})));
  return [];
}

function readPickedFile(file) {
  return new Promise((resolve, reject) => {
    if (file.size > FOLDER_LIMITS.maxFileKb * 1024) return reject(new Error(`File "${file.name}" is larger than ${FOLDER_LIMITS.maxFileKb} KB.`));
    if (isBinaryPath(file.name)) {
      const r = new FileReader();
      r.onload = () => resolve({ path: file.webkitRelativePath || file.name, dataUrl: String(r.result || "") });
      r.onerror = () => reject(new Error(`Couldn't read "${file.name}".`));
      r.readAsDataURL(file);
    } else {
      const r = new FileReader();
      r.onload = () => resolve({ path: file.webkitRelativePath || file.name, text: String(r.result || "") });
      r.onerror = () => reject(new Error(`Couldn't read "${file.name}".`));
      r.readAsText(file);
    }
  });
}
async function loadUnpackedFolder(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  if (files.length > FOLDER_LIMITS.maxFiles + 50) throw new Error(`Too many files (${files.length}) — pick the extension's own folder.`);
  const entries = [];
  for (const f of files.slice(0, FOLDER_LIMITS.maxFiles + 50)) entries.push(await readPickedFile(f));
  const { manifest, files: bundle, rootPath } = readExtensionFolder(entries);
  const v = normalizeBrowserManifest(manifest, bundle, "unpacked-folder");
  installChrome(v);
  toast(`${v.name} loaded${rootPath ? ` from ${rootPath.replace(/\/$/, "")}/` : " unpacked"}${v.warnings?.length ? ` (${v.warnings.length} warning${v.warnings.length === 1 ? "" : "s"})` : ""}`);
}
function installChrome(extension) {
  const list = devExts();
  const index = list.findIndex(item => item.kind === "chrome" && item.id === extension.id);
  if (index >= 0) {
    stopBackground(extension.id);
    list[index] = extension;
  } else list.unshift(extension);
  const installed = list.slice(0, 50);
  for (const id of bgWorkers.keys()) if (!installed.some(item => item.id === id)) stopBackground(id);
  save("veyra-dev-extensions", installed);
  savePins(pins().filter(id => installed.some(item => item.id === id && item.action)));
  hooks.scheduleSync?.();
  applyAll();
  startBackground(extension);
  renderExtensions();
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

function matches(ext, rawUrl) {
  return matchesUrl(ext.matches, rawUrl, ext.excludeMatches);
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
  if (matchesList.some(x => x.length > 120 || /[\r\n]/.test(x) || !/^(?:<all_urls>|\*|(?:(?:\*|https?):\/\/)?(?:\*\.)?[a-z0-9.-]+(?:\/[^\s]*)?)$/i.test(x))) throw new Error("matches contains an invalid host or URL pattern.");
  return { id, name, version: String(m.version || "1.0.0").slice(0, 20), description: String(m.description || "").slice(0, 300), css, matches: matchesList, enabled: m.enabled !== false, installedAt: Date.now() };
}

export async function applyToTab(t) {
  if (!t || t.view !== "page" || !t.url) return;
  const s = state();
  const calls = [];
  for (const e of BUILTIN) if (e.feature) { calls.push(["ext.feature", { name: e.feature, on: !!s[e.id] }]); for (const a of e.also || []) if (s[e.id]) calls.push(["ext.feature", { name: a, on: true }]); }
  for (const d of devExts()) {
    const active = d.enabled && matches(d, t.url);
    if (d.kind === "chrome") {

      const rec = chromeRecord(d);
      const script = active ? buildContentScriptSource(rec) : "";
      calls.push(["ext.script", { key: d.id, script }]);
      continue;
    }
    calls.push([d.script ? "ext.script" : "ext.css", d.script ? { key: d.id, script: active ? `${d.css ? `GM_addStyle(${JSON.stringify(d.css)});\n` : ""}${d.script}` : "" } : { key: d.id, css: active ? safeCss(d.css) : "" }]);
  }
  if (s.zoom && settings.zoomDefault && settings.zoomDefault !== 1 && t.zoom === 1) { t.zoom = settings.zoomDefault; calls.push(["ext.zoom", { zoom: t.zoom }]); }
  for (const [m, p] of calls) { try { await dtCall(t, m, p, 4000); } catch (e) { if (!/unsupported|timed out/i.test(e.message)) addLog("warn", `Extension ${p.key || m} failed on ${hostOf(t.url)}: ${e.message}`); } }
  hooks.onExtensionsApplied?.(t);
}
hooks.applyExtensionsToTab = applyToTab;
const applyAll = () => B.state.tabs.forEach(t => applyToTab(t));

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

function notesKey(t) { return hostOf(t?.url) || "_"; }
export function openNotes() { const t = B.activeTab(); if (!(t?.view === "page" && t.url)) return toast("Open a website to take notes about it"); t.notesOpen = true; renderSidePanel(t); }
function closeNotes() { B.state.tabs.forEach(t => t.notesOpen = false); $("sidePanel").classList.add("hidden"); }
function renderSidePanel(t) {
  const p = $("sidePanel");
  if (!(t?.view === "page" && t.notesOpen && isOn("notes"))) { p.classList.add("hidden"); return; }
  const temporary = hooks.isEphemeralSession?.();
  const notes = temporary ? { [notesKey(t)]: t.noteDraft } : load("veyra-notes", {});
  const k = notesKey(t);
  p.classList.remove("hidden");
  p.innerHTML = `<header><h3>Notes · ${esc(k)}</h3><div><button class="icon-btn sm" id="noteCopy" title="Copy"><svg><use href="#i-copy"/></svg></button><button class="icon-btn sm" id="noteClose" title="Close"><svg><use href="#i-x"/></svg></button></div></header><textarea id="noteText" placeholder="Notes for ${esc(k)}. Saved automatically."></textarea><small class="muted" style="padding:0 14px 12px" id="noteState">${notes[k] ? `Saved` : ""}</small>`;
  const ta = $("noteText"); ta.value = notes[k] || "";
  const noteState = $("noteState");
  let timer; ta.oninput = () => {
    if (temporary) { t.noteDraft = ta.value.slice(0, 20000); noteState.textContent = "This tab only"; return; }
    clearTimeout(timer); noteState.textContent = "Saving…";
    timer = setTimeout(() => {
      if (hooks.isEphemeralSession?.() || !B.state.tabs.includes(t)) return;
      const n = load("veyra-notes", {});
      if (ta.value.trim()) n[k] = ta.value.slice(0, 20000); else delete n[k];
      save("veyra-notes", n); hooks.scheduleSync?.(); noteState.textContent = "Saved";
    }, 400);
  };
  $("noteClose").onclick = () => { t.notesOpen = false; p.classList.add("hidden"); };
  $("noteCopy").onclick = () => copyText(ta.value);
}
hooks.renderSidePanel = renderSidePanel;

function chromeCardMeta(e) {
  const perm = e.permissions || {};
  const denied = perm.denied || [];
  const chip = (label, kind) => `<span class="ext-tag" ${kind === "ok" ? `style="color:var(--ok)"` : kind === "warn" ? `style="color:#e5484d"` : ""}>${esc(label)}</span>`;
  const chips = [...(perm.granted || []).map(p => chip(p, "ok")), ...(perm.unsupported || []).map(p => chip(p)), ...denied.map(p => chip(`${p} (off)`, "warn"))].join("");
  const bgState = backgroundStatusOf(e.id);
  const bg = e.backgroundKind ? chip(`${e.backgroundKind === "service_worker" ? "service worker" : "background"}: ${bgState}`, bgState === "error" ? "warn" : "ok") : chip("no background");
  return `<div class="ext-tags">${chips}${bg}</div><details class="ext-details"><summary>Compatibility details${e.warnings?.length ? ` (${e.warnings.length})` : ""}</summary>
    <p>Requested hosts: ${esc(e.hostPermissions?.join(", ") || "None")}</p>
    ${e.warnings?.length ? `<ul>${e.warnings.map(warning => `<li>${esc(warning)}</li>`).join("")}</ul>` : "<p>No compatibility warnings at import.</p>"}</details>`;
}
function extensionIcon(e, action = false) {
  const rec = action && e.kind === "chrome" ? chromeRecord(e) : e;
  const icons = [action ? rec?.action?.iconData : null, rec?.iconData];
  for (const set of icons) {
    for (const value of set ? [set[16], set[32], set[48], set[128], ...Object.values(set)] : []) {
      const url = safeExtensionIcon(value);
      if (url) return `<img src="${esc(url)}" alt="">`;
    }
  }
  return '<svg aria-hidden="true"><use href="#i-puzzle"/></svg>';
}
function pinButton(e) {
  const pinned = pins().includes(e.id);
  return `<button type="button" class="btn ghost sm" data-pin-extension="${esc(e.id)}" aria-label="${pinned ? "Unpin" : "Pin"} ${esc(e.name)}" aria-pressed="${pinned}">${pinned ? "Unpin" : "Pin"}</button>`;
}
function runExtension(id) {
  const extension = devExts().find(item => item.id === id);
  if (!extension) return;
  const unavailable = actionAvailability(extension, backgroundStatusOf(id));
  if (unavailable || !fireActionClick(extension)) toast(unavailable || "Extension action could not run", { kind: "warn" });
}
function renderPinnedExtensions() {
  const toolbar = $("pinnedExtensions");
  if (!toolbar) return;
  const list = devExts();
  const focused = document.activeElement?.dataset.runExtension;
  toolbar.innerHTML = pins().map(id => {
    const e = list.find(item => item.id === id);
    if (e?.kind !== "chrome" || !e.action) return "";
    const unavailable = actionAvailability(e, backgroundStatusOf(id));
    const name = `${e.name}${e.action.defaultTitle && e.action.defaultTitle !== e.name ? `: ${e.action.defaultTitle}` : ""}`;
    const label = `${name}${unavailable ? ` (${unavailable})` : ""}`;
    return `<button type="button" class="icon-btn ext-action" title="${esc(label)}" aria-label="${esc(label)}" data-run-extension="${esc(id)}" ${unavailable ? "disabled" : ""}>${extensionIcon(e, true)}<span class="ext-action-badge" data-extension-badge="${esc(id)}">${esc(bgWorkers.get(id)?.badge || "")}</span></button>`;
  }).join("");
  toolbar.hidden = !toolbar.childElementCount;
  if (focused) [...toolbar.children].find(node => node.dataset.runExtension === focused)?.focus();
}
function togglePin(id) {
  try {
    savePins(pinExtension(pins(), id));
    renderPinnedExtensions();
    return true;
  } catch (error) {
    toast(error.message, { kind: "warn" });
    return false;
  }
}
function card(e, on, dev = false) {
  return `<article class="ext-card ${on ? "on" : ""}" data-ext="${esc(e.id)}"><div class="ext-top"><span class="ext-ico">${extensionIcon(e)}</span><div><h3>${esc(e.name)}${e.kind === "chrome" && e.permissions?.denied?.length ? ` <span class="ext-tag" style="color:#e5484d">${e.permissions.denied.length} disabled</span>` : ""}</h3><p>${esc(e.desc || e.description || "")}</p></div></div>
    ${e.zoom ? `<label class="field" style="margin:0"><span>Zoom for new pages: <b id="zoomVal">${Math.round((settings.zoomDefault || 1) * 100)}%</b></span><input type="range" min="50" max="200" step="10" value="${Math.round((settings.zoomDefault || 1) * 100)}" id="zoomRange"></label>` : ""}
    ${dev ? `<p class="muted small mono" style="margin:0">${esc(e.version)} · ${e.kind === "chrome" ? `Chrome MV${e.manifestVersion}${e.source === "unpacked-folder" ? " · unpacked folder" : ""}` : e.script ? "userscript" : "CSS"} · ${esc(e.matches?.length ? e.matches.join(", ") : "all sites")}</p>` : ""}
    ${dev && e.kind === "chrome" ? chromeCardMeta(e) : ""}
    <div class="ext-foot">${dev ? `${e.kind === "chrome" ? "" : `<button class="btn ghost sm" data-edit="${esc(e.id)}">Edit ${e.script ? "script" : "CSS"}</button>`}<button class="btn ghost sm" data-remove="${esc(e.id)}">Remove</button>` : e.action && on ? `<button class="btn ghost sm" data-run="${esc(e.action)}">${e.action === "reader" ? "Open reader" : e.action === "stats" ? "Show stats" : "Open notes"}</button>` : `<span class="muted small">${e.server ? "Runs on the server + page" : e.chrome ? "Changes Veyra's interface" : "Runs in the page"}</span>`}
      ${e.kind === "chrome" && e.action ? pinButton(e) : ""}<span class="spacer"></span><input type="checkbox" class="switch" data-toggle="${esc(e.id)}" ${dev ? "data-dev" : ""} ${on ? "checked" : ""} aria-label="Enable ${esc(e.name)}"></div></article>`;
}
export async function renderExtensions() {
  const grid = $("extensionsGrid"); if (!grid) return;
  renderPinnedExtensions();
  $("extDevMode").checked = !!settings.extensionDeveloperMode; $("extDevBar").classList.toggle("hidden", !!B?.activeTab?.()?.section && B.activeTab().section === "store" ? true : !settings.extensionDeveloperMode);
  const storeOpen = B?.activeTab?.()?.section === "store";
  const nav = `<div class="ext-dev" style="border-style:solid"><button class="btn ${storeOpen ? "ghost" : ""}" data-ext-view="installed">Installed</button><button class="btn ${storeOpen ? "" : "ghost"}" data-ext-view="store">Store</button><span class="muted small" style="margin-left:auto">Published packages are CSS-only and sandboxed.</span></div>`;
  if (storeOpen) {
    grid.innerHTML = nav + `<div class="empty"><b>Loading Veyra Extension Store…</b><span>Only verified, script-free CSS packages can be installed.</span></div>`;
    try {
      const list = await fetchStore(); const installed = new Set(devExts().map(x => x.id));
      const categories = [...new Set(list.map(e => e.category || "other"))].sort();
      const catLabels = { reading: "Reading", accessibility: "Accessibility", appearance: "Appearance", social: "Social", privacy: "Privacy", media: "Media", developer: "Developer", typography: "Typography", other: "Other" };
      const featured = list.filter(e => e.rating >= 4.7).sort((a, b) => (b.installs || 0) - (a.installs || 0)).slice(0, 3);
      const stars = n => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
      const catCounts = {};
      list.forEach(e => { const c = e.category || "other"; catCounts[c] = (catCounts[c] || 0) + 1; });
      grid.innerHTML = nav + `
        <div class="ext-store-header">
          <div class="ext-store-title"><h2>Veyra Extension Store</h2><p>${list.length} verified CSS-only extensions · sandboxed and script-free</p></div>
          <input class="input" id="extSearch" placeholder="Search extensions…" style="max-width:300px">
        </div>
        <div class="ext-store-layout">
          <div class="ext-store-sidebar">
            <h4>Categories</h4>
            <button class="ext-cat-btn active" data-cat="all">All <span class="count">${list.length}</span></button>
            ${categories.map(c => `<button class="ext-cat-btn" data-cat="${esc(c)}">${catLabels[c] || c} <span class="count">${catCounts[c] || 0}</span></button>`).join("")}
          </div>
          <div class="ext-store-main">
            ${featured.length ? `<div class="ext-featured"><h3>Featured</h3><div class="ext-featured-grid">${featured.map(e => `<article class="ext-card featured" data-install-store="${esc(e.id)}"><div class="ext-top"><span class="ext-ico featured-ic"><svg><use href="#i-puzzle"/></svg></span><div><h3>${esc(e.name)}</h3><p>${esc(e.description || "")}</p></div></div><div class="ext-meta"><span class="ext-rating">${stars(e.rating)}</span><span class="muted small">${(e.installs || 0).toLocaleString()} installs</span></div><div class="ext-tags">${(e.tags || []).slice(0, 3).map(t => `<span class="ext-tag">${esc(t)}</span>`).join("")}</div><div class="ext-foot"><span class="muted small">${esc(e.version || "1.0.0")} · ${esc(e.publisher || "Veyra Store")}</span><span class="spacer"></span><button class="btn ${installed.has(e.id) ? "ghost" : "primary"} sm">${installed.has(e.id) ? "Reinstall" : "Install"}</button></div></article>`).join("")}</div></div>` : ""}
            <div class="ext-grid" id="extGridList">${list.map(e => `<article class="ext-card ${installed.has(e.id) ? "installed" : ""}" data-cat="${esc(e.category || "other")}"><div class="ext-top"><span class="ext-ico"><svg><use href="#i-puzzle"/></svg></span><div><h3>${esc(e.name)}</h3><p>${esc(e.description || "")}</p></div></div><div class="ext-meta"><span class="ext-rating">${stars(e.rating || 5)}</span><span class="muted small">${(e.installs || 0).toLocaleString()} installs · ${esc(e.version || "1.0.0")}</span></div><div class="ext-tags">${(e.tags || []).slice(0, 4).map(t => `<span class="ext-tag">${esc(t)}</span>`).join("")}</div><div class="ext-foot"><span class="muted small">${esc((e.matches || []).join(", ") || "all sites")}</span><span class="spacer"></span><button class="btn ${installed.has(e.id) ? "ghost" : ""} sm" data-install-store="${esc(e.id)}">${installed.has(e.id) ? "Reinstall" : "Install"}</button></div></article>`).join("")}</div>
          </div>
        </div>`;
      const search = $("extSearch");
      if (search) search.oninput = () => { const q = search.value.toLowerCase(); $("extGridList").querySelectorAll(".ext-card").forEach(c => { c.style.display = c.textContent.toLowerCase().includes(q) ? "" : "none"; }); };
      grid.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => {
        grid.querySelectorAll("[data-cat]").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        const cat = b.dataset.cat;
        $("extGridList").querySelectorAll(".ext-card").forEach(c => { c.style.display = cat === "all" || c.dataset.cat === cat ? "" : "none"; });
      });
    } catch (e) { grid.innerHTML = nav + `<div class="empty"><b>Extension Store unavailable</b><span>${esc(e.message)}</span><button class="btn ghost sm" data-ext-refresh>Retry</button></div>`; }
    return;
  }
  const s = state(); const dev = devExts();
  grid.innerHTML = nav + (dev.length ? dev.map(d => card({ ...d, icon: "i-code" }, d.enabled, true)).join("") : `<div class="empty"><b>No installed extensions</b><span>Open the Store to install verified CSS extensions, or enable Developer mode to load your own package.</span></div>`);
  grid.onchange = e => {
    const sw = e.target.closest("[data-toggle]");
    if (sw) { const list = devExts(); const d = list.find(x => x.id === sw.dataset.toggle); if (d) { d.enabled = sw.checked; save("veyra-dev-extensions", list); hooks.scheduleSync?.(); if (d.kind === "chrome") { sw.checked ? startBackground(d) : stopBackground(d.id); } applyAll(); renderExtensions(); } return; }
    if (e.target.id === "zoomRange") { settings.zoomDefault = Number(e.target.value) / 100; saveSettings(); }
  };
  grid.oninput = e => { if (e.target.id === "zoomRange") $("zoomVal").textContent = e.target.value + "%"; };
  grid.onclick = async e => {
    const pin = e.target.closest("[data-pin-extension]");
    if (pin) {
      const id = pin.dataset.pinExtension;
      if (togglePin(id)) {
        renderExtensions();
        [...grid.querySelectorAll("[data-pin-extension]")].find(btn => btn.dataset.pinExtension === id)?.focus();
      }
      return;
    }
    const navBtn = e.target.closest("[data-ext-view]"); if (navBtn) { if (navBtn.dataset.extView === "store") B.openInternal("extensions", { section: "store" }); else B.openInternal("extensions", { section: "" }); return; }
    const inst = e.target.closest("[data-install-store]"); if (inst) { try { const list = await fetchStore(); const pkg = list.find(x => x.id === inst.dataset.installStore); if (!pkg) throw new Error("Extension is no longer published."); const checked = await api("/api/extensions/verify", { method: "POST", json: { ...pkg } }); if (!checked?.safe) throw new Error(checked?.reason || "Extension package failed security validation."); installExtension(pkg); } catch (err) { toast(err.message, { kind: "err", ms: 6000 }); } return; }
    if (e.target.closest("[data-ext-refresh]")) { await fetchStore(true).catch(() => {}); renderExtensions(); return; }
    const r = e.target.closest("[data-run]"); if (r) { runAction(r.dataset.run, r); return; }
    const rm = e.target.closest("[data-remove]"); if (rm) { const old = devExts().find(x => x.id === rm.dataset.remove); const list = devExts().filter(x => x.id !== rm.dataset.remove); save("veyra-dev-extensions", list); hooks.scheduleSync?.(); if (old?.kind === "chrome") { stopBackground(old.id); savePins(pins().filter(id => id !== old.id)); const all = extStorageAll(); delete all[old.id]; save(EXT_STORAGE_KEY, all); hooks.scheduleSync?.(); } B.state.tabs.forEach(t => t.view === "page" && dtCall(t, old?.script || old?.kind === "chrome" ? "ext.script" : "ext.css", { key: rm.dataset.remove, ...(old?.script || old?.kind === "chrome" ? { script: "" } : { css: "" }) }).catch(() => {})); renderExtensions(); return; }
    const ed = e.target.closest("[data-edit]"); if (ed) { const list = devExts(); const d = list.find(x => x.id === ed.dataset.edit); const { promptDialog } = await import("./core.js"); const res = await promptDialog({ title: `Edit ${d.name}`, fields: [{ name: d.script ? "script" : "css", label: d.script ? "Userscript" : "CSS", type: "textarea", value: d.script || d.css || "" }, { name: "matches", label: "Sites (comma separated, blank for all)", value: (d.matches || []).join(", ") }] }); if (!res) return; try { if (d.script) { const v = normalizeUserscript(res.script); Object.assign(d, v, { id: d.id, enabled: d.enabled }); } else { const v = normalizePackage({ ...d, css: res.css, matches: res.matches.split(",").map(x => x.trim()).filter(Boolean) }, d.source || "local"); Object.assign(d, v); } save("veyra-dev-extensions", list); hooks.scheduleSync?.(); applyAll(); renderExtensions(); toast("Extension updated"); } catch (err) { toast(err.message, { kind: "err" }); } }
  };
}

hooks.renderExtensions = renderExtensions;
function runAction(a, anchor) { closeFloating(); if (a === "reader") readerMode(); else if (a === "stats") pageStats(anchor); else if (a === "notes") openNotes(); }
function openPuzzle(anchor = $("extBtn")) {
  const t = B.activeTab();
  const onPage = t?.view === "page" && !!t.url;
  const p = $("popover");
  const pinFocus = document.activeElement?.dataset.pinExtension;
  p.innerHTML = `<h4>Extensions</h4><p class="pop-sub">${onPage ? `Site: ${esc(hostOf(t.url))}` : "Pin up to three actions. On phones, actions stay in this menu."}</p>
    <div class="ext-puzzle-list">
    ${devExts().map(d => {
      const action = d.kind === "chrome" && d.action;
      const unavailable = actionAvailability(d, backgroundStatusOf(d.id));
      const scripts = d.kind === "chrome" ? chromeRecord(d).contentScripts || [] : null;
      const matching = onPage && (scripts ? scripts.some(group => matchesUrl(group.matches, t.url, group.excludeMatches)) : matches(d, t.url));
      const siteStatus = !d.enabled ? "Disabled" : scripts && !scripts.length ? "No page scripts" : !onPage ? "No website open" : matching ? "Matches this site" : "Does not match this site";
      return `<div class="ext-pop-row">
        <span class="ext-ico">${extensionIcon(d, true)}</span>
        <div class="n"><b>${esc(d.name)}</b><small>${siteStatus}${action && unavailable && unavailable !== siteStatus ? ` · ${esc(unavailable)}` : ""}</small></div>
        <span class="ext-menu-badge" data-extension-badge="${esc(d.id)}">${esc(bgWorkers.get(d.id)?.badge || "")}</span>
        ${action ? `<button class="btn sm" type="button" data-run-extension="${esc(d.id)}" aria-label="Run ${esc(d.name)}" ${unavailable ? "disabled" : ""}>Run</button>${pinButton(d)}` : ""}
      </div>`;
    }).join("")}
    </div><div class="ext-menu-links"><button class="btn ghost sm block" data-go="/extensions/store">Open extension store</button><button class="btn ghost sm block" data-go="/extensions">Manage installed</button></div>`;
  p.onchange = null;
  p.onclick = e => {
    const pin = e.target.closest("[data-pin-extension]");
    if (pin && togglePin(pin.dataset.pinExtension)) { renderExtensions(); openPuzzle(anchor); }
    const act = e.target.closest("[data-run-extension]");
    if (act) runExtension(act.dataset.runExtension);
    if (e.target.closest("[data-go]")) closeFloating();
  };
  openFloating(p, anchor);
  if (pinFocus) [...p.querySelectorAll("[data-pin-extension]")].find(btn => btn.dataset.pinExtension === pinFocus)?.focus();
  else p.querySelector("button:not(:disabled)")?.focus();
}
async function loadManifestFile(file) {
  try {
    if (file.size > 600000) throw new Error("That package is too large.");
    const text = await file.text();
    if (/==UserScript==/i.test(text) || /\.user\.js$/i.test(file.name)) {
      if (!settings.extensionDeveloperMode) throw new Error("Enable Developer mode before installing userscripts.");
      const v = normalizeUserscript(text); const cur = devExts(); const i = cur.findIndex(x => x.id === v.id); if (i >= 0) cur[i] = v; else cur.unshift(v);
      save("veyra-dev-extensions", cur.slice(0, 50)); hooks.scheduleSync?.(); applyAll(); renderExtensions(); return toast(`${v.name} installed`);
    }
    const raw = JSON.parse(text); const list = Array.isArray(raw) ? raw : [raw];
    if (raw.manifest?.manifest_version || raw.manifest_version === 2 || raw.manifest_version === 3) {
      const v = normalizeBrowserManifest(raw.manifest || raw, raw.files || {});
      installChrome(v);
      return toast(`${v.name} imported${v.warnings?.length ? ` (${v.warnings.length} warning${v.warnings.length === 1 ? "" : "s"})` : ""}`);
    }
    const checked = [];
    for (const x of list) { const v = normalizePackage(x, "local"); const r = await api("/api/extensions/verify", { method: "POST", json: x }); if (!r?.safe) throw new Error(r?.reason || `Extension ${v.id} failed security validation.`); checked.push(v); }
    const cur = devExts(); for (const v of checked) { const i = cur.findIndex(c => c.id === v.id); const installed = { ...v, enabled: true, installedAt: Date.now() }; if (i >= 0) cur[i] = installed; else cur.unshift(installed); }
    save("veyra-dev-extensions", cur.slice(0, 50)); hooks.scheduleSync?.(); applyAll(); renderExtensions(); toast(`Installed ${checked.length} extension${checked.length === 1 ? "" : "s"}`);
  } catch (e) { toast(`Couldn't install package: ${e.message}`, { kind: "err", ms: 6000 }); }
}

export function initExtensions(b) {
  B = b; clearLegacyBuiltins();
  hooks.openExtensionActions = () => openPuzzle($("menuBtn"));
  $("extBtn").onclick = () => $("popover").classList.contains("hidden") || !$("popover").querySelector(".ext-puzzle-list") ? openPuzzle() : closeFloating();
  $("pinnedExtensions")?.addEventListener("click", event => {
    const button = event.target.closest("[data-run-extension]");
    if (button) { closeFloating(); runExtension(button.dataset.runExtension); }
  });
  $("extDevMode").onchange = e => { settings.extensionDeveloperMode = e.target.checked; saveSettings(); renderExtensions(); };
  $("loadExtensionBtn").onclick = () => $("extensionFile").click();
  $("extensionFile").onchange = e => { const f = e.target.files?.[0]; if (f) loadManifestFile(f); e.target.value = ""; };

  const folderBtn = $("loadFolderBtn");
  if (folderBtn) {
    folderBtn.onclick = () => {
      if (!settings.extensionDeveloperMode) return toast("Enable Developer mode before loading unpacked extensions.", { kind: "warn" });
      $("extensionFolder").click();
    };
  }
  const folderInput = $("extensionFolder");
  if (folderInput) folderInput.onchange = async e => {
    const list = [...(e.target.files || [])];
    e.target.value = "";
    try { await loadUnpackedFolder(list); }
    catch (err) { toast(`Couldn't load unpacked extension: ${err.message}`, { kind: "err", ms: 7000 }); }
  };
  $("exportExtensionsBtn").onclick = () => { const packages = devExts().map(({ installedAt, source, verified, publisher, author, ...x }) => x.script ? x.script : x.kind === "chrome" ? { manifest: x.manifest, files: x.files } : ({ schema: "veyra-extension/v1", id: x.id, name: x.name, version: x.version, description: x.description, author, publisher, permissions: ["styles"], matches: x.matches, files: { "style.css": x.css }, published: false })); const blob = new Blob([JSON.stringify(packages.length === 1 ? packages[0] : packages, null, 2)], { type: "application/json" }); const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "veyra-extension-packages.json" }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  renderExtensions();

  devExts().forEach(d => d.kind === "chrome" && d.enabled && startBackground(d));
}
export { BUILTIN };
