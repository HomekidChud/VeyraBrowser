


export function bootParam(name) {
  try {
    const top = new URLSearchParams(location.search);
    if (top.has(name)) return top.get(name);
    const r = top.get("veyra_route"); if (!r || !r.includes("?")) return null;
    return new URLSearchParams(r.slice(r.indexOf("?") + 1).split("#")[0]).get(name);
  } catch { return null; }
}


const DEFAULT_API = "https://veyraserver-xscy.onrender.com";
function deploymentApi() {
  try {
    const raw = document.querySelector('meta[name="veyra-api"]')?.content || DEFAULT_API;
    const u = new URL(raw); if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error("invalid API metadata");
    return u.href.replace(/\/$/, "");
  } catch { return DEFAULT_API; }
}
export const API = deploymentApi();
export const API_ORIGIN = (() => { try { return new URL(API).origin; } catch { return ""; } })();
export const VERSION = "8.28.7";
export const $ = id => document.getElementById(id);
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];
export const rawFetch = window.fetch.bind(window);
export const APP_BASE = (() => {
  const raw = String(window.VEYRA_BASE || new URL("./", document.baseURI).pathname || "").trim().replace(/\\+/g, "/");
  if (!raw || raw === "/") return "";
  const withSlash = raw.startsWith("/") ? raw : "/" + raw;
  return withSlash.replace(/\/$/, "");
})();


export const hooks = {};

export function safeJsonParse(raw, fallback) { try { const v = JSON.parse(raw); return v == null ? fallback : v; } catch { return fallback; } }



export const INCOGNITO = (() => {
  try {
    const q = bootParam("incognito");
    if (q === "1") sessionStorage.setItem("veyra-incognito", "1");
    else if (q === "0") sessionStorage.removeItem("veyra-incognito");
    return sessionStorage.getItem("veyra-incognito") === "1";
  } catch { return false; }
})();
const EPHEMERAL_KEYS = new Set([
  "veyra-history", "veyra-downloads", "veyra-last-tabs", "veyra-auth", "veyra-notes",
  "veyra-settings", "veyra-bookmarks", "veyra-extensions", "veyra-dev-extensions",
  "veyra-tab-groups", "veyra-live-session"
]);
const memoryStore = new Map();
const ephemeral = key => INCOGNITO && EPHEMERAL_KEYS.has(key);
export function load(key, fallback) {
  if (ephemeral(key)) return memoryStore.has(key) ? safeJsonParse(memoryStore.get(key), fallback) : fallback;
  try { const raw = localStorage.getItem(key); return raw == null ? fallback : safeJsonParse(raw, fallback); } catch { return fallback; }
}
export function save(key, value) { if (ephemeral(key)) { memoryStore.set(key, JSON.stringify(value)); return; } try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
export function remove(key) { if (ephemeral(key)) { memoryStore.delete(key); return; } try { localStorage.removeItem(key); } catch {} }
export function esc(s) { return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
export function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }
export function pathOf(u) { try { const x = new URL(u); return (x.pathname || "/") + (x.search || "") + (x.hash || ""); } catch { return String(u || ""); } }
export function displayUrl(u) { return String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, ""); }
export function uid() { try { return crypto.randomUUID(); } catch { return "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); } }
export function fmtBytes(n) { n = Number(n) || 0; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(1)} kB`; if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`; return `${(n / 1073741824).toFixed(2)} GB`; }
export function fmtMs(n) { n = Number(n) || 0; return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`; }
export function fmtClock(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
export function timeAgo(t) { const d = (Date.now() - new Date(t).getTime()) / 1000; if (d < 60) return "just now"; if (d < 3600) return `${Math.floor(d / 60)} min ago`; if (d < 86400) return `${Math.floor(d / 3600)} h ago`; return new Date(t).toLocaleDateString(); }
const ICON_COLORS = ["#5b7fd6", "#c2566b", "#3f9a78", "#b0772f", "#8a5cc9", "#2f8fa8", "#c0603c", "#5f8f3a"];
export function letterIcon(url, label = "") {
  const h = hostOf(url) || label || "V"; let n = 0; for (const c of h) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const ch = (h.replace(/^(m|en|www|app)\./, "")[0] || "V").toUpperCase();
  return { letter: ch, color: ICON_COLORS[n % ICON_COLORS.length] };
}
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);


export const DEFAULT_SETTINGS = {
  theme: "dark", accent: "#8fb0f0", fontScale: 1, compact: false, showBookmarksBar: true, showHomeButton: true,
  searchEngine: "veyra", customSearch: "", suggestions: true,
  startup: "newtab", startupUrl: "", homepage: "",
  ntpShortcuts: true, ntpRecent: true, ntpClock: true,
  blockTrackers: false, doNotTrack: true, clearHistoryOnSessionEnd: false, warnBeforeClose: false,
  sessionWarnings: true, autoRestartSession: false,
  downloadsOpenOnStart: true, downloadsMax: 200, historyMax: 1000,
  reduceMotion: false, focusRings: false, linkUnderline: false,
  runtime: "auto", confirmCloseWithCrawl: false, autoStopPrevious: true, requestTimeoutMs: 30000, browserFallback: true, settingsVersion: 6,
  consoleVerbosity: "debug", devRefreshMs: 1500, crawlerGlobalConcurrency: 24, crawlerHostConcurrency: 6,
  devtoolsDock: "bottom", devtoolsSize: 0.42, preserveLog: false, captureBodies: true,
  extensionDeveloperMode: false, shortcuts: {}, adminToken: "", vpnAutoProfile: "", ntpTiles: null, zoomDefault: 1,
  challengeHandoff: true, searchSource: "web", incognitoShortcutHint: true,
  
  neuralCrawlerEnabled: true, neuralCrawlerPrewarm: true, neuralCrawlerQueryExpansion: true,
  neuralCrawlerParallelSearch: true, neuralCrawlerBlockTrackers: true, neuralCrawlerProgressiveRender: true,
  neuralCrawlerRetrainOnFeedback: true, neuralCrawlerModelPath: "",
  
  internetProfile: "auto", wifiSsid: "", wifiFreq: "auto",
  cellApn: "", cellCarrier: "", cellType: "4g",
  customProxy: "", customDns: "", customGateway: "",
  bridgeInterface: "", bridgeFrom: "phone", castQuality: "auto", castFps: 30
};
export const settings = { ...DEFAULT_SETTINGS, ...load("veyra-settings", {}) };
delete settings.wifiPass;
delete settings.clearOnSessionEnd;

export function migrateSettings(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const version = Number(obj.settingsVersion) || 0;
  if (version < 2) {
    obj.browserFallback = true;
    obj.requestTimeoutMs = Math.max(Number(obj.requestTimeoutMs) || 0, 30000);
    obj.settingsVersion = 2;
  }
  if (Number(obj.settingsVersion) < 3) {
    const legacy = String(obj.runtime || "auto");
    if (legacy === "browser") obj.runtime = "browser";
    else if (legacy === "proxy") obj.runtime = "proxy";
    else obj.runtime = "auto";
    obj.settingsVersion = 3;
  }
  if (Number(obj.settingsVersion) < 4) {
    obj.requestTimeoutMs = Math.max(Number(obj.requestTimeoutMs) || 0, 30000);
    obj.settingsVersion = 4;
  }
  if (Number(obj.settingsVersion) < 5) {
    obj.neuralCrawlerEnabled = obj.neuralCrawlerEnabled !== false;
    obj.neuralCrawlerPrewarm = obj.neuralCrawlerPrewarm !== false;
    obj.neuralCrawlerQueryExpansion = obj.neuralCrawlerQueryExpansion !== false;
    obj.neuralCrawlerParallelSearch = obj.neuralCrawlerParallelSearch !== false;
    obj.neuralCrawlerBlockTrackers = obj.neuralCrawlerBlockTrackers !== false;
    obj.neuralCrawlerProgressiveRender = obj.neuralCrawlerProgressiveRender !== false;
    obj.neuralCrawlerRetrainOnFeedback = obj.neuralCrawlerRetrainOnFeedback !== false;
    obj.settingsVersion = 5;
  }
  if (Number(obj.settingsVersion) < 6) {
    
    
    
    if (obj.clearHistoryOnSessionEnd == null) obj.clearHistoryOnSessionEnd = false;
    delete obj.clearOnSessionEnd;
    delete obj.wifiPass;
    obj.settingsVersion = 6;
  }
  return obj;
}
{ const stored = load("veyra-settings", null); if (stored && (Number(stored.settingsVersion) || 0) < 6) { Object.assign(settings, migrateSettings(stored)); delete settings.clearOnSessionEnd; delete settings.wifiPass; save("veyra-settings", settings); } }
{ const stored = load("veyra-settings", null); if (stored && ("wifiPass" in stored || "clearOnSessionEnd" in stored)) save("veyra-settings", settings); }
export function saveSettings() { save("veyra-settings", settings); hooks.onSettingsChanged?.(); hooks.scheduleSync?.(); }
export function resetSettings() { for (const k of Object.keys(settings)) delete settings[k]; Object.assign(settings, DEFAULT_SETTINGS); saveSettings(); }

export const SEARCH_ENGINES = {
  veyra: { name: "Veyra Search", url: "" },
  duckduckgo: { name: "DuckDuckGo", url: "https://html.duckduckgo.com/html/?q=%s" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=%s" },
  brave: { name: "Brave Search", url: "https://search.brave.com/search?q=%s" },
  
  
  google: { name: "Google", url: "https://www.google.com/search?q=%s", engine: "browser" },
  wikipedia: { name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=%s" },
  custom: { name: "Custom", url: "" }
};
export function engineName() { return settings.searchEngine === "custom" ? (hostOf(settings.customSearch.replace("%s", "q")) || "Custom") : (SEARCH_ENGINES[settings.searchEngine]?.name || "Veyra Search"); }
export function engineUrl(q) {
  if (settings.searchEngine === "custom" && /%s/.test(settings.customSearch)) return settings.customSearch.replace("%s", encodeURIComponent(q));
  const e = SEARCH_ENGINES[settings.searchEngine]; return e?.url ? e.url.replace("%s", encodeURIComponent(q)) : "";
}


const readSessionAuth = () => {
  try {
    const store = INCOGNITO ? sessionStorage : localStorage;
    return safeJsonParse(store.getItem("veyra-auth"), null);
  } catch { return null; }
};
export const auth = { token: readSessionAuth()?.token || "", user: readSessionAuth()?.user || null, admin: false, config: null };
export function setAuth(token, user) {
  auth.token = token || ""; auth.user = user || null;
  try {
    const store = INCOGNITO ? sessionStorage : localStorage;
    if (token) store.setItem("veyra-auth", JSON.stringify({ token, user }));
    else store.removeItem("veyra-auth");
  } catch {}
  hooks.onAuthChanged?.();
}
export function isAdmin() { return !!(auth.admin || auth.user?.role === "admin"); }


export class ApiError extends Error { constructor(message, status = 0, code = "API_ERROR", requestId = "", body = null) { super(message); this.status = status; this.code = code; this.requestId = requestId; this.body = body; } }
export const netLog = [];
export async function api(path, options = {}) {
  const method = String(options.method || (options.json !== undefined ? "POST" : "GET")).toUpperCase();
  const requestId = uid();
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || settings.requestTimeoutMs || 30000));
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const externalSignal = options.signal;
  let detachExternal = null;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else {
      const abortFromCaller = () => controller.abort();
      externalSignal.addEventListener("abort", abortFromCaller, { once: true });
      detachExternal = () => externalSignal.removeEventListener("abort", abortFromCaller);
    }
  }
  const start = performance.now();
  const headers = new Headers(options.headers || {});
  headers.set("X-Veyra-Request-ID", requestId);
  if (auth.token) headers.set("Authorization", `Bearer ${auth.token}`);
  if (settings.adminToken) headers.set("X-Veyra-Admin-Token", settings.adminToken);
  let body = options.body;
  if (options.json !== undefined) { headers.set("content-type", "application/json"); body = JSON.stringify(options.json); }
  try {
    const response = await rawFetch(API + path, { method, headers, body, signal: controller.signal, credentials: "omit" });
    const rid = response.headers.get("X-Veyra-Request-ID") || requestId;
    const text = await response.text();
    const ct = response.headers.get("content-type") || "";
    const data = text ? (/json/i.test(ct) ? safeJsonParse(text, null) : text) : null;
    netLog.push({ time: Date.now(), method, path, status: response.status, ms: Math.round(performance.now() - start), requestId: rid }); if (netLog.length > 500) netLog.shift();
    if (!response.ok) {
      const err = new ApiError(data?.error || (typeof data === "string" ? data.slice(0, 300) : `HTTP ${response.status}`), response.status, data?.code || "HTTP_ERROR", rid, data);
      if (err.code === "SESSION_EXPIRED") hooks.onSessionExpired?.("server");
      if (response.status === 401 && auth.token && /^\/api\/auth\/(me|data)/.test(path)) setAuth("", null);
      throw err;
    }
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    netLog.push({ time: Date.now(), method, path, status: "ERR", ms: Math.round(performance.now() - start), requestId });
    const callerCancelled = externalSignal?.aborted && !timedOut;
    throw new ApiError(
      e?.name === "AbortError" && timedOut ? `Request timed out after ${Math.round(timeoutMs / 1000)} s.` : (callerCancelled ? "Request cancelled." : (e?.message || String(e))),
      0,
      e?.name === "AbortError" && timedOut ? "API_TIMEOUT" : callerCancelled ? "API_CANCELLED" : "API_NETWORK_ERROR",
      requestId
    );
  } finally { clearTimeout(timer); detachExternal?.(); }
}
export function proxyUrl(url, mode = "view", sid = "", from = "") {
  const base = API + (mode === "resource" ? "/api/resource?url=" : mode === "download" ? "/api/download?url=" : "/api/view?url=") + encodeURIComponent(url);
  const params = [];
  if (sid) params.push(`sid=${encodeURIComponent(sid)}`);
  
  
  
  if (mode === "view" && from && /^https?:\/\//i.test(from)) params.push(`from=${encodeURIComponent(from)}`);
  return params.length ? `${base}&${params.join("&")}` : base;
}


export async function sendNeuralFeedback(url, positive, weight = 1.0) {
  if (INCOGNITO || !settings.neuralCrawlerEnabled || !settings.neuralCrawlerRetrainOnFeedback) return;
  try { await api("/api/neural/feedback", { json: { url, positive, weight }, timeoutMs: 5000 }); } catch {}
}
export async function getNeuralStats() {
  try { return await api("/api/neural/stats", { timeoutMs: 5000 }); } catch { return null; }
}


export async function testAdminLogin() {
  try {
    const cfg = await api("/api/auth/config", { timeoutMs: 5000 });
    if (!cfg.testMode) return { ok: false, reason: "Test mode is off on this server" };
    const result = await api("/api/auth/test-login", { method: "POST", json: {}, timeoutMs: 10000 });
    if (result.ok && result.token) {
      setAuth(result.token, result.user);
      auth.admin = true;
    }
    return result;
  } catch (e) { return { ok: false, reason: e.message }; }
}


export const logs = [];
export function addLog(level, message, meta = {}) {
  logs.push({ time: Date.now(), level, message: String(message), meta }); if (logs.length > 3000) logs.splice(0, logs.length - 3000);
  hooks.onLog?.();
}


export function toast(message, { kind = "", action = null, actionLabel = "", ms = 3200 } = {}) {
  const host = $("toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`.trim();
  el.setAttribute("role", kind === "err" ? "alert" : "status");
  const text = document.createElement("span"); text.textContent = String(message || ""); el.appendChild(text);
  let timer = 0;
  const dismiss = () => { clearTimeout(timer); el.remove(); };
  if (typeof action === "function" && actionLabel) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = actionLabel;
    button.addEventListener("click", () => { dismiss(); try { action(); } catch {} });
    el.appendChild(button);
  }
  host.appendChild(el);
  timer = setTimeout(dismiss, Math.max(1200, Number(ms) || 3200));
}

export function promptDialog({ title, description = "", fields = [], ok = "Save" }) {
  const dlg = $("promptDialog"); $("promptTitle").textContent = title; $("promptOk").textContent = ok;
  const titleEl = $("promptTitle");
  let descEl = $("promptDescription");
  if (!descEl) { descEl = document.createElement("p"); descEl.id = "promptDescription"; descEl.className = "muted"; titleEl.insertAdjacentElement("afterend", descEl); }
  descEl.textContent = String(description || ""); descEl.classList.toggle("hidden", !description);
  $("promptFields").innerHTML = fields.map(f => f.type === "textarea"
    ? `<label class="field"><span>${esc(f.label)}</span><textarea name="${esc(f.name)}" rows="6" placeholder="${esc(f.placeholder || "")}">${esc(f.value || "")}</textarea></label>`
    : `<label class="field"><span>${esc(f.label)}</span><input name="${esc(f.name)}" type="${esc(f.type || "text")}" value="${esc(f.value || "")}" placeholder="${esc(f.placeholder || "")}" ${f.required ? "required" : ""}></label>`).join("");
  return new Promise(resolve => {
    const done = () => { dlg.removeEventListener("close", done); if (dlg.returnValue !== "ok") return resolve(null); const out = {}; for (const f of fields) out[f.name] = dlg.querySelector(`[name="${f.name}"]`).value; resolve(out); };
    dlg.addEventListener("close", done); dlg.returnValue = ""; dlg.showModal(); setTimeout(() => dlg.querySelector("input,textarea")?.focus(), 30);
  });
}
export function confirmDialog(title, text, ok = "Confirm") {
  return promptDialog({ title, description: text, fields: [], ok }).then(r => !!r).finally(() => {});
}
export async function copyText(text) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(String(text));
    toast("Copied to clipboard");
    return true;
  } catch {
    toast("Copy failed", { kind: "err" });
    return false;
  }
}


let openLayer = null;
export function openFloating(el, anchor, { align = "right", offset = 6 } = {}) {
  closeFloating(); el.classList.remove("hidden"); openLayer = el;
  const r = anchor.getBoundingClientRect(); const w = el.offsetWidth, h = el.offsetHeight;
  let left = align === "right" ? r.right - w : r.left; left = Math.max(8, Math.min(innerWidth - w - 8, left));
  let top = r.bottom + offset; if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - offset);
  el.style.left = left + "px"; el.style.top = top + "px";
  setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
}
function outside(e) { if (openLayer && !openLayer.contains(e.target) && !e.target.closest?.("[data-floating-anchor]")) closeFloating(); }
export function closeFloating() { if (openLayer) openLayer.classList.add("hidden"); openLayer = null; document.removeEventListener("pointerdown", outside, true); }
export function floatingOpen(el) { return openLayer === el; }
export function ctxMenu(x, y, items) {
  const m = $("ctxMenu"); m.innerHTML = items.map((it, i) => it === "-" ? `<div class="menu-sep"></div>` : `<button class="menu-item" data-i="${i}" ${it.disabled ? "disabled" : ""}><span class="lbl">${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ""}</button>`).join("");
  closeFloating(); m.classList.remove("hidden"); openLayer = m;
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + "px"; m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + "px";
  m.querySelectorAll("[data-i]").forEach(b => b.onclick = () => { closeFloating(); items[Number(b.dataset.i)].action?.(); });
  setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
}
