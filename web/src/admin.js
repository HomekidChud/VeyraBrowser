"use strict";
/**
 * Veyra Admin Panel — full live control surface for administrators.
 *
 * One view with everything the server exposes, live-refreshed:
 *   - Overview: system health, memory, uptime, capacity, cast + ad stats
 *   - Sessions: every active session with countdowns
 *   - Crawls: every crawl job with stop controls
 *   - Requests: recent server request log
 *   - Logs: live server + browser log streams
 *   - Ads: full ad management (banner / video / YouTube / link) for the
 *     session-renewal system — create, edit, pause, delete
 *   - Config: runtime server config + plan editor
 *   - Tools: test-mode admin login, VPN health, challenge + robot status
 *
 * Admin-gated: the route is admin-only in app.js AND every endpoint here is
 * admin-gated on the server, so guests can never read other sessions' data.
 */

import { $, esc, api, toast, addLog, fmtBytes, fmtClock, fmtMs, hostOf, hooks, settings, saveSettings, isAdmin } from "./core.js?v=8.28.19-virtual-source-address";

let refreshTimer = null;
let currentTab = "overview";

const TABS = [
  ["overview", "Overview"], ["sessions", "Sessions"], ["crawls", "Crawls"], ["requests", "Requests"],
  ["logs", "Logs"], ["ads", "Ads & renewal"], ["config", "Config"], ["tools", "Tools"]
];


export function renderAdmin(section = "") {
  if (!isAdmin()) return;
  if (section && TABS.some(([id]) => id === section)) currentTab = section;
  const box = $("adminPanel") || $("view-admin");
  if (!box) return;
  box.innerHTML = `<header class="page-head row"><div><h1>Admin panel</h1><p class="muted">Live view of everything on this Veyra server. Admins and test mode only.</p></div>
    <div class="head-actions">
      <label class="switch-row"><span>Live</span><input type="checkbox" class="switch" id="adminLive" checked></label>
      <select class="input" id="adminSpeed" style="width:auto"><option value="1000">1 s</option><option value="2000" selected>2 s</option><option value="5000">5 s</option><option value="15000">15 s</option></select>
      <button class="btn ghost" id="adminRefresh">Refresh</button>
    </div></header>
    <div class="adm-tabs" id="adminTabs">${TABS.map(([id, label]) => `<button class="dt-chip ${id === currentTab ? "on" : ""}" data-tab="${id}">${label}</button>`).join("")}</div>
    <div id="adminBody"><div class="empty"><div class="spinner"></div></div></div>`;
  $("adminTabs").onclick = e => { const b = e.target.closest("[data-tab]"); if (!b) return; currentTab = b.dataset.tab; renderAdmin(currentTab); };
  $("adminRefresh").onclick = () => refreshAdmin(true);
  $("adminSpeed").onchange = () => scheduleLive();
  $("adminLive").onchange = () => scheduleLive();
  scheduleLive();
  refreshAdmin(true);
}

function scheduleLive() {
  clearInterval(refreshTimer);
  if (!($("adminLive")?.checked)) return;
  const speed = Math.max(1000, Number($("adminSpeed")?.value) || 2000);
  refreshTimer = setInterval(() => { if ($("view-admin")?.classList.contains("active")) refreshAdmin(); else { clearInterval(refreshTimer); refreshTimer = null; } }, speed);
}

async function refreshAdmin(force = false) {
  const body = $("adminBody");
  if (!body || (!force && !$("view-admin")?.classList.contains("active"))) return;
  try {
    switch (currentTab) {
      case "overview": return await tabOverview(body);
      case "sessions": return await tabSessions(body);
      case "crawls": return await tabCrawls(body);
      case "requests": return await tabRequests(body);
      case "logs": return await tabLogs(body);
      case "ads": return await tabAds(body);
      case "config": return await tabConfig(body);
      case "tools": return await tabTools(body);
    }
  } catch (e) {
    if (e.status === 403) { body.innerHTML = `<div class="empty"><svg><use href="#i-ban"/></svg><b>Admin access required</b><span>Sign in as an administrator (or use test mode) to view this panel. You can also set an admin token in Settings → Developer.</span></div>`; return; }
    body.innerHTML = `<div class="empty"><b>Could not load admin data</b><span>${esc(e.message)}</span></div>`;
  }
}

const card = (a, b, cls = "") => `<div class="stat-card ${cls}"><span>${esc(a)}</span><b>${esc(String(b))}</b></div>`;


async function tabOverview(body) {
  const [sys, sess, cast, renew, challenge, robots] = await Promise.allSettled([
    api("/api/debug/system"), api("/api/sessions"), api("/api/cast/stats"), api("/api/renew/report"),
    api("/api/challenge/status"), api("/api/robots/status")
  ]);
  const s = sys.value || {}, se = sess.value || {}, cs = cast.value || {}, rn = renew.value || {}, ch = challenge.value || {}, ro = robots.value || {};
  const mem = s.memory || {};
  body.innerHTML = `
    <div class="dev-grid">
      ${card("Uptime", `${Math.round((s.uptimeSec || 0) / 60)} min`)}
      ${card("Version", s.version || "—")}
      ${card("Node", s.node || "—")}
      ${card("Memory (RSS)", fmtBytes(mem.rssMb * 1048576), (mem.rssMb || 0) > 400 ? "warn" : "")}
      ${card("Heap", `${fmtBytes(mem.heapUsedMb * 1048576)} / ${fmtBytes(mem.heapTotalMb * 1048576)}`)}
      ${card("Sessions", se.size ?? se.active ?? "—")}
      ${card("Chromium sessions", se.browser?.sessions ?? s.load?.browserSessions ?? 0)}
      ${card("VPN connections", se.vpnConnections ?? 0)}
      ${card("Active crawls", s.load?.activeCrawls ?? "—")}
      ${card("Crawl queue", s.load?.queueDepth ?? "—")}
      ${card("Cast sessions", cs.totalSessions ?? cs.activeSessions ?? 0)}
      ${card("Cast streams", `${cs.activeStreams ?? 0} live · ${cs.framesRelayed ?? 0} frames`)}
      ${card("Ads", `${rn.activeAds ?? 0} active / ${rn.totalAds ?? 0}`)}
      ${card("Ad renewals", rn.totalRenewals ?? 0)}
      ${card("Session limit", se.timeLimitMs ? fmtClock(se.timeLimitMs) : "none")}
      ${card("Full-page proxy", s.fullPageProxy?.version ? `on (v${s.fullPageProxy.version})` : "—")}
    </div>
    <div class="s-section"><h2>Challenges & robots</h2><div class="dev-grid">
      ${card("Challenge solver", ch.enabled ?? ch.status ?? "—")}
      ${card("Challenges solved", ch.solved ?? ch.count ?? "—")}
      ${card("Neural robots", `${ro.totalWorkers ?? "—"} workers · ${ro.active ?? 0} active`)}
      ${card("Pages crawled", ro.totalPagesCrawled ?? "—")}
    </div></div>`;
}

async function tabSessions(body) {
  const se = await api("/api/sessions");
  const rows = (se.sessions || se.list || []).slice(0, 150);
  body.innerHTML = `<div class="s-section"><h2>Active sessions (${se.size ?? se.active ?? rows.length})</h2>
    <div class="table-wrap"><table class="table"><thead><tr><th>Session</th><th>Role</th><th>Age</th><th>Remaining</th><th>Limit</th><th>Requests</th><th>Cookies</th><th>Chromium</th><th>User</th><th></th></tr></thead><tbody>
    ${rows.map(x => `<tr><td class="mono">${esc(String(x.id || x.sessionId || "").slice(0, 14))}</td><td>${esc(x.role || "user")}</td><td>${x.ageMs != null ? fmtClock(x.ageMs) : "—"}</td><td>${x.remainingMs != null ? fmtClock(x.remainingMs) : "Live"}</td><td>${x.timeLimitMs ? fmtClock(x.timeLimitMs) : "none"}</td><td>${esc(x.requests ?? 0)}</td><td>${esc(x.cookies ?? 0)}</td><td>${esc(x.browserSessions ?? 0)}</td><td>${esc(x.userId || "guest")}</td><td><button class="btn danger sm" data-kill="${esc(x.sessionId || x.id)}">End</button></td></tr>`).join("") || `<tr><td colspan="10" class="muted">No active sessions.</td></tr>`}
    </tbody></table></div></div>`;
  body.querySelector("tbody").onclick = async e => {
    const b = e.target.closest("[data-kill]"); if (!b) return;
    b.disabled = true;
    try { await api(`/api/session/${encodeURIComponent(b.dataset.kill)}`, { method: "DELETE" }); toast("Session ended"); refreshAdmin(true); }
    catch (err) { toast(err.message, { kind: "err" }); }
  };
}

async function tabCrawls(body) {
  const j = await api("/api/debug/jobs");
  const rows = j.jobs || [];
  body.innerHTML = `<div class="s-section"><h2>Crawl jobs (${rows.length})</h2>
    <div class="table-wrap"><table class="table"><thead><tr><th>Job</th><th>Host</th><th>Status</th><th>Processed</th><th>Links</th><th>Type</th><th></th></tr></thead><tbody>
    ${rows.map(x => `<tr><td class="mono">${esc(String(x.id).slice(0, 8))}</td><td>${esc(hostOf(x.url))}</td><td>${esc(x.status)}${x.statusText ? ` <span class="muted">(${esc(x.statusText)})</span>` : ""}</td><td>${esc(x.processed)}</td><td>${esc(x.linkCount)}</td><td>${x.pageAccelerator ? "page accelerator" : x.seed ? "seed crawl" : "full crawl"}</td><td>${x.done ? "" : `<button class="btn danger sm" data-stop="${esc(x.id)}">Stop</button>`}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">No jobs.</td></tr>`}
    </tbody></table></div></div>`;
  body.querySelector("tbody").onclick = async e => {
    const b = e.target.closest("[data-stop]"); if (!b) return;
    b.disabled = true;
    try { await api(`/api/crawl/${encodeURIComponent(b.dataset.stop)}/stop`, { method: "POST" }); toast("Crawl stopped"); refreshAdmin(true); }
    catch (err) { toast(err.message, { kind: "err" }); }
  };
}

async function tabRequests(body) {
  const r = await api("/api/debug/requests?limit=200");
  const rows = r.requests || [];
  body.innerHTML = `<div class="s-section"><h2>Recent server requests (${rows.length})</h2>
    <div class="table-wrap" style="max-height:420px"><table class="table"><thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Duration</th></tr></thead><tbody>
    ${rows.map(x => `<tr><td>${new Date(x.time || x.startedAt || Date.now()).toLocaleTimeString([], { hour12: false })}</td><td>${esc(x.method)}</td><td class="mono" style="max-width:480px">${esc(x.path || x.url || "")}</td><td>${esc(x.status ?? "")}</td><td>${x.ms != null ? fmtMs(x.ms) : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No requests yet.</td></tr>`}
    </tbody></table></div></div>`;
}

async function tabLogs(body) {
  const src = body.dataset.logSource || "server";
  const lvl = body.dataset.logLevel || "";
  const [logs] = await Promise.allSettled([api(`/api/debug/logs?source=${src}&level=${lvl}&limit=300`)]);
  const rows = (logs.value?.logs || []).slice().reverse();
  body.innerHTML = `<div class="s-section"><h2>Live logs</h2>
    <div class="head-actions" style="margin-bottom:10px">
      <select class="input" id="logSrc" style="width:auto"><option value="server" ${src === "server" ? "selected" : ""}>Server</option><option value="browser" ${src === "browser" ? "selected" : ""}>Browser</option></select>
      <select class="input" id="logLvl" style="width:auto"><option value="">All levels</option><option value="error" ${lvl === "error" ? "selected" : ""}>Errors</option><option value="warn" ${lvl === "warn" ? "selected" : ""}>Warnings</option><option value="info" ${lvl === "info" ? "selected" : ""}>Info</option></select>
    </div>
    <div class="table-wrap" style="max-height:420px"><table class="table"><thead><tr><th>Time</th><th>Level</th><th>Source</th><th>Message</th></tr></thead><tbody>
    ${rows.map(x => `<tr><td>${new Date(x.time || Date.now()).toLocaleTimeString([], { hour12: false })}</td><td><span class="pill ${x.level === "error" ? "err" : x.level === "warn" ? "" : "ok"}">${esc(x.level || "")}</span></td><td>${esc(x.source || x.component || "")}</td><td class="mono" style="max-width:640px">${esc(x.message || "")}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No log entries.</td></tr>`}
    </tbody></table></div></div>`;
  $("logSrc").onchange = e => { body.dataset.logSource = e.target.value; refreshAdmin(true); };
  $("logLvl").onchange = e => { body.dataset.logLevel = e.target.value; refreshAdmin(true); };
}

async function tabAds(body) {
  const rep = await api("/api/renew/report");
  const ads = rep.ads || [];
  body.innerHTML = `
    <div class="dev-grid">
      ${card("Total ads", rep.totalAds ?? ads.length)}
      ${card("Active ads", rep.activeAds ?? "—")}
      ${card("Renewals granted", rep.totalRenewals ?? 0)}
      ${card("Max per session", rep.maxAdsPerSession ?? "—")}
    </div>
    <div class="s-section"><h2>Ad management</h2><p class="muted">Ads power session renewal: users watch one of these to extend their session. Banner ads show an image, video ads play a video, YouTube ads embed a YouTube video, link ads open a sponsor page.</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Title</th><th>Type</th><th>Duration</th><th>Reward</th><th>Watches</th><th>Status</th><th></th></tr></thead><tbody id="adRows">
    ${ads.map(a => `<tr><td><b>${esc(a.title)}</b>${a.description ? `<br><span class="muted small">${esc(a.description)}</span>` : ""}</td><td>${esc(a.type)}${a.youtubeId ? `<br><span class="mono small">${esc(a.youtubeId)}</span>` : ""}</td><td>${a.durationSec}s</td><td>+${fmtClock(a.rewardMs || 0)}</td><td>${esc(a.watchCount ?? 0)}</td><td><span class="pill ${a.active ? "ok" : "err"}">${a.active ? "active" : "paused"}</span></td>
      <td><button class="btn ghost sm" data-toggle="${esc(a.id)}">${a.active ? "Pause" : "Activate"}</button> <button class="btn danger sm" data-del="${esc(a.id)}">Delete</button></td></tr>`).join("") || `<tr><td colspan="7" class="muted">No ads yet — create the first one below.</td></tr>`}
    </tbody></table></div></div>
    <div class="s-section"><h2>Create an ad</h2><div class="s-card">
      <div class="s-row"><div class="s-label"><b>Title</b><span>Shown to the user when renewing.</span></div><div class="s-ctl"><input class="input" id="adTitle" placeholder="Sponsored: Veyra Pro"></div></div>
      <div class="s-row"><div class="s-label"><b>Type</b><span>How the ad is displayed.</span></div><div class="s-ctl"><select class="input" id="adType"><option value="youtube">YouTube video</option><option value="video">Video (direct URL)</option><option value="banner">Banner (image)</option><option value="link">Link / sponsor page</option></select></div></div>
      <div class="s-row"><div class="s-label"><b>Media URL</b><span>YouTube link or ID, video file, image, or sponsor page.</span></div><div class="s-ctl"><input class="input" id="adUrl" placeholder="https://www.youtube.com/watch?v=…"></div></div>
      <div class="s-row"><div class="s-label"><b>Description</b><span>Optional one-liner.</span></div><div class="s-ctl"><input class="input" id="adDesc" placeholder=""></div></div>
      <div class="s-row"><div class="s-label"><b>Watch duration</b><span>Seconds the user must keep the ad open.</span></div><div class="s-ctl"><input class="input" id="adDur" type="number" min="5" max="300" value="15"></div></div>
      <div class="s-row"><div class="s-label"><b>Session reward</b><span>Time added to the session after watching.</span></div><div class="s-ctl"><select class="input" id="adReward"><option value="60000">1 minute</option><option value="120000" selected>2 minutes</option><option value="300000">5 minutes</option><option value="600000">10 minutes</option></select></div></div>
      <div class="s-row"><div class="s-ctl"><button class="btn primary" id="adCreate">Create ad</button></div></div>
    </div></div>`;
  $("adType").onchange = e => { const u = $("adUrl"); u.placeholder = e.target.value === "youtube" ? "https://www.youtube.com/watch?v=… or video ID" : e.target.value === "video" ? "https://…/ad.mp4" : e.target.value === "banner" ? "https://…/banner.png" : "https://sponsor.example/"; };
  $("adRows").onclick = async e => {
    const t = e.target.closest("[data-toggle]"), d = e.target.closest("[data-del]");
    try {
      if (t) { await api(`/api/renew/ads/${encodeURIComponent(t.dataset.toggle)}/toggle`, { method: "POST" }); toast("Ad updated"); }
      if (d) { await api(`/api/renew/ads/${encodeURIComponent(d.dataset.del)}`, { method: "DELETE" }); toast("Ad deleted"); }
      refreshAdmin(true);
    } catch (err) { toast(err.message, { kind: "err" }); }
  };
  $("adCreate").onclick = async () => {
    const btn = $("adCreate"); btn.disabled = true;
    try {
      await api("/api/renew/ads", { method: "POST", json: {
        title: $("adTitle").value.trim(), type: $("adType").value, url: $("adUrl").value.trim(),
        description: $("adDesc").value.trim(), durationSec: Number($("adDur").value) || 15, rewardMs: Number($("adReward").value) || 120000
      } });
      toast("Ad created"); refreshAdmin(true);
    } catch (err) { toast(err.message, { kind: "err" }); btn.disabled = false; }
  };
}

async function tabConfig(body) {
  const [cfg, plans, policyResult] = await Promise.allSettled([api("/api/config"), api("/api/config/plans"), api("/api/admin/session-policy")]);
  const c = cfg.value || {}, p = plans.value || {}, policy = policyResult.value?.policy || {};
  const mins = ms => ms == null ? 0 : Math.round(Number(ms) / 60000);
  body.innerHTML = `<div class="s-section"><h2>Session policy</h2><p class="muted">Control guest and administrator duration, idle cleanup, maximum age and concurrent proxy capacity. Changes apply immediately to new sessions.</p>
    <div class="s-card">
      <div class="s-row"><div class="s-label"><b>Guest session limit</b><span>Minutes; use 0 for no hard limit.</span></div><div class="s-ctl"><input class="input" id="policyGuest" type="number" min="0" max="10080" value="${esc(mins(policy.guestTimeLimitMs))}"></div></div>
      <div class="s-row"><div class="s-label"><b>Administrator session limit</b><span>Minutes; use 0 for no hard limit.</span></div><div class="s-ctl"><input class="input" id="policyAdmin" type="number" min="0" max="10080" value="${esc(mins(policy.adminTimeLimitMs))}"></div></div>
      <div class="s-row"><div class="s-label"><b>Idle timeout</b><span>Minutes without requests before deletion.</span></div><div class="s-ctl"><input class="input" id="policyIdle" type="number" min="1" max="1440" value="${esc(mins(policy.idleTtlMs))}"></div></div>
      <div class="s-row"><div class="s-label"><b>Maximum session age</b><span>Minutes from creation, regardless of activity.</span></div><div class="s-ctl"><input class="input" id="policyAge" type="number" min="10" max="10080" value="${esc(mins(policy.maxAgeMs))}"></div></div>
      <div class="s-row"><div class="s-label"><b>Maximum concurrent proxy sessions</b><span>Oldest sessions close when the cap is exceeded.</span></div><div class="s-ctl"><input class="input" id="policyMax" type="number" min="10" max="5000" value="${esc(policy.maxSessions ?? 500)}"></div></div>
      <div class="s-row"><div class="s-label"><b>Apply duration to active sessions</b><span>Otherwise duration changes affect new sessions only.</span></div><div class="s-ctl"><input type="checkbox" class="switch" id="policyExisting"></div></div>
      <div class="head-actions"><button class="btn primary" id="policySave">Apply session policy</button><span class="muted small" id="policyStatus">${esc(policy.activeSessions == null ? "" : `${policy.activeSessions} active session(s)`)}</span></div>
    </div></div>
    <div class="s-section"><h2>Runtime config</h2><p class="muted">Live server configuration. Save pushes the JSON to the server (admin only).</p>
    <pre class="json-view" id="cfgView" contenteditable="true" spellcheck="false">${esc(JSON.stringify(c.config || c, null, 2))}</pre>
    <div class="head-actions" style="margin-top:10px"><button class="btn primary" id="cfgSave">Save config</button><button class="btn ghost" id="cfgReload">Reload</button></div></div>
    <div class="s-section"><h2>Render plans</h2><div class="dev-grid">
    ${(p.plans || Object.entries(p)).slice ? (p.plans || []).map(x => card(x.name || x.id, `${x.ramMb} MB · ${x.cpu} CPU`)).join("") : Object.entries(p).map(([k, v]) => card(k, `${v.ramMb} MB · ${v.cpu} CPU`)).join("")}
    </div></div>`;
  $("policySave").onclick = async () => {
    const btn = $("policySave"); btn.disabled = true;
    try {
      const value = id => Number($(id).value) || 0;
      const result = await api("/api/admin/session-policy", { method: "PUT", json: {
        guestTimeLimitMs: value("policyGuest") * 60000,
        adminTimeLimitMs: value("policyAdmin") * 60000,
        idleTtlMs: value("policyIdle") * 60000,
        maxAgeMs: value("policyAge") * 60000,
        maxSessions: value("policyMax"),
        applyExisting: $("policyExisting").checked
      } });
      $("policyStatus").textContent = `${result.appliedExisting || 0} active session(s) updated`;
      toast("Session policy applied");
    } catch (err) { toast(`Session policy not applied: ${err.message}`, { kind: "err" }); }
    finally { btn.disabled = false; }
  };
  $("cfgReload").onclick = () => refreshAdmin(true);
  $("cfgSave").onclick = async () => {
    try {
      const parsed = JSON.parse($("cfgView").textContent);
      await api("/api/config", { method: "PUT", json: parsed });
      toast("Server config saved");
    } catch (err) { toast(`Config not saved: ${err.message}`, { kind: "err" }); }
  };
}

async function tabTools(body) {
  const [auth, vpn, challenge] = await Promise.allSettled([api("/api/auth/config"), api("/api/vpn/status"), api("/api/challenge/status")]);
  const a = auth.value || {}, v = vpn.value || {}, ch = challenge.value || {};
  body.innerHTML = `
    <div class="dev-grid">
      ${card("Test mode", a.testMode ? "ON" : "off", a.testMode ? "ok" : "")}
      ${card("Signup", a.signupEnabled ? "open" : "closed")}
      ${card("Session limit", a.sessionTimeLimitMs ? fmtClock(a.sessionTimeLimitMs) : "none")}
      ${card("VPN", v.enabled ? `${(v.profiles || []).length} exits` : "disabled")}
      ${card("Kill switch", v.killSwitch ? "on" : "off")}
      ${card("Challenge solver", ch.enabled ?? ch.status ?? "—")}
    </div>
    <div class="s-section"><h2>Test mode</h2><p class="muted">Test mode lets you instantly sign in as a test administrator with full access to this panel. Enable it on the server with VEYRA_TEST_MODE=1.</p>
    <div class="head-actions"><button class="btn primary" id="testAdminBtn">Log in as test admin</button></div></div>
    <div class="s-section"><h2>Admin token</h2><p class="muted">Set a token here to call admin endpoints directly (Settings → Developer also manages it). Sent as X-Veyra-Admin-Token on every request.</p>
    <div class="head-actions"><input class="input" id="admToken" type="password" placeholder="Admin token" value="${esc(settings.adminToken || "")}" style="max-width:340px"><button class="btn primary" id="admTokenSave">Save token</button></div></div>`;
  $("testAdminBtn").onclick = async () => {
    try {
      const r = await api("/api/auth/test-login", { method: "POST", json: {} });
      if (r.ok) { toast("Logged in as test admin — reloading panel", { ms: 4000 }); setTimeout(() => location.reload(), 600); }
      else toast(r.reason || "Test mode is off on this server", { kind: "warn" });
    } catch (err) { toast(err.message, { kind: "err" }); }
  };
  $("admTokenSave").onclick = () => { settings.adminToken = $("admToken").value.trim(); saveSettings(); toast("Admin token saved in this browser"); };
}

hooks.renderAdmin = renderAdmin;
addLog("debug", "ADMIN", "Admin panel module loaded");
