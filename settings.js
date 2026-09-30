// Veyra settings page: browser-style sections, search, rebindable shortcuts, account and admin.
import { $, qsa, esc, api, rawFetch, API, VERSION, hooks, settings, saveSettings, resetSettings, SEARCH_ENGINES, auth, setAuth, isAdmin, toast, confirmDialog, promptDialog, fmtClock, fmtBytes, copyText, debounce, getNeuralStats, testAdminLogin } from "./core.js";
import { openAuth, signOut, pushSync, COMMANDS, keysFor, prettyCombo, setRecording } from "./ui.js";

let B;
const ACCENTS = ["#8fb0f0", "#6fd3b8", "#f0b86f", "#f08f9e", "#c49bf0", "#9fd46a", "#e8e8e8"];
const SECTIONS = [
  { id: "account", label: "You and Veyra", desc: "Sign-in, sync and account security", icon: "i-user" },
  { id: "appearance", label: "Appearance", desc: "Theme, accent colour, font size and layout", icon: "i-moon" },
  { id: "search", label: "Search engine", desc: "Default search engine and web results", icon: "i-search" },
  { id: "startup", label: "On startup", desc: "What opens when Veyra starts", icon: "i-home" },
  { id: "newtab", label: "New tab page", desc: "Shortcuts, recent sites and clock", icon: "i-tab" },
  { id: "privacy", label: "Privacy and security", desc: "Tracker blocking, incognito and clearing data", icon: "i-shield" },
  { id: "sessions", label: "Sessions", desc: "Session timer, warnings and auto-restart", icon: "i-timer" },
  { id: "downloads", label: "Downloads and history", desc: "Download and history limits", icon: "i-download" },
  { id: "accessibility", label: "Accessibility", desc: "Motion, focus rings and link styles", icon: "i-zoom" },
  { id: "shortcuts", label: "Keyboard shortcuts", desc: "View and rebind keyboard shortcuts", icon: "i-keyboard" },
  { id: "extensions", label: "Extensions", desc: "Installed and published extensions", icon: "i-puzzle" },
  { id: "vpn", label: "Veyra VPN", desc: "Exit locations and auto-connect", icon: "i-vpn" },
  { id: "system", label: "System and engine", desc: "Page engine, Chromium and timeouts", icon: "i-bolt" },
  { id: "neural", label: "Neural crawler", desc: "Trainable AI crawler and search optimisation", icon: "i-bolt" },
  { id: "developer", label: "Developer", desc: "DevTools, logging and diagnostics", icon: "i-code" },
  { id: "admin", label: "Server config", desc: "Server plan and runtime config", icon: "i-layers", admin: true },
  { id: "reset", label: "Reset settings", desc: "Restore default settings", icon: "i-reload" },
  { id: "about", label: "About Veyra", desc: "Version, server health and backend", icon: "i-info" }
];

// ---------------------------------------------------------------- row builders
const row = (label, desc, ctl, extra = "") => `<div class="s-row" ${extra}><div class="s-label"><b>${esc(label)}</b>${desc ? `<span>${esc(desc)}</span>` : ""}</div><div class="s-ctl">${ctl}</div></div>`;
const toggle = (key, label, desc) => row(label, desc, `<input type="checkbox" class="switch" data-set="${key}" ${settings[key] ? "checked" : ""} aria-label="${esc(label)}">`);
const select = (key, label, desc, opts) => row(label, desc, `<select class="input" data-set="${key}" aria-label="${esc(label)}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(settings[key]) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`);
const number = (key, label, desc, min, max, step = 1) => row(label, desc, `<input type="number" class="input" style="min-width:120px;width:120px" data-set="${key}" data-num min="${min}" max="${max}" step="${step}" value="${esc(settings[key])}" aria-label="${esc(label)}">`);
const text = (key, label, desc, ph = "", type = "text") => row(label, desc, `<input type="${type}" class="input" data-set="${key}" placeholder="${esc(ph)}" value="${esc(settings[key] || "")}" aria-label="${esc(label)}" autocomplete="off">`);
const button = (label, desc, act, btnLabel, cls = "btn") => row(label, desc, `<button class="${cls}" data-act="${act}">${esc(btnLabel)}</button>`);
const radios = (key, opts) => `<div class="radio-list">${opts.map(([v, l, s]) => `<label class="radio-row"><input type="radio" name="r-${key}" data-set="${key}" value="${esc(v)}" ${String(settings[key]) === String(v) ? "checked" : ""}><span>${esc(l)}${s ? `<small>${esc(s)}</small>` : ""}</span></label>`).join("")}</div>`;
const section = (id, title, desc, body) => `<section class="s-section" id="s-${id}" data-section="${id}"><h2>${esc(title)}</h2>${desc ? `<p class="muted">${esc(desc)}</p>` : ""}<div class="s-card">${body}</div></section>`;

// ---------------------------------------------------------------- sections
function accountSection() {
  if (!auth.user) return section("account", "You and Veyra", "Sign in to sync settings, bookmarks, extensions and notes across devices.",
    row("Not signed in", "You are browsing as a guest. Everything stays in this browser.", `<button class="btn" data-act="signin">Sign in</button><button class="btn primary" data-act="signup">Create account</button>`)
    + row("Test admin", "Log in as a test administrator with full access. Only works when test mode is enabled on the server (VEYRA_TEST_MODE=1).", `<button class="btn" data-act="testAdmin">Test admin login</button>`));
  const u = auth.user;
  return section("account", "You and Veyra", "", `
    <div class="about-card"><div class="avatar" style="width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font:800 1.3rem var(--font-display)">${esc((u.name || u.email || "?")[0].toUpperCase())}</div><div><h3>${esc(u.name || "Veyra user")}</h3><div class="muted">${esc(u.email)}${isAdmin() ? " · Administrator" : ""}</div></div></div>
    ${row("Display name", "Shown on your profile and new tab page.", `<input class="input" id="accName" value="${esc(u.name || "")}" maxlength="60" aria-label="Display name"><button class="btn" data-act="saveName">Save</button>`)}
    ${button("Password", "Changing it signs out your other devices.", "changePassword", "Change password")}
    ${button("Sync now", "Pushes settings, bookmarks, extensions and notes to your account.", "syncNow", "Sync")}
    ${button("Sign out", "Your local data stays in this browser.", "signOut", "Sign out")}
    ${button("Sign out everywhere", "Revokes every token issued for this account.", "signOutAll", "Sign out everywhere")}
    ${button("Delete account", "Permanently removes your account and synced data.", "deleteAccount", "Delete account", "btn danger")}`);
}
function appearanceSection() {
  const theme = settings.theme;
  const card = (v, l, bg) => `<button class="theme-card ${theme === v ? "on" : ""}" data-theme-pick="${v}" aria-pressed="${theme === v}"><i style="background:${bg}"></i><span>${l}</span></button>`;
  return section("appearance", "Appearance", "", `
    <div class="theme-cards" data-label="Theme dark light system">${card("dark", "Dark", "linear-gradient(135deg,#0d0f13 60%,#1b1f27)")}${card("light", "Light", "linear-gradient(135deg,#f6f7f9 60%,#e2e5ea)")}${card("system", "Device", "linear-gradient(135deg,#0d0f13 50%,#f6f7f9 50%)")}</div>
    ${row("Accent colour", "Used for buttons, focus and highlights.", `<div class="swatches">${ACCENTS.map(c => `<button class="swatch ${settings.accent === c ? "on" : ""}" data-accent="${c}" style="background:${c}" aria-label="Accent ${c}"></button>`).join("")}<input type="color" data-set="accent" value="${esc(settings.accent)}" aria-label="Custom accent" style="width:30px;height:28px;border:0;background:none;padding:0"></div>`)}
    ${select("fontScale", "Font size", "Scales the Veyra interface.", [[0.9, "Small"], [1, "Medium (recommended)"], [1.1, "Large"], [1.2, "Very large"]])}
    ${select("zoomDefault", "Default page zoom", "Applied to new page tabs.", [[0.8, "80%"], [0.9, "90%"], [1, "100%"], [1.1, "110%"], [1.25, "125%"], [1.5, "150%"]])}
    ${toggle("compact", "Compact mode", "Tighter tabs and toolbar.")}
    ${toggle("showHomeButton", "Show home button", "")}
    ${toggle("showBookmarksBar", "Show bookmarks bar", "Ctrl+Shift+B toggles it.")}`);
}
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
    ${button("Incognito window", "History, downloads, notes and sign-in stay in memory; the server skips site logging and shared caching. Ctrl+Shift+N.", "incognito", "Open incognito window")}
    ${toggle("challengeHandoff", "Hand security checks to real Chromium", "When a site shows a Cloudflare or captcha check, reopen it in Chromium so you can complete it yourself. Veyra never solves checks for you.")}
    ${toggle("blockTrackers", "Block trackers", "The server refuses requests to known ad and tracking hosts.")}
    ${toggle("doNotTrack", "Send a Do Not Track request", "Adds DNT and Sec-GPC headers to proxied requests.")}
    ${toggle("clearOnSessionEnd", "Clear page cookies when a session ends", "")}
    ${toggle("warnBeforeClose", "Warn before closing with several tabs open", "")}`);
}
function sessionsSection() {
  const lim = B.state.serverLimitMs || B.state.session?.limitMs || 0;
  const s = B.state.session; const left = s ? Math.max(0, s.expiresAt - Date.now()) : 0;
  return section("sessions", "Sessions", "Each browsing session has a time limit so server resources are freed quickly.", `
    ${row("Session time limit", lim ? `Set by the server: sessions end after ${fmtClock(lim)} and are deleted.` : "The server did not report a limit.", `<span class="chip">${lim ? fmtClock(lim) : "—"}</span>`)}
    ${row("Current session", s ? `ID ${esc(s.id.slice(0, 8))}… · started ${new Date(s.startedAt).toLocaleTimeString()}` : "No active session. One starts when you open a page.", `<span class="chip" id="setSessLeft">${s ? fmtClock(left) + " left" : "Idle"}</span>${s ? `<button class="btn danger" data-act="endSession">End session now</button>` : ""}`)}
    ${toggle("sessionWarnings", "Warn before a session ends", "Shows a warning 30 and 10 seconds before the limit.")}
    ${toggle("autoRestartSession", "Start a new session automatically", "When the timer ends, reopen your tabs in a fresh session.")}
    ${toggle("clearOnSessionEnd", "Clear cookies when a session ends", "")}`);
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
function shortcutsSection() {
  const groups = [...new Set(COMMANDS.map(c => c.group))];
  const body = groups.map(g => `<div class="s-row" style="min-height:0;padding:10px 18px;background:var(--surface-2)"><div class="s-label"><b>${esc(g)}</b></div></div>
    <table class="shortcut-table">${COMMANDS.filter(c => c.group === g && !c.hidden).map(c => {
      const ks = keysFor(c.id); const custom = Array.isArray(settings.shortcuts?.[c.id]);
      return `<tr class="s-row" style="display:table-row" data-label="${esc(c.label)} ${esc(ks.join(" "))}"><td>${esc(c.label)}${custom ? ` <span class="chip" style="font-size:.75em">custom</span>` : ""}</td><td><button class="kbd-btn" data-rebind="${c.id}" title="Click to record a new shortcut">${ks.length ? ks.map(k => `<kbd>${esc(prettyCombo(k))}</kbd>`).join("") : `<span class="muted">None</span>`}</button>${custom ? `<button class="icon-btn" data-unbind="${c.id}" title="Restore default" aria-label="Restore default"><svg><use href="#i-reload"/></svg></button>` : ""}</td></tr>`;
    }).join("")}</table>`).join("");
  return `<section class="s-section" id="s-shortcuts" data-section="shortcuts"><h2>Keyboard shortcuts</h2><p class="muted">Click a shortcut, then press the new keys. Press Esc to cancel or Backspace to remove it. Shortcuts also work while a page has focus.</p>
    <div class="s-card">${body}</div><div style="margin-top:12px"><button class="btn" data-act="resetShortcuts">Restore all defaults</button></div></section>`;
}
function extensionsSection() {
  return section("extensions", "Extensions", "", `
    ${row("Manage extensions", "Install verified CSS-only packages from the Veyra Store or load your own safe CSS package in Developer mode.", `<button class="btn" data-act="openExtensions">Open extensions</button>`)}
    ${toggle("extensionDeveloperMode", "Developer mode", "Lets you load local Veyra CSS packages for development.")}`);
}
function vpnSection() {
  const customVpns = load("veyra-custom-vpns", []);
  return section("vpn", "Veyra VPN", "", `
    ${row("Status", B.state.vpn?.connected ? `Connected to ${B.state.vpn.profile?.name || "an exit"}` : "Not connected", `<button class="btn" data-act="openVpn">Open VPN</button>`)}
    ${row("Connect automatically", settings.vpnAutoProfile ? `New sessions use ${settings.vpnAutoProfile}.` : "Off. Choose an exit in the VPN page.", settings.vpnAutoProfile ? `<button class="btn" data-act="vpnAutoOff">Turn off</button>` : "")}
    <div class="s-row" style="display:block">
      <div class="s-label"><b>Custom VPN Methods</b><span>Add your own VPN provider via API key, config, or manual server settings.</span></div>
      <div class="custom-vpn-list" id="customVpnList">
        ${customVpns.length ? customVpns.map((v, i) => `
          <div class="custom-vpn-card">
            <div class="vpn-info"><b>${esc(v.name || v.type || "VPN")}</b><span>${esc(v.server || v.apiKey ? v.apiKey.slice(0,8)+"…" : "Configured")} · ${esc(v.type || "proxy")}</span></div>
            <div class="vpn-actions">
              <button class="btn ghost sm" data-vpn-connect="${i}">Use</button>
              <button class="btn ghost sm" data-vpn-edit="${i}">Edit</button>
              <button class="btn danger sm" data-vpn-delete="${i}">Delete</button>
            </div>
          </div>
        `).join("") : `<p class="muted small">No custom VPNs configured yet.</p>`}
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-act="addCustomVpn">Add VPN provider</button>
        <button class="btn ghost" data-act="importVpnConfig">Import WireGuard config</button>
      </div>
    </div>`);
}
function systemSection() {
  return section("system", "System and engine", "How Veyra loads pages.", `
    ${select("runtime", "Page loading strategy", "Choose the engines Veyra may use. The crawler accelerates the current page only: the proxy paints first, critical assets start early, then bounded discovery warms additional required assets without crawling the whole site during your session.", [["auto", "Automatic"], ["proxy", "Fast proxy"], ["crawler", "Fast proxy + page accelerator"], ["browser", "Chromium"], ["combined", "All combined (fastest adaptive)"]])}
    ${toggle("browserFallback", "Allow Chromium fallback", "In Automatic and Proxy + crawler modes, use Chromium when the lightweight renderer cannot handle a site.")}
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
    <div class="s-row" style="display:block"><div class="s-label"><b>Neural model stats</b><span>Live training statistics from the server.</span></div><div id="neuralStats" style="margin-top:8px"><span class="muted">Loading…</span></div></div>
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

// ---------------------------------------------------------------- render
// /settings            -> overview (home) grid of sections
// /settings/<section>  -> only that section; every other section is hidden
// search box           -> searches across *all* sections, whatever the route
const PARTS = () => ({ account: accountSection, appearance: appearanceSection, search: searchSection, startup: startupSection, newtab: newtabSection, privacy: privacySection, sessions: sessionsSection, downloads: downloadsSection, accessibility: a11ySection, shortcuts: shortcutsSection, extensions: extensionsSection, vpn: vpnSection, system: systemSection, neural: neuralSection, developer: developerSection, admin: adminSection, reset: resetSection, about: aboutSection });
export function visibleSections() { return SECTIONS.filter(s => !s.admin || isAdmin()); }
export function sectionExists(id) { return visibleSections().some(s => s.id === id); }
let lastRendered = null;
const curSection = () => { const t = B?.activeTab?.(); return t && t.view === "settings" ? t.section || "" : ""; };
function render(active) {
  const nav = $("settingsNav"), body = $("settingsBody");
  const visible = visibleSections();
  const cur = visible.find(s => s.id === active) ? active : "";
  const q = $("settingsSearch").value.trim();
  const t = B?.activeTab?.();
  if (t && t.view === "settings" && active && !cur) t.section = ""; // unknown section -> overview
  nav.innerHTML = `<button class="snav ${!cur ? "on" : ""}" data-snav=""><svg><use href="#i-grid"/></svg>Overview</button>` +
    visible.map(s => `<button class="snav ${s.id === cur ? "on" : ""}" data-snav="${s.id}" ${s.id === cur ? 'aria-current="page"' : ""}><svg><use href="#${s.icon}"/></svg>${esc(s.label)}</button>`).join("");
  const parts = PARTS();
  const empty = `<p class="muted s-empty" id="settingsEmpty" style="display:none">No settings match your search.</p>`;
  if (q) {
    body.innerHTML = `<div class="s-crumbs"><span>Search results for “${esc(q)}”</span></div>` + visible.map(s => parts[s.id]()).join("") + empty;
    filter(q);
  } else if (!cur) {
    body.innerHTML = `<header class="s-home-head"><h1>Settings</h1><p class="muted">Pick a category, or search every setting from the box on the left.</p></header>
      <div class="s-home-grid">${visible.map(s => `<button class="s-home-card" data-snav="${s.id}"><span class="s-home-ic"><svg><use href="#${s.icon}"/></svg></span><span class="s-home-txt"><b>${esc(s.label)}</b><small>${esc(s.desc || "")}</small></span><svg class="s-home-go"><use href="#i-forward"/></svg></button>`).join("")}</div>` + empty;
  } else {
    const meta = visible.find(s => s.id === cur);
    body.innerHTML = `<nav class="s-crumbs" aria-label="Breadcrumb"><button class="linkish" data-snav="">Settings</button><span aria-hidden="true">›</span><span>${esc(meta.label)}</span></nav>` + parts[cur]() + empty;
  }
  if (lastRendered !== `${cur}|${q}`) $("view-settings").scrollTop = 0;
  lastRendered = `${cur}|${q}`;
  if (q || !cur || cur === "about") loadAbout();
  if (q || cur === "neural") loadNeuralStats();
  if (isAdmin() && (q || cur === "admin")) loadAdmin();
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
  q = q.toLowerCase(); let any = false;
  qsa("#settingsBody .s-section").forEach(sec => {
    let hit = false; const inTitle = sec.querySelector("h2").textContent.toLowerCase().includes(q);
    sec.querySelectorAll(".s-row, .radio-row, .theme-cards").forEach(r => {
      const m = !!q && (r.textContent + " " + (r.dataset.label || "")).toLowerCase().includes(q);
      r.classList.toggle("hit", m && r.classList.contains("s-row")); if (m) hit = true;
    });
    const show = !q || hit || inTitle; sec.style.display = show ? "" : "none"; if (show) any = true;
  });
  $("settingsEmpty").style.display = any ? "none" : "";
}

// ---------------------------------------------------------------- actions
function setValue(el) {
  const key = el.dataset.set; let v;
  if (el.type === "checkbox") v = el.checked;
  else if (el.type === "radio") { if (!el.checked) return; v = el.value; }
  else if (el.dataset.num !== undefined || el.type === "number") { v = Number(el.value); const min = Number(el.min), max = Number(el.max); if (!Number.isFinite(v)) return; if (el.min) v = Math.max(min, v); if (el.max) v = Math.min(max, v); }
  else v = el.value;
  if (["fontScale", "zoomDefault"].includes(key)) v = Number(v);
  if (key === "customSearch" && v && !/%s/.test(v)) { toast("Custom search URL needs %s", { kind: "err" }); return; }
  settings[key] = v; saveSettings();
  if (key === "blockTrackers" || key === "doNotTrack") hooks.applyExtensionsToTab?.(B.activeTab());
  if (["searchEngine", "startup", "extensionDeveloperMode"].includes(key)) render(B.activeTab()?.section || "");
  else toast("Setting saved", { ms: 1200 });
}

async function act(a, el) {
  const nav = v => B.openInternal(v);
  switch (a) {
    case "signin": return openAuth("login");
    case "signup": return openAuth("signup");
    case "testAdmin": {
      toast("Attempting test admin login…");
      const r = await testAdminLogin();
      if (r.ok) { toast("Logged in as test admin", { ms: 4000 }); render(curSection()); }
      else toast(r.reason || "Test admin login failed", { kind: "err" });
      return;
    }
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
        { name: "type", label: "Type", type: "select", value: "socks5", options: ["socks5", "http", "https", "wireguard", "api"] },
        { name: "server", label: "Server / Proxy URL", value: "", placeholder: "socks5://host:port or https://api.vpn.com" },
        { name: "apiKey", label: "API Key (if using API type)", value: "", placeholder: "Optional API key" },
        { name: "username", label: "Username", value: "", placeholder: "Optional" },
        { name: "password", label: "Password", value: "", placeholder: "Optional", type: "password" },
        { name: "region", label: "Region", value: "", placeholder: "e.g. UK, US, DE" }
      ] });
      if (!r || !r.name) return;
      const vpns = load("veyra-custom-vpns", []);
      vpns.push({ id: Date.now().toString(36), ...r });
      save("veyra-custom-vpns", vpns);
      // Also push to server if connected
      try { await api("/api/vpn/custom", { method: "POST", json: { name: r.name, type: r.type, server: r.server, apiKey: r.apiKey, username: r.username, password: r.password, region: r.region } }); } catch {}
      toast("VPN provider added");
      render(curSection());
      return;
    }
    case "importVpnConfig": {
      const r = await promptDialog({ title: "Import WireGuard config", ok: "Import", fields: [
        { name: "name", label: "Name", value: "", placeholder: "My WireGuard VPN", required: true },
        { name: "config", label: "WireGuard config", type: "textarea", value: "", placeholder: "[Interface]\nPrivateKey = ...\n[Peer]\nPublicKey = ...\nEndpoint = host:port" }
      ] });
      if (!r || !r.config) return;
      const vpns = load("veyra-custom-vpns", []);
      vpns.push({ id: Date.now().toString(36), name: r.name, type: "wireguard", config: r.config });
      save("veyra-custom-vpns", vpns);
      try { await api("/api/vpn/custom", { method: "POST", json: { name: r.name, type: "wireguard", config: r.config } }); } catch {}
      toast("WireGuard config imported");
      render(curSection());
      return;
    }
    case "refreshNeuralStats": return loadNeuralStats();
    case "resetNeuralModel": {
      if (!await confirmDialog("Reset neural model?", "This clears all learned weights and training data. The model will start learning from scratch.", "Reset model")) return;
      try { await api("/api/neural/reset", { method: "POST", json: {} }); toast("Neural model reset"); loadNeuralStats(); } catch (e) { toast(e.message, { kind: "err" }); } return;
    }
    case "resetShortcuts": settings.shortcuts = {}; saveSettings(); toast("Shortcuts restored"); return render(curSection());
    case "reset": if (await confirmDialog("Reset settings?", "All settings go back to their defaults. Bookmarks, history and extensions are kept.", "Reset")) { resetSettings(); toast("Settings reset"); render(curSection()); } return;
    case "copyApi": return copyText(API);
    case "applyPlan": {
      const plan = $("cfgPlan").value;
      try { await api("/api/config", { method: "PUT", json: { plan } }); toast(`Plan set to ${plan}. Restart the server to apply every limit.`); loadAdmin(); } catch (e) { toast(e.message, { kind: "err" }); } return;
    }
  }
}

function startRebind(btn) {
  const id = btn.dataset.rebind;
  qsa(".kbd-btn.recording").forEach(b => b.classList.remove("recording"));
  btn.classList.add("recording"); btn.innerHTML = `<span class="muted">Press keys…</span>`;
  const done = () => { setRecording(null); render(curSection()); };
  setRecording(combo => {
    if (combo === "Esc") return done();
    if (combo === "Backspace" || combo === "Delete") { settings.shortcuts = { ...settings.shortcuts, [id]: [] }; saveSettings(); return done(); }
    if (!/Mod|Alt|Ctrl|Meta/.test(combo) && !/^F\d/.test(combo)) { toast("Use a modifier (Ctrl, Alt) or a function key", { kind: "err" }); return; }
    const clash = COMMANDS.find(c => c.id !== id && keysFor(c.id).includes(combo));
    if (clash) { const rest = keysFor(clash.id).filter(k => k !== combo); settings.shortcuts = { ...settings.shortcuts, [clash.id]: rest }; toast(`Removed ${prettyCombo(combo)} from “${clash.label}”`); }
    settings.shortcuts = { ...settings.shortcuts, [id]: [combo] }; saveSettings(); done();
  });
}

export function initSettings(b) {
  B = b;
  hooks.renderSettings = section => render(section || "");
  const nav = $("settingsNav"), body = $("settingsBody");
  const goSection = id => {
    const t = B.activeTab(); if (!t || t.view !== "settings") return;
    $("settingsSearch").value = "";
    // Route through openInternal so /settings/<id> gets its own history entry (Back works).
    B.openInternal("settings", { tab: t, section: id });
  };
  nav.addEventListener("click", e => { const s = e.target.closest("[data-snav]"); if (s) goSection(s.dataset.snav); });
  body.addEventListener("click", e => { const s = e.target.closest("[data-snav]"); if (s) { e.preventDefault(); goSection(s.dataset.snav); } }, true);
  body.addEventListener("change", e => { const el = e.target.closest("[data-set]"); if (el && el.type !== "text" && el.type !== "password" && el.type !== "url") setValue(el); });
  body.addEventListener("input", debounce(e => { const el = e.target.closest("[data-set]"); if (el && ["text", "password", "url", "color"].includes(el.type)) { setValue(el); if (el.dataset.set === "accent") qsa(".swatch").forEach(s => s.classList.remove("on")); } }, 450));
  body.addEventListener("click", async e => {
    const a = e.target.closest("[data-act]"); if (a) { e.preventDefault(); act(a.dataset.act, a); return; }
    const th = e.target.closest("[data-theme-pick]"); if (th) { settings.theme = th.dataset.themePick; saveSettings(); qsa(".theme-card").forEach(c => { c.classList.toggle("on", c === th); c.setAttribute("aria-pressed", c === th); }); return; }
    const sw = e.target.closest("[data-accent]"); if (sw) { settings.accent = sw.dataset.accent; saveSettings(); qsa(".swatch").forEach(s => s.classList.toggle("on", s === sw)); const ci = document.querySelector('#settingsBody input[type=color]'); if (ci) ci.value = sw.dataset.accent; return; }
    const rb = e.target.closest("[data-rebind]"); if (rb) { startRebind(rb); return; }
    const ub = e.target.closest("[data-unbind]"); if (ub) { const s = { ...settings.shortcuts }; delete s[ub.dataset.unbind]; settings.shortcuts = s; saveSettings(); render(curSection()); }
    // Custom VPN card actions
    const vc = e.target.closest("[data-vpn-connect]"); if (vc) { const vpns = load("veyra-custom-vpns", []); const v = vpns[Number(vc.dataset.vpnConnect)]; if (v) { try { await B.connectVpn(v.id || v.name); } catch(err) { toast(err.message, { kind: "err" }); } } return; }
    const ve = e.target.closest("[data-vpn-edit]"); if (ve) { const vpns = load("veyra-custom-vpns", []); const v = vpns[Number(ve.dataset.vpnEdit)]; if (v) {
      const r = await promptDialog({ title: "Edit VPN", ok: "Save", fields: [
        { name: "name", label: "Name", value: v.name || "" },
        { name: "server", label: "Server", value: v.server || "" },
        { name: "username", label: "Username", value: v.username || "" },
        { name: "password", label: "Password", type: "password", value: v.password || "" }
      ] });
      if (r) { Object.assign(v, r); save("veyra-custom-vpns", vpns); toast("VPN updated"); render(curSection()); }
    } return; }
    const vd = e.target.closest("[data-vpn-delete]"); if (vd) { const vpns = load("veyra-custom-vpns", []); vpns.splice(Number(vd.dataset.vpnDelete), 1); save("veyra-custom-vpns", vpns); toast("VPN removed"); render(curSection()); return; }
  });
  $("settingsSearch").addEventListener("input", debounce(() => render(B.activeTab()?.section || ""), 120));
  $("settingsSearch").addEventListener("keydown", e => { if (e.key === "Escape" && e.target.value) { e.target.value = ""; render(B.activeTab()?.section || ""); } });
  hooks.onSessionTickSettings = () => { const el = $("setSessLeft"); const s = B.state.session; if (el && s) el.textContent = fmtClock(Math.max(0, s.expiresAt - Date.now())) + " left"; };
  setInterval(() => { if (B.activeTab()?.view === "settings") hooks.onSessionTickSettings(); }, 1000);
}
