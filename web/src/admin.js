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
 *   - Access: rollout policy, waitlist and read-only access checks
 *   - Tools: VPN health, challenge status and admin token settings
 *
 * Admin-gated: the route is admin-only in app.js AND every endpoint here is
 * admin-gated on the server, so guests can never read other sessions' data.
 */

import { $, esc, api, toast, addLog, fmtBytes, fmtClock, fmtMs, hostOf, hooks, settings, saveSettings, confirmDialog, copyText } from "./core.js?v=8.29.0-workspace";

let refreshTimer = null;
let currentTab = "access";
let live = true;
let interval = "5000";
let liveBusy = false;
const LIVE_TABS = new Set(["overview", "sessions", "crawls", "requests", "logs"]);

const TABS = [
  ["access", "Access & rollout"], ["waitlist", "Browser waitlist"],
  ["overview", "System overview"], ["sessions", "Sessions"], ["crawls", "Crawls"], ["requests", "Requests"],
  ["logs", "Logs"], ["ads", "Ads & renewal"], ["config", "Config"], ["tools", "Tools"]
];

const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const MODES = {
  public: { label: "Public", description: "Anyone can browse.", icon: "globe" },
  invite: { label: "Invite only", description: "Requires a valid invite.", icon: "key" },
  staff: { label: "Staff only", description: "Pauses visitor access.", icon: "lock" }
};
const statusDate = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Deployment defaults";
const badge = (label, tone) => `<span class="adm-badge ${tone}"><i aria-hidden="true"></i>${esc(label)}</span>`;

export function renderAdmin(section = "") {
  if (!hooks.canOpenAdminPanel?.()) return;
  if (section && TABS.some(([id]) => id === section)) currentTab = section;
  const box = $("adminPanel") || $("view-admin");
  if (!box) return;
  box.innerHTML = `<div class="adm-console">
    <header class="adm-masthead"><div class="adm-title"><span class="adm-emblem">${icon("shield")}</span><div>
      <div class="adm-kicker">VEYRA / OPERATIONS</div><h1>Admin panel</h1><p>Manage browser access and server operations.</p>
    </div></div><div class="adm-actions">
      ${LIVE_TABS.has(currentTab) ? `<label class="switch-row"><span>Live</span><input type="checkbox" class="switch" id="adminLive" ${live ? "checked" : ""}></label>
      <select class="input" id="adminSpeed" aria-label="Live refresh interval">${[1, 2, 5, 15].map(n => `<option value="${n * 1000}" ${Number(interval) === n * 1000 ? "selected" : ""}>${n} s</option>`).join("")}</select>` : ""}
      <button type="button" class="btn ghost" id="adminRefresh" data-testid="button-refresh-admin" aria-label="Refresh">${icon("refresh")} <span>Refresh</span></button>
    </div></header>
    <nav class="adm-tabs" id="adminTabs" aria-label="Admin sections">${TABS.map(([id, label]) => `<button type="button" ${id === currentTab ? 'aria-current="page"' : ""} data-tab="${id}" data-testid="button-admin-${id}">${label}</button>`).join("")}</nav>
    <label class="adm-section-picker"><span>Admin section</span><select id="admSection" class="input">${TABS.map(([id, label]) => `<option value="${id}" ${id === currentTab ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <div id="adminBody"><div class="empty" role="status"><div class="spinner"></div><span>Loading ${esc(TABS.find(([id]) => id === currentTab)?.[1] || "admin data")}…</span></div></div>
  </div>`;
  $("adminTabs").onclick = async e => {
    const b = e.target.closest("[data-tab]");
    if (!b || b.dataset.tab === currentTab || !await allowLeave()) return;
    renderAdmin(b.dataset.tab);
    $("adminTabs").querySelector(`[data-tab="${currentTab}"]`)?.focus();
  };
  $("admSection").onchange = async e => {
    const picker = e.currentTarget, destination = picker.value;
    if (!await allowLeave()) { picker.value = currentTab; return; }
    renderAdmin(destination);
    $("admSection")?.focus();
  };
  $("adminRefresh").onclick = async () => { if (await allowLeave()) refreshAdmin(true); };
  if ($("adminSpeed")) $("adminSpeed").onchange = e => { interval = e.target.value; scheduleLive(); };
  if ($("adminLive")) $("adminLive").onchange = e => { live = e.target.checked; scheduleLive(); };
  scheduleLive();
  refreshAdmin(true);
}

async function allowLeave() {
  const form = $("admPolicyForm");
  if (!form || form.dataset.dirty !== "true") return !form?.dataset.saving;
  if (form.dataset.saving) return false;
  return confirmDialog("Discard unsaved access changes?", "The saved server policy will stay in effect.", "Discard changes");
}

function scheduleLive() {
  clearInterval(refreshTimer);
  if (!($("adminLive")?.checked)) return;
  const speed = Math.max(1000, Number($("adminSpeed")?.value) || 2000);
  refreshTimer = setInterval(() => { if ($("view-admin")?.classList.contains("active")) refreshAdmin(); else { clearInterval(refreshTimer); refreshTimer = null; } }, speed);
}

async function refreshAdmin(force = false) {
  const body = $("adminBody");
  if (!body || (!force && (liveBusy || !$("view-admin")?.classList.contains("active") || body.contains(document.activeElement)))) return;
  const tab = currentTab;
  liveBusy = true;
  try {
    switch (tab) {
      case "access": return await tabAccess(body);
      case "waitlist": return await tabWaitlist(body);
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
    if (!body.isConnected) return;
    if (e.status === 401 || e.status === 403) { body.innerHTML = `<div class="empty" role="alert"><b>Admin access required</b><span>Sign in as an administrator to view this section.</span></div>`; return; }
    body.innerHTML = `<div class="empty" role="alert"><b>Could not load admin data</b><span>${esc(e.message)}</span></div>`;
  } finally { liveBusy = false; }
}

const card = (a, b, cls = "") => `<div class="stat-card ${cls}"><span>${esc(a)}</span><b>${esc(String(b))}</b></div>`;

async function tabAccess(body, result = null, message = "") {
  if (!result) {
    try { result = await api("/api/gate/admin/policy"); }
    catch (e) {
      if (![404, 405, 501].includes(e.status)) throw e;
      const config = await api("/api/gate/config");
      body.innerHTML = `<section class="adm-panel"><h2>Access settings are read-only</h2><p>This server does not support the new policy controls yet.</p>
        <div class="adm-inline-badges">${badge(config.gated ? "Invite only" : "Public", "neutral")} ${badge(config.waitlistOpen ? "Waitlist open" : "Waitlist closed", "neutral")}</div></section>`;
      return;
    }
  }
  if (!body.isConnected) return;
  const { policy: p, report = {} } = result;
  if (!p || !MODES[p.mode]) throw new Error("This server did not return an access policy.");
  body.innerHTML = `<div class="adm-statusline" data-testid="status-access-policy"><div>${badge(MODES[p.mode].label, p.mode === "staff" ? "warn" : p.mode === "public" ? "ok" : "info")}
      ${badge(p.waitlistOpen ? "Waitlist open" : "Waitlist closed", p.waitlistOpen ? "ok" : "neutral")}
      ${badge(p.testMode ? "Test mode on" : "Test mode off", p.testMode ? "info" : "neutral")}</div>
      <span>${p.updatedAt ? `Saved ${esc(statusDate(p.updatedAt))}` : "Using deployment defaults"}</span>
    </div>
    <div class="adm-board">
      <section class="adm-panel adm-policy"><header><div class="adm-kicker">01 / PUBLIC ACCESS</div><h2>Browser access</h2><p>Choose who can open VeyraBrowser.</p></header>
        <form id="admPolicyForm" data-testid="form-access-policy">
          <fieldset class="adm-modes"><legend class="adm-sr">Browser access mode</legend>
            ${Object.entries(MODES).map(([key, m]) => `<label class="adm-mode">
              <input type="radio" name="mode" value="${key}" data-testid="mode-${key}" ${p.mode === key ? "checked" : ""}>
              <span class="adm-mode-card"><span class="adm-mode-top">${icon(m.icon)}<span class="adm-radio" aria-hidden="true"></span></span><b>${m.label}</b><small>${m.description}</small></span>
            </label>`).join("")}
          </fieldset>
          <div class="adm-setting"><div><label for="admWaitlistOpen">Waitlist signups</label><span id="admWaitlistDesc">Accept new browser applications. Existing entries stay in the queue.</span></div>
            <input type="checkbox" role="switch" class="switch" id="admWaitlistOpen" data-testid="switch-browser-waitlist" aria-describedby="admWaitlistDesc" ${p.waitlistOpen ? "checked" : ""}></div>
          <div class="adm-setting"><div><label for="admTestMode">Access test mode</label><span id="admTestDesc">Run read-only checks as a visitor, invite holder, or administrator. No test accounts are created.</span></div>
            <input type="checkbox" role="switch" class="switch" id="admTestMode" data-testid="switch-access-test-mode" aria-describedby="admTestDesc" ${p.testMode ? "checked" : ""}></div>
          <div class="adm-save"><button type="submit" class="btn primary" id="admPolicySave" data-testid="button-save-access-policy" disabled>Save access policy</button>
            <span id="admPolicyStatus" role="status">${esc(message || "No unsaved changes")}</span></div>
        </form>
      </section>
      <div class="adm-side">
        <section class="adm-panel"><header><div class="adm-kicker">02 / BROWSER WAITLIST</div><h2>Application queue</h2></header>
          <dl class="adm-stats"><div><dt>Pending review</dt><dd>${esc(report.waitlist?.pending ?? "–")}</dd></div>
            <div><dt>Accepted</dt><dd>${esc(report.waitlist?.accepted ?? "–")}</dd></div></dl>
          <button type="button" class="btn ghost" id="admQueueLink">Manage waitlist</button>
        </section>
        <section class="adm-panel"><header><div class="adm-kicker">03 / VERIFICATION</div><h2>Access checks</h2>
          <p>${p.testMode ? "Check the saved policy without signing out." : "Enable and save access test mode to run checks."}</p></header>
          <button type="button" class="btn ghost" id="admRunChecks" data-testid="button-run-access-checks" ${p.testMode ? "" : "disabled"}>Run access checks</button>
          <div id="admCheckResults" role="status" data-testid="status-access-checks"></div>
        </section>
      </div>
    </div>`;
  const form = $("admPolicyForm"), save = $("admPolicySave"), status = $("admPolicyStatus"), kinds = [...form.querySelectorAll("input")];
  const values = () => ({ mode: form.elements.mode.value, waitlistOpen: $("admWaitlistOpen").checked, testMode: $("admTestMode").checked, revision: p.revision });
  form.onchange = () => {
    const next = values();
    const dirty = ["mode", "waitlistOpen", "testMode"].some(key => next[key] !== p[key]);
    form.dataset.dirty = String(dirty); save.disabled = !dirty;
    status.classList.remove("is-error"); status.textContent = dirty ? "Unsaved changes" : "No unsaved changes";
  };
  form.onsubmit = async e => {
    e.preventDefault();
    if (save.disabled || form.dataset.saving) return;
    const next = values();
    form.dataset.saving = "true";
    const summary = next.mode === "staff" && p.mode !== "staff"
      ? "Visitors and invite holders will lose access on their next request. Live streams will disconnect. Staff can still sign in. The waitlist setting is independent."
      : next.mode !== p.mode ? `Browsing will switch to ${MODES[next.mode].label.toLowerCase()} access.` : "";
    const changes = [summary, next.waitlistOpen !== p.waitlistOpen ? `Waitlist signups will ${next.waitlistOpen ? "open" : "close"}. Existing entries are kept.` : "", next.testMode !== p.testMode ? `Access test mode will turn ${next.testMode ? "on" : "off"}.` : ""].filter(Boolean);
    try {
      if (!await confirmDialog("Apply access policy?", changes.join(" "), "Apply policy")) return;
      save.disabled = true; kinds.forEach(input => { input.disabled = true; });
      status.classList.remove("is-error"); status.textContent = "Saving…";
      const updated = await api("/api/gate/admin/policy", { method: "PUT", json: next });
      await tabAccess(body, updated, "Access policy saved");
      $("admPolicyStatus")?.setAttribute("tabindex", "-1"); $("admPolicyStatus")?.focus();
    } catch (err) {
      status.classList.add("is-error"); status.textContent = err.status === 409
        ? "Another admin updated the policy. Refresh before retrying." : `Unable to confirm the save. ${err.message}`;
    } finally {
      delete form.dataset.saving;
      kinds.forEach(input => { input.disabled = false; });
      save.disabled = form.dataset.dirty !== "true";
    }
  };
  $("admQueueLink").onclick = async () => {
    if (await allowLeave()) {
      renderAdmin("waitlist");
      const tab = $("adminTabs").querySelector('[data-tab="waitlist"]');
      (tab?.getClientRects().length ? tab : $("admSection"))?.focus();
    }
  };
  $("admRunChecks").onclick = async e => {
    const btn = e.currentTarget, out = $("admCheckResults");
    btn.disabled = true; out.textContent = "Checking saved policy…";
    try {
      const r = await api("/api/gate/admin/checks");
      out.innerHTML = `<dl class="adm-checks">${r.checks.map(c => `<div><dt>${esc(c.label)}</dt><dd>${c.browse ? "Can browse" : "Blocked"}</dd></div>`).join("")}</dl>
        <p>New waitlist signups: ${r.checks[0]?.waitlist ? "open" : "closed"}<br>Invite redemption: ${r.checks[0]?.redeemInvite ? "available" : "paused"}<br>Policy revision ${esc(r.revision)}</p>`;
    } catch (err) { out.textContent = err.message; }
    finally { btn.disabled = false; }
  };
}

async function tabWaitlist(body, offset = 0, issued = null) {
  const limit = 30;
  const data = await api(`/api/gate/admin/waitlist?limit=${limit}&offset=${offset}`);
  if (!body.isConnected) return;
  const rows = (data.entries || []).slice(0, limit);
  body.innerHTML = `<section class="adm-panel adm-queue"><header class="adm-queue-head"><div>
    <div class="adm-kicker">BROWSER ACCESS / APPLICATIONS</div><h2>Browser waitlist</h2><p>Review browser applications and manage invite links.</p>
    </div><div class="adm-actions"><button type="button" class="btn ghost" id="admInvite">Show invite link</button><button type="button" class="btn ghost" id="admRotate">Rotate link</button></div></header>
    <div id="admQueueStatus" role="status">${issued ? `${esc(issued.email?.sent ? "Access key emailed." : "Email not sent. Share the key privately.")} <code>${esc(issued.accessKey)}</code> <button type="button" class="btn ghost sm" data-copy>Copy key</button>` : ""}</div>
    <div class="adm-queue-list">
    ${rows.map(x => `<article class="adm-queue-row"><div><b>${esc(x.email)}</b><small>${esc(x.position ? `#${x.position} in queue` : "Accepted")}</small></div>
      ${badge(x.status === "pending" ? "Pending" : "Accepted", x.status === "pending" ? "warn" : "ok")}
      <div class="adm-actions">${x.status === "pending" ? `<button class="btn primary sm" data-action="accept" data-entry="${esc(x.id)}">Accept</button>` : `<button class="btn ghost sm" data-action="reissue-key" data-entry="${esc(x.id)}">Reissue key</button>`}
      <button class="btn ghost sm" data-action="reject" data-entry="${esc(x.id)}">Remove</button></div></article>`).join("") || `<div class="empty"><b>No applications yet</b><span>New browser applications will appear here.</span></div>`}
    </div>${data.total > limit ? `<footer class="adm-save"><button class="btn ghost" id="admQueuePrev" ${offset ? "" : "disabled"}>Previous</button><span>${offset + 1}–${offset + rows.length} of ${esc(data.total)}</span>
      <button class="btn ghost" id="admQueueNext" ${offset + rows.length < data.total ? "" : "disabled"}>Next</button></footer>` : ""}
  </section>`;
  const out = $("admQueueStatus");
  const invite = async (rotate, b) => {
    b.disabled = true;
    try {
      if (rotate && !await confirmDialog("Rotate the browser invite?", "The previous link still works until its grace period ends.", "Rotate invite")) return;
      const r = await api(`/api/gate/admin/${rotate ? "rotate" : "link"}`, { method: rotate ? "POST" : "GET" });
      out.innerHTML = `<code>${esc(r.link)}</code> <button class="btn ghost sm" data-copy>Copy link</button>`;
    } catch (e) { out.textContent = e.message; }
    finally { b.disabled = false; }
  };
  $("admInvite").onclick = e => invite(false, e.currentTarget);
  $("admRotate").onclick = e => invite(true, e.currentTarget);
  if ($("admQueuePrev")) {
    const page = async at => { try { await tabWaitlist(body, at); } catch (e) { out.textContent = e.message; } };
    $("admQueuePrev").onclick = () => page(Math.max(0, offset - limit));
    $("admQueueNext").onclick = () => page(offset + limit);
  }
  body.onclick = async e => {
    if (e.target.closest("[data-copy]")) { await copyText(out.querySelector("code").textContent); return; }
    const b = e.target.closest("[data-action][data-entry]");
    if (!b) return;
    const action = b.dataset.action;
    const details = {
      accept: ["Accept this applicant?", "This creates a key and emails it if delivery is configured.", "Accept applicant"],
      "reissue-key": ["Reissue this access key?", "This replaces the old key. Sessions already unlocked keep their access.", "Reissue key"],
      reject: ["Remove this application?", "This removes the entry and disables its key. Existing sessions are not ended.", "Remove application"]
    }[action];
    b.disabled = true;
    try {
      if (!await confirmDialog(...details)) return;
      const r = await api(`/api/gate/admin/waitlist/${encodeURIComponent(b.dataset.entry)}/${action}`, { method: "POST" });
      await tabWaitlist(body, rows.length === 1 && action === "reject" ? Math.max(0, offset - limit) : offset, r.accessKey ? r : null);
    } catch (err) { out.textContent = err.message; }
    finally { b.disabled = false; }
  };
}

async function tabOverview(body) {
  const [sys, sess, cast, renew, challenge, robots] = await Promise.allSettled([
    api("/api/debug/system"), api("/api/sessions"), api("/api/cast/stats"), api("/api/renew/report"),
    api("/api/challenge/status"), api("/api/robots/status")
  ]);
  if (!body.isConnected) return;
  if (sys.status === "rejected") throw sys.reason;
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
  if (!body.isConnected) return;
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
  if (!body.isConnected) return;
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
  if (!body.isConnected) return;
  const rows = r.requests || [];
  body.innerHTML = `<div class="s-section"><h2>Recent server requests (${rows.length})</h2>
    <div class="table-wrap" style="max-height:420px"><table class="table"><thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Duration</th></tr></thead><tbody>
    ${rows.map(x => `<tr><td>${new Date(x.time || x.startedAt || Date.now()).toLocaleTimeString([], { hour12: false })}</td><td>${esc(x.method)}</td><td class="mono" style="max-width:480px">${esc(x.path || x.url || "")}</td><td>${esc(x.status ?? "")}</td><td>${x.ms != null ? fmtMs(x.ms) : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No requests yet.</td></tr>`}
    </tbody></table></div></div>`;
}

async function tabLogs(body) {
  const src = body.dataset.logSource || "server";
  const lvl = body.dataset.logLevel || "";
  const logs = await api(`/api/debug/logs?source=${src}&level=${lvl}&limit=300`);
  if (!body.isConnected) return;
  const rows = (logs.logs || []).slice().reverse();
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
  if (!body.isConnected) return;
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
  if (!body.isConnected) return;
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
  if (!body.isConnected) return;
  const a = auth.value || {}, v = vpn.value || {}, ch = challenge.value || {};
  body.innerHTML = `
    <div class="dev-grid">
      ${card("Signup", a.signupEnabled ? "open" : "closed")}
      ${card("Session limit", a.sessionTimeLimitMs ? fmtClock(a.sessionTimeLimitMs) : "none")}
      ${card("VPN", v.enabled ? `${(v.profiles || []).length} exits` : "disabled")}
      ${card("Kill switch", v.killSwitch ? "on" : "off")}
      ${card("Challenge solver", ch.enabled ?? ch.status ?? "—")}
    </div>
    <div class="s-section"><h2>Admin token</h2><p class="muted">Set a token here to call admin endpoints directly (Settings → Developer also manages it). Sent as X-Veyra-Admin-Token on every request.</p>
    <div class="head-actions"><input class="input" id="admToken" type="password" placeholder="Admin token" value="${esc(settings.adminToken || "")}" style="max-width:340px"><button class="btn primary" id="admTokenSave">Save token</button></div></div>`;
  $("admTokenSave").onclick = () => { settings.adminToken = $("admToken").value.trim(); saveSettings(); toast("Admin token saved in this browser"); };
}

hooks.renderAdmin = renderAdmin;
addLog("debug", "ADMIN", "Admin panel module loaded");
