
import {
  API, API_ORIGIN, APP_BASE, $, qsa, esc, hostOf, pathOf, displayUrl, uid, fmtBytes, fmtClock, timeAgo, letterIcon,
  settings, saveSettings, load, save, remove, api, proxyUrl, addLog, logs, netLog, toast, hooks, auth, isAdmin,
  engineUrl, engineName, openFloating, closeFloating, ctxMenu, rawFetch, copyText, VERSION, ApiError, INCOGNITO, SEARCH_ENGINES, sendNeuralFeedback
} from "./core.js?v=8.28.9";
import { dtCall, frameFor, isRemote, handleBridgeMessage, rejectTab } from "./bridge.js?v=8.28.9";
import { initUI } from "./ui.js?v=8.28.9";
import { initDevtools } from "./devtools.js?v=8.28.9";
import { initCast } from "./device-cast.js";
import { maybeOfferRenew } from "./renew.js";
import { renderAdmin } from "./admin.js";





function youtubeEmbedUrl(raw) {
  try {
    const u = new URL(String(raw));
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = u.pathname.split("/").filter(Boolean)[0] || "";
    else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
      else if (/^\/(shorts|live|embed)\//.test(u.pathname)) id = u.pathname.split("/").filter(Boolean)[1] || "";
    }
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
    const params = new URLSearchParams({
      enablejsapi: "1",
      playsinline: "1",
      rel: "0",
      origin: location.origin,
      widget_referrer: location.origin
    });
    const start = u.searchParams.get("start") || u.searchParams.get("t");
    if (start && /^\d+$/.test(String(start))) params.set("start", String(start));
    if (u.searchParams.get("list")) params.set("list", u.searchParams.get("list"));
    if (u.searchParams.get("index")) params.set("index", u.searchParams.get("index"));
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params.toString()}`;
  } catch { return null; }
}
function isYouTubeUrl(raw) {
  try { return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(new URL(String(raw)).hostname.toLowerCase()); }
  catch { return false; }
}


const oldBookmarks = load("veyra-bookmarks", []);
export const state = {
  tabs: [], activeId: null, seq: 0, closed: [],
  bookmarks: (Array.isArray(oldBookmarks) ? oldBookmarks : []).map(b => typeof b === "string" ? { id: uid(), url: b, title: hostOf(b) || b, time: Date.now() } : b).filter(b => b && b.url),
  history: load("veyra-history", []).filter(x => x && typeof x === "object"),
  downloads: load("veyra-downloads", []).filter(x => x && typeof x === "object"),
  downloadControllers: new Map(),
  session: null, sessionTimer: null, sessionWarned: {}, sessionEnding: false, serverLimitMs: 120000, capabilityCache: new Map(),
  vpn: { status: null, connected: false, profile: null },
  incognito: INCOGNITO, server: { leanMode: false, version: "", checked: false }, sessionPromise: null,
  
  tabGroups: load("veyra-tab-groups", []),
  
  splitScreen: { active: false, leftTabId: null, rightTabId: null },
  historyRenderLimit: 600
};
const INTERNAL = {
  newtab: { title: "New tab", icon: "i-home", path: "/browse" },
  search: { title: "Veyra Search", icon: "i-search", path: "/search" },
  calculator: { title: "Calculator", icon: "i-calc", path: "/calculator" },
  downloads: { title: "Downloads", icon: "i-download", path: "/downloads" },
  history: { title: "History", icon: "i-history", path: "/history" },
  extensions: { title: "Extensions", icon: "i-puzzle", path: "/extensions" },
  settings: { title: "Settings", icon: "i-settings", path: "/settings" },
  vpn: { title: "Veyra VPN", icon: "i-vpn", path: "/vpn" },
  resources: { title: "Page resources", icon: "i-file", path: "/resources" },
  links: { title: "All links", icon: "i-link", path: "/links" },
  console: { title: "Veyra console", icon: "i-terminal", path: "/console", admin: true },
  dev: { title: "Veyra dev", icon: "i-code", path: "/dev", admin: true },
  platform: { title: "Developer platform", icon: "i-platform", path: "/dev/platform" },
  admin: { title: "Admin panel", icon: "i-shield", path: "/admin", admin: true },
  cast: { title: "Device Cast", icon: "i-globe", path: "/cast" },
  internet: { title: "Internet", icon: "i-vpn", path: "/internet" }
};
const saveHistory = () => save("veyra-history", state.history.slice(0, settings.historyMax || 1000));
const saveDownloads = () => save("veyra-downloads", state.downloads.slice(0, settings.downloadsMax || 200));
const saveBookmarks = () => { save("veyra-bookmarks", state.bookmarks); hooks.scheduleSync?.(); };
const saveTabGroups = () => save("veyra-tab-groups", state.tabGroups);
function cleanupUnfinishedSessionHistory() {
  const previous = load("veyra-live-session", null);
  if (previous?.id && settings.clearHistoryOnSessionEnd) {
    state.history = state.history.filter(h => h.sid !== previous.id);
    saveHistory();
  }
  if (previous) remove("veyra-live-session");
}
export function clearLocalAccountData() {
  state.bookmarks = []; saveBookmarks();
  save("veyra-notes", {}); save("veyra-extensions", {}); save("veyra-dev-extensions", []);
  settings.ntpTiles = null; saveSettings();
}


const GROUP_COLORS = ["#5b7fd6", "#c2566b", "#3f9a78", "#b0772f", "#8a5cc9", "#2f8fa8"];
export function createTabGroup(name = "New Group") {
  const group = { id: uid(), name, color: GROUP_COLORS[state.tabGroups.length % GROUP_COLORS.length], collapsed: false };
  state.tabGroups.push(group); saveTabGroups(); return group;
}
export function assignTabToGroup(tabId, groupId) {
  const t = tabById(tabId); if (!t) return;
  t.groupId = groupId; renderTabs();
}
export function removeTabFromGroup(tabId) {
  const t = tabById(tabId); if (!t) return;
  delete t.groupId; renderTabs();
}
export function deleteTabGroup(groupId) {
  state.tabGroups = state.tabGroups.filter(g => g.id !== groupId);
  state.tabs.forEach(t => { if (t.groupId === groupId) delete t.groupId; });
  saveTabGroups(); renderTabs();
}
export function toggleGroupCollapse(groupId) {
  const g = state.tabGroups.find(g => g.id === groupId); if (!g) return;
  g.collapsed = !g.collapsed; saveTabGroups(); renderTabs();
}
export function renameTabGroup(groupId, name) {
  const g = state.tabGroups.find(g => g.id === groupId); if (!g) return;
  g.name = name; saveTabGroups(); renderTabs();
}


export function toggleSplitScreen() {
  const ss = state.splitScreen;
  if (ss.active) {
    
    const wrap = $("frameWrap");
    qsa("#splitContainer .tab-frame").forEach(frame => wrap?.insertBefore(frame, $("frameLoader")));
    ss.active = false; ss.leftTabId = null; ss.rightTabId = null;
    
    qsa(".split-pane").forEach(el => el.remove());
    document.getElementById("viewport")?.classList.remove("split-active");
  } else {
    
    const t = activeTab();
    if (!t || t.view !== "page") return;
    if (isRemote(t)) return toast("Split view currently supports Fast proxy tabs only. Streamed Chromium tabs use one secure surface.", { kind: "warn", ms: 5000 });
    
    const otherTabs = state.tabs.filter(x => x.id !== t.id && x.view === "page" && !isRemote(x));
    const rightTab = otherTabs[0] || newTab({ url: t.url, background: true });
    ss.active = true; ss.leftTabId = t.id; ss.rightTabId = rightTab.id;
    renderSplitScreen();
  }
  renderTabs();
}
function renderSplitScreen() {
  const ss = state.splitScreen;
  if (!ss.active) return;
  const viewport = document.getElementById("viewport");
  if (!viewport) return;
  viewport.classList.add("split-active");
  
  let splitContainer = document.getElementById("splitContainer");
  if (!splitContainer) {
    splitContainer = document.createElement("div");
    splitContainer.id = "splitContainer";
    splitContainer.className = "split-container";
    viewport.appendChild(splitContainer);
  }
  const leftTab = tabById(ss.leftTabId);
  const rightTab = tabById(ss.rightTabId);
  
  
  const leftFrame = leftTab ? frameFor(leftTab) : null;
  const rightFrame = rightTab ? frameFor(rightTab) : null;
  const preservedFrames = document.createDocumentFragment();
  if (leftFrame) preservedFrames.appendChild(leftFrame);
  if (rightFrame) preservedFrames.appendChild(rightFrame);
  splitContainer.innerHTML = `
    <div class="split-pane split-left" id="splitLeft">
      <div class="split-header"><span class="split-title">${esc(leftTab?.title || "Left")}</span><button class="icon-btn sm" id="splitClose" title="Close split view"><svg><use href="#i-x"/></svg></button></div>
      <div class="split-content" id="splitLeftContent"></div>
    </div>
    <div class="split-divider" id="splitDivider"></div>
    <div class="split-pane split-right" id="splitRight">
      <div class="split-header"><span class="split-title">${esc(rightTab?.title || "Right")}</span><button class="icon-btn sm" id="splitSwap" title="Swap panes"><svg><use href="#i-reload"/></svg></button></div>
      <div class="split-content" id="splitRightContent"></div>
    </div>
  `;
  
  if (leftFrame) document.getElementById("splitLeftContent")?.appendChild(leftFrame);
  if (rightFrame) document.getElementById("splitRightContent")?.appendChild(rightFrame);
  document.getElementById("splitClose")?.addEventListener("click", () => toggleSplitScreen());
  document.getElementById("splitSwap")?.addEventListener("click", () => {
    const tmp = ss.leftTabId; ss.leftTabId = ss.rightTabId; ss.rightTabId = tmp;
    renderSplitScreen(); renderTabs();
  });
  
  const divider = document.getElementById("splitDivider");
  if (divider) {
    let dragging = false;
    divider.addEventListener("mousedown", e => { dragging = true; e.preventDefault(); });
    document.addEventListener("mousemove", e => {
      if (!dragging) return;
      const rect = splitContainer.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(20, Math.min(80, pct));
      splitContainer.style.gridTemplateColumns = `${clamped}fr 6px ${100 - clamped}fr`;
    });
    document.addEventListener("mouseup", () => { dragging = false; });
  }
}


function makeTab(extra = {}) {
  return {
    id: "t" + (++state.seq), title: "New tab", favicon: "", url: "", view: "newtab", section: "", history: [], histIndex: -1,
    jobId: null, done: true, poll: null, loading: false, browserMode: "FAST_PROXY", browserSessionId: "", browserPoll: null, browserStatus: "", combinedGraceTimer: null, loadStrategy: "auto", renderWinner: "", loadGuard: null, crawlerStartTimer: null, sessionId: "", compatFallbackTried: new Set(),
    resources: [], links: [], selectedResource: -1, console: [], network: [], zoom: settings.zoomDefault || 1, pinned: false,
    searchQuery: "", searchData: null, searchCorrection: null, calcExpression: "", sourceTabId: null, remoteLogIds: new Set(), openedAt: Date.now(), ...extra
  };
}
export const activeTab = () => state.tabs.find(t => t.id === state.activeId) || null;
const tabById = id => state.tabs.find(t => t.id === id) || null;

function tabIconHtml(t) {
  if (t.loading) return `<span class="spin"></span>`;
  if (t.view !== "page") return `<svg><use href="#${INTERNAL[t.view]?.icon || "i-globe"}"/></svg>`;
  if (t.favicon && state.session) return `<img src="${esc(proxyUrl(t.favicon, "resource", state.session.id))}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('b'),{textContent:'${esc(letterIcon(t.url).letter)}'}))">`;
  const li = letterIcon(t.url); return `<b style="display:grid;place-items:center;width:16px;height:16px;border-radius:4px;background:${li.color};color:#fff;font-size:10px">${esc(li.letter)}</b>`;
}
export function renderTabs() {
  const list = $("tabsList"); if (!list) return;
  const ordered = [...state.tabs.filter(t => t.pinned), ...state.tabs.filter(t => !t.pinned)];
  if (ordered.some((t, i) => t !== state.tabs[i])) state.tabs = ordered;
  let html = "";
  
  const renderedGroupIds = new Set();
  for (const t of state.tabs) {
    
    if (t.groupId && !renderedGroupIds.has(t.groupId)) {
      const g = state.tabGroups.find(g => g.id === t.groupId);
      if (g) {
        renderedGroupIds.add(t.groupId);
        const groupTabs = state.tabs.filter(x => x.groupId === g.id);
        html += `<div class="tab-group ${g.collapsed ? "collapsed" : ""}" style="--group-color:${g.color}">
          <div class="tab-group-header" data-group="${g.id}" title="Click to collapse/expand">
            <span class="tab-group-dot" style="background:${g.color}"></span>
            <span class="tab-group-name">${esc(g.name)}</span>
            <span class="tab-group-count">${groupTabs.length}</span>
            <button class="tab-group-close" data-group-close="${g.id}" title="Remove group"><svg><use href="#i-x"/></svg></button>
          </div>`;
        if (g.collapsed) {
          
          html += `<div class="tab-group-collapsed">`;
          for (const gt of groupTabs) {
            html += `<div class="tab tab-collapsed ${gt.id === state.activeId ? "active" : ""}" data-tab="${gt.id}" title="${esc(gt.title)}"><span class="tab-fav">${tabIconHtml(gt)}</span></div>`;
          }
          html += `</div>`;
        }
      }
    }
    
    const group = t.groupId ? state.tabGroups.find(g => g.id === t.groupId) : null;
    if (group && group.collapsed) continue;
    html += `<div class="tab ${t.id === state.activeId ? "active" : ""} ${t.pinned ? "pinned" : ""} ${t.groupId ? "grouped" : ""}" style="${t.groupId ? `--group-color:${state.tabGroups.find(g => g.id === t.groupId)?.color || "#888"}` : ""}" role="tab" aria-selected="${t.id === state.activeId}" tabindex="${t.id === state.activeId ? 0 : -1}" data-tab="${t.id}" draggable="true" title="${esc(t.title)}${t.url ? "\n" + esc(t.url) : ""}">
      <span class="tab-fav">${tabIconHtml(t)}</span><span class="tab-title">${esc(t.title || "New tab")}</span>${t.browserMode === "BROWSER_ENGINE" && t.view === "page" ? `<span class="tab-badge" title="Real Chromium tab">CR</span>` : ""}
      <button class="tab-close" data-close="${t.id}" title="Close tab" aria-label="Close tab"><svg><use href="#i-x"/></svg></button></div>`;
    
    if (t.groupId) {
      const groupTabs = state.tabs.filter(x => x.groupId === t.groupId);
      const lastInGroup = groupTabs[groupTabs.length - 1];
      if (lastInGroup && lastInGroup.id === t.id) html += `</div>`;
    }
  }
  list.innerHTML = html;
  list.querySelectorAll(".tab").forEach(el => {
    el.onmousedown = e => { if (e.button === 1) { e.preventDefault(); closeTab(el.dataset.tab); } };
    el.onclick = e => { if (!e.target.closest("[data-close]")) switchTab(el.dataset.tab); };
    el.onkeydown = e => {
      const tabs = [...list.querySelectorAll(".tab[data-tab]")]; const i = tabs.indexOf(el);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]?.focus(); return; }
      if (e.key === "Home" || e.key === "End") { e.preventDefault(); tabs[e.key === "Home" ? 0 : tabs.length - 1]?.focus(); return; }
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchTab(el.dataset.tab); }
    };
    el.oncontextmenu = e => { e.preventDefault(); tabContextMenu(el.dataset.tab, e.clientX, e.clientY); };
    el.ondragstart = e => { e.dataTransfer.setData("text/veyra-tab", el.dataset.tab); el.classList.add("dragging"); };
    el.ondragend = () => el.classList.remove("dragging");
    el.ondragover = e => e.preventDefault();
    el.ondrop = e => { e.preventDefault(); const from = e.dataTransfer.getData("text/veyra-tab"); moveTab(from, el.dataset.tab); };
  });
  list.querySelectorAll("[data-close]").forEach(b => b.onclick = e => { e.stopPropagation(); closeTab(b.dataset.close); });
  
  list.querySelectorAll("[data-group]").forEach(el => { el.onclick = e => { if (!e.target.closest("[data-group-close]")) toggleGroupCollapse(el.dataset.group); }; });
  list.querySelectorAll("[data-group-close]").forEach(b => b.onclick = e => { e.stopPropagation(); deleteTabGroup(b.dataset.groupClose); });
  list.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  document.title = (activeTab()?.title && activeTab().view !== "newtab" ? activeTab().title + " · " : "") + (state.incognito ? "Veyra Incognito" : "Veyra");
}
function moveTab(fromId, toId) { if (!fromId || fromId === toId) return; const a = state.tabs.findIndex(t => t.id === fromId), b = state.tabs.findIndex(t => t.id === toId); if (a < 0 || b < 0) return; const [t] = state.tabs.splice(a, 1); state.tabs.splice(b, 0, t); renderTabs(); }
function tabContextMenu(id, x, y) {
  const t = tabById(id); if (!t) return; const i = state.tabs.indexOf(t);
  const groupItems = state.tabGroups.length ? [
    { label: t.groupId ? "Remove from group" : "Add to group", action: () => {
      if (t.groupId) { removeTabFromGroup(id); }
      else {
        
        if (state.tabGroups.length === 1) { assignTabToGroup(id, state.tabGroups[0].id); }
        else {
          const items = state.tabGroups.map(g => ({ label: g.name, action: () => assignTabToGroup(id, g.id) }));
          items.push("-", { label: "New group…", action: async () => {
            const r = await promptDialog({ title: "New tab group", ok: "Create", fields: [{ name: "name", label: "Group name", value: "", placeholder: "Work, Research…" }] });
            if (r && r.name) { const g = createTabGroup(r.name); assignTabToGroup(id, g.id); }
          } });
          ctxMenu(x + 30, y + 30, items);
        }
      }
    } },
    ...(t.groupId ? [{ label: "Ungroup all tabs in this group", action: () => { const gid = t.groupId; state.tabs.forEach(tab => { if (tab.groupId === gid) delete tab.groupId; }); deleteTabGroup(gid); } }] : []),
  ] : [
    { label: "Add to new group…", action: async () => {
      const r = await promptDialog({ title: "New tab group", ok: "Create", fields: [{ name: "name", label: "Group name", value: "", placeholder: "Work, Research…" }] });
      if (r && r.name) { const g = createTabGroup(r.name); assignTabToGroup(id, g.id); }
    } }
  ];
  ctxMenu(x, y, [
    { label: "New tab to the right", action: () => newTab({ index: i + 1 }) },
    "-",
    { label: "Reload", kbd: "Ctrl+R", action: () => { switchTab(id); reload(); } },
    { label: "Duplicate", action: () => duplicateTab(t) },
    { label: t.pinned ? "Unpin" : "Pin", action: () => { t.pinned = !t.pinned; renderTabs(); } },
    "-",
    ...groupItems,
    { label: "Split screen with this tab", action: () => { switchTab(id); toggleSplitScreen(); } },
    "-",
    { label: "Copy address", disabled: !t.url, action: () => copyText(t.url) },
    "-",
    { label: "Close", kbd: "Ctrl+W", action: () => closeTab(id) },
    { label: "Close other tabs", disabled: state.tabs.length < 2, action: () => state.tabs.filter(x => x.id !== id && !x.pinned).forEach(x => closeTab(x.id, { silent: true })) },
    { label: "Close tabs to the right", disabled: i === state.tabs.length - 1, action: () => state.tabs.slice(i + 1).forEach(x => closeTab(x.id, { silent: true })) },
    { label: "Reopen closed tab", kbd: "Ctrl+Shift+T", disabled: !state.closed.length, action: reopenClosedTab }
  ]);
}
export function switchTab(id) {
  const t = tabById(id); if (!t) return;
  state.activeId = id; renderTabs(); renderActive({ push: true, replace: true });
}
export function newTab({ url = "", view = "", index = -1, background = false, section = "" } = {}) {
  const t = makeTab(); if (index >= 0) state.tabs.splice(index, 0, t); else state.tabs.push(t);
  if (!background) state.activeId = t.id;
  renderTabs();
  if (url) go(url, { tab: t, activate: !background });
  else if (view) openInternal(view, { tab: t, section });
  else if (settings.homepage) go(settings.homepage, { tab: t });
  else { t.view = "newtab"; if (!background) renderActive({ push: true }); }
  if (!background) setTimeout(() => { if (activeTab() === t && t.view === "newtab") $("ntpInput")?.focus(); }, 30);
  return t;
}
function duplicateTab(t) { const i = state.tabs.indexOf(t); if (t.view === "page" && t.url) newTab({ url: t.url, index: i + 1 }); else newTab({ view: t.view, index: i + 1, section: t.section }); }
function teardownTab(t) {
  if (t.poll) clearInterval(t.poll); t.poll = null; clearTimeout(t.browserPoll); clearTimeout(t.crawlerStartTimer); t.crawlerStartTimer = null;
  if (t.browserSessionId) stopBrowserSession(t).catch(() => {});
  if (t.jobId && !t.done) stopJob(t.jobId).catch(() => {});
  if (t.view === "cast") hooks.cleanupCast?.();
  rejectTab(t.id); frameFor(t)?.remove();
}
export function closeTab(id, { silent = false } = {}) {
  const idx = state.tabs.findIndex(t => t.id === id); if (idx < 0) return;
  const t = state.tabs[idx];
  if (!silent && settings.confirmCloseWithCrawl && t.jobId && !t.done && !confirm("This tab is still being indexed. Close it anyway?")) return;
  if (t.view === "page" && t.url) { state.closed.push({ url: t.url, title: t.title, index: idx }); if (state.closed.length > 25) state.closed.shift(); }
  else if (t.view !== "newtab") state.closed.push({ view: t.view, title: t.title, index: idx, section: t.section });
  teardownTab(t); hooks.dt?.onTabClosed(t);
  state.tabs.splice(idx, 1);
  if (!state.tabs.length) { const nt = makeTab(); state.tabs.push(nt); state.activeId = nt.id; }
  else if (state.activeId === id) state.activeId = state.tabs[Math.min(idx, state.tabs.length - 1)].id;
  renderTabs(); renderActive({ push: true, replace: true });
}
export function reopenClosedTab() { const c = state.closed.pop(); if (!c) return toast("No recently closed tabs"); if (c.url) newTab({ url: c.url, index: Math.min(c.index, state.tabs.length) }); else newTab({ view: c.view, section: c.section, index: Math.min(c.index, state.tabs.length) }); }
export function cycleTab(delta) { if (state.tabs.length < 2) return; const i = state.tabs.findIndex(t => t.id === state.activeId); switchTab(state.tabs[(i + delta + state.tabs.length) % state.tabs.length].id); }
export function selectTabIndex(n) { const t = n === 9 ? state.tabs[state.tabs.length - 1] : state.tabs[n - 1]; if (t) switchTab(t.id); }


function routeUrl(path, query = "") { return `${APP_BASE}${path}${query}`; }
function currentRoute() {
  const pathname = String(location.pathname || "/");
  let p = pathname;
  if (APP_BASE && (pathname === APP_BASE || pathname.startsWith(APP_BASE + "/"))) {
    p = pathname.slice(APP_BASE.length) || "/";
  }
  if (!p.startsWith("/")) p = "/" + p;
  return p.replace(/\/+$/, "") || "/";
}
function routeForTab(t) {
  if (!t) return ["/browse", ""];
  if (t.view === "page") return ["/browse", t.url ? `?url=${encodeURIComponent(t.url)}` : ""];
  if (t.view === "search") return ["/search", t.searchQuery ? `?q=${encodeURIComponent(t.searchQuery)}` : ""];
  if (t.view === "calculator") return ["/calculator", t.calcExpression ? `?q=${encodeURIComponent(t.calcExpression)}` : ""];
  if (t.view === "settings") return [t.section ? `/settings/${t.section}` : "/settings", ""];
  if (t.view === "console") return ["/browse", "#console"];
  if (t.view === "cast") return ["/cast", ""];
  if (t.view === "internet") return ["/internet", ""];
  return [INTERNAL[t.view]?.path || "/browse", ""];
}
function syncRoute({ replace = false } = {}) {
  const [p, q] = routeForTab(activeTab()); const next = routeUrl(p, q);
  if (next === location.pathname + location.search + location.hash) return;
  try { history[replace ? "replaceState" : "pushState"]({ veyra: true }, "", next); } catch {}
}
export function showLanding(on) {
  $("landing").classList.toggle("hidden", !on); $("app").classList.toggle("hidden", on);
  document.body.style.overflow = on ? "" : "hidden";
  if (on) { closeFloating(); hooks.renderLanding?.(); document.title = "Veyra — browse through a clean session"; }
}
export function goRoute(path, { push = true } = {}) {
  const url = new URL(path, location.origin + APP_BASE + "/");
  const p = url.pathname.replace(/\/+$/, "") || "/";
  if (push) try { history.pushState({ veyra: true }, "", APP_BASE + p + url.search + url.hash); } catch {}
  applyRoute();
}
function applyRoute() {
  const route = currentRoute(); const params = new URLSearchParams(location.search);
  if (route === "/" && location.hash !== "#console") { showLanding(true); return; }
  showLanding(false);
  if (!state.tabs.length) { const t = makeTab(); state.tabs.push(t); state.activeId = t.id; renderTabs(); }
  const t = activeTab();
  const reuse = x => x.view === "newtab" || x.view === "page" && !x.url;
  if (location.hash === "#console") return openInternal("console", { push: false });
  const [, first, second, third] = route.split("/");
  const view = first === "dev" && second === "platform" ? "platform" : { browse: "newtab", search: "search", calculator: "calculator", downloads: "downloads", history: "history", extensions: "extensions", settings: "settings", vpn: "vpn", dev: "dev", admin: "admin", console: "console", resources: "resources", links: "links", cast: "cast", internet: "internet" }[first];
  if (!view) {
    
    
    const fallback = routeUrl("/browse");
    try { history.replaceState({ veyra: true }, "", fallback); } catch {}
    if (t.view === "page") teardownTab(t);
    t.view = "newtab"; t.section = ""; t.url = ""; t.favicon = ""; t.loading = false;
    t.browserSessionId = ""; t.jobId = null; t.done = true; t.browserMode = "FAST_PROXY";
    renderTabs(); renderActive({ push: false });
    return;
  }
  if (view === "newtab") {
    const u = params.get("url"); const q = params.get("q");
    if (u) { if (!(t.view === "page" && t.url === u)) go(u, { tab: reuse(t) ? t : null, push: false }); else renderActive({ push: false }); }
    else if (q) go(q, { tab: reuse(t) ? t : null, push: false });
    else renderActive({ push: false });
    return;
  }
  if (view === "search") { showSearch(params.get("q") || "", { push: false }); return; }
  if (view === "calculator") { openInternal("calculator", { push: false, calc: params.get("q") || "" }); return; }
  openInternal(view, { push: false, section: first === "dev" && second === "platform" ? (third || "") : (second || "") });
}
window.addEventListener("popstate", () => applyRoute());


export function openInternal(view, { tab = null, push = true, section = "", calc = "" } = {}) {
  if (INTERNAL[view]?.admin && !isAdmin()) {
    toast("That page is only available to Veyra administrators", { kind: "warn" });
    if (currentRoute() === "/dev" || location.hash === "#console") { try { history.replaceState({}, "", routeUrl("/browse")); } catch {} }
    renderActive({ push: false }); return;
  }
  let t = tab || activeTab();
  
  
  const existing = state.tabs.find(x => x.view === view && !["resources", "links", "calculator"].includes(view));
  if (!tab && existing && existing !== t) { t = existing; state.activeId = t.id; }
  else if (!tab && t && t.view === "page" && t.url) {
    const src = t; t = makeTab({ sourceTabId: src.id }); state.tabs.splice(state.tabs.indexOf(src) + 1, 0, t); state.activeId = t.id;
  }
  if (["resources", "links"].includes(view) && !t.sourceTabId) { const src = state.tabs.find(x => x.view === "page" && x.url && x !== t); t.sourceTabId = src?.id || null; }
  if (t.view === "page") teardownTab(t);
  else if (t.view === "cast" && view !== "cast") hooks.cleanupCast?.();
  t.view = view; t.section = view === "settings" ? String(section || "") : section || ""; t.title = INTERNAL[view].title; t.url = ""; t.favicon = ""; t.loading = false; t.browserMode = "FAST_PROXY"; t.browserSessionId = "";
  if (view === "calculator" && calc) t.calcExpression = calc;
  pushTabHistory(t, `veyra:${view}${section ? "/" + section : ""}`);
  renderTabs(); renderActive({ push });
}
function pushTabHistory(t, entry) { if (t.history[t.histIndex] === entry) return; t.history = t.history.slice(0, t.histIndex + 1); t.history.push(entry); t.histIndex = t.history.length - 1; }

export function renderActive({ push = true, replace = false } = {}) {
  const t = activeTab(); if (!t) return;
  qsa(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + t.view));
  if (t.view === "page") showFrameForTab(t); else setLoading(false);
  updateAddress(); updateNavButtons(); updateIdentity();
  const r = {
    newtab: () => hooks.renderNewTab?.(), search: () => renderSearch(), calculator: () => renderCalculator(),
    downloads: renderDownloads, history: renderHistory, extensions: () => hooks.renderExtensions?.(), settings: () => hooks.renderSettings?.(t.section),
    vpn: renderVpnPanel, resources: renderResources, links: renderLinks, console: renderConsole, dev: renderDev, platform: renderPlatform, admin: () => renderAdmin(t.section),
    cast: () => hooks.renderCast?.(), internet: () => hooks.renderInternet?.()
  }[t.view]; r?.();
  if (t.view !== "dev") clearInterval(state.devTimer);
  if (t.view !== "admin") clearInterval(state.adminTimer);
  if (!$("findBar").classList.contains("hidden") && t.view !== "page") closeFind();
  $("readerView").classList.toggle("hidden", !(t.view === "page" && t.readerOpen));
  hooks.renderSidePanel?.(t);
  hooks.dt?.onTabChanged(t);
  if (push) syncRoute({ replace });
}
function updateAddress() {
  const t = activeTab(); const input = $("address"); if (!t || document.activeElement === input) return;
  input.value = t.view === "page" ? (t.url || "") : t.view === "search" ? t.searchQuery : t.view === "newtab" ? "" : `veyra://${t.view}${t.section ? "/" + t.section : ""}`;
}
function updateNavButtons() {
  const t = activeTab(); if (!t) return;
  $("backBtn").disabled = !(t.histIndex > 0 || (isRemote(t)));
  $("forwardBtn").disabled = !(t.histIndex < t.history.length - 1 || isRemote(t));
}
export function updateIdentity() {
  const t = activeTab(); const chip = $("siteChip"), text = $("siteChipText"); if (!t) return;
  chip.className = "site-chip";
  let icon = "i-search", label = "";
  if (t.view === "page" && t.url) {
    const secure = /^https:/.test(t.url);
    icon = state.vpn.connected ? "i-vpn" : secure ? "i-lock" : "i-info";
    chip.classList.add(state.vpn.connected ? "vpn" : secure ? "secure" : "warn");
    label = state.vpn.connected ? "VPN" : t.browserMode === "BROWSER_ENGINE" ? "Chromium" : t.failoverReason ? "Fast (limited)" : "";
  } else if (t.view !== "newtab") { icon = "i-shield"; label = "Veyra"; chip.classList.add("secure"); }
  chip.innerHTML = `<svg><use href="#${icon}"/></svg><span id="siteChipText">${esc(label)}</span>`;
  const bm = t.url && state.bookmarks.some(b => b.url === t.url);
  $("starBtn").classList.toggle("on", !!bm); $("starBtn").disabled = !(t.view === "page" && t.url);
  $("zoomChip").classList.toggle("hidden", !(t.view === "page" && t.zoom !== 1)); $("zoomChip").textContent = Math.round(t.zoom * 100) + "%";
  $("statusLeft").textContent = t.view === "page" ? (t.loading ? `Loading ${hostOf(t.url)}…` : t.url ? `${t.browserMode === "BROWSER_ENGINE" ? "Chromium" : t.failoverReason ? "Fast mode (limited)" : "Fast proxy"} · ${hostOf(t.url)}` : "Ready") : INTERNAL[t.view]?.title || "Ready";
  
  const sc = $("statusCenter");
  if (sc) {
    if (t.failoverReason && t.view === "page" && !t.loading) {
      sc.innerHTML = `<button class="retry-browser-btn" id="retryBrowserBtn" title="Reset the circuit breaker and retry Chromium">Retry full browser</button>`;
      const btn = $("retryBrowserBtn");
      if (btn) btn.onclick = () => { import('./app.js').then(m => m.retryFullBrowser?.()).catch(() => {}); };
    } else {
      sc.innerHTML = "";
    }
  }
  $("statusRight").textContent = `${state.vpn.connected ? `VPN · ${state.vpn.profile?.name || "connected"} · ` : ""}${auth.user ? auth.user.email : "Guest"} · v${VERSION}`;
  hooks.renderBookmarksBar?.();
}

export function setLoading(on, pct = 0, message = "Loading…") {
  const t = activeTab(); const line = $("loadProgress"), box = $("frameLoader"), btn = $("reloadBtn");
  if (t) t.loading = !!on && t.view === "page";
  line.style.width = on ? `${Math.max(6, Math.min(100, pct))}%` : "0%";
  box.classList.toggle("hidden", !on); $("frameLoaderText").textContent = message;
  btn.innerHTML = `<svg><use href="#${on ? "i-stop" : "i-reload"}"/></svg>`; btn.title = on ? "Stop loading" : "Reload";
  btn.dataset.loading = on ? "1" : "";
  renderTabsSoon();
}
let tabsRaf = 0; function renderTabsSoon() { if (tabsRaf) return; tabsRaf = requestAnimationFrame(() => { tabsRaf = 0; renderTabs(); }); }


function getOrCreateFrame(t) {
  let f = frameFor(t); if (f) return f;
  f = document.createElement("iframe"); f.id = "frame-" + t.id; f.name = "veyraFrame_" + t.id; f.className = "tab-frame"; f.title = "Page content";
  
  
  f.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-downloads");
  f.setAttribute("allow", "fullscreen; autoplay; clipboard-read; clipboard-write; picture-in-picture; encrypted-media");
  f.addEventListener("load", () => onFrameLoad(t));
  $("frameWrap").insertBefore(f, $("frameLoader"));
  return f;
}
function onFrameLoad(t) {
  if (!state.tabs.includes(t) || t.view !== "page") return;
  
  
  
  
  try {
    const f = frameFor(t);
    const doc = f && f.contentDocument;
    if (doc && doc.querySelector("[data-veyra-fullpage]")) {
      t.fullPage = true;
      t.browserMode = "FAST_PROXY";
      clearTimeout(t.combinedGraceTimer); t.combinedGraceTimer = null;
      if (t.browserSessionId) stopBrowserSession(t).catch(() => {});
      if (!t.renderWinner) t.renderWinner = "proxy";
      addLog("info", `Full page delivered by the fast pipeline on ${hostOf(t.url)} (no Chromium needed).`);
    }
  } catch { /* cross-origin frame — ignore */ }
  if (t.loadStrategy === "combined" && !t.renderWinner) {
    t.renderWinner = "proxy";
    t.browserMode = "FAST_PROXY";
    clearTimeout(t.combinedGraceTimer);
    t.combinedGraceTimer = setTimeout(() => { t.combinedGraceTimer = null; if (state.tabs.includes(t) && t.renderWinner === "proxy" && t.browserSessionId) stopBrowserSession(t).catch(() => {}); }, 8000);
  }
  if (activeTab() === t) setLoading(false); else t.loading = false;
  clearTimeout(t.loadGuard);
  if (["crawler", "combined"].includes(t.loadStrategy) && t.sessionId) {
    const session = state.session?.id === t.sessionId ? state.session : null;
    if (session) scheduleDeferredCrawler(t, t.url, session, true, 250);
  }
  
  
  
  renderTabsSoon(); updateIdentity();
  
  setTimeout(() => { if (t.zoom !== 1) dtCall(t, "ext.zoom", { zoom: t.zoom }, 4000).catch(() => {}); hooks.applyExtensionsToTab?.(t); hooks.dt?.onPageLoaded(t); pushKeybindings(t); }, 120);
  
  
  setTimeout(() => detectBlankProxyPage(t), 2200);
}


function proxyDocStats(t) {
  const f = frameFor(t);
  if (!f) return null;
  try {
    const doc = f.contentDocument;
    if (!doc) return null;
    const body = doc.body;
    const text = (body?.innerText || "").replace(/\s+/g, " ").trim();
    const kids = body ? body.children.length : 0;
    const nodes = doc.getElementsByTagName("*").length;
    
    const root = doc.querySelector("#root, #app, #__next, [data-reactroot]");
    const emptyRoot = !!(root && !(root.textContent || "").trim() && root.children.length === 0);
    return { sameOrigin: true, text, kids, nodes, emptyRoot };
  } catch {
    
    return { sameOrigin: false, allowlisted: hostNeedsRealBrowser(t.url) };
  }
}
function proxyDocLooksBlank(t) {
  const s = proxyDocStats(t);
  if (!s) return { blank: false, nodes: -1 };
  if (!s.sameOrigin) return { blank: !!(s.allowlisted && !t.renderWinner), nodes: -1 };
  
  const blank = (s.text.length < 40 && s.kids < 4) || s.emptyRoot;
  return { blank, nodes: s.nodes };
}
function escalateBlankProxyPage(t, key) {
  t.compatFallbackTried.add(key);
  addLog("info", `Blank proxy shell detected on ${hostOf(t.url)}; switching to Chromium.`);
  toast("This page stayed blank under the fast proxy. Switching to Chromium\u2026", { ms: 3500 });
  void loadInTab(t, t.url, { forceBrowser: true, loadFrame: true, record: null });
}
const browserFallbackAllowed = () => settings.browserFallback !== false && ["auto", "crawler"].includes(String(settings.runtime || "auto"));
function detectBlankProxyPage(t) {
  if (!state.tabs.includes(t) || t.view !== "page" || isRemote(t) || !t.url) return;
  if (t.browserMode === "BROWSER_ENGINE") return;
  t.compatFallbackTried ||= new Set();
  const key = `${t.url}|blank-shell`;
  if (t.compatFallbackTried.has(key)) return;
  
  
  
  if (!browserFallbackAllowed()) return;
  const first = proxyDocLooksBlank(t);
  if (!first.blank) return;
  
  
  
  if (first.nodes >= 0) {
    setTimeout(() => {
      if (!state.tabs.includes(t) || t.view !== "page" || t.browserMode === "BROWSER_ENGINE") return;
      if (t.compatFallbackTried?.has(key)) return;
      const second = proxyDocLooksBlank(t);
      if (!second.blank) return;
      if (second.nodes > first.nodes) {
        addLog("debug", `Proxy shell on ${hostOf(t.url)} is still hydrating (${first.nodes} \u2192 ${second.nodes} nodes); keeping the fast proxy.`);
        return;
      }
      escalateBlankProxyPage(t, key);
    }, 9000);
    return;
  }
  escalateBlankProxyPage(t, key);
}
function clearRemoteSurface() {
  const v = $("remoteSurface");
  if (!v) return;
  const img = $("remoteImg");
  if (img) { img.removeAttribute("src"); img.style.visibility = "hidden"; }
  const ld = $("remoteLoading"); if (ld) ld.style.display = "none";
  const er = $("remoteError"); if (er) er.style.display = "none";
  v.classList.remove("frame-active");
}
function ensureRemoteSurface() {
  let v = $("remoteSurface"); if (v) return v;
  v = document.createElement("div"); v.id = "remoteSurface"; v.className = "browser-surface"; v.tabIndex = 0; v.setAttribute("role", "application"); v.setAttribute("aria-describedby", "remoteA11yNotice"); v.setAttribute("aria-label", "Streamed Chromium browser surface");
  v.style.position = "relative";
  v.innerHTML = `<p id="remoteA11yNotice" class="sr-only">This streamed Chromium page is currently a visual surface; its page structure is not available to assistive technology. Use Fast proxy where possible for an accessible document.</p><img id="remoteImg" alt="Visual stream of a remote Chromium page; page content is not exposed as an accessibility tree." style="width:100%;height:100%;object-fit:contain;display:block;user-select:none;visibility:hidden;touch-action:none" draggable="false"><div id="remoteLoading" style="position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:14px;background:var(--bg);color:var(--text-2);z-index:3"><div class="spinner"></div><span class="muted">Starting Chromium…</span></div><div id="remoteError" style="position:absolute;inset:0;display:none;place-content:center;justify-items:center;gap:10px;background:var(--bg);color:var(--text-2);z-index:3;text-align:center;padding:24px"><svg width="40" height="40" style="color:var(--line-2)"><use href="#i-info"/></svg><b>Remote Chromium unavailable</b><span class="muted small" id="remoteErrorText">The browser session could not be loaded.</span><button class="btn ghost sm" id="remoteRetryBtn">Retry</button></div><div id="remoteCursor" style="position:absolute;width:18px;height:18px;pointer-events:none;z-index:10;opacity:0;transition:opacity 150ms;margin-left:-9px;margin-top:-9px;background:#fff;border:2px solid #000;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,.5)"></div>`;
  $("frameWrap").insertBefore(v, $("frameLoader"));
  const img = v.querySelector("img");
  
  const VW = 1365, VH = 820;
  
  
  
  
  
  const pos = e => {
    const r = img.getBoundingClientRect();
    const containerAspect = r.width / r.height;
    const imageAspect = VW / VH;
    let imgW, imgH, offsetX, offsetY;
    if (containerAspect > imageAspect) {
      
      imgH = r.height;
      imgW = r.height * imageAspect;
      offsetX = (r.width - imgW) / 2;
      offsetY = 0;
    } else {
      
      imgW = r.width;
      imgH = r.width / imageAspect;
      offsetX = 0;
      offsetY = (r.height - imgH) / 2;
    }
    const px = e.clientX - r.left - offsetX;
    const py = e.clientY - r.top - offsetY;
    return {
      x: Math.max(0, Math.min(VW, px * VW / imgW)),
      y: Math.max(0, Math.min(VH, py * VH / imgH)),
    };
  };
  
  
  
  const send = async (payload, { delay = 250 } = {}) => { const t = activeTab(); if (!t?.browserSessionId) return; try { await api(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}/input`, { json: payload }); setTimeout(() => refreshRemote(t, true), delay); } catch (e) { addLog("warn", `Chromium input failed: ${e.message}`); } };
  img.addEventListener("load", () => { img.style.visibility = "visible"; const ld = $("remoteLoading"), er = $("remoteError"); if (ld) ld.style.display = "none"; if (er) er.style.display = "none"; });
  img.addEventListener("error", () => { img.style.visibility = "hidden"; const ld = $("remoteLoading"); if (ld) ld.style.display = "grid"; });
  v.addEventListener("click", e => { if (e.target.id === "remoteRetryBtn" || e.target.closest("#remoteRetryBtn")) { const ld = $("remoteLoading"), er = $("remoteError"); if (ld) ld.style.display = "grid"; if (er) er.style.display = "none"; const t = activeTab(); if (t?.browserSessionId) refreshRemote(t, true); } });
  const modifiers = e => ({ altKey: !!e.altKey, ctrlKey: !!e.ctrlKey, metaKey: !!e.metaKey, shiftKey: !!e.shiftKey });
  let activePointer = null, dragged = false;
  img.addEventListener("pointerdown", e => { v.focus(); if (hooks.dt?.pickingRemote(e, pos(e))) return; activePointer = e.pointerId; dragged = false; img.setPointerCapture?.(e.pointerId); send({ type: "pointer", phase: "down", pointerType: e.pointerType, button: e.button, ...pos(e), ...modifiers(e) }); });
  img.addEventListener("pointermove", e => { if (activePointer === e.pointerId) { dragged = true; send({ type: "pointer", phase: "move", pointerType: e.pointerType, buttons: e.buttons, ...pos(e), ...modifiers(e) }, { delay: 120 }); } });
  img.addEventListener("pointerup", e => { if (activePointer !== e.pointerId) return; send({ type: "pointer", phase: "up", pointerType: e.pointerType, button: e.button, ...pos(e), ...modifiers(e) }); if (!dragged) send({ type: "click", ...pos(e), button: e.button === 2 ? "right" : "left", ...modifiers(e) }); activePointer = null; });
  img.addEventListener("pointercancel", e => { if (activePointer === e.pointerId) { send({ type: "pointer", phase: "cancel", pointerType: e.pointerType, ...pos(e), ...modifiers(e) }); activePointer = null; } });
  img.addEventListener("dblclick", e => send({ type: "dblclick", ...pos(e), ...modifiers(e) }));
  img.addEventListener("contextmenu", e => e.preventDefault());
  img.addEventListener("wheel", e => { e.preventDefault(); send({ type: "wheel", ...pos(e), deltaY: e.deltaY, deltaX: e.deltaX, ...modifiers(e) }); }, { passive: false });
  img.addEventListener("mousemove", e => { hooks.dt?.hoverRemote(pos(e)); const c = $("remoteCursor"); if (c) { const p = pos(e); const r = img.getBoundingClientRect(); const containerAspect = r.width / r.height; const imageAspect = VW / VH; let imgW, imgH, offsetX, offsetY; if (containerAspect > imageAspect) { imgH = r.height; imgW = r.height * imageAspect; offsetX = (r.width - imgW) / 2; offsetY = 0; } else { imgW = r.width; imgH = r.width / imageAspect; offsetX = 0; offsetY = (r.height - imgH) / 2; } c.style.left = (offsetX + p.x * imgW / VW) + "px"; c.style.top = (offsetY + p.y * imgH / VH) + "px"; c.style.opacity = "0.7"; } });
  img.addEventListener("mouseleave", () => { const c = $("remoteCursor"); if (c) c.style.opacity = "0"; });
  v.addEventListener("keydown", e => { if (e.key === "F12") return; e.preventDefault(); send({ type: "key", key: e.key, code: e.code, repeat: e.repeat, ...modifiers(e) }); });
  v.addEventListener("paste", e => { const text = e.clipboardData?.getData("text/plain"); if (text != null) { e.preventDefault(); send({ type: "paste", text, ...modifiers(e) }); } });
  for (const type of ["compositionstart", "compositionupdate", "compositionend"]) v.addEventListener(type, e => send({ type: "composition", phase: type.slice(11), text: e.data || "" }, { delay: 120 }));
  return v;
}
function showFrameForTab(t) {
  const remote = isRemote(t);
  const f = remote ? null : (t.url || frameFor(t) ? getOrCreateFrame(t) : null);
  qsa("#frameWrap .tab-frame").forEach(el => el.classList.toggle("frame-active", el === f));
  const surf = ensureRemoteSurface();
  surf.classList.toggle("frame-active", remote);
  if (!remote) clearRemoteSurface();
  if (remote) refreshRemote(t, true);
  setLoading(!!t.loading, 50, `Loading ${hostOf(t.url)}…`);
}




const WAKE_CODES = new Set(["API_TIMEOUT", "API_NETWORK_ERROR"]);
export async function wakeServer(maxMs = 100000) {
  const until = Date.now() + maxMs; let n = 0;
  while (Date.now() < until) {
    n++;
    setLoading(true, Math.min(12 + n * 3, 40), `Waking up the Veyra server… (${Math.round((maxMs - (until - Date.now())) / 1000)} s)`);
    try { const h = await api("/health", { timeoutMs: 12000 }); if (h?.ok !== false) return true; } catch {}
    await new Promise(r => setTimeout(r, 2500));
  }
  return false;
}
async function createSessionWithWake() {
  const json = { incognito: !!state.incognito };
  try { return await api("/api/session", { json, timeoutMs: 20000 }); }
  catch (e) {
    if (!WAKE_CODES.has(e.code) && ![502, 503, 504].includes(e.status)) throw e;
    addLog("info", "Server is asleep or busy, waking it up…");
    if (!(await wakeServer())) throw new ApiError("The Veyra server didn't wake up in time. It may be redeploying; try again in a minute.", 0, "SERVER_ASLEEP");
    return await api("/api/session", { json, timeoutMs: 30000 });
  }
}
export async function ensureSession() {
  const s = state.session;
  if (s && s.expiresAt - Date.now() > 800) return s;
  
  
  if (state.sessionPromise) return state.sessionPromise;
  state.sessionPromise = (async () => {
    if (s) await endSession("timer");
    return startNewSession();
  })();
  try { return await state.sessionPromise; } finally { state.sessionPromise = null; }
}
async function startNewSession() {
  const body = await createSessionWithWake();
  const limit = Number(body.timeLimitMs) || 0;
  state.serverLimitMs = limit;
  state.session = { id: body.sessionId, startedAt: Date.now(), limitMs: limit, expiresAt: limit ? Date.now() + Number(body.remainingMs ?? limit) : Infinity };
  save("veyra-live-session", { id: body.sessionId, startedAt: state.session.startedAt });
  state.sessionWarned = {};
  addLog("info", `Session ${body.sessionId.slice(0, 8)} started${limit ? ` (${fmtClock(limit)} limit)` : ""}.`);
  startSessionTimer();
  updateSessionPreferences({ silent: true }).catch(e => addLog("warn", `Could not apply session privacy preferences: ${e.message}`));
  if (settings.vpnAutoProfile) connectVpn(settings.vpnAutoProfile, { quiet: true }).catch(e => {
    
    
    settings.vpnAutoProfile = "";
    saveSettings();
    addLog("warn", `Automatic VPN was disabled: ${e.message}`);
  });
  hooks.onSessionChanged?.();
  return state.session;
}
function startSessionTimer() { clearInterval(state.sessionTimer); state.sessionTimer = setInterval(tickSession, 250); tickSession(); }
export async function updateSessionPreferences({ silent = false } = {}) {
  const session = state.session;
  if (!session) return { pending: true };
  const requested = { blockTrackers: !!settings.blockTrackers, doNotTrack: !!settings.doNotTrack };
  const result = await api(`/api/session/${session.id}/prefs`, { json: requested });
  if (!silent && typeof result?.prefs?.doNotTrack !== "boolean") toast("This server has not acknowledged Do Not Track yet; the preference is saved and will apply when supported.", { kind: "warn", ms: 6500 });
  return result;
}
hooks.updateSessionPreferences = updateSessionPreferences;
export function sessionRemaining() { const s = state.session; return s ? Math.max(0, s.expiresAt - Date.now()) : 0; }
function tickSession() {
  const pill = $("sessionPill"), txt = $("sessionTime"); const s = state.session;
  if (!s) { pill.className = "session-pill idle"; txt.textContent = state.serverLimitMs ? fmtClock(state.serverLimitMs) : "—"; pill.title = `No session yet. A ${fmtClock(state.serverLimitMs)} session starts when you open a website.`; return; }
  if (s.expiresAt === Infinity) { pill.className = "session-pill live"; txt.textContent = "Live"; pill.title = "Session has no time limit"; return; }
  const left = s.expiresAt - Date.now();
  txt.textContent = fmtClock(left);
  pill.className = "session-pill " + (left <= 10000 ? "crit" : left <= 30000 ? "warn" : "live");
  pill.title = `Session ends in ${fmtClock(left)}. Everything in it is deleted when the timer hits 0:00.`;
  if (settings.sessionWarnings) {
    if (left <= 30000 && !state.sessionWarned[30]) { state.sessionWarned[30] = 1; toast("30 seconds left in this session", { kind: "warn" }); }
    if (left <= 10000 && !state.sessionWarned[10]) { state.sessionWarned[10] = 1; toast("10 seconds left. The session will be deleted", { kind: "err" }); }
  }
  
  if (left > 0 && left <= 60000) maybeOfferRenew(s, left);
  hooks.onSessionTick?.(left, s);
  if (left <= 0) endSession("timer");
}
export async function endSession(reason = "timer") {
  const s = state.session; if (!s || state.sessionEnding) return;
  state.sessionEnding = true;
  try {
    // Session cookies are temporary, but signed-in user storage is not. Flush
    // it before closing the session; incognito is excluded by the hook.
    try { await hooks.flushSync?.(); } catch (e) { addLog("warn", `Could not save account storage before session end: ${e.message}`); }
    state.session = null; clearInterval(state.sessionTimer);
    
    const pageTabs = state.tabs.filter(t => t.view === "page");
    const restoreUrls = [...new Set(pageTabs.map(t => t.url).filter(u => /^https?:\/\//.test(u)))];
    for (const t of pageTabs) { teardownTab(t); hooks.dt?.onTabClosed(t); }
    state.tabs = state.tabs.filter(t => t.view !== "page");
    if (!state.tabs.length) state.tabs.push(makeTab());
    if (!tabById(state.activeId)) state.activeId = state.tabs[0].id;
    state.closed = state.closed.filter(c => !c.url);
    if (settings.clearHistoryOnSessionEnd) { state.history = state.history.filter(h => h.sid !== s.id); saveHistory(); }
    remove("veyra-live-session");
    state.vpn.connected = false; state.vpn.profile = null;
    let closeConfirmed = false;
    try { const closed = await api(`/api/session/${encodeURIComponent(s.id)}/close`, { method: "POST", timeoutMs: 5000 }); closeConfirmed = !!closed?.ok; } catch {}
    addLog("info", `Session ${s.id.slice(0, 8)} ended (${reason}).`);
    renderTabs(); renderActive({ push: true, replace: true }); tickSession(); hooks.onSessionChanged?.();
    if (reason === "manual") toast(closeConfirmed ? "Session ended; server cleanup confirmed" : "Session closed locally. Server cleanup could not be confirmed.", { kind: closeConfirmed ? "" : "warn", ms: 5000 });
    else if (settings.autoRestartSession && restoreUrls.length) {
      try {
        await ensureSession();
        const first = restoreUrls.shift(); if (first) await go(first, { tab: activeTab(), push: true });
        restoreUrls.forEach((url, i) => setTimeout(() => newTab({ url, background: true }), i * 75));
        toast("Session restarted; restoring your tabs.");
      } catch (e) { toast(`Session ended. Couldn't restart automatically: ${e.message}`, { kind: "err" }); }
    }
    else {
      const active = activeTab();
      const hadPage = pageTabs.length > 0;
      $("sessionOverText").textContent = reason === "server"
        ? "The server reports this session has expired. Local tabs are closed; any server cleanup is controlled by the server."
        : `Your ${fmtClock(s.limitMs)} session ended. Local tabs are closed${closeConfirmed ? "; server cleanup was confirmed." : "; server cleanup could not be confirmed."}`;
      
      
      if (hadPage && active?.view === "page") { $("sessionOverlay").classList.remove("hidden"); $("sessionRestart").focus(); }
      else toast(reason === "server" ? "Session expired" : (closeConfirmed ? "Session ended; server cleanup confirmed" : "Session ended locally; server cleanup was not confirmed"), { kind: closeConfirmed ? "" : (reason === "server" ? "warn" : "err") });
    }
  } finally { state.sessionEnding = false; }
}
hooks.onSessionExpired = reason => { if (state.session) endSession(reason); };


hooks.currentSessionId = () => state.session?.id || "";
hooks.onSessionRenewed = expiresAt => {
  if (!state.session || !expiresAt) return;
  state.session.expiresAt = expiresAt;
  state.sessionWarned = {};   
  tickSession();
  addLog("info", `Session renewed — new expiry ${new Date(expiresAt).toLocaleTimeString()}`);
};
window.addEventListener("pagehide", () => { const s = state.session; if (s) try { navigator.sendBeacon(`${API}/api/session/${encodeURIComponent(s.id)}/close`, ""); } catch {} });


function looksLikeCalc(v) { return /[0-9]/.test(v) && /[+\-*/%^()]/.test(v) && /^[\d\s+\-*/%^().,]+$/.test(v); }
export function classify(input) {
  const v = String(input || "").trim(); if (!v) return null;
  const internal = v.match(/^veyra:\/\/([a-z]+)(?:\/([a-z-]+))?/i);
  if (internal) return INTERNAL[internal[1].toLowerCase()] ? { kind: "internal", view: internal[1].toLowerCase(), section: internal[2] || "" } : { kind: "search", query: v };
  if (/^(?:javascript|data|blob|file|chrome|about):/i.test(v)) return { kind: "unsupported", value: v };
  if (/^https?:\/\//i.test(v)) return { kind: "url", url: v };
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(v)) return { kind: "url", url: "http://" + v };
  if (!/\s/.test(v) && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(v)) return { kind: "url", url: "https://" + v };
  if (looksLikeCalc(v)) return { kind: "calc", expression: v };
  return { kind: "search", query: v };
}
export async function go(input, { tab = null, push = true, newTab: inNew = false, activate = true } = {}) {
  const r = classify(input); if (!r) return;
  if (inNew) { newTab({ url: input }); return; }
  if (r.kind === "internal") { openInternal(r.view, { tab, section: r.section, push }); return; }
  if (r.kind === "unsupported") { toast("Veyra only opens http and https addresses", { kind: "warn" }); return; }
  if (r.kind === "calc") { openInternal("calculator", { tab, calc: r.expression, push }); return; }
  if (r.kind === "search") {
    const ext = engineUrl(r.query);
    if (ext) return navigate(ext, { tab, push, activate, record: { kind: "search", title: `${r.query} - ${engineName()}` } });
    return showSearch(r.query, { tab, push });
  }
  let url; try { url = new URL(r.url).href; } catch { toast("That address isn't valid", { kind: "err" }); return; }
  return navigate(url, { tab, push, activate });
}
export async function navigate(url, { tab = null, push = true, pushHist = true, record = null, activate = true } = {}) {
  let t = tab || activeTab(); if (!t) return;
  if (t.view !== "page") { t.view = "page"; t.title = hostOf(url) || "Loading"; }
  if (activate) state.activeId = t.id;
  if (pushHist) pushTabHistory(t, url);
  sendNeuralFeedback(url, true, 0.5); 
  await loadInTab(t, url, { loadFrame: true, record });
  if (push && activeTab() === t) syncRoute();
}
async function capability(url) {
  if (settings.runtime === "proxy") return "FAST_PROXY";
  if (settings.runtime === "crawler") return "FAST_PROXY";
  if (settings.runtime === "browser" || settings.runtime === "combined") return "BROWSER_ENGINE";
  const host = hostOf(url); const c = state.capabilityCache.get(host); if (c) return c;
  try { const r = await api("/api/browser/capability", { json: { url }, timeoutMs: 12000 }); const m = r?.mode || "FAST_PROXY"; if (typeof r?.lean === "boolean") state.server.leanMode = r.lean; state.capabilityCache.set(host, m); return m; } catch { return "FAST_PROXY"; }
}
function desiredStrategy(url) {
  const r = String(settings.runtime || "auto");
  if (r === "proxy") return { key: "proxy", proxy: true, crawler: false, browser: false, race: false };
  if (r === "crawler") return { key: "crawler", proxy: true, crawler: true, browser: false, race: false };
  if (r === "browser") return { key: "browser", proxy: false, crawler: false, browser: true, race: false };
  if (r === "combined") return { key: "combined", proxy: true, crawler: true, browser: true, race: true };
  return { key: "auto", proxy: true, crawler: true, browser: false, race: false, auto: true };
}
export function isGoogleSearchUrl(url) {
  try { const u = new URL(url); return /(^|\.)google\.[a-z.]+$/i.test(u.hostname) && /^\/(search|webhp)?$/.test(u.pathname) && u.searchParams.has("q"); } catch { return false; }
}


function hostNeedsRealBrowser(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (/(^|\.)roblox\.com$/.test(h) || /(^|\.)rbxcdn\.com$/.test(h)) return true;
    if (/(^|\.)browser\.lol$/.test(h)) return true;
    if (/(^|\.)now\.gg$/.test(h) || /(^|\.)geforce\.com$/.test(h)) return true;
  } catch {}
  return false;
}
function resolveStrategy(url) {
  const base = desiredStrategy(url);
  
  
  
  
  if (isYouTubeUrl(url) && String(settings.runtime || "auto") !== "browser") {
    return { key: "youtube-proxy", proxy: true, crawler: false, browser: false, race: false, youtubeProxy: true };
  }
  
  
  // Google search pages frequently return a cloud-IP CAPTCHA before the page
  // can render. Keep the default path useful by showing Veyra's multi-provider
  // results instead. Users who explicitly choose the Browser runtime still
  // get direct Chromium, where they can complete Google's own check.
  if (isGoogleSearchUrl(url) && String(settings.runtime || "auto") !== "browser") {
    return { key: "google-search-fallback", proxy: false, crawler: false, browser: false, race: false, googleSearchFallback: true };
  }
  
  
  
  if (hostNeedsRealBrowser(url) && browserFallbackAllowed()) {
    return { key: "combined", proxy: true, crawler: false, browser: true, race: true, auto: true, forceBrowserHost: true };
  }
  if (!base.auto) return base;
  
  
  
  const cached = state.capabilityCache.get(hostOf(url));
  if (cached === "BROWSER_ENGINE" && browserFallbackAllowed()) return { ...base, key: "combined", proxy: true, crawler: true, browser: true, race: true, auto: true };
  if (cached === "ACCELERATED_PROXY") return { ...base, accelerate: true };
  return { ...base, probe: !cached };
}
function scheduleDeferredCrawler(t, url, session, enabled = true, delayMs = 450) {
  if (!enabled || !session?.id) return;
  if (t.jobId || t.crawlerStartTimer) return;
  t.crawlerStartTimer = setTimeout(() => {
    t.crawlerStartTimer = null;
    if (!state.tabs.includes(t) || t.url !== url || t.jobId) return;
    void openCrawl(t, url, session, true);
  }, Math.max(150, Number(delayMs) || 450));
}
function openCrawl(t, url, session, enabled = true) {
  if (!enabled) return Promise.resolve(null);
  const engineMode = t.loadStrategy || settings.runtime || "auto";
  return api("/api/open", { json: { url, sessionId: session.id, engineMode } }).then(b => {
    if (!state.tabs.includes(t) || t.url !== url) { if (b?.jobId) stopJob(b.jobId); return null; }
    t.jobId = b?.jobId || null;
    t.done = b?.state === "cached" || !t.jobId;
    if (t.jobId) startPolling(t);
    return b;
  }).catch(e => {
    if (e.code !== "SESSION_EXPIRED") addLog("debug", `Background index skipped: ${e.message}`);
    return null;
  });
}
async function loadInTab(t, url, { loadFrame = true, record = null, forceBrowser = false } = {}) {
  const previousUrl = t.url;
  if (settings.autoStopPrevious && t.jobId && !t.done) stopJob(t.jobId).catch(() => {});
  if (t.poll) clearInterval(t.poll); t.poll = null; clearTimeout(t.browserPoll); clearTimeout(t.loadGuard); clearTimeout(t.crawlerStartTimer); clearTimeout(t.combinedGraceTimer); t.crawlerStartTimer = null; t.combinedGraceTimer = null;
  Object.assign(t, { url, view: "page", title: t.title && t.url && hostOf(t.url) === hostOf(url) ? t.title : hostOf(url), jobId: null, done: false, resources: [], links: [], selectedResource: -1, remoteLogIds: new Set(), readerOpen: false, loading: true, browserStatus: "", loadStrategy: settings.runtime || "auto", renderWinner: "" });
  if (!settings.preserveLog) { t.console = []; t.network = []; }
  rejectTab(t.id); hooks.dt?.onNavigate(t);
  const active = activeTab() === t;
  if (active) { renderActive({ push: false }); setLoading(true, 10, "Starting a clean session…"); }
  let session;
  try { session = await ensureSession(); }
  catch (e) { t.loading = false; if (activeTab() === t) setLoading(false); return renderError(t, "server", e); }
  if (!state.tabs.includes(t) || t.url !== url) return;
  t.sessionId = session.id;
  recordHistory(record?.kind || "page", url, record?.title || hostOf(url), session.id);
  const strategy = forceBrowser ? { key: "browser", proxy: false, crawler: false, browser: true, race: false } : resolveStrategy(url);
  t.loadStrategy = strategy.key;
  if (!state.tabs.includes(t) || t.url !== url) return;
  if (strategy.googleSearchFallback) {
    let q = ""; try { q = new URL(url).searchParams.get("q") || ""; } catch {}
    showSearch(q, { tab: t, push: false, pushHist: false, source: "web", engine: "google" });
    return;
  }

  t.done = true;
  if (activeTab() === t) setLoading(true, 24, strategy.race ? "Starting fast page pipeline…" : strategy.browser ? "Starting Chromium…" : strategy.crawler ? "Loading page + warming required assets…" : "Loading through the fast proxy…");

  
  
  const switchToFastProxy = (tab, targetUrl, sess, reason) => {
    if (!state.tabs.includes(tab) || tab.url !== targetUrl) return;
    tab.browserMode = "FAST_PROXY";
    tab.failoverReason = reason || "breaker_open";
    tab.browserSessionId = "";
    tab.browserStatus = "";
    if (!tab.renderWinner) tab.renderWinner = "proxy";
    if (loadFrame) {
      const f = getOrCreateFrame(tab);
      f.removeAttribute("srcdoc");
      f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      f.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture");
      f.src = proxyUrl(targetUrl, "view", sess.id, state.tabs.find(tt => tt === tab)?.previousUrl);
      if (activeTab() === tab) showFrameForTab(tab);
    }
    tab.loading = false; clearTimeout(tab.loadGuard);
    if (activeTab() === tab) setLoading(false);
    renderTabsSoon();
  };

  const useProxy = async () => {
    if (!loadFrame) return;
    t.browserMode = "FAST_PROXY";
    const f = getOrCreateFrame(t);
    f.removeAttribute("srcdoc");
    
    
    
    
    
    t.youtubeEmbed = false;
    f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    f.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture");
    f.src = proxyUrl(url, "view", session.id, previousUrl);
    if (activeTab() === t) showFrameForTab(t);
    
    
    
    if (isYouTubeUrl(url)) setTimeout(() => {
      
      
      
      if (state.tabs.includes(t) && t.browserMode === "FAST_PROXY" && t.loading) {
        t.loading = false;
        if (activeTab() === t) setLoading(false);
        renderTabsSoon();
      }
    }, 3500);
  };

  
  
  
  
  const raceChromium = () => startBrowserSession(t, url, { background: true }).then(result => {
      if (!state.tabs.includes(t) || t.url !== url) return;
      if (result?.ok === false) {
        
        
        if (!t.renderWinner || t.renderWinner === "proxy") {
          switchToFastProxy(t, url, session, result.reason);
        }
        return;
      }
      if (!t.renderWinner) {
        t.renderWinner = "browser";
        clearTimeout(t.combinedGraceTimer); t.combinedGraceTimer = null;
        t.browserMode = "BROWSER_ENGINE";
        if (activeTab() === t) showFrameForTab(t);
        t.loading = false; clearTimeout(t.loadGuard); if (activeTab() === t) setLoading(false);
        if (["combined", "auto", "crawler"].includes(t.loadStrategy)) scheduleDeferredCrawler(t, url, session, true, 250);
        hooks.dt?.onPageLoaded(t); hooks.applyExtensionsToTab?.(t);
        renderTabsSoon();
      } else if (t.renderWinner !== "browser") {
        stopBrowserSession(t).catch(() => {});
      }
    }).catch(e => { if (e.code !== "SESSION_EXPIRED") addLog("debug", `Combined Chromium path unavailable: ${e.message}`); });

  if (strategy.race) {
    
    
    
    if (strategy.forceBrowserHost) {
      t.loadStrategy = "browser"; t.renderWinner = "";
      
      
      
      if (loadFrame) {
        t.browserMode = "FAST_PROXY";
        const f = getOrCreateFrame(t);
        f.removeAttribute("srcdoc");
        f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        f.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture");
        f.src = proxyUrl(url, "view", session.id, previousUrl);
        if (activeTab() === t) showFrameForTab(t);
      }
      void raceChromium();
      
      
      
      const softTimeoutMs = state.server.leanMode ? 12000 : 25000;
      t.loadGuard = setTimeout(() => {
        if (!t.renderWinner && t.url === url && state.tabs.includes(t)) {
          if (!t.browserSessionId) {
            
            switchToFastProxy(t, url, session, "chromium_timeout");
          } else {
            t.loading = false; if (activeTab() === t) setLoading(false); renderTabsSoon();
          }
        }
      }, softTimeoutMs);
      return renderTabs();
    }
    
    
    
    
    
    await useProxy();
    if (state.server.leanMode && !strategy.forceBrowserHost) {
      scheduleDeferredCrawler(t, url, session, true, 150);
      
      
      
      
      t.combinedGraceTimer = setTimeout(() => {
        t.combinedGraceTimer = null;
        if (!state.tabs.includes(t) || t.url !== url || t.browserSessionId || t.renderWinner === "browser") return;
        capability(url).then(mode => {
          if (!state.tabs.includes(t) || t.url !== url || t.browserSessionId || t.renderWinner === "browser") return;
          if (mode === "BROWSER_ENGINE") void raceChromium();
        }).catch(() => {});
      }, 1800);
    } else {
      
      void raceChromium();
    }
    
    
    const combinedSoftMs = state.server.leanMode ? 12000 : Math.max(60000, Number(settings.requestTimeoutMs) || 30000);
    t.loadGuard = setTimeout(() => {
      if (!t.renderWinner && t.url === url && state.tabs.includes(t)) {
        if (!t.browserSessionId && state.server.leanMode) {
          switchToFastProxy(t, url, session, "chromium_timeout");
        } else {
          t.loading = false; if (activeTab() === t) setLoading(false); renderTabsSoon();
        }
      }
    }, combinedSoftMs);
    return renderTabs();
  }

  const shouldBrowser = strategy.browser;
  if (shouldBrowser) {
    try {
      const result = await startBrowserSession(t, url);
      if (result?.ok === false) {
        
        addLog("info", `Chromium failover for ${hostOf(url)}: ${result.reason}. Using fast proxy.`);
      } else {
        t.renderWinner = "browser";
        renderTabs();
        return;
      }
    } catch (e) {
      if (e.code === "SESSION_EXPIRED") return;
      if (!state.tabs.includes(t) || t.url !== url) return;
      if (strategy.google) {
        
        addLog("info", `Google via Chromium unavailable (${e.message}); showing Veyra web results.`);
        if (t.browserSessionId) stopBrowserSession(t).catch(() => {});
        t.browserMode = "FAST_PROXY"; t.browserSessionId = "";
        let q = ""; try { q = new URL(url).searchParams.get("q") || ""; } catch {}
        showSearch(q, { tab: t, push: activeTab() === t, pushHist: false, source: "web", engine: "google" });
        return;
      }
      if (strategy.forceBrowserHost) {
        addLog("warn", `Required Chromium path unavailable for ${hostOf(url)}: ${e.message}`);
        if (t.browserSessionId) stopBrowserSession(t).catch(() => {});
        t.browserMode = "FAST_PROXY"; t.browserSessionId = "";
        return renderError(t, "server", Object.assign(new Error(`This site requires real Chromium, but Chromium is currently unavailable: ${e.message}`), { code: e.code }));
      }
      if (e.code === "BROWSER_CAPACITY") addLog("warn", `Chromium is at capacity; using fast proxy: ${e.message}`);
      else addLog("warn", `Chromium unavailable, using fast proxy: ${e.message}`);
      if (t.browserSessionId) stopBrowserSession(t).catch(() => {});
      t.browserMode = "FAST_PROXY"; t.browserSessionId = "";
      if (settings.runtime === "browser" && !settings.browserFallback) return renderError(t, "server", e);
    }
  }

  t.renderWinner = "proxy";
  await useProxy();
  
  if (strategy.accelerate) scheduleDeferredCrawler(t, url, session, true, 150);
  if (strategy.probe) {
    capability(url).then(mode => {
      if (!state.tabs.includes(t) || t.url !== url) return;
      if (mode === "ACCELERATED_PROXY" && !state.server.leanMode) scheduleDeferredCrawler(t, url, session, true, 150);
      
      else if (mode === "BROWSER_ENGINE" && browserFallbackAllowed() && t.loading && !state.server.leanMode) {
        t.loadStrategy = "combined"; t.renderWinner = "";
        void raceChromium();
      }
    }).catch(() => {});
  }
  t.loadGuard = setTimeout(() => {
    if (t.loading && t.url === url && state.tabs.includes(t)) { t.loading = false; if (activeTab() === t) setLoading(false); renderTabsSoon(); }
  }, Math.max(60000, Number(settings.requestTimeoutMs) || 30000));
  renderTabs(); updateIdentity();
}

export function recordHistory(kind, url, title, sid = state.session?.id) {
  if (!url) return; const prev = state.history[0];
  if (prev && prev.url === url) { prev.time = new Date().toISOString(); if (title) prev.title = title; saveHistory(); return; }
  state.history.unshift({ id: uid(), time: new Date().toISOString(), kind, url, title: String(title || hostOf(url) || url).slice(0, 240), sid });
  if (state.history.length > (settings.historyMax || 1000)) state.history.length = settings.historyMax || 1000;
  saveHistory();
}
function renderError(t, kind, error) {
  t.view = "page"; t.loading = false;
  const titles = { server: "Veyra couldn't reach its server", unsupported: "This page can't be opened in Veyra", invalid: "That address isn't valid" };
  const f = getOrCreateFrame(t);
  f.srcdoc = `<!doctype html><meta charset="utf-8"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#1b1f27}main{max-width:520px;padding:32px}h1{font-size:24px;margin:0 0 8px}p{color:#5b6372}code{font-size:12px;color:#8a93a3}button{margin-top:14px;height:38px;padding:0 18px;border-radius:99px;border:0;background:#3d6fd6;color:#fff;font-weight:600;cursor:pointer}</style><main><h1>${esc(titles[kind] || "The page could not be displayed")}</h1><p>${esc(error?.message || "Unknown error")}</p>${error?.requestId ? `<code>Request ${esc(error.requestId)}</code><br>` : ""}<button onclick="parent.postMessage({type:'veyra:local-retry'},'*')">Try again</button></main>`;
  if (activeTab() === t) { showFrameForTab(t); setLoading(false); }
  addLog("error", `Open failed: ${error?.message}`, { requestId: error?.requestId });
}


function startPolling(t) { if (t.poll) clearInterval(t.poll); pollJob(t); t.poll = setInterval(() => pollJob(t), 1200); }
async function pollJob(t) {
  if (!state.tabs.includes(t) || !t.jobId) { if (t.poll) clearInterval(t.poll); return; }
  try {
    const b = await api(`/api/crawl/${encodeURIComponent(t.jobId)}`, { timeoutMs: 8000 });
    for (const x of b.logs || []) { if (t.remoteLogIds.has(x.id)) continue; t.remoteLogIds.add(x.id); logs.push({ time: new Date(x.time).getTime(), level: x.level, message: `[${hostOf(t.url)}] ${x.message}` }); }
    if (activeTab()?.view === "console") renderConsole();
    if (b.done) { clearInterval(t.poll); t.poll = null; t.done = true; await Promise.all([loadResources(t), loadLinks(t)]); }
  } catch (e) { if (e.status === 404 || e.code === "SESSION_EXPIRED") { clearInterval(t.poll); t.poll = null; } }
}
async function stopJob(id) { try { await api(`/api/crawl/${encodeURIComponent(id)}/stop`, { method: "POST" }); } catch {} }
async function loadResources(t) { if (!t?.jobId) return; try { const b = await api(`/api/crawl/${encodeURIComponent(t.jobId)}/resources`); t.resources = b.resources || []; if (activeTab()?.view === "resources") renderResources(); } catch {} }
async function loadLinks(t) { if (!t?.jobId) return; try { const b = await api(`/api/crawl/${encodeURIComponent(t.jobId)}/links?offset=0&limit=2000`); t.links = b.links || []; if (activeTab()?.view === "links") renderLinks(); } catch {} }


async function refreshRemote(t, loop = false) {
  if (!t?.browserSessionId || !state.tabs.includes(t)) return;
  clearTimeout(t.browserPoll);
  const expectedId = t.browserSessionId;
  try {
    const r = await api(`/api/browser/session/${encodeURIComponent(expectedId)}`, { timeoutMs: 8000 });
    if (t.browserSessionId !== expectedId) return;
    const s = r.session; const prev = t.url; t.lastBrowserUse = Date.now();
    if (!t.youtubeEmbed) t.url = s.canonicalUrl || t.url;
    t.title = s.title || hostOf(t.url); t.browserStatus = s.status; t.loading = false;
    if (t.url && prev && t.url !== prev) { pushTabHistory(t, t.url); recordHistory("page", t.url, t.title); }
    if (activeTab() === t && t.view === "page") {
      const img = $("remoteImg"); if (img) img.src = `${API}/api/browser/session/${encodeURIComponent(t.browserSessionId)}/screenshot?ts=${Date.now()}`;
      const ld = $("remoteLoading"); if (ld && !img?.complete) ld.style.display = "grid";
      setLoading(false); updateAddress(); updateIdentity();
      if (s.status === "VERIFICATION_REQUIRED") $("statusLeft").textContent = "Site robot check detected. Complete it in the page, or use Reload to start a clean Chromium session.";
      else if (s.status === "BROWSER_ERROR" || s.status === "CRASHED") {
        const er = $("remoteError"), erT = $("remoteErrorText");
        if (er) er.style.display = "grid";
        if (erT) erT.textContent = s.lastError || "The browser session encountered an error.";
        const ld2 = $("remoteLoading"); if (ld2) ld2.style.display = "none";
      }
    }
    renderTabsSoon();
  } catch (e) {
    if (e.code === "BROWSER_SESSION_NOT_FOUND") {
      if (t.browserSessionId !== expectedId) return;
      t.browserSessionId = "";
      t.browserMode = "FAST_PROXY";
      t.browserStatus = "BROWSER_LOST";
      clearRemoteSurface();
      if (state.tabs.includes(t) && t.view === "page" && t.url && t.sessionId && state.session?.id === t.sessionId) {
        const f = getOrCreateFrame(t);
        f.removeAttribute("srcdoc");
        f.src = proxyUrl(t.url, "view", t.sessionId);
        t.renderWinner = "proxy";
        if (activeTab() === t) showFrameForTab(t);
      } else if (activeTab() === t) {
        renderTabsSoon();
        updateIdentity();
      }
      return;
    }
  }
  if (loop && activeTab() === t && t.view === "page") t.browserPoll = setTimeout(() => refreshRemote(t, true), document.hidden ? 5000 : 1500);
}
function releaseInactiveBrowserSlot(exclude) {
  const candidates = state.tabs.filter(t => t !== exclude && t.view === "page" && t.browserSessionId && t.browserMode === "BROWSER_ENGINE");
  if (!candidates.length) return false;
  
  
  candidates.sort((a, b) => (Number(a.lastBrowserUse || 0) - Number(b.lastBrowserUse || 0)) || (state.tabs.indexOf(a) - state.tabs.indexOf(b)));
  const victim = candidates[0];
  addLog("info", `Chromium capacity full; releasing inactive Chromium tab ${hostOf(victim.url) || "(unknown)"} for ${hostOf(exclude?.url) || "the requested site"}.`);
  void stopBrowserSession(victim);
  return true;
}

async function startBrowserSession(t, url, { background = false } = {}) {
  const sid = state.session?.id || "";
  
  
  const browserUrl = url;
  if (t.browserSessionId) {
    try {
      const b = await api(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}/navigate`, { json: { url: browserUrl, fastStart: !!background }, timeoutMs: 45000 });
      t.browserMode = "BROWSER_ENGINE"; t.youtubeEmbed = false; t.url = url || b.session.canonicalUrl || url;
      if (!background) { t.loading = false; if (activeTab() === t) showFrameForTab(t); }
      else if (!t.renderWinner) t.browserStatus = b.session.status || "ready";
      return { ok: true };
    } catch (e) { if (e.code !== "BROWSER_SESSION_NOT_FOUND") { await stopBrowserSession(t); throw e; } t.browserSessionId = ""; }
  }
  let b;
  try {
    b = await api("/api/browser/session", { json: { tabId: t.id, url: browserUrl, proxySessionId: sid, fastStart: !!background }, timeoutMs: 45000 });
  } catch (e) {
    
    if (e.fallbackMode === "FAST_PROXY" || e.code === "BROWSER_FAILOVER") {
      t.browserMode = "FAST_PROXY"; t.failoverReason = e.reason || "breaker_open"; t.failoverRetryAfterMs = e.retryAfterMs || 60000;
      addLog("info", `Chromium in cooldown — using fast proxy. ${e.error || ""}`);
      if (activeTab() === t) renderTabs();
      return { ok: false, fallback: true, reason: e.reason || "breaker_open" };
    }
    if (e.code !== "BROWSER_CAPACITY" || !releaseInactiveBrowserSlot(t)) throw e;
    
    await new Promise(r => setTimeout(r, 150));
    try {
      b = await api("/api/browser/session", { json: { tabId: t.id, url: browserUrl, proxySessionId: sid, fastStart: !!background }, timeoutMs: 45000 });
    } catch (e2) {
      if (e2.fallbackMode === "FAST_PROXY" || e2.code === "BROWSER_FAILOVER") {
        t.browserMode = "FAST_PROXY"; t.failoverReason = e2.reason || "breaker_open"; t.failoverRetryAfterMs = e2.retryAfterMs || 60000;
        addLog("info", `Chromium in cooldown — using fast proxy. ${e2.error || ""}`);
        if (activeTab() === t) renderTabs();
        return { ok: false, fallback: true, reason: e2.reason || "breaker_open" };
      }
      throw e2;
    }
  }
  t.lastBrowserUse = Date.now();
  t.browserMode = "BROWSER_ENGINE"; t.browserSessionId = b.session.id; t.youtubeEmbed = false; t.failoverReason = null; t.failoverRetryAfterMs = 0; t.url = url || b.session.canonicalUrl || url;
  if (!background) frameFor(t)?.remove();
  if (!background) { t.loading = false; if (activeTab() === t) { showFrameForTab(t); setLoading(false); } hooks.dt?.onPageLoaded(t); hooks.applyExtensionsToTab?.(t); }
  else if (!t.renderWinner) { t.browserStatus = b.session.status || "ready"; }
  return { ok: true };
}
async function stopBrowserSession(t) {
  if (!t?.browserSessionId) { if (t) t.browserMode = "FAST_PROXY"; if (activeTab() === t) clearRemoteSurface(); return; }
  const id = t.browserSessionId; t.browserSessionId = ""; t.browserMode = "FAST_PROXY"; t.browserStatus = ""; clearTimeout(t.browserPoll);
  if (activeTab() === t) clearRemoteSurface();
  try { await api(`/api/browser/session/${encodeURIComponent(id)}`, { method: "DELETE" }); } catch {}
}

export async function retryFullBrowser() {
  const t = activeTab(); if (!t || t.view !== "page" || !t.url) return;
  const sid = state.session?.id || "";
  try { await api("/api/browser/retry", { json: { proxySessionId: sid }, timeoutMs: 10000 }); }
  catch {}
  t.failoverReason = null; t.failoverRetryAfterMs = 0;
  t.browserMode = "FAST_PROXY";
  void startBrowserSession(t, t.url, { background: false }).catch(() => {});
  renderTabs();
}
async function remoteHistory(t, direction) { try { await api(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}/history`, { json: { direction } }); await refreshRemote(t, true); return true; } catch { return false; } }


export async function back() {
  const t = activeTab(); if (!t) return;
  if (isRemote(t) && t.view === "page" && await remoteHistory(t, "back")) return;
  if (t.histIndex <= 0) return; t.histIndex--; await restoreHistoryEntry(t);
}
export async function forward() {
  const t = activeTab(); if (!t) return;
  if (isRemote(t) && t.view === "page" && await remoteHistory(t, "forward")) return;
  if (t.histIndex >= t.history.length - 1) return; t.histIndex++; await restoreHistoryEntry(t);
}
async function restoreHistoryEntry(t) {
  const e = t.history[t.histIndex]; if (!e) return;
  if (e.startsWith("veyra:search:")) return showSearch(e.slice(13), { tab: t, pushHist: false });
  if (e.startsWith("veyra:")) { const [view, section] = e.slice(6).split("/"); const idx = t.histIndex; openInternal(view, { tab: t, section }); t.histIndex = idx; t.history.length = Math.max(t.history.length, idx + 1); updateNavButtons(); return; }
  await navigate(e, { tab: t, pushHist: false });
}
export async function reload({ hard = false } = {}) {
  const t = activeTab(); if (!t) return;
  if ($("reloadBtn").dataset.loading === "1" && !hard) return stopLoad();
  if (t.view === "page" && t.url) {
    // A site-level robot check can be tied to the current Chromium context.
    // Reusing that context only reloads the same rejected cookies/session, so
    // make the normal browser reload action start a clean context instead.
    if (isRemote(t) && t.browserStatus === "VERIFICATION_REQUIRED") {
      const url = t.url;
      setLoading(true, 20, "Starting a clean Chromium session…");
      await stopBrowserSession(t);
      try {
        await startBrowserSession(t, url, { background: false });
      } catch (e) {
        t.loading = false;
        if (activeTab() === t) setLoading(false);
        addLog("warn", `Fresh Chromium verification retry failed: ${e.message}`);
      }
      return;
    }
    if (isRemote(t)) { if (await remoteHistory(t, "reload")) return; }
    if (hard) state.capabilityCache.delete(hostOf(t.url));
    return loadInTab(t, t.url, { loadFrame: true });
  }
  if (t.view === "search") return runSearch(t.searchQuery);
  renderActive({ push: false });
}
export async function stopLoad() {
  const t = activeTab(); if (!t) return;
  if (t.browserSessionId) api(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}/stop`, { method: "POST" }).catch(() => {});
  try { frameFor(t)?.contentWindow?.stop?.(); } catch {}
  setLoading(false); toast("Stopped loading");
}
export function goHome() { const t = activeTab(); if (!t) return; if (settings.homepage) return go(settings.homepage); if (t.view === "page") teardownTab(t); Object.assign(t, { view: "newtab", url: "", title: "New tab", favicon: "", browserMode: "FAST_PROXY", browserSessionId: "", loading: false, renderWinner: "", loadStrategy: settings.runtime || "auto" }); pushTabHistory(t, "veyra:newtab"); renderTabs(); renderActive(); }
export function pageCommand(type, payload = {}, t = activeTab()) {
  const f = frameFor(t); if (!f?.contentWindow || !t?.url) return false;
  const targetOrigin = f.sandbox?.contains("allow-same-origin") ? API_ORIGIN : "*";
  try { f.contentWindow.postMessage({ type, ...payload }, targetOrigin); return true; } catch { return false; }
}
export function printPage() { const t = activeTab(); if (t?.view !== "page" || !t.url) { window.print(); return; } if (isRemote(t)) { window.open(`${API}/api/browser/session/${encodeURIComponent(t.browserSessionId)}/screenshot`, "_blank", "noopener"); return; } if (!pageCommand("veyra:print")) toast("This page can't be printed yet", { kind: "warn" }); }
export function setZoom(z, t = activeTab()) {
  if (!t || t.view !== "page") { const s = Math.max(.8, Math.min(1.4, Number(z) || 1)); settings.fontScale = s; saveSettings(); document.documentElement.style.setProperty("--ui-scale", s); toast(`Veyra UI ${Math.round(s * 100)}%`); return; }
  t.zoom = Math.round(Math.max(.25, Math.min(5, Number(z) || 1)) * 100) / 100;
  dtCall(t, "ext.zoom", { zoom: t.zoom }, 4000).catch(e => toast(e.message, { kind: "warn" }));
  updateIdentity(); hooks.onZoom?.(t.zoom);
}
const ZOOM_STEPS = [.25, .33, .5, .67, .75, .8, .9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
export function zoomStep(dir) { const t = activeTab(); const cur = t?.view === "page" ? t.zoom : settings.fontScale || 1; if (dir === 0) return setZoom(1); const next = dir > 0 ? ZOOM_STEPS.find(z => z > cur + .001) : [...ZOOM_STEPS].reverse().find(z => z < cur - .001); setZoom(next ?? cur); }


export function toggleBookmark() {
  const t = activeTab(); if (!t?.url) return;
  const i = state.bookmarks.findIndex(b => b.url === t.url);
  if (i >= 0) { const [b] = state.bookmarks.splice(i, 1); saveBookmarks(); toast("Bookmark removed", { action: () => { state.bookmarks.splice(i, 0, b); saveBookmarks(); updateIdentity(); }, actionLabel: "Undo" }); sendNeuralFeedback(t.url, false, 2.0); }
  else { state.bookmarks.push({ id: uid(), url: t.url, title: t.title || hostOf(t.url), time: Date.now() }); saveBookmarks(); toast("Bookmarked"); sendNeuralFeedback(t.url, true, 3.0); }
  updateIdentity();
}


export function openFind() {
  const t = activeTab(); if (t?.view !== "page" || !t.url) { toast("Open a website to search inside it"); return; }
  if (isRemote(t)) { toast("Find isn't available in Chromium tabs yet", { kind: "warn" }); return; }
  $("findBar").classList.remove("hidden"); $("findInput").focus(); $("findInput").select(); if ($("findInput").value) findQuery($("findInput").value);
}
function findQuery(q, direction = "forward") { pageCommand("veyra:find", { query: q, direction }); if (!q) $("findCount").textContent = "0/0"; }
export function closeFind() { $("findBar").classList.add("hidden"); pageCommand("veyra:find-close"); }


export function showSearch(query = "", { tab = null, push = true, pushHist = true, source = "", engine = "" } = {}) {
  let t = tab || activeTab(); if (!t) return;
  if (t.view === "page") teardownTab(t);
  Object.assign(t, { view: "search", title: query ? `${query} - Veyra Search` : "Veyra Search", url: "", favicon: "", searchQuery: query, searchData: null, searchCorrection: null, loading: false, browserSessionId: "", searchSource: source || t.searchSource || settings.searchSource || "web", searchEngine: engine || (settings.searchEngine === "google" ? "google" : "") });
  if (pushHist) pushTabHistory(t, "veyra:search:" + query);
  if (query) recordHistory("search", `veyra://search?q=${encodeURIComponent(query)}`, `${query} - Veyra Search`);
  renderTabs(); renderActive({ push });
  if (query) runSearch(query);
}
const PROVIDER_LABEL = { google: "Google API", duckduckgo: "DuckDuckGo", bing: "Bing", local: "Veyra index", brave: "Brave Search API", none: "no provider" };
async function runSearch(query, offset = 0, opts = {}) {
  const t = activeTab(); if (!t || t.view !== "search") return; t.searchQuery = query;
  const source = t.searchSource || "web";
  if (!offset && !opts.corrected && query.trim()) {
    try {
      const correction = await api(`/api/search/correct?q=${encodeURIComponent(query)}`, { timeoutMs: 3500 });
      if (correction.changed && correction.corrected && correction.corrected.toLowerCase() !== query.toLowerCase()) {
        t.searchCorrection = { original: query, corrected: correction.corrected };
        
        
      }
    } catch {}
  }
  const correction = t.searchCorrection;
  const correctionEl = $("searchCorrection");
  if (correctionEl) {
    correctionEl.classList.toggle("hidden", !correction);
    correctionEl.innerHTML = correction ? `Did you mean: <a href="#" data-corrected="${esc(correction.corrected)}">${esc(correction.corrected)}</a>` : "";
    correctionEl.querySelector("[data-corrected]")?.addEventListener("click", e => {
      e.preventDefault();
      const corrected = e.currentTarget.dataset.corrected;
      t.searchCorrection = null; t.searchQuery = corrected;
      const input = $("searchInput"); if (input) input.value = corrected;
      runSearch(corrected, 0, { corrected: true });
    });
  }
  renderSearchTabs(t);
  $("searchStat").textContent = "Searching…"; $("searchMeta").textContent = "";
  $("aiAnswer").classList.add("hidden");
  if (!offset) $("searchResults").innerHTML = Array.from({ length: 4 }, () => `<div class="result"><div class="skel" style="height:16px;width:55%;border-radius:4px;background:var(--surface-3)"></div><div style="height:10px"></div><div style="height:12px;width:85%;border-radius:4px;background:var(--surface-2)"></div></div>`).join("");
  try {
    const b = source === "web"
      ? await api(`/api/search/web?q=${encodeURIComponent(query)}&offset=${offset}${t.searchEngine ? `&engine=${encodeURIComponent(t.searchEngine)}` : ""}&lang=${encodeURIComponent((navigator.language || "en").slice(0, 2))}`, { timeoutMs: 20000 })
      : await api(`/api/search?q=${encodeURIComponent(query)}&offset=${offset}&limit=10`);
    if (activeTab() !== t || t.searchQuery !== query) return;
    b.source = source;
    if (offset && t.searchData) t.searchData.results.push(...(b.results || [])); else t.searchData = b;
    renderSearch();
    
    if (!offset && (b.results || []).length > 0) fetchAIAnswer(t, query, b.results, source);
  } catch (e) { $("searchStat").textContent = "Search failed"; $("searchMeta").textContent = e.message; $("searchResults").innerHTML = `<div class="empty"><b>Veyra Search couldn't finish</b><span>${esc(e.message)}</span><button class="btn ghost sm" id="searchRetry">Try again</button></div>`; $("searchRetry").onclick = () => runSearch(query); }
}
async function fetchAIAnswer(t, query, results, source = "web") {
  const ai = $("aiAnswer");
  if (!ai) return;
  ai.classList.remove("hidden");
  ai.innerHTML = `<div class="ai-answer-card"><div class="ai-answer-header"><span class="ai-badge"><svg width="16" height="16"><use href="#i-bolt"/></svg> Veyra AI</span><span class="ai-thinking">Reading ${source === "index" ? "Veyra Index sources" : "the top sources"}…</span></div><div class="ai-answer-body"><div class="spinner" style="width:18px;height:18px;border-width:2px"></div></div></div>`;
  try {
    const r = await api("/api/search/answer", { json: { query, source, results: results.slice(0, 8).map(r => ({ url: r.url, title: r.title, snippet: r.snippet })) }, timeoutMs: 20000 });
    if (activeTab() !== t || t.searchQuery !== query) return;
    if (r.hasAnswer && !unsafeAiText(r.answer)) {
      const points = (r.keyPoints || []).filter(p => p && !unsafeAiText(p)).slice(0, 4);
      const caveats = (r.caveats || []).filter(p => p && !unsafeAiText(p)).slice(0, 3);
      ai.innerHTML = `<div class="ai-answer-card"><div class="ai-answer-header"><span class="ai-badge"><svg width="16" height="16"><use href="#i-bolt"/></svg> Veyra AI</span><span class="muted small">${esc(r.intent || "answer")} · ${r.sourceCount || r.sources?.length || 0} sources · ${Math.round((r.confidence || 0) * 100)}% confidence${r.readingTimeMinutes ? ` · ${r.readingTimeMinutes} min read` : ""}</span></div><div class="ai-answer-body">${highlightTerms(r.answer, query)}${points.length ? `<div class="ai-key-points"><b>Key points</b><ul>${points.map(p => `<li>${highlightTerms(p, query)}</li>`).join("")}</ul></div>` : ""}${caveats.length ? `<div class="ai-caveats"><b>Keep in mind</b><ul>${caveats.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}${r.relatedQueries?.length ? `<div class="ai-followups"><b>Explore next</b><div>${r.relatedQueries.map(q => `<button class="btn ghost sm" data-followup="${esc(q)}">${esc(q)}</button>`).join("")}</div></div>` : ""}</div>${r.sources?.length ? `<div class="ai-answer-sources">${r.sources.map(s => `<a class="r-url" href="${esc(s.url)}" data-open="${esc(s.url)}">${esc(s.id ? `${s.id} · ` : "")}${esc(displayUrl(s.url))}</a>`).join("")}</div>` : ""}</div>`;
      ai.querySelectorAll("[data-open]").forEach(a => a.onclick = e => { e.preventDefault(); if (e.ctrlKey || e.metaKey || e.button === 1) newTab({ url: a.dataset.open, background: true }); else navigate(a.dataset.open); });
      ai.querySelectorAll("[data-followup]").forEach(b => b.onclick = () => { t.searchQuery = b.dataset.followup; runSearch(t.searchQuery); });
    } else {
      ai.classList.add("hidden");
    }
  } catch {
    ai.classList.add("hidden");
  }
}
function unsafeAiText(value) {
  const text = String(value || "");
  return /CLIENT_CANARY_STATE|USER_DEFINED|(?:\\u[0-9a-f]{4}){2,}|(?:window|globalThis|self)\s*[.(]|\b(?:set\s*\(|document\.cookie|webpackJsonp)\b|enjoy the videos and music you love|upload original content/i.test(text)
    || /[{}[\];]{3,}/.test(text) && text.length > 120;
}
function highlightTerms(text, q) { const s = esc(text); const words = String(q).split(/\s+/).filter(w => w.length > 1 && !/:/.test(w)).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); return words.length ? s.replace(new RegExp(`(${words.join("|")})`, "gi"), "<mark>$1</mark>") : s; }
function renderSearchTabs(t) {
  qsa("#searchTabs [data-src]").forEach(b => { const on = b.dataset.src === (t.searchSource || "web"); b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
}
function renderSearch() {
  const t = activeTab(); if (!t || t.view !== "search") return;
  $("searchInput").value = t.searchQuery;
  renderSearchTabs(t);
  const d = t.searchData;
  const web = (t.searchSource || "web") === "web";
  if (!t.searchQuery) { $("searchResults").innerHTML = ""; $("aiAnswer").classList.add("hidden"); $("searchStat").textContent = "Veyra Search"; $("searchMeta").textContent = web ? "Veyra searches multiple providers in parallel — Brave, Bing, DuckDuckGo and Wikipedia — and merges the best results." : "Search pages Veyra has indexed. Operators like site: and intitle: work too."; $("searchMore").classList.add("hidden"); loadIndexStats(); setTimeout(() => $("searchInput").focus(), 20); return; }
  if (!d) return;
  $("searchStat").textContent = web ? `${(d.results?.length || 0)} results` : `${d.total == null ? (d.results?.length || 0) + "+" : Number(d.total).toLocaleString()} results`;
  $("searchMeta").textContent = `${web ? `from ${PROVIDER_LABEL[d.provider] || d.provider} · ` : ""}${d.responseTimeMs ?? "—"} ms${d.cached ? " · cached" : ""}${d.query?.intent ? ` · ${d.query.intent} search` : ""}${d.ranking?.method ? ` · ranked by ${d.ranking.method}` : ""}${web && t.searchEngine === "google" && d.provider !== "google" && d.googleConfigured === false ? " · Google API not configured on this server" : ""}`;
  $("searchResults").innerHTML = (d.results || []).map(r => `<article class="result"><div class="r-url">${esc(displayUrl(r.displayUrl || r.url))}${r.queryRelevance != null ? ` <span class="result-relevance">${Math.round(r.queryRelevance * 100)}% match</span>` : ""}</div><a class="r-title" href="${esc(r.url)}" data-open="${esc(r.url)}">${highlightTerms(r.title || r.url, t.searchQuery)}</a><p>${highlightTerms(r.snippet || "No description available.", t.searchQuery)}</p></article>`).join("")
    || (web ? `<div class="empty"><svg><use href="#i-search"/></svg><b>No web results for “${esc(t.searchQuery)}”</b><span>No provider returned usable results. Veyra will retry with alternate providers.</span><button class="btn primary sm" id="searchRetryVeyra">Retry with Veyra</button></div>`
      : `<div class="empty"><svg><use href="#i-search"/></svg><b>No indexed pages match “${esc(t.searchQuery)}”</b><span>The Veyra index only has pages Veyra has opened. Switch to Web to search everything.</span><button class="btn ghost sm" id="searchWeb">Search the web</button></div>`);
  $("searchResults").querySelectorAll("[data-open]").forEach(a => a.onclick = e => { e.preventDefault(); sendNeuralFeedback(a.dataset.open, true, 1.0); if (e.ctrlKey || e.metaKey || e.button === 1) newTab({ url: a.dataset.open, background: true }); else navigate(a.dataset.open); });
  $("searchWeb")?.addEventListener("click", () => { t.searchSource = "web"; t.searchData = null; runSearch(t.searchQuery); });
  $("searchRetryVeyra")?.addEventListener("click", () => { t.searchData = null; runSearch(t.searchQuery); });
  const more = web ? (d.results?.length || 0) >= 8 && (d.results?.length || 0) < 60 : d.total == null ? (d.results?.length || 0) >= 10 : (d.results?.length || 0) < d.total;
  $("searchMore").classList.toggle("hidden", !more); $("searchMore").onclick = () => runSearch(t.searchQuery, d.results.length);
  loadIndexStats();
}
async function loadIndexStats() { try { const b = await api("/api/search/stats", { timeoutMs: 6000 }); $("searchCoverage").textContent = `Veyra Index: ${Number(b.documents || 0).toLocaleString()} pages · ${Number(b.domains || 0).toLocaleString()} domains`; } catch { $("searchCoverage").textContent = ""; } }
let suggestTimer = 0;
function loadSuggestions(q) {
  clearTimeout(suggestTimer);
  if (!settings.suggestions) { $("searchSuggestions").innerHTML = ""; return; }
  suggestTimer = setTimeout(async () => { if (!settings.suggestions || !q.trim()) return; try { const b = await api(`/api/search/suggest?q=${encodeURIComponent(q)}&limit=8`, { timeoutMs: 4000 }); if (settings.suggestions) $("searchSuggestions").innerHTML = (b.suggestions || []).map(s => `<option value="${esc(s)}">`).join(""); } catch {} }, 160);
}
export async function omniSuggest(q) {
  if (!settings.suggestions || !q.trim()) return [];
  try { const b = await api(`/api/search/suggest?q=${encodeURIComponent(q)}&limit=5`, { timeoutMs: 3000 }); return b.suggestions || []; } catch { return []; }
}


function tokenize(s) {
  const out = []; let i = 0; s = String(s).replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  while (i < s.length) {
    const c = s[i]; if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const raw = s.slice(i).match(/^(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?(?:e[+-]?\d+)?|^\.\d+(?:e[+-]?\d+)?/i)?.[0];
      if (!raw) throw new Error("Invalid number.");
      out.push({ t: "n", v: Number(raw.replace(/,/g, "")) }); i += raw.length; continue;
    }
    if ("+-*/%^()".includes(c)) { out.push({ t: "o", v: c }); i++; continue; }
    if (c === ",") throw new Error("Use decimal points; thousands separators must group three digits.");
    throw new Error(`Unsupported character “${c}”.`);
  }
  out.push({ t: "e" }); return out;
}
export function evaluate(expr) {
  const tk = tokenize(expr); let p = 0; const peek = () => tk[p], take = () => tk[p++];
  const primary = () => { const x = take(); if (x.t === "n") return x.v; if (x.v === "(") { const v = expr0(); if (take().v !== ")") throw new Error("Missing closing parenthesis."); return v; } throw new Error("Expected a number."); };
  const postfix = () => { let v = primary(); while (peek().v === "%") { take(); v /= 100; } return v; };
  const unary = () => { if (peek().v === "-") { take(); return -unary(); } if (peek().v === "+") { take(); return unary(); } return power(); };
  const power = () => { let b = postfix(); if (peek().v === "^") { take(); b = Math.pow(b, unary()); } return b; };
  const term = () => { let v = unary(); while (["*", "/"].includes(peek().v)) { const o = take().v, r = unary(); if (o === "/" && r === 0) throw new Error("Division by zero."); v = o === "*" ? v * r : v / r; } return v; };
  const expr0 = () => { let v = term(); while (["+", "-"].includes(peek().v)) { const o = take().v, r = term(); v = o === "+" ? v + r : v - r; } return v; };
  const v = expr0(); if (peek().t !== "e") throw new Error("Unexpected token."); if (!Number.isFinite(v)) throw new Error("Result isn't finite."); return v;
}
const fmtNum = v => Number.isInteger(v) ? v.toLocaleString("en-GB") : String(Number(v.toPrecision(12)));
function renderCalculator() {
  const t = activeTab(); if (!t) return; const input = $("calcInput");
  if (document.activeElement !== input) input.value = t.calcExpression || "";
  const v = input.value.trim(); t.calcExpression = v;
  if (!v) { $("calcResult").textContent = "0"; $("calcStatus").textContent = "Supports + − × ÷ % ^, parentheses and negative numbers."; return; }
  try { const result = evaluate(v); $("calcResult").textContent = fmtNum(result); $("calcStatus").textContent = Number.isInteger(result) && !Number.isSafeInteger(result) ? "Calculated on your device. Large integer precision may be limited." : "Calculated on your device."; } catch (e) { $("calcResult").textContent = "—"; $("calcStatus").textContent = e.message; }
}
function setupCalculator() {
  const keys = ["C", "(", ")", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "%", "0", ".", "="];
  $("calcKeys").innerHTML = keys.map(k => `<button class="${"÷×−+%()".includes(k) ? "op" : k === "=" ? "eq" : ""}" data-k="${k}">${k}</button>`).join("");
  $("calcKeys").onclick = e => { const k = e.target.closest("[data-k]")?.dataset.k; if (!k) return; const input = $("calcInput");
    if (k === "C") input.value = ""; else if (k === "=") { try { input.value = String(evaluate(input.value)); } catch {} } else input.value += k;
    activeTab().calcExpression = input.value; renderCalculator(); input.focus(); };
  $("calcInput").oninput = () => { activeTab().calcExpression = $("calcInput").value; renderCalculator(); syncRoute({ replace: true }); };
  $("calcInput").onkeydown = e => { if (e.key === "Enter") { try { $("calcInput").value = String(evaluate($("calcInput").value)); renderCalculator(); } catch {} } };
}


const MAX_IN_MEMORY_DOWNLOAD = 100 * 1024 * 1024;
function safeDownloadName(value, fallback = "download") {
  let name = String(value || "").split("/").pop().split("?")[0] || fallback;
  try { name = decodeURIComponent(name); } catch {}
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return name.slice(0, 180) || fallback;
}
function trimDownloads() {
  const max = Math.max(10, Number(settings.downloadsMax) || 200);
  if (state.downloads.length <= max) return;
  const live = state.downloads.filter(d => state.downloadControllers.has(d.id) || ["starting", "downloading"].includes(d.status));
  const settled = state.downloads.filter(d => !live.includes(d)).slice(0, Math.max(0, max - live.length));
  const keep = new Set([...live, ...settled]); state.downloads = state.downloads.filter(d => keep.has(d));
}
export async function startDownload(url, name = "") {
  if (!/^https?:\/\//i.test(url || "")) return;
  let session; try { session = await ensureSession(); } catch (e) { toast(e.message, { kind: "err" }); return; }
  const item = { id: uid(), time: new Date().toISOString(), url, name: safeDownloadName(name || pathOf(url), hostOf(url) || "download"), status: "starting", received: 0, total: 0 };
  state.downloads.unshift(item); trimDownloads(); saveDownloads(); renderDownloads(); hooks.onDownloadsChanged?.();
  if (settings.downloadsOpenOnStart) toast(`Downloading ${item.name}`, { action: () => openInternal("downloads"), actionLabel: "Show" });
  const controller = new AbortController(); state.downloadControllers.set(item.id, controller);
  const timeoutMs = Math.max(30000, Number(settings.requestTimeoutMs) || 30000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await rawFetch(proxyUrl(url, "download", session.id), { signal: controller.signal });
    if (!res.ok) { let m = `HTTP ${res.status}`; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
    item.total = Number(res.headers.get("content-length") || 0);
    const cd = res.headers.get("content-disposition") || ""; const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i); if (m) item.name = safeDownloadName(m[1], item.name);
    const reader = res.body?.getReader(); const chunks = [];
    let writer = null;
    if (reader && window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({ suggestedName: item.name, types: [{ description: "Download", accept: { "application/octet-stream": [".*"] } }] });
      writer = await handle.createWritable();
    } else if (item.total > MAX_IN_MEMORY_DOWNLOAD) {
      throw new Error("This download is over the 100 MB browser-memory limit. Use a browser with streaming file saving to continue.");
    }
    if (reader) for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      item.received += value.byteLength; item.status = "downloading"; renderDownloadsSoon();
      if (writer) await writer.write(value);
      else { if (item.received > MAX_IN_MEMORY_DOWNLOAD) throw new Error("Download exceeded the 100 MB browser-memory limit."); chunks.push(value); }
    }
    else {
      if (item.total > MAX_IN_MEMORY_DOWNLOAD) throw new Error("This download is over the 100 MB browser-memory limit.");
      const buf = new Uint8Array(await res.arrayBuffer()); if (buf.byteLength > MAX_IN_MEMORY_DOWNLOAD) throw new Error("Download exceeded the 100 MB browser-memory limit."); chunks.push(buf); item.received = buf.byteLength;
    }
    if (writer) await writer.close();
    else { const blob = new Blob(chunks, { type: res.headers.get("content-type") || "application/octet-stream" }); const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: item.name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); }
    item.status = "complete"; item.total = item.total || item.received;
  } catch (e) { item.status = e.name === "AbortError" ? "cancelled" : "failed"; item.error = e.message; if (e.name !== "AbortError") toast(`Download failed: ${e.message}`, { kind: "err" }); }
  finally { clearTimeout(timeout); state.downloadControllers.delete(item.id); trimDownloads(); saveDownloads(); renderDownloads(); hooks.onDownloadsChanged?.(); }
}
let dlRaf = 0; function renderDownloadsSoon() { if (dlRaf) return; dlRaf = requestAnimationFrame(() => { dlRaf = 0; renderDownloads(); }); }
function renderDownloads() {
  const box = $("downloadsList"); if (!box || activeTab()?.view !== "downloads") return;
  const q = $("downloadsFilter").value.toLowerCase();
  const list = state.downloads.filter(d => !q || (d.name + d.url).toLowerCase().includes(q));
  if (!list.length) { box.innerHTML = `<div class="empty"><svg><use href="#i-download"/></svg><b>${q ? "No matching downloads" : "No downloads yet"}</b><span>Files you save through Veyra show up here.</span></div>`; return; }
  box.innerHTML = list.map(d => { const pct = d.total ? Math.round(d.received / d.total * 100) : 0; const live = state.downloadControllers.has(d.id);
    return `<div class="row-item"><svg><use href="#i-file"/></svg><div class="ri-main"><b>${esc(d.name)}</b><span>${esc(displayUrl(d.url))}</span>${live ? `<div class="progress"><i style="width:${d.total ? pct : 30}%"></i></div>` : ""}</div>
    <span class="pill ${d.status === "complete" ? "ok" : d.status === "failed" ? "err" : d.status === "cancelled" ? "" : "accent"}">${live ? (d.total ? pct + "%" : fmtBytes(d.received)) : esc(d.status)}${d.status === "complete" && d.total ? " · " + fmtBytes(d.total) : ""}</span>
    <time>${esc(timeAgo(d.time))}</time>
    ${live ? `<button class="btn ghost sm" data-cancel="${d.id}">Cancel</button>` : `<button class="icon-btn sm" title="Download again" data-again="${d.id}"><svg><use href="#i-reload"/></svg></button><button class="icon-btn sm" title="Remove from list" data-rm="${d.id}"><svg><use href="#i-x"/></svg></button>`}</div>`; }).join("");
  box.onclick = e => { const b = e.target.closest("button"); if (!b) return; const d = state.downloads.find(x => x.id === (b.dataset.cancel || b.dataset.again || b.dataset.rm)); if (!d) return;
    if (b.dataset.cancel) state.downloadControllers.get(d.id)?.abort(); else if (b.dataset.again) startDownload(d.url, d.name); else { state.downloads.splice(state.downloads.indexOf(d), 1); saveDownloads(); renderDownloads(); } };
}


function renderHistory() {
  const box = $("historyList"); if (!box) return;
  const q = $("historyFilter").value.toLowerCase();
  const all = state.history.filter(h => !q || (h.title + " " + h.url).toLowerCase().includes(q));
  const list = all.slice(0, state.historyRenderLimit);
  if (!list.length) { box.innerHTML = `<div class="empty"><svg><use href="#i-history"/></svg><b>${q ? "Nothing matches" : "Your history is empty"}</b><span>${settings.clearHistoryOnSessionEnd ? "History from a session is removed when it ends. You can change this in Settings > Privacy." : "Pages you visit show up here."}</span></div>`; return; }
  let lastDay = ""; let html = "";
  for (const h of list) {
    const day = new Date(h.time).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    if (day !== lastDay) { html += `<div class="list-group">${esc(day)}</div>`; lastDay = day; }
    const li = letterIcon(h.url);
    html += `<div class="row-item"><time>${new Date(h.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><b style="display:grid;place-items:center;width:20px;height:20px;border-radius:5px;background:${li.color};color:#fff;font-size:11px;flex:none">${esc(li.letter)}</b><div class="ri-main" style="cursor:pointer" data-open="${esc(h.url)}"><b>${esc(h.title)}</b><span>${esc(displayUrl(h.url))}</span></div><button class="icon-btn sm" title="Remove" data-rm="${h.id}"><svg><use href="#i-x"/></svg></button></div>`;
  }
  box.innerHTML = html + (list.length < all.length ? `<button class="btn ghost" id="historyMore">Show ${Math.min(600, all.length - list.length).toLocaleString()} more</button>` : "");
  box.onclick = e => { const o = e.target.closest("[data-open]"); if (o) { go(o.dataset.open.startsWith("veyra://search?q=") ? decodeURIComponent(o.dataset.open.split("q=")[1]) : o.dataset.open, { newTab: e.ctrlKey || e.metaKey }); return; } if (e.target.closest("#historyMore")) { state.historyRenderLimit += 600; renderHistory(); return; } const r = e.target.closest("[data-rm]"); if (r) { state.history = state.history.filter(h => h.id !== r.dataset.rm); saveHistory(); renderHistory(); } };
}
export function clearBrowsingData({ history = true, downloads = false, cookies = false, cache = false, since = 0 } = {}) {
  const cutoff = since ? Date.now() - since : 0;
  if (history) { state.history = cutoff ? state.history.filter(h => new Date(h.time).getTime() < cutoff) : []; saveHistory(); }
  if (downloads) { state.downloads = cutoff ? state.downloads.filter(h => new Date(h.time).getTime() < cutoff) : []; saveDownloads(); }
  if (cookies && state.session) api(`/api/session/${state.session.id}/cookies`, { method: "DELETE" }).catch(() => {});
  if (cache) state.capabilityCache.clear();
  if (activeTab()?.view === "history") renderHistory();
}


function sourceTab() { const t = activeTab(); return tabById(t?.sourceTabId) || state.tabs.find(x => x.view === "page" && x.url) || null; }
async function renderResources() {
  const src = sourceTab(); const box = $("resourceList");
  if (!src) { box.innerHTML = `<div class="empty">Open a website first, then choose View source resources.</div>`; $("sourceCode").innerHTML = ""; return; }
  activeTab().title = `Resources · ${hostOf(src.url)}`; renderTabsSoon();
  
  let live = null; try { live = await dtCall(src, "sources.list", {}, 5000); } catch {}
  const rows = [{ id: "doc", type: "html", url: src.url, label: "Document (live DOM)" }];
  if (live) { live.scripts.forEach(s => rows.push({ id: `script:${s.index}`, type: "js", url: s.url, inline: s.inline, index: s.index, kind: "script", label: s.inline ? `inline script #${s.index + 1}` : "" })); live.styles.forEach(s => rows.push({ id: `style:${s.index}`, type: "css", url: s.url, inline: s.inline, index: s.index, kind: "style", label: s.inline ? `inline style #${s.index + 1}` : "" })); }
  for (const r of src.resources || []) if (!rows.some(x => x.url === r.url)) rows.push({ id: `crawl:${r.id}`, type: String(r.type || "file").slice(0, 4), url: r.url, crawlId: r.id, meta: `${r.status} · ${r.bytesLabel || ""}` });
  const q = $("resFilter").value.toLowerCase();
  src._resRows = rows;
  box.innerHTML = rows.filter(r => !q || (r.url + r.label + r.type).toLowerCase().includes(q)).map(r => `<button class="res-item ${src._resSel === r.id ? "on" : ""}" data-id="${esc(r.id)}"><span class="res-type">${esc(r.type)}</span><span class="n" title="${esc(r.url)}">${esc(r.label || pathOf(r.url) || r.url)}</span></button>`).join("") || `<div class="empty">No resources match.</div>`;
  box.onclick = e => { const b = e.target.closest("[data-id]"); if (b) selectResource(src, b.dataset.id); };
  if (!src._resSel) selectResource(src, "doc");
}
function highlightCode(text, type) {
  const lines = String(text).split("\n").slice(0, 20000);
  const hl = type === "html" ? s => esc(s).replace(/(&lt;\/?)([a-zA-Z][\w-]*)/g, '$1<span class="tk-t">$2</span>').replace(/([\w-:]+)=(&quot;.*?&quot;)/g, '<span class="tk-a">$1</span>=<span class="tk-s">$2</span>')
    : type === "css" ? s => esc(s).replace(/([\w-]+)(\s*:)(?!\/\/)/g, '<span class="tk-a">$1</span>$2').replace(/(\/\*.*?\*\/)/g, '<span class="tk-c">$1</span>')
    : type === "js" ? s => esc(s).replace(/\b(const|let|var|function|return|if|else|for|while|new|class|import|export|from|await|async|try|catch|throw|this|typeof|null|undefined|true|false)\b/g, '<span class="tk-k">$1</span>').replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="tk-s">$1</span>').replace(/(\/\/.*)$/, '<span class="tk-c">$1</span>')
    : esc;
  return lines.map(l => `<span class="ln">${hl(l) || " "}</span>`).join("");
}


export function prettyPrint(text, type) {
  text = String(text || "");
  if (type === "json") try { return JSON.stringify(JSON.parse(text), null, 2); } catch {}
  if (type === "html") return text.replace(/>\s*</g, ">\n<");
  if (type !== "js" && type !== "css") return text;
  const js = type === "js"; const o = []; let ind = 0, paren = 0, i = 0, lastSig = ""; const parenStack = [];
  const WORD = /[\w$]+/y, REST = /\s*([;,)\]]|else\b|catch\b|finally\b|while\b)/y;
  const tail = () => o.length ? o[o.length - 1] : "";
  const trimEnd = () => { while (o.length && /^\s*$/.test(tail())) o.pop(); if (o.length) o[o.length - 1] = tail().replace(/\s+$/, ""); };
  const nl = () => { trimEnd(); o.push("\n" + "  ".repeat(ind)); };
  const regexOk = () => !lastSig || /[(,=:[!&|?{};+\-*%<>~^]$/.test(lastSig) || /^(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(lastSig);
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (c === "/" && n === "*") { const e = text.indexOf("*/", i + 2); const end = e < 0 ? text.length : e + 2; o.push(text.slice(i, end)); i = end; continue; }
    if (js && c === "/" && n === "/") { const e = text.indexOf("\n", i); const end = e < 0 ? text.length : e; o.push(text.slice(i, end)); i = end; nl(); while (/\s/.test(text[i] || "")) i++; continue; }
    if (c === '"' || c === "'" || (js && c === "`")) { let j = i + 1; while (j < text.length && text[j] !== c) { if (text[j] === "\\") j++; j++; } o.push(text.slice(i, j + 1)); lastSig = c; i = j + 1; continue; }
    if (js && c === "/" && regexOk()) { let j = i + 1, cls = false; while (j < text.length && text[j] !== "\n") { const d = text[j]; if (d === "\\") { j += 2; continue; } if (d === "[") cls = true; else if (d === "]") cls = false; else if (d === "/" && !cls) break; j++; } j++; while (/[a-z]/i.test(text[j] || "")) j++; o.push(text.slice(i, j)); lastSig = "/re/"; i = j; continue; }
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { let hadNl = false; while (/\s/.test(text[i] || "")) { if (text[i] === "\n") hadNl = true; i++; } if (hadNl && paren === 0 && !/\n\s*$/.test(tail())) nl(); else if (!/\s$/.test(tail())) o.push(" "); continue; }
    if (c === "(" || c === "[") { paren++; o.push(c); lastSig = c; i++; continue; }
    if (c === ")" || c === "]") { paren = Math.max(0, paren - 1); o.push(c); lastSig = c; i++; continue; }
    if (c === "{") { trimEnd(); if (/[\w)\]"'`]$/.test(tail())) o.push(" "); o.push("{"); ind++; parenStack.push(paren); paren = 0; nl(); lastSig = c; i++; continue; }
    if (c === "}") { ind = Math.max(0, ind - 1); paren = parenStack.length ? parenStack.pop() : 0; nl(); o.push("}"); lastSig = c; i++; if (paren === 0) { REST.lastIndex = i; const rest = REST.exec(text); if (!rest) nl(); else if (/^[a-z]/.test(rest[1])) { o.push(" "); i += rest[0].length - rest[1].length; } } continue; }
    if (c === ";") { o.push(";"); lastSig = c; i++; if (paren === 0) nl(); continue; }
    WORD.lastIndex = i; const w = WORD.exec(text); if (w) { o.push(w[0]); lastSig = w[0]; i += w[0].length; continue; }
    o.push(c); lastSig = c; i++;
  }
  return o.join("").replace(/\n[ \t]*\n+/g, "\n").trim();
}
async function selectResource(src, id) {
  src._resSel = id; qsa("#resourceList .res-item").forEach(b => b.classList.toggle("on", b.dataset.id === id));
  const r = (src._resRows || []).find(x => x.id === id); if (!r) return;
  $("sourceTitle").textContent = r.label || pathOf(r.url) || r.url; $("sourceMeta").textContent = r.url + (r.meta ? ` · ${r.meta}` : "");
  $("sourceCode").innerHTML = `<span class="ln muted">Loading…</span>`;
  let text = "";
  try {
    if (r.id === "doc") text = await dtCall(src, "sources.document", {}, 8000);
    else if (r.inline) text = await dtCall(src, "sources.inline", { kind: r.kind, index: r.index }, 8000);
    else if (r.crawlId != null && src.jobId) text = (await api(`/api/crawl/${encodeURIComponent(src.jobId)}/source/${encodeURIComponent(r.crawlId)}`)).source || "";
    else if (state.session) { const res = await rawFetch(proxyUrl(r.url, "resource", state.session.id)); text = await res.text(); }
    else text = "The session has ended, so this file can no longer be fetched.";
  } catch (e) { text = `Couldn't load this resource: ${e.message}`; }
  src._resText = text; src._resType = r.type;
  $("sourceCode").innerHTML = highlightCode(text, r.type);
}
async function renderLinks() {
  const src = sourceTab(); const body = $("linkBody");
  if (!src) { body.innerHTML = `<tr><td colspan="4" class="muted">Open a website first, then choose View all links.</td></tr>`; return; }
  activeTab().title = `Links · ${hostOf(src.url)}`; renderTabsSoon();
  let live = []; try { live = await dtCall(src, "ext.links", {}, 5000) || []; } catch {}
  const map = new Map();
  for (const l of live) if (/^https?:/i.test(l.href)) map.set(l.href, { url: l.href, text: l.text, source: src.url, from: "page" });
  for (const l of src.links || []) if (!map.has(l.url)) map.set(l.url, { url: l.url, text: l.type, source: l.source, from: "crawl" });
  const q = $("linkFilter").value.toLowerCase(), scope = $("linkScope").value, host = hostOf(src.url);
  const rows = [...map.values()].filter(l => (!q || (l.url + l.text).toLowerCase().includes(q)) && (scope === "all" || (scope === "internal") === (hostOf(l.url) === host)));
  src._links = rows;
  $("linkSummary").textContent = `${rows.length.toLocaleString()} links on ${host}${src.links?.length ? ` · ${src.links.length.toLocaleString()} found by the crawler` : ""}`;
  body.innerHTML = rows.slice(0, 3000).map(l => `<tr><td><a href="${esc(l.url)}" data-open="${esc(l.url)}">${esc(displayUrl(l.url))}</a></td><td>${esc(l.text || "")}</td><td class="muted">${esc(pathOf(l.source || ""))}</td><td><button class="icon-btn sm" title="Open in new tab" data-new="${esc(l.url)}"><svg><use href="#i-external"/></svg></button></td></tr>`).join("") || `<tr><td colspan="4" class="muted">No links match.</td></tr>`;
  body.onclick = e => { const a = e.target.closest("[data-open]"); if (a) { e.preventDefault(); navigate(a.dataset.open); } const n = e.target.closest("[data-new]"); if (n) newTab({ url: n.dataset.new, background: true }); };
}


function renderConsole() {
  if (!isAdmin()) return;
  const f = $("consoleFilter").value, q = $("consoleSearch").value.toLowerCase();
  const rows = logs.filter(x => (f === "all" || x.level === f) && (!q || x.message.toLowerCase().includes(q))).slice(-1500);
  $("consoleLog").innerHTML = rows.map(x => `<div class="log-row ${esc(x.level)}"><time>${new Date(x.time).toLocaleTimeString([], { hour12: false })}</time><span class="lv">${esc(x.level)}</span><span class="msg">${esc(x.message)}</span></div>`).join("") || `<div class="empty">No log entries.</div>`;
  $("consoleLog").scrollTop = $("consoleLog").scrollHeight;
}
hooks.onLog = debounceRaf(() => { if (activeTab()?.view === "console") renderConsole(); });
function debounceRaf(fn) { let r = 0; return () => { if (r) return; r = requestAnimationFrame(() => { r = 0; fn(); }); }; }
async function renderDev() {
  if (!isAdmin()) return;
  const box = $("devPanel");
  if (!box.dataset.ready) {
    box.dataset.ready = "1";
    box.innerHTML = `<header class="page-head row"><div><h1>Veyra dev</h1><p class="muted">Server diagnostics. Admin only.</p></div><div class="head-actions"><label class="switch-row"><span>Auto refresh</span><input type="checkbox" class="switch" id="devAuto" checked></label><button class="btn ghost" id="devRefresh">Refresh</button></div></header>
      <div class="dev-grid" id="devStats"></div>
      <div class="s-section"><h2>Sessions</h2><div class="table-wrap"><table class="table"><thead><tr><th>Session</th><th>Age</th><th>Remaining</th><th>Requests</th><th>Cookies</th><th>User</th></tr></thead><tbody id="devSessions"></tbody></table></div></div>
      <div class="s-section"><h2>Crawl jobs</h2><div class="table-wrap"><table class="table"><thead><tr><th>Job</th><th>Host</th><th>Status</th><th>Processed</th><th>Links</th><th></th></tr></thead><tbody id="devJobs"></tbody></table></div></div>
      <div class="s-section"><h2>Recent server requests</h2><div class="table-wrap" style="max-height:340px"><table class="table"><thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>ms</th></tr></thead><tbody id="devReqs"></tbody></table></div></div>
      <div class="s-section"><h2>Runtime config</h2><pre class="json-view" id="devConfig"></pre></div>`;
    $("devRefresh").onclick = renderDev; $("devAuto").onchange = renderDev;
  }
  clearInterval(state.devTimer);
  if ($("devAuto").checked) state.devTimer = setInterval(() => { if (activeTab()?.view === "dev") refreshDev(); else clearInterval(state.devTimer); }, Math.max(1000, settings.devRefreshMs || 1500));
  refreshDev();
}
async function refreshDev() {
  const [sys, sess, jobs, reqs, cfg] = await Promise.allSettled([api("/api/debug/system"), api("/api/sessions"), api("/api/debug/jobs"), api("/api/debug/requests?limit=120"), api("/api/config")]);
  if (sys.status === "rejected") { $("devStats").innerHTML = `<div class="stat-card"><span>Error</span><b>${esc(sys.reason.message)}</b></div>`; return; }
  const s = sys.value, se = sess.value || {};
  const cards = [["Uptime", `${Math.round(s.uptimeSec / 60)} min`], ["Memory (RSS)", fmtBytes(s.memory?.rss)], ["Heap", `${fmtBytes(s.memory?.heapUsed)} / ${fmtBytes(s.memory?.heapTotal)}`], ["Active jobs", s.jobs?.active ?? "—"], ["Sessions", se.size ?? se.active ?? (se.sessions || []).length ?? "—"], ["Session limit", se.timeLimitMs ? fmtClock(se.timeLimitMs) : "none"], ["Chromium sessions", se.browser?.sessions ?? s.browser?.sessions ?? 0], ["VPN connections", se.vpnConnections ?? 0], ["Search pages", Number(s.searchIndexEntries || 0).toLocaleString()], ["Proxy cache", s.proxyCacheEntries ?? 0], ["Node", s.nodeVersion], ["Role", s.processRole]];
  $("devStats").innerHTML = cards.map(([a, b]) => `<div class="stat-card"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join("");
  $("devSessions").innerHTML = (se.sessions || se.list || []).slice(0, 100).map(x => `<tr><td class="mono">${esc(String(x.id || x.sessionId || "").slice(0, 12))}</td><td>${x.ageMs != null ? fmtClock(x.ageMs) : esc(x.createdAt || "")}</td><td>${x.remainingMs != null ? fmtClock(x.remainingMs) : "—"}</td><td>${esc(x.requests ?? "")}</td><td>${esc(x.cookies ?? "")}</td><td>${esc(x.userId || "guest")}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No active sessions.</td></tr>`;
  $("devJobs").innerHTML = (jobs.value?.jobs || []).map(j => `<tr><td class="mono">${esc(j.id.slice(0, 8))}</td><td>${esc(hostOf(j.url))}</td><td>${esc(j.status)}</td><td>${esc(j.counts?.processed ?? "")}</td><td>${esc(j.linkCount ?? "")}</td><td>${j.done ? "" : `<button class="btn ghost sm" data-stop="${esc(j.id)}">Stop</button>`}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No jobs.</td></tr>`;
  $("devJobs").onclick = e => { const b = e.target.closest("[data-stop]"); if (b) stopJob(b.dataset.stop).then(refreshDev); };
  $("devReqs").innerHTML = (reqs.value?.requests || []).slice(0, 120).map(r => `<tr><td>${new Date(r.time || r.startedAt || Date.now()).toLocaleTimeString([], { hour12: false })}</td><td>${esc(r.method)}</td><td class="mono" style="max-width:520px">${esc(r.path || r.url)}</td><td>${esc(r.status)}</td><td>${esc(r.ms ?? r.durationMs ?? "")}</td></tr>`).join("");
  $("devConfig").textContent = JSON.stringify(cfg.value?.config || cfg.value || {}, null, 2);
}


let platformModel = null;
async function renderPlatform() {
  const box = $("platformPanel"); if (!box) return;
  if (activeTab()?.section === "ad" && auth.user) { renderPlatformAds(box); return; }
  if (!auth.user) { renderGuestWaitlist(box); return; }
  box.innerHTML = `<div class="platform-loading"><div class="spinner"></div><span>Loading your platform…</span></div>`;
  try { platformModel = await api("/api/platform/overview", { timeoutMs: 10000 }); renderPlatformShell(box); }
  catch (e) { box.innerHTML = `<div class="empty"><svg><use href="#i-info"/></svg><b>Could not load your platform</b><span>${esc(e.message)}</span><button class="btn ghost sm" id="platformRetry">Retry</button></div>`; $("platformRetry").onclick = renderPlatform; }
}
function platformIcon(id) { return `<svg class="platform-icon"><use href="#${id}"/></svg>`; }
async function renderPlatformAds(box) {
  box.innerHTML = `<div class="ad-center-loading"><div class="spinner"></div><span>Loading ad center…</span></div>`;
  try {
    const r = await api("/api/platform/ads", { timeoutMs: 10000 }); const report = r.report || r;
    const ads = report.ads || []; const watches = Number(report.completedWatches || 0); const renewals = Number(report.totalRenewals || 0); const clicks = ads.reduce((n, a) => n + Number(a.clickCount || 0), 0);
    const billing = report.billing || { required: true, status: "not_configured" }; const billingReady = !billing.required || billing.status === "active";
    box.innerHTML = `<div class="ad-center"><header class="ad-center-head"><div><span class="eyebrow">MONETIZATION</span><h1>Ad center</h1><p>Auto-cycle clearly labeled sponsor messages. Campaigns expire automatically and require an active advertising subscription to run.</p></div><div class="ad-head-actions"><a class="btn ghost" href="#" data-go="/dev/platform">Platform overview</a><button class="btn primary" id="newAd" ${billingReady ? "" : "disabled"}>${platformIcon("i-plus")}New campaign</button></div></header>
      ${!billingReady ? `<section class="ad-billing-gate"><div><span class="eyebrow">BILLING REQUIRED</span><h2>Activate an advertising subscription</h2><p>Campaigns cannot be created or delivered until billing is active. Configure your payment provider and set <code>ADS_BILLING_STATUS=active</code> after the subscription webhook confirms payment.</p></div>${billing.subscriptionUrl ? `<a class="btn primary" href="${esc(billing.subscriptionUrl)}" target="_blank" rel="noopener">Open billing</a>` : `<span class="pill warn">Subscription not configured</span>`}</section>` : ""}
      <section class="ad-kpis"><article><span>Active campaigns</span><b>${report.activeAds || 0}</b><small>of ${report.totalAds || 0} total</small></article><article><span>Completed views</span><b>${watches.toLocaleString()}</b><small>verified watch sessions</small></article><article><span>Renewals earned</span><b>${renewals.toLocaleString()}</b><small>sessions extended</small></article><article><span>Clicks</span><b>${clicks.toLocaleString()}</b><small>tracked sponsor clicks</small></article><article><span>Avg. RPM</span><b>$${(watches ? (clicks / watches * 2.99 * 1000) : 0).toFixed(2)}</b><small>click-through estimate</small></article></section>
      <section class="ad-analytics"><div class="ad-panel"><div class="ad-panel-head"><div><span class="eyebrow">PERFORMANCE</span><h2>Renewal activity</h2></div><span class="pill ok">Live reporting</span></div><div class="ad-chart"><i style="height:28%"></i><i style="height:44%"></i><i style="height:36%"></i><i style="height:62%"></i><i style="height:55%"></i><i style="height:78%"></i><i style="height:68%"></i><i style="height:92%"></i><i style="height:76%"></i><i style="height:84%"></i><i style="height:70%"></i><i style="height:100%"></i></div><div class="ad-chart-labels"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>Now</span></div></div><div class="ad-panel ad-rotation"><div class="ad-panel-head"><div><span class="eyebrow">DELIVERY</span><h2>Rotation health</h2></div></div><div class="rotation-meter"><span style="width:${ads.length ? Math.min(100, (report.activeAds / Math.max(1, report.totalAds))*100) : 0}%"></span></div><b>${report.activeAds || 0} campaigns in rotation</b><p>Veyra automatically cycles active campaigns so one sponsor does not dominate the restore flow.</p><span class="muted small">Max ${report.maxAdsPerSession || 5} renewals per session</span></div></section>
      <section class="ad-inventory"><div class="ad-panel-head"><div><span class="eyebrow">INVENTORY</span><h2>Your campaigns</h2></div><span class="muted small">Clicks and RPM become available as traffic accumulates.</span></div><div class="ad-table">${ads.map(a => { const expired = Number(a.expiresAt || 0) <= Date.now(); return `<article class="ad-row ${expired ? "expired" : ""}"><div class="ad-type-badge ${esc(a.type)}">${platformIcon(a.type === "video" || a.type === "youtube" ? "i-play" : "i-globe")}</div><div class="ad-row-main"><b>${esc(a.title)}</b><span>${esc(a.type)} · ${a.durationSec}s · +${Math.round((a.rewardMs || 0)/60000)} min reward · expires ${a.expiresAt ? new Date(a.expiresAt).toLocaleDateString() : "—"}</span></div><div class="ad-stat"><b>${Number(a.watchCount || 0).toLocaleString()}</b><span>views</span></div><div class="ad-stat"><b>${Number(a.clickCount || 0).toLocaleString()}</b><span>clicks</span></div><span class="pill ${a.active && !expired ? "ok" : "warn"}">${expired ? "Expired" : a.active ? "Live" : "Paused"}</span><button class="icon-btn" data-ad-toggle="${esc(a.id)}" title="Toggle campaign">${platformIcon("i-refresh")}</button><button class="icon-btn" data-ad-delete="${esc(a.id)}" title="Delete campaign">${platformIcon("i-trash")}</button></article>`; }).join("") || `<div class="ad-empty">No campaigns yet. Activate billing before creating sponsor inventory.</div>`}</div></section></div>`;
    $("newAd").onclick = createPlatformAd;
    box.querySelectorAll("[data-ad-toggle]").forEach(b => b.onclick = async () => { await api(`/api/platform/ads/${encodeURIComponent(b.dataset.adToggle)}/toggle`, { method: "POST" }); renderPlatformAds(box); });
    box.querySelectorAll("[data-ad-delete]").forEach(b => b.onclick = async () => { if (!confirm("Delete this campaign?")) return; await api(`/api/platform/ads/${encodeURIComponent(b.dataset.adDelete)}`, { method: "DELETE" }); renderPlatformAds(box); });
  } catch (e) { box.innerHTML = `<div class="empty"><b>Ad center unavailable</b><span>${esc(e.message)}</span></div>`; }
}
async function createPlatformAd() {
  const title = prompt("Campaign title", "Sponsor message"); if (!title) return;
  const type = prompt("Type: banner, video, youtube, link, or interactive", "banner"); if (!type) return;
  const url = prompt("Destination or media URL", "https://"); if (!url) return;
  const expiryDays = Number(prompt("Campaign lifetime in days", "30"));
  if (!Number.isFinite(expiryDays) || expiryDays < 1) { toast("Enter a valid future campaign lifetime", { kind: "err" }); return; }
  try { await api("/api/platform/ads", { json: { title, type, url, expiryDays, durationSec: 15, rewardMs: 120000, description: "Sponsored message" } }); toast("Campaign added to rotation"); renderPlatformAds($("platformPanel")); } catch (e) { toast(e.message + (e.code === "ADS_BILLING_REQUIRED" ? " Set up an active advertising subscription first." : ""), { kind: "err", ms: 7000 }); }
}
function platformWorkspaceCard(w) {
  const live = w.keys.filter(k => !k.revokedAt).length;
  return `<article class="workspace-card">
    <div class="workspace-card-top"><div class="workspace-brand"><div class="workspace-symbol">${platformIcon("i-workspace")}</div><div><span class="workspace-kicker">WORKSPACE</span><span class="workspace-status"><i></i> Active</span></div></div><button class="icon-btn sm" data-delete-workspace="${esc(w.id)}" title="Delete workspace">${platformIcon("i-trash")}</button></div>
    <div class="workspace-card-title"><h3>${esc(w.name)}</h3><span class="workspace-slug">${esc(w.slug)}</span></div>
    <p class="workspace-description">${esc(w.description || "Production environment for your Veyra integration.")}</p>
    <div class="workspace-card-stats"><span><b>${live}</b><small>active keys</small></span><span><b>v1</b><small>API version</small></span><span><b>Live</b><small>environment</small></span></div>
    <div class="workspace-card-foot"><span class="pill">${live} credential${live === 1 ? "" : "s"}</span><button class="btn primary sm" data-create-key="${esc(w.id)}">${platformIcon("i-key")}New key</button></div>
    <div class="key-list">${w.keys.map(k => `<div class="key-row"><span>${platformIcon("i-key")}<span><b>${esc(k.name)}</b><small class="mono">${esc(k.prefix)}•••• · ${esc(k.createdAt ? new Date(k.createdAt).toLocaleDateString() : "recent")}</small></span></span><span class="key-actions"><button class="icon-btn sm" data-rename-key="${esc(w.id)}|${esc(k.id)}|${esc(k.name)}" title="Rename key">${platformIcon("i-edit")}</button><button class="icon-btn sm" data-rotate-key="${esc(w.id)}|${esc(k.id)}" title="Rotate key">${platformIcon("i-refresh")}</button><button class="icon-btn sm" data-revoke-key="${esc(w.id)}|${esc(k.id)}" title="Revoke key">${platformIcon("i-x")}</button></span></div>`).join("") || `<div class="key-empty">No active API keys yet.</div>`}</div>
  </article>`;
}
function platformWaitlistPanel(waitlist) {
  const entries = waitlist?.entries || [];
  return `<section class="platform-waitlist"><div class="platform-section-head"><div><span class="eyebrow">OWNER CONTROL</span><h2>Platform queue</h2></div><span class="pill ${waitlist?.pending ? "warn" : "ok"}">${waitlist?.pending || 0} pending</span></div><p class="muted">Accept users in waves. Accepted users receive the platform link by email when email delivery is configured.</p><div class="waitlist-table">${entries.map(x => `<div class="waitlist-row"><span><b>${esc(x.name || x.email)}</b><small>${esc(x.email)} · ${esc(x.plan === "early_access" ? "$2.99 early access" : "free beta")}</small></span><span class="pill ${x.status === "accepted" ? "ok" : "warn"}">${esc(x.status)}${x.emailStatus ? ` · ${esc(x.emailStatus)}` : ""}</span>${x.status === "pending" ? `<button class="btn primary sm" data-accept-waitlist="${esc(x.id)}">Accept</button>` : ""}</div>`).join("") || `<div class="platform-empty">No waitlist entries yet.</div>`}</div></section>`;
}
function renderGuestWaitlist(box) {
  box.innerHTML = `<div class="waitlist-product"><div class="waitlist-product-top"><a class="waitlist-brand" href="#">${platformIcon("i-platform")}<span>veyra</span></a><span class="waitlist-product-tag">DEVELOPER PLATFORM</span></div><div class="waitlist-product-grid"><section class="waitlist-product-copy"><span class="product-overline">PRIVATE BETA · LIMITED ACCESS</span><h1>Build with Veyra.</h1><p>One focused home for workspaces, API keys, and the tools you need to ship against the Veyra API.</p><div class="waitlist-benefits"><div>${platformIcon("i-workspace")}<span><b>Organized workspaces</b><small>Keep every environment separate.</small></span></div><div>${platformIcon("i-key")}<span><b>Safe API credentials</b><small>Issue, copy, rotate, and revoke keys.</small></span></div><div>${platformIcon("i-bolt")}<span><b>Fast path to production</b><small>Clear docs without the noise.</small></span></div></div></section><section class="waitlist-product-card"><div class="waitlist-card-head"><span class="platform-mark mini">${platformIcon("i-platform")}</span><div><b>Request access</b><small>We’re opening the platform in waves.</small></div></div><form class="waitlist-form" id="waitlistForm"><label class="waitlist-field"><span>Name</span><input class="input" name="name" placeholder="Your name" autocomplete="name"></label><label class="waitlist-field"><span>Email address</span><input class="input" name="email" type="email" placeholder="you@example.com" autocomplete="email" required></label><div class="waitlist-choice-label">Choose your path</div><div class="waitlist-choice"><button type="button" class="waitlist-plan on" data-plan="developer"><span class="plan-select"><i></i><b>Free beta</b></span><small>Join the normal queue</small></button><button type="button" class="waitlist-plan" data-plan="early_access"><span class="plan-select"><i></i><b>$2.99/month</b></span><small>Priority early access</small></button></div><button class="btn primary lg waitlist-submit" type="submit">Join the waitlist ${platformIcon("i-arrow-right")}</button><p class="waitlist-privacy">We’ll email you when accepted. Early access is not charged here.</p><div class="waitlist-result" id="waitlistResult" role="status"></div></form><div class="waitlist-card-foot"><span>Already have access?</span><button class="text-button" data-auth="login">Sign in ${platformIcon("i-arrow-right")}</button></div></section></div></div>`;
  let plan = "developer";
  box.querySelectorAll("[data-plan]").forEach(b => b.onclick = () => { plan = b.dataset.plan; box.querySelectorAll(".waitlist-plan").forEach(x => x.classList.toggle("on", x === b)); });
  const form = $("waitlistForm");
  form.onsubmit = async e => { e.preventDefault(); const currentForm = e.target.closest("#waitlistForm") || form; if (!currentForm) return; const f = new FormData(currentForm), out = currentForm.querySelector("#waitlistResult"), btn = currentForm.querySelector("button[type=submit]"); btn.disabled = true; btn.classList.add("loading"); out.innerHTML = `<span class="waitlist-progress">Adding you to the queue…</span>`; try { const r = await api("/api/platform/waitlist", { json: { name: f.get("name"), email: f.get("email"), plan } }); out.innerHTML = `<span class="pill ok">${esc(r.message || "You’re on the list.")} ${r.entry?.position ? `Position ${r.entry.position}.` : ""}</span>`; if (typeof currentForm.reset === "function") currentForm.reset(); currentForm.querySelector('[data-plan="developer"]')?.click(); } catch (err) { out.innerHTML = `<span class="pill err">${esc(err.message)}</span>`; } finally { btn.disabled = false; btn.classList.remove("loading"); } };
}
function setupPlatformTabs(box) {
  const groups = {
    overview: [".platform-welcome", ".platform-metrics", ".platform-hero-new", ".platform-insights"],
    workspaces: ["#platform-workspaces", "#workspaceGrid"],
    keys: ["#platform-workspaces", "#workspaceGrid"],
    docs: ["#platform-docs"],
    pricing: ["#platform-pricing"],
    queue: ["#platform-queue"]
  };
  const activate = tab => {
    const allowed = new Set(groups[tab] || groups.overview);
    box.querySelectorAll(".platform-content > *").forEach(node => {
      node.classList.toggle("platform-tab-hidden", ![...allowed].some(selector => node.matches(selector)));
    });
    box.querySelector("#workspaceGrid")?.classList.toggle("platform-keys-mode", tab === "keys");
    box.querySelectorAll("[data-platform-tab]").forEach(button => {
      const on = button.dataset.platformTab === tab;
      button.classList.toggle("active", on);
      button.setAttribute("aria-selected", on ? "true" : "false");
    });
    const label = { overview: "Overview", workspaces: "Workspaces", keys: "API keys", docs: "Documentation", pricing: "Plans & billing", queue: "Waitlist" }[tab] || "Overview";
    const crumb = box.querySelector(".platform-breadcrumb strong");
    if (crumb) crumb.textContent = label;
  };
  box.querySelectorAll("[data-platform-tab]").forEach(button => button.addEventListener("click", () => activate(button.dataset.platformTab)));
  activate("overview");
  box._activatePlatformTab = activate;
}
function renderPlatformShell(box) {
  const m = platformModel, owner = !!m.owner, ready = owner || m.billing?.status === "configured";
  const totalKeys = m.workspaces.reduce((n, w) => n + w.keys.length, 0), pending = m.waitlist?.pending || 0;
  const firstName = auth.user?.name?.split(" ")[0] || "there";
  box.innerHTML = `<div class="platform-app-shell">
    <aside class="platform-sidebar"><div class="platform-side-brand"><span class="platform-side-mark">${platformIcon("i-platform")}</span><span><b>Veyra</b><small>Developer Platform</small></span></div>
      <nav class="platform-nav"><span class="platform-nav-label">Workspace</span><button type="button" class="platform-nav-item platform-tab-button active" data-platform-tab="overview">${platformIcon("i-home")}Overview</button><button type="button" class="platform-nav-item platform-tab-button" data-platform-tab="workspaces">${platformIcon("i-workspace")}Workspaces<span class="nav-count">${m.workspaces.length}</span></button><button type="button" class="platform-nav-item platform-tab-button" data-platform-tab="keys">${platformIcon("i-key")}API keys<span class="nav-count">${totalKeys}</span></button><span class="platform-nav-label">Resources</span><button type="button" class="platform-nav-item platform-tab-button" data-platform-tab="docs">${platformIcon("i-book")}Documentation</button><button type="button" class="platform-nav-item platform-tab-button" data-platform-tab="pricing">${platformIcon("i-wallet")}Plans & billing</button>${owner ? `<span class="platform-nav-label">Owner</span><a class="platform-nav-item" href="#" data-go="/dev/platform/ad">${platformIcon("i-play")}Ad center</a><button type="button" class="platform-nav-item platform-tab-button" data-platform-tab="queue">${platformIcon("i-shield")}Waitlist<span class="nav-count accent">${pending}</span></button>` : ""}</nav>
      <div class="platform-side-footer"><div class="platform-help">${platformIcon("i-info")}<span><b>Need a hand?</b><small>Read the API docs</small></span></div><div class="platform-user"><span class="platform-user-avatar">${esc((firstName[0] || "U").toUpperCase())}</span><span><b>${esc(firstName)}</b><small>${owner ? "Owner account" : "Developer plan"}</small></span><span class="platform-user-dot"></span></div></div>
    </aside>
    <main class="platform-main-shell" id="platform-overview"><header class="platform-topbar"><div class="platform-breadcrumb"><span>Veyra</span><b>/</b><strong>Overview</strong></div><div class="platform-top-actions"><span class="platform-live"><i></i> All systems operational</span><button class="icon-btn" id="platformRefresh" title="Refresh">${platformIcon("i-refresh")}</button><button class="platform-top-avatar">${esc((firstName[0] || "U").toUpperCase())}</button></div></header>
      <div class="platform-content"><section class="platform-welcome"><div><span class="eyebrow">${owner ? "OWNER CONSOLE" : "DEVELOPER CONSOLE"}</span><h1>Good to see you, ${esc(firstName)}.</h1><p>Everything you need to build, ship, and scale with the Veyra API.</p></div><div class="platform-welcome-actions"><span class="platform-plan-badge ${ready ? "ready" : "attention"}">${owner ? "Owner · free" : ready ? "Developer plan" : "Setup required"}</span><button class="btn primary" id="newWorkspace">${platformIcon("i-plus")}New workspace</button></div></section>
        <section class="platform-metrics"><article class="platform-metric"><div class="metric-icon blue">${platformIcon("i-workspace")}</div><div><span>Workspaces</span><b>${m.workspaces.length}</b><small>${m.workspaces.length ? "Ready to build" : "Create your first one"}</small></div></article><article class="platform-metric"><div class="metric-icon violet">${platformIcon("i-key")}</div><div><span>Active API keys</span><b>${totalKeys}</b><small>${totalKeys ? "Credentials protected" : "No keys issued"}</small></div></article><article class="platform-metric"><div class="metric-icon green">${platformIcon("i-check")}</div><div><span>API status</span><b class="metric-status">Operational</b><small>All systems normal</small></div></article><article class="platform-metric"><div class="metric-icon amber">${platformIcon("i-wallet")}</div><div><span>Current plan</span><b>${owner ? "Owner" : "Beta"}</b><small>${owner ? "Complimentary access" : ready ? "Billing configured" : "Billing needed"}</small></div></article></section>
        <section class="platform-hero platform-hero-new"><div class="hero-grid-glow"></div><div class="platform-hero-copy"><span class="eyebrow">BUILD WITH CONFIDENCE</span><h2>One API. Every possibility.</h2><p>Organize your environments, protect your credentials, and give your team a clear path from first request to production.</p><div class="platform-hero-actions"><button class="btn primary" id="showDocs">${platformIcon("i-book")}Explore documentation</button><a class="hero-text-link" href="#platform-pricing">Compare plans ${platformIcon("i-arrow-right")}</a></div></div><div class="hero-terminal"><div class="terminal-bar"><span></span><span></span><span></span><b>quickstart.js</b></div><pre><code><em>const</em> veyra = <strong>new</strong> Veyra({
  apiKey: <mark>"vyr_live_••••"</mark>
});

<em>await</em> veyra.projects.<strong>list</strong>();</code></pre><div class="terminal-status">${platformIcon("i-check")} Response 200 <span>24ms</span></div></div></section>
        <div class="platform-section-heading" id="platform-workspaces"><div><span class="eyebrow">PROJECTS & ENVIRONMENTS</span><h2>Your workspaces</h2><p>Keep credentials and deployments safely separated.</p></div><button class="btn ghost" id="emptyWorkspace">${platformIcon("i-plus")}Add workspace</button></div><section class="workspace-grid workspace-grid-new" id="workspaceGrid">${m.workspaces.map(platformWorkspaceCard).join("") || `<div class="platform-empty">${platformIcon("i-workspace")}<b>No workspaces yet</b><span>Create your first environment to issue an API key.</span><button class="btn primary sm" id="emptyWorkspaceInner">Create workspace</button></div>`}</section>
        <section class="platform-insights"><article class="insight-card billing-insight ${ready ? "" : "needs-attention"}">${platformIcon("i-wallet")}<div><span class="eyebrow">BILLING & ACCESS</span><h3>${owner ? "You have complimentary access" : ready ? "Your billing profile is ready" : "Finish your billing setup"}</h3><p>${owner ? "As the owner, you have unlimited workspaces and API keys at no cost." : ready ? `Billing contact: ${esc(m.billing.billingEmail || auth.user.email)}` : "A billing profile is required before production API keys can be created."}</p></div>${!owner && !ready ? `<button class="btn primary sm" id="setupBilling">Set up billing</button>` : `<span class="insight-check">${platformIcon("i-check")}</span>`}</article><article class="insight-card quick-doc"><div class="insight-doc-icon">${platformIcon("i-book")}</div><div><span class="eyebrow">QUICK START</span><h3>Make your first request</h3><p>Use a workspace key with the Authorization header.</p></div><button class="icon-btn" id="copyDoc">${platformIcon("i-copy")}</button></article></section>
        <section class="platform-docs platform-section-block" id="platform-docs"><div class="platform-section-heading"><div><span class="eyebrow">DEVELOPER RESOURCES</span><h2>Ship in minutes</h2><p>A focused path from authentication to production.</p></div><span class="pill accent">API v1</span></div><div class="docs-grid docs-grid-new"><article><span class="doc-number">01</span><div class="doc-card-icon">${platformIcon("i-key")}</div><h3>Authenticate</h3><p>Send your workspace key as a Bearer token and keep it out of source control.</p><button class="hero-text-link" id="showDocs2">Read the guide ${platformIcon("i-arrow-right")}</button></article><article><span class="doc-number">02</span><div class="doc-card-icon">${platformIcon("i-workspace")}</div><h3>Separate environments</h3><p>Use dedicated workspaces for development, staging, and production.</p><a class="hero-text-link" href="#platform-workspaces">View workspaces ${platformIcon("i-arrow-right")}</a></article><article><span class="doc-number">03</span><div class="doc-card-icon">${platformIcon("i-shield")}</div><h3>Protect credentials</h3><p>Keys are shown once, hashed at rest, and revocable whenever you need.</p><span class="pill ok">Hashed at rest</span></article></div></section>
        <section class="platform-pricing platform-section-block" id="platform-pricing"><div class="platform-section-heading"><div><span class="eyebrow">PLANS THAT SCALE</span><h2>Start small. Go further.</h2><p>Simple, transparent access for every stage.</p></div><span class="muted small">USD · transparent limits</span></div><div class="pricing-grid pricing-grid-new">${(m.pricing || []).map(p => `<article class="price-card ${p.id === "developer" ? "featured" : ""}"><div class="price-card-top"><span class="pill ${p.id === "owner" ? "ok" : p.id === "early_access" ? "accent" : ""}">${esc(p.name)}</span>${p.id === "developer" ? `<span class="price-popular">Most popular</span>` : ""}</div><div class="price"><b>$${p.price}</b><span>${esc(p.unit)}</span></div><p>${esc(p.description)}</p><ul>${p.features.map(f => `<li>${platformIcon("i-check")}<span>${esc(f)}</span></li>`).join("")}</ul><button class="btn ${p.id === "developer" ? "primary" : "ghost"} block" data-platform-plan="${esc(p.id)}" ${p.id === "owner" ? "disabled" : ""}>${p.id === "owner" ? "Current plan" : p.id === "early_access" ? "Join early access" : "Choose plan"}</button></article>`).join("")}</div></section>${owner ? `<div id="platform-queue">${platformWaitlistPanel(m.waitlist)}</div>` : ""}
      </div></main></div>`;
  setupPlatformTabs(box); $("platformRefresh").onclick = renderPlatform; $("newWorkspace").onclick = platformPromptWorkspace; $("emptyWorkspace")?.addEventListener("click", platformPromptWorkspace); $("emptyWorkspaceInner")?.addEventListener("click", platformPromptWorkspace); box.querySelectorAll("[data-accept-waitlist]").forEach(b => b.onclick = () => platformAcceptWaitlist(b.dataset.acceptWaitlist)); $("showDocs").onclick = () => box._activatePlatformTab?.("docs"); $("showDocs2")?.addEventListener("click", () => box._activatePlatformTab?.("docs")); $("setupBilling")?.addEventListener("click", platformSetupBilling); $("copyDoc")?.addEventListener("click", () => copyText('curl https://api.veyra.dev/v1/health -H "Authorization: Bearer vyr_live_…"').then(() => toast("Example copied")));
  box.querySelectorAll("[data-platform-plan]").forEach(b => b.onclick = () => { if (b.dataset.platformPlan === "early_access") { document.querySelector("#platform-queue")?.scrollIntoView({ behavior: "smooth" }); toast("Early access is $2.99/month. Join the waitlist to receive checkout access."); } else { document.querySelector("#platform-workspaces")?.scrollIntoView({ behavior: "smooth" }); toast("Create a workspace to start with the Developer plan."); } });
  box.onclick = e => { const r = e.target.closest("[data-revoke-key]"), d = e.target.closest("[data-delete-workspace]"), k = e.target.closest("[data-create-key]"), n = e.target.closest("[data-rename-key]"), t = e.target.closest("[data-rotate-key]"); if (r) platformRevokeKey(...r.dataset.revokeKey.split("|")); else if (d) platformDeleteWorkspace(d.dataset.deleteWorkspace); else if (k) platformCreateKey(k.dataset.createKey); else if (n) platformRenameKey(...n.dataset.renameKey.split("|")); else if (t) platformRotateKey(...t.dataset.rotateKey.split("|")); };
}
async function platformAcceptWaitlist(id) { try { await api(`/api/platform/waitlist/${encodeURIComponent(id)}/accept`, { method: "POST" }); toast("Accepted and email queued"); renderPlatform(); } catch (e) { toast(e.message, { kind: "err" }); } }
async function platformPromptWorkspace() { const name = prompt("Workspace name", "My project"); if (!name?.trim()) return; try { await api("/api/platform/workspaces", { json: { name: name.trim() } }); toast("Workspace created"); renderPlatform(); } catch (e) { toast(e.message, { kind: "err" }); } }
async function platformSetupBilling() { const email = prompt("Billing email", auth.user.email); if (!email) return; const company = prompt("Company or project name (optional)", ""); try { await api("/api/platform/billing/setup", { json: { billingEmail: email, company } }); toast("Billing profile saved"); renderPlatform(); } catch (e) { toast(e.message, { kind: "err" }); } }
async function platformCreateKey(id) { const name = prompt("Key name", "Production"); if (!name) return; try { const r = await api(`/api/platform/workspaces/${encodeURIComponent(id)}/keys`, { json: { name } }); await copyText(r.key); alert(`${r.warning}\n\n${r.key}`); renderPlatform(); } catch (e) { toast(e.message, { kind: "err" }); } }
async function platformRevokeKey(workspaceId, keyId) { if (!confirm("Revoke this API key? This cannot be undone.")) return; try { await api(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/keys/${encodeURIComponent(keyId)}`, { method: "DELETE" }); toast("API key revoked"); renderPlatform(); } catch (e) { toast(e.message, { kind: "err" }); } }
async function platformRenameKey(workspaceId, keyId, currentName) { const name = prompt("Key name", currentName); if (!name?.trim() || name.trim() === currentName) return; try { await api(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/keys/${encodeURIComponent(keyId)}`, { method: "PATCH", json: { name: name.trim() } }); toast("API key renamed"); renderPlatform(); } catch (e) { toast(e.message, { kind: "err" }); } }
async function platformRotateKey(workspaceId, keyId) { if (!confirm("Rotate this API key? The current key will stop working immediately.")) return; try { const r = await api(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/keys/${encodeURIComponent(keyId)}/rotate`, { method: "POST", json: {} }); await copyText(r.key); alert(`${r.warning}\n\n${r.key}`); renderPlatform(); } catch (e) { toast(e.message, { kind: "err" }); } }
async function platformDeleteWorkspace(id) { if (!confirm("Delete this workspace and revoke all its keys?")) return; try { await api(`/api/platform/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" }); toast("Workspace deleted"); renderPlatform(); } catch (e) { toast(e.message, { kind: "err" }); } }


export async function refreshVpnStatus() {
  try {
    const st = await api("/api/vpn/status", { timeoutMs: 8000 }); state.vpn.status = st;
    if (state.session) { const si = await api(`/api/vpn/session?sid=${encodeURIComponent(state.session.id)}`, { timeoutMs: 8000 }); state.vpn.connected = !!si.connected; state.vpn.profile = si.profile || null; state.vpn.info = si; }
    else { state.vpn.connected = false; state.vpn.profile = null; }
    state.vpn.error = null;
  } catch (e) { state.vpn.error = e.message; state.vpn.status = null; state.vpn.connected = false; state.vpn.profile = null; }
  $("vpnBtn").classList.toggle("on", state.vpn.connected); updateIdentity();
  return state.vpn;
}
export async function connectVpn(profileId, { quiet = false } = {}) {
  const s = await ensureSession();
  const r = await api("/api/vpn/connect", { json: { sessionId: s.id, profileId } });
  state.vpn.connected = true; state.vpn.profile = r.profile || null;
  if (!quiet) toast(`VPN connected · ${r.profile?.name || profileId}`);
  reloadPagesAfterVpn(); $("vpnBtn").classList.toggle("on", true); updateIdentity();
}
export async function disconnectVpn() {
  if (!state.session) return;
  await api("/api/vpn/disconnect", { json: { sessionId: state.session.id } });
  state.vpn.connected = false; state.vpn.profile = null; toast("VPN disconnected"); reloadPagesAfterVpn(); $("vpnBtn").classList.toggle("on", false); updateIdentity();
}
function reloadPagesAfterVpn() { for (const t of state.tabs) if (t.view === "page" && t.url) { if (isRemote(t)) { stopBrowserSession(t).then(() => loadInTab(t, t.url)); } else if (activeTab() === t) loadInTab(t, t.url); else t.needsReload = true; } }
async function renderVpnPanel() {
  const box = $("vpnPanel"); box.innerHTML = `<div class="empty"><div class="spinner"></div></div>`;
  const v = await refreshVpnStatus(); const st = v.status;
  if (!st) { box.innerHTML = `<div class="empty"><svg><use href="#i-vpn"/></svg><b>Veyra VPN is unavailable</b><span>${esc(v.error || "")}</span></div>`; return; }
  const profiles = st.profiles || [];
  const cur = v.profile;
  box.innerHTML = `<div class="vpn-hero"><div class="vpn-orb ${v.connected ? "on" : ""}"><svg><use href="#i-vpn"/></svg></div><div><h2>${v.connected ? "Protected" : "Not connected"}</h2><p class="muted">${v.connected ? `Traffic in this session leaves through <b>${esc(cur?.name || "")}</b>${cur?.region ? ` · ${esc(cur.region)}` : ""}${cur?.health?.exitIp ? ` · exit ${esc(cur.health.exitIp)}` : ""}.` : !st.enabled ? "The VPN is turned off on this server." : !profiles.length ? "No VPN exits are configured on the server yet." : "Choose an exit below. Every tab in this session will use it."}</p></div><span class="spacer"></span>${v.connected ? `<button class="btn ghost" id="vpnRotate">Rotate exit</button><button class="btn danger" id="vpnOff">Disconnect</button>` : ""}</div>
    <div class="s-section"><h2>Exits</h2><p class="muted">${st.killSwitch ? "Kill switch is on: if a tunnel drops, requests are blocked instead of leaking through the server's own IP." : "Kill switch is off on this server."}${st.failover ? " Failover moves you to a healthy exit automatically." : ""}</p>
    <div class="vpn-list">${profiles.map(p => `<div class="vpn-row ${cur?.id === p.id ? "on" : ""}"><span class="pill ${p.health?.healthy === false ? "err" : p.health?.healthy ? "ok" : ""}">${esc(p.protocol || p.type)}</span><div class="n"><b>${esc(p.name)}</b><small>${esc([p.region, p.country, p.provider].filter(Boolean).join(" · ") || "Server exit")}${p.health?.latencyMs ? ` · ${p.health.latencyMs} ms` : ""}${p.health?.healthy === false ? ` · ${esc(p.health.lastError || "health check failed")}` : ""}</small></div>${cur?.id === p.id ? `<span class="pill ok">Connected</span>` : `<button class="btn ghost sm" data-connect="${esc(p.id)}" ${st.enabled && p.health?.healthy !== false ? "" : "disabled"}>${p.health?.healthy === false ? "Unavailable" : "Connect"}</button>`}<button class="btn ghost sm" data-test="${esc(p.id)}">Test</button></div>`).join("") || `<div class="empty"><span>Set VPN_PROFILES_JSON, WIREGUARD_CONFIG or VPN_PROXY_SERVER on Render to add exits.</span></div>`}</div></div>
    <div class="s-section"><h2>Automatic connection</h2><div class="s-card"><div class="s-row"><div class="s-label"><b>Connect new sessions automatically</b><span>Uses the chosen exit as soon as a session starts.</span></div><div class="s-ctl"><select class="input" id="vpnAuto"><option value="">Off</option>${profiles.map(p => `<option value="${esc(p.id)}" ${settings.vpnAutoProfile === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div></div><div class="s-row"><div class="s-label"><b>Automatic exit rotation</b><span>When enabled on the server, Veyra can periodically move the session to another configured exit. A new public IP depends on the VPN provider.</span></div><div class="s-ctl"><span class="pill ${st.rotation?.enabled ? "ok" : ""}">${st.rotation?.enabled ? `Every ${fmtClock(st.rotation.intervalMs)}` : "Server controlled"}</span></div></div></div></div>`;
  box.onclick = async e => { const b = e.target.closest("button"); if (!b) return; b.disabled = true;
    try {
      if (b.dataset.connect) await connectVpn(b.dataset.connect);
      else if (b.dataset.test) { const r = await api("/api/vpn/test", { json: { profileId: b.dataset.test }, timeoutMs: 20000 }); toast(`Exit responded${r.exitIp ? ` · IP ${r.exitIp}` : ""}${r.latencyMs ? ` · ${r.latencyMs} ms` : ""}`); }
      else if (b.id === "vpnOff") await disconnectVpn();
      else if (b.id === "vpnRotate") { const r = await api("/api/vpn/rotate", { json: { sessionId: state.session.id } }); toast(`Now using ${r.profile?.name || "a new exit"}`); reloadPagesAfterVpn(); }
    } catch (err) { toast(err.message, { kind: "err" }); }
    renderVpnPanel(); };
  $("vpnAuto").onchange = e => { settings.vpnAutoProfile = e.target.value; saveSettings(); toast(e.target.value ? "New sessions will connect automatically" : "Automatic VPN off"); };
}
export { renderVpnPanel };


function tabForSource(src) {
  for (const t of state.tabs) { const f = frameFor(t); if (!f) continue; let w = src; for (let i = 0; i < 6 && w; i++) { if (w === f.contentWindow) return t; try { if (w === w.parent) break; w = w.parent; } catch { break; } } }
  return null;
}
function isConsoleLabPageUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "https:" && u.hostname === "homekidchud.github.io" && u.pathname.replace(/\/+$/, "") === "/VeyraBrowser/web/console-lab";
  } catch { return false; }
}
function consoleText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if (typeof value.message === "string") return value.message.trim();
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value).trim();
}
function firstConsoleText(...values) {
  for (const value of values) { const text = consoleText(value); if (text) return text; }
  return "";
}
function consoleNumber(...values) {
  for (const value of values) { const number = Number(value); if (Number.isFinite(number) && number >= 0) return number; }
  return 0;
}
function pageConsoleEntry(d, t) {
  const err = d.error && typeof d.error === "object" ? d.error : d.reason && typeof d.reason === "object" ? d.reason : {};
  const resource = d.resource && typeof d.resource === "object" ? d.resource : d.element && typeof d.element === "object" ? d.element : {};
  const isException = d.type === "veyra:page-error";
  const message = firstConsoleText(d.message, err.message, d.error, d.reason, d.description) || "No error message was supplied.";
  const nameMatch = message.match(/^([A-Za-z_$][\w$]*(?:Error|Exception))\s*:/);
  const errorName = firstConsoleText(d.errorName, d.name, err.name, nameMatch?.[1]);
  const description = firstConsoleText(d.errorDescription, err.description, d.detail, d.description);
  const context = firstConsoleText(d.context, d.meta, d.cause, err.cause, resource.context);
  const resourceUrl = firstConsoleText(d.resourceUrl, d.failedResourceUrl, resource.url, resource.currentSrc, resource.src, resource.href, d.url, d.filename, d.sourceURL, err.url);
  const resourceTag = firstConsoleText(d.resourceTag, d.elementTag, resource.tag, resource.tagName, resource.nodeName).toLowerCase();
  const rawMessage = message.replace(/^Uncaught\s+/i, "").trim();
  const hasSource = !!firstConsoleText(d.url, d.filename, d.sourceURL, err.url, resourceUrl);
  const hasStack = !!firstConsoleText(d.stack, err.stack);
  const hasLine = !!consoleNumber(d.line, d.lineNumber, d.lineno, err.line, err.lineNumber);
  const crossOriginScript = isException && /^Script error\.?$/i.test(rawMessage) && !hasSource && !hasStack && !hasLine;
  const resourceFailure = isException && (!!resourceTag || !!resourceUrl || /^Resource error\.?$/i.test(rawMessage));
  const diagnosis = firstConsoleText(d.diagnosis, crossOriginScript ? "cross-origin-script" : resourceFailure ? "resource-load" : "");
  const browserNote = firstConsoleText(d.browserNote, crossOriginScript ? "The browser only reported a generic ‘Script error.’ with no source location or stack. This commonly happens when a cross-origin script does not opt in to sharing detailed errors; the original exception may not be available to Veyra." : resourceFailure ? "The load event identifies a failed resource, but browsers do not include its HTTP status or network failure reason in that event. Check Network for the request and response." : "");
  const statusText = firstConsoleText(d.resourceStatus, resource.status, d.status);
  const resourceStatus = statusText && Number.isFinite(Number(statusText)) ? Number(statusText) : null;
  const reportedTime = new Date(d.time || Date.now()).getTime();
  return {
    id: uid(),
    time: Number.isFinite(reportedTime) ? reportedTime : Date.now(),
    level: String(d.level || (isException ? "error" : "log")).toLowerCase() === "warning" ? "warn" : String(d.level || (isException ? "error" : "log")).toLowerCase(),
    message,
    errorName,
    description: description && description !== message ? description : "",
    context,
    stack: firstConsoleText(d.stack, err.stack),
    url: firstConsoleText(d.url, d.filename, d.sourceURL, resourceUrl, err.url),
    resourceUrl,
    resourceTag,
    resourceType: firstConsoleText(d.resourceType, resource.type, resource.as),
    resourceStatus,
    resourceSelector: firstConsoleText(d.resourceSelector, resource.selector),
    diagnosis,
    browserNote,
    line: consoleNumber(d.line, d.lineNumber, d.lineno, err.line, err.lineNumber),
    column: consoleNumber(d.column, d.columnNumber, d.colno, err.column, err.columnNumber),
    pageUrl: firstConsoleText(d.pageUrl, t.url),
    kind: isException ? "exception" : "console"
  };
}
async function handleMessage(e) {
  const d = e.data; if (!d || typeof d !== "object" || typeof d.type !== "string" || !d.type.startsWith("veyra:")) return;
  if (d.type === "veyra:local-retry") { const t = tabForSource(e.source); if (t) { switchTab(t.id); reload(); } return; }
  
  
  
  if (e.origin !== API_ORIGIN && e.origin !== "null") return;
  const t = tabForSource(e.source); if (!t) return;
  if (d.type === "veyra:console-lab:auth-check") {
    if (t.view !== "page" || !isConsoleLabPageUrl(t.url) || typeof d.requestId !== "string") return;
    const requestId = d.requestId.slice(0, 100);
    let allowed = false;
    let reason = "Sign in to Veyra with an administrator account to use the Console Lab.";
    try {
      const config = await api("/api/auth/config", { timeoutMs: 8000 });
      allowed = config?.admin === true;
      if (allowed) reason = "";
    } catch {
      reason = "Could not verify administrator access with VeyraServer. Check your connection and retry.";
    }
    if (!state.tabs.includes(t) || tabForSource(e.source) !== t || !isConsoleLabPageUrl(t.url)) return;
    try { e.source.postMessage({ type: "veyra:console-lab:auth-result", requestId, allowed, reason }, e.origin === "null" ? "*" : e.origin); } catch {}
    return;
  }
  if (d.type === "veyra:dt-result" || d.type === "veyra:dt-event") { handleBridgeMessage(t, d); return; }
  if (d.type === "veyra:session-expired") { if (state.session && (!d.sessionId || d.sessionId === state.session.id)) endSession("server"); return; }
  if (d.type === "veyra:shortcut") { hooks.handleForwardedShortcut?.(d); return; }
  if (d.type === "veyra:browser-required") {
    const u = canonical(d.pageUrl || t.url);
    if (u && t.view === "page" && !isRemote(t)) {
      
      
      if (!browserFallbackAllowed()) {
        addLog("debug", `${hostOf(u)} wanted a browser feature (${d.reason || "site feature"}); staying on the forced fast proxy.`);
        return;
      }
      t.compatFallbackTried ||= new Set();
      const key = `${u}|${String(d.reason || "browser-required")}`;
      if (!t.compatFallbackTried.has(key)) {
        
        
        
        if (d.reason === "empty-spa-shell") {
          const first = proxyDocLooksBlank(t);
          if (first.nodes >= 0) {
            setTimeout(() => {
              if (!state.tabs.includes(t) || t.view !== "page" || t.browserMode === "BROWSER_ENGINE") return;
              if (t.compatFallbackTried?.has(key)) return;
              const second = proxyDocLooksBlank(t);
              if (!second.blank) return;
              if (second.nodes > first.nodes) {
                addLog("debug", `Proxy shell on ${hostOf(u)} is still hydrating (${first.nodes} → ${second.nodes} nodes); keeping the fast proxy.`);
                return;
              }
              escalateBrowserRequired(t, u, key, d.reason);
            }, 9000);
            return;
          }
        }
        escalateBrowserRequired(t, u, key, d.reason);
      }
    }
    return;
  }
  if (d.type === "veyra:page-console" || d.type === "veyra:page-error") {
    const entry = pageConsoleEntry(d, t);
    const pageErrorText = `${entry.message} ${entry.stack}`;
    const hydrationFailure = /minified react error #418|hydration failed|hydration mismatch/i.test(pageErrorText);
    if (hydrationFailure && t.view === "page" && !isRemote(t) && t.url && !isYouTubeUrl(t.url) && browserFallbackAllowed()) {
      t.compatFallbackTried ||= new Set();
      const key = `${t.url}|react-hydration`;
      if (!t.compatFallbackTried.has(key)) {
        t.compatFallbackTried.add(key);
        addLog("info", `React hydration mismatch detected on ${hostOf(t.url)}; switching to Chromium.`);
        toast("This site needs full browser rendering. Switching to Chromium…", { ms: 3000 });
        void loadInTab(t, t.url, { forceBrowser: true, loadFrame: true, record: null });
      }
    }
    t.console.push(entry); if (t.console.length > 2000) t.console.splice(0, t.console.length - 2000);
    hooks.dt?.onConsole(t, entry);
    if (entry.level === "error") addLog("warn", `[page:${hostOf(d.pageUrl || t.url)}] ${entry.message.slice(0, 400)}`);
    return;
  }
  if (d.type === "veyra:browser-network") { t.network.push(d); if (t.network.length > 1500) t.network.splice(0, t.network.length - 1500); hooks.dt?.onNetwork(t, d); return; }
  if (d.type === "veyra:find-result") { const n = Number(d.matches || 0); $("findCount").textContent = n ? `${n} match${n === 1 ? "" : "es"}` : "No matches"; return; }
  if (d.type === "veyra:unsupported") { toast(d.reason || "That action isn't supported through the proxy", { kind: "warn" }); return; }
  if (d.type === "veyra:open" && d.url) { const u = canonical(d.url); if (u) newTab({ url: u, index: state.tabs.indexOf(t) + 1 }); return; }
  if (d.type === "veyra:form" && d.url) { submitForm(t, d); return; }
  if (d.type === "veyra:retry") { if (activeTab() === t) reload(); return; }
  if (d.type === "veyra:challenge" && d.url) {
    
    
    const u = canonical(d.url); if (!u || t.view !== "page") return;
    t.challengeTried ||= new Set();
    if (!d.manual && (!d.auto || settings.challengeHandoff === false || t.challengeTried.has(u))) { if (!d.manual) toast("This site wants a security check. Use \u201cVerify in real Chromium\u201d to complete it", { kind: "warn", ms: 5000 }); return; }
    t.challengeTried.add(u);
    toast("Security check detected, opening it in real Chromium", { ms: 3000 });
    loadInTab(t, u, { forceBrowser: true });
    return;
  }
  if (d.type === "veyra:navigate" && d.url) {
    const target = canonical(d.url); if (!target) return;
    if (d.title) t.title = String(d.title).slice(0, 200); if (d.favicon) t.favicon = canonical(d.favicon) || "";
    if (String(d.source).startsWith("history.")) { t.url = target; if (d.source === "history.pushState") pushTabHistory(t, target); else if (t.history.length) t.history[t.histIndex] = target; }
    else if (d.source === "document-navigation") {
      const same = t.url && t.url.split("#")[0] === target.split("#")[0];
      if (!same) {
        
        
        
        void loadInTab(t, target, { loadFrame: true, record: null }).then(() => {
          if (activeTab() === t) syncRoute({ replace: true });
        });
        if (activeTab() === t) syncRoute({ replace: true });
        return;
      }
      const h = state.history.find(x => x.url === target); if (h && d.title) { h.title = t.title; saveHistory(); }
    } else { t.url = target; }
    
    
    if (d.source === "document-navigation" && t.loading) { t.loading = false; clearTimeout(t.loadGuard); if (activeTab() === t) setLoading(false); }
    if (activeTab() === t) { updateAddress(); updateIdentity(); syncRoute({ replace: true }); }
    renderTabsSoon();
  }
}
function escalateBrowserRequired(t, u, key, reason) {
  t.compatFallbackTried.add(key);
  addLog("info", `Browser capability required (${reason || "site feature"}); switching ${hostOf(u)} to Chromium.`);
  toast("This site needs a browser feature. Switching to Chromium…", { ms: 3000 });
  void loadInTab(t, u, { forceBrowser: true, loadFrame: true, record: null });
}
function canonical(value) {
  let raw = String(value || "").trim();
  for (let i = 0; i < 3; i++) {
    try { const u = new URL(raw, API); if (u.origin === API_ORIGIN && /^\/api\/(view|resource|download)$/.test(u.pathname)) { const inner = u.searchParams.get("url"); if (inner) { raw = inner; continue; } } return /^https?:$/.test(u.protocol) ? u.href : ""; }
    catch { return ""; }
  }
  return "";
}
function submitForm(t, msg) {
  if (!state.session) return;
  const f = getOrCreateFrame(t); const form = document.createElement("form"); form.method = "POST"; form.action = proxyUrl(msg.url, "view", state.session.id, t.url); form.target = f.name; form.style.display = "none";
  for (const [n, v] of msg.entries || []) form.appendChild(Object.assign(document.createElement("input"), { type: "hidden", name: n, value: v }));
  document.body.appendChild(form); form.submit(); form.remove(); if (activeTab() === t) setLoading(true, 50, "Submitting…");
}
function pushKeybindings(t) { const list = hooks.forwardableCombos?.(); if (list) pageCommand("veyra:keys", { combos: list }, t); }
window.addEventListener("message", e => { handleMessage(e).catch(err => addLog("error", `Message handling failed: ${err.message}`)); });


function wire() {
  $("newTabBtn").onclick = () => newTab();
  $("backBtn").onclick = back; $("forwardBtn").onclick = forward; $("reloadBtn").onclick = () => reload(); $("homeBtn").onclick = goHome;
  $("starBtn").onclick = toggleBookmark; $("zoomChip").onclick = () => setZoom(1);
  $("downloadBtn").onclick = () => openInternal("downloads");
  $("vpnBtn").onclick = () => hooks.openVpnPopover?.($("vpnBtn"));
  $("sessionPill").onclick = () => hooks.openSessionPopover?.($("sessionPill"));
  $("sessionRestart").onclick = async () => { $("sessionOverlay").classList.add("hidden"); try { await ensureSession(); toast("New session started"); } catch (e) { toast(e.message, { kind: "err" }); } const last = state.history.find(h => h.kind === "page"); if (last) { /* offer the last page again */ toast(`Open ${hostOf(last.url)} again?`, { action: () => go(last.url), actionLabel: "Open", ms: 6000 }); } };
  $("sessionHome").onclick = () => { $("sessionOverlay").classList.add("hidden"); goHome(); };
  $("searchForm").onsubmit = e => { e.preventDefault(); const q = $("searchInput").value.trim(); const t = activeTab(); pushTabHistory(t, "veyra:search:" + q); t.searchQuery = q; t.searchCorrection = null; t.title = q ? `${q} - Veyra Search` : "Veyra Search"; renderTabs(); syncRoute(); runSearch(q); };
  $("searchInput").oninput = e => loadSuggestions(e.target.value);
  $("searchTabs").addEventListener("click", e => {
    const b = e.target.closest("[data-src]"); const t = activeTab(); if (!b || !t || t.view !== "search") return;
    t.searchSource = b.dataset.src; settings.searchSource = b.dataset.src; saveSettings(); t.searchData = null;
    if (t.searchQuery) runSearch(t.searchQuery); else renderSearch();
  });
  $("downloadsFilter").oninput = renderDownloads; $("clearDownloadsBtn").onclick = () => { for (const c of state.downloadControllers.values()) c.abort(); state.downloads = []; saveDownloads(); renderDownloads(); };
  $("historyFilter").oninput = renderHistory; $("clearHistoryBtn").onclick = () => hooks.openClearData?.();
  $("resFilter").oninput = () => renderResources();
  $("sourceCopy").onclick = () => copyText(sourceTab()?._resText || "");
  $("sourcePretty").onclick = () => { const s = sourceTab(); if (!s?._resText) return; s._resText = prettyPrint(s._resText, s._resType); $("sourceCode").innerHTML = highlightCode(s._resText, s._resType); };
  $("linkFilter").oninput = debounceRaf(renderLinks); $("linkScope").onchange = renderLinks; $("linkCopy").onclick = () => copyText((sourceTab()?._links || []).map(l => l.url).join("\n"));
  $("consoleFilter").onchange = renderConsole; $("consoleSearch").oninput = renderConsole; $("clearConsole").onclick = () => { logs.length = 0; renderConsole(); };
  $("copyConsole").onclick = () => copyText(logs.map(x => `[${new Date(x.time).toISOString()}] ${x.level.toUpperCase()} ${x.message}`).join("\n"));
  $("findInput").oninput = e => findQuery(e.target.value);
  $("findInput").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); findQuery(e.target.value, e.shiftKey ? "backward" : "forward"); } else if (e.key === "Escape") { e.preventDefault(); closeFind(); } };
  $("findNext").onclick = () => findQuery($("findInput").value, "forward"); $("findPrev").onclick = () => findQuery($("findInput").value, "backward"); $("findClose").onclick = closeFind;
  document.addEventListener("click", e => { const a = e.target.closest("[data-go]"); if (a) { e.preventDefault(); $("authDialog").open && $("authDialog").close(); goRoute(a.dataset.go); } const r = e.target.closest("a[data-route]"); if (r) { e.preventDefault(); goRoute(r.dataset.route); } });
  setupCalculator();
  window.addEventListener("error", e => addLog("error", `UI error: ${e.message}`));
  window.addEventListener("unhandledrejection", e => addLog("error", `Unhandled: ${e.reason?.message || e.reason}`));
  document.addEventListener("visibilitychange", () => { const t = activeTab(); if (!document.hidden && t?.needsReload && t.url) { t.needsReload = false; loadInTab(t, t.url); } });
}


export const B = {
  state, INTERNAL, activeTab, tabById, newTab, closeTab, switchTab, cycleTab, selectTabIndex, reopenClosedTab, duplicateTab, go, navigate, openInternal,
  renderActive, renderTabs, updateIdentity, showSearch, back, forward, reload, stopLoad, goHome, toggleBookmark, openFind, closeFind, printPage, setZoom, zoomStep,
  ensureSession, endSession, sessionRemaining, updateSessionPreferences, startDownload, clearBrowsingData, recordHistory, refreshVpnStatus, connectVpn, disconnectVpn, renderVpnPanel, clearLocalAccountData,
  omniSuggest, classify, goRoute, showLanding, pageCommand, evaluate, prettyPrint, highlightCode, saveBookmarks, saveHistory, getOrCreateFrame, setLoading
};
hooks.B = B;


function applyStartup(params) {
  if (currentRoute() !== "/browse" || params.get("url") || params.get("q") || location.hash) return;
  if (settings.startup === "url" && settings.startupUrl) { go(settings.startupUrl, { tab: activeTab(), push: false }); return; }
  if (settings.startup === "continue") {
    const urls = load("veyra-last-tabs", []).filter(u => /^https?:/.test(u));
    const first = urls.shift(); if (first) go(first, { tab: activeTab(), push: false });
    
    
    urls.forEach((u, i) => setTimeout(() => newTab({ url: u, background: true }), (i + 1) * 75));
  }
}
setInterval(() => { if (settings.startup === "continue") save("veyra-last-tabs", state.tabs.filter(t => t.view === "page" && t.url).map(t => t.url)); }, 3000);

async function boot() {
  try {
    wire();
    cleanupUnfinishedSessionHistory();
    const params = new URLSearchParams(location.search);
    const r = params.get("veyra_route");
    if (r && /^\/?incognito\/?$/.test(r)) { location.replace(APP_BASE + "/browse?incognito=1"); return; }
    if (r) try { history.replaceState({}, "", APP_BASE + (r.startsWith("/") ? r : "/" + r)); } catch {}
    const t = makeTab(); state.tabs.push(t); state.activeId = t.id;
    initUI(B); initDevtools(B); initCast(B);
    renderTabs(); tickSession();
    applyRoute();
    applyStartup(params);
    api("/api/auth/config", { timeoutMs: 10000 }).then(c => { auth.config = c; auth.admin = !!c.admin; state.serverLimitMs = Number(c.sessionTimeLimitMs) || 0; tickSession(); hooks.onAuthChanged?.(); if ((currentRoute() === "/dev" || currentRoute() === "/admin" || location.hash === "#console") && !isAdmin()) applyRoute(); if (activeTab()?.view === "newtab") hooks.renderNewTab?.(); }).catch(e => addLog("warn", `Backend unreachable: ${e.message}`));
    addLog("info", `Veyra ${VERSION} ready · API ${API}`);
  } catch (e) { $("fatalOverlay").classList.remove("hidden"); $("fatalMessage").textContent = e.stack || e.message; console.error(e); }
}
boot();
