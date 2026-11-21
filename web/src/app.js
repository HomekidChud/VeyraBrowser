import {
  API, API_ORIGIN, APP_BASE, $, qsa, esc, hostOf, pathOf, displayUrl, uid, fmtBytes, fmtClock, timeAgo, letterIcon,
  settings, saveSettings, load, save, remove, api, proxyUrl, addLog, logs, netLog, toast, clearNotifications, hooks, auth, isAdmin,
  engineUrl, engineName, openFloating, closeFloating, ctxMenu, promptDialog, confirmDialog, rawFetch, copyText, VERSION, ApiError, INCOGNITO, SEARCH_ENGINES, sendNeuralFeedback, CHROMIUM_TRY_DISABLED, ensureApiAwake
} from "./core.js?v=8.36.0-workbench";
import { parseSourceUri, resolveSourceUri, validateSourceDisplayUrl } from "./source-address.js?v=8.28.31-in-app-popups";
import { dtCall, frameFor, isRemote, handleBridgeMessage, rejectTab } from "./bridge.js?v=8.36.0-workbench";
import { initUI } from "./ui.js?v=8.36.1-inline-watch";
import { initDevtools } from "./devtools.js?v=8.36.0-workbench";
import { maybeOfferRenew } from "./renew.js?v=8.36.0-workbench";
import { accountDestination, GOOGLE_SIGN_IN, withGitHubSignupBookmark } from "./account-navigation.js?v=2";
import { readVpnAvailability } from "./vpn-availability.js?v=1";
import { arrangeTabs, GROUP_COLOURS, validColour, paneLayout, paneRatio } from "./workspace.js?v=3";
import { siteScope, scopedUrl } from "./search-site-scope.js?v=1";
import { CATEGORIES, isVertical, searchCategory, searchStateKey, readSearchState, searchParams, resultUrl, posterUrl, mergeResults, icon as searchIcon, providerLabel, displayPrice } from "./search-deck.js?v=3";
import { blockPlaybackPopup, playbackPopupDecision, xhamsterPlaybackKey } from "./playback-popups.js?v=2";
import { canPark, diagnosticsAllowed, performanceMode } from "./velocity-model.js?v=2";
import { makeRemoteFrames, streamPreset } from "./remote-frames.js?v=1";

let castModulePromise = null;
function ensureCastModule() {
  castModulePromise ||= import("./device-cast.js?v=8.36.0-workbench").then(m => { m.initCast(B); return m; });
  return castModulePromise;
}
let adminModulePromise = null;
let adminModuleRetries = 0;
function ensureAdminModule() {

  const url = "./admin.js?v=8.36.0-workbench";
  adminModulePromise ||= import(adminModuleRetries ? `${url}&retry=${adminModuleRetries}` : url).catch(error => {
    adminModulePromise = null;
    adminModuleRetries++;
    throw error;
  });
  return adminModulePromise;
}
import { isYouTubeUrl, normalizeYouTubeUrl, youtubeEmbedUrl, youtubeFallbackHtml, youtubeWatchId, wireYouTubeDesk } from "./youtube.js?v=4";
import { nowGameMarkup, nowGameUrl } from "./game-launch.js?v=2";
import { DIRECT_SITE_NOTICE, originalSiteUrl, siteLoadErrorMarkup } from "./site-recovery.js?v=1";

const oldBookmarks = load("veyra-bookmarks", []);
export const state = {
  tabs: [], activeId: null, seq: 0, closed: [],
  bookmarks: (Array.isArray(oldBookmarks) ? oldBookmarks : []).map(b => typeof b === "string" ? { id: uid(), url: b, title: hostOf(b) || b, time: Date.now() } : b).filter(b => b && b.url),
  history: auth.user ? load("veyra-history", []).filter(x => x && typeof x === "object") : [],
  downloads: auth.user ? load("veyra-downloads", []).filter(x => x && typeof x === "object") : [],
  downloadControllers: new Map(),
  session: null, sessionTimer: null, sessionHeartbeat: null, lastUserActivity: Date.now(), sessionWarned: {}, sessionEnding: false, serverLimitMs: 120000, capabilityCache: new Map(),
  vpn: { status: null, connected: false, profile: null },
  incognito: INCOGNITO, server: { leanMode: false, chromiumEnabled: null, version: "", checked: false }, sessionPromise: null,

  tabGroups: auth.user ? load("veyra-tab-groups", []) : [],

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
  "console-lab": { title: "Veyra Console Lab", icon: "i-terminal", path: "/browse", admin: true },
  dev: { title: "Veyra dev", icon: "i-code", path: "/dev", admin: true },
  platform: { title: "Developer platform", icon: "i-platform", path: "/dev/platform" },
  admin: { title: "Admin panel", icon: "i-shield", path: "/admin/", admin: true },
  cast: { title: "Device Cast", icon: "i-globe", path: "/cast" },
  internet: { title: "Internet", icon: "i-vpn", path: "/internet" }
};
const ephemeralSession = () => INCOGNITO || !auth.user || !!state.session?.ephemeral;
hooks.isEphemeralSession = ephemeralSession;
const saveHistory = () => { if (!ephemeralSession()) save("veyra-history", state.history.slice(0, settings.historyMax || 1000)); };
const saveDownloads = () => { if (!ephemeralSession()) save("veyra-downloads", state.downloads.slice(0, settings.downloadsMax || 200)); };
const saveBookmarks = () => { save("veyra-bookmarks", state.bookmarks); hooks.scheduleSync?.(); };
const GITHUB_BOOKMARK_SEEDED = "veyra-github-signup-bookmark-seeded";
if (!INCOGNITO && !load(GITHUB_BOOKMARK_SEEDED, false)) {
  const bookmarks = withGitHubSignupBookmark(state.bookmarks);
  if (bookmarks !== state.bookmarks) {
    state.bookmarks = bookmarks;
    saveBookmarks();
  }
  save(GITHUB_BOOKMARK_SEEDED, true);
}
const saveTabGroups = () => { if (!ephemeralSession()) save("veyra-tab-groups", state.tabGroups); };

function persistTabGroups() {
  saveTabGroups();
  persistTabState();
}

let lastSavedTabState = "";
function persistTabState() {
  if (ephemeralSession()) return;
  const pageTabs = state.tabs.filter(t => t.view === "page" && t.url);
  const keepNewTab = state.tabs.length === 1 && state.tabs[0].view === "newtab";
  const tabs = (keepNewTab ? [state.tabs[0]] : pageTabs).map(t => ({
    id: t.id, url: t.url, title: t.title, view: t.view, groupId: t.groupId || null, pinned: !!t.pinned
  }));
  const snapshot = { tabs, activeId: state.activeId, seq: state.seq };
  const serialized = JSON.stringify(snapshot);
  if (lastSavedTabState === serialized) return;
  lastSavedTabState = serialized;
  save("veyra-tab-state", { ...snapshot, savedAt: Date.now() });
}
function restoreTabState() {
  if (ephemeralSession()) return false;
  const snap = load("veyra-tab-state", null);
  if (!snap || !Array.isArray(snap.tabs) || !snap.tabs.length) return false;
  if (snap.tabs.length === 1 && snap.tabs[0].view === "newtab") return false;
  const pageTabs = state.tabs.filter(t => t.view === "page" && t.url);
  if (pageTabs.length) return false;
  const validGroupIds = new Set(state.tabGroups.map(g => g.id));
  let seq = state.seq;
  let restored = 0;
  for (const s of snap.tabs) {
    if (!s || typeof s.url !== "string" || !/^https?:\/\//i.test(s.url)) continue;
    if (s.groupId && (s.pinned || !validGroupIds.has(s.groupId))) s.groupId = null;
    const t = makeTab({ id: s.id, url: s.url, view: "page", pinned: !!s.pinned, groupId: s.groupId || undefined, title: s.title || hostOf(s.url) || "New tab", needsInitialLoad: true });
    const n = Number(String(s.id || "").replace(/^t/, "")) || 0;
    if (n > seq) seq = n;
    state.tabs.push(t);
    restored++;
  }
  if (!restored) return false;

  state.tabs = state.tabs.filter(t => t.view !== "newtab");
  state.seq = seq;
  state.activeId = tabById(snap.activeId)?.id || state.tabs[state.tabs.length - 1].id;
  return true;
}
function cleanupUnfinishedSessionHistory() {
  const previous = load("veyra-live-session", null);
  if (previous?.id && settings.clearHistoryOnSessionEnd) {
    state.history = state.history.filter(h => h.sid !== previous.id);
    saveHistory();
  }
}
export function clearLocalAccountData() {
  state.bookmarks = []; saveBookmarks();
  save("veyra-notes", {}); save("veyra-extensions", {}); save("veyra-dev-extensions", []);
  settings.ntpTiles = null; saveSettings();
}

export function createTabGroup(name = "New Group", color = "") {
  const group = { id: uid(), name: String(name).trim().slice(0, 48) || "New group", color: validColour(color) ? color : GROUP_COLOURS[state.tabGroups.length % GROUP_COLOURS.length], collapsed: false };
  state.tabGroups.push(group); saveTabGroups(); return group;
}
export function assignTabToGroup(tabId, groupId) {
  const t = tabById(tabId); if (!t || !state.tabGroups.some(g => g.id === groupId)) return;
  t.groupId = groupId; t.pinned = false; persistTabGroups(); renderTabs();
}
export function removeTabFromGroup(tabId) {
  const t = tabById(tabId); if (!t) return;
  delete t.groupId; persistTabGroups(); renderTabs();
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
export function renameTabGroup(groupId, name, color = "") {
  const g = state.tabGroups.find(g => g.id === groupId); if (!g) return;
  g.name = String(name).trim().slice(0, 48) || g.name;
  if (validColour(color)) g.color = color;
  saveTabGroups(); renderTabs();
}
async function groupTab(t, group = null) {
  if (!t && !group) return;
  const r = await promptDialog({ title: group ? "Edit tab group" : "Create tab group", ok: group ? "Save group" : "Create group", fields: [
    { name: "name", label: "Group name", value: group?.name || "", placeholder: "Games, work, research…" },
    { name: "color", label: "Group colour", type: "color", value: validColour(group?.color) ? group.color : GROUP_COLOURS[state.tabGroups.length % GROUP_COLOURS.length] }
  ] });
  if (!r || !state.tabs.includes(t) && !group) return;
  if (group) renameTabGroup(group.id, r.name, r.color);
  else assignTabToGroup(t.id, createTabGroup(r.name, r.color).id);
}
function openGroupMenu(id, x, y) {
  const group = state.tabGroups.find(g => g.id === id); if (!group) return;
  const pages = state.tabs.filter(t => t.groupId === id && splitEligible(t));
  ctxMenu(x, y, [
    { label: "Rename or recolour…", action: () => groupTab(null, group) },
    { label: group.collapsed ? "Expand group" : "Collapse group", action: () => toggleGroupCollapse(id) },
    { label: "Split first two pages", disabled: pages.length < 2, action: () => {
      if (state.splitScreen.active) teardownSplitScreen();
      switchTab(pages[0].id); toggleSplitScreen(pages[1].id);
    } },
    { label: "Ungroup tabs", action: () => deleteTabGroup(id) }
  ]);
}

const splitEligible = t => t?.view === "page" && !!t.url && !isRemote(t);
const splitMobile = matchMedia("(max-width:768px)");
function loadRestoredTab(t) {
  if (!t.needsInitialLoad || !t.url) return;
  const pending = t.pendingNavigation;
  const trackHistory = t.velocityState !== "parked";
  t.needsInitialLoad = false;
  if (pending && !localPageKind(t.url)) sendNeuralFeedback(t.url, true, 0.5);
  void loadInTab(t, t.url, { ...pending, trackHistory, displayUrl: pending?.displayUrl || t.displayUrl });
}

export function toggleSplitScreen(partnerId = null) {
  const ss = state.splitScreen;
  if (ss.active) { teardownSplitScreen(); renderActive({ push: false, replace: true }); return; }

  const t = activeTab();
  if (!t || t.view !== "page") return toast("Open a page before starting split screen.", { kind: "warn" });
  if (isRemote(t)) return toast("Split view currently supports Fast proxy tabs only. Streamed Chromium tabs use one secure surface.", { kind: "warn", ms: 5000 });
  if (!t.url) return;
  const partner = partnerId ? tabById(partnerId) : null;
  const rightTab = splitEligible(partner) && partner !== t ? partner : state.tabs.find(x => x !== t && splitEligible(x));
  if (!rightTab) return toast("Open two Fast proxy pages to use split screen.", { kind: "warn" });
  Object.assign(ss, { active: true, leftTabId: t.id, rightTabId: rightTab.id, axis: paneLayout(settings.splitLayout), ratio: paneRatio(settings.splitRatio) });
  getOrCreateFrame(t); getOrCreateFrame(rightTab);
  loadRestoredTab(t); loadRestoredTab(rightTab);
  renderSplitScreen();
  renderTabs();
}
let splitDragCleanup = null;
function teardownSplitScreen() {
  const ss = state.splitScreen;
  ss.active = false; ss.leftTabId = null; ss.rightTabId = null;
  splitDragCleanup?.(); splitDragCleanup = null;
  document.getElementById("splitContainer")?.remove();
  $("viewport")?.classList.remove("split-active");
  $("frameWrap")?.removeAttribute("data-split-axis");
  qsa("#frameWrap .tab-frame").forEach(frame => frame.removeAttribute("data-split-pane"));
  renderTabs();
}
function syncSplitFrames() {
  const ss = state.splitScreen; if (!ss.active) return;
  const wrap = $("frameWrap");
  const axis = splitMobile.matches ? "stack" : ss.axis;
  wrap.dataset.splitAxis = axis;
  wrap.style.setProperty("--split-position", `${ss.ratio}%`);
  const divider = $("splitDivider");
  divider?.setAttribute("aria-orientation", axis === "stack" ? "horizontal" : "vertical");
  divider?.setAttribute("aria-valuenow", ss.ratio);
  const axisButton = $("splitAxis");
  if (axisButton) {
    axisButton.disabled = splitMobile.matches;
    axisButton.setAttribute("aria-pressed", String(axis === "stack"));
    axisButton.title = splitMobile.matches ? "Small screens stack the panes automatically" : "Change split orientation";
  }
  const partner = $("splitPartner");
  if (partner) {
    const options = state.tabs.filter(t => t.id !== ss.leftTabId && splitEligible(t))
      .map(t => [t.id, t.title, t.url]);
    const signature = JSON.stringify(options);
    if (partner.dataset.options !== signature) {
      partner.dataset.options = signature;
      partner.replaceChildren(...options.map(([id, title, url]) => Object.assign(new Option(title, id), { title: url })));
    }
    partner.value = ss.rightTabId;
  }
  for (const [id, pane] of [[ss.leftTabId, "first"], [ss.rightTabId, "second"]]) {
    const tab = tabById(id);
    const f = tab && frameFor(tab); if (f) f.dataset.splitPane = pane;
    const picker = $(`splitTitle-${pane}`);
    if (picker) { picker.textContent = tab?.title || "Page"; picker.setAttribute("aria-pressed", String(activeTab()?.id === id)); }
  }
  qsa("#frameWrap .tab-frame[data-split-pane]").forEach(frame => {
    if (frame.id !== `frame-${ss.leftTabId}` && frame.id !== `frame-${ss.rightTabId}`) frame.removeAttribute("data-split-pane");
  });
}
function renderSplitScreen() {
  const ss = state.splitScreen;
  if (!ss.active) return;
  $("viewport").classList.add("split-active");
  const wrap = $("frameWrap");
  let splitContainer = $("splitContainer");
  if (!splitContainer) {
    splitContainer = document.createElement("div");
    splitContainer.id = "splitContainer";
    splitContainer.className = "split-container";
    wrap.appendChild(splitContainer);
  }

  splitDragCleanup?.();
  splitContainer.innerHTML = `
    <div class="split-pane split-left"><div class="split-header">
      <button type="button" class="split-title" id="splitTitle-first" title="Use first pane in the address bar"></button>
      <div class="split-tools">
        <button type="button" class="icon-btn sm" id="splitAxis" aria-label="Change split orientation" title="Change split orientation"><svg><use href="#i-layers"/></svg></button>
        <button type="button" class="icon-btn sm" id="splitSwap" aria-label="Swap panes" title="Swap panes"><svg><use href="#i-reload"/></svg></button>
        <button type="button" class="icon-btn sm" id="splitClose" aria-label="Close split view" title="Close split view"><svg><use href="#i-x"/></svg></button>
      </div>
    </div></div>
    <div class="split-divider" id="splitDivider" role="separator" tabindex="0" aria-label="Resize split panes" aria-valuemin="20" aria-valuemax="80"></div>
    <div class="split-pane split-right"><div class="split-header">
      <button type="button" class="split-title" id="splitTitle-second" title="Use second pane in the address bar"></button>
      <select id="splitPartner" aria-label="Replace second pane"></select>
    </div></div>`;
  $("splitClose").onclick = () => toggleSplitScreen();
  $("splitAxis").onclick = () => {
    ss.axis = ss.axis === "stack" ? "columns" : "stack";
    settings.splitLayout = ss.axis; saveSettings(); syncSplitFrames();
  };
  $("splitSwap").onclick = () => {
    [ss.leftTabId, ss.rightTabId] = [ss.rightTabId, ss.leftTabId];
    renderSplitScreen(); $("splitSwap")?.focus();
  };
  $("splitTitle-first").onclick = () => switchTab(ss.leftTabId);
  $("splitTitle-second").onclick = () => switchTab(ss.rightTabId);
  $("splitPartner").onchange = e => {
    const tab = tabById(e.target.value); if (!splitEligible(tab) || tab.id === ss.leftTabId) return;
    const wasActive = state.activeId === ss.rightTabId;
    ss.rightTabId = tab.id;
    getOrCreateFrame(tab);
    loadRestoredTab(tab);
    if (wasActive) switchTab(tab.id);
    renderSplitScreen(); $("splitPartner")?.focus();
  };
  const divider = $("splitDivider");
  const resize = (value, persist = false) => {
    ss.ratio = paneRatio(value); syncSplitFrames();
    if (persist && settings.splitRatio !== ss.ratio) { settings.splitRatio = ss.ratio; saveSettings(); }
  };
  divider.onkeydown = e => {
    const stack = wrap.dataset.splitAxis === "stack";
    const change = { [stack ? "ArrowUp" : "ArrowLeft"]: -5, [stack ? "ArrowDown" : "ArrowRight"]: 5 }[e.key];
    if (change == null && !["Home", "End"].includes(e.key)) return;
    e.preventDefault(); resize(e.key === "Home" ? 20 : e.key === "End" ? 80 : ss.ratio + change, true);
  };
  divider.onpointerdown = e => {
    if (e.button !== 0) return;
    e.preventDefault(); divider.focus(); splitDragCleanup?.();
    const stack = wrap.dataset.splitAxis === "stack", rect = wrap.getBoundingClientRect();
    const move = ev => resize(stack ? 100 * (ev.clientY - rect.top) / rect.height : 100 * (ev.clientX - rect.left) / rect.width);
    const end = ev => { cleanup(); if (ev.type === "pointerup") resize(ss.ratio, true); };
    const cleanup = () => {
      splitDragCleanup = null;
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", end);
      divider.removeEventListener("lostpointercapture", end);
    };
    splitDragCleanup = cleanup;
    divider.setPointerCapture(e.pointerId);
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", end);
    divider.addEventListener("lostpointercapture", end);
  };
  syncSplitFrames();
}

function makeTab(extra = {}) {
  return {
    id: "t" + (++state.seq), title: "New tab", favicon: "", url: "", view: "newtab", section: "", history: [], histIndex: -1,
    jobId: null, done: true, poll: null, loading: false, browserMode: "FAST_PROXY", browserSessionId: "", browserPoll: null, browserStatus: "", requiresBrowser: false, combinedGraceTimer: null, loadStrategy: "auto", renderWinner: "", loadGuard: null, crawlerStartTimer: null, sessionId: "", compatFallbackTried: new Set(), challengeTried: new Set(), challengeEscalated: false, wasVerifying: false, challengeReturned: false,
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
let renderedTabMarkup = null;
export function renderTabs() {
  const list = $("tabsList"); if (!list) return;
  const split = state.splitScreen;
  if (split.active && (!splitEligible(tabById(split.leftTabId)) || !splitEligible(tabById(split.rightTabId)) ||
    ![split.leftTabId, split.rightTabId].includes(state.activeId))) {
    teardownSplitScreen(); return;
  }
  if (split.active) syncSplitFrames();
  const ordered = arrangeTabs(state.tabs, state.tabGroups);
  if (ordered.some((t, i) => t !== state.tabs[i])) state.tabs = ordered;
  let html = "";
  const groupsById = new Map(state.tabGroups.map(g => [g.id, g]));
  const groupMembers = new Map();
  for (const tab of state.tabs) {
    if (!tab.groupId || !groupsById.has(tab.groupId)) continue;
    if (!groupMembers.has(tab.groupId)) groupMembers.set(tab.groupId, []);
    groupMembers.get(tab.groupId).push(tab);
  }

  let openGroupId = null;
  const renderedCollapsed = new Set();
  const headerFor = g => {
    const groupTabs = groupMembers.get(g.id);
    const color = validColour(g.color) ? g.color : GROUP_COLOURS[0];
    return `<div class="tab-group ${g.collapsed ? "collapsed" : ""}" style="--group-color:${color}">
          <div class="tab-group-header" data-group="${esc(g.id)}">
            <button class="tab-group-toggle" type="button" aria-label="${esc(g.name)}, ${groupTabs.length} tabs" aria-expanded="${!g.collapsed}" title="Expand or collapse group">
            <span class="tab-group-dot"></span>
            <span class="tab-group-name">${esc(g.name)}</span>
            <span class="tab-group-count">${groupTabs.length}</span></button>
            <button class="tab-group-close" data-group-menu="${esc(g.id)}" aria-label="Options for ${esc(g.name)}" title="Group options"><svg><use href="#i-menu"/></svg></button>
          </div>`;
  };
  const groupFor = t => groupsById.get(t.groupId) || null;
  for (const t of state.tabs) {
    const g = groupFor(t);
    const gid = g?.id || null;
    if (gid !== openGroupId && openGroupId) { html += "</div>"; openGroupId = null; }
    if (g && gid !== openGroupId && !(g.collapsed && renderedCollapsed.has(gid))) {
      const groupTabs = groupMembers.get(g.id);
      html += headerFor(g);
      if (g.collapsed) {
        renderedCollapsed.add(gid);
        html += `<div class="tab-group-collapsed">`;
        for (const gt of groupTabs) {
          html += `<div class="tab tab-collapsed ${gt.id === state.activeId ? "active" : ""}" role="tab" aria-selected="${gt.id === state.activeId}" aria-label="${esc(gt.title)}" tabindex="${gt.id === state.activeId ? 0 : -1}" data-tab="${gt.id}" title="${esc(gt.title)}"><span class="tab-fav">${tabIconHtml(gt)}</span></div>`;
        }
        html += `</div></div>`;
      } else openGroupId = gid;
    }
    if (g && g.collapsed) continue;
    const velocityLabel = t.view === "page" && t.velocityState ? (t.velocityState === "parked" ? "Parked" : "Deferred") : "";
    html += `<div class="tab ${t.id === state.activeId ? "active" : ""} ${t.pinned ? "pinned" : ""} ${g ? "grouped" : ""}" style="${g && validColour(g.color) ? `--group-color:${g.color}` : ""}" role="tab" aria-label="${esc(t.title || "New tab")}" ${velocityLabel ? `aria-description="${velocityLabel}; opens when selected"` : ""} aria-selected="${t.id === state.activeId}" tabindex="${t.id === state.activeId ? 0 : -1}" data-tab="${t.id}" draggable="true" title="${esc(t.title)}${t.url ? "\n" + esc(t.url) : ""}">
      <span class="tab-fav">${tabIconHtml(t)}</span><span class="tab-title">${esc(t.title || "New tab")}</span>${velocityLabel ? `<span class="tab-badge velocity-tab-badge" title="${velocityLabel}; opens when selected" aria-hidden="true">${velocityLabel}</span>` : t.browserMode === "BROWSER_ENGINE" && t.view === "page" ? `<span class="tab-badge" title="Real Chromium tab">CR</span>` : ""}
      <button class="tab-close" data-close="${t.id}" title="Close tab" aria-label="Close tab"><svg><use href="#i-x"/></svg></button></div>`;
  }
  if (openGroupId) html += "</div>";

  if (state.tabGroups.some(g => !groupMembers.has(g.id))) {
    state.tabGroups = state.tabGroups.filter(g => groupMembers.has(g.id));
    saveTabGroups();
  }
  persistTabState();
  if (html === renderedTabMarkup) return;
  renderedTabMarkup = html;
  list.innerHTML = html;
  list.querySelectorAll(".tab").forEach(el => {
    el.onmousedown = e => { if (e.button === 1) { e.preventDefault(); closeTab(el.dataset.tab); } };
    el.onclick = e => { if (!e.target.closest("[data-close]")) switchTab(el.dataset.tab); };
    el.onkeydown = e => {
      const tabs = [...list.querySelectorAll(".tab[data-tab]")]; const i = tabs.indexOf(el);
      const vertical = list.getAttribute("aria-orientation") === "vertical";
      const next = vertical ? "ArrowDown" : "ArrowRight", prev = vertical ? "ArrowUp" : "ArrowLeft";
      if (e.key === next || e.key === prev) { e.preventDefault(); tabs[(i + (e.key === next ? 1 : -1) + tabs.length) % tabs.length]?.focus(); return; }
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

  list.querySelectorAll("[data-group]").forEach(el => {
    el.querySelector(".tab-group-toggle").onclick = () => {
      toggleGroupCollapse(el.dataset.group);
      [...list.querySelectorAll("[data-group]")].find(x => x.dataset.group === el.dataset.group)?.querySelector(".tab-group-toggle")?.focus();
    };
    el.oncontextmenu = e => { e.preventDefault(); openGroupMenu(el.dataset.group, e.clientX, e.clientY); };

    el.ondragover = e => e.preventDefault();
    el.ondrop = e => { e.preventDefault(); const from = e.dataTransfer.getData("text/veyra-tab"); if (from) assignTabToGroup(from, el.dataset.group); };
  });
  list.querySelectorAll("[data-group-menu]").forEach(b => b.onclick = e => {
    e.stopPropagation(); const bounds = b.getBoundingClientRect(); openGroupMenu(b.dataset.groupMenu, bounds.left, bounds.bottom);
  });
  list.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function moveTab(fromId, toId) {
  if (!fromId || fromId === toId) return;
  const a = state.tabs.findIndex(t => t.id === fromId), b = state.tabs.findIndex(t => t.id === toId);
  if (a < 0 || b < 0) return;
  const [t] = state.tabs.splice(a, 1);
  state.tabs.splice(b, 0, t);

  const anchor = tabById(toId);
  if (anchor) {
    if (anchor.groupId && anchor.groupId !== t.groupId) { t.groupId = anchor.groupId; t.pinned = false; persistTabGroups(); }
    else if (!anchor.groupId && t.groupId) { delete t.groupId; persistTabGroups(); }
  }
  renderTabs();
}
function shiftActiveTab(step) {
  const tab = activeTab(), pos = state.tabs.indexOf(tab), adjacent = state.tabs[pos + step];
  if (!tab || !adjacent || tab.groupId !== adjacent.groupId || !!tab.pinned !== !!adjacent.pinned) return;
  [state.tabs[pos], state.tabs[pos + step]] = [adjacent, tab];
  renderTabs();
}
function toggleTabPin(t = activeTab()) {
  if (!t) return;
  t.pinned = !t.pinned;
  if (t.pinned) delete t.groupId;
  persistTabGroups(); renderTabs();
}
function tabContextMenu(id, x, y) {
  const t = tabById(id); if (!t) return; const i = state.tabs.indexOf(t);
  const groupItems = state.tabGroups.length ? [
    { label: t.groupId ? "Remove from group" : "Add to group", action: () => {
      if (t.groupId) { removeTabFromGroup(id); }
      else {

        if (state.tabGroups.length === 1) { assignTabToGroup(id, state.tabGroups[0].id); }
        else {
          const items = state.tabGroups.map(g => ({ label: g.name, action: () => assignTabToGroup(id, g.id) }));
          items.push("-", { label: "New group…", action: () => groupTab(t) });
          ctxMenu(x + 30, y + 30, items);
        }
      }
    } },
    { label: "Create tab group…", action: () => groupTab(t) },
    ...(t.groupId ? [{ label: "Ungroup all tabs in this group", action: () => deleteTabGroup(t.groupId) }] : []),
  ] : [
    { label: "Create tab group…", action: () => groupTab(t) }
  ];
  ctxMenu(x, y, [
    { label: "New tab to the right", action: () => newTab({ index: i + 1 }) },
    "-",
    { label: "Reload", kbd: "Ctrl+R", action: () => { switchTab(id); reload(); } },
    { label: "Duplicate", action: () => duplicateTab(t) },
    { label: t.pinned ? "Unpin" : "Pin", action: () => toggleTabPin(t) },
    ...(parkingAllowed(t) ? [{ label: "Park background tab…", action: () => parkTab(id) }] : []),
    "-",
    ...groupItems,
    { label: "Split screen with this tab", action: () => { const prev = state.activeId; switchTab(id); toggleSplitScreen(prev && prev !== id ? prev : null); } },
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
  if (state.activeId !== id) hooks.playStudioSound?.("switch");

  const ss = state.splitScreen;
  if (ss.active && id !== ss.leftTabId && id !== ss.rightTabId) teardownSplitScreen();
  state.activeId = id; renderTabs(); renderActive({ push: true, replace: true });
}
export function newTab({ url = "", view = "", index = -1, background = false, section = "", displayUrl = "", popupOf = "", popupId = "" } = {}) {
  if (!background) hooks.playStudioSound?.("open");
  const t = makeTab({ popupOf, popupId }); if (index >= 0) state.tabs.splice(index, 0, t); else state.tabs.push(t);
  if (!background) state.activeId = t.id;
  renderTabs();
  if (url && interceptAccount(classify(url)?.url)) { if (!background) renderActive({ push: true }); }
  else if (url) { if (displayUrl) navigate(url, { tab: t, activate: !background, displayUrl }); else go(url, { tab: t, activate: !background }); }
  else if (view) openInternal(view, { tab: t, section });
  else if (settings.homepage) go(settings.homepage, { tab: t });
  else { t.view = "newtab"; if (!background) renderActive({ push: true }); }
  if (!background) setTimeout(() => { if (activeTab() === t && t.view === "newtab") $("ntpInput")?.focus(); }, 30);
  return t;
}
function duplicateTab(t) { const i = state.tabs.indexOf(t); if (t.view === "page" && t.url) newTab({ url: t.url, index: i + 1 }); else newTab({ view: t.view, index: i + 1, section: t.section }); }
function teardownTab(t) {
  t.pageLoad = null; t.localPage = ""; t.youtubeEmbed = false; t.youtubeInlineWatch = false;
  if (t.poll) clearInterval(t.poll); t.poll = null; clearTimeout(t.browserPoll); clearTimeout(t.loadGuard); clearTimeout(t.combinedGraceTimer); clearTimeout(t.crawlerStartTimer); t.crawlerStartTimer = null;
  if (t.browserSessionId) stopBrowserSession(t).catch(() => {});
  if (t.jobId && !t.done) stopJob(t.jobId).catch(() => {});
  t.jobId = null; t.done = true; t.queuedCrawler = null; t.crawlToken = null;
  t.needsInitialLoad = false; t.velocityState = ""; t.pendingNavigation = null;
  if (t.view === "cast") hooks.cleanupCast?.();
  rejectTab(t.id); frameFor(t)?.remove();
}
function parkingAllowed(tab) {
  return canPark(tab, { activeId: state.activeId, split: state.splitScreen, hasFrame: tab && frameFor(tab),
    hasPopup: !!tab?.popupOf || state.tabs.some(other => other.popupOf === tab?.id),
    fullscreen: !!document.fullscreenElement || !!document.pictureInPictureElement });
}
async function parkTab(id) {
  const tab = tabById(id);
  if (!tab || !parkingAllowed(tab)) return false;
  const accepted = await confirmDialog("Park this background tab?", "The page will reload when you select it. Unsaved changes may be lost and media playback may stop.", "Park tab");
  if (!accepted || tabById(id) !== tab || !parkingAllowed(tab)) return false;
  teardownTab(tab);
  tab.needsInitialLoad = true;
  tab.velocityState = "parked";
  renderTabs();
  toast("Tab parked. Select it to reload.");
  return true;
}
function performanceTabs() {
  return state.tabs.filter(t => t.view === "page" && !!t.url).map(t => {
    const parkable = parkingAllowed(t);
    return { id: t.id, title: t.title || "Web page", parkable, queued: !!t.velocityState,
      status: t.velocityState === "parked" ? "Parked · reloads on selection"
        : t.velocityState === "deferred" ? "Deferred · loads on selection"
        : t.loading ? "Loading" : t.pinned ? "Pinned" : t.id === state.activeId ? "Active"
        : isRemote(t) ? "Streamed Chromium" : parkable ? "Background · Fast Proxy" : "Not available for parking" };
  });
}
function setPerformanceMode(value) {
  const mode = performanceMode(value);
  if (settings.performanceMode === mode) return;
  settings.performanceMode = mode;
  saveSettings({ refresh: false });
  document.body.classList.toggle("velocity-boost", mode === "boost");
  syncBackgroundDiagnostics();
}
export function closeTab(id, { silent = false } = {}) {
  const idx = state.tabs.findIndex(t => t.id === id); if (idx < 0) return;
  const t = state.tabs[idx];
  if (!silent && settings.confirmCloseWithCrawl && t.jobId && !t.done && !confirm("This tab is still being indexed. Close it anyway?")) return;
  if (!silent) hooks.playStudioSound?.("close");
  if (t.view === "page" && t.url) { state.closed.push({ url: t.url, title: t.title, index: idx }); if (state.closed.length > 25) state.closed.shift(); }
  else if (t.view !== "newtab") state.closed.push({ view: t.view, title: t.title, index: idx, section: t.section, ...(t.view === "search" ? { searchQuery: t.searchQuery, searchSource: t.searchSource } : {}) });
  t.searchRequest?.abort(); t.searchAnswerRequest?.abort();
  teardownTab(t); hooks.dt?.onTabClosed(t);

  teardownPopupLinks(t);
  state.tabs.splice(idx, 1);
  if (!state.tabs.length) { const nt = makeTab(); state.tabs.push(nt); state.activeId = nt.id; }
  else if (state.activeId === id) state.activeId = state.tabs[Math.min(idx, state.tabs.length - 1)].id;

  if (state.splitScreen.active && (state.splitScreen.leftTabId === id || state.splitScreen.rightTabId === id)) teardownSplitScreen();
  renderTabs(); renderActive({ push: true, replace: true });
}
export function reopenClosedTab() { const c = state.closed.pop(); if (!c) return toast("No recently closed tabs"); const index = Math.min(c.index, state.tabs.length); if (c.url) newTab({ url: c.url, index }); else if (c.view === "search") showSearch(c.searchQuery || "", { tab: newTab({ index }), source: c.searchSource }); else newTab({ view: c.view, section: c.section, index }); }
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
  if (t.view === "page") return ["/browse", ""];
  if (t.view === "search") {
    const params = new URLSearchParams();
    if (t.searchQuery) params.set("q", t.searchQuery);
    if (t.searchSource && t.searchSource !== "web") params.set("type", t.searchSource);
    return ["/search", params.size ? `?${params}` : ""];
  }
  if (t.view === "calculator") return ["/calculator", t.calcExpression ? `?q=${encodeURIComponent(t.calcExpression)}` : ""];
  if (t.view === "settings") return [t.section ? `/settings/${t.section}` : "/settings", ""];
  if (t.view === "console") return ["/browse", "#console"];
  if (t.view === "console-lab") return ["/browse/", "#console-lab"];
  if (t.view === "cast") return ["/cast", ""];
  if (t.view === "internet") return ["/internet", ""];
  return [INTERNAL[t.view]?.path || "/browse", ""];
}
function syncRoute({ replace = false } = {}) {
  const [p, q] = routeForTab(activeTab());
  if (INCOGNITO) {
    const privateRoute = routeUrl(p) + `?incognito=1&private=${encodeURIComponent(incognitoToken || incognitoAddressToken())}`;
    if (location.pathname !== new URL(privateRoute, location.href).pathname) {
      try { history.replaceState({ veyra: true, incognito: true }, "", privateRoute); } catch {}
    }
    return;
  }
  const next = routeUrl(p, ephemeralSession() ? "" : q);
  if (next === location.pathname + location.search + location.hash) return;
  try { history[replace ? "replaceState" : "pushState"]({ veyra: true }, "", next); } catch {}
}
export function showLanding(on) {
  $("landing").classList.toggle("hidden", !on); $("app").classList.toggle("hidden", on);
  document.body.style.overflow = on ? "" : "hidden";
  if (on) { closeFloating(); hooks.renderLanding?.(); document.title = "Veyra"; }
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
  if ((route === "/browse" && location.hash === "#console-lab") || route === "/console-labs") return openInternal("console-lab", { push: false });
  if (location.hash === "#console" && !/^\/admin(?:\/|$)/.test(route)) return openInternal("console", { push: false });
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
    if (u) {
      try { history.replaceState({ veyra: true }, "", routeUrl("/browse")); } catch {}
      if (!(t.view === "page" && t.url === u)) go(u, { tab: reuse(t) ? t : null, push: false }); else renderActive({ push: false });
    }
    else if (q) go(q, { tab: reuse(t) ? t : null, push: false });
    else renderActive({ push: false });
    return;
  }
  if (view === "search") { showSearch(params.get("q") || "", { push: false, source: searchCategory(params.get("type")) }); return; }
  if (view === "calculator") { openInternal("calculator", { push: false, calc: params.get("q") || "" }); return; }
  openInternal(view, { push: false, section: first === "dev" && second === "platform" ? (third || "") : (second || "") });
}
window.addEventListener("popstate", () => applyRoute());

export function openInternal(view, { tab = null, push = true, section = "", calc = "" } = {}) {
  if (INCOGNITO && view === "cast") {
    toast("Device Cast is disabled in incognito.", { kind: "warn" });
    if (currentRoute() === "/cast") history.replaceState({}, "", routeUrl("/browse") + "?incognito=1");
    return renderActive({ push: false });
  }
  if (view !== "admin" && view !== "console-lab" && INTERNAL[view]?.admin && !isAdmin()) {
    toast("That page is only available to Veyra administrators", { kind: "warn" });
    if (currentRoute() === "/dev" || location.hash === "#console") { try { history.replaceState({}, "", routeUrl("/browse")); } catch {} }
    renderActive({ push: false }); return;
  }
  let t = tab || activeTab();

  const existing = state.tabs.find(x => x.view === view && !["resources", "links", "calculator"].includes(view));
  if (!tab && existing && existing !== t) { t = existing; state.activeId = t.id; }
  else if (!tab && t && t.view === "page" && t.url) {
    const src = t; t = makeTab({ sourceTabId: src.id, groupId: src.groupId }); state.tabs.splice(state.tabs.indexOf(src) + 1, 0, t); state.activeId = t.id;
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

let adminAccess = null;
function canOpenAdminPanel() {
  return adminAccess?.status === "allowed" && adminAccess.token === auth.token && adminAccess.adminToken === settings.adminToken;
}
hooks.canOpenAdminPanel = canOpenAdminPanel;

function syncAdminAccess({ force = false } = {}) {
  const token = auth.token, adminToken = settings.adminToken;
  if (!force && adminAccess?.token === token && adminAccess.adminToken === adminToken) return;
  const access = { token, adminToken, status: token || adminToken ? "checking" : "signed-out" };
  adminAccess = access;
  auth.admin = false;
  renderAdminAccessChange();
  void api("/api/auth/config", { timeoutMs: 10000 }).then(config => {
    if (adminAccess !== access || auth.token !== token || settings.adminToken !== adminToken) return;
    auth.config = config;
    auth.admin = !!((token || adminToken) && config.admin === true);
    access.status = auth.admin ? "allowed" : token || adminToken ? "denied" : "signed-out";
    state.serverLimitMs = Number(config.sessionTimeLimitMs) || 0;
    tickSession();
    hooks.onAuthChanged?.();
    if (token || adminToken) renderAdminAccessChange();
  }).catch(e => {
    if (adminAccess !== access) return;
    addLog("warn", `Could not verify administrator access: ${e.message}`);
    if (token || adminToken) { access.status = "unavailable"; renderAdminAccessChange(); }
  });
}

function renderAdminAccessChange() {
  hooks.renderBookmarksBar?.();
  const tab = activeTab();
  if (tab?.view === "admin") renderAdminEntry(tab);
  else if (!canOpenAdminPanel()) $("adminPanel")?.replaceChildren();
  if (tab?.view === "console-lab") renderConsoleLabEntry();
  else if (!canOpenAdminPanel()) $("view-console-lab")?.replaceChildren();
}

function adminMessage(box, message, actions = "") {
  box.innerHTML = `<div class="adm-console"><header class="adm-masthead"><div class="adm-title">
    <span class="adm-emblem" aria-hidden="true"><svg><use href="#i-shield"/></svg></span>
    <div><div class="adm-kicker">VEYRA / OPERATIONS</div><h1>Admin panel</h1></div></div></header>
    <div class="adm-panel adm-entry"><p role="status">${message}</p>${actions ? `<div class="adm-actions">${actions}</div>` : ""}</div></div>`;
}

function renderAdminEntry(tab) {
  const box = $("adminPanel"); if (!box) return;
  const retry = '<button type="button" class="btn primary" id="retryAdmin">Retry</button>';
  if (!canOpenAdminPanel()) {
    const status = adminAccess?.status;
    if (status === "checking") return adminMessage(box, "Checking administrator access…");
    const signIn = `<button type="button" class="btn primary" data-auth="login">${auth.token ? "Sign in with another account" : "Sign in"}</button>`;
    const back = '<button type="button" class="btn ghost" id="leaveAdmin">Back to browsing</button>';
    if (status === "unavailable") adminMessage(box, "Could not verify administrator access. Check the connection to VeyraServer and try again.", retry + back);
    else if (status === "denied") adminMessage(box, "This session does not have administrator access. Sign in with a Veyra administrator account.", signIn + back);
    else adminMessage(box, "Sign in with a Veyra administrator account to open the admin panel.", signIn + back);
    if ($("retryAdmin")) $("retryAdmin").onclick = () => syncAdminAccess({ force: true });
    $("leaveAdmin").onclick = goHome;
    return;
  }
  const access = adminAccess;
  adminMessage(box, "Loading the admin console…");
  void ensureAdminModule().then(m => {
    if (activeTab() === tab && tab.view === "admin" && adminAccess === access && canOpenAdminPanel()) m.renderAdmin(tab.section);
  }).catch(e => {
    if (activeTab() !== tab || tab.view !== "admin" || adminAccess !== access || !canOpenAdminPanel()) return;
    addLog("warn", `Could not load the admin console: ${e.message}`);
    adminMessage(box, "The admin console could not load. Try again.", retry);
    $("retryAdmin").onclick = () => renderAdminEntry(tab);
  });
}

function renderConsoleLabEntry() {
  const box = $("view-console-lab"); if (!box) return;
  if (INCOGNITO || !canOpenAdminPanel()) {
    const shell = document.createElement("div");
    shell.className = "page-shell wide";
    const h = document.createElement("h1"), note = document.createElement("p");
    h.textContent = "Console Lab";
    note.setAttribute("role", "status");
    const checking = adminAccess?.status === "checking";
    note.textContent = INCOGNITO ? "Console Lab is not available in private browsing." : checking
      ? "Checking administrator access…" : adminAccess?.status === "unavailable"
        ? "Administrator verification is unavailable. Check your connection and retry."
        : "Sign in with a verified Veyra administrator account.";
    shell.append(h, note);
    if (!checking && !INCOGNITO) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "btn primary";
      if (adminAccess?.status === "unavailable") {
        button.textContent = "Retry verification";
        button.onclick = () => syncAdminAccess({ force: true });
      } else { button.textContent = "Sign in"; button.dataset.auth = "login"; }
      shell.append(button);
    }
    box.replaceChildren(shell);
    return;
  }
  if ($("consoleLabFrame")) return;
  const frame = document.createElement("iframe");
  frame.id = "consoleLabFrame"; frame.title = "Veyra Console Lab";
  frame.referrerPolicy = "no-referrer";
  frame.style.cssText = "display:block;width:100%;height:100%;border:0";
  frame.src = new URL(`${APP_BASE}/console-lab/`, location.origin).href;
  box.replaceChildren(frame);
}

export function renderActive({ push = true, replace = false } = {}) {
  const t = activeTab(); if (!t) return;

  const ss = state.splitScreen;
  if (ss.active && (t.view !== "page" || isRemote(t) || (t.id !== ss.leftTabId && t.id !== ss.rightTabId))) teardownSplitScreen();
  qsa(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + t.view));
  if (t.view === "page") showFrameForTab(t); else { clearRemoteSurface(); setLoading(false); }
  updateAddress(); updateNavButtons(); updateIdentity();
  const r = {
    newtab: () => hooks.renderNewTab?.(), search: () => renderSearch(), calculator: () => renderCalculator(),
    downloads: renderDownloads, history: renderHistory, extensions: () => hooks.renderExtensions?.(), settings: () => hooks.renderSettings?.(t.section),
    vpn: renderVpnPanel, resources: renderResources, links: renderLinks, console: renderConsole, dev: renderDev, platform: renderPlatform, admin: () => renderAdminEntry(t), "console-lab": renderConsoleLabEntry,
    cast: () => ensureCastModule().then(() => hooks.renderCast?.()), internet: () => ensureCastModule().then(() => hooks.renderInternet?.())
  }[t.view]; r?.();
  if (t.view !== "console-lab" && !state.tabs.some(tab => tab.view === "console-lab")) $("view-console-lab")?.replaceChildren();
  if (t.view !== "dev") clearInterval(state.devTimer);
  if (t.view !== "admin") clearInterval(state.adminTimer);
  if (!$("findBar").classList.contains("hidden") && t.view !== "page") closeFind();
  $("readerView").classList.toggle("hidden", !(t.view === "page" && t.readerOpen));
  hooks.renderSidePanel?.(t);
  hooks.dt?.onTabChanged(t);
  syncBackgroundDiagnostics();
  if (push) syncRoute({ replace });
}
function updateAddress() {
  const t = activeTab(); const input = $("address"); if (!t || document.activeElement === input) return;
  input.value = t.view === "page" ? (INCOGNITO ? incognitoAddressToken() : (t.displayUrl || t.url || "")) : t.view === "search" ? t.searchQuery : t.view === "newtab" ? "" : `veyra://${t.view}${t.section ? "/" + t.section : ""}`;
}
const INCOGNITO_TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
let incognitoToken = "";
function incognitoAddressToken() {
  if (!incognitoToken) rotateIncognitoAddressToken();
  return incognitoToken;
}
function rotateIncognitoAddressToken() {

  const bytes = new Uint8Array(32);
  try { crypto.getRandomValues(bytes); } catch { for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256); }
  incognitoToken = "veyra://private/" + Array.from(bytes, b => INCOGNITO_TOKEN_ALPHABET[b % INCOGNITO_TOKEN_ALPHABET.length]).join("");
  const input = $("address"); const t = activeTab();
  if (INCOGNITO && input && t?.view === "page" && document.activeElement !== input) input.value = incognitoToken;
  if (INCOGNITO) {
    const privateRoute = routeUrl(routeForTab(t)[0]) + `?incognito=1&private=${encodeURIComponent(incognitoToken)}`;
    try { history.replaceState({ veyra: true, incognito: true }, "", privateRoute); } catch {}
  }
}
function startIncognitoAddressRotation() {
  if (!INCOGNITO || window.__veyraIncognitoAddressRotation) return;
  rotateIncognitoAddressToken();

  window.__veyraIncognitoAddressRotation = window.setInterval(rotateIncognitoAddressToken, 500);
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
    const vpn = state.vpn.connected && !t.localPage;
    icon = t.localPage ? "i-link" : vpn ? "i-vpn" : secure ? "i-lock" : "i-info";
    chip.classList.add(vpn ? "vpn" : secure ? "secure" : "warn");
    label = t.localPage ? "Direct" : vpn ? "VPN" : t.browserMode === "BROWSER_ENGINE" ? "Chromium" : t.failoverReason ? "Fast (limited)" : "";
  } else if (t.view !== "newtab") { icon = "i-shield"; label = "Veyra"; chip.classList.add("secure"); }
  chip.innerHTML = `<svg><use href="#${icon}"/></svg><span id="siteChipText">${esc(label)}</span>`;
  const bm = t.url && state.bookmarks.some(b => b.url === t.url);
  $("starBtn").classList.toggle("on", !!bm); $("starBtn").disabled = !(t.view === "page" && t.url);
  $("zoomChip").classList.toggle("hidden", !(t.view === "page" && t.zoom !== 1)); $("zoomChip").textContent = Math.round(t.zoom * 100) + "%";
  $("statusLeft").textContent = t.view === "page" ? (t.loading ? `Loading ${hostOf(t.url)}…` : t.url ? `${t.localPage === "youtube" ? "Direct player" : t.localPage ? "Direct launch" : t.browserMode === "BROWSER_ENGINE" ? "Chromium" : t.failoverReason ? "Fast mode (limited)" : "Fast proxy"} · ${hostOf(t.url)}` : "Ready") : INTERNAL[t.view]?.title || "Ready";

  document.title = t.view === "page" && t.title && t.title !== "New tab" ? `${t.title} — Veyra` : "Veyra";

  const sc = $("statusCenter");
  if (sc) {

    if (!CHROMIUM_TRY_DISABLED && t.failoverReason && t.view === "page" && !t.loading) {
      sc.innerHTML = `<button class="retry-browser-btn" id="retryBrowserBtn" title="Reset the circuit breaker and retry Chromium">Retry full browser</button>`;
      const btn = $("retryBrowserBtn");
      if (btn) btn.onclick = () => { void retryFullBrowser().catch(() => {}); };
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

  f.setAttribute("sandbox", t.localPage === "now" ? "allow-popups allow-popups-to-escape-sandbox"
    : t.localPage === "youtube" ? "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      : "allow-scripts allow-same-origin allow-forms allow-downloads");
  f.setAttribute("allow", INCOGNITO
    ? "autoplay; encrypted-media; display-capture 'none'; fullscreen 'none'; picture-in-picture 'none'"
    : "fullscreen; autoplay; clipboard-read; clipboard-write; picture-in-picture; encrypted-media");
  f.addEventListener("load", () => { if (frameFor(t) === f) onFrameLoad(t); });
  $("frameWrap").insertBefore(f, $("frameLoader"));
  syncSplitFrames();
  return f;
}

function probeFrameForEscape(t) {
  try {
    const f = frameFor(t);
    if (!f || isRemote(t) || t.youtubeEmbed) return;

    if (!f.src || !/^https?:/i.test(f.src)) return;
    let origin = ""; try { origin = new URL(f.src, location.href).origin; } catch { return; }
    if (origin !== API_ORIGIN) return;
    const loadedAt = Date.now(), pageLoad = t.pageLoad, probe = {};
    t.escapeProbe = probe;
    try { f.contentWindow?.postMessage?.({ type: "veyra:embed-probe" }, API_ORIGIN); } catch {}
    setTimeout(() => {
      try {
        if (!state.tabs.includes(t) || t.view !== "page" || t.localPage || frameFor(t) !== f ||
            t.pageLoad !== pageLoad || t.escapeProbe !== probe) return;
        if ((t.lastRuntimeAckAt || 0) > loadedAt) return;
        t.escapeRecoveries = (t.escapeRecoveries || 0) + 1;
        if (t.escapeRecoveries > 3) {
          if (t.escapeRecoveries === 4 && activeTab() === t) showSiteRecovery(t, "This page isn’t responding inside Veyra.");
          return;
        }
        addLog("info", `${hostOf(t.url)} navigated out of the proxy; bringing it back inside Veyra.`);
        void navigate(t.url, { tab: t, push: false, activate: activeTab() === t });
      } catch { /* frame gone — ignore */ }
    }, 2500);
  } catch { /* not a probeable frame — ignore */ }
}

function setFrameSrc(f, src, tab = null) {
  try { if (f.src === src) f.removeAttribute("src"); } catch {}

  if (tab?.popupOf && /^https?:/i.test(src)) {
    try { const u = new URL(src); if (!u.searchParams.has("veyra_popup")) { u.searchParams.set("veyra_popup", "1"); src = u.href; } } catch {}
  }
  f.src = src;
}
function onFrameLoad(t) {
  if (t.localPage === "youtube" && state.tabs.includes(t) && t.view === "page") {
    const frame = frameFor(t), url = t.url, load = t.pageLoad, doc = frame?.contentDocument;
    const current = () => state.tabs.includes(t) && t.view === "page" && t.localPage === "youtube"
      && t.url === url && t.pageLoad === load && frameFor(t) === frame && frame?.contentDocument === doc
      && !INCOGNITO && !state.vpn.connected && settings.youtubeInline !== false;
    if (current()) wireYouTubeDesk(doc, url, t.youtubeQueue ||= [], {
      current, check: id => api(`/api/media/youtube/${encodeURIComponent(id)}`, { timeoutMs: 6500 }),
      open: url => navigate(url, { tab: t, activate: false, push: activeTab() === t })
    });
    return;
  }
  if (!state.tabs.includes(t) || t.view !== "page" || t.localPage) return;
  if (frameFor(t)?.hasAttribute("data-site-error")) return;
  probeFrameForEscape(t);

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

  const loadedFrame = frameFor(t);
  setTimeout(() => {
    if (!loadedFrame || frameFor(t) !== loadedFrame) return;
    if (t.zoom !== 1) dtCall(t, "ext.zoom", { zoom: t.zoom }, 4000).catch(() => {});
    hooks.applyExtensionsToTab?.(t); hooks.dt?.onPageLoaded(t); pushKeybindings(t);
  }, 120);

  setTimeout(() => { if (loadedFrame && frameFor(t) === loadedFrame) detectBlankProxyPage(t); }, 2200);
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
const browserFallbackAllowed = () => settings.browserFallback !== false && ["auto", "crawler"].includes(String(settings.runtime || "auto"));
async function serverChromiumAvailable() {
  if (typeof state.server.chromiumEnabled === "boolean") return state.server.chromiumEnabled;
  try {
    const status = await api("/api/acquisition/status", { timeoutMs: 6000 });
    state.server.chromiumEnabled = status?.chromiumEnabled === true;
    return state.server.chromiumEnabled;
  } catch {
    state.server.chromiumEnabled = false;
    return false;
  }
}
async function routeBrowserRequired(t, url, key, reason) {
  const frame = frameFor(t);
  const current = () => state.tabs.includes(t) && t.view === "page" && t.url === url
    && !t.localPage && !t.needsInitialLoad && frameFor(t) === frame;
  if (!current()) return;
  t.compatFallbackTried ||= new Set();
  if (t.compatFallbackTried.has(key)) return;
  const explicitBrowser = String(settings.runtime || "auto") === "browser";
  if (!explicitBrowser && !browserFallbackAllowed()) {
    t.compatFallbackTried.add(key);
    addLog("debug", `${hostOf(url)} requested a browser feature; keeping the full FAST_PROXY page (${reason || "browser-required"}).`);
    return;
  }
  if (!(await serverChromiumAvailable())) {
    if (!current()) return;
    t.compatFallbackTried.add(key);
    addLog("info", `${hostOf(url)} needs JavaScript rendering, but server Chromium is unavailable; keeping the FAST_PROXY page (${reason || "browser-required"}).`);
    return;
  }
  if (!current()) return;
  escalateBrowserRequired(t, url, key, reason);
}
function escalateBlankProxyPage(t, key) {
  void routeBrowserRequired(t, t.url, key, "empty-spa-shell");
}
function detectBlankProxyPage(t) {
  if (!state.tabs.includes(t) || t.view !== "page" || isRemote(t) || !t.url) return;
  if (t.browserMode === "BROWSER_ENGINE") return;
  t.compatFallbackTried ||= new Set();
  const checkedUrl = t.url, checkedFrame = frameFor(t);
  const key = `${checkedUrl}|blank-shell`;
  if (t.compatFallbackTried.has(key)) return;

  const first = proxyDocLooksBlank(t);
  if (!first.blank) return;

  if (first.nodes >= 0 && !isYouTubeUrl(t.url) && browserFallbackAllowed()) {
    setTimeout(() => {
      if (!state.tabs.includes(t) || t.view !== "page" || t.url !== checkedUrl || t.browserMode === "BROWSER_ENGINE" || frameFor(t) !== checkedFrame) return;
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
let displayedRemote = "";
let remoteFrames;
function clearRemoteSurface() {
  remoteFrames?.stop();
  displayedRemote = "";
  const v = $("remoteSurface");
  if (!v) return;
  const img = $("remoteImg");
  if (img) { img.width = 1; img.height = 1; img.style.visibility = "hidden"; }
  if ($("remoteDelivery")) $("remoteDelivery").textContent = "";
  const ld = $("remoteLoading"); if (ld) ld.style.display = "none";
  const er = $("remoteError"); if (er) er.style.display = "none";
  v.classList.remove("frame-active");
}
function ensureRemoteSurface() {
  let v = $("remoteSurface"); if (v) return v;
  v = document.createElement("div"); v.id = "remoteSurface"; v.className = "browser-surface"; v.tabIndex = 0; v.setAttribute("role", "application"); v.setAttribute("aria-describedby", "remoteA11yNotice"); v.setAttribute("aria-label", "Streamed Chromium browser surface");
  v.style.position = "relative";
  v.innerHTML = `<p id="remoteA11yNotice" class="sr-only">This streamed Chromium page is currently a visual surface; its page structure is not available to assistive technology. Use Fast proxy where possible for an accessible document.</p><canvas id="remoteImg" width="1" height="1" aria-hidden="true" style="width:100%;height:100%;object-fit:contain;display:block;user-select:none;visibility:hidden;touch-action:none"></canvas><div id="remoteLoading" style="position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:14px;background:var(--bg);color:var(--text-2);z-index:3"><div class="spinner"></div><span class="muted">Starting Chromium…</span></div><div id="remoteError" style="position:absolute;inset:0;display:none;place-content:center;justify-items:center;gap:10px;background:var(--bg);color:var(--text-2);z-index:3;text-align:center;padding:24px"><svg width="40" height="40" style="color:var(--line-2)"><use href="#i-info"/></svg><b>Remote Chromium unavailable</b><span class="muted small" id="remoteErrorText">The browser session could not be loaded.</span><button class="btn ghost sm" id="remoteRetryBtn">Retry</button></div><span id="remoteDelivery" class="remote-delivery" title="Frames Veyra displayed in the last two seconds. Not the game's own FPS."></span><div id="remoteCursor" style="position:absolute;width:18px;height:18px;pointer-events:none;z-index:10;opacity:0;transition:opacity 150ms;margin-left:-9px;margin-top:-9px;background:#fff;border:2px solid #000;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,.5)"></div>`;
  $("frameWrap").insertBefore(v, $("frameLoader"));
  const img = v.querySelector("canvas");
  const ctx = img.getContext("2d", { alpha: false, desynchronized: true });
  const loading = $("remoteLoading"), error = $("remoteError"), label = $("remoteDelivery");
  remoteFrames = makeRemoteFrames({ base: API, request: rawFetch,
    draw(picture) {
      if (!ctx || !displayedRemote) return;
      const w = picture.naturalWidth || picture.width, h = picture.naturalHeight || picture.height;
      if (img.width !== w) img.width = w;
      if (img.height !== h) img.height = h;
      ctx.drawImage(picture, 0, 0);
      img.style.visibility = "visible";
      loading.style.display = "none";
      if (!["BROWSER_ERROR", "CRASHED", "ERROR"].includes(activeTab()?.browserStatus)) error.style.display = "none";
    },
    onState(mode, { fps } = {}) {
      label.textContent = mode === "live" ? (fps ? `Stream · ${fps} displayed FPS` : "Live stream")
        : mode === "snapshot" ? "Screenshot fallback" : mode === "snapshot-unavailable" ? "Waiting for frame…" : "Connecting…";
    }
  });

  const VW = 1365, VH = 820;

  const pos = e => {
    const r = img.getBoundingClientRect();
    const containerAspect = r.width / r.height;
    const imageAspect = img.width > 1 && img.height > 1 ? img.width / img.height : VW / VH;
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

  let inputQueue = [], sending = false;
  const send = payload => {
    const t = activeTab(), id = t?.browserSessionId;
    if (!id || displayedRemote !== id) return;
    const tail = inputQueue.at(-1);
    if (payload.type === "wheel" && tail?.id === id && tail.payload.type === "wheel") {
      for (const axis of ["deltaX", "deltaY"]) tail.payload[axis] = Math.max(-2400, Math.min(2400, tail.payload[axis] + payload[axis]));
      return;
    }
    inputQueue = inputQueue.filter(entry => entry.id === id);
    if (inputQueue.length >= 32) return;
    inputQueue.push({ t, id, payload });
    if (sending) return;
    sending = true;
    void (async () => {
      try {
        while (inputQueue.length) {
          const next = inputQueue.shift();
          if (activeTab() !== next.t || displayedRemote !== next.id) continue;
          try {
            await api(`/api/browser/session/${encodeURIComponent(next.id)}/input`, {
              json: { ...next.payload, interactive: remoteFrames.interactive(next.id) }, timeoutMs: 5000
            });
            if (activeTab() === next.t && displayedRemote === next.id) remoteFrames.refresh(next.id);
          } catch (e) { addLog("warn", `Chromium input failed: ${e.message}`); }
        }
      } finally { sending = false; }
    })();
  };
  v.addEventListener("click", e => { if (!e.target.closest("#remoteRetryBtn")) return; const t = activeTab(); if (!isRemote(t)) return; remoteFrames.stop(); startRemoteFrames(t); refreshRemote(t, true); });
  const modifiers = e => ({ altKey: !!e.altKey, ctrlKey: !!e.ctrlKey, metaKey: !!e.metaKey, shiftKey: !!e.shiftKey });
  let activePointer = null, dragged = false;
  img.addEventListener("pointerdown", e => { v.focus(); if (hooks.dt?.pickingRemote(e, pos(e))) return; activePointer = e.pointerId; dragged = false; img.setPointerCapture?.(e.pointerId); });
  img.addEventListener("pointermove", e => { if (activePointer === e.pointerId && (Math.abs(e.movementX) + Math.abs(e.movementY) > 3)) dragged = true; });
  img.addEventListener("pointerup", e => { if (activePointer !== e.pointerId) return; if (!dragged) send({ type: "click", ...pos(e), button: e.button === 2 ? "right" : "left", ...modifiers(e) }); activePointer = null; });
  img.addEventListener("pointercancel", e => { if (activePointer === e.pointerId) activePointer = null; });
  img.addEventListener("dblclick", e => send({ type: "dblclick", ...pos(e), ...modifiers(e) }));
  img.addEventListener("contextmenu", e => e.preventDefault());
  let scroll = null, wheelPaint = null;
  img.addEventListener("wheel", e => {
    e.preventDefault();
    if (scroll?.id !== displayedRemote) scroll = { id: displayedRemote, x: 0, y: 0 };
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? img.clientHeight : 1;
    scroll.x += e.deltaX * scale; scroll.y += e.deltaY * scale;
    if (wheelPaint === null) wheelPaint = requestAnimationFrame(() => {
      const next = scroll; scroll = null; wheelPaint = null;
      if (next?.id === displayedRemote && displayedRemote) send({ type: "wheel", deltaX: next.x, deltaY: next.y });
    });
  }, { passive: false });
  img.addEventListener("mousemove", e => { hooks.dt?.hoverRemote(pos(e)); const c = $("remoteCursor"); if (c) { const p = pos(e); const r = img.getBoundingClientRect(); const containerAspect = r.width / r.height; const imageAspect = VW / VH; let imgW, imgH, offsetX, offsetY; if (containerAspect > imageAspect) { imgH = r.height; imgW = r.height * imageAspect; offsetX = (r.width - imgW) / 2; offsetY = 0; } else { imgW = r.width; imgH = r.width / imageAspect; offsetX = 0; offsetY = (r.height - imgH) / 2; } c.style.left = (offsetX + p.x * imgW / VW) + "px"; c.style.top = (offsetY + p.y * imgH / VH) + "px"; c.style.opacity = "0.7"; } });
  img.addEventListener("mouseleave", () => { const c = $("remoteCursor"); if (c) c.style.opacity = "0"; });
  v.addEventListener("keydown", e => {
    if (e.key === "F12" || e.target !== v || e.isComposing || e.key === "Dead" || e.key === "Process") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
    e.preventDefault();
    if (e.key.length === 1 && !e.code && !e.ctrlKey && !e.metaKey && !e.altKey) send({ type: "type", text: e.key });
    else if (!["Control", "Meta", "Alt", "Shift"].includes(e.key)) {
      const key = [e.ctrlKey && "Control", e.metaKey && "Meta", e.altKey && "Alt", e.shiftKey && "Shift",
        /^(Key[A-Z]|Digit[0-9])$/.test(e.code) ? e.code : e.key === " " ? "Space" : e.key].filter(Boolean).join("+");
      send({ type: "key", key });
    }
  });
  v.addEventListener("paste", e => { const text = e.clipboardData?.getData("text/plain"); if (text != null) { e.preventDefault(); send({ type: "type", text }); } });
  v.addEventListener("compositionend", e => { if (e.data) send({ type: "type", text: e.data }); });
  return v;
}
function startRemoteFrames(t) {
  if (document.hidden || !isRemote(t) || t !== activeTab() || t.view !== "page") return;
  const id = t.browserSessionId;
  $("remoteSurface")?.classList.add("frame-active");
  if (displayedRemote !== id) {
    $("remoteImg").width = 1; $("remoteImg").height = 1; $("remoteImg").style.visibility = "hidden";
    $("remoteError").style.display = "none"; $("remoteLoading").style.display = "grid";
    displayedRemote = id;
  }
  remoteFrames?.start(id, t.sessionId, streamPreset(settings.streamQuality));
}
function showFrameForTab(t) {
  const remote = isRemote(t);
  const f = remote ? null : (t.url || frameFor(t) ? getOrCreateFrame(t) : null);
  qsa("#frameWrap .tab-frame").forEach(el => el.classList.toggle("frame-active", el === f));
  const surf = ensureRemoteSurface();
  surf.classList.toggle("frame-active", remote);
  if (!remote) clearRemoteSurface();
  if (remote) { startRemoteFrames(t); refreshRemote(t, true); }
  syncSplitFrames();
  setLoading(!!t.loading, 50, `Loading ${hostOf(t.url)}…`);
  loadRestoredTab(t);
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
function adoptSession(body, resumed = false) {
  const limit = Number(body.timeLimitMs) || 0;
  state.serverLimitMs = limit;
  state.session = { id: body.sessionId, startedAt: body.createdAt ? Date.parse(body.createdAt) : Date.now(), limitMs: limit, expiresAt: limit ? Date.now() + Number(body.remainingMs ?? limit) : Infinity, ephemeral: INCOGNITO || body.guest === true || !auth.user, controller: new AbortController() };
  if (!ephemeralSession()) save("veyra-live-session", { id: body.sessionId, startedAt: state.session.startedAt });
  state.lastUserActivity = Date.now(); state.sessionWarned = {};
  addLog("info", `Session ${body.sessionId.slice(0, 8)} ${resumed ? "revisited" : "started"}${limit ? ` (${fmtClock(Number(body.remainingMs ?? limit))} remaining)` : ""}.`);
  startSessionTimer(); startSessionHeartbeat();
  updateSessionPreferences({ silent: true }).catch(e => addLog("warn", `Could not apply session privacy preferences: ${e.message}`));
  hooks.onSessionChanged?.();
  return state.session;
}
async function startNewSession() {
  const body = await createSessionWithWake();
  adoptSession(body);
  if (settings.vpnAutoProfile) connectVpn(settings.vpnAutoProfile, { quiet: true }).catch(e => {

    settings.vpnAutoProfile = "";
    saveSettings();
    addLog("warn", `Automatic VPN was disabled: ${e.message}`);
  });
  return state.session;
}
function startSessionTimer() { clearInterval(state.sessionTimer); state.sessionTimer = setInterval(tickSession, 1000); tickSession(); }
function startSessionHeartbeat() {
  clearInterval(state.sessionHeartbeat);
  state.sessionHeartbeat = setInterval(async () => {
    const s = state.session;
    if (!s || document.visibilityState !== "visible" || Date.now() - state.lastUserActivity > 55000) return;
    try {
      const body = await api(`/api/session/${encodeURIComponent(s.id)}/heartbeat`, { method: "POST", timeoutMs: 8000 });
      if (body?.remainingMs != null && s.expiresAt !== Infinity) s.expiresAt = Date.now() + Number(body.remainingMs);
    } catch (e) { if (e.code !== "SESSION_EXPIRED") addLog("debug", `Session heartbeat skipped: ${e.message}`); }
  }, 20000);
}
function markUserActivity() { state.lastUserActivity = Date.now(); }
async function revisitSavedSession() {
  if (ephemeralSession()) return false;
  const saved = load("veyra-live-session", null);
  if (!saved?.id) return false;
  let body;
  try { body = await api(`/api/session/${encodeURIComponent(saved.id)}`, { timeoutMs: 8000 }); } catch { return false; }
  if (!body?.active || body.guest || body.incognito) { remove("veyra-live-session"); return false; }
  return await new Promise(resolve => {
    const overlay = $("sessionResumeOverlay"); if (!overlay) return resolve(false);
    $("sessionResumeText").textContent = `Session ${String(saved.id).slice(0, 8)}… is still available with ${body.remainingMs == null ? "no fixed time limit" : fmtClock(body.remainingMs)} remaining. Revisit it or start at home.`;
    overlay.classList.remove("hidden");
    const finish = async keep => {
      $("sessionResume").onclick = null; $("sessionDiscard").onclick = null; overlay.classList.add("hidden");
      if (keep) { adoptSession(body, true); resolve(true); return; }
      try { await api(`/api/session/${encodeURIComponent(saved.id)}/close`, { method: "POST", timeoutMs: 5000 }); } catch {}
      remove("veyra-live-session"); resolve(false);
    };
    $("sessionResume").onclick = () => finish(true);
    $("sessionDiscard").onclick = () => finish(false);
  });
}
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
  const clock = fmtClock(left);
  const tone = "session-pill " + (left <= 10000 ? "crit" : left <= 30000 ? "warn" : "live");
  if (txt.textContent !== clock) txt.textContent = clock;
  hooks.onSessionTickSettings?.(clock);
  if (pill.className !== tone) pill.className = tone;
  const title = `Session ends in ${clock}. Everything in it is deleted when the timer hits 0:00.`;
  if (pill.title !== title) pill.title = title;
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
  const ephemeral = ephemeralSession();
  state.sessionEnding = true;
  try {

    try { if (!ephemeral) await hooks.flushSync?.(); } catch (e) { addLog("warn", `Could not save account storage before session end: ${e.message}`); }
    state.session = null; clearInterval(state.sessionTimer); clearInterval(state.sessionHeartbeat);
    s.controller?.abort();

    const pageTabs = ephemeral ? state.tabs : state.tabs.filter(t => t.view === "page");
    const restoreUrls = ephemeral ? [] : [...new Set(pageTabs.map(t => t.url).filter(u => /^https?:\/\//.test(u)))];
    for (const t of pageTabs) { teardownTab(t); hooks.dt?.onTabClosed(t); }
    state.tabs = ephemeral ? [] : state.tabs.filter(t => t.view !== "page");
    if (!state.tabs.length) state.tabs.push(makeTab());
    if (!tabById(state.activeId)) state.activeId = state.tabs[0].id;
    state.closed = state.closed.filter(c => !c.url);
    if (ephemeral) {
      for (const controller of state.downloadControllers.values()) controller.abort();
      state.downloadControllers.clear();
      state.history = []; state.downloads = []; state.closed = []; state.tabGroups = [];
      state.splitScreen = { active: false, leftTabId: null, rightTabId: null };
      logs.length = 0; netLog.length = 0;
      closeFloating();
      clearNotifications();

      for (const id of ["searchInput", "historyFilter", "downloadsFilter", "findInput", "resFilter", "linkFilter", "consoleSearch", "omnibox"]) {
        const input = $(id); if (input) input.value = "";
      }
      for (const id of ["searchResults", "searchSuggestions", "searchCorrection", "searchStat", "searchMeta", "aiAnswer", "downloadsList", "historyList", "sourceCode", "resourcesList", "linksList", "consoleLines", "sidePanel", "popover", "mainMenu"]) {
        $(id)?.replaceChildren();
      }
    } else {
      if (settings.clearHistoryOnSessionEnd) { state.history = state.history.filter(h => h.sid !== s.id); saveHistory(); }
      remove("veyra-live-session");
    }
    state.capabilityCache.clear();
    state.vpn.connected = false; state.vpn.profile = null; state.vpn.info = null;
    let closeConfirmed = false;
    try { const closed = await api(`/api/session/${encodeURIComponent(s.id)}/close`, { method: "POST", timeoutMs: 5000 }); closeConfirmed = !!closed?.ok; } catch {}
    if (!ephemeral) addLog("info", `Session ${s.id.slice(0, 8)} ended (${reason}).`);
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

function looksLikeCalc(v) { return /[0-9]/.test(v) && /[+\-*/%^()]/.test(v) && /^[\d\s+\-*/%^().,]+$/.test(v); }
export function classify(input) {
  const v = String(input || "").trim(); if (!v) return null;
  const source = parseSourceUri(v);
  if (source) { const resolved = resolveSourceUri(v, API); return resolved ? { kind: "source", uri: resolved.uri, url: resolved.url } : { kind: "unsupported", value: v }; }
  const internal = v.match(/^veyra:\/\/([a-z-]+)(?:\/([a-z-]+))?/i);
  if (internal) {
    const name = internal[1].toLowerCase(), view = name === "console-labs" ? "console-lab" : name;
    if (["customize", "customise", "customization-studio"].includes(view)) return { kind: "internal", view: "settings", section: "appearance" };
    if (view === "performance" || view === "velocity") return { kind: "internal", view: "settings", section: "performance" };
    return Object.hasOwn(INTERNAL, view) ? { kind: "internal", view, section: view === "console-lab" ? "" : internal[2] || "" } : { kind: "search", query: v };
  }
  if (/^(?:javascript|data|blob|file|chrome|about):/i.test(v)) return { kind: "unsupported", value: v };
  if (/^https?:\/\//i.test(v)) return { kind: "url", url: v };
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(v)) return { kind: "url", url: "http://" + v };
  if (!/\s/.test(v) && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(v)) return { kind: "url", url: "https://" + v };
  if (looksLikeCalc(v)) return { kind: "calc", expression: v };
  return { kind: "search", query: v };
}
export async function go(input, { tab = null, push = true, newTab: inNew = false, activate = true } = {}) {
  const r = classify(input); if (!r) return;
  if (r.kind === "source") {
    if (inNew) return newTab({ url: r.url, displayUrl: r.uri, background: !activate });
    return navigate(r.url, { tab, push, activate, displayUrl: r.uri });
  }
  if (inNew) { if (interceptAccount(r.url, activeTab()?.url)) updateAddress(); else newTab({ url: input }); return; }
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
export async function navigate(url, { tab = null, push = true, pushHist = true, record = null, activate = true, displayUrl = "" } = {}) {
  if (interceptAccount(url, (tab || activeTab())?.url)) { updateAddress(); return; }
  url = normalizeYouTubeUrl(url);
  let t = tab || activeTab(); if (!t) return;
  if (t.view !== "page") { t.view = "page"; t.title = hostOf(url) || "Loading"; }
  if (activate) state.activeId = t.id;
  if (pushHist) pushTabHistory(t, url);
  if (!activate && t !== activeTab() && !frameFor(t) && !t.popupOf && t.browserMode === "FAST_PROXY"
      && performanceMode(settings.performanceMode) === "boost" && /^https?:\/\//i.test(url)) {
    Object.assign(t, { url, displayUrl: validateSourceDisplayUrl(displayUrl, url, API_ORIGIN), title: record?.title || hostOf(url),
      loading: false, needsInitialLoad: true, velocityState: "deferred", pendingNavigation: { record, displayUrl } });
    renderTabs();
    return;
  }
  if (!localPageKind(url)) sendNeuralFeedback(url, true, 0.5);
  await loadInTab(t, url, { loadFrame: true, record, displayUrl });
  if (push && activeTab() === t) syncRoute();
}
async function capability(url) {
  if (settings.runtime === "proxy") return "FAST_PROXY";
  if (settings.runtime === "crawler") return "FAST_PROXY";

  if (settings.runtime === "browser" || settings.runtime === "combined") return CHROMIUM_TRY_DISABLED ? "FAST_PROXY" : "BROWSER_ENGINE";
  if (ephemeralSession()) return "FAST_PROXY";
  const host = hostOf(url); const c = state.capabilityCache.get(host); if (c) return c;
  const session = state.session;
  try { const r = await api("/api/browser/capability", { json: { url, proxySessionId: session?.id }, timeoutMs: 12000 }); const m = r?.mode || "FAST_PROXY"; if (typeof r?.lean === "boolean") state.server.leanMode = r.lean; if (session && state.session === session) state.capabilityCache.set(host, m); return m; } catch { return "FAST_PROXY"; }
}
function desiredStrategy(url) {
  const r = String(settings.runtime || "auto");

  const degraded = CHROMIUM_TRY_DISABLED && (r === "browser" || r === "combined");
  if (degraded) return { key: "auto", proxy: true, crawler: true, browser: false, race: false, auto: true };
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
function inlineYouTubeAllowed() {
  return !INCOGNITO && !state.vpn.connected && settings.youtubeInline !== false;
}
hooks.disableInlineYouTube = () => {
  for (const t of state.tabs) {
    if (t.view === "page" && (t.localPage === "youtube" || t.youtubeInlineWatch)) {
      void loadInTab(t, t.url, { trackHistory: false });
    }
  }
};
async function serverAllowsInlineWatch(id) {
  try {
    const status = await api(`/api/media/youtube/${encodeURIComponent(id)}`, { timeoutMs: 5500 });
    return status?.inlineWatch === true && status.state === "ready";
  } catch { return false; }
}
function localPageKind(url, watchInline = false) {
  if (inlineYouTubeAllowed() && !watchInline && youtubeEmbedUrl(url)) return "youtube";
  return nowGameUrl(url) ? "now" : "";
}
function resolveStrategy(url) {
  const base = desiredStrategy(url);

  if (isYouTubeUrl(url)) {
    return { key: "browser", proxy: false, crawler: false, browser: true, race: false, forceBrowserHost: true };
  }

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
function tabDiagnosticsAllowed(t) {
  const split = state.splitScreen, current = activeTab();
  const visible = t === current || (split.active && [split.leftTabId, split.rightTabId].includes(t.id));
  const inspecting = current?.view === "console" || (["resources", "links", "dev"].includes(current?.view) && current.sourceTabId === t.id);
  return diagnosticsAllowed(performanceMode(settings.performanceMode), { hidden: document.hidden, visible, inspecting, focus: settings.gameFocus });
}
function syncBackgroundDiagnostics() {
  for (const t of state.tabs) {
    if (!tabDiagnosticsAllowed(t)) {
      if (t.poll) clearInterval(t.poll); t.poll = null;
      if (t.crawlerStartTimer) clearTimeout(t.crawlerStartTimer); t.crawlerStartTimer = null;
    } else {
      if (t.queuedCrawler) armCrawler(t);
      if (t.jobId && !t.done && !t.poll) startPolling(t);
    }
  }
}
function scheduleDeferredCrawler(t, url, session, enabled = true, delayMs = 450) {
  if (!enabled || !session?.id || ephemeralSession()) return;
  if (t.jobId || t.queuedCrawler || t.crawlToken || t.needsInitialLoad) return;
  t.queuedCrawler = { url, session, delayMs };
  armCrawler(t);
}
function armCrawler(t) {
  if (t.crawlerStartTimer || !tabDiagnosticsAllowed(t)) return;
  const queued = t.queuedCrawler;
  t.crawlerStartTimer = setTimeout(() => {
    t.crawlerStartTimer = null;
    if (!tabDiagnosticsAllowed(t) || t.queuedCrawler !== queued) return;
    t.queuedCrawler = null;
    if (!state.tabs.includes(t) || t.view !== "page" || t.url !== queued.url || t.jobId) return;
    void openCrawl(t, queued.url, queued.session);
  }, Math.max(150, Number(queued.delayMs) || 450));
}
function openCrawl(t, url, session, enabled = true) {
  if (!enabled || ephemeralSession() || state.session !== session) return Promise.resolve(null);
  const engineMode = t.loadStrategy || settings.runtime || "auto";
  const token = {}; t.crawlToken = token;
  return api("/api/open", { json: { url, sessionId: session.id, engineMode } }).then(b => {
    if (!state.tabs.includes(t) || t.url !== url || t.crawlToken !== token) { if (b?.jobId) stopJob(b.jobId); return null; }
    t.jobId = b?.jobId || null;
    t.done = b?.state === "cached" || !t.jobId;
    if (t.jobId) startPolling(t);
    return b;
  }).catch(e => {
    if (e.code !== "SESSION_EXPIRED") addLog("debug", `Background index skipped: ${e.message}`);
    return null;
  }).finally(() => { if (t.crawlToken === token) t.crawlToken = null; });
}
async function loadInTab(t, url, { loadFrame = true, record = null, forceBrowser = false, displayUrl = "", trackHistory = true } = {}) {
  t.needsInitialLoad = false;
  t.velocityState = ""; t.pendingNavigation = null; t.queuedCrawler = null; t.crawlToken = null;
  if (interceptAccount(url, t.url)) return;
  url = normalizeYouTubeUrl(url);
  resetPlaybackHandoff(t, url);
  const load = t.pageLoad = Symbol();
  const current = () => state.tabs.includes(t) && t.view === "page" && t.pageLoad === load && t.url === url;
  const previousUrl = t.url;
  if (previousUrl !== url) t.escapeRecoveries = 0;
  if (t.localPage || t.youtubeInlineWatch || frameFor(t)?.hasAttribute("data-site-error")) frameFor(t)?.remove();
  t.sourceDisplayAliases ||= new Map();
  const suppliedDisplayUrl = isYouTubeUrl(url) ? "" : validateSourceDisplayUrl(displayUrl, url, API_ORIGIN);
  if (suppliedDisplayUrl) t.sourceDisplayAliases.set(url, suppliedDisplayUrl);
  const resolvedDisplayUrl = suppliedDisplayUrl || t.sourceDisplayAliases.get(url) || (t.url === url ? validateSourceDisplayUrl(t.displayUrl, url, API_ORIGIN) : "");
  if (settings.autoStopPrevious && t.jobId && !t.done) stopJob(t.jobId).catch(() => {});
  if (t.poll) clearInterval(t.poll); t.poll = null; clearTimeout(t.browserPoll); clearTimeout(t.loadGuard); clearTimeout(t.crawlerStartTimer); clearTimeout(t.combinedGraceTimer); t.crawlerStartTimer = null; t.combinedGraceTimer = null;
  Object.assign(t, { url, displayUrl: resolvedDisplayUrl, view: "page", title: t.title && t.url && hostOf(t.url) === hostOf(url) ? t.title : hostOf(url), jobId: null, done: false, resources: [], links: [], selectedResource: -1, remoteLogIds: new Set(), readerOpen: false, requiresBrowser: false, youtubeEmbed: false, localPage: "", loading: true, browserStatus: "", loadStrategy: settings.runtime || "auto", renderWinner: "", challengeEscalated: false, wasVerifying: false, challengeReturned: false });
  if (!settings.preserveLog) { t.console = []; t.network = []; }
  rejectTab(t.id); hooks.dt?.onNavigate(t);
  const active = activeTab() === t;
  const watchId = loadFrame ? youtubeWatchId(url) : "";
  const watchInline = !!(watchId && !forceBrowser && inlineYouTubeAllowed()
    && await serverAllowsInlineWatch(watchId) && inlineYouTubeAllowed());
  if (!current()) return;
  t.youtubeInlineWatch = watchInline;
  if (watchInline && t.browserSessionId) void stopBrowserSession(t);
  const direct = loadFrame && !(forceBrowser && watchId) && localPageKind(url, watchInline);
  if (direct) {
    frameFor(t)?.remove();
    if (t.browserSessionId) void stopBrowserSession(t);
    Object.assign(t, {
      localPage: direct, youtubeEmbed: direct === "youtube", browserMode: "LOCAL", renderWinner: "local",
      failoverReason: null, sessionId: null, title: record?.title || (direct === "youtube" ? "YouTube" : "now.gg"), loading: false, done: true
    });
    const frame = getOrCreateFrame(t);
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    if (direct === "youtube") frame.setAttribute("allow", "encrypted-media; fullscreen; picture-in-picture");
    else frame.removeAttribute("allow");
    frame.srcdoc = direct === "youtube" ? youtubeFallbackHtml(url) : nowGameMarkup(url);
    if (trackHistory) recordHistory(record?.kind || "page", url, t.title, null);
    if (active) renderActive({ push: false });
    renderTabsSoon();
    return;
  }
  if (active) { renderActive({ push: false }); setLoading(true, 10, "Starting a clean session…"); }
  let session;
  try { session = await ensureSession(); }
  catch (e) { if (current()) return renderError(t, "server", e); return; }

  if (!current()) return;
  if (loadFrame) await ensureApiAwake(msg => { if (current() && activeTab() === t) setLoading(true, 18, msg); });
  if (!current()) return;
  t.sessionId = session.id;
  if (trackHistory) recordHistory(record?.kind || "page", url, record?.title || hostOf(url), session.id);
  let strategy = forceBrowser ? { key: "browser", proxy: false, crawler: false, browser: true, race: false }
    : watchInline ? { key: "proxy", proxy: true, crawler: false, browser: false, race: false } : resolveStrategy(url);
  if (strategy.forceBrowserHost && !(await serverChromiumAvailable())) {
    strategy = { ...strategy, key: "proxy", proxy: true, crawler: false, browser: false, race: false, auto: false, forceBrowserHost: false };
    addLog("info", `${hostOf(url)} will use the full FAST_PROXY page because this server has Chromium disabled.`);
  }
  if (!current()) return;
  t.loadStrategy = strategy.key;
  if (strategy.googleSearchFallback) {
    let q = ""; try { q = new URL(url).searchParams.get("q") || ""; } catch {}
    showSearch(q, { tab: t, push: false, pushHist: false, source: "web", engine: "google" });
    return;
  }
  t.done = true;
  if (activeTab() === t) setLoading(true, 24, strategy.race ? "Starting fast page pipeline…" : strategy.browser ? "Starting Chromium…" : strategy.crawler ? "Loading page + warming required assets…" : "Loading through the fast proxy…");

  const switchToFastProxy = (tab, targetUrl, sess, reason) => {
    if (!current()) return;
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
      setFrameSrc(f, proxyUrl(targetUrl, "view", sess.id, state.tabs.find(tt => tt === tab)?.previousUrl), tab);
      if (activeTab() === tab) showFrameForTab(tab);
    }
    tab.loading = false; clearTimeout(tab.loadGuard);
    if (activeTab() === tab) setLoading(false);
    renderTabsSoon();
  };

  const useProxy = async () => {
    if (!loadFrame || !current()) return;
    t.browserMode = "FAST_PROXY";
    const f = getOrCreateFrame(t);
    f.removeAttribute("srcdoc");

    t.youtubeEmbed = false;
    f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    f.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture");
    const src = proxyUrl(url, "view", session.id, previousUrl);
    setFrameSrc(f, watchInline && inlineYouTubeAllowed() ? `${src}&__veyra_youtube_inline=1` : src, t);
    if (activeTab() === t) showFrameForTab(t);

    if (isYouTubeUrl(url)) setTimeout(() => {

      if (current() && t.browserMode === "FAST_PROXY" && t.loading) {
        t.loading = false;
        if (activeTab() === t) setLoading(false);
        renderTabsSoon();
      }
    }, 3500);
  };

  const raceChromium = () => startBrowserSession(t, url, { background: true }).then(result => {
      if (!current() || result?.stale) return;
      if (result?.ok === false) {
        if (t.requiresBrowser) {
          t.failoverReason = result.reason || "chromium_unavailable";
          t.requiresBrowser = false;
          return switchToFastProxy(t, url, session, t.failoverReason);
        }
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
    }).catch(e => {
      if (e.code === "SESSION_EXPIRED") return;
      if (current() && t.requiresBrowser) {
        t.failoverReason = e.code || "chromium_unavailable";
        t.requiresBrowser = false;
        switchToFastProxy(t, url, session, t.failoverReason);
        return;
      }
      addLog("debug", `Combined Chromium path unavailable: ${e.message}`);
    });

  if (strategy.race) {

    if (strategy.forceBrowserHost) {
      t.loadStrategy = "browser"; t.renderWinner = ""; t.requiresBrowser = true;

      if (loadFrame) {
        t.browserMode = "FAST_PROXY";
        const f = getOrCreateFrame(t);
        f.removeAttribute("srcdoc");
        f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        f.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture");
        setFrameSrc(f, proxyUrl(url, "view", session.id, previousUrl), t);
        if (activeTab() === t) showFrameForTab(t);
      }
      void raceChromium();

      const softTimeoutMs = state.server.leanMode ? 12000 : 25000;
      t.loadGuard = setTimeout(() => {
        if (!t.renderWinner && t.url === url && state.tabs.includes(t)) {
          if (!t.browserSessionId) {
            if (t.requiresBrowser) {
              t.failoverReason = "chromium_timeout";
              t.requiresBrowser = false;
              switchToFastProxy(t, url, session, "chromium_timeout");
            } else {
              switchToFastProxy(t, url, session, "chromium_timeout");
            }
          } else {
            t.loading = false; if (activeTab() === t) setLoading(false); renderTabsSoon();
          }
        }
      }, softTimeoutMs);
      return renderTabs();
    }

    await useProxy();
    if (!current()) return;
    if (state.server.leanMode && !strategy.forceBrowserHost) {
      scheduleDeferredCrawler(t, url, session, true, 150);

      t.combinedGraceTimer = setTimeout(() => {
        t.combinedGraceTimer = null;
        if (!current() || t.browserSessionId || t.renderWinner === "browser") return;
        capability(url).then(mode => {
          if (!current() || t.browserSessionId || t.renderWinner === "browser") return;
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
      if (!current() || result?.stale) return;
      if (result?.ok === false) {

        addLog("info", `Chromium failover for ${hostOf(url)}: ${result.reason}. Using fast proxy.`);
      } else {
        t.renderWinner = "browser";
        renderTabs();
        return;
      }
    } catch (e) {
      if (e.code === "SESSION_EXPIRED") return;
      if (!current()) return;
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
        t.requiresBrowser = false;
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
  if (!current()) return;

  if (strategy.accelerate) scheduleDeferredCrawler(t, url, session, true, 150);
  if (strategy.probe) {
    capability(url).then(mode => {
      if (!current()) return;
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

  if (INCOGNITO) return;
  if (!url) return; const prev = state.history[0];
  if (prev && prev.url === url) { prev.time = new Date().toISOString(); if (title) prev.title = title; saveHistory(); return; }
  state.history.unshift({ id: uid(), time: new Date().toISOString(), kind, url, title: String(title || hostOf(url) || url).slice(0, 240), sid });
  if (state.history.length > (settings.historyMax || 1000)) state.history.length = settings.historyMax || 1000;
  saveHistory();
}
let dismissSiteRecovery;
function showSiteRecovery(t = activeTab(), reason = "") {
  const url = t?.view === "page" ? originalSiteUrl(t.url) : "";
  if (!url || activeTab() !== t) return;
  if (showAccountOptions(url)) return;
  const target = new URL(url);
  dismissSiteRecovery?.(true);
  dismissSiteRecovery = toast([reason, DIRECT_SITE_NOTICE].filter(Boolean).join(" "), {
    title: `Site options: ${target.host}`, ms: 0,
    actions: [
      { label: "Retry in Veyra", onClick: () => {
        if (activeTab() !== t || t.view !== "page" || originalSiteUrl(t.url) !== url) return;
        t.escapeRecoveries = 0;
        void reload({ hard: true });
      } },
      { label: "Open original site", href: url, primary: true }
    ]
  });
  if (!reason && dismissSiteRecovery) $("toasts")?.querySelector("section:last-child .toast-action")?.focus({ preventScroll: true });
}
function renderError(t, kind, error) {
  t.view = "page"; t.loading = false;
  if (t.browserSessionId) void stopBrowserSession(t);
  t.browserMode = "FAST_PROXY";
  const titles = { server: "Veyra couldn't reach its server", unsupported: "This page can't be opened in Veyra", invalid: "That address isn't valid" };
  frameFor(t)?.remove();
  const f = getOrCreateFrame(t);
  f.setAttribute("data-site-error", "");
  f.setAttribute("sandbox", "allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  f.removeAttribute("allow");
  f.srcdoc = siteLoadErrorMarkup(titles[kind] || "The page could not be displayed", error, t.url);
  f.addEventListener("load", () => {
    f.contentDocument?.getElementById("veyra-local-retry")?.addEventListener("click", () => {
      if (frameFor(t) !== f || !state.tabs.includes(t)) return;
      t.escapeRecoveries = 0;
      if (activeTab() !== t) switchTab(t.id);
      void reload();
    });
  }, { once: true });
  if (activeTab() === t) { showFrameForTab(t); setLoading(false); }
  addLog("error", `Open failed: ${error?.message}`, { requestId: error?.requestId });
}

function startPolling(t) { if (t.poll) clearInterval(t.poll); t.poll = null; if (!tabDiagnosticsAllowed(t)) return; pollJob(t); t.poll = setInterval(() => pollJob(t), 1200); }
async function pollJob(t) {
  if (!state.tabs.includes(t) || !t.jobId) { if (t.poll) clearInterval(t.poll); return; }
  if (t.pollInFlight || !tabDiagnosticsAllowed(t)) return;
  const jobId = t.jobId;
  t.pollInFlight = true;
  try {
    const b = await api(`/api/crawl/${encodeURIComponent(jobId)}`, { timeoutMs: 8000 });
    if (t.jobId !== jobId || !state.tabs.includes(t)) return;
    for (const x of b.logs || []) { if (t.remoteLogIds.has(x.id)) continue; t.remoteLogIds.add(x.id); logs.push({ time: new Date(x.time).getTime(), level: x.level, message: `[${hostOf(t.url)}] ${x.message}` }); }
    if (activeTab()?.view === "console") renderConsole();
    if (b.done) { clearInterval(t.poll); t.poll = null; t.done = true; await Promise.all([loadResources(t), loadLinks(t)]); }
  } catch (e) { if (t.jobId === jobId && (e.status === 404 || e.code === "SESSION_EXPIRED")) { clearInterval(t.poll); t.poll = null; } }
  finally { t.pollInFlight = false; }
}
async function stopJob(id) { try { await api(`/api/crawl/${encodeURIComponent(id)}/stop`, { method: "POST" }); } catch {} }
async function loadResources(t) { if (!t?.jobId) return; try { const b = await api(`/api/crawl/${encodeURIComponent(t.jobId)}/resources`); t.resources = b.resources || []; if (activeTab()?.view === "resources") renderResources(); } catch {} }
async function loadLinks(t) { if (!t?.jobId) return; try { const b = await api(`/api/crawl/${encodeURIComponent(t.jobId)}/links?offset=0&limit=2000`); t.links = b.links || []; if (activeTab()?.view === "links") renderLinks(); } catch {} }

async function refreshRemote(t, loop = false) {
  if (!t?.browserSessionId || activeTab() !== t || t.view !== "page" || document.hidden) return;
  const expectedId = t.browserSessionId;
  if (t.remoteStatusInFlight === expectedId) return;
  clearTimeout(t.browserPoll);
  t.remoteStatusInFlight = expectedId;
  try {
    const r = await api(`/api/browser/session/${encodeURIComponent(expectedId)}?summary=1`, { timeoutMs: 8000 });
    if (t.browserSessionId !== expectedId) return;
    const s = r.session; const prev = t.url; t.lastBrowserUse = Date.now();
    const next = canonical(s.canonicalUrl);
    if (next && next !== prev && localPageKind(next)) {
      void navigate(next, { tab: t, push: false, activate: false, record: { title: s.title } });
      return;
    }
    if (!t.youtubeEmbed) t.url = s.canonicalUrl || t.url;
    t.title = s.title || hostOf(t.url); t.browserStatus = s.status; t.loading = false;
    if (t.url && prev && t.url !== prev) { pushTabHistory(t, t.url); recordHistory("page", t.url, t.title); }

    if (t.challengeEscalated && s.status === "VERIFICATION_REQUIRED") t.wasVerifying = true;
    else if (t.wasVerifying && s.status === "NORMAL" && !t.challengeReturned) {
      if (hostOf(s.canonicalUrl || t.url) !== hostOf(t.url)) {
        t.wasVerifying = false;
      } else {
        t.challengeReturned = true;
        const backUrl = t.url;
        addLog("info", `Security check completed on ${hostOf(backUrl)}; returning the tab to the fast proxy.`);
        toast("Verification complete — back on the fast proxy", { ms: 4000 });
        void (async () => {
          await stopBrowserSession(t);
          t.challengeEscalated = false; t.wasVerifying = false;
          if (state.tabs.includes(t) && t.view === "page") await loadInTab(t, backUrl);
        })();
        return;
      }
    }
    if (activeTab() === t && t.view === "page") {
      setLoading(false); updateAddress(); updateIdentity();
      if (s.status === "VERIFICATION_REQUIRED") $("statusLeft").textContent = "Site robot check detected. Complete it in the page, or use Reload to start a clean Chromium session.";
      else if (s.status === "BROWSER_ERROR" || s.status === "CRASHED" || s.status === "ERROR") {
        const er = $("remoteError"), erT = $("remoteErrorText");
        if (er) er.style.display = "grid";
        if (erT) erT.textContent = s.lastError || s.error || "The browser session encountered an error.";
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
      if (displayedRemote === expectedId) clearRemoteSurface();
      if (state.tabs.includes(t) && t.view === "page" && t.url && t.sessionId && state.session?.id === t.sessionId) {
        const f = getOrCreateFrame(t);
        f.removeAttribute("srcdoc");
        setFrameSrc(f, proxyUrl(t.url, "view", t.sessionId), t);
        t.renderWinner = "proxy";
        if (activeTab() === t) showFrameForTab(t);
      } else if (activeTab() === t) {
        renderTabsSoon();
        updateIdentity();
      }
      return;
    }
  } finally {
    if (t.remoteStatusInFlight === expectedId) t.remoteStatusInFlight = null;
    if (loop && t.browserSessionId === expectedId && activeTab() === t && t.view === "page" && !document.hidden) {
      t.browserPoll = setTimeout(() => refreshRemote(t, true), 1500);
    }
  }
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

function startBrowserSession(t, url, options = {}) {
  const load = t.pageLoad;
  const current = () => state.tabs.includes(t) && t.view === "page" && !t.localPage && t.pageLoad === load && t.url === url;
  const previous = t.browserStart;
  const start = async () => {
    if (!current()) return { stale: true };
    return openBrowserSession(t, url, options, current);
  };
  const task = (previous ? previous.catch(() => {}).then(start) : start()).finally(() => {
    if (t.browserStart === task) t.browserStart = null;
  });
  t.browserStart = task;
  return task;
}
async function openBrowserSession(t, url, { background = false }, current) {
  const sid = state.session?.id || "";

  const browserUrl = url;
  if (t.browserSessionId) {
    try {
      const b = await api(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}/navigate`, { json: { url: browserUrl, fastStart: !!background }, timeoutMs: 45000 });
      if (!current()) return { stale: true };
      t.browserMode = "BROWSER_ENGINE"; t.youtubeEmbed = false; t.url = url || b.session.canonicalUrl || url;
      if (!background) { t.loading = false; if (activeTab() === t) showFrameForTab(t); }
      else if (!t.renderWinner) t.browserStatus = b.session.status || "ready";
      return { ok: true };
    } catch (e) { if (!current()) return { stale: true }; if (e.code !== "BROWSER_SESSION_NOT_FOUND") { await stopBrowserSession(t); throw e; } t.browserSessionId = ""; }
  }
  let b;
  try {
    b = await api("/api/browser/session", { json: { tabId: t.id, url: browserUrl, proxySessionId: sid, fastStart: !!background }, timeoutMs: 45000 });
  } catch (e) {
    if (!current()) return { stale: true };

    if (e.fallbackMode === "FAST_PROXY" || e.code === "BROWSER_FAILOVER") {
      t.browserMode = "FAST_PROXY"; t.failoverReason = e.reason || "breaker_open"; t.failoverRetryAfterMs = e.retryAfterMs || 60000;
      addLog("info", `Chromium in cooldown — using fast proxy. ${e.error || ""}`);
      if (activeTab() === t) renderTabs();
      return { ok: false, fallback: true, reason: e.reason || "breaker_open" };
    }
    if (e.code !== "BROWSER_CAPACITY" || !releaseInactiveBrowserSlot(t)) throw e;

    await new Promise(r => setTimeout(r, 150));
    if (!current()) return { stale: true };
    try {
      b = await api("/api/browser/session", { json: { tabId: t.id, url: browserUrl, proxySessionId: sid, fastStart: !!background }, timeoutMs: 45000 });
    } catch (e2) {
      if (!current()) return { stale: true };
      if (e2.fallbackMode === "FAST_PROXY" || e2.code === "BROWSER_FAILOVER") {
        t.browserMode = "FAST_PROXY"; t.failoverReason = e2.reason || "breaker_open"; t.failoverRetryAfterMs = e2.retryAfterMs || 60000;
        addLog("info", `Chromium in cooldown — using fast proxy. ${e2.error || ""}`);
        if (activeTab() === t) renderTabs();
        return { ok: false, fallback: true, reason: e2.reason || "breaker_open" };
      }
      throw e2;
    }
  }
  if (!current()) {
    if (b.session.id !== t.browserSessionId) {
      try { await api(`/api/browser/session/${encodeURIComponent(b.session.id)}`, { method: "DELETE", timeoutMs: 5000 }); } catch {}
    }
    return { stale: true };
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
  const t = activeTab(); if (!t || t.view !== "page" || !t.url || t.localPage) return;
  const sid = state.session?.id || "";
  try { await api("/api/browser/retry", { json: { proxySessionId: sid }, timeoutMs: 10000 }); }
  catch {}
  t.failoverReason = null; t.failoverRetryAfterMs = 0;
  t.browserMode = "FAST_PROXY";
  void startBrowserSession(t, t.url, { background: false }).catch(() => {});
  renderTabs();
}
async function remoteHistory(t, direction) { try { await api(`/api/browser/session/${encodeURIComponent(t.browserSessionId)}/history`, { json: { direction } }); remoteFrames?.refresh(t.browserSessionId); await refreshRemote(t, true); return true; } catch { return false; } }

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
  const search = readSearchState(e);
  if (search) return showSearch(search.query, { tab: t, pushHist: false, source: search.source });
  if (e.startsWith("veyra:")) { const [view, section] = e.slice(6).split("/"); const idx = t.histIndex; openInternal(view, { tab: t, section }); t.histIndex = idx; t.history.length = Math.max(t.history.length, idx + 1); updateNavButtons(); return; }
  await navigate(e, { tab: t, pushHist: false });
}
export async function reload({ hard = false } = {}) {
  const t = activeTab(); if (!t) return;
  if ($("reloadBtn").dataset.loading === "1" && !hard) return stopLoad();
  if (t.view === "page" && t.url) {
    playbackHandoffs.delete(t);

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
  if (t.view === "console-lab") { $("view-console-lab")?.replaceChildren(); return renderConsoleLabEntry(); }
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
  t.searchRequest?.abort(); t.searchAnswerRequest?.abort();
  query = query.trim().slice(0, 600);
  Object.assign(t, { view: "search", title: query ? `${query} - Veyra Search` : "Veyra Search", url: "", favicon: "", searchQuery: query, searchData: null, searchCorrection: null, searchAnswer: null, searchLoading: !!query, searchError: "", loading: false, browserSessionId: "", searchSource: searchCategory(source || t.searchSource || settings.searchSource), searchEngine: engine || (settings.searchEngine === "google" ? "google" : "") });
  if (pushHist) pushTabHistory(t, searchStateKey(query, t.searchSource));
  if (query) recordHistory("search", `veyra://search?q=${encodeURIComponent(query)}`, `${query} - Veyra Search`);
  renderTabs(); renderActive({ push });
  if (query) runSearch(query, 0, { tab: t });
}
const PROVIDER_LABEL = { google: "Google API", duckduckgo: "DuckDuckGo", bing: "Bing", local: "Veyra index", brave: "Brave Search API", none: "no provider" };
async function runSearch(query, offset = 0, opts = {}) {
  const t = opts.tab || activeTab(); if (!t || t.view !== "search") return;
  const source = searchCategory(t.searchSource), vertical = isVertical(source);
  if (t.searchRequest && !offset) t.searchRequest.abort();
  const request = t.searchRequest = new AbortController();
  const lang = (navigator.language || "en").slice(0, 2);
  const current = () => t.view === "search" && t.searchQuery === query && t.searchSource === source && t.searchRequest === request && !request.signal.aborted;
  const visible = () => current() && activeTab() === t;
  const scope = siteScope(query);
  let signal = request.signal;
  t.searchQuery = query;
  t.searchLoading = !!query;
  t.searchError = "";
  if (!offset) {
    t.searchAnswerRequest?.abort();
    Object.assign(t, { searchData: null, searchAnswer: null, searchCorrection: null });
    if (visible()) $("view-search").scrollTop = 0;
  }
  if (visible()) renderSearch();
  if (!query) return;
  try {
    if (ephemeralSession()) {
      const session = await ensureSession();
      signal = AbortSignal.any ? AbortSignal.any([signal, session.controller.signal]) : signal;
      if (!current()) return;
    }
    if (!offset && !opts.corrected && !scope.active) {
      void api(`/api/search/correct?q=${encodeURIComponent(query)}`, { timeoutMs: 3500, signal }).then(correction => {
        if (!current() || !correction.changed || typeof correction.corrected !== "string" || correction.corrected.toLowerCase() === query.toLowerCase()) return;
        t.searchCorrection = correction.corrected.slice(0, 600);
        if (visible()) renderSearchCorrection(t);
      }).catch(() => {});
    }
    const b = scope.invalid ? { provider: "none", results: [], siteFilter: { invalid: true }, more: false } : vertical
      ? await api(`/api/search/vertical?${searchParams(query, source, lang, offset, t.searchData?.provider)}`, { timeoutMs: 11500, signal })
      : source === "web"
      ? await api(`/api/search/web?q=${encodeURIComponent(query)}&offset=${offset}${t.searchEngine ? `&engine=${encodeURIComponent(t.searchEngine)}` : ""}&lang=${encodeURIComponent(lang)}`, { timeoutMs: 20000, signal })
      : await api(`/api/search?q=${encodeURIComponent(query)}&offset=${offset}&limit=10`, { signal });
    if (!current()) return;
    b.source = source;
    const rows = b.results || [];
    b.results = rows.filter(row => resultUrl(row?.url) && scopedUrl(scope, row.sourcePageUrl || row.url) && (!row.canonicalUrl || scopedUrl(scope, row.canonicalUrl)));
    if (scope.active && !vertical) {
      b.siteFilter ||= scope;
      if (source === "index" || (b.more && !Number.isInteger(b.nextOffset))) b.nextOffset = rows.length ? offset + rows.length : null;
      if (!(b.nextOffset > offset) || (source === "web" && b.nextOffset >= 60) || (source === "index" && b.total != null && b.nextOffset >= b.total)) b.nextOffset = null;
    }
    if (offset && b.status === "unavailable") throw new Error("The result provider is temporarily unavailable.");
    t.searchData = offset && t.searchData ? { ...b, results: mergeResults(t.searchData.results, b.results) } : b;
    t.searchLoading = false;
    if (visible()) renderSearch();
    if (!vertical && !ephemeralSession() && !offset && b.results.length) void fetchAIAnswer(t);
  } catch (e) {
    if (!current()) return;
    t.searchLoading = false;
    if (!offset) t.searchError = vertical && e.status === 404 ? "This category is not enabled on the connected Veyra server yet." : e.message;
    else if (visible()) toast("Could not load more search results. Try again.", { kind: "warn" });
    if (visible()) renderSearch();
  }
}
async function fetchAIAnswer(t) {
  if (ephemeralSession() || t.searchAnswer?.status === "loading") return;
  const { searchQuery: query, searchSource: source, searchData } = t;
  const vertical = isVertical(source) ? source : "";
  const request = t.searchAnswerRequest = new AbortController();
  const current = () => t.view === "search" && t.searchQuery === query && t.searchSource === source && t.searchAnswerRequest === request && !request.signal.aborted && !ephemeralSession();
  t.searchAnswer = { status: "loading" };
  if (activeTab() === t) renderAIAnswer(t);
  try {
    const r = await api("/api/search/answer", { json: vertical ? { query, vertical, lang: (navigator.language || "en").slice(0, 2) } : { query, source, results: searchData.results.slice(0, 12).map(r => ({ url: r.url, title: r.title, snippet: r.snippet })) }, timeoutMs: vertical ? 35000 : 20000, signal: request.signal });
    if (!current()) return;
    t.searchAnswer = { status: "done", response: r || {} };
  } catch (error) {
    if (!current()) return;
    t.searchAnswer = { status: "error", error: String(error?.message || "Veyra could not contact the answer service.").slice(0, 220) };
  }
  if (activeTab() === t) renderAIAnswer(t);
}
function renderAIAnswer(t) {
  const ai = $("aiAnswer"), source = t.searchSource, query = t.searchQuery, answer = t.searchAnswer;
  const badge = `<span class="ai-badge">${searchIcon("i-bolt")} Veyra AI</span>`;
  if (ephemeralSession() || (!answer && !(isVertical(source) && t.searchData?.results?.length))) { ai.classList.add("hidden"); ai.replaceChildren(); return; }
  ai.classList.remove("hidden");
  if (!answer || answer.status === "loading" || answer.status === "error") {
    const detail = !answer ? `<p>Ask Veyra to summarize the readable source pages behind these results.</p><button class="btn ghost sm" type="button" id="searchSummarize">Summarize ${esc(CATEGORIES[source].label.toLowerCase())} sources</button>`
      : answer.status === "loading" ? `<div class="spinner" aria-label="Loading"></div>` : `<p>${esc(answer.error)}</p><button class="btn ghost sm" type="button" id="searchSummarize">Try summary again</button>`;
    ai.innerHTML = `<div class="ai-answer-card"><div class="ai-answer-header">${badge}<span class="ai-thinking">${!answer ? "Source overview" : answer.status === "loading" ? "Reading source pages…" : "Summary service unavailable"}</span></div><div class="ai-answer-body">${detail}</div></div>`;
    $("searchSummarize")?.addEventListener("click", () => void fetchAIAnswer(t));
    return;
  }
    const r = answer.response;
    const scope = siteScope(query);
    if (r.hasAnswer && !unsafeAiText(r.answer) && !(r.sources || []).some(row => !resultUrl(row.url) || !scopedUrl(scope, row.url) || (row.canonicalUrl && !scopedUrl(scope, row.canonicalUrl)))) {
      const caveats = (r.caveats || []).filter(p => p && !unsafeAiText(p)).slice(0, 3);
      const feedbackId = /^obs_[A-Za-z0-9_-]{20,40}$/.test(String(r.observationId || "")) ? r.observationId : "";
      ai.innerHTML = `<div class="ai-answer-card"><div class="ai-answer-header"><span class="ai-badge"><svg width="16" height="16"><use href="#i-bolt"/></svg> Veyra AI</span><span class="muted small">${esc(r.intent || "answer")} · ${r.sourceCount || r.sources?.length || 0} sources · ${esc(r.confidenceLabel || "Evidence quality")}</span></div><div class="ai-answer-body">${renderAnswerWithSourceLogos(r.answer, query, r.sources || [])}${caveats.length ? `<div class="ai-caveats"><b>Keep in mind</b><ul>${caveats.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}</div>${r.sources?.length ? `<div class="ai-answer-sources" aria-label="Sources">${r.sources.map(s => `<a class="ai-source-chip" href="${esc(s.url)}" data-open="${esc(s.url)}" title="${esc(s.title || displayUrl(s.url))}" aria-label="Open ${esc(s.title || displayUrl(s.url))}"><img src="${esc(sourceFaviconUrl(s.url))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'"><span>${esc(hostOf(s.url))}</span></a>`).join("")}</div>` : ""}${feedbackId ? `<div class="ai-answer-feedback"><span>Was this summary helpful?</span><button class="btn ghost sm" type="button" data-ai-feedback="helpful">Helpful</button><button class="btn ghost sm" type="button" data-ai-feedback="unhelpful">Not helpful</button><span class="ai-feedback-status" data-ai-feedback-status aria-live="polite"></span></div>` : ""}</div>`;
      wireSearchLinks(ai);
      ai.querySelectorAll("[data-ai-feedback]").forEach(button => button.addEventListener("click", async () => {
        const buttons = [...ai.querySelectorAll("[data-ai-feedback]")], status = ai.querySelector("[data-ai-feedback-status]");
        buttons.forEach(item => { item.disabled = true; }); if (status) status.textContent = "Saving feedback…";
        try {
          await api("/api/search/answer/feedback", { json: { observationId: feedbackId, rating: button.dataset.aiFeedback }, timeoutMs: 8000 });
          answer.feedback = true;
          if (status) status.textContent = "Thanks. Your feedback helps tune answer quality.";
        } catch (error) {
          buttons.forEach(item => { item.disabled = false; });
          if (status) status.textContent = `Feedback was not saved: ${String(error?.message || "please try again").slice(0, 120)}`;
        }
      }));
      if (answer.feedback) {
        ai.querySelectorAll("[data-ai-feedback]").forEach(button => { button.disabled = true; });
        ai.querySelector("[data-ai-feedback-status]").textContent = "Feedback saved.";
      }
    } else {
      const configured = r.code !== "AI_MODEL_NOT_CONFIGURED";
      const title = configured ? "No safe summary returned" : "AI summaries are not configured yet";
      const reason = unsafeAiText(r.reason) ? "The server could not produce a verified summary." : (r.reason || "The server did not return a grounded summary.");
      ai.innerHTML = `<div class="ai-answer-card"><div class="ai-answer-header"><span class="ai-badge"><svg width="16" height="16"><use href="#i-bolt"/></svg> Veyra AI</span><span class="ai-thinking">Summary status</span></div><div class="ai-answer-body ai-answer-unavailable"><b>${esc(title)}</b><p>${esc(reason)}</p><span>Search results are still available below. Veyra will not substitute copied source passages for an original, grounded summary.</span></div></div>`;
    }
}
function sourceFaviconUrl(url) {
  try { return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(new URL(url).hostname)}.ico`; } catch { return ""; }
}
function renderAnswerWithSourceLogos(answer, query, sources) {
  const byId = new Map((sources || []).map(s => [String(s.id), s]));
  return highlightTerms(answer, query).replace(/\[S(\d+)\]/g, (match, n) => {
    const source = byId.get(`S${n}`);
    if (!source) return match;
    const label = source.title || displayUrl(source.url);
    return `<a class="ai-source-cite" href="${esc(source.url)}" data-open="${esc(source.url)}" title="${esc(label)}" aria-label="Source ${esc(label)}"><img src="${esc(sourceFaviconUrl(source.url))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'"></a>`;
  });
}
function unsafeAiText(value) {
  const text = String(value || "");
  return /CLIENT_CANARY_STATE|USER_DEFINED|(?:\\u[0-9a-f]{4}){2,}|(?:window|globalThis|self)\s*[.(]|\b(?:set\s*\(|document\.cookie|webpackJsonp)\b|enjoy the videos and music you love|upload original content/i.test(text)
    || /[{}[\];]{3,}/.test(text) && text.length > 120;
}
function highlightTerms(text, q) { const s = esc(text); const words = String(q).split(/\s+/).filter(w => /^[\p{L}\p{N}]{2,}$/u.test(w)).slice(0, 30); return words.length ? s.replace(new RegExp(`(${words.join("|")})`, "giu"), "<mark>$1</mark>") : s; }
function wireSearchLinks(container, { learn = false } = {}) {
  const follow = e => {
    if (e.type === "auxclick" && e.button !== 1) return;
    const url = resultUrl(e.currentTarget.dataset.open);
    if (!url) return;
    e.preventDefault();
    if (learn) sendNeuralFeedback(url, true, 1.0);
    if (e.ctrlKey || e.metaKey || e.button === 1) newTab({ url, background: true }); else navigate(url);
  };
  container.querySelectorAll("[data-open]").forEach(link => { link.onclick = follow; link.onauxclick = follow; });
}
function submitSearch(query, { corrected = false } = {}) {
  const t = activeTab(); if (t?.view !== "search") return;
  const q = query.trim().slice(0, 600);
  pushTabHistory(t, searchStateKey(q, t.searchSource));
  t.searchQuery = q;
  t.title = q ? `${q} - Veyra Search` : "Veyra Search";
  if (q) recordHistory("search", `veyra://search?q=${encodeURIComponent(q)}`, t.title);
  renderTabs(); updateAddress(); updateNavButtons(); syncRoute();
  void runSearch(q, 0, { corrected });
}
function selectSearchCategory(category) {
  const t = activeTab(); if (t?.view !== "search" || t.searchSource === category || !Object.hasOwn(CATEGORIES, category)) return;
  t.searchSource = category;
  if (category === "web" || category === "index") { settings.searchSource = category; saveSettings(); }
  pushTabHistory(t, searchStateKey(t.searchQuery, category));
  updateNavButtons(); syncRoute();
  void runSearch(t.searchQuery, 0, { corrected: true });
}
function renderSearchTabs(t) {
  const source = searchCategory(t.searchSource);
  qsa("#searchTabs [data-src]").forEach(b => {
    const on = b.dataset.src === source;
    b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
  });
  $("searchPanel").setAttribute("aria-labelledby", `search-tab-${source}`);
}
function renderSearchCorrection(t) {
  const box = $("searchCorrection");
  box.classList.toggle("hidden", !t.searchCorrection);
  box.innerHTML = t.searchCorrection ? `Did you mean <button type="button" id="searchCorrected">${esc(t.searchCorrection)}</button>?` : "";
  $("searchCorrected")?.addEventListener("click", () => submitSearch(t.searchCorrection, { corrected: true }));
}
function searchDate(value) {
  const date = new Date(value || NaN);
  return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date) : "";
}
function richResult(r, source) {
  const url = resultUrl(r.url);
  if (!url) return "";
  const media = ["images", "videos", "shopping"].includes(source);
  const poster = !INCOGNITO && posterUrl(r.thumbnail);
  const title = r.title || url;
  const attribution = r.source || hostOf(url);
  const sourcePage = source === "images" ? resultUrl(r.sourcePageUrl) : "";
  const date = searchDate(r.publishedAt), price = displayPrice(r.price);
  const details = [date, r.license, r.condition].filter(Boolean).map(esc).join(" · ");
  return `<article class="search-card search-card-${source}">
    <a href="${esc(url)}" data-open="${esc(url)}" class="search-card-link">
      ${media ? `<div class="search-card-art">${searchIcon(CATEGORIES[source].icon)}${poster ? `<img src="${esc(poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}${source === "videos" && r.duration ? `<span>${esc(r.duration)}</span>` : ""}</div>` : ""}
      <div class="search-card-copy"><span class="search-card-source">${esc(attribution)}${!sourcePage && attribution !== hostOf(url) ? ` · ${esc(hostOf(url))}` : ""}</span>
        <h3>${esc(title)}</h3>${price ? `<b class="search-price">${esc(price)}</b>` : ""}${details ? `<span class="search-card-meta">${details}</span>` : ""}
        ${r.snippet && source !== "images" ? `<p>${esc(r.snippet)}</p>` : ""}
      </div>
    </a>
    ${sourcePage && sourcePage !== url ? `<a class="search-image-source" href="${esc(sourcePage)}" data-open="${esc(sourcePage)}">Source page<span class="sr-only"> for ${esc(title)}</span></a>` : ""}
  </article>`;
}
function hideBrokenSearchImages(container) {
  container.querySelectorAll(".search-card-art img").forEach(img => {
    const hide = () => { img.hidden = true; };
    if (img.complete && !img.naturalWidth) hide();
    else img.addEventListener("error", hide, { once: true });
  });
}
function searchSkeleton(source) {
  return `<div class="search-skeleton ${isVertical(source) ? "search-skeleton-grid" : ""}" aria-hidden="true">${Array.from({ length: 4 }, () => "<div><span></span><span></span></div>").join("")}</div>`;
}
function searchEmpty(icon, title, message, button = "") {
  return `<div class="empty search-empty">${searchIcon(icon)}<b>${esc(title)}</b><span>${esc(message)}</span>${button}</div>`;
}
function renderSearch() {
  const t = activeTab(); if (!t || t.view !== "search") return;
  const source = searchCategory(t.searchSource), category = CATEGORIES[source], vertical = isVertical(source), web = source === "web";
  if (document.activeElement !== $("searchInput") || $("searchInput").value === "") $("searchInput").value = t.searchQuery;
  $("searchInput").placeholder = web ? "Search the web with Veyra" : `Search ${category.label.toLowerCase()}`;
  $("searchInput").setAttribute("aria-label", web ? "Search the web" : `Search ${category.label.toLowerCase()}`);
  $("searchOnGoogle").disabled = !t.searchQuery;
  $("searchPanel").dataset.category = source;
  renderSearchTabs(t);
  renderSearchCorrection(t);
  renderAIAnswer(t);
  const results = $("searchResults"), more = $("searchMore"), stat = $("searchStat"), meta = $("searchMeta");
  const d = t.searchData;
  more.classList.add("hidden");
  results.setAttribute("aria-busy", String(!!t.searchLoading));
  results.classList.toggle("search-rich-results", vertical && !!d?.results?.length);
  $("searchCoverage").classList.toggle("hidden", source !== "index");
  if (source === "index") void loadIndexStats();
  if (!t.searchQuery) {
    stat.textContent = category.label;
    meta.textContent = `${category.description}. On Web and Index, try a site: operator to narrow your search.`;
    results.innerHTML = `<div class="search-start"><span class="search-start-icon">${searchIcon(category.icon)}</span><h2>What are you looking for?</h2><p>Search freely, or choose a category to narrow the results.</p></div>`;
    return;
  }
  if (t.searchError || d?.status === "unavailable") {
    stat.textContent = `${category.label} search unavailable`;
    meta.textContent = category.description;
    results.innerHTML = searchEmpty(category.icon, "This search couldn’t finish", t.searchError || "The provider is temporarily unavailable. Try again or switch categories.", '<button class="btn ghost sm" type="button" id="searchRetry">Try again</button>');
    $("searchRetry").onclick = () => void runSearch(t.searchQuery);
    return;
  }
  if (!d) {
    stat.textContent = "Searching…";
    meta.textContent = category.description;
    results.innerHTML = searchSkeleton(source);
    return;
  }
  const shown = d.results.length, total = source === "index" && !d.siteFilter && d.total != null ? Number(d.total).toLocaleString() : shown;
  stat.textContent = `${total} ${Number(total) === 1 ? "result" : "results"}`;
  const label = vertical ? providerLabel(d.provider) : web ? PROVIDER_LABEL[d.provider] || (d.provider !== "none" ? d.provider : "") : "Veyra index";
  const note = source === "shopping" ? d.provider === "ebay" ? "Listing prices can change; confirm on eBay" : "Product links only; check merchants for prices and stock"
    : web && t.searchEngine === "google" && d.provider !== "google" && d.googleConfigured === false ? "Google API is not configured" : INCOGNITO && (source === "images" || source === "videos") ? "External thumbnails are off in incognito" : "";
  meta.textContent = [label, note].filter(Boolean).join(" · ");
  const retry = '<button class="btn ghost sm" type="button" id="searchRetry">Try again</button>';
  results.innerHTML = shown ? vertical ? d.results.map(row => richResult(row, source)).join("")
    : `<h2 class="search-result-heading">${web ? "Web results" : "Indexed pages"}</h2>${d.results.map(r => `<article class="result"><div class="r-url">${esc(displayUrl(r.displayUrl || r.url))}${r.queryRelevance != null ? ` <span class="result-relevance">${Math.round(r.queryRelevance * 100)}% match</span>` : r.relevance != null && web ? ` <span class="result-relevance">${Math.round(r.relevance * 100)}% match</span>` : ""}</div><a class="r-title" href="${esc(r.url)}" data-open="${esc(r.url)}">${highlightTerms(r.title || r.url, t.searchQuery)}</a><p>${highlightTerms(r.snippet || "No description available.", t.searchQuery)}</p></article>`).join("")}`
    : d.siteFilter ? searchEmpty(category.icon, d.siteFilter.invalid ? "Invalid site filter" : "No results within the requested site scope", d.siteFilter.invalid ? "Use a hostname, for example site:nasa.gov." : "Results outside the requested scope are not shown.")
    : searchEmpty(category.icon, `No ${category.label.toLowerCase()} results for “${t.searchQuery}”`, web ? "Try another query or retry with the available providers." : "Try different keywords or switch to Web.", web ? retry : '<button class="btn ghost sm" type="button" id="searchWeb">Search the web</button>');
  wireSearchLinks(results, { learn: !vertical });
  hideBrokenSearchImages(results);
  $("searchWeb")?.addEventListener("click", () => selectSearchCategory("web"));
  $("searchRetry")?.addEventListener("click", () => void runSearch(t.searchQuery));
  const canMore = vertical ? d.nextPage != null : d.siteFilter ? d.nextOffset != null : web ? d.more !== false && shown >= 8 && shown < 60 : d.total == null ? shown >= 10 : shown < d.total;
  more.classList.toggle("hidden", !canMore);
  more.disabled = !!t.searchLoading;
  more.textContent = t.searchLoading ? "Loading more…" : "More results";
  more.onclick = () => void runSearch(t.searchQuery, vertical ? d.nextPage : d.siteFilter ? d.nextOffset : shown);
}
let indexStatsAt = 0;
async function loadIndexStats() {
  if (indexStatsAt > Date.now() - 60_000) return;
  indexStatsAt = Date.now();
  try { const b = await api("/api/search/stats", { timeoutMs: 6000 }); $("searchCoverage").textContent = `Veyra Index: ${Number(b.documents || 0).toLocaleString()} pages · ${Number(b.domains || 0).toLocaleString()} domains`; } catch { $("searchCoverage").textContent = ""; }
}
let suggestTimer = 0;
function loadSuggestions(q) {
  clearTimeout(suggestTimer);
  if (!settings.suggestions) { $("searchSuggestions").innerHTML = ""; return; }
  const tab = activeTab();
  suggestTimer = setTimeout(async () => { if (!settings.suggestions || !q.trim() || activeTab() !== tab) return; try { const b = await api(`/api/search/suggest?q=${encodeURIComponent(q)}&limit=8`, { timeoutMs: 4000 }); if (settings.suggestions && activeTab() === tab) $("searchSuggestions").innerHTML = (b.suggestions || []).map(s => `<option value="${esc(s)}">`).join(""); } catch {} }, 160);
}
export async function omniSuggest(q) {
  if (!settings.suggestions || classify(q)?.kind !== "search") return [];
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

let vpnRefresh = 0;
export async function refreshVpnStatus(onProfiles) {
  const revision = ++vpnRefresh;
  const session = state.session;
  const next = await readVpnAvailability(api, {
    sessionId: session?.id, previous: state.vpn.status,
    onProfiles: result => {
      if (revision !== vpnRefresh) return;
      Object.assign(state.vpn, result);
      onProfiles?.({ ...result, info: null, connected: false, profile: null, sessionError: session ? "Checking this session's connection…" : "" });
    }
  });
  if (revision === vpnRefresh) {
    if (state.session === session) Object.assign(state.vpn, next);
    $("vpnBtn").classList.toggle("on", state.vpn.connected); updateIdentity();
  }
  return state.vpn;
}
export async function connectVpn(profileId, { quiet = false } = {}) {
  const s = await ensureSession();
  const r = await api("/api/vpn/connect", { json: { sessionId: s.id, profileId } });
  if (state.session !== s) return;
  state.vpn.connected = true; state.vpn.profile = r.profile || null;
  if (!quiet) toast(`VPN connected · ${r.profile?.name || profileId}`);
  reloadPagesAfterVpn(); $("vpnBtn").classList.toggle("on", true); updateIdentity();
}
export async function disconnectVpn() {
  if (!state.session) return;
  await api("/api/vpn/disconnect", { json: { sessionId: state.session.id } });
  state.vpn.connected = false; state.vpn.profile = null; toast("VPN disconnected"); reloadPagesAfterVpn(); $("vpnBtn").classList.toggle("on", false); updateIdentity();
}
function reloadPagesAfterVpn() {
  for (const t of state.tabs) {
    if (t.view !== "page" || !t.url || t.localPage === "now") continue;
    if (isRemote(t)) {
      const { url, pageLoad } = t;
      void stopBrowserSession(t).then(() => {
        if (state.tabs.includes(t) && t.view === "page" && t.url === url && t.pageLoad === pageLoad) void loadInTab(t, url);
      });
    } else if (activeTab() === t || t.localPage === "youtube" || t.youtubeInlineWatch) void loadInTab(t, t.url);
    else t.needsReload = true;
  }
}
async function renderVpnPanel() {
  const box = $("vpnPanel");
  const focus = box.querySelector(":focus")?.dataset.connect;
  if (!box.hasChildNodes()) box.innerHTML = `<div class="empty"><div class="spinner" aria-label="Loading VPN exits"></div></div>`;
  const render = v => {
  box.onclick = null;
  const st = v.status;
  if (!st) { box.innerHTML = `<div class="empty"><svg><use href="#i-vpn"/></svg><b>Veyra VPN is unavailable</b><span>${esc(v.error || "")}</span><button class="btn ghost sm" id="vpnRefresh">Retry</button></div>`; box.querySelector("#vpnRefresh").onclick = renderVpnPanel; return; }
  const profiles = st.profiles || [];
  const cur = v.profile;
  const openCountries = new Set([...box.querySelectorAll("details[open]")].map(node => node.dataset.country));
  box.innerHTML = `<div class="vpn-hero"><div class="vpn-orb ${v.connected ? "on" : ""}"><svg><use href="#i-vpn"/></svg></div><div><h2>${v.sessionError ? "Connection status unknown" : v.connected ? "Protected" : "Not connected"}</h2><p class="muted">${v.connected ? `Traffic in this session leaves through <b>${esc(cur?.name || "")}</b>${cur?.region ? ` · ${esc(cur.region)}` : ""}${cur?.health?.exitIp ? ` · exit ${esc(cur.health.exitIp)}` : ""}.` : st.enabled === false ? "The VPN is turned off on this server." : v.sessionError ? esc(v.sessionError) : v.error ? esc(v.error) : !profiles.length ? "No VPN exits are configured on the server yet." : "Choose an exit below. Every tab in this session will use it."}</p></div><span class="spacer"></span>${v.connected ? `<button class="btn ghost" id="vpnRotate">Rotate exit</button><button class="btn danger" id="vpnOff">Disconnect</button>` : ""}</div>
    <div class="s-section"><h2>Exits by country</h2><p class="muted">${st.killSwitch ? "Kill switch is on: if a tunnel drops, requests are blocked instead of leaking through the server's own IP." : st.killSwitch === false ? "Kill switch is off on this server." : ""}${st.failover ? " Failover moves you to a healthy exit automatically." : ""}</p>
    ${(() => {

      const byCountry = new Map();
      for (const p of profiles) {
        const key = String(p.country || p.region || "Other").toUpperCase();
        if (!byCountry.has(key)) byCountry.set(key, []);
        byCountry.get(key).push(p);
      }
      const keys = [...byCountry.keys()].sort((a, b) => {

        const curKey = String(cur?.country || cur?.region || "").toUpperCase();
        if (curKey && a === curKey) return -1; if (curKey && b === curKey) return 1;
        return a.localeCompare(b);
      });
      if (!keys.length) return `<div class="empty"><span>${v.error ? esc(v.error) : "No exits to show. A server administrator can configure them."}</span><button class="btn ghost sm" id="vpnRefresh">Refresh exits</button></div>`;
      return keys.map(k => {
        const rows = byCountry.get(k);
        const anyOn = rows.some(p => p.id === cur?.id);
        return `<details class="vpn-country" data-country="${esc(k)}" ${anyOn || keys.length === 1 || openCountries.has(k) ? "open" : ""}><summary><span class="pill ${anyOn ? "ok" : ""}">${esc(k)}</span><small>${rows.length} exit${rows.length > 1 ? "s" : ""}</small>${anyOn ? `<span class="pill ok">Connected</span>` : ""}</summary><div class="vpn-list">${rows.map(p => `<div class="vpn-row ${cur?.id === p.id ? "on" : ""}"><span class="pill ${p.health?.healthy === false ? "err" : p.health?.healthy ? "ok" : ""}">${esc(p.protocol || p.type)}</span><div class="n"><b>${esc(p.name)}</b><small>${esc([p.region, p.provider].filter(Boolean).join(" · ") || "Server exit")}${p.health?.latencyMs ? ` · ${p.health.latencyMs} ms` : ""}${p.health?.healthy === false ? ` · ${esc(p.health.lastError || "health check failed")}` : ""}</small></div>${cur?.id === p.id ? `<span class="pill ok">Connected</span>` : `<button class="btn ghost sm" data-connect="${esc(p.id)}" ${st.enabled !== false && p.health?.healthy !== false ? "" : "disabled"}>${p.health?.healthy === false ? "Unavailable" : "Connect"}</button>`}<button class="btn ghost sm" data-test="${esc(p.id)}">Test</button></div>`).join("")}</div></details>`;
      }).join("");
    })()}</div></div>
    <div class="s-section"><h2>Automatic connection</h2><div class="s-card"><div class="s-row"><div class="s-label"><b>Connect new sessions automatically</b><span>Uses the chosen exit as soon as a session starts.</span></div><div class="s-ctl"><select class="input" id="vpnAuto"><option value="">Off</option>${profiles.map(p => `<option value="${esc(p.id)}" ${settings.vpnAutoProfile === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div></div><div class="s-row"><div class="s-label"><b>Automatic exit rotation</b><span>When enabled on the server, Veyra can periodically move the session to another configured exit. A new public IP depends on the VPN provider.</span></div><div class="s-ctl"><span class="pill ${st.rotation?.enabled ? "ok" : ""}">${st.rotation?.enabled ? `Every ${fmtClock(st.rotation.intervalMs)}` : "Server controlled"}</span></div></div></div></div>`;
  box.onclick = async e => {
    const b = e.target.closest("button");
    if (!b || !(b.dataset.connect || b.dataset.test || b.id === "vpnOff" || b.id === "vpnRotate")) return;
    b.disabled = true;
    try {
      if (b.dataset.connect) await connectVpn(b.dataset.connect);
      else if (b.dataset.test) { const r = await api("/api/vpn/test", { json: { profileId: b.dataset.test }, timeoutMs: 20000 }); toast(`Exit responded${r.exitIp ? ` · IP ${r.exitIp}` : ""}${r.latencyMs ? ` · ${r.latencyMs} ms` : ""}`); }
      else if (b.id === "vpnOff") await disconnectVpn();
      else if (b.id === "vpnRotate") { const r = await api("/api/vpn/rotate", { json: { sessionId: state.session.id } }); toast(`Now using ${r.profile?.name || "a new exit"}`); reloadPagesAfterVpn(); }
    } catch (err) { toast(err.message, { kind: "err" }); }
    renderVpnPanel(); };
  $("vpnAuto").onchange = e => { settings.vpnAutoProfile = e.target.value; saveSettings(); toast(e.target.value ? "New sessions will connect automatically" : "Automatic VPN off"); };
  if (focus) [...box.querySelectorAll("[data-connect]")].find(button => button.dataset.connect === focus)?.focus();
  };
  const result = await refreshVpnStatus(render);
  render(result);
}
export { renderVpnPanel };

function tabForSource(src) {
  for (const t of state.tabs) { const f = frameFor(t); if (!f) continue; let w = src; for (let i = 0; i < 6 && w; i++) { if (w === f.contentWindow) return t; try { if (w === w.parent) break; w = w.parent; } catch { break; } } }
  return null;
}
function isConsoleLabPageUrl(value) {
  try {
    const u = new URL(String(value || ""));

    const path = u.pathname.replace(/\/+$/, "");
    return u.protocol === "https:" && u.hostname === "homekidchud.github.io" && ["/VeyraBrowser/web/console-lab", "/VeyraBrowser/console-lab"].includes(path);
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

function relayIntoFrame(tab, payload) {
  try { const f = frameFor(tab); if (!f?.contentWindow) return false; f.contentWindow.postMessage(payload, API_ORIGIN); return true; } catch { return false; }
}
function popupMessageOrigin(url) {
  try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.origin : ""; } catch { return ""; }
}
function notifyPopupClosed(openerTab, popupId) {
  if (!openerTab || !popupId) return;
  relayIntoFrame(openerTab, { type: "veyra:popup-closed", popupId });
}
function teardownPopupLinks(tab) {
  if (tab.popupOf) { const opener = state.tabs.find(x => x.id === tab.popupOf); notifyPopupClosed(opener, tab.popupId); }
}

const playbackHandoffs = new WeakMap();
function resetPlaybackHandoff(tab, url) {
  if (playbackHandoffs.has(tab) && playbackHandoffs.get(tab) !== xhamsterPlaybackKey(url)) playbackHandoffs.delete(tab);
}
function handlePlaybackPopup(tab, target, sourceFrame, explicitLink = false) {
  const decision = playbackPopupDecision(tab.url, target, explicitLink);
  if (decision.action === "allow") return false;
  if (decision.action === "watch-in-place" && activeTab() === tab && frameFor(tab)?.contentWindow === sourceFrame) {
    if (playbackHandoffs.get(tab) === decision.key) {
      if (!tab.loading) toast("The site returned to the embed without starting playback. Reload the tab to retry.", { kind: "warn", ms: 5200 });
    } else {
      playbackHandoffs.set(tab, decision.key);
      void navigate(decision.url, { tab });
    }
  }
  return true;
}

function openProxiedPopup(sourceTab, d, sourceFrame) {
  const target = canonicalPopupUrl(d.url);
  const popupId = typeof d.popupId === "string" ? d.popupId : "";
  if (!target || !/^[\w-]{1,80}$/.test(popupId) || handlePlaybackPopup(sourceTab, target, sourceFrame)) return null;
  const existing = state.tabs.find(x => x.popupOf === sourceTab.id && x.popupId === popupId);
  if (existing) return existing;
  if (activeTab() !== sourceTab) return null;
  if (interceptAccount(target, sourceTab.url)) return null;
  return newTab({ url: target, index: state.tabs.indexOf(sourceTab) + 1, popupOf: sourceTab.id, popupId });
}

function ackEmbedPing(e) {
  const t = tabForSource(e.source);
  if (!t || t.localPage || isRemote(t)) return;
  try { e.source?.postMessage?.({ type: "veyra:embed-ack" }, API_ORIGIN); } catch {}
  if (t.popupOf) relayIntoFrame(t, { type: "veyra:popup-role" });
}

function chooseSignin(t, url) {
  if (interceptAccount(url, t.url)) return;
  addLog("info", `Sign-in on ${hostOf(url)} loading through the fast proxy.`);
  toast(`Signing in to ${hostOf(url)} inside Veyra`, { ms: 4000 });
  void loadInTab(t, url, { loadFrame: true });
}

function accountRow(parent, { icon, title, description, label, href, download, action, primary = false }) {
  const row = document.createElement("li"); row.className = "account-option";
  const marker = document.createElement("span"); marker.className = "account-option-icon"; marker.textContent = icon; marker.setAttribute("aria-hidden", "true");
  const copy = document.createElement("div"); copy.className = "account-option-copy";
  const name = document.createElement("strong"); name.textContent = title;
  const detail = document.createElement("span"); detail.textContent = description;
  copy.append(name, detail);
  const control = document.createElement(href ? "a" : "button");
  control.className = `toast-action${primary ? " toast-action-primary" : ""}`; control.textContent = label;
  if (href) {
    control.href = href;
    if (download) control.download = download;
    else { control.target = "_blank"; control.rel = "noopener noreferrer"; }
  } else { control.type = "button"; control.addEventListener("click", action); }
  row.append(marker, copy, control); parent.append(row);
}

function directAccountBookmark(target) {
  const provider = target.provider;
  const label = `${provider} ${target.signup ? "signup" : "sign-in"}`;
  toast(`This bookmark opens ${provider} directly. It does not store your sign-in session.`, {
    title: `Save ${provider} bookmark`, key: `account-bookmark-${provider}-${target.signup ? "signup" : "login"}`, ms: 0,
    field: { label: "Bookmark name", value: label, submitLabel: "Save bookmark", autofocus: true, onSubmit: name => {
      const existing = state.bookmarks.find(b => accountDestination(b.url)?.url === target.url);
      if (existing) existing.title = name;
      else state.bookmarks.push({ id: uid(), url: target.url, title: name, time: Date.now() });
      if (!settings.showBookmarksBar) { settings.showBookmarksBar = true; saveSettings(); }
      saveBookmarks(); hooks.renderBookmarksBar?.(); updateIdentity();
      if (activeTab()?.view === "newtab") hooks.renderNewTab?.();
      toast(`${provider} will open directly from your bookmarks bar.`, { title: "Bookmark saved", kind: "success" });
    } }
  });
}

let accountNotice = null;
function showAccountNotice(key, message, opts) {
  if (accountNotice?.key !== key) accountNotice?.dismiss?.();
  const dismiss = toast(message, { ...opts, key, ms: 0 });
  accountNotice = { key, dismiss };
  return dismiss;
}

export function showAccountOptions(url = GOOGLE_SIGN_IN, from = "") {
  const target = accountDestination(url); if (!target) return false;
  if (target.provider === "GitHub") {
    showAccountNotice(`github-account-${target.signup ? "signup" : "login"}`,
      "GitHub verifies accounts on its own site. Start there in a regular browser tab.", {
      title: target.signup ? "Create a GitHub account" : "Sign in to GitHub",
      actions: [
        { label: "Continue on GitHub", href: target.url, primary: true },
        { label: "Add bookmark", onClick: () => directAccountBookmark(target) }
      ]
    });
    return true;
  }
  const options = document.createElement("ul"); options.className = "account-options";
  const title = target.signup ? "Create a Google account" : "Sign in to Google";
  let original = "";
  if (from && !accountDestination(from) && /\/(?:o\/oauth2|oauth)(?:\/|$)/i.test(new URL(url).pathname)) {
    try {
      const source = new URL(from);
      if (source.protocol === "https:" && !source.username && !source.password && source.origin !== API_ORIGIN &&
        source.origin !== location.origin && !["google.com", "www.google.com"].includes(source.hostname)) original = source.origin;
    } catch {}
  }
  const dismiss = showAccountNotice(`google-account-${target.signup ? "signup" : "login"}-${original || "direct"}`, original
    ? `To sign in to ${hostOf(original)} with Google, open that site directly and restart its sign-in. Google account sessions stay in that browser.`
    : "Google handles your password and verification in a regular browser tab. Choose how to get there.", {
    title, node: options
  });
  if (!options.isConnected) return true;
  accountRow(options, { icon: "↗", title: "Fast Veyra Browser", description: "Open a direct tab in your current browser, with no proxy in between.",
    label: original ? `Open ${hostOf(original)}` : target.signup ? "Create on Google" : "Continue on Google", href: original || target.url, primary: true });
  accountRow(options, { icon: "☆", title: "Bookmark Google", description: "Save the official page to open directly next time.",
    label: "Add bookmark", action: () => { directAccountBookmark(target); dismiss?.(); } });
  accountRow(options, { icon: "↓", title: "Veyra Browser extension", description: "Manual install for Chrome and Edge. No site permissions.",
    label: "Download ZIP", href: `${APP_BASE}/downloads/veyra-launcher.zip`, download: "veyra-launcher.zip" });
  accountRow(options, { icon: "◇", title: "Veyra VPN", description: "Set routing for Fast Proxy. Google verification stays direct.",
    label: "VPN settings", action: () => { dismiss?.(); openInternal("vpn"); } });
  if (!from || navigator.userActivation?.isActive) options.querySelector("a").focus({ preventScroll: true });
  return true;
}

function interceptAccount(url, from = "") {
  return accountDestination(url) ? showAccountOptions(url, from) : false;
}
async function handleMessage(e) {
  const d = e.data; if (!d || typeof d !== "object" || typeof d.type !== "string" || !d.type.startsWith("veyra:")) return;

  if (d.type === "veyra:open-direct-ping" || d.type === "veyra:open-direct") {
    if (e.origin !== API_ORIGIN) return;
    const source = tabForSource(e.source);
    if (!source || activeTab() !== source || frameFor(source)?.contentWindow !== e.source) return;
    if (d.type === "veyra:open-direct-ping") { try { e.source?.postMessage?.({ type: "veyra:open-direct-ack" }, API_ORIGIN); } catch {} return; }
    const url = String(d.url || "");
    if (accountDestination(canonical(url))) {
      showAccountOptions(canonical(url), source.url);
      return;
    }
    if (/^https?:\/\//i.test(url)) { window.open(url, "_blank", "noopener"); addLog("info", `Opened directly: ${hostOf(url)}`); }
    return;
  }

  if (d.type === "veyra:embed-ping") { if (e.origin !== API_ORIGIN) return; ackEmbedPing(e); return; }
  if (d.type === "veyra:console-lab:open-proxy") {
    const frame = $("consoleLabFrame");
    if (frame && e.source === frame.contentWindow && e.origin === location.origin &&
        activeTab()?.view === "console-lab" && canOpenAdminPanel() && isConsoleLabPageUrl(frame.src)) {
      newTab({ url: frame.src });
    }
    return;
  }

  const t = tabForSource(e.source); if (!t || t.localPage) return;

  if (d.type === "veyra:embed-probe-ack") { t.lastRuntimeAckAt = Date.now(); t.escapeRecoveries = 0; return; }
  const consoleLabAuthCheck = d.type === "veyra:console-lab:auth-check";
  const trustedConsoleLabOrigin = consoleLabAuthCheck && e.origin === "https://homekidchud.github.io";
  if (e.origin !== API_ORIGIN && e.origin !== "null" && !trustedConsoleLabOrigin) return;
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
  if (d.type === "veyra:shortcut") {
    if (activeTab() === t && e.origin === API_ORIGIN && frameFor(t)?.contentWindow === e.source) hooks.handleForwardedShortcut?.(d);
    return;
  }
  if (d.type === "veyra:browser-required") {
    const u = canonical(d.pageUrl || t.url);
    if (u && t.view === "page" && !isRemote(t)) {
      t.compatFallbackTried ||= new Set();
      const key = `${u}|${String(d.reason || "browser-required")}`;
      if (!t.compatFallbackTried.has(key)) {
        if (d.reason === "empty-spa-shell") {
          const first = proxyDocLooksBlank(t);
          if (first.nodes >= 0) {
            setTimeout(() => {
              if (!state.tabs.includes(t) || t.view !== "page" || t.url !== u || t.browserMode === "BROWSER_ENGINE" || tabForSource(e.source) !== t) return;
              if (t.compatFallbackTried?.has(key)) return;
              const second = proxyDocLooksBlank(t);
              if (!second.blank) return;
              if (second.nodes > first.nodes) {
                addLog("debug", `Proxy shell on ${hostOf(u)} is still hydrating (${first.nodes} → ${second.nodes} nodes); keeping the fast proxy.`);
                return;
              }
              void routeBrowserRequired(t, u, key, d.reason);
            }, 9000);
            return;
          }
        }
        void routeBrowserRequired(t, u, key, d.reason);
      }
    }
    return;
  }
  if (d.type === "veyra:page-console" || d.type === "veyra:page-error") {
    const entry = pageConsoleEntry(d, t);
    const pageErrorText = `${entry.message} ${entry.stack}`;
    const hydrationFailure = /minified react error #418|hydration failed|hydration mismatch/i.test(pageErrorText);
    if (hydrationFailure && t.view === "page" && !isRemote(t) && t.url) {
      t.compatFallbackTried ||= new Set();
      const key = `${t.url}|react-hydration`;
      if (!t.compatFallbackTried.has(key)) {
        addLog("info", `React hydration mismatch detected on ${hostOf(t.url)}; retaining FAST_PROXY unless server Chromium is available.`);
        void routeBrowserRequired(t, t.url, key, "react-hydration");
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
  if (d.type === "veyra:open" && d.url) {
    if (e.origin !== API_ORIGIN || t.view !== "page" || isRemote(t) || activeTab() !== t) return;
    const u = canonicalPopupUrl(d.url); if (!u) return;
    if (interceptAccount(u, t.url)) return;

    const tgt = String(d.target || "_blank").toLowerCase();
    if ((tgt === "_top" || tgt === "_parent") && t.view === "page" && !isRemote(t)) { void loadInTab(t, u, { loadFrame: true }); return; }
    if (handlePlaybackPopup(t, u, e.source, true)) return;
    newTab({ url: u, index: state.tabs.indexOf(t) + 1 }); return;
  }
  if (d.type === "veyra:form" && d.url) { submitForm(t, d); return; }
  if (d.type === "veyra:retry") { if (activeTab() === t) reload(); return; }

  if (d.type === "veyra:signin" && d.url) {
    const target = canonical(d.url);
    if (target && t.view === "page" && !isRemote(t)) chooseSignin(t, target);
    return;
  }

  if (d.type === "veyra:popup-open" && d.url) {
    if (e.origin !== API_ORIGIN || t.view !== "page" || isRemote(t)) return;
    const popup = openProxiedPopup(t, d, e.source);
    if (popup) addLog("info", `Popup opened through the fast proxy: ${hostOf(popup.url)}`);
    else if (typeof d.popupId === "string" && d.popupId.length <= 80) notifyPopupClosed(t, d.popupId);
    return;
  }

  if (d.type === "veyra:popup-message" && d.popupId) {
    if (e.origin !== API_ORIGIN) return;
    const popup = state.tabs.find(x => x.popupOf === t.id && x.popupId === String(d.popupId));
    const origin = popupMessageOrigin(d.virtualUrl || t.url);
    if (popup && origin) relayIntoFrame(popup, { type: "veyra:relay-message", data: d.data, origin, from: "opener", popupId: String(d.popupId) });
    return;
  }

  if (d.type === "veyra:popup-to-opener") {
    if (e.origin !== API_ORIGIN || frameFor(t)?.contentWindow !== e.source) return;
    const opener = t.popupOf ? state.tabs.find(x => x.id === t.popupOf) : null;
    const origin = popupMessageOrigin(d.virtualUrl || t.url);
    if (opener && origin) relayIntoFrame(opener, { type: "veyra:relay-message", data: d.data, origin, from: "popup", popupId: t.popupId || "" });
    return;
  }

  if (d.type === "veyra:popup-self-close" || (d.type === "veyra:popup-close" && d.popupId)) {
    if (e.origin !== API_ORIGIN) return;
    const popup = d.type === "veyra:popup-self-close"
      ? (t.popupOf && frameFor(t)?.contentWindow === e.source ? t : null)
      : state.tabs.find(x => x.popupOf === t.id && x.popupId === String(d.popupId));
    if (popup) closeTab(popup.id, { silent: true });
    return;
  }

  if (d.type === "veyra:popup-navigate" && d.url) {
    if (e.origin !== API_ORIGIN) return;
    const target = canonicalPopupUrl(d.url);
    const popup = state.tabs.find(x => x.popupOf === t.id && x.popupId === String(d.popupId));
    if (!target || !popup) return;
    if (blockPlaybackPopup(t.url, target) || interceptAccount(target, t.url)) { closeTab(popup.id, { silent: true }); return; }
    void loadInTab(popup, target, { loadFrame: true });
    return;
  }
  if (d.type === "veyra:challenge" && d.url) {

    const u = canonical(d.url); if (!u || t.view !== "page") return;
    if (interceptAccount(u, t.url)) return;
    t.challengeTried ||= new Set();

    if (CHROMIUM_TRY_DISABLED) { toast("This site wants a security check, which Veyra can't complete through the fast proxy yet. Open it directly or retry through Veyra.", { kind: "warn", ms: 6000 }); return; }
    if (!d.manual && (!d.auto || settings.challengeHandoff === false || t.challengeTried.has(u))) { if (!d.manual) toast("This site wants a security check. Use \u201cVerify in real Chromium\u201d to complete it", { kind: "warn", ms: 5000 }); return; }
    t.challengeTried.add(u);

    t.challengeEscalated = true; t.wasVerifying = false; t.challengeReturned = false;
    void routeBrowserRequired(t, u, `${u}|security-challenge`, "security-challenge");
    return;
  }
  if (d.type === "veyra:navigate" && d.url) {
    const target = canonical(d.url); if (!target) return;
    const opener = t.popupOf && state.tabs.find(tab => tab.id === t.popupOf);
    if (opener && frameFor(t)?.contentWindow === e.source && blockPlaybackPopup(opener.url, target)) { closeTab(t.id, { silent: true }); return; }
    const watchChanged = t.browserMode === "FAST_PROXY" && inlineYouTubeAllowed() && !!youtubeWatchId(target)
      && youtubeWatchId(target) !== youtubeWatchId(t.url);
    if (target !== t.url && e.origin === API_ORIGIN && frameFor(t)?.contentWindow === e.source && (localPageKind(target) || watchChanged)) {
      const historyAction = String(d.source);
      if (watchChanged && historyAction === "history.popstate") {
        const i = t.history.lastIndexOf(target);
        if (i >= 0) t.histIndex = i;
        else pushTabHistory(t, target);
      } else if (watchChanged && /^history\.(?:replaceState|heal)$/.test(historyAction)) {
        if (t.histIndex >= 0) t.history[t.histIndex] = target;
        else pushTabHistory(t, target);
      } else pushTabHistory(t, target);
      void navigate(target, { tab: t, push: false, pushHist: false, activate: false, record: { title: String(d.title || "").slice(0, 200) } });
      return;
    }
    if (accountDestination(target)) {

      if (frameFor(t)?.contentWindow === e.source) {
        if (activeTab() === t) showAccountOptions(target, t.url);
        if (t.popupOf) closeTab(t.id, { silent: true });
        else openInternal("newtab", { tab: t, push: activeTab() === t });
      }
      return;
    }
    const sourceDisplayUrl = validateSourceDisplayUrl(d.veyraSourceUri, target, API_ORIGIN);
    if (d.title) t.title = String(d.title).slice(0, 200); if (d.favicon) t.favicon = canonical(d.favicon) || "";
    if (String(d.source).startsWith("history.")) {

      const fromRootFrame = (() => { try { return frameFor(t)?.contentWindow === e.source; } catch { return false; } })();
      if (!fromRootFrame) return;
      t.url = target; t.displayUrl = sourceDisplayUrl || validateSourceDisplayUrl(t.displayUrl, target, API_ORIGIN); if (d.source === "history.pushState") pushTabHistory(t, target); else if (t.history.length) t.history[t.histIndex] = target;
    }
    else if (d.source === "document-navigation") {
      const same = t.url && t.url.split("#")[0] === target.split("#")[0];

      const fromRootFrame = (() => { try { return frameFor(t)?.contentWindow === e.source; } catch { return false; } })();
      if (!same && fromRootFrame) {

        t.url = target;
        if (e.origin === API_ORIGIN) resetPlaybackHandoff(t, target);
        t.displayUrl = sourceDisplayUrl || validateSourceDisplayUrl(t.displayUrl, target, API_ORIGIN);
        pushTabHistory(t, target);
        recordHistory("page", target, d.title || hostOf(target), t.sessionId || state.session?.id);
        t.loading = false; clearTimeout(t.loadGuard); if (activeTab() === t) setLoading(false);
        hooks.dt?.onNavigate(t);
        if (activeTab() === t) { updateAddress(); updateIdentity(); syncRoute({ replace: true }); }
        renderTabsSoon();
        return;
      }
      if (!same && !fromRootFrame) return;
      t.displayUrl = sourceDisplayUrl || validateSourceDisplayUrl(t.displayUrl, target, API_ORIGIN);
      const h = state.history.find(x => x.url === target); if (h && d.title) { h.title = t.title; saveHistory(); }
    } else {

      const fromRootFrame = (() => { try { return frameFor(t)?.contentWindow === e.source; } catch { return false; } })();
      if (!fromRootFrame) return;
      t.url = target; t.displayUrl = sourceDisplayUrl || validateSourceDisplayUrl(t.displayUrl, target, API_ORIGIN);
    }

    if (e.origin === API_ORIGIN) resetPlaybackHandoff(t, t.url);
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
function canonicalPopupUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) return "";
  return canonical(value);
}
function canonical(value) {
  let raw = String(value || "").trim();
  for (let i = 0; i < 3; i++) {
    try { const u = new URL(raw, API); if (u.origin === API_ORIGIN && /^\/api\/(view|resource|download)$/.test(u.pathname)) { const inner = u.searchParams.get("url"); if (inner) { raw = inner; continue; } } return /^https?:$/.test(u.protocol) ? normalizeYouTubeUrl(u.href) : ""; }
    catch { return ""; }
  }
  return "";
}
function submitForm(t, msg) {
  if (interceptAccount(canonical(msg.url), t.url)) return;
  if (!state.session) return;
  const f = getOrCreateFrame(t); const form = document.createElement("form"); form.method = "POST"; form.action = proxyUrl(msg.url, "view", state.session.id, t.url); form.target = f.name; form.style.display = "none";
  for (const [n, v] of msg.entries || []) form.appendChild(Object.assign(document.createElement("input"), { type: "hidden", name: n, value: v }));
  document.body.appendChild(form); form.submit(); form.remove(); if (activeTab() === t) setLoading(true, 50, "Submitting…");
}
function pushKeybindings(t) { const list = hooks.forwardableCombos?.(); if (list) pageCommand("veyra:keys", { combos: list }, t); }
window.addEventListener("message", e => { handleMessage(e).catch(err => addLog("error", `Message handling failed: ${err.message}`)); });

function wire() {
  splitMobile.addEventListener("change", syncSplitFrames);
  ["pointerdown", "keydown", "wheel", "touchstart", "focus"].forEach(type => window.addEventListener(type, markUserActivity, { passive: true }));
  document.addEventListener("visibilitychange", () => {
    syncBackgroundDiagnostics();
    const t = activeTab();
    if (document.hidden) { remoteFrames?.stop(); clearTimeout(t?.browserPoll); }
    else { markUserActivity(); tickSession(); if (isRemote(t) && t.view === "page") { startRemoteFrames(t); refreshRemote(t, true); } }
  });
  window.addEventListener("pagehide", () => {
    remoteFrames?.stop();
    if (state.session?.ephemeral) navigator.sendBeacon?.(`${API}/api/session/${encodeURIComponent(state.session.id)}/close`, "");
  });
  window.addEventListener("pageshow", event => {
    if (event.persisted && ephemeralSession()) location.reload();
  });
  $("newTabBtn").onclick = () => newTab();
  $("backBtn").onclick = back; $("forwardBtn").onclick = forward; $("reloadBtn").onclick = () => reload(); $("homeBtn").onclick = goHome;
  $("starBtn").onclick = toggleBookmark; $("zoomChip").onclick = () => setZoom(1);
  $("downloadBtn").onclick = () => openInternal("downloads");
  $("vpnBtn").onclick = () => hooks.openVpnPopover?.($("vpnBtn"));
  $("sessionPill").onclick = () => hooks.openSessionPopover?.($("sessionPill"));
  $("sessionRestart").onclick = async () => { $("sessionOverlay").classList.add("hidden"); try { await ensureSession(); toast("New session started"); } catch (e) { toast(e.message, { kind: "err" }); } const last = state.history.find(h => h.kind === "page"); if (last) { /* offer the last page again */ toast(`Open ${hostOf(last.url)} again?`, { action: () => go(last.url), actionLabel: "Open", ms: 6000 }); } };
  $("sessionHome").onclick = () => { $("sessionOverlay").classList.add("hidden"); goHome(); };
  $("searchForm").onsubmit = e => { e.preventDefault(); submitSearch($("searchInput").value); };
  $("searchInput").oninput = e => loadSuggestions(e.target.value);
  $("searchOnGoogle").onclick = () => {
    const q = activeTab()?.searchQuery;
    if (q) newTab({ url: `https://www.google.com/search?q=${encodeURIComponent(q)}` });
  };
  $("searchTabs").innerHTML = Object.entries(CATEGORIES).map(([key, value]) => `<button type="button" id="search-tab-${key}" role="tab" data-src="${key}" aria-controls="searchPanel" aria-selected="false" tabindex="-1">${searchIcon(value.icon)}${esc(value.label)}</button>`).join("");
  $("searchTabs").addEventListener("click", e => {
    const b = e.target.closest("[data-src]"); if (b) selectSearchCategory(b.dataset.src);
  });
  $("searchTabs").addEventListener("keydown", e => {
    const tabs = [...e.currentTarget.querySelectorAll("[data-src]")], i = tabs.indexOf(e.target);
    if (i < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = tabs[e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    next.focus(); next.click();
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
  omniSuggest, classify, goRoute, showLanding, pageCommand, evaluate, prettyPrint, highlightCode, saveBookmarks, saveHistory, getOrCreateFrame, setLoading, toggleSplitScreen, showAccountOptions, showSiteRecovery,
  syncAdminAccess, canOpenAdminPanel, groupActiveTab: () => groupTab(activeTab()),
  performanceTabs, parkTab, setPerformanceMode, syncBackgroundDiagnostics, shiftActiveTab, toggleTabPin
};
hooks.B = B;

function applyStartup(params) {
  if (currentRoute() !== "/browse" || params.get("url") || params.get("q") || location.hash) return;
  if (settings.startup === "url" && settings.startupUrl) { go(settings.startupUrl, { tab: activeTab(), push: false }); return; }
  if (!ephemeralSession() && settings.startup === "continue") {
    const urls = load("veyra-last-tabs", []).filter(u => /^https?:/.test(u));
    const first = urls.shift(); if (first) go(first, { tab: activeTab(), push: false });

    urls.forEach((u, i) => setTimeout(() => newTab({ url: u, background: true }), (i + 1) * 75));
  }
}
let lastStartupSnapshot;
setInterval(() => {
  if (document.hidden || ephemeralSession() || settings.startup !== "continue") return;
  const urls = state.tabs.filter(t => t.view === "page" && t.url).map(t => t.url);
  const snapshot = JSON.stringify(urls);
  if (snapshot !== lastStartupSnapshot) { lastStartupSnapshot = snapshot; save("veyra-last-tabs", urls); }
}, 3000);

async function boot() {
  try {
    wire();

    void ensureApiAwake();
    startIncognitoAddressRotation();
    cleanupUnfinishedSessionHistory();
    const params = new URLSearchParams(location.search);
    const r = params.get("veyra_route");
    if (r && /^\/?incognito\/?$/.test(r)) { location.replace(APP_BASE + "/browse?incognito=1"); return; }
    if (r) try {
      const path = r.startsWith("/") ? r : "/" + r;
      if (/^\/admin(?:\/[a-z-]+)?\/?$/.test(path)) {
        params.delete("veyra_route");
        const query = params.toString();
        history.replaceState({}, "", routeUrl(path.endsWith("/") ? path : `${path}/`) + (query ? `?${query}` : "") + location.hash);
      } else history.replaceState({}, "", APP_BASE + path);
    } catch {}
    const t = makeTab(); state.tabs.push(t); state.activeId = t.id;
    initUI(B); initDevtools(B);

    restoreTabState();
    renderTabs(); tickSession();
    if (!/^\/admin(?:\/|$)/.test(currentRoute())) await revisitSavedSession();
    applyRoute();
    applyStartup(params);

    addLog("info", `Veyra ${VERSION} ready · API ${API}`);
  } catch (e) { $("fatalOverlay").classList.remove("hidden"); $("fatalMessage").textContent = e.stack || e.message; console.error(e); }
}
boot();
