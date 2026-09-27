const API = window.VEYRA_API || "https://veyraserver-xscy.onrender.com";
const $ = id => document.getElementById(id);
const rawFetch = window.fetch.bind(window);
const APP_BASE = new URL("./", document.baseURI).pathname.replace(/\/$/, "") || "";

function safeJsonParse(raw, fallback) {
  try { const value = JSON.parse(raw); return value == null ? fallback : value; }
  catch { return fallback; }
}
function safeStorageGet(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function safeStorageSet(key, value) { try { localStorage.setItem(key, value); } catch {} }

const DEFAULT_SETTINGS = {
  searchMode: "veyra",
  searchEngine: "google",
  homepage: "",
  confirmCloseWithCrawl: false,
  autoStopPrevious: true,
  devRefreshMs: 1500,
  consoleVerbosity: "all",
  crawlerGlobalConcurrency: 128,
  crawlerHostConcurrency: 8,
  requestTimeoutMs: 15000,
  browserFallback: false,
  downloadsMax: 200,
  historyMax: 500,
  extensionDeveloperMode: false
};
let settings = { ...DEFAULT_SETTINGS, ...safeJsonParse(safeStorageGet("veyra-settings", "{}"), {}) };
function saveSettings() { safeStorageSet("veyra-settings", JSON.stringify(settings)); }

const bookmarkList = safeJsonParse(safeStorageGet("veyra-bookmarks", "[]"), []);
const historyList = safeJsonParse(safeStorageGet("veyra-history", "[]"), []);
const downloadList = safeJsonParse(safeStorageGet("veyra-downloads", "[]"), []);
const extensionList = safeJsonParse(safeStorageGet("veyra-extensions", "[]"), []);
const BUILTIN_EXTENSIONS = [
  { id: "veyra-focus", name: "Focus Toolbar", version: "1.0.0", description: "Reduces visual browser chrome while you read.", author: "Veyra", enabled: false, builtin: true },
  { id: "veyra-reading", name: "Reading Surface", version: "1.0.0", description: "Adds a softer reading surface to Veyra.", author: "Veyra", enabled: false, builtin: true },
  { id: "veyra-compact", name: "Compact UI", version: "1.0.0", description: "Tightens Veyra toolbar and tab spacing.", author: "Veyra", enabled: false, builtin: true }
];
const state = {
  tabs: [], activeId: null, tabSeq: 0,
  logs: [], netLog: [], devTimer: null, devNetFilter: "all",
  bookmarked: new Set(Array.isArray(bookmarkList) ? bookmarkList.filter(x => typeof x === "string") : []),
  history: Array.isArray(historyList) ? historyList.filter(x => x && typeof x === "object").slice(0, 500) : [],
  downloads: Array.isArray(downloadList) ? downloadList.filter(x => x && typeof x === "object").slice(0, 200) : [],
  extensions: [...BUILTIN_EXTENSIONS, ...(Array.isArray(extensionList) ? extensionList.filter(x => x && typeof x === "object" && x.id && !BUILTIN_EXTENSIONS.some(b => b.id === x.id)) : [])],
  clientLogQueue: [], clientLogTimer: null, searchSuggestTimer: null,
  inspectMode: false, downloadControllers: new Map(),
  booted: false
};
function saveHistory() { safeStorageSet("veyra-history", JSON.stringify(state.history.slice(0, settings.historyMax || 500))); }
function saveDownloads() { safeStorageSet("veyra-downloads", JSON.stringify(state.downloads.slice(0, settings.downloadsMax || 200))); }
function saveExtensions() { safeStorageSet("veyra-extensions", JSON.stringify(state.extensions)); }
function recordHistory(kind, url, title = "") {
  const value = String(url || ""); if (!value) return;
  const previous = state.history[0];
  const entry = { id: cryptoRandomId(), time: new Date().toISOString(), kind: String(kind || "page"), url: value, title: String(title || hostOf(value) || value).slice(0, 240) };
  if (previous && previous.url === value && previous.kind === entry.kind) { previous.time = entry.time; previous.title = entry.title; saveHistory(); return; }
  state.history.unshift(entry);
  if (state.history.length > (settings.historyMax || 500)) state.history.length = settings.historyMax || 500;
  saveHistory();
}
function activeExtensions() { return state.extensions.filter(x => x.enabled); }
function applyExtensions() {
  const browser = document.querySelector(".browser"); if (!browser) return;
  const enabled = activeExtensions();
  browser.classList.toggle("focus-extension", enabled.some(x => x.id === "veyra-focus"));
  browser.classList.toggle("reading-extension", enabled.some(x => x.id === "veyra-reading"));
  browser.classList.toggle("compact-extension", enabled.some(x => x.id === "veyra-compact"));
  let style = document.getElementById("veyraExtensionStyles");
  if (!style) { style = document.createElement("style"); style.id = "veyraExtensionStyles"; document.head.appendChild(style); }
  const css = enabled.flatMap(x => Array.isArray(x.css) ? x.css : x.css ? [x.css] : []).filter(x => typeof x === "string").slice(0, 20);
  style.textContent = css.join("\n/* --- extension boundary --- */\n").slice(0, 120000);
}
function showView(id) {
  for (const x of ["homeView","browserView","searchView","calculatorView","downloadsView","historyView","extensionsView","toolView"]) $(x)?.classList.add("hidden");
  $(id)?.classList.remove("hidden");
}

function makeTab() {
  return {
    id: "t" + (++state.tabSeq), title: "New Tab", favicon: "", url: "", proxyUrl: "", jobId: null, done: false,
    history: [], histIndex: -1, view: "home", searchQuery: "", searchOffset: 0, searchData: null, proxySessionId: "",
    browserMode: "FAST_PROXY", browserSessionId: "", browserPoll: null, browserScreenshot: null, browserStatus: "",
    consolePageUrl: "", remoteLogIds: new Set(), resources: [], links: [], selected: -1, poll: null
  };
}
function activeTab() { return state.tabs.find(t => t.id === state.activeId); }

// --- Per-tab frame isolation -------------------------------------------------
// Each tab owns its own <iframe>, kept alive in the DOM and just hidden/shown
// on tab switch. This avoids the old design (one shared #pageFrame reused by
// every tab) which meant switching tabs briefly showed the *previous* tab's
// leftover document while the new URL loaded. Each frame now remembers its
// own last-rendered page, exactly like a real browser tab.
function frameIdFor(tabId) { return "frame-" + tabId; }
function getFrame(tabId) { return document.getElementById(frameIdFor(tabId)); }
function getOrCreateFrame(t) {
  if (!t) return null;
  let frame = getFrame(t.id);
  if (frame) return frame;
  frame = document.createElement("iframe");
  frame.id = frameIdFor(t.id);
  frame.name = "veyraFrame_" + t.id;
  frame.className = "tab-frame";
  frame.title = "Veyra page view";
  frame.setAttribute("allow", "fullscreen; autoplay; clipboard-read; clipboard-write");
  frame.addEventListener("load", () => {
    if (activeTab()?.id !== t.id) return;
    if (t.url) { $("pageState").textContent = hostOf(t.url); setLoading(false); if (state.inspectMode) toggleInspect(true); }
  });
  frame.addEventListener("loadstart", () => { if (activeTab()?.id === t.id) setLoading(true, 60, "Rendering…"); });
  const wrap = $("frameWrap"), loader = $("frameLoader");
  if (wrap) wrap.insertBefore(frame, loader || wrap.firstChild);
  return frame;
}
function activeFrame() { const t = activeTab(); return t ? getOrCreateFrame(t) : null; }
function ensureBrowserViewport() {
  const wrap = $("frameWrap"); if (!wrap) return null;
  let v = $("browserRemoteViewport");
  if (!v) {
    v = document.createElement("div"); v.id = "browserRemoteViewport"; v.className = "browser-remote-viewport hidden";
    v.innerHTML = '<img id="browserRemoteImage" alt="Remote Chromium page"><div class="browser-remote-badge" id="browserRemoteBadge">BROWSER</div><div class="browser-verify" id="browserVerify"><b>Website verification required</b><span>The actual browser session is waiting for you.</span><div><button id="browserVerifyComplete">Complete verification</button><button id="browserVerifyRetry">Retry</button><button id="browserVerifyDirect">Open directly</button></div></div>';
    wrap.insertBefore(v, wrap.firstChild);
    const img = v.querySelector("#browserRemoteImage");
    const sendPointer = async (type,e) => { const t=activeTab(); if(!t?.browserSessionId)return; const r=img.getBoundingClientRect(); const x=Math.max(0,Math.min(1365,(e.clientX-r.left)*1365/r.width)); const y=Math.max(0,Math.min(820,(e.clientY-r.top)*820/r.height)); try{await apiRequest(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}/input`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type,x,y,button:e.button===2?'right':'left'})}); await refreshBrowserSurface(t,true);}catch(err){addLog("error",`Browser input failed: ${err.message}`)}};
    img.addEventListener("click",e=>sendPointer("click",e)); img.addEventListener("dblclick",e=>sendPointer("dblclick",e)); img.addEventListener("contextmenu",e=>{e.preventDefault();sendPointer("click",e)});
    img.addEventListener("mousemove",async e=>{ if(!state.inspectMode)return; const t=activeTab(); const r=img.getBoundingClientRect(); const x=Math.max(0,Math.min(1365,(e.clientX-r.left)*1365/r.width)); const y=Math.max(0,Math.min(820,(e.clientY-r.top)*820/r.height)); try{const q=await apiRequest(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}/inspect`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({x,y})}); if(q.body.data)renderInspectData(q.body.data)}catch{}});
    img.addEventListener("wheel",e=>{e.preventDefault();sendPointer("wheel",e)} ,{passive:false});
    window.addEventListener("keydown",async e=>{ const t=activeTab(); if(!t?.browserSessionId || document.activeElement?.tagName==='INPUT' || document.activeElement?.tagName==='TEXTAREA') return; const mod=e.ctrlKey||e.metaKey; if(mod||e.altKey) return; try{await apiRequest(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}/input`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:"key",key:e.key.length===1?e.key:e.key})}); await refreshBrowserSurface(t,true);}catch{} });
    v.querySelector("#browserVerifyComplete").onclick=()=>v.querySelector("#browserVerify")?.classList.add("hidden");
    v.querySelector("#browserVerifyRetry").onclick=()=>refreshBrowserSurface(activeTab(),true);
    v.querySelector("#browserVerifyDirect").onclick=()=>{const t=activeTab();if(t?.url)window.open(t.url,"_blank","noopener")};
  }
  return v;
}
function showFrameForTab(t) {
  if (!t) return;
  const wanted = getOrCreateFrame(t);
  const remote = ensureBrowserViewport();
  const browser = t.browserMode === "BROWSER_ENGINE" && !!t.browserSessionId;
  document.querySelectorAll("#frameWrap .tab-frame").forEach(el => el.classList.toggle("frame-active", !browser && el === wanted));
  remote?.classList.toggle("hidden", !browser);
}
function destroyFrame(tabId) { getFrame(tabId)?.remove(); }
async function refreshBrowserSurface(t, force=false) {
  if (!t?.browserSessionId || !state.tabs.includes(t)) return;
  try {
    const r = await apiRequest(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}`);
    const s = r.body.session; const previousUrl=t.url; t.url=s.canonicalUrl||t.url; t.browserStatus=s.status; t.title=s.title||hostOf(t.url);
    if (t.url && previousUrl && t.url !== previousUrl) { t.history=t.history.slice(0,t.histIndex+1); t.history.push(t.url); t.histIndex=t.history.length-1; recordHistory('page',t.url,t.title); }
    const img=$("browserRemoteImage"), v=$("browserRemoteViewport"); if(!img||!v)return;
    if(force || !img.dataset.session) { img.dataset.session=t.browserSessionId; img.src=`${API}/api/browser/session/${encodeURIComponent(t.browserSessionId)}/screenshot?ts=${Date.now()}`; }
    else if(force) img.src=`${API}/api/browser/session/${encodeURIComponent(t.browserSessionId)}/screenshot?ts=${Date.now()}`;
    const verify=$("browserVerify"); verify?.classList.toggle("hidden", s.status!=="VERIFICATION_REQUIRED");
    $("browserRemoteBadge").textContent=s.status==='VERIFICATION_REQUIRED'?"VERIFY":"BROWSER";
    $("pageState").textContent=s.status==='VERIFICATION_REQUIRED'?"Website verification required":hostOf(t.url);
    $("serverState").textContent=s.status==='VERIFICATION_REQUIRED'?"Verification required":"Browser engine"; $("serverState").className="server-pill"+(s.status==='VERIFICATION_REQUIRED'?" warn":" live");
    updateIdentity(t.url); renderTabs();
    if (state.inspectMode && t.browserSessionId) v?.classList.remove("hidden");
    if (force) { clearTimeout(t.browserPoll); t.browserPoll=setTimeout(()=>refreshBrowserSurface(t,true),700); }
  } catch(e) { addLog("error",`Browser session error: ${e.message}`); }
}
async function startBrowserSession(t,url) {
  const {body}=await apiRequest('/api/browser/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tabId:t.id,url})});
  t.browserMode='BROWSER_ENGINE'; t.browserSessionId=body.session.id; t.browserStatus=body.session.status; t.url=body.session.canonicalUrl||url;
  showBrowser(); showFrameForTab(t); updateIdentity(t.url); setLoading(false);
  await refreshBrowserSurface(t,true);
  if(t.browserPoll)clearTimeout(t.browserPoll); t.browserPoll=setTimeout(()=>refreshBrowserSurface(t,true),700);
  return body.session;
}
async function stopBrowserSession(t) { if(!t?.browserSessionId)return; try{await apiRequest(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}`,{method:'DELETE'})}catch{} clearTimeout(t.browserPoll); t.browserPoll=null; t.browserSessionId=''; }

function routeName() {
  const p = location.pathname;
  if (APP_BASE && p.startsWith(APP_BASE + "/")) return p.slice(APP_BASE.length) || "/";
  if (APP_BASE && p === APP_BASE) return "/";
  return p || "/";
}
function routeUrl(path, query = "") { return `${APP_BASE}${path === "/" ? "/" : path}${query}`; }
function setRoute(path, query = "", mode = "push") {
  const target = routeUrl(path, query);
  if (location.pathname + location.search === target) return;
  const fn = mode === "replace" ? history.replaceState : history.pushState;
  try { fn.call(history, { veyraRoute: path }, "", target); } catch {}
}
function goRouteFromUrl() {
  const route = routeName();
  if (route === "/dev") setTool("devPanel", false);
  else if (route === "/settings") setTool("settingsPanel", false);
  else if (route === "/downloads") showDownloads(false);
  else if (route === "/history") showHistory(false);
  else if (route === "/extensions") showExtensions(false);
  else if (route === "/calculator") showCalculator(new URLSearchParams(location.search).get("q") || "", false);
  else if (route === "/search") showSearch(new URLSearchParams(location.search).get("q") || "", false);
  else if (location.hash === "#console") setTool("consolePanel", false);
  else restoreTabView(activeTab());
}
window.addEventListener("popstate", goRouteFromUrl);
window.addEventListener("hashchange", () => {
  if (location.hash === "#console") setTool("consolePanel", false);
  else if (location.hash === "") restoreTabView(activeTab());
});

function logNet(method, url, status, ms, requestId = "") {
  let path = url;
  try { const u = new URL(url); path = u.pathname + (u.search ? u.search.slice(0, 100) : ""); } catch {}
  state.netLog.push({ time: new Date(), method, path, status, ms: Math.round(ms), requestId });
  if (state.netLog.length > 300) state.netLog.splice(0, state.netLog.length - 300);
  const panel = $("devPanel");
  if (panel && !panel.classList.contains("hidden")) renderDevNet();
}
function queueClientLog(entry) {
  state.clientLogQueue.push(entry);
  if (state.clientLogQueue.length > 100) state.clientLogQueue.splice(0, state.clientLogQueue.length - 100);
  clearTimeout(state.clientLogTimer);
  state.clientLogTimer = setTimeout(flushClientLogs, 250);
}
async function flushClientLogs() {
  if (!state.clientLogQueue.length) return;
  const batch = state.clientLogQueue.splice(0, 25);
  try {
    await rawFetch(API + "/api/debug/client-log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: batch }), keepalive: true });
  } catch {}
}
function addLog(level, msg, meta = {}) {
  const entry = { time: new Date(), level: String(level || "info"), message: String(msg), ...meta };
  state.logs.push(entry);
  if (state.logs.length > 2000) state.logs.splice(0, state.logs.length - 2000);
  if (state.logs.length <= 2000) queueClientLog({
    time: entry.time.toISOString(), level: entry.level, message: entry.message,
    url: location.href, pageUrl: activeTab()?.url || "", tabId: activeTab()?.id || "", jobId: activeTab()?.jobId || "",
    ...meta
  });
  const panel = $("consolePanel");
  if (panel && !panel.classList.contains("hidden")) renderConsole();
}
function esc(s) { return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
function pathOf(u) { try { const x = new URL(u); return (x.pathname || "/") + (x.search || "") + (x.hash || ""); } catch { return String(u || ""); } }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "Veyra"; } }
function formatUrlDisplay(u) { return String(u || "").replace(/^https?:\/\//, ""); }
function proxyUrl(url, mode = "view", sid = "") {
  const base = API + (mode === "resource" ? "/api/resource?url=" : "/api/view?url=") + encodeURIComponent(url);
  return sid ? `${base}&sid=${encodeURIComponent(sid)}` : base;
}

class ApiError extends Error {
  constructor(message, status = 0, code = "API_ERROR", requestId = "") { super(message); this.status = status; this.code = code; this.requestId = requestId; }
}
async function apiRequest(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const requestId = cryptoRandomId();
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || settings.requestTimeoutMs || 15000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  let response;
  try {
    const headers = new Headers(options.headers || {});
    headers.set("X-Veyra-Request-ID", requestId);
    response = await rawFetch(API + path, { ...options, method, headers, signal: controller.signal });
    const responseRequestId = response.headers.get("X-Veyra-Request-ID") || requestId;
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    logNet(method, API + path, response.status, performance.now() - start, responseRequestId);
    let body = null;
    if (text) body = /json/i.test(contentType) ? safeJsonParse(text, null) : text;
    if (!response.ok) {
      const message = body?.error || (typeof body === "string" ? body.slice(0, 500) : `HTTP ${response.status}`);
      throw new ApiError(message, response.status, body?.code || "HTTP_ERROR", responseRequestId);
    }
    return { body, response, requestId: responseRequestId };
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 0;
    logNet(method, API + path, status || "ERR", performance.now() - start, e?.requestId || requestId);
    if (e instanceof ApiError) throw e;
    const msg = e?.name === "AbortError" ? `Request timed out after ${timeoutMs} ms.` : e?.message || String(e);
    throw new ApiError(msg, 0, e?.name === "AbortError" ? "API_TIMEOUT" : "API_NETWORK_ERROR", requestId);
  } finally { clearTimeout(timer); }
}
function cryptoRandomId() { try { return crypto.randomUUID(); } catch { return "v-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); } }

function setLoading(on, pct = 0, message = "Loading page…") {
  const line = $("loadProgress"), box = $("frameLoader"), btn = $("reloadBtn");
  if (!line || !box) return;
  const active = !!on;
  line.style.width = active ? `${Math.max(6, Math.min(100, pct))}%` : "0%";
  box.classList.toggle("hidden", !active);
  $("frameLoaderText").textContent = message;
  if (btn) {
    btn.dataset.loading = active ? "1" : "0";
    btn.title = active ? "Stop loading (Esc)" : "Reload (Ctrl/Cmd+R)";
    btn.innerHTML = `<svg><use href="#${active ? "i-stop" : "i-reload"}"/></svg>`;
    btn.onclick = active ? stopCurrentLoad : reloadActive;
  }
}
async function stopCurrentLoad() {
  const t = activeTab();
  try { if (t?.browserSessionId) await apiRequest(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}/stop`, {method:"POST"}); } catch {}
  try { if (t?.jobId && !t.done) await stopJob(t.jobId, true); } catch {}
  if (t?.poll) { clearInterval(t.poll); t.poll = null; }
  if (t) { t.done = true; t.loading = false; }
  const frame = t ? getFrame(t.id) : null;
  if (frame) { try { frame.contentWindow?.stop?.(); } catch {} frame.src = "about:blank"; }
  $("pageState").textContent = "Stopped";
  $("serverState").textContent = "Stopped";
  $("serverState").className = "server-pill warn";
  setLoading(false);
  addLog("info", "Page loading stopped.");
}
function updateIdentity(url) {
  const address = $("address");
  if (!url) { address.value = stateSearchText(); return; }
  try {
    const u = new URL(url);
    $("scheme").textContent = u.protocol.replace(":", "");
    $("siteState").style.color = u.protocol === "https:" ? "#7aa6df" : "#cfad6b";
  } catch { $("scheme").textContent = "web"; }
  $("starBtn").classList.toggle("saved", state.bookmarked.has(url));
  address.value = url;
}
function stateSearchText() { const t = activeTab(); return t?.view === "search" ? t.searchQuery : t?.view === "calculator" ? "Veyra Calculator" : ""; }

function classifyInput(input) {
  const v = String(input || "").trim();
  if (!v) return null;
  if (/^(?:javascript|data|blob|mailto|tel|about):/i.test(v)) return { kind: "unsupported", value: v };
  if (/^https?:\/\//i.test(v)) return { kind: "url", url: v };
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(v)) return { kind: "url", url: "https://" + v };
  if (looksLikeCalculation(v)) return { kind: "calculator", expression: v };
  return { kind: "search", query: v };
}
function looksLikeCalculation(v) {
  if (!/[0-9]/.test(v) || !/[+\-*/%()]/.test(v)) return false;
  return /^[\d\s+\-*/%().]+$/.test(v);
}

// Safe calculator: recursive descent, no eval/Function.
function tokenizeCalc(input) {
  const tokens = []; let i = 0; const s = String(input || "");
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    if (/[0-9.]/.test(s[i])) {
      const start = i; let dots = 0;
      while (i < s.length && /[0-9.]/.test(s[i])) { if (s[i] === ".") dots++; i++; }
      const raw = s.slice(start, i); if (dots > 1 || raw === ".") throw new Error("Invalid number.");
      tokens.push({ type: "number", value: Number(raw) }); continue;
    }
    if (/[+\-*/%()]/.test(s[i])) { tokens.push({ type: "op", value: s[i++] }); continue; }
    throw new Error(`Unsupported character “${s[i]}”.`);
  }
  tokens.push({ type: "eof", value: "" }); return tokens;
}
function evaluateCalc(input) {
  const tokens = tokenizeCalc(input); let p = 0;
  const peek = () => tokens[p]; const take = () => tokens[p++];
  function primary() {
    if (peek().value === "+") { take(); return primary(); }
    if (peek().value === "-") { take(); return -primary(); }
    if (peek().value === "(") { take(); const v = expression(0); if (take().value !== ")") throw new Error("Missing closing parenthesis."); return v; }
    if (peek().type === "number") return take().value;
    throw new Error("Expected a number or “(”.");
  }
  function expression(minPrec) {
    let left = primary();
    const next = tokens[p + 1];
    if (peek().value === "%" && (!next || next.type === "eof" || next.value === ")")) { take(); left /= 100; }
    const prec = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2 };
    while (peek().type === "op" && prec[peek().value] != null && prec[peek().value] >= minPrec) {
      const op = take().value; const right = expression(prec[op] + 1);
      if (op === "+") left += right; else if (op === "-") left -= right; else if (op === "*") left *= right; else if (op === "/") { if (right === 0) throw new Error("Division by zero."); left /= right; } else left %= right;
      if (!Number.isFinite(left)) throw new Error("Result is not finite.");
    }
    return left;
  }
  const value = expression(0); if (peek().type !== "eof") throw new Error("Unexpected operator or token."); return value;
}
function formatCalc(value) { return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(12))); }

function renderTabs() {
  const list = $("tabsList"); if (!list) return;
  list.innerHTML = state.tabs.map(t => `<div class="tab ${t.id === state.activeId ? "active" : ""}" data-tab="${esc(t.id)}">
    <span class="tab-favicon">${t.favicon ? `<img src="${esc(proxyUrl(t.favicon, "resource"))}" alt="" onerror="this.remove()">` : `<svg><use href="#i-globe"/></svg>`}</span>
    <span class="tab-title">${esc(t.title || "New Tab")}</span><button class="tab-close" data-close="${esc(t.id)}" title="Close tab">×</button></div>`).join("");
  list.querySelectorAll(".tab[data-tab]").forEach(el => el.onclick = e => { if (!e.target.closest("[data-close]")) switchTab(el.dataset.tab); });
  list.querySelectorAll("[data-close]").forEach(btn => btn.onclick = e => { e.stopPropagation(); closeTab(btn.dataset.close); });
}
function switchTab(id) {
  if (id === state.activeId || !state.tabs.some(t => t.id === id)) return;
  state.activeId = id; renderTabs();
  const t = activeTab();
  if (t?.view === "search") showSearch(t.searchQuery, false);
  else if (t?.view === "calculator") showCalculator(t.calcExpression || "", false);
  else if (t?.view === "home") showHome(false);
  else if (routeName() === "/dev" || routeName() === "/settings" || location.hash === "#console") goRouteFromUrl();
  else restoreTabView(t);
}
function closeTab(id) {
  const idx = state.tabs.findIndex(t => t.id === id); if (idx < 0) return;
  const t = state.tabs[idx];
  if (settings.confirmCloseWithCrawl && t.jobId && !t.done && !confirm("This tab has an active crawl running. Close it anyway?")) return;
  if (t.poll) clearInterval(t.poll);
  clearTimeout(t.browserPoll);
  if (t.browserSessionId) stopBrowserSession(t).catch(() => {});
  if (t.jobId && !t.done) stopJob(t.jobId, true).catch(() => {});
  destroyFrame(t.id);
  state.tabs.splice(idx, 1);
  if (!state.tabs.length) { const nt = makeTab(); state.tabs.push(nt); state.activeId = nt.id; }
  else if (state.activeId === id) state.activeId = state.tabs[Math.max(0, idx - 1)].id;
  renderTabs(); restoreTabView(activeTab());
}
function newTabAction() { const t = makeTab(); state.tabs.push(t); state.activeId = t.id; renderTabs(); settings.homepage ? openPage(settings.homepage) : showHome(); }
function cycleTab(delta) { if (state.tabs.length < 2) return; const i = state.tabs.findIndex(t => t.id === state.activeId); switchTab(state.tabs[(i + delta + state.tabs.length) % state.tabs.length].id); }
function showHome(pushRoute = true) {
  const t = activeTab(); if (t) t.view = "home";
  showView("homeView");
  $("address").value = ""; $("scheme").textContent = "https"; $("pageState").textContent = "Ready"; setLoading(false);
  if (pushRoute) { location.hash = ""; setRoute("/"); }
  renderTabs();
}
function showBrowser() {
  const t = activeTab(); if (t) t.view = "browser";
  showView("browserView");
  showFrameForTab(t);
  setRoute("/", "", "replace");
}
function showSearch(query = "", pushRoute = true) {
  const t = activeTab(); if (!t) return; t.view = "search"; t.searchQuery = String(query || "");
  showView("searchView");
  $("address").value = t.searchQuery; $("scheme").textContent = "search"; $("starBtn").classList.remove("saved");
  $("searchInput").value = t.searchQuery;
  if (pushRoute) setRoute("/search", t.searchQuery ? `?q=${encodeURIComponent(t.searchQuery)}` : "", "push");
  renderSearch(t.searchData || null);
  renderTabs();
  if (t.searchQuery && !t.searchData) runSearch(t.searchQuery, false).catch(e => renderSearchError(e));
}
function showCalculator(expression = "", pushRoute = true) {
  const t = activeTab(); if (!t) return; t.view = "calculator"; t.calcExpression = String(expression || "");
  showView("calculatorView");
  $("address").value = t.calcExpression || "Veyra Calculator"; $("scheme").textContent = "calc"; $("starBtn").classList.remove("saved"); $("calcInput").value = t.calcExpression;
  if (pushRoute) setRoute("/calculator", t.calcExpression ? `?q=${encodeURIComponent(t.calcExpression)}` : "", "push");
  renderCalculator(); renderTabs();
}
function showDownloads(pushRoute = true) {
  const t = activeTab(); if (t) t.view = "downloads"; showView("downloadsView");
  $("address").value = "Veyra Downloads"; $("scheme").textContent = "downloads"; $("starBtn").classList.remove("saved");
  if (pushRoute) setRoute("/downloads"); renderDownloads(); renderTabs();
}
function showHistory(pushRoute = true) {
  const t = activeTab(); if (t) t.view = "history"; showView("historyView");
  $("address").value = "Veyra History"; $("scheme").textContent = "history"; $("starBtn").classList.remove("saved");
  if (pushRoute) setRoute("/history"); renderHistory(); renderTabs();
}
function showExtensions(pushRoute = true) {
  const t = activeTab(); if (t) t.view = "extensions"; showView("extensionsView");
  $("address").value = "Veyra Extensions"; $("scheme").textContent = "extensions"; $("starBtn").classList.remove("saved");
  if (pushRoute) setRoute("/extensions"); renderExtensions(); renderTabs();
}
function toggleInspect(enabled = true) {
  const frame = activeFrame(), drawer = $("inspectDrawer"); if (!drawer) return;
  drawer.classList.toggle("hidden", !enabled); $("inspectHighlight")?.classList.toggle("hidden", !enabled);
  state.inspectMode = !!enabled; closeMenu(); const t=activeTab();
  if (t?.browserMode === "BROWSER_ENGINE" && t.browserSessionId) { ensureBrowserViewport()?.classList.toggle("hidden", false); addLog("info", enabled ? "Inspect mode enabled for real Chromium DOM." : "Inspect mode disabled."); return; }
  if (frame?.contentWindow) frame.contentWindow.postMessage({ type: "veyra:inspect", enabled: !!enabled }, new URL(API).origin);
  if (enabled) addLog("info", "Inspect mode enabled."); else addLog("info", "Inspect mode disabled.");
}

function renderDownloads() {
  const box = $("downloadsList"); if (!box) return;
  if (!state.downloads.length) { box.innerHTML = '<div class="empty">No downloads yet.</div>'; return; }
  box.innerHTML = state.downloads.map(d => `<article class="utility-item"><div class="utility-icon">↓</div><div class="utility-main"><b>${esc(d.name || "Download")}</b><span>${esc(d.url || "")} · ${esc(d.status || "queued")}${d.total ? ` · ${Math.round((d.received||0)/d.total*100)}%` : ""}</span></div><time>${esc(new Date(d.time || Date.now()).toLocaleString())}</time><div class="utility-actions"><button class="secondary tiny" data-redownload="${esc(d.url || "")}">Download again</button>${state.downloadControllers.has(d.id) ? `<button class="danger tiny" data-cancel-download="${esc(d.id)}">Cancel</button>` : ""}</div></article>`).join("");
  box.querySelectorAll("[data-redownload]").forEach(b => b.onclick = () => startDownload(b.dataset.redownload, "Download"));
  box.querySelectorAll("[data-cancel-download]").forEach(b => b.onclick = () => cancelDownload(b.dataset.cancelDownload));
}
function renderHistory() {
  const box = $("historyList"); if (!box) return;
  if (!state.history.length) { box.innerHTML = '<div class="empty">No history yet.</div>'; return; }
  box.innerHTML = state.history.map(h => `<article class="utility-item"><div class="utility-icon">${h.kind === "search" ? "⌕" : h.kind === "calculator" ? "∑" : "◌"}</div><div class="utility-main"><b>${esc(h.title || h.url)}</b><span>${esc(h.url)}</span></div><time>${esc(new Date(h.time || Date.now()).toLocaleString())}</time><button class="secondary tiny" data-history-url="${esc(h.url)}">Open</button></article>`).join("");
  box.querySelectorAll("[data-history-url]").forEach(b => b.onclick = () => { const h = state.history.find(x => x.url === b.dataset.historyUrl); if (!h) return; if (h.kind === "search") showSearch(String(h.url).replace(/^search:/, "")); else if (h.kind === "calculator") showCalculator(String(h.url).replace(/^calc:/, "")); else openPage(h.url); });
}
const EXT_STORE = [
  { id: "veyra-focus", name: "Focus Toolbar", version: "1.0.0", description: "Softens the Veyra browser chrome for reading." },
  { id: "veyra-reading", name: "Reading Surface", version: "1.0.0", description: "Adds a calmer reading surface around proxied pages." },
  { id: "veyra-compact", name: "Compact UI", version: "1.0.0", description: "Reduces toolbar and tab spacing." },
  { id: "veyra-shortcuts", name: "Power Shortcuts", version: "1.0.0", description: "Adds built-in keyboard shortcut hints and navigation helpers." }
];
function renderExtensions() {
  const box = $("extensionsGrid"), store = $("extensionStoreGrid"); if (!box || !store) return;
  box.innerHTML = state.extensions.map(x => `<article class="extension-card"><div class="extension-icon">${esc((x.name || "V").slice(0,1).toUpperCase())}</div><div class="extension-main"><h3>${esc(x.name || x.id)}</h3><p>${esc(x.description || "Veyra extension")}</p><span>v${esc(x.version || "1.0.0")} · ${esc(x.author || "Developer")}</span></div><label class="extension-toggle"><input type="checkbox" data-ext-toggle="${esc(x.id)}" ${x.enabled ? "checked" : ""}><i></i></label></article>`).join("") || '<div class="empty">No extensions installed.</div>';
  box.querySelectorAll("[data-ext-toggle]").forEach(i => i.onchange = () => toggleExtension(i.dataset.extToggle, i.checked));
  store.innerHTML = EXT_STORE.map(x => { const installed = state.extensions.some(e => e.id === x.id); return `<article class="extension-card"><div class="extension-icon">${esc(x.name.slice(0,1))}</div><div class="extension-main"><h3>${esc(x.name)}</h3><p>${esc(x.description)}</p><span>v${esc(x.version)} · Veyra Store</span></div><button class="secondary tiny" data-store-install="${esc(x.id)}">${installed ? "Installed" : "Add"}</button></article>`; }).join("");
  store.querySelectorAll("[data-store-install]").forEach(b => b.onclick = () => installStoreExtension(b.dataset.storeInstall));
  $("extensionDeveloperMode").checked = !!settings.extensionDeveloperMode; $("extensionDevCard").classList.toggle("hidden", !settings.extensionDeveloperMode);
}
function toggleExtension(id, enabled) { const x = state.extensions.find(e => e.id === id); if (!x) return; x.enabled = !!enabled; saveExtensions(); applyExtensions(); renderExtensions(); addLog("info", `${x.name} ${enabled ? "enabled" : "disabled"}.`); }
function installStoreExtension(id) { const store = EXT_STORE.find(x => x.id === id); if (!store) return; let x = state.extensions.find(e => e.id === id); if (!x) { x = { ...store, author: "Veyra Store", builtin: true, enabled: false }; state.extensions.push(x); } x.enabled = true; saveExtensions(); applyExtensions(); renderExtensions(); addLog("info", `${x.name} installed and enabled.`); }
async function startDownload(url, name = "Download") {
  if (!url || !/^https?:\/\//i.test(url)) return;
  const t = activeTab(); const sid = t?.proxySessionId || "";
  const item = { id: cryptoRandomId(), time: new Date().toISOString(), url, name, status: "starting", received: 0, total: 0 };
  state.downloads.unshift(item);
  if (state.downloads.length > (settings.downloadsMax || 200)) state.downloads.length = settings.downloadsMax || 200;
  saveDownloads(); renderDownloads();
  const controller = new AbortController(); state.downloadControllers.set(item.id, controller);
  const q = `${API}/api/download?url=${encodeURIComponent(url)}${sid ? `&sid=${encodeURIComponent(sid)}` : ""}`;
  try {
    const response = await rawFetch(q, { headers: { "X-Veyra-Request-ID": cryptoRandomId() }, signal: controller.signal });
    if (!response.ok) { let msg = `HTTP ${response.status}`; try { const j = await response.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
    item.total = Number(response.headers.get("content-length") || 0);
    const disposition = response.headers.get("content-disposition") || "";
    const m = disposition.match(/filename(?:\*|)=(?:UTF-8''|)?["']?([^"';]+)["']?/i); if (m && m[1]) item.name = decodeURIComponent(m[1]);
    const reader = response.body?.getReader(); const chunks = [];
    if (reader) { for (;;) { const part = await reader.read(); if (part.done) break; chunks.push(part.value); item.received += part.value.byteLength; item.status = item.total ? `${Math.floor(item.received / item.total * 100)}%` : `${Math.round(item.received / 1024)} KB`; renderDownloads(); } }
    else chunks.push(new Uint8Array(await response.arrayBuffer()));
    const blob = new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
    const objectUrl = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = objectUrl; a.download = item.name || name || "download"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 20000);
    item.status = "complete";
    addLog("info", `Download complete: ${item.name}`);
  } catch (e) { item.status = e?.name === "AbortError" ? "cancelled" : `error: ${e.message}`; addLog("error", `Download failed: ${e.message}`); }
  finally { state.downloadControllers.delete(item.id); saveDownloads(); renderDownloads(); }
}
function cancelDownload(id) { const c = state.downloadControllers.get(id); if (c) c.abort(); }

function setTool(panel, pushRoute = true) {
  showView("toolView");
  document.querySelectorAll(".tool-tab").forEach(x => x.classList.toggle("active", x.dataset.panel === panel));
  ["sourcePanel", "linkPanel", "consolePanel", "devPanel", "settingsPanel"].forEach(id => $(id).classList.toggle("hidden", id !== panel));
  if (panel === "sourcePanel") renderResources();
  if (panel === "linkPanel") loadLinks();
  if (panel === "consolePanel") { location.hash = "#console"; renderConsole(); }
  if (panel === "devPanel") { if (pushRoute) setRoute("/dev"); refreshDev(); startDevAuto(); }
  else if (state.devTimer) { clearInterval(state.devTimer); state.devTimer = null; }
  if (panel === "settingsPanel") { if (pushRoute) setRoute("/settings"); renderSettingsForm(); }
  if (panel === "sourcePanel" || panel === "linkPanel") { if (pushRoute) { location.hash = ""; setRoute("/"); } }
}
function restoreTabView(t) {
  if (!t) return;
  if (t.view === "browser" && t.url) {
    showBrowser(); updateIdentity(t.url);
    if (t.browserMode === "BROWSER_ENGINE" && t.browserSessionId) { showFrameForTab(t); refreshBrowserSurface(t,true); }
    else { const frame = getOrCreateFrame(t); const wantedProxy = proxyUrl(t.url, "view", t.proxySessionId); if (frame.src !== wantedProxy) frame.src = wantedProxy; showFrameForTab(t); }
    $("pageState").textContent = t.done ? "Ready" : (t.jobId ? "Loading…" : "Ready");
    $("serverState").textContent = t.browserMode === "BROWSER_ENGINE" ? "Browser engine" : (t.done ? "Crawler finished" : (t.jobId ? "Crawling…" : "Crawler idle"));
    $("serverState").className = "server-pill" + (t.browserMode === "BROWSER_ENGINE" || (!t.done && t.jobId) ? " live" : "");
    setLoading(!t.done && !!t.jobId && t.browserMode !== "BROWSER_ENGINE", 52, "Loading page…");
  } else if (t.view === "search") showSearch(t.searchQuery, false);
  else if (t.view === "calculator") showCalculator(t.calcExpression || "", false);
  else if (t.view === "downloads") showDownloads(false);
  else if (t.view === "history") showHistory(false);
  else if (t.view === "extensions") showExtensions(false);
  else showHome(false);
}

async function startJobForTab(t, url, loadFrame = true) {
  if (settings.autoStopPrevious && t.jobId && !t.done) stopJob(t.jobId, true).catch(() => {});
  if (t.browserSessionId) await stopBrowserSession(t);
  if (t.poll) clearInterval(t.poll);
  t.resources = []; t.links = []; t.selected = -1; t.remoteLogIds = new Set(); t.done = false; t.jobId = null; t.url = url; t.title = hostOf(url); t.view = "browser"; t.browserMode = "FAST_PROXY";
  showBrowser(); updateIdentity(url); setLoading(true, 16, "Choosing page runtime…");
  $("pageState").textContent = "Choosing runtime…"; $("serverState").textContent = "Capability detection"; $("serverState").className = "server-pill warn";
  let mode = "FAST_PROXY";
  try { const cap = await apiRequest('/api/browser/capability',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})}); mode = cap.body.mode || 'FAST_PROXY'; } catch(e) { addLog('debug',`Capability detection failed; using fast proxy: ${e.message}`); }
  if (mode === "BROWSER_ENGINE") {
    try {
      await startBrowserSession(t,url); recordHistory("page",t.url,t.title); renderTabs();
      // Indexing is background-only and never blocks the foreground browser session.
      apiRequest('/api/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})}).then(r=>{ t.jobId=r.body?.jobId||null; if(t.jobId)startPolling(t); }).catch(e=>addLog('debug',`Background indexing skipped: ${e.message}`));
      return;
    } catch(e) {
      t.browserMode='FAST_PROXY'; t.browserSessionId=''; addLog('warn',`Browser engine unavailable; falling back to FAST_PROXY: ${e.message}`);
      if (e.code === 'BROWSER_CAPACITY') renderProxyError('server', e);
    }
  }
  try {
    const { body } = await apiRequest("/api/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    t.jobId = body.jobId; t.url = body.url || url; t.proxyUrl = API + (body.viewUrl || (`/api/view?url=${encodeURIComponent(t.url)}`));
    recordHistory("page", t.url, t.title);
    if (activeTab() === t) { updateIdentity(t.url); $("pageState").textContent = `Loading ${hostOf(t.url)}…`; setLoading(true, 42, "Fetching document…"); if (loadFrame) getOrCreateFrame(t).src = proxyUrl(t.url, "view", t.proxySessionId); showFrameForTab(t); }
    startPolling(t); renderTabs();
  } catch (e) { t.jobId = null; t.done = true; if (activeTab() === t) renderProxyError("server", e); addLog("error", `Open failed: ${e.message}`, { requestId: e.requestId, stack: e.stack || "" }); }
}
async function navigateUrl(url, pushHistory = true, loadFrame = true) {
  const parsed = new URL(url); const t = activeTab(); if (!t) return;
  const canonical = parsed.href;
  if (pushHistory) { t.history = t.history.slice(0, t.histIndex + 1); t.history.push(canonical); t.histIndex = t.history.length - 1; }
  await startJobForTab(t, canonical, loadFrame); renderTabs();
}
async function openPage(input, pushHistory = true) {
  const result = classifyInput(input); if (!result) return;
  if (result.kind === "unsupported") { renderProxyError("unsupported", new Error("This address scheme is not proxied by Veyra.")); return; }
  if (result.kind === "search") { const t = activeTab(); if (t && pushHistory) { t.history = t.history.slice(0, t.histIndex + 1); t.history.push(`search:${result.query}`); t.histIndex = t.history.length - 1; } showSearch(result.query); return; }
  if (result.kind === "calculator") { const t = activeTab(); if (t && pushHistory) { t.history = t.history.slice(0, t.histIndex + 1); t.history.push(`calc:${result.expression}`); t.histIndex = t.history.length - 1; } showCalculator(result.expression); return; }
  let url; try { url = new URL(result.url).href; } catch { renderProxyError("invalid", new Error("Invalid URL.")); return; }
  if (!/^https?:$/.test(new URL(url).protocol)) { renderProxyError("unsupported", new Error("Only HTTP(S) websites are proxied.")); return; }
  await navigateUrl(url, pushHistory, true);
}

function startPolling(t) { if (t.poll) clearInterval(t.poll); pollJob(t); t.poll = setInterval(() => pollJob(t), 700); }
async function pollJob(t) {
  if (!state.tabs.includes(t) || !t.jobId) return;
  try {
    const { body: b } = await apiRequest(`/api/crawl/${encodeURIComponent(t.jobId)}`);
    if (!state.tabs.includes(t)) return; const isActive = activeTab() === t; const c = b.counts || {};
    if (isActive) {
      const gb = ((c.bytesScanned || 0) / 1073741824).toFixed(2);
      const w = b.workers || {};
      const rm = b.robotMesh?.summary || {};
      $("crawlSummary").textContent = b.done ? "Ready" : "Loading…";
      $("backendHealth").textContent = "Backend: online";
      $("serverState").textContent = b.done ? "Ready" : "Loading";
      $("serverState").className = "server-pill" + (b.done ? "" : " live");
      const denom = Math.max(1, (c.processed || 0) + (c.queued || 0) + 4); $("loadProgress").style.width = b.done ? "100%" : `${Math.min(88, 42 + ((c.processed || 0) / denom) * 45)}%`;
    }
    for (const x of b.logs || []) { if (t.remoteLogIds.has(x.id)) continue; t.remoteLogIds.add(x.id); state.logs.push({ time: new Date(x.time), level: x.level, message: `[${hostOf(t.url)}] ${x.message}` }); }
    if (state.logs.length > 2000) state.logs.splice(0, state.logs.length - 2000);
    if (!$("consolePanel").classList.contains("hidden")) renderConsole();
    if (b.done) {
      clearInterval(t.poll); t.poll = null; t.done = true;
      await Promise.all([loadResources(t), loadLinks(t)]);
      if (isActive) { setLoading(false); $("pageState").textContent = b.statusText || "Ready"; }
      if (b.status === "challenge") addLog("warn", `[${hostOf(t.url)}] Security verification stopped the crawl.`); else addLog("info", `[${hostOf(t.url)}] ${b.statusText || "Crawler finished."}`);
    }
  } catch (e) {
    if (activeTab() === t) $("backendHealth").textContent = "Backend: error";
    addLog("error", `Crawler status error: ${e.message}`, { requestId: e.requestId });
  }
}
async function stopJob(id, silent = false) {
  if (!id) return;
  try { await apiRequest(`/api/crawl/${encodeURIComponent(id)}/stop`, { method: "POST" }); if (!silent) addLog("warn", `Stop requested for job ${id}.`); refreshDev(); }
  catch (e) { if (!silent) addLog("error", `Stop failed: ${e.message}`, { requestId: e.requestId }); }
}
async function reloadActive() { const t = activeTab(); if (!t) return; if (t.browserSessionId) { try { setLoading(true,30,"Reloading…"); await apiRequest(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}/history`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({direction:'reload'})}); await refreshBrowserSurface(t,true); setLoading(false); return; } catch(e) { addLog('warn',`Browser reload failed: ${e.message}`); } } if (t.view === "browser" && t.url) await navigateUrl(t.url, false, true); else if (t.view === "search") await runSearch(t.searchQuery, true); else if (t.view === "calculator") renderCalculator(); }

async function loadResources(t = activeTab()) {
  if (!t?.jobId) return;
  try { const { body } = await apiRequest(`/api/crawl/${encodeURIComponent(t.jobId)}/resources`); t.resources = body.resources || []; if (activeTab() === t) renderResources(); }
  catch (e) { addLog("error", `Source list failed: ${e.message}`, { requestId: e.requestId }); }
}
function renderResources() {
  const t = activeTab(), box = $("resourceList"); if (!box || !t) return;
  if (!t.resources.length) { box.innerHTML = '<div class="empty">No captured text resources yet.</div>'; return; }
  const q = String($("sourceTitle").dataset.filter || "").toLowerCase(); const arr = t.resources.filter(r => !q || r.url.toLowerCase().includes(q) || String(r.type).includes(q));
  box.innerHTML = arr.map(r => `<div class="resource ${r.id === t.selected ? "active" : ""}" data-id="${r.id}"><div class="rtype">${esc(r.type)} · ${esc(String(r.status))}</div><div class="rurl">${esc(pathOf(r.url))}</div><div class="rmeta">${esc(r.url)} · ${esc(r.bytesLabel || "")}${r.truncated ? " · truncated" : ""}</div></div>`).join("");
  box.querySelectorAll(".resource").forEach(el => el.onclick = () => selectResource(Number(el.dataset.id)));
}
async function selectResource(id) {
  const t = activeTab(); if (!t) return; t.selected = id; renderResources(); const r = t.resources.find(x => x.id === id); if (!r) return;
  $("sourceTitle").textContent = `${String(r.type).toUpperCase()} — ${pathOf(r.url)}`; $("sourceMeta").textContent = `${r.url} · ${r.status} · ${r.bytesLabel || ""}`; $("sourceCode").textContent = "Loading source…";
  try { const { body } = await apiRequest(`/api/crawl/${encodeURIComponent(t.jobId)}/source/${encodeURIComponent(id)}`); $("sourceCode").textContent = body.source || "[empty]"; }
  catch (e) { $("sourceCode").textContent = `SOURCE ERROR\n\n${e.stack || e.message || e}`; addLog("error", `Source fetch failed: ${e.message}`, { requestId: e.requestId }); }
}
async function loadLinks(t = activeTab()) {
  if (!t?.jobId) return;
  try {
    const { body } = await apiRequest(`/api/crawl/${encodeURIComponent(t.jobId)}/links?offset=0&limit=2000`); t.links = body.links || [];
    if (activeTab() !== t) return; $("linkCount").textContent = body.total ?? t.links.length;
    $("linkBody").innerHTML = t.links.map(l => `<tr><td><button class="link-open" data-url="${esc(l.url)}">${esc(pathOf(l.url))}</button></td><td>${esc(l.url)}</td><td>${esc(l.type)}</td><td>${esc(pathOf(l.source))}</td><td>${l.captured ? "captured" : "discovered"}</td></tr>`).join("");
    $("linkBody").querySelectorAll(".link-open").forEach(b => b.onclick = () => openPage(b.dataset.url));
  } catch (e) { addLog("error", `Links failed: ${e.message}`, { requestId: e.requestId }); }
}

// Search UI.
async function loadSearchSuggestions(query) {
  const list = $("searchSuggestions");
  if (!list) return;
  clearTimeout(state.searchSuggestTimer);
  const q = String(query || "").trim();
  if (!q) { list.innerHTML = ""; return; }
  state.searchSuggestTimer = setTimeout(async () => {
    try {
      const { body } = await apiRequest(`/api/search/suggest?q=${encodeURIComponent(q)}&limit=8`, { timeoutMs: 5000 });
      const suggestions = Array.isArray(body?.suggestions) ? body.suggestions : [];
      list.innerHTML = suggestions.map(x => `<option value="${esc(x)}"></option>`).join("");
    } catch {}
  }, 140);
}
async function loadSearchIndexStats() {
  try {
    const { body } = await apiRequest("/api/search/stats", { timeoutMs: 5000 });
    const text = `${Number(body.documents || 0).toLocaleString()} pages · ${Number(body.domains || 0).toLocaleString()} domains · ${Number(body.terms || 0).toLocaleString()} terms`;
    $("searchCoverage").textContent = `Veyra Index: ${text}`;
    return body;
  } catch (e) {
    $("searchCoverage").textContent = "Veyra Index: status unavailable";
    return null;
  }
}
async function runSearch(query, reload = false, offset = 0) {
  const t = activeTab(); if (!t) return; t.searchQuery = String(query || "").trim(); t.searchData = offset && t.searchData ? t.searchData : null; t.searchOffset = offset;
  if (t.view !== "search") showSearch(t.searchQuery, !reload); else { $("searchInput").value = t.searchQuery; $("address").value = t.searchQuery; renderSearch(t.searchData || null); }
  if (!t.searchQuery) { t.searchData = null; renderSearch(null); await loadSearchIndexStats(); return; }
  $("searchStat").textContent = "Searching Veyra…"; $("searchMeta").textContent = "Searching the local Veyra index.";
  try {
    const { body } = await apiRequest(`/api/search?q=${encodeURIComponent(t.searchQuery)}&offset=${offset}&limit=10`);
    if (offset && t.searchData) t.searchData.results = [...t.searchData.results, ...(body.results || [])]; else t.searchData = { ...body };
    t.searchOffset = offset; renderSearch(t.searchData); loadSearchSuggestions(t.searchQuery);
  } catch (e) { renderSearchError(e); addLog("error", `Search failed: ${e.message}`, { requestId: e.requestId }); }
}
function renderSearch(data) {
  const t = activeTab(); if (!t || t.view !== "search") return;
  $("searchInput").value = t.searchQuery; $("address").value = t.searchQuery;
  loadSearchSuggestions(t.searchQuery);
  if (!data) {
    $("searchStat").textContent = t.searchQuery ? "Ready" : "Search";
    $("searchMeta").textContent = "Search words, phrases, domains, or use operators like site: and intitle:.";
    $("searchResults").innerHTML = ""; $("searchMore").classList.add("hidden"); loadSearchIndexStats(); return;
  }
  const count = data.total == null ? `${data.results.length}+` : Number(data.total).toLocaleString();
  $("searchStat").textContent = `${count} result${Number(data.total) === 1 ? "" : "s"}`;
  const idx = data.indexStats || {};
  const indexText = `${Number(idx.documents ?? data.indexSize ?? 0).toLocaleString()} indexed pages · ${Number(idx.domains ?? 0).toLocaleString()} domains`;
  $("searchMeta").textContent = `${data.responseTimeMs ?? "—"} ms · ${data.provider === "local" ? "Veyra Index" : esc(data.provider || "Veyra")} · ${indexText}${data.cached ? " · cached" : ""}`;
  $("searchCoverage").textContent = `Veyra Index: ${indexText} · ${Number(idx.terms || 0).toLocaleString()} searchable terms`;
  $("searchResults").innerHTML = (data.results || []).map((r, i) => `<article class="search-result" tabindex="0" data-result="${i}" data-url="${esc(r.url)}"><div class="result-source"><span class="result-icon">${r.favicon ? `<img src="${esc(r.favicon)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span><div><b>${esc(r.title)}</b><div class="result-url">${esc(r.displayUrl || r.url)}</div><div class="result-domain">${esc(r.domain || hostOf(r.url))}${r.indexedAt ? ` · indexed ${new Date(r.indexedAt).toLocaleDateString()}` : ""}</div></div></div><p>${esc(r.snippet || "No description available.")}</p><div class="result-actions"><span class="result-source-label">Veyra Index</span><button class="result-open" data-url="${esc(r.url)}">Open in Veyra</button></div></article>`).join("") || `<div class="empty search-empty"><b>No indexed pages matched “${esc(t.searchQuery)}”.</b><p>Veyra does not fabricate results. Open a site and let its crawl complete, or configure INDEX_SEEDS on Render to grow Veyra's index automatically.</p><button class="secondary" id="searchOpenSite">Open a site to index</button></div>`;
  $("searchResults").querySelectorAll(".result-open").forEach(b => b.onclick = e => { e.stopPropagation(); openPage(b.dataset.url); });
  $("searchResults").querySelectorAll(".search-result").forEach(card => { card.onclick = e => { if (!e.target.closest("button")) openPage(card.dataset.url); }; });
  $("searchResults").querySelector("#searchOpenSite")?.addEventListener("click", () => { $("address").focus(); $("address").select(); });
  const more = data.total == null || data.results?.length < data.total; $("searchMore").classList.toggle("hidden", !more);
  $("searchMore").onclick = () => runSearch(t.searchQuery, false, (t.searchData?.results || []).length);
}
function renderSearchError(e) {
  $("searchStat").textContent = "Search error";
  $("searchMeta").textContent = e.code === "SEARCH_EMPTY" ? "Enter a search query." : "Veyra's index or provider could not complete the request.";
  $("searchResults").innerHTML = `<div class="error-card"><b>Veyra Search could not complete.</b><p>${esc(e.message || e)}</p><div class="error-actions"><button class="secondary" id="searchRetry">Retry</button><button class="secondary" id="searchOpenSite">Open a site to index</button><button class="secondary" id="searchCalc">Try Calculator</button></div></div>`;
  $("searchRetry").onclick = () => runSearch(activeTab()?.searchQuery || "", false, 0);
  $("searchCalc").onclick = () => showCalculator(activeTab()?.searchQuery || "");
  $("searchOpenSite").onclick = () => { $("address").focus(); $("address").select(); };
  $("searchMore").classList.add("hidden");
  loadSearchIndexStats();
}

function renderCalculator() {
  const t = activeTab(); if (!t || t.view !== "calculator") return;
  const input = String($("calcInput").value || t.calcExpression || "").trim(); t.calcExpression = input; $("address").value = input || "Veyra Calculator";
  if (!input) { $("calcResult").textContent = "0"; $("calcStatus").textContent = "Supports + − × ÷ % parentheses and negative numbers."; return; }
  try { const value = evaluateCalc(input); $("calcResult").textContent = formatCalc(value); $("calcStatus").textContent = "Calculated locally. No remote page was requested."; }
  catch (e) { $("calcResult").textContent = "—"; $("calcStatus").textContent = e.message || "Invalid expression."; }
}
function calcButtonInsert(value) { const input = $("calcInput"); const start = input.selectionStart ?? input.value.length; const end = input.selectionEnd ?? start; input.value = input.value.slice(0, start) + value + input.value.slice(end); input.focus(); input.selectionStart = input.selectionEnd = start + value.length; renderCalculator(); }

// Console / dev.
function renderConsole() {
  const filter = $("consoleFilter")?.value || "all"; const order = { error: 0, warn: 1, info: 2, debug: 3 }; const min = order[settings.consoleVerbosity] ?? 3;
  const rows = state.logs.filter(x => (filter === "all" || x.level === filter) && (order[x.level] ?? 2) <= min);
  $("consoleLog").innerHTML = rows.length ? rows.map(x => `<div class="log ${esc(x.level)}"><span class="time">${new Date(x.time).toLocaleTimeString([], { hour12:false })}</span><span class="level">${esc(x.level.toUpperCase())}</span><span class="msg">${esc(x.message)}</span></div>`).join("") : '<div class="empty">No matching logs.</div>';
  $("consoleLog").scrollTop = $("consoleLog").scrollHeight;
}
function fmtBytes(n) { n = Number(n) || 0; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n/1024).toFixed(1)} KB`; if (n < 1073741824) return `${(n/1048576).toFixed(2)} MB`; return `${(n/1073741824).toFixed(2)} GB`; }
function devPct(a, b) { return b > 0 ? Math.max(0, Math.min(100, a / b * 100)) : 0; }
async function refreshDev() {
  const t = activeTab(); if (!t?.jobId) { renderDevEmpty(); return; }
  try {
    const [jobR, robotsR, sysR, reqR] = await Promise.all([apiRequest(`/api/crawl/${encodeURIComponent(t.jobId)}`), apiRequest(`/api/crawl/${encodeURIComponent(t.jobId)}/robots?limit=48`), apiRequest("/api/debug/system"), apiRequest("/api/debug/requests?limit=200")]);
    const j = jobR.body; const robotData = robotsR.body || {}; const s = sysR.body;
    $("devJobGrid").innerHTML = [`Status|${j.statusText}`, `Root|${j.url}`, `Job|${j.id}`, `Processed|${j.counts.processed}`, `Queue|${j.counts.queued}`, `Active requests|${j.counts.active}`, `HTML/CSS/JS/Data/Assets|${j.counts.htmlPages} / ${j.counts.css} / ${j.counts.js} / ${j.counts.data || 0} / ${j.counts.assets || 0}`, `Logical robots|${j.workers?.logicalRobots || j.limits?.logicalRobots || 0}`, `Network slots|${j.workers?.networkSlots || j.limits?.maxActiveFetches || 0}`, `Available network slots|${j.workers?.availableNetworkSlots ?? "—"}`, `Bytes scanned|${fmtBytes(j.counts.bytesScanned)}`, `Bytes stored|${fmtBytes(j.counts.bytesStored)}`, `Retries|${j.counts.retries}`, `Challenges|${j.counts.challenges}`, `Host limit|${j.limits.perHostConcurrency}`].map(x => { const [a,b]=x.split("|"); return `<div><span>${esc(a)}</span><b>${esc(b)}</b></div>`; }).join("");
    $("devBarResources").style.width = devPct(j.counts.processed, j.limits.maxResources) + "%"; $("devBarResourcesLabel").textContent = `${j.counts.processed} / ${j.limits.maxResources}`;
    $("devBarScan").style.width = devPct(j.counts.bytesScanned, j.limits.maxScanBytes) + "%"; $("devBarScanLabel").textContent = `${fmtBytes(j.counts.bytesScanned)} / ${fmtBytes(j.limits.maxScanBytes)}`;
    $("devBarHtml").style.width = devPct(j.workers.html.active, j.workers.html.max) + "%"; $("devBarHtmlLabel").textContent = `${j.workers.html.active} / ${j.workers.html.max}`;
    $("devBarAsset").style.width = devPct(j.workers.asset.active, j.workers.asset.max) + "%"; $("devBarAssetLabel").textContent = `${j.workers.asset.active} / ${j.workers.asset.max}`;
    $("devRawJson").textContent = JSON.stringify(j, null, 2);
    const rm = robotData.summary || j.robotMesh?.summary || {};
    $("robotMeshSummary").textContent = `${rm.logicalRobots || 0} robots · ${rm.activeRobots || 0} active · ${rm.multitaskingRobots || 0} multitasking · ${rm.helpAccepted || 0} help accepted`;
    $("robotMeshGrid").innerHTML = [`Logical fleet|${rm.logicalRobots || 0}`, `Active robots|${rm.activeRobots || 0}`, `Multitasking|${rm.multitaskingRobots || 0}`, `Idle|${rm.idleRobots || 0}`, `Queued robot tasks|${rm.queuedRobotTasks || 0}`, `Global page queue|${rm.globalPageQueue || 0}`, `Global resource queue|${rm.globalResourceQueue || 0}`, `Network|${rm.networkActive || 0} / ${rm.networkLimit || 0}`, `Help requests|${rm.helpRequests || 0}`, `Accepted|${rm.helpAccepted || 0}`, `Declined|${rm.helpDeclined || 0}`, `Tasks shared|${rm.helpGiven || 0}`].map(x => { const [a,b]=x.split("|"); return `<div><span>${esc(a)}</span><b>${esc(b)}</b></div>`; }).join("");
    $("robotMeshBody").innerHTML = (robotData.robots || []).map(r => `<tr><td class="mono">${esc(r.id)}</td><td>${esc(r.status)}</td><td>${r.activeTasks}</td><td>${r.queuedTasks}</td><td>${r.completed}</td><td>${r.helpRequests}</td><td>${r.helpAccepted}</td><td>${r.helpDeclined}</td><td>${r.helpGiven}</td><td>${esc(r.lastTask?.url || "—")}</td></tr>`).join("") || '<tr><td colspan="10" class="empty">No robot activity to display.</td></tr>';
    const events = (robotData.events || []).slice().reverse().filter(e => String(e.type || "").startsWith("help-"));
    $("robotHelpBody").innerHTML = events.map(e => {
      const target = e.target || "—"; const requester = e.requester || "—";
      const detail = e.task ? `${e.task.type || "task"}: ${e.task.url || ""}` : e.accepted != null ? (e.accepted ? "accepted" : "declined") : (e.candidates ? `${e.candidates.length} candidates inspected` : "");
      return `<tr><td>${new Date(e.time).toLocaleTimeString([], {hour12:false})}</td><td>${esc(e.type)}</td><td class="mono">${esc(requester)}</td><td class="mono">${esc(target)}</td><td>${esc(detail)}</td></tr>`;
    }).join("") || '<tr><td colspan="5" class="empty">No help negotiations yet.</td></tr>';
    $("browserEngineGrid").innerHTML = [`Fetch slots|${s.network?.browserActive ?? 0} / ${s.network?.browserLimit ?? "—"}`, `Waiting browser requests|${s.network?.browserQueued ?? 0}`, `In-flight browser keys|${s.browser?.inFlight ?? 0}`, `Deduplicated|${s.browser?.deduped ?? 0}`, `Completed|${s.browser?.completed ?? 0}`, `Failed|${s.browser?.failed ?? 0}`, `Per-host limit|${s.network?.browserPerHost ?? "—"}`, `Sessions|${s.browser?.sessions ?? 0}`, `Proxy cache|${s.browser?.cacheEntries ?? s.proxyCacheEntries ?? 0}`, `Warm slots|${s.network?.warmActive ?? 0} / ${s.network?.warmLimit ?? "—"}`].map(x => { const [a,b]=x.split("|"); return `<div><span>${esc(a)}</span><b>${esc(b)}</b></div>`; }).join("");
    await refreshDevJobs();
    $("devSystemGrid").innerHTML = [`Uptime|${s.uptimeSec}s`, `Node|${s.nodeVersion}`, `Process role|${s.processRole}`, `RSS|${fmtBytes(s.memory.rss)}`, `Heap|${fmtBytes(s.memory.heapUsed)} / ${fmtBytes(s.memory.heapTotal)}`, `Active jobs|${s.jobs.active}`, `Crawler network slots|${s.network?.crawlerActive ?? 0} / ${s.network?.crawlerLimit ?? "—"}`, `Crawler logical robots|${s.network?.logicalRobots ?? "—"}`, `Crawler queued fetch waiters|${s.network?.crawlerQueued ?? 0}`, `Browser network slots|${s.network?.browserActive ?? 0} / ${s.network?.browserLimit ?? "—"}`, `Browser queued requests|${s.network?.browserQueued ?? 0}`, `Warm network slots|${s.network?.warmActive ?? 0} / ${s.network?.warmLimit ?? "—"}`, `Warm logical robots|${s.network?.warmLogicalRobots ?? "—"}`, `Search pages|${s.searchIndexEntries}`, `Search terms|${s.searchIndexTerms ?? "—"}`, `Search domains|${s.searchIndexDomains ?? "—"}`, `Proxy cache|${s.proxyCacheEntries}`, `Requests logged|${s.requestsLogged}`].map(x => { const [a,b]=x.split("|"); return `<div><span>${esc(a)}</span><b>${esc(b)}</b></div>`; }).join("");
    renderServerRequests(reqR.body.requests || []);
  } catch (e) { $("devJobGrid").innerHTML = `<div class="empty dev-error">Backend diagnostics failed: ${esc(e.message || e)}</div>`; }
}
async function refreshDevJobs() {
  try { const { body } = await apiRequest("/api/debug/jobs"); $("devJobsBody").innerHTML = (body.jobs || []).map(j => `<tr><td>${esc(j.id.slice(0,8))}</td><td>${esc(hostOf(j.url))}</td><td>${esc(j.status)}</td><td>${esc(String(j.counts.processed))}</td><td>${esc(String(j.linkCount))}</td><td>${j.done ? "" : `<button class="tiny secondary job-stop" data-job="${esc(j.id)}">Stop</button>`}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">No jobs.</td></tr>'; $("devJobsBody").querySelectorAll(".job-stop").forEach(b => b.onclick = () => stopJob(b.dataset.job)); }
  catch {}
}
function renderServerRequests(rows) { state.serverNetLog = rows; }
function renderDevNet() {
  const body = $("devNetBody"); if (!body) return; const f = state.devNetFilter;
  const rows = state.netLog.slice().reverse().filter(x => f === "all" ? true : f === "err" ? x.status === "ERR" || Number(x.status) >= 400 : Number(x.status) < 400).slice(0, 120);
  body.innerHTML = rows.length ? rows.map(x => `<tr class="${x.status === "ERR" || Number(x.status) >= 400 ? "neterr" : ""}"><td>${new Date(x.time).toLocaleTimeString([], {hour12:false})}</td><td>${esc(x.method)}</td><td>${esc(x.path)}</td><td>${esc(String(x.status))}</td><td>${x.ms}</td><td>${esc(x.requestId || "")}</td></tr>`).join("") : '<tr><td colspan="6" class="empty">No requests yet.</td></tr>';
}
function renderDevEmpty() {
  $("devJobGrid").innerHTML = '<div class="empty">No active crawl in this tab. Open a public website to start one.</div>';
  ["devBarResources","devBarScan","devBarHtml","devBarAsset"].forEach(id => $(id).style.width = "0%");
  $("devRawJson").textContent = "—";
  if ($("robotMeshSummary")) $("robotMeshSummary").textContent = "Waiting for robot telemetry…";
  if ($("robotMeshBody")) $("robotMeshBody").innerHTML = '<tr><td colspan="10" class="empty">No active crawl.</td></tr>';
  if ($("robotHelpBody")) $("robotHelpBody").innerHTML = '<tr><td colspan="5" class="empty">No active crawl.</td></tr>';
  if ($("browserEngineGrid")) $("browserEngineGrid").innerHTML = '<div class="empty">Open a page to see browser network scheduler activity.</div>';
  refreshDevJobs();
}
function startDevAuto() { if (state.devTimer) clearInterval(state.devTimer); if ($("devAutoRefresh")?.checked) state.devTimer = setInterval(refreshDev, Math.max(500, Number(settings.devRefreshMs) || 1500)); }

async function health() {
  try { await apiRequest("/health", { timeoutMs: 8000 }); $("backendHealth").textContent = "Backend: online"; }
  catch (e) { $("backendHealth").textContent = "Backend: offline"; addLog("error", `Backend health check failed: ${e.message}`, { requestId: e.requestId }); }
}
function saveBookmark() { const t = activeTab(); if (!t?.url) return; if (state.bookmarked.has(t.url)) state.bookmarked.delete(t.url); else state.bookmarked.add(t.url); safeStorageSet("veyra-bookmarks", JSON.stringify([...state.bookmarked])); updateIdentity(t.url); addLog("info", state.bookmarked.has(t.url) ? `Bookmarked ${t.url}` : "Removed bookmark."); }
function toggleMenu() { $("menuPanel").classList.toggle("hidden"); }
function closeMenu() { $("menuPanel").classList.add("hidden"); }

function renderProxyError(kind, error) {
  const t = activeTab(); if (t) t.view = "browser";
  showBrowser(); setLoading(false);
  const title = kind === "server" ? "Veyra could not reach the server" : kind === "unsupported" ? "This page cannot be proxied safely" : kind === "security" ? "This site requires its own security verification" : kind === "invalid" ? "That address is not valid" : "The page could not be displayed";
  const detail = error?.message || "An unknown error occurred.";
  const direct = t?.url ? `<a class="error-direct" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Open directly</a>` : "";
  getOrCreateFrame(t).srcdoc = `<main class="veyra-frame-error"><div class="error-icon">V</div><div class="eyebrow">VEYRA BROWSER</div><h1>${esc(title)}</h1><p>${esc(detail)}</p><div class="error-actions"><button onclick="parent.postMessage({type:'veyra:retry'},'*')">Retry</button>${direct}</div></main>`;
  $("pageState").textContent = title; $("serverState").textContent = kind === "security" ? "Challenge" : "Error"; $("serverState").className = "server-pill warn";
}

async function submitProxyForm(message) {
  const frame = activeFrame(); const form = document.createElement("form"); form.method = "POST"; form.action = proxyUrl(message.url, "view", activeTab()?.proxySessionId || ""); form.target = frame.name; form.style.display = "none";
  for (const [name, value] of message.entries || []) { const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.appendChild(input); }
  document.body.appendChild(form); form.submit(); form.remove();
}
async function handlePageMessage(e) {
  const d = e.data || {}; if (!d || typeof d !== "object" || !String(d.type || "").startsWith("veyra:")) return;
  try { if (e.origin !== new URL(API).origin) return; } catch { return; }
  const t = activeTab(); if (!t) return;
  if (d.sessionId && /^[A-Za-z0-9_-]{16,80}$/.test(String(d.sessionId))) t.proxySessionId = String(d.sessionId);
  if (d.type === "veyra:retry") { await reloadActive(); return; }
  if (d.type === "veyra:open" && d.url) { const nt = makeTab(); nt.proxySessionId = d.sessionId || t.proxySessionId || ""; state.tabs.push(nt); state.activeId = nt.id; renderTabs(); await openPage(d.url); return; }
  if (d.type === "veyra:unsupported") { addLog("warn", d.reason || "Unsupported page operation.", { pageUrl: d.pageUrl || t.url }); return; }
  if (d.type === "veyra:page-console") { addLog(d.level || "info", `[page:${hostOf(d.pageUrl || t.url)}] ${d.message || ""}`, { pageUrl: d.pageUrl || t.url, tabId: t.id, jobId: t.jobId }); return; }
  if (d.type === "veyra:page-error") { addLog("error", `[page:${hostOf(d.pageUrl || t.url)}] ${d.message || "Resource error"} @ ${d.url || "inline"}:${d.line || "?"}`, { pageUrl: d.pageUrl || t.url, line: d.line, column: d.column, stack: d.stack || "", tabId: t.id, jobId: t.jobId }); return; }
  if (d.type === "veyra:inspect-state") { state.inspectMode = !!d.enabled; return; }
  if (d.type === "veyra:inspect-hover" || d.type === "veyra:inspect-select") { renderInspectData(d); return; }
  if (d.type === "veyra:find-result") { $("findCount") && ($("findCount").textContent = `${Number(d.matches || 0).toLocaleString()} ${Number(d.matches || 0) === 1 ? "match" : "matches"}`); return; }
  if (d.type === "veyra:browser-network") { addLog(d.level || "debug", `[network:${hostOf(d.pageUrl || t.url)}] ${d.method || "GET"} ${d.url || ""} ${d.status || ""}`, { pageUrl: d.pageUrl || t.url }); return; }
  if (d.type === "veyra:form" && d.url) { await submitProxyForm(d); return; }
  if (d.type === "veyra:navigate" && d.url) {
    const target = canonicalizePageMessageUrl(d.url); if (!target) return;
    const same = t.url === target || t.url?.split("#")[0] === target.split("#")[0];
    if (d.source === "history.pushState" || d.source === "history.replaceState") {
      t.url = target; t.consolePageUrl = target; if (d.source.endsWith("pushState")) { t.history = t.history.slice(0, t.histIndex + 1); t.history.push(target); t.histIndex = t.history.length - 1; }
      if (d.title) t.title = d.title; if (d.favicon) t.favicon = d.favicon; updateIdentity(t.url); renderTabs(); return;
    }
    if (d.title) t.title = d.title; if (d.favicon) t.favicon = d.favicon;
    if (!same || t.view !== "browser") {
      t.history = t.history.slice(0, t.histIndex + 1); t.history.push(target); t.histIndex = t.history.length - 1;
      const currentFrameCanonical = parseProxyCanonical(activeFrame()?.src || "");
      if (currentFrameCanonical === target) await startJobForTab(t, target, false); else await startJobForTab(t, target, true);
      renderTabs();
    } else { updateIdentity(target); renderTabs(); }
  }
}
function parseProxyCanonical(src) { try { const u = new URL(src); return u.searchParams.get("url") || ""; } catch { return ""; } }
function canonicalizePageMessageUrl(value) {
  let raw = String(value || "").trim();
  for (let i = 0; i < 3; i++) {
    try {
      const u = new URL(raw);
      if ((u.pathname === "/api/view" || u.pathname === "/api/resource" || u.pathname === "/api/download")) {
        const embedded = u.searchParams.get("url") || u.searchParams.get("target") || u.searchParams.get("u");
        if (embedded) { raw = embedded; continue; }
      }
      if (/^https?:$/i.test(u.protocol)) return u.href;
      return "";
    } catch {
      try { const decoded = decodeURIComponent(raw); if (decoded !== raw && /^https?:\/\//i.test(decoded)) { raw = decoded; continue; } } catch {}
      return "";
    }
  }
  try { const u = new URL(raw); return /^https?:$/i.test(u.protocol) ? u.href : ""; } catch { return ""; }
}

function formatInspectCss(obj) { return Object.entries(obj || {}).map(([k,v]) => `${k}: ${v};`).join("\n"); }
function renderInspectData(d) {
  const drawer = $("inspectDrawer"), frame = activeFrame(), wrap = $("frameWrap"), hi = $("inspectHighlight"); if (!drawer || !d) return;
  $("inspectTargetName").textContent = `<${d.tag || "element"}>${d.id ? "#"+d.id : ""}${d.classes ? "."+String(d.classes).trim().split(/\s+/).slice(0,3).join(".") : ""}`;
  $("inspectOuterHtml").textContent = d.outerHTML || "[no markup available]";
  const parent = d.parent ? `<div class="inspect-node muted"><span>↳ parent</span><code>${esc((d.parent.tag || "element") + (d.parent.id ? "#" + d.parent.id : ""))}</code><small>${esc(d.parent.path || "")}</small></div>` : "";
  const children = Array.isArray(d.children) ? d.children.slice(0, 32).map(x => `<div class="inspect-node"><span>↳ child</span><code>${esc(x)}</code></div>`).join("") : "";
  $("inspectTree").innerHTML = `<div class="inspect-path"><b>DOM path</b><code>${esc(d.path || "")}</code></div>${parent}<div class="inspect-node selected"><span>● selected</span><code>&lt;${esc(d.tag || "element")}&gt;${d.id ? "#"+esc(d.id) : ""}${d.classes ? "."+esc(String(d.classes).trim().split(/\s+/).slice(0,3).join(".")) : ""}</code></div><div class="inspect-attrs">${Object.entries(d.attrs || {}).map(([k,v]) => `<span><b>${esc(k)}</b> <code>${esc(v)}</code></span>`).join("") || "No attributes"}</div>${children ? `<div class="inspect-children"><b>Children (${Math.min(32, d.children.length)})</b>${children}</div>` : ""}`;
  $("inspectStyles").textContent = formatInspectCss(d.styles);
  $("inspectComputed").textContent = formatInspectCss(d.computed);
  const r=d.rect||{}; $("inspectLayout").textContent = [`x: ${Math.round(r.x||0)}`,`y: ${Math.round(r.y||0)}`,`width: ${Math.round(r.width||0)}`,`height: ${Math.round(r.height||0)}`,`scrollWidth: ${d.scrollWidth||0}`,`scrollHeight: ${d.scrollHeight||0}`,`document: ${d.pageUrl||activeTab()?.url||""}`].join("\n");
  if (hi && frame && wrap && r) { const fr=frame.getBoundingClientRect(), wr=wrap.getBoundingClientRect(); hi.style.left=`${Math.max(0,fr.left-wr.left+(r.x||0))}px`; hi.style.top=`${Math.max(0,fr.top-wr.top+(r.y||0))}px`; hi.style.width=`${Math.max(0,r.width||0)}px`; hi.style.height=`${Math.max(0,r.height||0)}px`; hi.classList.remove("hidden"); }
}
function clearInspectHighlight(){ $("inspectHighlight")?.classList.add("hidden"); }
function setInspectTab(tab) { const map={elements:"inspectElementsPanel",styles:"inspectStylesPanel",computed:"inspectComputedPanel",layout:"inspectLayoutPanel"}; Object.entries(map).forEach(([k,id])=>$(id)?.classList.toggle("hidden",k!==tab)); document.querySelectorAll("[data-inspect-tab]").forEach(b=>b.classList.toggle("active",b.dataset.inspectTab===tab)); }

function renderSettingsForm() {
  $("setSearchMode").value = settings.searchMode; $("setSearchEngine").value = settings.searchEngine; $("setHomepage").value = settings.homepage || ""; $("setConfirmClose").checked = !!settings.confirmCloseWithCrawl; $("setAutoStop").checked = settings.autoStopPrevious !== false;
  $("setGlobalConcurrency").value = settings.crawlerGlobalConcurrency; $("setHostConcurrency").value = settings.crawlerHostConcurrency; $("setTimeout").value = settings.requestTimeoutMs; $("setBrowserFallback").checked = !!settings.browserFallback; $("setDevInterval").value = settings.devRefreshMs || 1500; $("setConsoleVerbosity").value = settings.consoleVerbosity || "all";
}
function wireSettingsForm() {
  $("setSearchMode").onchange = e => { settings.searchMode = e.target.value; saveSettings(); addLog("info", `Search mode set to ${e.target.value}.`); };
  $("setSearchEngine").onchange = e => { settings.searchEngine = e.target.value; saveSettings(); };
  $("setHomepage").onchange = e => { settings.homepage = e.target.value.trim(); saveSettings(); };
  $("setConfirmClose").onchange = e => { settings.confirmCloseWithCrawl = e.target.checked; saveSettings(); };
  $("setAutoStop").onchange = e => { settings.autoStopPrevious = e.target.checked; saveSettings(); };
  $("setGlobalConcurrency").onchange = e => { settings.crawlerGlobalConcurrency = Math.max(1, Math.min(256, Number(e.target.value) || 128)); saveSettings(); };
  $("setHostConcurrency").onchange = e => { settings.crawlerHostConcurrency = Math.max(1, Math.min(32, Number(e.target.value) || 8)); saveSettings(); };
  $("setTimeout").onchange = e => { settings.requestTimeoutMs = Math.max(1000, Number(e.target.value) || 15000); saveSettings(); };
  $("setBrowserFallback").onchange = e => { settings.browserFallback = e.target.checked; saveSettings(); };
  $("setDevInterval").onchange = e => { settings.devRefreshMs = Math.max(500, Number(e.target.value) || 1500); saveSettings(); startDevAuto(); };
  $("setConsoleVerbosity").onchange = e => { settings.consoleVerbosity = e.target.value; saveSettings(); renderConsole(); };
  $("settingsResetBtn").onclick = () => { settings = { ...DEFAULT_SETTINGS }; saveSettings(); renderSettingsForm(); addLog("info", "Settings reset to defaults."); };
  $("settingsClearBookmarks").onclick = () => { state.bookmarked.clear(); safeStorageSet("veyra-bookmarks", "[]"); updateIdentity(activeTab()?.url || ""); addLog("info", "Bookmarks cleared."); };
  $("settingsClearLogs").onclick = () => { state.logs = []; state.netLog = []; renderConsole(); renderDevNet(); addLog("info", "Console and network logs cleared."); };
}

function setupCalculator() {
  $("calcInput").oninput = () => renderCalculator(); $("calcInput").onkeydown = e => { if (e.key === "Enter") renderCalculator(); };
  document.querySelectorAll("[data-calc]").forEach(btn => btn.onclick = () => calcButtonInsert(btn.dataset.calc));
  $("calcClear").onclick = () => { $("calcInput").value = ""; renderCalculator(); };
  $("calcEquals").onclick = () => renderCalculator();
}

function setupConsoleCapture() {
  const levels = ["log", "info", "debug", "warn", "error"];
  for (const level of levels) {
    const native = console[level].bind(console);
    console[level] = (...args) => {
      native(...args);
      if (state.booted) addLog(level === "log" ? "info" : level, args.map(a => typeof a === "string" ? a : safeStringify(a)).join(" "));
    };
  }
}
function safeStringify(value) { try { return JSON.stringify(value); } catch { return String(value); } }

function showFatal(error) {
  const overlay = $("fatalOverlay"); if (!overlay) return;
  overlay.classList.remove("hidden"); $("fatalMessage").textContent = String(error?.message || error || "Unknown error");
}
function pageCommand(type, payload = {}) {
  const frame = activeFrame(); if (!frame?.contentWindow) return false;
  try { frame.contentWindow.postMessage({ type, ...payload }, new URL(API).origin); return true; } catch { return false; }
}
function printCurrentPage() {
  if (!activeTab()?.url) { addLog("warn", "No page to print."); return; }
  if (!pageCommand("veyra:print")) addLog("warn", "The current page cannot be printed yet.");
}
function updateFindBar() {
  const bar = $("findBar"), input = $("findInput"); if (!bar || !input) return;
  bar.classList.remove("hidden"); input.focus(); input.select();
  sendFindQuery(input.value);
}
function closeFindBar() { $("findBar")?.classList.add("hidden"); pageCommand("veyra:find-close"); $("address")?.focus(); }
function sendFindQuery(query, direction = "forward") {
  const q = String(query || "").slice(0, 200);
  pageCommand("veyra:find", { query: q, direction });
}
function findInPage() { updateFindBar(); }
function wireApp() {
  $("address").onkeydown = e => { if (e.key === "Enter") openPage($("address").value); };
  $("homeBrowse").onclick = () => openPage($("homeInput").value); $("homeInput").onkeydown = e => { if (e.key === "Enter") openPage($("homeInput").value); };
  document.querySelectorAll(".shortcuts [data-url]").forEach(b => b.onclick = () => openPage(b.dataset.url)); document.querySelectorAll(".shortcuts [data-tool]").forEach(b => b.onclick = () => showCalculator());
  $("homeBtn").onclick = () => showHome(); $("newTab").onclick = newTabAction; $("reloadBtn").onclick = reloadActive;
  $("backBtn").onclick = async () => { const t=activeTab(); if(!t)return; if(t.browserSessionId){try{await apiRequest(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}/history`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({direction:'back'})});await refreshBrowserSurface(t,true);return}catch{}} if(t.histIndex<=0)return; t.histIndex--; const target=t.history[t.histIndex]; if(target?.startsWith("search:")) showSearch(target.slice(7)); else if(target?.startsWith("calc:")) showCalculator(target.slice(5)); else openPage(target,false); };
  $("forwardBtn").onclick = async () => { const t=activeTab(); if(!t)return; if(t.browserSessionId){try{await apiRequest(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}/history`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({direction:'forward'})});await refreshBrowserSurface(t,true);return}catch{}} if(t.histIndex>=t.history.length-1)return; t.histIndex++; const target=t.history[t.histIndex]; if(target?.startsWith("search:")) showSearch(target.slice(7)); else if(target?.startsWith("calc:")) showCalculator(target.slice(5)); else openPage(target,false); };
  $("starBtn").onclick = saveBookmark; $("toolsMenuBtn").onclick = toggleMenu; document.querySelectorAll(".tool-tab").forEach(x=>x.onclick=()=>setTool(x.dataset.panel));
  $("backToPage").onclick = () => restoreTabView(activeTab()); $("menuBtn").onclick = toggleMenu;
  $("menuInspect").onclick=()=>{ toggleInspect(!state.inspectMode); closeMenu(); }; $("menuFind").onclick=()=>{closeMenu();findInPage()}; $("menuPrint").onclick=()=>{closeMenu();printCurrentPage()}; $("menuSource").onclick=()=>{closeMenu();setTool("sourcePanel")}; $("menuLinks").onclick=()=>{closeMenu();setTool("linkPanel")}; $("menuConsole").onclick=()=>{closeMenu();setTool("consolePanel")}; $("menuDev").onclick=()=>{closeMenu();setTool("devPanel")}; $("menuSettings").onclick=()=>{closeMenu();setTool("settingsPanel")}; $("menuDownloads").onclick=()=>{closeMenu();showDownloads()}; $("menuHistory").onclick=()=>{closeMenu();showHistory()}; $("menuExtensions").onclick=()=>{closeMenu();showExtensions()}; $("menuCalculator").onclick=()=>{closeMenu();showCalculator()}; $("menuSearch").onclick=()=>{closeMenu();showSearch()}; $("menuHome").onclick=()=>{closeMenu();newTabAction()};
  $("consoleFilter").onchange=renderConsole; $("clearConsole").onclick=()=>{state.logs=[];renderConsole();addLog("info","Console cleared.")};
  $("copyConsole").onclick=async()=>{try{await navigator.clipboard.writeText(state.logs.map(x=>`[${new Date(x.time).toISOString()}] [${x.level.toUpperCase()}] ${x.message}`).join("\n"));addLog("info","Console copied.")}catch(e){addLog("error",`Copy failed: ${e.message}`)}};
  $("devRefreshBtn").onclick=refreshDev; $("devStopBtn").onclick=()=>{const t=activeTab();if(t?.jobId)stopJob(t.jobId);else addLog("warn","No active crawl to stop.")}; $("devAutoRefresh").onchange=startDevAuto; $("devNetFilter").onchange=e=>{state.devNetFilter=e.target.value;renderDevNet()}; $("devNetClear").onclick=()=>{state.netLog=[];renderDevNet()}; $("devCopyJsonBtn").onclick=async()=>{try{await navigator.clipboard.writeText($("devRawJson").textContent||"");addLog("info","Raw job JSON copied.")}catch(e){addLog("error",`Copy failed: ${e.message}`)}};
  $("devExportBtn").onclick=()=>{const t=activeTab();if(!t?.jobId)return addLog("warn","No active crawl to export.");window.open(API+"/api/crawl/"+encodeURIComponent(t.jobId)+"/export","_blank","noopener")};
  $("searchButton").onclick=()=>runSearch($("searchInput").value,false,0); $("searchInput").oninput=e=>loadSearchSuggestions(e.target.value); $("searchInput").onkeydown=e=>{if(e.key==="Enter")runSearch($("searchInput").value,false,0)}; $("homeInput").oninput=e=>loadSearchSuggestions(e.target.value);
  $("downloadBtn").onclick=()=>{const t=activeTab();if(t?.url)startDownload(t.url,`${hostOf(t.url)}-page`);else showDownloads()};
  $("clearDownloadsBtn").onclick=()=>{for(const c of state.downloadControllers.values())c.abort();state.downloads=[];saveDownloads();renderDownloads()}; $("clearHistoryBtn").onclick=()=>{state.history=[];saveHistory();renderHistory()};
  $("findInput").oninput=e=>sendFindQuery(e.target.value); $("findInput").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();sendFindQuery(e.target.value,e.shiftKey?"backward":"forward")}else if(e.key==="Escape"){e.preventDefault();closeFindBar()}}; $("findNext").onclick=()=>sendFindQuery($("findInput").value,"forward"); $("findPrev").onclick=()=>sendFindQuery($("findInput").value,"backward"); $("findClose").onclick=closeFindBar;
  $("extensionStoreBtn").onclick=()=>{$("extensionStore").classList.toggle("hidden");}; $("extensionDevBtn").onclick=()=>{settings.extensionDeveloperMode=!settings.extensionDeveloperMode;saveSettings();renderExtensions();if(settings.extensionDeveloperMode)$('extensionDevCard').scrollIntoView({behavior:'smooth',block:'nearest'});};
  $("extensionDeveloperMode").onchange=e=>{settings.extensionDeveloperMode=e.target.checked;saveSettings();renderExtensions()}; $("loadExtensionBtn").onclick=()=>{if(!settings.extensionDeveloperMode){addLog("warn","Enable Developer mode first.");return;} $("extensionFile").click()};
  $("extensionFile").onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{const data=safeJsonParse(await file.text(),null);const ext=validateExtensionManifest(data);const existing=state.extensions.find(x=>x.id===ext.id);if(existing)Object.assign(existing,ext,{enabled:existing.enabled});else state.extensions.push(ext);saveExtensions();applyExtensions();renderExtensions();addLog("info",`Loaded extension ${ext.name}.`)}catch(err){addLog("error",`Extension load failed: ${err.message}`)}finally{e.target.value=""}};
  $("exportExtensionsBtn").onclick=()=>exportExtensions();
  $("inspectCloseBtn").onclick=()=>toggleInspect(false); document.querySelectorAll("[data-inspect-tab]").forEach(b=>b.onclick=()=>setInspectTab(b.dataset.inspectTab));
  $("fatalReload").onclick=()=>location.reload(); $("fatalConsole").onclick=()=>{$("fatalOverlay").classList.add("hidden");setTool("consolePanel")}; wireSettingsForm();setupCalculator();setupConsoleCapture();
}
function validateExtensionManifest(data){
  if(!data||typeof data!=="object")throw new Error("Manifest must be a JSON object.");
  const id=String(data.id||"").trim(); const name=String(data.name||"").trim(); const version=String(data.version||"1.0.0").trim();
  if(!/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(id))throw new Error("Invalid extension id."); if(!name||name.length>80)throw new Error("Invalid extension name.");
  if(data.script||data.js||data.background||data.contentScript||data.permissions?.includes?.("network"))throw new Error("This Veyra extension format does not allow arbitrary script/network access.");
  const css=Array.isArray(data.css)?data.css.filter(x=>typeof x==="string"):typeof data.css==="string"?[data.css]:[];
  return {id,name,version,description:String(data.description||"").slice(0,500),author:String(data.author||"Developer").slice(0,80),css:css.map(x=>x.slice(0,20000)).slice(0,8),permissions:Array.isArray(data.permissions)?data.permissions.filter(x=>typeof x==="string").slice(0,12):[],enabled:false,builtin:false,developer:true};
}
function exportExtensions(){const blob=new Blob([JSON.stringify(state.extensions,null,2)],{type:"application/json"});const u=URL.createObjectURL(blob);const a=document.createElement("a");a.href=u;a.download="veyra-extensions.json";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}


window.addEventListener("message", e => handlePageMessage(e).catch(err => addLog("error", `Page message handling failed: ${err.message}`)));
window.addEventListener("error", e => addLog("error", `Frontend error: ${e.message} @ ${e.filename || "inline"}:${e.lineno || "?"}`, { line: e.lineno, column: e.colno, stack: e.error?.stack || "" }));
window.addEventListener("unhandledrejection", e => addLog("error", `Unhandled promise: ${e.reason?.message || e.reason || "Unknown rejection"}`, { stack: e.reason?.stack || "" }));
document.addEventListener("click", e => { const menu = $("menuPanel"); if (menu && !menu.contains(e.target) && e.target !== $("menuBtn")) closeMenu(); });
window.addEventListener("keydown", e => {
  const mod = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "") ? e.metaKey : e.ctrlKey;
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) && !e.altKey && !mod; const key = e.key.toLowerCase();
  if (mod && key === "r") { e.preventDefault(); reloadActive(); return; } if ((mod && key === "t") || (e.altKey && key === "t")) { e.preventDefault(); newTabAction(); return; }
  if ((mod && key === "w") || (e.altKey && key === "w")) { e.preventDefault(); closeTab(state.activeId); return; } if ((mod && key === "tab" && !e.shiftKey) || (e.altKey && key === "]")) { e.preventDefault(); cycleTab(1); return; }
  if ((mod && key === "tab" && e.shiftKey) || (e.altKey && key === "[")) { e.preventDefault(); cycleTab(-1); return; } if ((mod && key === "l") || (!typing && key === "/")) { e.preventDefault(); $("address").focus(); $("address").select(); return; }
  if (mod && key === "d") { e.preventDefault(); saveBookmark(); return; } if (mod && e.shiftKey && key === "d") { e.preventDefault(); setTool("devPanel"); return; } if (mod && key === ",") { e.preventDefault(); setTool("settingsPanel"); return; }
  if (mod && key === "j") { e.preventDefault(); showDownloads(); return; } if (mod && key === "h") { e.preventDefault(); showHistory(); return; } if (mod && key === "f") { e.preventDefault(); findInPage(); return; } if (mod && key === "p") { e.preventDefault(); printCurrentPage(); return; } if (mod && e.shiftKey && key === "i") { e.preventDefault(); toggleInspect(!state.inspectMode); return; }
  if (!typing && key === "escape") { if (state.inspectMode) { toggleInspect(false); return; } const t = activeTab(); if (t?.jobId && !t.done) stopCurrentLoad(); return; } if (e.altKey && key === "arrowleft") { e.preventDefault(); $("backBtn").click(); } if (e.altKey && key === "arrowright") { e.preventDefault(); $("forwardBtn").click(); }
  if (activeTab()?.view === "search" && !typing && ["arrowdown", "arrowup", "enter"].includes(key)) { e.preventDefault(); const cards = [...document.querySelectorAll(".search-result")]; if (!cards.length) return; let i = cards.findIndex(x => x.classList.contains("keyboard-active")); if (key === "enter" && i >= 0) return openPage(cards[i].dataset.url); i = key === "arrowdown" ? Math.min(cards.length - 1, i + 1) : Math.max(0, i - 1); cards.forEach(x => x.classList.remove("keyboard-active")); cards[i].classList.add("keyboard-active"); cards[i].focus(); }
});

function boot() {
  try {
    const firstTab = makeTab(); state.tabs.push(firstTab); state.activeId = firstTab.id; state.booted = true; renderTabs(); wireApp();
    let route = routeName();
    const routeParam = new URLSearchParams(location.search).get("veyra_route");
    if (routeParam) { history.replaceState({ veyraRoute: routeParam }, "", routeUrl(routeParam)); route = routeName(); }
    if (route === "/dev") setTool("devPanel", false); else if (route === "/settings") setTool("settingsPanel", false); else if (route === "/downloads") showDownloads(false); else if (route === "/history") showHistory(false); else if (route === "/extensions") showExtensions(false); else if (route === "/calculator") showCalculator(new URLSearchParams(location.search).get("q") || "", false); else if (route === "/search") showSearch(new URLSearchParams(location.search).get("q") || "", false); else if (location.hash === "#console") setTool("consolePanel", false); else if (settings.homepage) openPage(settings.homepage); else showHome(false);
    applyExtensions(); renderExtensions(); health(); addLog("info", "Veyra Browser ready. Browser engine, inspect mode, downloads, history, extensions, Veyra Search, and diagnostics enabled.");
  } catch (e) { showFatal(e); }
}
boot();
