import { $, qsa, esc, api, rawFetch, API, APP_BASE, VERSION, hooks, settings, save, saveSettings, resetSettings, SEARCH_ENGINES, auth, setAuth, isAdmin, isMac, toast, confirmDialog, promptDialog, fmtClock, fmtBytes, copyText, debounce, getNeuralStats, CHROMIUM_TRY_DISABLED } from "./core.js?v=8.36.0-workbench";
import { openAuth, signOut, pushSync, COMMANDS, cmd, keysFor, prettyCombo, comboFromEvent } from "./ui.js?v=8.41.0-qr-links";
import { changeStudioAppearance, studioMarkup, wireStudio } from "./studio.js?v=5";
import { performanceMarkup } from "./velocity.js?v=2";
import { STREAM_PRESETS, streamPreset, measureVeyraConnection } from "./remote-frames.js?v=1";
import { settingsPins, settingSearchTerms, settingTextMatches } from "./settings-model.js?v=1";
import { BINDING_KEY_GROUPS, assignableBinding, buildShortcutBinding, shortcutClashes, storeShortcutKeys } from "./shortcuts-model.js?v=2";
import { GUIDES } from "./settings-guides.js?v=1";

let B;
const SECTIONS = [
  { id: "account", label: "You and Veyra", desc: "Sign-in, sync and account security", icon: "i-user" },
  { id: "appearance", label: "Appearance", desc: "Customization Studio: themes, wallpaper, layout and sound", icon: "i-sliders" },
  { id: "search", label: "Search engine", desc: "Default search engine and web results", icon: "i-search" },
  { id: "startup", label: "On startup", desc: "What opens when Veyra starts", icon: "i-home" },
  { id: "newtab", label: "New tab page", desc: "Shortcuts, recent sites and clock", icon: "i-tab" },
  { id: "privacy", label: "Privacy and security", desc: "Tracker blocking, incognito and clearing data", icon: "i-shield" },
  { id: "sessions", label: "Sessions", desc: "Session timer, warnings and auto-restart", icon: "i-timer" },
  { id: "downloads", label: "Downloads and history", desc: "Download and history limits", icon: "i-download" },
  { id: "accessibility", label: "Accessibility", desc: "Motion, focus rings and link styles", icon: "i-zoom" },
  { id: "performance", label: "Performance", desc: "Boost, stream quality, connection timing and tab parking", icon: "i-gauge" },
  { id: "shortcuts", label: "Keyboard shortcuts", desc: "View and rebind keyboard shortcuts", icon: "i-keyboard" },
  { id: "guides", label: "Video guides", desc: "Short tutorials for Settings, shortcuts and performance", icon: "i-info" },
  { id: "extensions", label: "Extensions", desc: "Installed and published extensions", icon: "i-puzzle" },
  { id: "vpn", label: "Veyra VPN", desc: "Exit locations and auto-connect", icon: "i-vpn" },
  { id: "system", label: "System and engine", desc: "Page engine, Chromium and timeouts", icon: "i-bolt" },
  { id: "neural", label: "Neural crawler", desc: "Trainable AI crawler and search optimisation", icon: "i-bolt" },
  { id: "developer", label: "Developer", desc: "DevTools, logging and diagnostics", icon: "i-code" },
  { id: "admin", label: "Server config", desc: "Server plan and runtime config", icon: "i-layers", admin: true },
  { id: "reset", label: "Reset settings", desc: "Restore default settings", icon: "i-reload" },
  { id: "about", label: "About Veyra", desc: "Version, server health and backend", icon: "i-info" }
];
const SECTION_GROUPS = [
  ["Personalization", ["account", "appearance", "startup", "newtab", "accessibility"]],
  ["Search and privacy", ["search", "privacy", "sessions", "downloads"]],
  ["Veyra features", ["performance", "shortcuts", "extensions", "vpn", "system", "neural", "guides"]],
  ["Advanced", ["developer", "admin", "reset", "about"]]
];

const icon = name => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
const row = (label, desc, ctl, extra = "") => `<div class="s-row" ${extra}><div class="s-label"><b>${esc(label)}</b>${desc ? `<span>${esc(desc)}</span>` : ""}</div><div class="s-ctl">${ctl}</div></div>`;
const toggle = (key, label, desc) => row(label, desc, `<input type="checkbox" class="switch" data-set="${key}" ${settings[key] ? "checked" : ""} aria-label="${esc(label)}">`);
const select = (key, label, desc, opts) => row(label, desc, `<select class="input" data-set="${key}" aria-label="${esc(label)}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(settings[key]) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`);
const number = (key, label, desc, min, max, step = 1) => row(label, desc, `<input type="number" class="input" style="min-width:120px;width:120px" data-set="${key}" data-num min="${min}" max="${max}" step="${step}" value="${esc(settings[key])}" aria-label="${esc(label)}">`);
const text = (key, label, desc, ph = "", type = "text") => row(label, desc, `<input type="${type}" class="input" data-set="${key}" placeholder="${esc(ph)}" value="${esc(settings[key] || "")}" aria-label="${esc(label)}" autocomplete="off">`);
const button = (label, desc, act, btnLabel, cls = "btn") => row(label, desc, `<button class="${cls}" data-act="${act}">${esc(btnLabel)}</button>`);
const radios = (key, opts) => `<div class="radio-list">${opts.map(([v, l, s]) => `<label class="radio-row"><input type="radio" name="r-${key}" data-set="${key}" value="${esc(v)}" ${String(settings[key]) === String(v) ? "checked" : ""}><span>${esc(l)}${s ? `<small>${esc(s)}</small>` : ""}</span></label>`).join("")}</div>`;
const section = (id, title, desc, body) => `<section class="s-section" id="s-${id}" data-section="${id}"><h2>${esc(title)}</h2>${desc ? `<p class="muted">${esc(desc)}</p>` : ""}<div class="s-card">${body}</div></section>`;

function accountSection() {
  if (!auth.user) return section("account", "You and Veyra", "Sign in to sync settings, bookmarks, extensions and notes across devices.",
    row("Not signed in", "You are browsing as a guest. Everything stays in this browser.", `<button class="btn" data-act="signin">Sign in</button><button class="btn primary" data-act="signup">Create account</button>`)
    );
  const u = auth.user;
  return section("account", "You and Veyra", "", `
    <div class="about-card"><div class="avatar" style="width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font:800 1.3rem var(--font-display)">${esc((u.name || u.email || "?")[0].toUpperCase())}</div><div><h3>${esc(u.name || "Veyra user")}</h3><div class="muted">${esc(u.email)}${isAdmin() ? " · Administrator" : ""}</div></div></div>
    ${row("Display name", "Shown on your profile and new tab page.", `<input class="input" id="accName" value="${esc(u.name || "")}" maxlength="60" aria-label="Display name"><button class="btn" data-act="saveName">Save</button>`)}
    ${button("Password", "Changing it signs out your other devices.", "changePassword", "Change password")}
    ${button("Sync now", "Pushes settings, bookmarks, extensions and notes to your account.", "syncNow", "Sync")}
    ${button("Sign out", "Your local data stays in this browser. Use the next option on a shared device.", "signOut", "Sign out")}
    ${button("Sign out and remove local account data", "Removes synced bookmarks, notes, extensions and shortcut tiles from this device.", "signOutLocal", "Sign out and remove data", "btn danger")}
    ${button("Sign out everywhere", "Revokes every token issued for this account.", "signOutAll", "Sign out everywhere")}
    ${button("Delete account", "Permanently removes your account and synced data.", "deleteAccount", "Delete account", "btn danger")}`);
}
const appearanceSection = () => studioMarkup({ row, toggle, select, number }, !!$("settingsSearch").value.trim());
function searchSection() {
  return section("search", "Search engine", "Used when you type something that isn't a URL in the address bar.", `
    ${radios("searchEngine", Object.entries(SEARCH_ENGINES).map(([k, e]) => [k, e.name, k === "veyra" ? "Built-in results through the Veyra crawler" : k === "custom" ? "Use your own URL with %s for the query" : ""]))}
    ${settings.searchEngine === "custom" ? text("customSearch", "Custom search URL", "Use %s where the query goes.", "https://example.com/search?q=%s") : ""}
    ${toggle("suggestions", "Show search and site suggestions", "Suggestions come from your history, bookmarks and tabs.")}`);
}
function startupSection() {
  return section("startup", "On startup", "", `
    ${radios("startup", [["newtab", "Open the New tab page"], ["continue", "Continue where you left off", "Reopens your last tabs (a new session is created)"], ["url", "Open a specific page"]])}
    ${settings.startup === "url" ? text("startupUrl", "Startup page", "", "https://example.com") : ""}
    ${text("homepage", "Home button page", "Leave empty to use the New tab page.", "https://example.com")}`);
}
function newtabSection() {
  return section("newtab", "New tab page", "", `
    ${toggle("ntpShortcuts", "Shortcut tiles", "Pinned sites you can edit on the New tab page.")}
    ${toggle("ntpRecent", "Recent sites", "Shows recently visited pages.")}
    ${toggle("ntpClock", "Clock and greeting", "")}
    ${button("Reset shortcut tiles", "Restores the default tiles.", "resetTiles", "Reset")}`);
}
function privacySection() {
  return section("privacy", "Privacy and security", "", `
    ${button("Clear browsing data", "History, downloads, cookies and engine cache.", "clearData", "Clear data")}
    ${button("Incognito window", "Hide the screen from the browser menu or by switching away. Device Cast is disabled. The web app can’t block external cameras or OS-level capture.", "incognito", "Open incognito window")}
    ${row("Session cache", "Signed-in, non-incognito sessions may keep eligible responses in server memory until the session ends. Guest and incognito sessions skip the cache.", `<span class="chip">Session-scoped</span>`)}
    ${row("Global cache", "Only eligible public static files may be shared. MongoDB is optional and is not used to save temporary session cookies or page snapshots.", `<span class="chip">Public assets</span>`)}
    ${toggle("challengeHandoff", "Hand security checks to real Chromium", "When a site shows a Cloudflare or captcha check, reopen it in Chromium so you can complete it yourself. Veyra never solves checks for you.")}
    ${toggle("blockTrackers", "Block trackers", "The server refuses requests to known ad and tracking hosts.")}
    ${toggle("doNotTrack", "Send a Do Not Track request", "Sends the preference to the active session. Veyra warns if the server does not acknowledge support.")}
    ${toggle("clearHistoryOnSessionEnd", "Clear local history when a session ends", "Server session cookies are always deleted when the session closes.")}
    ${toggle("warnBeforeClose", "Warn before closing with several tabs open", "")}`);
}
function sessionsSection() {
  const lim = B.state.serverLimitMs || B.state.session?.limitMs || 0;
  const s = B.state.session; const left = s ? Math.max(0, s.expiresAt - Date.now()) : 0;
  return section("sessions", "Sessions", "Each browsing session has a time limit so server resources are freed quickly.", `
    ${row("Session time limit", lim ? `Set by the server: sessions end after ${fmtClock(lim)} and are deleted.` : "The server did not report a limit.", `<span class="chip">${lim ? fmtClock(lim) : "—"}</span>`)}
    ${row("Current session", s ? `ID ${esc(s.id.slice(0, 8))}… · started ${new Date(s.startedAt).toLocaleTimeString()}` : "No active session. One starts when you open a page.", `<span class="chip" id="setSessLeft">${s ? Number.isFinite(left) ? fmtClock(left) + " left" : "No time limit" : "Idle"}</span>${s ? `<button class="btn danger" data-act="endSession">End session now</button>` : ""}`)}
    ${toggle("sessionWarnings", "Warn before a session ends", "Shows a warning 30 and 10 seconds before the limit.")}
    ${toggle("autoRestartSession", "Start a new session automatically", "When a signed-in, non-incognito session ends, reopen its tabs in a fresh session. Guest and incognito tabs aren’t restored.")}
    ${row("Sign-in method", "Compatible sites use this Fast Proxy session. Google and GitHub account pages offer a direct browser tab instead. No login session is copied back into Veyra.", `<span class="chip">Site dependent</span>`)}
    ${toggle("clearHistoryOnSessionEnd", "Clear local history when a session ends", "Server session cookies are always deleted when the session closes.")}`);
}
function downloadsSection() {
  return section("downloads", "Downloads and history", "", `
    ${toggle("downloadsOpenOnStart", "Show a notice when a download starts", "")}
    ${number("downloadsMax", "Downloads kept in the list", "", 10, 2000, 10)}
    ${number("historyMax", "History entries kept", "", 50, 10000, 50)}
    ${row("Downloads", `${B.state.downloads.length} items`, `<button class="btn" data-act="openDownloads">Open downloads</button>`)}
    ${row("History", `${B.state.history.length} entries`, `<button class="btn" data-act="openHistory">Open history</button>`)}`);
}
function a11ySection() {
  return section("accessibility", "Accessibility", "", `
    ${toggle("reduceMotion", "Reduce motion", "Turns off interface animations.")}
    ${toggle("focusRings", "Always show focus rings", "Makes keyboard focus visible everywhere.")}
    ${toggle("linkUnderline", "Underline links", "In Veyra pages.")}`);
}
const shortcutGroups = () => [...new Set(COMMANDS.map(c => c.group))];
const keyBadge = key => `<kbd>${esc(prettyCombo(key))}</kbd>`;
function shortcutRow(c) {
  const keys = keysFor(c.id), custom = Array.isArray(settings.shortcuts?.[c.id]);
  const status = custom ? keys.length ? "Custom" : "Disabled" : keys.length ? "" : "Not assigned";
  const label = `${c.label} ${c.group} ${c.keywords || ""} ${keys.map(prettyCombo).join(" ")} ${status}`.toLowerCase();
  return `<li class="s-row shortcut-row" data-shortcut-row="${c.id}" data-label="${esc(label)}"><div class="s-label"><b>${esc(c.label)}</b>${status ? `<span>${status}</span>` : ""}</div>
    <div class="shortcut-row-actions"><span class="shortcut-keys">${keys.map(keyBadge).join("")}</span><button type="button" class="btn ghost sm" data-rebind="${c.id}" aria-label="Edit ${esc(c.label)}">Edit</button></div></li>`;
}
function shortcutsSection() {
  const groups = shortcutGroups();
  return `<section class="s-section shortcuts-panel" id="s-shortcuts" data-section="shortcuts"><h2>Keyboard shortcuts</h2>
    <p class="muted">Set up to three key combinations per command, or leave a command unbound. You can edit by touch. To use a shortcut, connect a keyboard; system shortcuts and embedded players can take priority.</p>
    <div class="shortcut-toolbar"><input type="search" class="input" data-shortcut-filter aria-label="Find a command" placeholder="Find a command…">
    <select class="input" data-shortcut-category aria-label="Command category"><option value="">All categories</option>${groups.map(g => `<option>${esc(g)}</option>`).join("")}</select>
    <button type="button" class="btn ghost sm" data-act="resetShortcuts">Restore all defaults</button></div>
    <p class="shortcut-count muted" data-shortcut-count role="status">${COMMANDS.length} commands</p>
    <div class="shortcut-groups">${groups.map(g => `<section data-shortcut-group="${esc(g)}"><h3>${esc(g)}</h3><ul class="s-card">${COMMANDS.filter(c => c.group === g).map(shortcutRow).join("")}</ul></section>`).join("")}</div>
    </section>`;
}
function guidesSection() {
  return `<section class="s-section" id="s-guides" data-section="guides"><h2>Video guides</h2><p class="muted">Three short, silent motion-graphics tutorials. Videos load only when you choose one.</p><div class="guide-list">${GUIDES.map((g, i) => `<article class="guide-card s-row" data-label="${esc(`${g.title} ${g.description}`)}"><div class="guide-meta"><span>Guide ${String(i + 1).padStart(2, "0")}</span><span>${g.time}</span></div><h3>${esc(g.title)}</h3><p>${esc(g.description)}</p><div class="guide-actions"><button type="button" class="btn" data-guide="${g.id}" aria-label="Watch ${esc(g.title)}">Watch video</button><button type="button" class="linkish" data-snav="${g.section}">${esc(g.link)}</button></div><details><summary>Read the steps</summary><ol>${g.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol></details></article>`).join("")}</div></section>`;
}
function extensionsSection() {
  return section("extensions", "Extensions", "", `
    ${row("Manage extensions", "Install CSS from the Veyra Store, review imported extensions, or pin compatible toolbar actions.", `<button class="btn" data-act="openExtensions">Open extensions</button>`)}
    ${toggle("extensionDeveloperMode", "Developer mode", "Load local CSS packages or compatible unpacked Chrome and Edge extensions.")}`);
}
function vpnSection() {
  return section("vpn", "Veyra VPN", "", `
    ${row("Status", B.state.vpn?.connected ? `Connected to ${B.state.vpn.profile?.name || "an exit"}` : "Not connected", `<button class="btn" data-act="openVpn">Open VPN</button>`)}
    ${row("Connect automatically", settings.vpnAutoProfile ? `New sessions use ${settings.vpnAutoProfile}.` : "Off. Choose an exit in the VPN page.", settings.vpnAutoProfile ? `<button class="btn" data-act="vpnAutoOff">Turn off</button>` : "")}
    <div class="s-row" style="display:block">
      <div class="s-label"><b>Your VPN profiles</b><span>Add your own VPN provider, run a VeyraVPN Node at home, or import a WireGuard config. Profiles are saved to your account and sync across sessions.</span></div>
      <div class="custom-vpn-list" id="customVpnList"><span class="muted small">Loading…</span></div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-act="addCustomVpn">Add VPN provider</button>
        <button class="btn ghost" data-act="importVpnConfig">Import WireGuard config</button>
        <button class="btn ghost" data-act="importVeyraNodeCode">Paste Veyra Node code</button>
        <button class="btn ghost" data-act="runVeyraNode">Run VeyraVPN Node</button>
      </div>
    </div>`);
}
function systemSection() {
  return section("system", "System and engine", "How Veyra loads pages.", `
    ${toggle("youtubeInline", "Inline YouTube player", "Use YouTube’s official player in the video area on eligible watch pages. The player connects directly to YouTube and is off with Veyra VPN or private browsing.")}
    ${select("runtime", "Page loading strategy", "Choose the engines Veyra may use. Fast proxy is the recommended default: it renders most sites quickly without a heavyweight browser. The crawler accelerates the current page only: the proxy paints first, critical assets start early, then bounded discovery warms additional required assets without crawling the whole site during your session.", [["proxy", "Fast proxy (recommended)"], ["crawler", "Fast proxy + page accelerator"], ["combined", "All combined (fastest adaptive)"], ["auto", "Automatic"]])}
    ${CHROMIUM_TRY_DISABLED ? "" : toggle("browserFallback", "Allow Chromium fallback", "In Automatic and Proxy + crawler modes, use Chromium when the lightweight renderer cannot handle a site.")}
    ${toggle("autoStopPrevious", "Stop the previous crawl when navigating", "Saves server resources.")}
    ${toggle("confirmCloseWithCrawl", "Confirm before closing a tab that is still crawling", "")}
    ${number("requestTimeoutMs", "Request timeout (ms)", "", 3000, 120000, 1000)}`);
}
function neuralSection() {
  return section("neural", "Neural crawler", "The trainable AI crawler learns from your browsing to prioritise which pages to index, and re-ranks search results by predicted relevance.", `
    ${toggle("neuralCrawlerEnabled", "Enable neural crawler", "Turn on the trainable model that learns from your clicks and bookmarks.")}
    ${toggle("neuralCrawlerRetrainOnFeedback", "Retrain on feedback", "Send click and bookmark signals to the server to retrain the model in real time.")}
    ${toggle("neuralCrawlerParallelSearch", "Parallel search", "Query multiple search providers at once and merge the best results.")}
    ${toggle("neuralCrawlerQueryExpansion", "Query expansion", "Add spell corrections and related terms to improve search coverage.")}
    ${toggle("neuralCrawlerBlockTrackers", "Block trackers in Chromium", "Block ads, analytics and tracking scripts in Chromium pages for faster loads.")}
    ${toggle("neuralCrawlerPrewarm", "Pre-warm Chromium contexts", "Create browser contexts ahead of time for faster first navigation.")}
    ${toggle("neuralCrawlerProgressiveRender", "Progressive rendering", "Take an early screenshot after DOMContentLoaded instead of waiting for full load.")}
    <div class="s-row" style="display:block"><div class="s-label"><b>Neural model stats</b><span>Live training statistics from the server.</span></div><div id="neuralStats" class="muted" style="margin-top:8px" role="status">Select Refresh to load stats.</div></div>
    ${button("Refresh stats", "Fetch the latest neural model statistics from the server.", "refreshNeuralStats", "Refresh")}
    ${button("Reset neural model", "Clear all learned weights and start fresh.", "resetNeuralModel", "Reset model", "btn danger")}`);
}
function developerSection() {
  return section("developer", "Developer", "Options for the built-in developer tools.", `
    ${select("devtoolsDock", "Dock DevTools", "", [["bottom", "Bottom"], ["right", "Right"]])}
    ${toggle("preserveLog", "Preserve log on navigation", "Keeps console and network entries between pages.")}
    ${toggle("captureBodies", "Capture response bodies", "Needed for the Response tab in Network.")}
    ${select("consoleVerbosity", "Console verbosity", "", [["debug", "Verbose"], ["info", "Info"], ["warn", "Warnings"], ["error", "Errors only"]])}
    ${isAdmin() ? number("devRefreshMs", "Dev panel refresh (ms)", "", 500, 30000, 500) : ""}
    ${isAdmin() ? text("adminToken", "Admin token", "Sent as X-Veyra-Admin-Token. Stored only in this browser.", "", "password") : ""}`);
}
function adminSection() {
  return `<section class="s-section" id="s-admin" data-section="admin"><h2>Server config</h2><p class="muted">Visible to administrators only. Plan changes need edit access (localhost in development or the admin token).</p>
    <div class="s-card"><div class="s-row"><div class="s-label"><b>Render plan</b><span id="cfgPlanDesc">Loading…</span></div><div class="s-ctl"><select class="input" id="cfgPlan" disabled></select><button class="btn" data-act="applyPlan" id="cfgApply" disabled>Apply</button></div></div>
    <div class="s-row" style="display:block"><pre class="json-view" id="cfgView" style="max-height:340px;overflow:auto;margin:0">Loading…</pre></div></div></section>`;
}
function resetSection() {
  return section("reset", "Reset settings", "", button("Restore settings to their defaults", "Bookmarks, history and extensions are kept.", "reset", "Reset settings", "btn danger"));
}
function aboutSection() {
  return `<section class="s-section" id="s-about" data-section="about"><h2>About Veyra</h2><div class="s-card">
    <div class="about-card"><svg aria-label="Veyra"><use href="#logo"/></svg><div><h3>Veyra</h3><div class="muted">Version ${esc(VERSION)} · session browser</div></div></div>
    ${row("Backend", API, `<button class="btn" data-act="copyApi">Copy</button>`)}
    ${row("Server health", "", `<span class="chip" id="aboutHealth">Checking…</span>`)}
    ${row("Server details", "", `<span class="muted" id="aboutInfo" style="font-size:.87em;text-align:right"></span>`)}
  </div></section>`;
}

const PARTS = { account: accountSection, appearance: appearanceSection, search: searchSection, startup: startupSection, newtab: newtabSection, privacy: privacySection, sessions: sessionsSection, downloads: downloadsSection, accessibility: a11ySection, performance: () => performanceMarkup(B, settings, esc), shortcuts: shortcutsSection, guides: guidesSection, extensions: extensionsSection, vpn: vpnSection, system: systemSection, neural: neuralSection, developer: developerSection, admin: adminSection, reset: resetSection, about: aboutSection };
export function visibleSections() { return SECTIONS.filter(s => !s.admin || isAdmin()); }
export function sectionExists(id) { return visibleSections().some(s => s.id === id); }
let lastRendered = null;
let searchIndex = null;
let navStamp = "";
const curSection = () => { const t = B?.activeTab?.(); return t && t.view === "settings" ? t.section || "" : ""; };
const navItem = s => `<button type="button" class="snav" data-snav="${s.id}">${icon(s.icon)}<span>${esc(s.label)}</span></button>`;
const pinButton = (s, pinned) => `<button type="button" class="deck-pin" data-deck-pin="${s.id}" aria-pressed="${pinned}" aria-label="${pinned ? "Unpin" : "Pin"} ${esc(s.label)}">${icon("i-star")}</button>`;
const pinnedLink = s => `<button type="button" data-snav="${s.id}">${icon(s.icon)}${esc(s.label)}</button>`;
function syncPinnedButtons(root, pins, byId, markup) {
  const previous = new Map([...root.children].filter(node => node.dataset.snav).map(node => [node.dataset.snav, node]));
  for (const [id, node] of previous) if (!pins.includes(id)) node.remove();
  let prior = root.firstElementChild;
  for (const id of pins) {
    const node = previous.get(id);
    if (!node) prior.insertAdjacentHTML("afterend", markup(byId.get(id)));
    else if (prior.nextElementSibling !== node) prior.after(node);
    prior = prior.nextElementSibling;
  }
}
function syncPinLists(byId, pins) {
  const group = $("settingsNavPins");
  const tags = pins.join(" ");
  if (group && group.dataset.pins !== tags) {
    group.hidden = !pins.length;
    group.dataset.pins = tags;
    syncPinnedButtons(group, pins, byId, navItem);
  }
  const list = $("deckPinnedList");
  if (list && list.dataset.pins !== tags) {
    list.dataset.pins = tags;
    list.firstElementChild.hidden = !!pins.length;
    syncPinnedButtons(list, pins, byId, pinnedLink);
  }
}
function syncNavigation(byId, pins, current) {
  const nav = $("settingsNav");
  const stamp = [...byId.keys()].join(" ");
  if (stamp !== navStamp) {
    navStamp = stamp;
    nav.innerHTML = navItem({ id: "", label: "Overview", icon: "i-grid" }) + `<div class="snav-group" id="settingsNavPins" hidden><span class="snav-group-label">Pinned</span></div>`
      + SECTION_GROUPS.map(([group, ids]) => `<div class="snav-group"><span class="snav-group-label">${esc(group)}</span>${ids.filter(id => byId.has(id)).map(id => navItem(byId.get(id))).join("")}</div>`).join("");
  }
  syncPinLists(byId, pins);
  syncCurrentNav(nav, current);
}
function syncCurrentNav(nav, current) {
  const prev = nav.querySelector('[aria-current="page"]');
  const selector = `button[data-snav="${current}"]`;
  const next = current === null ? null : $("settingsNavPins").querySelector(selector) || nav.querySelector(selector);
  if (prev !== next) {
    prev?.classList.remove("on"); prev?.removeAttribute("aria-current");
    next?.classList.add("on"); next?.setAttribute("aria-current", "page");
    if (next && matchMedia("(max-width:840px)").matches) {
      const item = next.getBoundingClientRect(), rail = nav.getBoundingClientRect();
      nav.scrollLeft += Math.max(0, item.right - rail.right) || Math.min(0, item.left - rail.left);
    }
  }
}
function overview(byId, pins) {
  const card = s => `<div class="deck-directory-item"><button type="button" class="s-home-card" data-snav="${s.id}"><span class="s-home-ic">${icon(s.icon)}</span><span class="s-home-txt"><b>${esc(s.label)}</b><small>${esc(s.desc)}</small></span></button>${pinButton(s, pins.includes(s.id))}</div>`;
  return `<header class="deck-overview"><div><h1>Settings</h1><p>Find a control or pin a section for quick access.</p></div><button type="button" class="btn ghost" data-snav="guides">${icon("i-info")} Video guides</button></header>
    <section class="deck-pinned"><h2>Pinned sections</h2><div class="deck-pinned-list" id="deckPinnedList" data-pins="${pins.join(" ")}"><p ${pins.length ? "hidden" : ""}>No pins yet. Use a star in the directory below.</p>${pins.map(id => pinnedLink(byId.get(id))).join("")}</div></section>
    <div class="deck-directory">${SECTION_GROUPS.map(([group, ids]) => `<section class="deck-group"><h2>${esc(group)}</h2><div class="s-home-grid">${ids.filter(id => byId.has(id)).map(id => card(byId.get(id))).join("")}</div></section>`).join("")}</div>`;
}
function render(active, reuseSearch = false) {
  const body = $("settingsBody");
  const visible = visibleSections();
  const cur = visible.find(s => s.id === active) ? active : "";
  const q = $("settingsSearch").value.trim();
  if (q && reuseSearch && searchIndex && searchIndex.admin === isAdmin()) { filter(q); return; }
  searchIndex = null;
  const t = B?.activeTab?.();
  if (t && t.view === "settings" && active && !cur) t.section = "";
  const byId = new Map(visible.map(s => [s.id, s]));
  const pins = settingsPins(settings.deckPins, byId.keys());
  syncNavigation(byId, pins, q ? null : cur);
  if (q) {
    body.innerHTML = `<header class="deck-search-head"><h1>Search settings</h1><p id="settingsResultCount" role="status"></p></header><div id="settingsResults"></div><p class="muted s-empty" id="settingsEmpty" hidden>No settings match your search.</p>`;
    const view = document.createElement("template");
    view.innerHTML = visible.map(s => PARTS[s.id]()).join("");
    searchIndex = { admin: isAdmin(), entries: [...view.content.querySelectorAll(".s-section")].map(sec => {
      const s = byId.get(sec.dataset.section);
      if (s) sec.insertAdjacentHTML("afterbegin", `<button type="button" class="deck-search-open" data-snav="${s.id}">Open ${esc(s.label)} ${icon("i-forward")}</button>`);
      const rows = [...sec.querySelectorAll(".s-row,.radio-row,.studio-preset,.studio-wallpaper")].map(el => [
        el, (el.classList.contains("guide-card") ? el.dataset.label : `${el.textContent} ${el.dataset.label || ""}`).toLowerCase()
      ]);
      return { sec, rows, hits: [], text: `${s?.label || ""} ${s?.desc || ""} ${sec.querySelector("h2")?.textContent || ""}`.toLowerCase() };
    }) };
    filter(q);
  } else if (!cur) {
    body.innerHTML = overview(byId, pins);
  } else {
    const meta = visible.find(s => s.id === cur);
    body.innerHTML = `<div class="deck-section-bar"><nav class="s-crumbs" aria-label="Breadcrumb"><button class="linkish" data-snav="">Settings</button><span aria-hidden="true">›</span><span>${esc(meta.label)}</span></nav>${pinButton(meta, pins.includes(cur))}</div>` + PARTS[cur]();
  }
  hooks.updateStudioPreview?.();
  if (lastRendered !== `${cur}|${q}`) $("view-settings").scrollTop = 0;
  lastRendered = `${cur}|${q}`;
  if (!q && cur === "about") loadAbout();
  if (!q && cur === "neural") void loadNeuralStats();
  if (!q && cur === "vpn") renderVpnList();
  if (!q && cur === "admin" && isAdmin()) loadAdmin();
}

async function loadNeuralStats() {
  const el = $("neuralStats");
  if (!el) return;
  el.textContent = "Loading…";
  const { model, trainer } = (await getNeuralStats()) || {};
  if (!el.isConnected) return;
  const metrics = [["Training examples", model?.trainingExamples], ["Feedback signals", model?.feedbackCount], ["Queued", trainer?.queueSize]];
  const counts = metrics.filter(([, value]) => Number.isFinite(value)).map(([label, value]) => `${label}: ${value.toLocaleString()}`);
  el.textContent = counts.length ? counts.join(" · ") : "Stats are currently unavailable.";
}

async function loadAbout() {
  try {
    const r = await rawFetch(API + "/health", { credentials: "omit" }); const j = await r.json().catch(() => ({}));
    const el = $("aboutHealth"); if (!el) return;
    el.textContent = r.ok ? "Healthy" : `HTTP ${r.status}`; el.style.color = r.ok ? "var(--ok)" : "var(--err)";
    const info = []; if (j.version) info.push(`v${j.version}`); if (j.plan) info.push(`plan ${j.plan}`); if (j.uptimeSec != null) info.push(`up ${Math.round(j.uptimeSec / 60)} min`); if (j.sessions != null) info.push(`${j.sessions} sessions`); if (j.memoryLimitMb) info.push(`${fmtBytes(j.memoryLimitMb * 1048576)} memory`); if (j.sleeping) info.push("sleeping");
    $("aboutInfo").textContent = info.join(" · ");
  } catch (e) { const el = $("aboutHealth"); if (el) { el.textContent = "Unreachable"; el.style.color = "var(--err)"; } }
}
async function loadAdmin() {
  try {
    const [cfg, plans] = await Promise.all([api("/api/config"), api("/api/config/plans").catch(() => null)]);
    const v = $("cfgView"); if (!v) return;
    v.textContent = JSON.stringify({ config: cfg.config, runtime: cfg.runtime }, null, 2);
    const sel = $("cfgPlan");
    if (plans?.plans) { sel.innerHTML = plans.plans.map(p => `<option value="${esc(p.key)}" ${p.key === plans.current ? "selected" : ""}>${esc(p.label || p.key)} · ${p.ramMb} MB / ${p.cpu} CPU</option>`).join(""); }
    sel.disabled = !cfg.editable; $("cfgApply").disabled = !cfg.editable;
    $("cfgPlanDesc").textContent = cfg.editable ? `Current plan: ${plans?.current || "unknown"}. Changes are written to veyra.config.json.` : `Current plan: ${plans?.current || "unknown"}. Read-only here: change veyra.config.json and redeploy.`;
  } catch (e) { const v = $("cfgView"); if (v) v.textContent = `Could not load config: ${e.message}`; }
}

function filter(q) {
  const terms = settingSearchTerms(q);
  const result = $("settingsResults");
  const matches = [];
  for (const entry of searchIndex.entries) {
    const { sec, rows, text } = entry;
    const hits = rows.filter(([, label]) => settingTextMatches(label, terms)).map(([el]) => el);
    if (hits.length || settingTextMatches(text, terms)) {
      for (const el of entry.hits) if (!hits.includes(el)) el.classList.remove("hit");
      for (const el of hits) if (!entry.hits.includes(el)) el.classList.add("hit");
      entry.hits = hits;
      matches.push(sec);
    } else if (sec.parentElement === result) sec.remove();
  }
  matches.forEach((sec, i) => { if (result.children[i] !== sec) result.insertBefore(sec, result.children[i] || null); });
  const count = matches.length;
  $("settingsResultCount").textContent = `${count} matching ${count === 1 ? "section" : "sections"} for “${q}”`;
  $("settingsEmpty").hidden = !!count;
}

function setValue(el) {
  const key = el.dataset.set; let v;
  if (el.type === "checkbox") v = el.checked;
  else if (el.type === "radio") { if (!el.checked) return; v = el.value; }
  else if (el.dataset.num !== undefined || el.type === "number") { v = Number(el.value); const min = Number(el.min), max = Number(el.max); if (!Number.isFinite(v)) return; if (el.min) v = Math.max(min, v); if (el.max) v = Math.min(max, v); }
  else v = el.value;
  if (["fontScale", "zoomDefault"].includes(key)) v = Number(v);
  if (key === "customSearch" && v && !/%s/.test(v)) { toast("Custom search URL needs %s", { kind: "err" }); return; }
  if (el.closest(".studio")) {
    if (changeStudioAppearance({ [key]: v })) toast("Appearance updated", { ms: 1200 });
    return;
  }
  settings[key] = v; saveSettings();
  if (key === "youtubeInline" && v === false) hooks.disableInlineYouTube?.();
  if (key === "blockTrackers" || key === "doNotTrack") {
    hooks.applyExtensionsToTab?.(B.activeTab());
    hooks.updateSessionPreferences?.().catch(e => toast(`Couldn't update active-session privacy controls: ${e.message}`, { kind: "err" }));
  }
  if (["searchEngine", "startup", "extensionDeveloperMode"].includes(key)) render(B.activeTab()?.section || "");
  else toast("Setting saved", { ms: 1200 });
}

async function act(a, el) {
  const nav = v => B.openInternal(v);
  switch (a) {
    case "signin": return openAuth("login");
    case "signup": return openAuth("signup");
    case "saveName": {
      const name = $("accName").value.trim(); if (!name) return toast("Name can't be empty", { kind: "err" });
      try { const r = await api("/api/auth/me", { method: "PATCH", json: { name } }); setAuth(r.token || auth.token, r.user); toast("Name updated"); render(curSection()); } catch (e) { toast(e.message, { kind: "err" }); } return;
    }
    case "changePassword": {
      const v = await promptDialog({ title: "Change password", ok: "Change password", fields: [{ name: "currentPassword", label: "Current password", type: "password" }, { name: "password", label: "New password (8+ characters)", type: "password" }] });
      if (!v) return; if (String(v.password || "").length < 8) return toast("New password must be at least 8 characters", { kind: "err" });
      try { const r = await api("/api/auth/me", { method: "PATCH", json: { password: v.password, currentPassword: v.currentPassword } }); setAuth(r.token, r.user); toast("Password changed. Other devices were signed out."); } catch (e) { toast(e.message, { kind: "err" }); } return;
    }
    case "syncNow": try { await pushSync(); toast("Synced"); } catch (e) { toast(e.message, { kind: "err" }); } return;
    case "incognito": hooks.openIncognitoWindow?.(); return;
    case "signOut": await signOut(); return render(curSection());
    case "signOutLocal": await signOut({ forgetLocal: true }); return render(curSection());
    case "signOutAll": if (await confirmDialog("Sign out everywhere?", "Every device using this account will be signed out.", "Sign out everywhere")) { await signOut({ everywhere: true }); render(curSection()); } return;
    case "deleteAccount": {
      const v = await promptDialog({ title: "Delete account", ok: "Delete forever", fields: [{ name: "password", label: "Confirm with your password", type: "password" }] });
      if (!v) return;
      try { await api("/api/auth/me", { method: "DELETE", json: { password: v.password } }); setAuth("", null); toast("Account deleted"); render(curSection()); } catch (e) { toast(e.message, { kind: "err" }); } return;
    }
    case "resetTiles": settings.ntpTiles = null; saveSettings(); return toast("Tiles restored");
    case "clearData": return hooks.openClearData?.();
    case "endSession": if (await confirmDialog("End session now?", "Your page tabs close and the server deletes the session.", "End session")) { await B.endSession("manual"); render(curSection()); } return;
    case "openDownloads": return nav("downloads");
    case "openHistory": return nav("history");
    case "openExtensions": return nav("extensions");
    case "openVpn": return nav("vpn");
    case "vpnAutoOff": settings.vpnAutoProfile = ""; saveSettings(); return render(curSection());
    case "addCustomVpn": {
      const r = await promptDialog({ title: "Add VPN provider", ok: "Add", fields: [
        { name: "name", label: "Name", value: "", placeholder: "My VPN", required: true },
        { name: "type", label: "Type", type: "select", value: "socks5", options: ["socks5", "http", "https", "wireguard"] },
        { name: "server", label: "Server address", value: "", placeholder: "host:port (e.g. 1.2.3.4:1080)" },
        { name: "username", label: "Username", value: "", placeholder: "Optional" },
        { name: "password", label: "Password", value: "", placeholder: "Optional", type: "password" },
        { name: "region", label: "Region", value: "", placeholder: "e.g. UK, US, DE" }
      ] });
      if (!r || !r.name) return;
      try {
        await api("/api/vpn/custom", { method: "POST", json: r });
        toast("VPN profile saved" + (r.type === "wireguard" ? " to server" : ""));
      } catch (e) { toast(`Failed: ${e.message}`, { kind: "err" }); }
      renderVpnList();
      return;
    }
    case "importVpnConfig": {
      const r = await promptDialog({ title: "Import WireGuard config", ok: "Import", fields: [
        { name: "name", label: "Name", value: "", placeholder: "My WireGuard VPN", required: true },
        { name: "config", label: "WireGuard config", type: "textarea", value: "", placeholder: "[Interface]\nPrivateKey = ...\n[Peer]\nPublicKey = ...\nEndpoint = host:port" }
      ] });
      if (!r || !r.config) return;
      try {
        await api("/api/vpn/custom", { method: "POST", json: { name: r.name, type: "wireguard", config: r.config } });
        toast("WireGuard config imported and saved to server");
      } catch (e) { toast(`Failed: ${e.message}`, { kind: "err" }); }
      renderVpnList();
      return;
    }
    case "importVeyraNodeCode": {
      const r = await promptDialog({ title: "Paste Veyra Node code", ok: "Add node", fields: [
        { name: "code", label: "Temporary node code", value: "", placeholder: "VNODE1.…", required: true }
      ] });
      if (!r?.code) return;
      try {
        const p = await decodeVeyraNodeCode(r.code);
        await api("/api/vpn/custom", { method: "POST", json: { name: p.name, type: "socks5", server: p.server, username: p.username, password: p.password, region: p.region, publicIp: p.publicIp, source: "node" } });
        toast(`${p.name || "Veyra Node"} added`);
      } catch (e) { toast(`Invalid or expired node code: ${e.message}`, { kind: "err" }); }
      renderVpnList();
      return;
    }
    case "runVeyraNode": {
      showVeyraNodeGuide();
      return;
    }
    case "refreshNeuralStats": return loadNeuralStats();
    case "resetNeuralModel": {
      if (!await confirmDialog("Reset neural model?", "This clears all learned weights and training data. The model will start learning from scratch.", "Reset model")) return;
      try { await api("/api/neural/reset", { method: "POST", json: {} }); toast("Neural model reset"); loadNeuralStats(); } catch (e) { toast(e.message, { kind: "err" }); } return;
    }
    case "resetShortcuts": {
      if (!await confirmDialog("Restore all shortcut defaults?", "Custom bindings and disabled commands will return to their defaults.", "Restore defaults")) return;
      applyShortcuts({});
      toast("Shortcuts restored");
      return $("settingsBody").querySelector("[data-act=resetShortcuts]")?.focus();
    }
    case "reset": if (await confirmDialog("Reset settings?", "All settings go back to their defaults. Bookmarks, history and extensions are kept.", "Reset")) { resetSettings(); toast("Settings reset"); render(curSection()); } return;
    case "copyApi": return copyText(API);
    case "applyPlan": {
      const plan = $("cfgPlan").value;
      try { await api("/api/config", { method: "PUT", json: { plan } }); toast(`Plan set to ${plan}. Restart the server to apply every limit.`); loadAdmin(); } catch (e) { toast(e.message, { kind: "err" }); } return;
    }
  }
}

function filterShortcuts(panel) {
  const query = settingSearchTerms(panel.querySelector("[data-shortcut-filter]").value);
  const category = panel.querySelector("[data-shortcut-category]").value;
  let total = 0;
  for (const group of panel.querySelectorAll("[data-shortcut-group]")) {
    let matched = 0;
    const allowed = !category || group.dataset.shortcutGroup === category;
    for (const row of group.querySelectorAll("[data-shortcut-row]")) {
      row.hidden = !allowed || !settingTextMatches(row.dataset.label, query);
      matched += Number(!row.hidden);
    }
    group.hidden = !matched;
    total += matched;
  }
  panel.querySelector("[data-shortcut-count]").textContent = total ? `${total} ${total === 1 ? "command" : "commands"}` : "No matching commands";
}

function applyShortcuts(overrides) {
  const before = settings.shortcuts;
  settings.shortcuts = overrides;
  saveSettings({ refresh: false });
  if (searchIndex) return render(curSection());
  const panel = $("s-shortcuts");
  if (!panel) return;
  for (const id of new Set([...Object.keys(before || {}), ...Object.keys(overrides)])) {
    if (cmd(id) && before?.[id] !== overrides[id]) panel.querySelector(`[data-shortcut-row="${id}"]`).outerHTML = shortcutRow(cmd(id));
  }
  filterShortcuts(panel);
}

function startRebind(btn) {
  const command = cmd(btn.dataset.rebind);
  if (!command) return;
  const { id, label } = command;
  let draft = [...keysFor(id)], reset = false, clashState = "";
  const touch = matchMedia("(pointer: coarse)").matches;
  const modifiers = [["Mod", isMac ? "Command" : "Ctrl"], [isMac ? "Ctrl" : "Meta", isMac ? "Ctrl" : "Meta"], ["Alt", isMac ? "Option" : "Alt"], ["Shift", "Shift"]];
  const keyLabels = { PageUp: "Page Up", PageDown: "Page Down", Esc: "Escape" };
  const dialog = document.createElement("dialog");
  dialog.className = "modal shortcut-editor";
  dialog.setAttribute("aria-labelledby", "shortcutEditorTitle");
  dialog.innerHTML = `<form class="modal-card" method="dialog"><h2 id="shortcutEditorTitle" tabindex="-1" ${touch ? "autofocus" : ""}>${esc(label)}</h2>
    <p class="muted">Add up to three combinations by touch or with a keyboard.</p><ul class="shortcut-draft" aria-label="Current bindings"></ul>
    <fieldset class="shortcut-builder"><legend>Build a combination</legend>
      <div class="shortcut-modifiers">${modifiers.map(([value, name]) => `<label><input type="checkbox" value="${value}" data-shortcut-modifier> ${name}</label>`).join("")}</div>
      <div class="shortcut-builder-key"><label for="shortcutEditorKey">Key</label><select id="shortcutEditorKey" class="input">
        <option value="">Choose a key</option>${BINDING_KEY_GROUPS.map(([group, keys]) => `<optgroup label="${group}">${keys.map(key => `<option value="${esc(key)}">${esc(keyLabels[key] || key)}</option>`).join("")}</optgroup>`).join("")}
      </select><button class="btn" type="button" data-build-binding disabled>Add</button></div>
    </fieldset>
    <button class="btn shortcut-capture" type="button" data-capture ${touch ? "" : "autofocus"}>Press a key combination here</button>
    <p class="shortcut-message" role="status" data-recording-note></p>
    <label class="shortcut-move" hidden><input type="checkbox" data-move-binding><span></span></label>
    <div class="shortcut-editor-actions"><button type="button" class="btn ghost sm" data-clear-binding>Clear all</button>
    <button type="button" class="btn ghost sm" data-default-binding>Restore defaults</button></div>
    <div class="modal-actions"><button type="button" class="btn ghost" data-editor-cancel>Cancel</button><button type="submit" class="btn primary" data-editor-save>Save</button></div></form>`;
  const note = dialog.querySelector("[data-recording-note]"), capture = dialog.querySelector("[data-capture]");
  const move = dialog.querySelector("[data-move-binding]"), save = dialog.querySelector("[data-editor-save]");
  const key = dialog.querySelector("#shortcutEditorKey"), add = dialog.querySelector("[data-build-binding]");
  const refresh = () => {
    const clash = shortcutClashes(COMMANDS, settings.shortcuts, id, draft);
    const signature = clash.map(x => `${x.id}:${x.key}`).join("|");
    if (signature !== clashState) move.checked = false;
    clashState = signature;
    move.parentElement.hidden = !clash.length;
    move.nextElementSibling.textContent = clash.length ? `Move these bindings from ${[...new Set(clash.map(x => x.label))].join(", ")}.` : "";
    save.disabled = !!clash.length && !move.checked;
    dialog.querySelector(".shortcut-draft").innerHTML = draft.length ? draft.map((key, i) => `<li>${keyBadge(key)}<button type="button" class="icon-btn" data-remove-binding="${i}" aria-label="Remove ${esc(prettyCombo(key))}">${icon("i-x")}</button></li>`).join("") : `<li class="muted">No bindings</li>`;
  };
  const addBinding = combo => {
    if (!combo) return;
    if (!assignableBinding(combo)) { note.textContent = "Choose Ctrl, Command, Meta or Alt with another key, or choose a function key."; return; }
    if (draft.includes(combo)) { note.textContent = `${prettyCombo(combo)} is already listed.`; return; }
    if (draft.length >= 3) { note.textContent = "Remove a binding before adding another."; return; }
    draft.push(combo); reset = false;
    note.textContent = `${prettyCombo(combo)} added. Save to apply.`;
    refresh();
  };
  key.addEventListener("change", () => { add.disabled = !key.value; });
  add.addEventListener("click", () => {
    const mods = [...dialog.querySelectorAll("[data-shortcut-modifier]:checked")].map(el => el.value);
    addBinding(buildShortcutBinding(key.value, mods));
  });
  capture.addEventListener("keydown", e => {
    if (e.isComposing || e.getModifierState("AltGraph") || e.key === "Escape" || (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey)) return;
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat) addBinding(comboFromEvent(e));
  });
  move.addEventListener("change", () => { save.disabled = !!clashState && !move.checked; });
  dialog.addEventListener("click", e => {
    const remove = e.target.closest("[data-remove-binding]");
    if (remove) { draft.splice(Number(remove.dataset.removeBinding), 1); reset = false; note.textContent = "Binding removed from draft."; refresh(); (touch ? key : capture).focus({ preventScroll: true }); }
    if (e.target.closest("[data-clear-binding]")) { draft = []; reset = false; note.textContent = "Save to disable this shortcut."; refresh(); }
    if (e.target.closest("[data-default-binding]")) { draft = [...command.keys]; reset = true; note.textContent = "Default bindings restored in the draft."; refresh(); }
    if (e.target.closest("[data-editor-cancel]")) dialog.close();
  });
  dialog.addEventListener("submit", e => {
    e.preventDefault();
    const next = storeShortcutKeys(COMMANDS, settings.shortcuts, id, draft, { move: move.checked, reset });
    if (!next) { refresh(); return; }
    applyShortcuts(next);
    dialog.close();
    toast(draft.length ? "Shortcut saved" : "Shortcut disabled");
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    $("settingsBody").querySelector(`[data-rebind="${id}"]`)?.focus({ preventScroll: true });
  });
  document.body.append(dialog);
  refresh();
  dialog.showModal();
}

function openGuide(id, trigger) {
  const guide = GUIDES.find(g => g.id === id);
  if (!guide) return;
  const dialog = document.createElement("dialog");
  dialog.className = "modal guide-player";
  dialog.setAttribute("aria-labelledby", "guideTitle");
  dialog.innerHTML = `<div class="modal-card"><header><h2 id="guideTitle">${esc(guide.title)}</h2><button type="button" class="btn ghost sm" autofocus>Close</button></header>
    <video controls playsinline preload="none" width="960" height="540" aria-label="${esc(guide.title)}"></video>
    <p data-guide-error role="status" hidden>Video couldn’t load. The written steps are available below.</p>
    <p>${esc(guide.description)}</p><ol>${guide.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol></div>`;
  const video = dialog.querySelector("video");
  video.addEventListener("error", () => { if (dialog.open) dialog.querySelector("[data-guide-error]").hidden = false; });
  dialog.querySelector("button").onclick = () => dialog.close();
  dialog.addEventListener("close", () => { video.pause(); video.removeAttribute("src"); video.load(); dialog.remove(); trigger.focus(); });
  document.body.append(dialog);
  dialog.showModal();
  video.poster = `${APP_BASE}/assets/guides/${id}.jpg`;
  video.src = `${APP_BASE}/assets/guides/${id}.mp4`;
}

async function renderVpnList() {
  const el = $("customVpnList");
  if (!el) return;
  el.innerHTML = `<span class="muted small">Loading…</span>`;
  let profiles = [];
  try {
    const r = await api("/api/vpn/list", { timeoutMs: 8000 });
    profiles = r?.profiles || [];
  } catch (e) { el.innerHTML = `<span class="muted small">Failed to load: ${esc(e.message)}</span>`; return; }
  if (!profiles.length) {
    el.innerHTML = `<p class="muted small">No VPN profiles yet. Add a provider, import a WireGuard config, or run a VeyraVPN Node at home.</p>`;
    return;
  }
  el.innerHTML = profiles.map(p => `
    <div class="custom-vpn-card">
      <div class="vpn-info">
        <b>${esc(p.name || p.id)}</b>
        <span>${esc(p.server || "WireGuard config")} · ${esc(p.type || "proxy")} · ${esc(p.source === "env" ? "env var" : p.source === "db" ? "saved" : "")}</span>
      </div>
      <div class="vpn-actions">
        <button class="btn ghost sm" data-vpn-connect="${esc(p.id)}">Use</button>
        <button class="btn ghost sm" data-vpn-test="${esc(p.id)}">Test</button>
        ${p.source === "db" ? `<button class="btn danger sm" data-vpn-delete="${esc(p.id)}">Delete</button>` : ""}
      </div>
    </div>
  `).join("");
}

async function decodeVeyraNodeCode(input) {
  const parts = String(input || "").trim().split(".");
  if (parts.length !== 3 || parts[0] !== "VNODE1") throw new Error("unrecognised format");
  const body = parts[1], expected = parts[2].toLowerCase();
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  const actual = [...bytes].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
  if (actual !== expected) throw new Error("checksum failed");
  let payload;
  try {
    const raw = atob(body.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - body.length % 4) % 4));
    payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, c => c.charCodeAt(0))));
  } catch { throw new Error("invalid payload"); }
  if (payload.v !== 1 || !payload.expiresAt || Date.now() >= Number(payload.expiresAt)) throw new Error("code expired");
  if (payload.type !== "socks5" || !/^socks5:\/\//i.test(String(payload.server || ""))) throw new Error("unsupported node profile");
  if (!payload.username || !payload.password) throw new Error("missing credentials");
  return payload;
}

function showVeyraNodeGuide() {
  const modal = document.createElement("dialog");
  modal.className = "vpn-node-guide";
  modal.innerHTML = `
    <form method="dialog" style="max-width:640px;padding:0">
      <div style="padding:28px 32px">
        <h2 style="margin:0 0 4px;font-size:20px">Run a VeyraVPN Node at home</h2>
        <p class="muted" style="margin:0 0 20px;font-size:14px">Route Veyra traffic through your own home/VPS IP instead of a datacenter. No VPN provider needed.</p>

        <div style="background:#1a1d24;border:1px solid #2a2e36;border-radius:12px;padding:20px;margin-bottom:16px">
          <h3 style="font-size:15px;margin:0 0 12px">Quick start</h3>
          <ol style="margin:0;padding-left:20px;line-height:1.8;font-size:13px;color:#aab5c4">
            <li>Install Node.js 18+ on any machine (home server, VPS, Raspberry Pi)</li>
            <li>Download <code style="background:#0d0f13;padding:2px 6px;border-radius:4px">veyra-node.js</code> from the <a href="https://github.com/HomekidChud/VeyraServer" target="_blank" rel="noopener" style="color:var(--accent)">VeyraServer repo</a></li>
            <li>Run: <code style="background:#0d0f13;padding:2px 6px;border-radius:4px">node veyra-node.js</code></li>
            <li>Copy the temporary <code style="background:#0d0f13;padding:2px 6px;border-radius:4px">VNODE1.…</code> code it prints</li>
            <li>Use <b>Paste Veyra Node code</b> below; it expires automatically</li>
          </ol>
        </div>

        <div style="background:#1a1d24;border:1px solid #2a2e36;border-radius:12px;padding:20px;margin-bottom:16px">
          <h3 style="font-size:15px;margin:0 0 8px">What it does</h3>
          <p style="margin:0;font-size:13px;color:#aab5c4;line-height:1.5">Runs a lightweight SOCKS5 proxy on your machine. Veyra routes proxy, crawler, and Chromium traffic through it. Your exit IP is your home/VPS IP, not Render's datacenter IP — which helps with sites that block cloud IPs.</p>
        </div>

        <div style="background:#1a1d24;border:1px solid #2a2e36;border-radius:12px;padding:20px;margin-bottom:16px">
          <h3 style="font-size:15px;margin:0 0 8px">Options</h3>
          <pre style="margin:0;font-size:12px;color:#aab5c4;white-space:pre-wrap">node veyra-node.js --port=1080 --user=veyra --name="Home Node" --region=UK
node veyra-node.js --print-json   # Print Veyra import JSON and exit</pre>
        </div>

        <div style="background:#1a1d24;border:1px solid #2a2e36;border-radius:12px;padding:20px;margin-bottom:20px">
          <h3 style="font-size:15px;margin:0 0 8px">Find your public IP</h3>
          <pre style="margin:0;font-size:12px;color:#aab5c4">curl ifconfig.me</pre>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="btn ghost" id="vpnNodeClose">Close</button>
          <a class="btn" href="https://github.com/HomekidChud/VeyraServer/raw/main/veyra-node.js" target="_blank" rel="noopener" download>Download veyra-node.js</a>
        </div>
      </div>
    </form>
  `;
  document.body.appendChild(modal);
  modal.querySelector("#vpnNodeClose").onclick = () => modal.close();
  modal.addEventListener("close", () => modal.remove());
  modal.showModal();
}

export function initSettings(b) {
  B = b;
  hooks.renderSettings = section => render(section || "");
  const nav = $("settingsNav"), body = $("settingsBody");
  const goSection = id => {
    const t = B.activeTab(); if (!t || t.view !== "settings") return;
    $("settingsSearch").value = "";

    B.openInternal("settings", { tab: t, section: id });
  };
  nav.addEventListener("click", e => { const s = e.target.closest("[data-snav]"); if (s) goSection(s.dataset.snav); });
  body.addEventListener("click", e => { const s = e.target.closest("[data-snav]"); if (s) { e.preventDefault(); goSection(s.dataset.snav); } }, true);
  body.addEventListener("click", e => {
    const pin = e.target.closest("[data-deck-pin]");
    if (!pin) return;
    const id = pin.dataset.deckPin;
    const byId = new Map(visibleSections().map(s => [s.id, s]));
    if (!byId.has(id)) return;
    const pins = settingsPins(settings.deckPins, byId.keys());
    const pressed = !pins.includes(id);
    settings.deckPins = pressed ? [...pins, id] : pins.filter(key => key !== id);
    saveSettings({ refresh: false });
    pin.setAttribute("aria-pressed", String(pressed));
    pin.setAttribute("aria-label", `${pressed ? "Unpin" : "Pin"} ${byId.get(id).label}`);
    syncPinLists(byId, settings.deckPins);
    syncCurrentNav(nav, searchIndex ? null : curSection());
  });
  body.addEventListener("change", e => {
    const el = e.target.closest("[data-set]");
    if (el && el.type !== "text" && el.type !== "password" && el.type !== "url") setValue(el);
    if (e.target.matches("[data-shortcut-category]")) filterShortcuts(e.target.closest(".shortcuts-panel"));
  });
  body.addEventListener("input", e => {
    if (e.target.matches("[data-shortcut-filter]")) filterShortcuts(e.target.closest(".shortcuts-panel"));
  });
  body.addEventListener("change", e => {
    const profile = e.target.closest("[data-performance-mode]");
    if (profile?.checked) B.setPerformanceMode(profile.value);
    const quality = e.target.closest("[data-stream-quality]");
    if (quality) {
      const preset = streamPreset(quality.value);
      settings.streamQuality = preset;
      save("veyra-settings", settings);
      quality.closest("[data-section]").querySelector("[data-stream-description]").textContent = STREAM_PRESETS[preset].description;
    }
  });
  body.addEventListener("input", debounce(e => { const el = e.target.closest("[data-set]"); if (el?.isConnected && ["text", "password", "url"].includes(el.type)) setValue(el); }, 450));
  wireStudio(body, () => { if (B.activeTab()?.view === "settings") render(curSection()); });
  body.addEventListener("click", async e => {
    const connection = e.target.closest("[data-test-connection]");
    if (connection) {
      const output = body.querySelector("[data-connection-result]");
      connection.disabled = true;
      output.textContent = "Testing Veyra connection…";
      const ctl = new AbortController();
      const observer = new MutationObserver(() => { if (!connection.isConnected) ctl.abort(); });
      observer.observe(body, { childList: true, subtree: true });
      try {
        const result = await measureVeyraConnection(API, { request: rawFetch, signal: ctl.signal });
        if (!connection.isConnected) return;
        const timing = result.median === null ? `Round trip unavailable (${result.samples}/3 checks answered).`
          : `Median ${result.median} ms · ${result.spread} ms spread across 3 checks.`;
        const mode = result.availability === false ? "Chromium is disabled on this server; Fast Proxy is unaffected."
          : result.availability === true ? "Chromium is enabled on this server." : "Chromium availability could not be checked.";
        output.textContent = `${timing} ${mode}`;
      } finally { observer.disconnect(); connection.disabled = false; }
      return;
    }
    const park = e.target.closest("[data-park-tab]");
    if (park) {
      const tab = B.activeTab();
      if (await B.parkTab(park.dataset.parkTab)) {
        if (B.activeTab() === tab && tab?.view === "settings" && body.contains(park)) {
          render(curSection()); body.querySelector("[data-performance-refresh]")?.focus();
        }
      }
      return;
    }
    const wake = e.target.closest("[data-wake-tab]");
    if (wake) { B.switchTab(wake.dataset.wakeTab); return; }
    if (e.target.closest("[data-performance-refresh]")) { render(curSection()); body.querySelector("[data-performance-refresh]")?.focus(); return; }
    const a = e.target.closest("[data-act]"); if (a) { e.preventDefault(); act(a.dataset.act, a); return; }
    const rb = e.target.closest("[data-rebind]"); if (rb) { startRebind(rb); return; }
    const guide = e.target.closest("[data-guide]"); if (guide) { openGuide(guide.dataset.guide, guide); return; }

    const vc = e.target.closest("[data-vpn-connect]"); if (vc) { const pid = vc.dataset.vpnConnect; try { await B.connectVpn(pid); toast("VPN connected"); } catch(err) { toast(err.message, { kind: "err" }); } renderVpnList(); return; }
    const vd = e.target.closest("[data-vpn-delete]"); if (vd) { const pid = vd.dataset.vpnDelete; try { await api(`/api/vpn/custom/${encodeURIComponent(pid)}`, { method: "DELETE" }); toast("VPN profile removed"); } catch(e) { toast(`Failed: ${e.message}`, { kind: "err" }); } renderVpnList(); return; }
    const vt = e.target.closest("[data-vpn-test]"); if (vt) { const pid = vt.dataset.vpnTest; try { const r = await api("/api/vpn/test", { method: "POST", json: { profileId: pid } }); toast(r.healthy ? `Healthy (${r.latencyMs}ms, IP: ${r.exitIp || "?"})` : `Failed: ${r.lastError || "unreachable"}`, { kind: r.healthy ? "ok" : "err" }); } catch(e) { toast(`Test failed: ${e.message}`, { kind: "err" }); } return; }
  });
  $("settingsSearch").addEventListener("input", debounce(() => { if (B.activeTab()?.view === "settings") render(curSection(), true); }, 75));
  $("settingsSearch").addEventListener("keydown", e => { if (e.key === "Escape" && e.target.value) { e.preventDefault(); e.target.value = ""; render(curSection()); } });
  hooks.onSessionTickSettings = clock => {
    if (document.hidden || B.activeTab()?.view !== "settings") return;
    const el = $("setSessLeft"), text = `${clock} left`;
    if (el && el.textContent !== text) el.textContent = text;
  };
}
