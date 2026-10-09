
import { $, esc, hostOf, uid, load, save, settings, saveSettings, hooks, toast, openFloating, closeFloating, api, addLog, copyText, confirmDialog } from "./core.js?v=8.28.17-session-resume-userscripts";
import { dtCall, isRemote } from "./bridge.js?v=8.28.17-session-resume-userscripts";
import { syncBackgroundExtensions } from "./extension-runtime.js?v=8.28.17-session-resume-userscripts";

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
  if (!v.trim()) return "";
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
  let packagedFiles = {};
  let packageSchema = m?.schema || "";
  if (m && ["veyra-extension/v1", "veyra-extension/v2"].includes(packageSchema)) {
    packagedFiles = m.files && typeof m.files === "object" ? m.files : {};
    const contentScripts = Object.entries(packagedFiles).filter(([name]) => name.startsWith("content/") && name.endsWith(".js")).map(([, code]) => String(code));
    m = { ...m, css: packagedFiles["style.css"] ?? "", script: contentScripts.join("\n;\n"), backgroundScript: String(packagedFiles["background.js"] || ""), permissions: Array.isArray(m.permissions) ? m.permissions : [] };
  }
  const validationInput = { ...m };
  delete validationInput.script; delete validationInput.backgroundScript;
  const v = validateManifest(validationInput);
  const verification = m?.verification && typeof m.verification === "object" ? m.verification : null;
  const integrity = verification?.integrity || m?.integrity || null;
  const scanPassed = verification?.scan?.verdict === "PASS";
  const hasExecutable = packageSchema === "veyra-extension/v2" && (Object.keys(packagedFiles).some(name => name.endsWith(".js")));
  if (source === "store" && hasExecutable && (verification?.signing?.status !== "verified" || m.signing?.status === "untrusted-key")) {
    throw new Error("Executable Store extensions require a valid trusted Ed25519 package signature.");
  }
  if (source === "store" && (!scanPassed || integrity?.algorithm !== "sha256" || !/^[a-f0-9]{64}$/i.test(String(integrity.value || "")))) {
    throw new Error("This store package has no current PASS security scan and SHA-256 integrity record.");
  }
  return {
    ...v,
    script: String(m?.script || ""),
    backgroundScript: String(m?.backgroundScript || ""),
    packageFiles: packagedFiles,
    packageSchema,
    permissions: Array.isArray(m?.permissions) ? m.permissions.map(String) : [],
    source,
    verified: source === "store" ? true : scanPassed,
    publisher: String(m?.publisher || (source === "store" ? "Veyra Store" : "Local") ).slice(0, 100),
    author: String(m?.author || "").slice(0, 100),
    category: String(m?.category || "other").slice(0, 32),
    tags: Array.isArray(m?.tags) ? m.tags.map(x => String(x).slice(0, 32)).slice(0, 12) : [],
    verification: verification ? { ...verification, integrity } : null,
    storeApproved: source === "store" && verification?.state === "PUBLISHED" && scanPassed && (!hasExecutable || verification?.signing?.status === "verified")
  };
}
function assertLocalScriptSafety(source) {
  const text = String(source || "");
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon|importScripts|eval|Function|Worker|SharedWorker)\b|\bdocument\.cookie\b/i.test(text)) {
    throw new Error("Local developer scripts may not use network, cookies, workers, or dynamic code. CSS-only packages are the supported store format.");
  }
  return text;
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
  return { id: `userscript-${slug}`, name, version: get("version") || "1.0.0", description: "Developer-mode userscript", css: "", script: assertLocalScriptSafety(text), matches: matchesList, grants, runAt: get("run-at") || "document-idle", enabled: true, installedAt: Date.now(), source, verified: false, publisher: "Local userscript", author: get("author"), localOnly: true };
}
function normalizeBrowserManifest(manifest, files = {}) {
  if (!settings.extensionDeveloperMode) throw new Error("Enable Developer mode before importing Chrome or Edge extensions.");
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("The extension manifest must be a JSON object.");
  if (manifest.background || manifest.permissions?.some?.(p => /tabs|cookies|webRequest|management|nativeMessaging|clipboard/i.test(p))) throw new Error("Background code and privileged browser APIs are blocked.");
  const scripts = [], styles = [], matchesList = [];
  for (const group of Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []) {
    for (const pattern of group.matches || []) matchesList.push(String(pattern));
    for (const file of group.js || []) { const code = files[file]; if (typeof code !== "string") throw new Error(`Missing content script: ${file}`); scripts.push(code); }
    for (const file of group.css || []) { const css = files[file]; if (typeof css !== "string") throw new Error(`Missing stylesheet: ${file}`); styles.push(css); }
  }
  if (!scripts.length && !styles.length) throw new Error("This manifest has no supported content scripts or styles.");
  if (scripts.length && /@(?:require|resource|connect)\b/i.test(scripts.join("\n"))) throw new Error("Remote userscript dependencies are blocked.");
  for (const script of scripts) assertLocalScriptSafety(script);
  const id = `chrome-${String(manifest.name || "extension").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)}-${uid().slice(-6)}`;
  return { id, name: String(manifest.name || "Imported browser extension").slice(0, 80), version: String(manifest.version || "1.0.0").slice(0, 20), description: String(manifest.description || "Imported Chrome/Edge content extension").slice(0, 300), css: styles.join("\n"), script: scripts.join("\n\n"), matches: matchesList.slice(0, 30), enabled: true, installedAt: Date.now(), source: "browser-manifest", verified: false, publisher: "Local import", author: "", localOnly: true };
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
function packageForVerification(pkg) {
  const manifest = {};
  for (const key of ["schema", "id", "name", "version", "description", "author", "publisher", "permissions", "matches", "files", "css", "category", "tags", "privacyPolicy", "dataDisclosure", "networkDisclosure", "signature"]) {
    if (pkg?.[key] !== undefined) manifest[key] = pkg[key];
  }
  return manifest;
}
async function installFromStore(id) {
  const list = await fetchStore();
  const pkg = list.find(item => item.id === id);
  if (!pkg) throw new Error("Extension is no longer published.");
  const checked = await api("/api/extensions/verify", { method: "POST", json: packageForVerification(pkg), timeoutMs: 12000 });
  if (!checked?.safe || !checked.extension) throw new Error(checked?.reason || "Extension package failed security validation.");
  const publishedHash = String(pkg.verification?.integrity?.value || "");
  if (publishedHash && checked.extension.integrity?.value !== publishedHash) throw new Error("The downloaded package does not match its published integrity record.");
  const candidate = normalizePackage({ ...checked.extension, verification: pkg.verification }, "store");
  const integrity = candidate.verification?.integrity?.value || "";
  const permissionLabels = { styles: "Change page styling", content_scripts: "Run JavaScript on matching pages (may read and change page content)", background: "Run a background script in a restricted sandbox", storage: "Store extension-specific local data", cookies: "Access cookies through matching page context", network: "Make network requests", tabs: "Request Veyra tab metadata (not yet available to extension APIs)" };
  const permissionText = (candidate.permissions || []).map(permission => `• ${permissionLabels[permission] || permission}`).join("\n") || "• No extra permissions";
  const scanFindings = candidate.verification?.scan?.findings || [];
  const findingText = scanFindings.length ? scanFindings.map(item => `• ${item.code}: ${item.file || "package"}`).join("\n") : "No heuristic flags detected; this does not prove the package is safe.";
  const executableWarning = candidate.script || candidate.backgroundScript
    ? "\n\nIMPORTANT: a signature proves which trusted key signed this exact package; it does not prove the code is harmless. Static checks can miss malicious behavior. Content scripts run in the matching page context; their declared permissions are not a hard API sandbox. Background scripts run in a more restricted iframe but can still consume CPU or freeze this Veyra tab. Review the publisher and every source file before installing."
    : "";
  const allowed = await confirmDialog(
    `Install ${candidate.name}?`,
    `Publisher: ${candidate.publisher || "Unknown"}\nReviewer: ${candidate.verification?.reviewer?.name || "not recorded"}\nSigning key: ${candidate.verification?.signing?.keyId || "none"} (${candidate.verification?.signing?.status || "not signed"})\nSites: ${(candidate.matches || []).join(", ") || "all supported web pages"}\nPermissions:\n${permissionText}\nStatic review flags:\n${findingText}\nIntegrity: SHA-256 ${integrity.slice(0, 16)}…${executableWarning}`
  );
  if (!allowed) return;
  installExtension(candidate);
}
function clearLegacyBuiltins() {
  const s = state(); let changed = false; for (const id of LEGACY_BUILTIN_IDS) if (id in s) { delete s[id]; changed = true; } if (changed) setState(s);
}



function matches(ext, rawUrl) {
  const list = Array.isArray(ext.matches) && ext.matches.length ? ext.matches : ["<all_urls>"];
  let url; try { url = new URL(rawUrl); } catch { return false; }
  return list.some(raw => {
    const pattern = String(raw || "").trim().toLowerCase();
    if (pattern === "<all_urls>" || pattern === "*") return /^https?:$/.test(url.protocol);
    const parsed = pattern.match(/^(?:(\*|https?):\/\/)?([^/]+)(\/.*)?$/);
    if (!parsed) return false;
    const [, scheme = "*", host = "", path = "/*"] = parsed;
    if (scheme !== "*" && url.protocol !== `${scheme}:`) return false;
    const hostname = url.hostname.toLowerCase();
    const hostOk = host === "*" ? true : host.startsWith("*.") ? hostname === host.slice(2) || hostname.endsWith(`.${host.slice(2)}`) : hostname === host || hostname === `www.${host}`;
    if (!hostOk) return false;
    const re = new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    return re.test(url.pathname + url.search);
  });
}
export function validateManifest(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error("The manifest must be a JSON object.");
  const id = String(m.id || "").trim(); if (!/^[a-z0-9][a-z0-9-_.]{1,63}$/i.test(id)) throw new Error("id must be 2–64 letters, numbers, dashes or dots.");
  const name = String(m.name || "").trim(); if (!name || name.length > 80) throw new Error("name is required (80 characters max).");
  const forbidden = ["js", "script", "scripts", "content_scripts", "background", "service_worker", "web_accessible_resources", "externally_connectable", "host_permissions", "optional_permissions", "wasm", "binary"];
  for (const k of forbidden) if (Object.prototype.hasOwnProperty.call(m, k)) throw new Error(`Published Veyra extensions cannot use ${k}.`);
  if (m.permissions != null) { const perms = Array.isArray(m.permissions) ? m.permissions.map(x => String(x)) : []; const allowed = new Set(["styles", "content_scripts", "background", "storage", "network", "tabs"]); if (perms.some(x => !allowed.has(x))) throw new Error("This extension requests an unsupported Veyra permission."); }
  const css = safeCss(m.css ?? m.page_css ?? "");
  if (!css && !String(m.script || "").trim() && !String(m.backgroundScript || "").trim() && !Object.keys(m.files || {}).some(name => String(name).endsWith(".js"))) throw new Error("A stylesheet or executable capability is required.");
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
    if (d.script) calls.push(["ext.script", { key: d.id, localOnly: !!d.localOnly, storeApproved: !!d.storeApproved, permissions: d.permissions || [], script: active ? `${d.css ? `GM_addStyle(${JSON.stringify(d.css)});\n` : ""}${d.script}` : "" }]);
    else if (d.css) calls.push(["ext.css", { key: d.id, css: active ? safeCss(d.css) : "" }]);
  }
  if (s.zoom && settings.zoomDefault && settings.zoomDefault !== 1 && t.zoom === 1) { t.zoom = settings.zoomDefault; calls.push(["ext.zoom", { zoom: t.zoom }]); }
  for (const [m, p] of calls) { try { await dtCall(t, m, p, 4000); } catch (e) { if (!/unsupported|timed out/i.test(e.message)) addLog("warn", `Extension ${p.key || m} failed on ${hostOf(t.url)}: ${e.message}`); } }
  hooks.onExtensionsApplied?.(t);
}
hooks.applyExtensionsToTab = applyToTab;
const applyAll = () => { B.state.tabs.forEach(t => applyToTab(t)); syncBackgroundExtensions(devExts(), message => addLog("error", `Background extension: ${message}`)); };

async function toggle(id, on) {
  const s = state(); s[id] = on; setState(s);
  const e = BUILTIN.find(x => x.id === id);
  if (e?.server) { settings.blockTrackers = on; saveSettings(); const sid = B.state.session?.id; if (sid) api(`/api/session/${sid}/prefs`, { json: { blockTrackers: on } }).catch(() => {}); }
  if (e?.chrome) document.body.classList.toggle("compact", on || !!settings.compact);
  if (e?.id === "notes" && !on) closeNotes();
  applyAll(); renderExtensions(); B.renderActive({ push: false });
}


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
  const notes = load("veyra-notes", {}); const k = notesKey(t);
  p.classList.remove("hidden");
  p.innerHTML = `<header><h3>Notes · ${esc(k)}</h3><div><button class="icon-btn sm" id="noteCopy" title="Copy"><svg><use href="#i-copy"/></svg></button><button class="icon-btn sm" id="noteClose" title="Close"><svg><use href="#i-x"/></svg></button></div></header><textarea id="noteText" placeholder="Notes for ${esc(k)}. Saved automatically."></textarea><small class="muted" style="padding:0 14px 12px" id="noteState">${notes[k] ? `Saved` : ""}</small>`;
  const ta = $("noteText"); ta.value = notes[k] || "";
  let timer; ta.oninput = () => { clearTimeout(timer); $("noteState").textContent = "Saving…"; timer = setTimeout(() => { const n = load("veyra-notes", {}); if (ta.value.trim()) n[k] = ta.value.slice(0, 20000); else delete n[k]; save("veyra-notes", n); hooks.scheduleSync?.(); $("noteState").textContent = "Saved"; }, 400); };
  $("noteClose").onclick = () => { t.notesOpen = false; p.classList.add("hidden"); };
  $("noteCopy").onclick = () => copyText(ta.value);
}
hooks.renderSidePanel = renderSidePanel;


function card(e, on, dev = false) {
  return `<article class="ext-card ${on ? "on" : ""}" data-ext="${esc(e.id)}"><div class="ext-top"><span class="ext-ico"><svg><use href="#${e.icon || "i-puzzle"}"/></svg></span><div><h3>${esc(e.name)}</h3><p>${esc(e.desc || e.description || "")}</p></div></div>
    ${e.zoom ? `<label class="field" style="margin:0"><span>Zoom for new pages: <b id="zoomVal">${Math.round((settings.zoomDefault || 1) * 100)}%</b></span><input type="range" min="50" max="200" step="10" value="${Math.round((settings.zoomDefault || 1) * 100)}" id="zoomRange"></label>` : ""}
    ${dev ? `<p class="muted small mono" style="margin:0">${esc(e.version)} · ${e.backgroundScript ? "background script" : e.script ? "content script" : "CSS"} · ${esc(e.matches?.length ? e.matches.join(", ") : "all sites")}</p>` : ""}
    <div class="ext-foot">${dev ? `${e.source === "store" ? "<span class=\"muted small\">Signed Store package · source editing disabled</span>" : `<button class="btn ghost sm" data-edit="${esc(e.id)}">Edit ${e.script ? "script" : "CSS"}</button>`}<button class="btn ghost sm" data-remove="${esc(e.id)}">Remove</button>` : e.action && on ? `<button class="btn ghost sm" data-run="${esc(e.action)}">${e.action === "reader" ? "Open reader" : e.action === "stats" ? "Show stats" : "Open notes"}</button>` : `<span class="muted small">${e.server ? "Runs on the server + page" : e.chrome ? "Changes Veyra's interface" : "Runs in the page"}</span>`}
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
      const categories = [...new Set(list.map(e => e.category || "other"))].sort();
      const catLabels = { reading: "Reading", accessibility: "Accessibility", appearance: "Appearance", social: "Social", privacy: "Privacy", media: "Media", developer: "Developer", typography: "Typography", other: "Other" };
      const catCounts = {};
      list.forEach(e => { const c = e.category || "other"; catCounts[c] = (catCounts[c] || 0) + 1; });
      grid.innerHTML = nav + `
        <div class="ext-store-header">
          <div class="ext-store-title"><h2>Veyra Extension Store</h2><p>${list.length} catalog packages · CSS and signed executable packages · every release requires human review and per-device consent</p></div>
          <input class="input" id="extSearch" placeholder="Search extensions…" style="max-width:300px">
        </div>
        <div class="ext-store-layout">
          <div class="ext-store-sidebar">
            <h4>Categories</h4>
            <button class="ext-cat-btn active" data-cat="all">All <span class="count">${list.length}</span></button>
            ${categories.map(c => `<button class="ext-cat-btn" data-cat="${esc(c)}">${catLabels[c] || c} <span class="count">${catCounts[c] || 0}</span></button>`).join("")}
          </div>
          <div class="ext-store-main">
            <div class="ext-grid" id="extGridList">${list.map(e => {
              const digest = String(e.verification?.integrity?.value || e.integrity?.value || "");
              const signing = e.verification?.signing?.status || "not-provided";
              const executable = Object.keys(e.files || {}).some(name => name.endsWith(".js"));
              const permissions = (e.permissions || []).join(", ");
              return `<article class="ext-card ${installed.has(e.id) ? "installed" : ""}" data-cat="${esc(e.category || "other")}"><div class="ext-top"><span class="ext-ico"><svg><use href="#i-puzzle"/></svg></span><div><h3>${esc(e.name)}</h3><p>${esc(e.description || "")}</p></div></div><div class="ext-tags">${(e.tags || []).slice(0, 4).map(t => `<span class="ext-tag">${esc(t)}</span>`).join("")}</div><p class="muted small" style="margin:10px 0 0">${esc(e.version || "1.0.0")} · ${esc(e.publisher || "Catalog publisher")} · ${executable ? "Executable" : "CSS-only"}</p><p class="muted small" style="margin:4px 0 0">Permissions: ${esc(permissions || "none")}</p><p class="muted small mono" style="margin:5px 0 0">${esc(e.verification?.scan?.verdict || "UNKNOWN")} · ${esc(signing)} · sha256:${esc(digest.slice(0, 16))}${digest ? "…" : ""}</p><div class="ext-foot"><span class="muted small">${esc((e.matches || []).join(", ") || "all supported web pages")}</span><span class="spacer"></span><button class="btn ${installed.has(e.id) ? "ghost" : "primary"} sm" data-install-store="${esc(e.id)}">${installed.has(e.id) ? "Review & reinstall" : "Review & install"}</button></div></article>`;
            }).join("")}</div>
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
      grid.querySelectorAll("[data-install-store]").forEach(button => button.onclick = async () => {
        try { await installFromStore(button.dataset.installStore); }
        catch (error) { toast(error.message, { kind: "err", ms: 6000 }); }
      });
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
    const inst = e.target.closest("[data-install-store]"); if (inst) { try { await installFromStore(inst.dataset.installStore); } catch (err) { toast(err.message, { kind: "err", ms: 6000 }); } return; }
    if (e.target.closest("[data-ext-refresh]")) { await fetchStore(true).catch(() => {}); renderExtensions(); return; }
    const r = e.target.closest("[data-run]"); if (r) { runAction(r.dataset.run, r); return; }
    const rm = e.target.closest("[data-remove]"); if (rm) { const old = devExts().find(x => x.id === rm.dataset.remove); const list = devExts().filter(x => x.id !== rm.dataset.remove); save("veyra-dev-extensions", list); hooks.scheduleSync?.(); B.state.tabs.forEach(t => t.view === "page" && old?.script && dtCall(t, "ext.script", { key: rm.dataset.remove, script: "" }).catch(() => {})); applyAll(); renderExtensions(); return; }
    const ed = e.target.closest("[data-edit]"); if (ed) { const list = devExts(); const d = list.find(x => x.id === ed.dataset.edit); const { promptDialog } = await import("./core.js"); const res = await promptDialog({ title: `Edit ${d.name}`, fields: [{ name: d.script ? "script" : "css", label: d.script ? "Userscript" : "CSS", type: "textarea", value: d.script || d.css || "" }, { name: "matches", label: "Sites (comma separated, blank for all)", value: (d.matches || []).join(", ") }] }); if (!res) return; try { if (d.script) { const v = normalizeUserscript(res.script); Object.assign(d, v, { id: d.id, enabled: d.enabled }); } else { const v = normalizePackage({ ...d, css: res.css, matches: res.matches.split(",").map(x => x.trim()).filter(Boolean) }, d.source || "local"); Object.assign(d, v); } save("veyra-dev-extensions", list); hooks.scheduleSync?.(); applyAll(); renderExtensions(); toast("Extension updated"); } catch (err) { toast(err.message, { kind: "err" }); } }
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
    const text = await file.text();
    if (/==UserScript==/i.test(text) || /\.user\.js$/i.test(file.name)) {
      if (!settings.extensionDeveloperMode) throw new Error("Enable Developer mode before installing userscripts.");
      if (!await confirmDialog("Run unsigned local userscript?", "Developer scripts are not reviewed, cannot be published to the Veyra Store, and stay on this device. Network, cookie, worker, and dynamic-code patterns are blocked, but local scripts can still modify matching page content.")) return;
      const v = normalizeUserscript(text); const cur = devExts(); const i = cur.findIndex(x => x.id === v.id); if (i >= 0) cur[i] = v; else cur.unshift(v);
      save("veyra-dev-extensions", cur.slice(0, 50)); hooks.scheduleSync?.(); applyAll(); renderExtensions(); return toast(`${v.name} installed`);
    }
    const raw = JSON.parse(text); const list = Array.isArray(raw) ? raw : [raw];
    if (list.length > 20) throw new Error("Install at most 20 CSS-only packages at a time.");
    if (raw.manifest?.manifest_version || raw.manifest_version === 2 || raw.manifest_version === 3) {
      if (!await confirmDialog("Run unsigned local browser extension?", "Imported Chrome or Edge content scripts are local developer tools. They are not synced or publishable through the Veyra Store, and unsafe network, cookie, worker, and dynamic-code patterns are blocked.")) return;
      const v = normalizeBrowserManifest(raw.manifest || raw, raw.files || {}); const cur = devExts(); cur.unshift(v); save("veyra-dev-extensions", cur.slice(0, 50)); hooks.scheduleSync?.(); applyAll(); renderExtensions(); return toast(`${v.name} imported`);
    }
    const checked = [];
    for (const x of list) {
      const r = await api("/api/extensions/verify", { method: "POST", json: x });
      if (!r?.safe || !r.extension) throw new Error(r?.reason || "Extension package failed security validation.");
      checked.push(normalizePackage(r.extension, "local"));
    }
    const cur = devExts(); for (const v of checked) { const i = cur.findIndex(c => c.id === v.id); const installed = { ...v, enabled: true, installedAt: Date.now() }; if (i >= 0) cur[i] = installed; else cur.unshift(installed); }
    save("veyra-dev-extensions", cur.slice(0, 50)); hooks.scheduleSync?.(); applyAll(); renderExtensions(); toast(`Installed ${checked.length} extension${checked.length === 1 ? "" : "s"}`);
  } catch (e) { toast(`Couldn't install package: ${e.message}`, { kind: "err", ms: 6000 }); }
}

export function initExtensions(b) {
  B = b; clearLegacyBuiltins();
  syncBackgroundExtensions(devExts(), message => addLog("error", `Background extension: ${message}`));
  $("extBtn").onclick = () => $("popover").classList.contains("hidden") ? openPuzzle() : closeFloating();
  $("extDevMode").onchange = e => { settings.extensionDeveloperMode = e.target.checked; saveSettings(); renderExtensions(); };
  $("loadExtensionBtn").onclick = () => $("extensionFile").click();
  $("extensionFile").onchange = e => { const f = e.target.files?.[0]; if (f) loadManifestFile(f); e.target.value = ""; };
  $("exportExtensionsBtn").onclick = () => { const packages = devExts().map(({ installedAt, source, verified, publisher, author, ...x }) => x.script ? x.script : ({ schema: "veyra-extension/v1", id: x.id, name: x.name, version: x.version, description: x.description, author, publisher, permissions: ["styles"], matches: x.matches, files: { "style.css": x.css }, published: false })); const blob = new Blob([JSON.stringify(packages.length === 1 ? packages[0] : packages, null, 2)], { type: "application/json" }); const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "veyra-extension-packages.json" }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  renderExtensions();
}
export { BUILTIN };
