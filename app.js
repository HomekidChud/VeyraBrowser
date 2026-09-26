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
  crawlerGlobalConcurrency: 12,
  crawlerHostConcurrency: 3,
  requestTimeoutMs: 15000,
  browserFallback: false
};
let settings = { ...DEFAULT_SETTINGS, ...safeJsonParse(safeStorageGet("veyra-settings", "{}"), {}) };
function saveSettings() { safeStorageSet("veyra-settings", JSON.stringify(settings)); }

const bookmarkList = safeJsonParse(safeStorageGet("veyra-bookmarks", "[]"), []);
const state = {
  tabs: [], activeId: null, tabSeq: 0,
  logs: [], netLog: [], devTimer: null, devNetFilter: "all",
  bookmarked: new Set(Array.isArray(bookmarkList) ? bookmarkList.filter(x => typeof x === "string") : []),
  clientLogQueue: [], clientLogTimer: null,
  booted: false
};
function makeTab() {
  return {
    id: "t" + (++state.tabSeq), title: "New Tab", favicon: "", url: "", proxyUrl: "", jobId: null, done: false,
    history: [], histIndex: -1, view: "home", searchQuery: "", searchOffset: 0, searchData: null,
    consolePageUrl: "", remoteLogIds: new Set(), resources: [], links: [], selected: -1, poll: null
  };
}
function activeTab() { return state.tabs.find(t => t.id === state.activeId); }

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
function proxyUrl(url, mode = "view") { return API + (mode === "resource" ? "/api/resource?url=" : "/api/view?url=") + encodeURIComponent(url); }

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
  const line = $("loadProgress"), box = $("frameLoader");
  if (!line || !box) return;
  line.style.width = on ? `${Math.max(6, Math.min(100, pct))}%` : "0%";
  box.classList.toggle("hidden", !on);
  $("frameLoaderText").textContent = message;
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
  if (t.jobId && !t.done) stopJob(t.jobId, true).catch(() => {});
  state.tabs.splice(idx, 1);
  if (!state.tabs.length) { const nt = makeTab(); state.tabs.push(nt); state.activeId = nt.id; }
  else if (state.activeId === id) state.activeId = state.tabs[Math.max(0, idx - 1)].id;
  renderTabs(); restoreTabView(activeTab());
}
function newTabAction() { const t = makeTab(); state.tabs.push(t); state.activeId = t.id; renderTabs(); settings.homepage ? openPage(settings.homepage) : showHome(); }
function cycleTab(delta) { if (state.tabs.length < 2) return; const i = state.tabs.findIndex(t => t.id === state.activeId); switchTab(state.tabs[(i + delta + state.tabs.length) % state.tabs.length].id); }
function showHome(pushRoute = true) {
  const t = activeTab(); if (t) t.view = "home";
  $("homeView").classList.remove("hidden"); $("browserView").classList.add("hidden"); $("searchView").classList.add("hidden"); $("calculatorView").classList.add("hidden"); $("toolView").classList.add("hidden");
  $("address").value = ""; $("scheme").textContent = "https"; $("pageState").textContent = "Ready"; setLoading(false);
  if (pushRoute) { location.hash = ""; setRoute("/"); }
  renderTabs();
}
function showBrowser() {
  const t = activeTab(); if (t) t.view = "browser";
  $("homeView").classList.add("hidden"); $("browserView").classList.remove("hidden"); $("searchView").classList.add("hidden"); $("calculatorView").classList.add("hidden"); $("toolView").classList.add("hidden");
  setRoute("/", "", "replace");
}
function showSearch(query = "", pushRoute = true) {
  const t = activeTab(); if (!t) return; t.view = "search"; t.searchQuery = String(query || "");
  $("homeView").classList.add("hidden"); $("browserView").classList.add("hidden"); $("calculatorView").classList.add("hidden"); $("toolView").classList.add("hidden"); $("searchView").classList.remove("hidden");
  $("address").value = t.searchQuery; $("scheme").textContent = "search"; $("starBtn").classList.remove("saved");
  $("searchInput").value = t.searchQuery;
  if (pushRoute) setRoute("/search", t.searchQuery ? `?q=${encodeURIComponent(t.searchQuery)}` : "", "push");
  renderSearch(t.searchData || null);
  renderTabs();
  if (t.searchQuery && !t.searchData) runSearch(t.searchQuery, false).catch(e => renderSearchError(e));
}
function showCalculator(expression = "", pushRoute = true) {
  const t = activeTab(); if (!t) return; t.view = "calculator"; t.calcExpression = String(expression || "");
  $("homeView").classList.add("hidden"); $("browserView").classList.add("hidden"); $("searchView").classList.add("hidden"); $("toolView").classList.add("hidden"); $("calculatorView").classList.remove("hidden");
  $("address").value = t.calcExpression || "Veyra Calculator"; $("scheme").textContent = "calc"; $("starBtn").classList.remove("saved"); $("calcInput").value = t.calcExpression;
  if (pushRoute) setRoute("/calculator", t.calcExpression ? `?q=${encodeURIComponent(t.calcExpression)}` : "", "push");
  renderCalculator(); renderTabs();
}
function setTool(panel, pushRoute = true) {
  $("homeView").classList.add("hidden"); $("browserView").classList.add("hidden"); $("searchView").classList.add("hidden"); $("calculatorView").classList.add("hidden"); $("toolView").classList.remove("hidden");
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
    const wantedProxy = proxyUrl(t.url, "view");
    if ($("pageFrame").src !== wantedProxy) $("pageFrame").src = wantedProxy;
    $("pageState").textContent = t.done ? "Ready" : (t.jobId ? "Loading…" : "Ready");
    $("serverState").textContent = t.done ? "Crawler finished" : (t.jobId ? "Crawling…" : "Crawler idle");
    $("serverState").className = "server-pill" + (!t.done && t.jobId ? " live" : "");
    setLoading(!t.done && !!t.jobId, 52, "Loading page…");
  } else if (t.view === "search") showSearch(t.searchQuery, false);
  else if (t.view === "calculator") showCalculator(t.calcExpression || "", false);
  else showHome(false);
}

async function startJobForTab(t, url, loadFrame = true) {
  if (settings.autoStopPrevious && t.jobId && !t.done) stopJob(t.jobId, true).catch(() => {});
  if (t.poll) clearInterval(t.poll);
  t.resources = []; t.links = []; t.selected = -1; t.remoteLogIds = new Set(); t.done = false; t.jobId = null; t.url = url; t.title = hostOf(url); t.view = "browser";
  showBrowser(); updateIdentity(url); setLoading(true, 16, "Connecting…");
  $("pageState").textContent = "Connecting…"; $("serverState").textContent = "Starting crawl"; $("serverState").className = "server-pill warn";
  try {
    const { body } = await apiRequest("/api/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    t.jobId = body.jobId; t.url = body.url || url; t.proxyUrl = API + (body.viewUrl || (`/api/view?url=${encodeURIComponent(t.url)}`));
    if (activeTab() === t) {
      updateIdentity(t.url); $("pageState").textContent = `Loading ${hostOf(t.url)}…`; setLoading(true, 42, "Fetching document…");
      if (loadFrame) $("pageFrame").src = proxyUrl(t.url, "view");
    }
    startPolling(t); renderTabs();
  } catch (e) {
    t.jobId = null; t.done = true;
    if (activeTab() === t) renderProxyError("server", e);
    addLog("error", `Open failed: ${e.message}`, { requestId: e.requestId, stack: e.stack || "" });
  }
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
      $("crawlSummary").textContent = `Crawler: ${c.processed || 0} processed · ${c.htmlPages || 0} HTML · ${c.css || 0} CSS · ${c.js || 0} JS · ${c.links || 0} links · ${gb} GB scanned`;
      $("backendHealth").textContent = "Backend: online";
      $("serverState").textContent = b.statusText || (b.done ? "Crawler finished" : "Crawling…");
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
async function reloadActive() { const t = activeTab(); if (!t) return; if (t.view === "browser" && t.url) await navigateUrl(t.url, false, true); else if (t.view === "search") await runSearch(t.searchQuery, true); else if (t.view === "calculator") renderCalculator(); }

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
async function runSearch(query, reload = false, offset = 0) {
  const t = activeTab(); if (!t) return; t.searchQuery = String(query || "").trim(); t.searchData = offset && t.searchData ? t.searchData : null; t.searchOffset = offset;
  if (t.view !== "search") showSearch(t.searchQuery, !reload); else { $("searchInput").value = t.searchQuery; $("address").value = t.searchQuery; renderSearch(t.searchData || null); }
  if (!t.searchQuery) { t.searchData = null; renderSearch(null); return; }
  $("searchStat").textContent = "Searching…"; $("searchMeta").textContent = "";
  try {
    const { body } = await apiRequest(`/api/search?q=${encodeURIComponent(t.searchQuery)}&offset=${offset}&limit=10`);
    if (offset && t.searchData) t.searchData.results = [...t.searchData.results, ...(body.results || [])]; else t.searchData = { ...body };
    t.searchOffset = offset; renderSearch(t.searchData);
  } catch (e) { renderSearchError(e); addLog("error", `Search failed: ${e.message}`, { requestId: e.requestId }); }
}
function renderSearch(data) {
  const t = activeTab(); if (!t || t.view !== "search") return;
  $("searchInput").value = t.searchQuery; $("address").value = t.searchQuery;
  if (!data) { $("searchStat").textContent = t.searchQuery ? "Ready" : "Search"; $("searchMeta").textContent = "Type a question, topic, or keyword. URLs open in the Veyra browser."; $("searchResults").innerHTML = ""; $("searchMore").classList.add("hidden"); return; }
  const count = data.total == null ? `${data.results.length}+` : data.total; $("searchStat").textContent = `${count} result${Number(data.total) === 1 ? "" : "s"}`;
  $("searchMeta").textContent = `${data.responseTimeMs ?? "—"} ms · ${esc(data.provider || "Veyra")}${data.cached ? " · cached" : ""}`;
  $("searchResults").innerHTML = (data.results || []).map((r, i) => `<article class="search-result" tabindex="0" data-result="${i}" data-url="${esc(r.url)}"><div class="result-source"><span class="result-icon">${r.favicon ? `<img src="${esc(r.favicon)}" alt="" onerror="this.remove()">` : ""}</span><div><b>${esc(r.title)}</b><div class="result-url">${esc(r.displayUrl || r.url)}</div></div></div><p>${esc(r.snippet || "No description available.")}</p><div class="result-actions"><button class="result-open" data-url="${esc(r.url)}">Open in Veyra</button></div></article>`).join("") || '<div class="empty">No results matched this query.</div>';
  $("searchResults").querySelectorAll(".result-open").forEach(b => b.onclick = e => { e.stopPropagation(); openPage(b.dataset.url); });
  $("searchResults").querySelectorAll(".search-result").forEach(card => { card.onclick = e => { if (!e.target.closest("button")) openPage(card.dataset.url); }; });
  const more = data.total == null || data.results?.length < data.total; $("searchMore").classList.toggle("hidden", !more);
  $("searchMore").onclick = () => runSearch(t.searchQuery, false, (t.searchData?.results || []).length);
}
function renderSearchError(e) {
  $("searchStat").textContent = "Search unavailable";
  $("searchMeta").textContent = e.code === "SEARCH_NOT_CONFIGURED" || e.status === 503 ? "Veyra Search is waiting for a configured provider or indexed content." : "The search provider returned an error.";
  $("searchResults").innerHTML = `<div class="error-card"><b>Search could not complete.</b><p>${esc(e.message || e)}</p><button class="secondary" id="searchRetry">Retry</button><button class="secondary" id="searchCalc">Try Calculator</button></div>`;
  $("searchRetry").onclick = () => runSearch(activeTab()?.searchQuery || "", false, 0);
  $("searchCalc").onclick = () => showCalculator(activeTab()?.searchQuery || "");
  $("searchMore").classList.add("hidden");
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
    const [jobR, sysR, reqR] = await Promise.all([apiRequest(`/api/crawl/${encodeURIComponent(t.jobId)}`), apiRequest("/api/debug/system"), apiRequest("/api/debug/requests?limit=200")]);
    const j = jobR.body; const s = sysR.body;
    $("devJobGrid").innerHTML = [`Status|${j.statusText}`, `Root|${j.url}`, `Job|${j.id}`, `Processed|${j.counts.processed}`, `Queue|${j.counts.queued}`, `Active requests|${j.counts.active}`, `HTML/CSS/JS|${j.counts.htmlPages} / ${j.counts.css} / ${j.counts.js}`, `Bytes scanned|${fmtBytes(j.counts.bytesScanned)}`, `Bytes stored|${fmtBytes(j.counts.bytesStored)}`, `Retries|${j.counts.retries}`, `Challenges|${j.counts.challenges}`, `Host limit|${j.limits.perHostConcurrency}`].map(x => { const [a,b]=x.split("|"); return `<div><span>${esc(a)}</span><b>${esc(b)}</b></div>`; }).join("");
    $("devBarResources").style.width = devPct(j.counts.processed, j.limits.maxResources) + "%"; $("devBarResourcesLabel").textContent = `${j.counts.processed} / ${j.limits.maxResources}`;
    $("devBarScan").style.width = devPct(j.counts.bytesScanned, j.limits.maxScanBytes) + "%"; $("devBarScanLabel").textContent = `${fmtBytes(j.counts.bytesScanned)} / ${fmtBytes(j.limits.maxScanBytes)}`;
    $("devBarHtml").style.width = devPct(j.workers.html.active, j.workers.html.max) + "%"; $("devBarHtmlLabel").textContent = `${j.workers.html.active} / ${j.workers.html.max}`;
    $("devBarAsset").style.width = devPct(j.workers.asset.active, j.workers.asset.max) + "%"; $("devBarAssetLabel").textContent = `${j.workers.asset.active} / ${j.workers.asset.max}`;
    $("devRawJson").textContent = JSON.stringify(j, null, 2);
    await refreshDevJobs();
    $("devSystemGrid").innerHTML = [`Uptime|${s.uptimeSec}s`, `Node|${s.nodeVersion}`, `Process role|${s.processRole}`, `RSS|${fmtBytes(s.memory.rss)}`, `Heap|${fmtBytes(s.memory.heapUsed)} / ${fmtBytes(s.memory.heapTotal)}`, `Active jobs|${s.jobs.active}`, `Search index|${s.searchIndexEntries}`, `Proxy cache|${s.proxyCacheEntries}`, `Requests logged|${s.requestsLogged}`].map(x => { const [a,b]=x.split("|"); return `<div><span>${esc(a)}</span><b>${esc(b)}</b></div>`; }).join("");
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
  $("devRawJson").textContent = "—"; refreshDevJobs();
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
  $("pageFrame").srcdoc = `<main class="veyra-frame-error"><div class="error-icon">V</div><div class="eyebrow">VEYRA BROWSER</div><h1>${esc(title)}</h1><p>${esc(detail)}</p><div class="error-actions"><button onclick="parent.postMessage({type:'veyra:retry'},'*')">Retry</button>${direct}</div></main>`;
  $("pageState").textContent = title; $("serverState").textContent = kind === "security" ? "Challenge" : "Error"; $("serverState").className = "server-pill warn";
}

async function submitProxyForm(message) {
  const frame = $("pageFrame"); const form = document.createElement("form"); form.method = "POST"; form.action = proxyUrl(message.url, "view"); form.target = frame.name; form.style.display = "none";
  for (const [name, value] of message.entries || []) { const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.appendChild(input); }
  document.body.appendChild(form); form.submit(); form.remove();
}
async function handlePageMessage(e) {
  const d = e.data || {}; if (!d || typeof d !== "object" || !String(d.type || "").startsWith("veyra:")) return;
  try { if (e.origin !== new URL(API).origin) return; } catch { return; }
  const t = activeTab(); if (!t) return;
  if (d.type === "veyra:retry") { await reloadActive(); return; }
  if (d.type === "veyra:open" && d.url) { const nt = makeTab(); state.tabs.push(nt); state.activeId = nt.id; renderTabs(); await openPage(d.url); return; }
  if (d.type === "veyra:unsupported") { addLog("warn", d.reason || "Unsupported page operation.", { pageUrl: d.pageUrl || t.url }); return; }
  if (d.type === "veyra:page-console") { addLog(d.level || "info", `[page:${hostOf(d.pageUrl || t.url)}] ${d.message || ""}`, { pageUrl: d.pageUrl || t.url, tabId: t.id, jobId: t.jobId }); return; }
  if (d.type === "veyra:page-error") { addLog("error", `[page:${hostOf(d.pageUrl || t.url)}] ${d.message || "Resource error"} @ ${d.url || "inline"}:${d.line || "?"}`, { pageUrl: d.pageUrl || t.url, line: d.line, column: d.column, stack: d.stack || "", tabId: t.id, jobId: t.jobId }); return; }
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
      const currentFrameCanonical = parseProxyCanonical($("pageFrame").src);
      if (currentFrameCanonical === target) await startJobForTab(t, target, false); else await startJobForTab(t, target, true);
      renderTabs();
    } else { updateIdentity(target); renderTabs(); }
  }
}
function parseProxyCanonical(src) { try { const u = new URL(src); return u.searchParams.get("url") || ""; } catch { return ""; } }
function canonicalizePageMessageUrl(value) {
  try {
    const u = new URL(String(value || ""));
    const embedded = u.searchParams.get("url");
    if ((u.pathname === "/api/view" || u.pathname === "/api/resource") && embedded && /^https?:$/i.test(new URL(embedded).protocol)) return new URL(embedded).href;
    return u.href;
  } catch { return ""; }
}

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
  $("setGlobalConcurrency").onchange = e => { settings.crawlerGlobalConcurrency = Math.max(1, Math.min(32, Number(e.target.value) || 12)); saveSettings(); };
  $("setHostConcurrency").onchange = e => { settings.crawlerHostConcurrency = Math.max(1, Math.min(8, Number(e.target.value) || 3)); saveSettings(); };
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
function wireApp() {
  $("address").onkeydown = e => { if (e.key === "Enter") openPage($("address").value); };
  $("homeBrowse").onclick = () => openPage($("homeInput").value);
  $("homeInput").onkeydown = e => { if (e.key === "Enter") openPage($("homeInput").value); };
  document.querySelectorAll(".shortcuts [data-url]").forEach(b => b.onclick = () => openPage(b.dataset.url));
  document.querySelectorAll(".shortcuts [data-tool]").forEach(b => b.onclick = () => showCalculator());
  $("homeBtn").onclick = () => showHome(); $("newTab").onclick = newTabAction; $("reloadBtn").onclick = reloadActive;
  $("backBtn").onclick = () => { const t = activeTab(); if (!t || t.histIndex <= 0) return; t.histIndex--; const target = t.history[t.histIndex]; if (target?.startsWith("search:")) showSearch(target.slice(7)); else if (target?.startsWith("calc:")) showCalculator(target.slice(5)); else openPage(target, false); };
  $("forwardBtn").onclick = () => { const t = activeTab(); if (!t || t.histIndex >= t.history.length - 1) return; t.histIndex++; const target = t.history[t.histIndex]; if (target?.startsWith("search:")) showSearch(target.slice(7)); else if (target?.startsWith("calc:")) showCalculator(target.slice(5)); else openPage(target, false); };
  $("starBtn").onclick = saveBookmark; $("toolsMenuBtn").onclick = () => setTool("sourcePanel"); document.querySelectorAll(".tool-tab").forEach(x => x.onclick = () => setTool(x.dataset.panel));
  $("backToPage").onclick = () => restoreTabView(activeTab()); $("menuBtn").onclick = toggleMenu;
  $("menuSource").onclick = () => { closeMenu(); setTool("sourcePanel"); }; $("menuLinks").onclick = () => { closeMenu(); setTool("linkPanel"); }; $("menuConsole").onclick = () => { closeMenu(); setTool("consolePanel"); }; $("menuDev").onclick = () => { closeMenu(); setTool("devPanel"); }; $("menuSettings").onclick = () => { closeMenu(); setTool("settingsPanel"); }; $("menuCalculator").onclick = () => { closeMenu(); showCalculator(); }; $("menuSearch").onclick = () => { closeMenu(); showSearch(); }; $("menuHome").onclick = () => { closeMenu(); newTabAction(); };
  $("consoleFilter").onchange = renderConsole; $("clearConsole").onclick = () => { state.logs = []; renderConsole(); addLog("info", "Console cleared."); };
  $("copyConsole").onclick = async () => { try { await navigator.clipboard.writeText(state.logs.map(x => `[${new Date(x.time).toISOString()}] [${x.level.toUpperCase()}] ${x.message}`).join("\n")); addLog("info", "Console copied."); } catch (e) { addLog("error", `Copy failed: ${e.message}`); } };
  $("devRefreshBtn").onclick = refreshDev; $("devStopBtn").onclick = () => { const t = activeTab(); if (t?.jobId) stopJob(t.jobId); else addLog("warn", "No active crawl to stop."); }; $("devAutoRefresh").onchange = startDevAuto; $("devNetFilter").onchange = e => { state.devNetFilter = e.target.value; renderDevNet(); }; $("devNetClear").onclick = () => { state.netLog = []; renderDevNet(); }; $("devCopyJsonBtn").onclick = async () => { try { await navigator.clipboard.writeText($("devRawJson").textContent || ""); addLog("info", "Raw job JSON copied."); } catch (e) { addLog("error", `Copy failed: ${e.message}`); } };
  $("devExportBtn").onclick = () => { const t = activeTab(); if (!t?.jobId) return addLog("warn", "No active crawl to export."); window.open(API + "/api/crawl/" + encodeURIComponent(t.jobId) + "/export", "_blank", "noopener"); };
  $("pageFrame").addEventListener("load", () => { const t = activeTab(); if (t?.url) { $("pageState").textContent = hostOf(t.url); setLoading(false); } });
  $("pageFrame").addEventListener("loadstart", () => setLoading(true, 60, "Rendering…"));
  $("searchButton").onclick = () => runSearch($("searchInput").value, false, 0); $("searchInput").onkeydown = e => { if (e.key === "Enter") runSearch($("searchInput").value, false, 0); };
  $("downloadBtn").onclick = () => { const t = activeTab(); if (t?.jobId) window.open(API + "/api/crawl/" + encodeURIComponent(t.jobId) + "/export", "_blank", "noopener"); else addLog("info", "There is no crawl export for this tab yet."); };
  $("fatalReload").onclick = () => location.reload(); $("fatalConsole").onclick = () => { $("fatalOverlay").classList.add("hidden"); setTool("consolePanel"); };
  wireSettingsForm(); setupCalculator(); setupConsoleCapture();
}

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
  if (!typing && key === "escape") { const t = activeTab(); if (t?.jobId && !t.done) stopJob(t.jobId); return; } if (e.altKey && key === "arrowleft") { e.preventDefault(); $("backBtn").click(); } if (e.altKey && key === "arrowright") { e.preventDefault(); $("forwardBtn").click(); }
  if (activeTab()?.view === "search" && !typing && ["arrowdown", "arrowup", "enter"].includes(key)) { e.preventDefault(); const cards = [...document.querySelectorAll(".search-result")]; if (!cards.length) return; let i = cards.findIndex(x => x.classList.contains("keyboard-active")); if (key === "enter" && i >= 0) return openPage(cards[i].dataset.url); i = key === "arrowdown" ? Math.min(cards.length - 1, i + 1) : Math.max(0, i - 1); cards.forEach(x => x.classList.remove("keyboard-active")); cards[i].classList.add("keyboard-active"); cards[i].focus(); }
});

function boot() {
  try {
    const firstTab = makeTab(); state.tabs.push(firstTab); state.activeId = firstTab.id; state.booted = true; renderTabs(); wireApp();
    let route = routeName();
    const routeParam = new URLSearchParams(location.search).get("veyra_route");
    if (routeParam) { history.replaceState({ veyraRoute: routeParam }, "", routeUrl(routeParam)); route = routeName(); }
    if (route === "/dev") setTool("devPanel", false); else if (route === "/settings") setTool("settingsPanel", false); else if (route === "/calculator") showCalculator(new URLSearchParams(location.search).get("q") || "", false); else if (route === "/search") showSearch(new URLSearchParams(location.search).get("q") || "", false); else if (location.hash === "#console") setTool("consolePanel", false); else if (settings.homepage) openPage(settings.homepage); else showHome(false);
    health(); addLog("info", "Veyra Browser ready. Canonical navigation, Veyra Search, calculator, bounded crawler, and diagnostics enabled.");
  } catch (e) { showFatal(e); }
}
boot();
