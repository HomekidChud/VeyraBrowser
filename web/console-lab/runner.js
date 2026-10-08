(() => {
  "use strict";
  if (document.body?.dataset.consoleLabAccess !== "granted") return;

  const MAX_REQUESTS_PER_RUN = 20;
  const MAX_SERVER_RUNS = 3;
  const RESOURCE_TIMEOUT_MS = 3000;
  const REQUEST_GAP_MS = 180;
  const POLL_MS = 8000;
  const API_ORIGIN = (document.querySelector('meta[name="veyra-api"]')?.content || "https://veyraserver-xscy.onrender.com").replace(/\/$/, "");
  const PAGE_URL = window.__VEYRA_PAGE_URL__ || location.href;
  const proxied = window.__VEYRA_PROXY__ === true;
  const $ = (id) => document.getElementById(id);
  const state = { running: false, stopRequested: false, currentResource: null, serverRuns: 0, rows: 0, runId: "", sessions: null, neural: null, workers: null, logs: [], snapshots: [], pollTimer: null, commandHistory: [], editingAgentId: null, activeAgentIds: new Set() };
  const runLocalButton = $("runLocal"), runServerButton = $("runServer"), runFullButton = $("runFull"), stopButton = $("stopRun");
  const AGENT_STORE = "veyra-console-lab-agents-v1";
  const RUN_STORE = "veyra-console-lab-runs-v1";

  function setStatus(text) { $("runState").textContent = text; }
  function updateCount() { $("counts").textContent = `${state.rows} case${state.rows === 1 ? "" : "s"} recorded · ${state.serverRuns}/${MAX_SERVER_RUNS} server batches used`; }
  function row(level, title, detail = "") {
    const li = document.createElement("li"); li.className = "result";
    const badge = document.createElement("span"); badge.className = `kind ${level}`; badge.textContent = level;
    const box = document.createElement("span"), strong = document.createElement("strong"); strong.textContent = title; box.appendChild(strong);
    if (detail) { const small = document.createElement("small"); small.textContent = detail; box.appendChild(small); }
    li.append(badge, box); $("results").prepend(li); state.rows += 1; updateCount();
  }
  function marker(id, message) { return `[VEYRA-LAB ${state.runId}][${id}] ${message}`; }
  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function updateProgress(done, total) { $("progressBar").style.width = `${total ? Math.min(100, done / total * 100) : 0}%`; }
  function startState() {
    state.running = true; state.stopRequested = false; state.runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    for (const button of [runLocalButton, runServerButton, runFullButton]) button.disabled = true;
    stopButton.disabled = false; $("progressBar").style.width = "0%";
    setStatus(`Running Veyra Console Lab ${state.runId}…`); updateCount(); return state.runId;
  }
  function finishState(message) {
    state.running = false; state.currentResource = null;
    for (const button of [runLocalButton, runServerButton, runFullButton]) button.disabled = false;
    stopButton.disabled = true; setStatus(message); updateCount();
    runServerButton.disabled = !proxied || state.serverRuns >= MAX_SERVER_RUNS;
    runFullButton.disabled = !proxied || state.serverRuns >= MAX_SERVER_RUNS;
  }

  // Controlled fixtures exercise Veyra's regular Console/Network diagnostics.
  function runLocalDiagnostics() {
    const tag = marker("console", "local console-level, object, grouping and duplicate checks");
    console.groupCollapsed(tag);
    console.log(marker("log", "plain log"), { runId: state.runId, nested: { safe: true, sample: [1, 2, 3] } });
    console.info(marker("info", "informational event"), { page: PAGE_URL, mode: proxied ? "Veyra proxy" : "direct" });
    console.debug(marker("debug", "verbose event"), { expected: "debug" });
    console.warn(marker("warn", "controlled warning"), { category: "fixture" });
    console.error(marker("error", "structured console error"), Object.assign(new TypeError("Expected Veyra Lab TypeError with a stack"), { code: "VEYRA_LAB_TYPE_ERROR", caseId: "console-error" }));
    console.dir({ runId: state.runId, nested: { object: { count: 3, active: true } } });
    console.table([{ case: "status-404", expected: 404 }, { case: "status-500", expected: 500 }, { case: "dns-invalid", expected: "network error" }]);
    console.trace(marker("trace", "trace should retain call-site context"));
    console.assert(false, marker("assert", "controlled assertion failure"), { expected: false, actual: true });
    for (let i = 1; i <= 4; i += 1) console.error(marker("duplicate", "repeated message for grouping"), { occurrence: i, runId: state.runId });
    console.groupEnd();
    const detailError = new TypeError("Veyra Lab synthetic exception: expected line, column, source, and stack fields");
    window.dispatchEvent(new ErrorEvent("error", { message: detailError.message, filename: new URL("fixtures/controlled-throw.js", PAGE_URL).href, lineno: 42, colno: 17, error: detailError }));
    window.dispatchEvent(new ErrorEvent("error", { message: "Script error.", filename: "", lineno: 0, colno: 0, error: null }));
    setTimeout(() => { throw new RangeError(marker("async-throw", "controlled uncaught timer exception")); }, 40);
    setTimeout(() => { Promise.reject(new TypeError(marker("rejection", "controlled unhandled rejection"))); }, 80);
    for (let i = 1; i <= 3; i += 1) {
      const img = document.createElement("img"); img.id = `veyra-lab-local-img-${i}`; img.alt = ""; img.hidden = true; img.onerror = () => img.remove();
      document.body.appendChild(img); img.src = `data:image/png;base64,VEYRA-LAB-invalid-image-${i}`;
    }
    row("ok", "Local diagnostic events scheduled", "Console levels, Error/TypeError/RangeError, source coordinates, generic Script error, unhandled rejection, duplicate grouping, and three intentionally invalid data images.");
  }
  function resourceTestPlan() {
    const run = encodeURIComponent(state.runId), api = new URL(API_ORIGIN);
    const tests = [
      { id: "api-health-1", label: "VeyraServer health JSON requested as an image", tag: "img", url: new URL(`/api/health?veyraLab=${run}&case=health-1`, api).href },
      { id: "api-health-2", label: "VeyraServer health JSON requested as an image (second trace)", tag: "img", url: new URL(`/api/health?veyraLab=${run}&case=health-2`, api).href }
    ];
    for (const status of [404, 418, 429, 500, 502, 503]) tests.push({ id: `http-${status}`, label: `HTTP ${status} body used as an image resource`, tag: "img", url: `https://httpbin.org/status/${status}?veyraLab=${run}` });
    for (let i = 1; i <= 4; i += 1) tests.push({ id: `dns-invalid-${i}`, label: `Reserved .invalid image host ${i}/4`, tag: "img", url: `https://probe-${run}-${i}.veyra-lab.invalid/diagnostic?case=${i}` });
    for (let i = 1; i <= 4; i += 1) tests.push({ id: `pages-404-${i}`, label: `GitHub Pages missing image fixture ${i}/4`, tag: "img", url: new URL(`fixtures/missing-${run}-${i}.png`, PAGE_URL).href });
    tests.push(
      { id: "resource-script-404", label: "Script element loading a missing GitHub Pages fixture", tag: "script", url: new URL(`fixtures/missing-${run}.js`, PAGE_URL).href },
      { id: "resource-css-404", label: "Stylesheet element loading a missing GitHub Pages fixture", tag: "link", url: new URL(`fixtures/missing-${run}.css`, PAGE_URL).href },
      { id: "resource-css-dns", label: "Stylesheet element loading a reserved .invalid host", tag: "link", url: `https://style-${run}.veyra-lab.invalid/missing.css` },
      { id: "resource-script-500", label: "Script element loading an HTTP 500 response", tag: "script", url: `https://httpbin.org/status/500?veyraLab=${run}&resource=script` }
    );
    return tests;
  }
  function resourceProbe(test) {
    return new Promise(resolve => {
      let finished = false; const element = document.createElement(test.tag); element.id = `veyra-lab-${test.id}-${state.runId}`; element.referrerPolicy = "no-referrer";
      if (test.tag === "img") { element.alt = ""; element.hidden = true; } if (test.tag === "script") element.async = true; if (test.tag === "link") element.rel = "stylesheet";
      const timeout = setTimeout(() => finish("timeout", "No load/error event arrived before the 3-second fixture timeout."), RESOURCE_TIMEOUT_MS);
      function finish(result) {
        if (finished) return; finished = true; clearTimeout(timeout); element.onload = null; element.onerror = null; element.remove(); if (state.currentResource === element) state.currentResource = null;
        const details = { url: test.url, tag: test.tag, selector: `#${element.id}`, result }, msg = marker(test.id, `${test.label}: ${result}`);
        if (result === "error") { console.error(msg, details); row("ok", test.label, "Expected resource error captured; expand Console for URL, tag and selector, then inspect Network for the response status."); }
        else { console.warn(msg, details); row("warn", test.label, `${result === "load" ? "Unexpected load event" : "Fixture timed out"}; inspect Network and the matching Console row.`); }
        resolve();
      }
      element.onload = () => finish("load"); element.onerror = () => finish("error"); state.currentResource = element;
      (test.tag === "link" ? document.head : document.body).appendChild(element); if (test.tag === "link") element.href = test.url; else element.src = test.url;
    });
  }
  async function runServerSuite() {
    if (!proxied) { row("warn", "Server suite not run", "Open this page through Veyra's Fast proxy so resource requests are routed by VeyraServer."); return; }
    if (state.serverRuns >= MAX_SERVER_RUNS) { row("warn", "Per-tab server-run cap reached", "Local-only diagnostics remain available."); return; }
    state.serverRuns += 1; const tests = resourceTestPlan();
    if (tests.length !== MAX_REQUESTS_PER_RUN) { console.error(marker("plan", "Test plan safety cap mismatch"), { planned: tests.length, cap: MAX_REQUESTS_PER_RUN }); row("error", "Probe plan stopped", `Planned ${tests.length} requests but the safety cap is ${MAX_REQUESTS_PER_RUN}.`); return; }
    let completed = 0;
    for (const test of tests) { if (state.stopRequested) break; await resourceProbe(test); completed += 1; updateProgress(completed, tests.length); if (!state.stopRequested) await wait(REQUEST_GAP_MS); }
    const message = state.stopRequested ? `Stopped after ${completed}/${tests.length} VeyraServer resource probes.` : `Finished ${completed}/${tests.length} sequential VeyraServer resource probes.`;
    console.info(marker("summary", message), { planned: tests.length, completed, sequential: true, retries: 0 }); row(state.stopRequested ? "warn" : "ok", message, "Inspect Console for individual resource-error details and Network for the matching requests.");
  }
  async function start(mode) {
    if (state.running) return;
    if ((mode === "server" || mode === "full") && state.serverRuns >= MAX_SERVER_RUNS) { row("warn", "Per-tab server-run cap reached", "At most three manual server batches are allowed per page load."); return; }
    startState();
    try { if (mode !== "server") { runLocalDiagnostics(); await wait(120); } if (mode !== "local") await runServerSuite(); finishState(state.stopRequested ? `Stopped run ${state.runId}.` : `Completed run ${state.runId}. Expand the Console diagnostics for detail.`); }
    catch (error) { console.error(marker("runner", "Test runner caught an unexpected error"), error); row("error", "Runner error", error?.stack || error?.message || String(error)); finishState(`Run ${state.runId} ended with a runner error.`); }
  }
  runLocalButton.addEventListener("click", () => start("local")); runServerButton.addEventListener("click", () => start("server")); runFullButton.addEventListener("click", () => start("full"));
  stopButton.addEventListener("click", () => { state.stopRequested = true; state.currentResource?.remove(); setStatus("Stop requested — the current resource is being cancelled; no later probes will start."); });
  $("clearReport").addEventListener("click", () => { $("results").replaceChildren(); state.rows = 0; updateCount(); setStatus("Report cleared. Existing Veyra Console entries are unchanged."); $("progressBar").style.width = "0%"; });
  const dot = $("proxyDot");
  if (proxied) { dot.classList.add("ok"); $("proxyState").textContent = `Veyra proxy detected · API ${new URL(API_ORIGIN).host}`; }
  else { $("proxyState").textContent = "Direct page view · live admin data requires a valid Veyra administrator session"; runServerButton.disabled = true; runFullButton.disabled = true; }
  updateCount();

  // Existing Veyra administrator credentials are read locally and never rendered or logged.
  function adminHeaders() {
    const headers = new Headers();
    try {
      const session = JSON.parse(localStorage.getItem("veyra-auth") || "null");
      const settings = JSON.parse(localStorage.getItem("veyra-settings") || "{}");
      if (typeof session?.token === "string" && session.token) headers.set("Authorization", `Bearer ${session.token}`);
      if (typeof settings?.adminToken === "string" && settings.adminToken.trim()) headers.set("X-Veyra-Admin-Token", settings.adminToken.trim());
    } catch {}
    return headers;
  }
  async function api(path, options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs ?? options.timeout ?? 10000));
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = adminHeaders(); if (options.body) headers.set("Content-Type", "application/json");
      const response = await fetch(`${API_ORIGIN}${path}`, { method: options.method || "GET", headers, body: options.body ? JSON.stringify(options.body) : undefined, credentials: "omit", cache: "no-store", signal: controller.signal });
      const raw = await response.text();
      const body = raw ? (() => { try { return JSON.parse(raw); } catch { return { message: raw.slice(0, 500) }; } })() : {};
      if (!response.ok) { const error = new Error(body.error || body.message || `VeyraServer returned HTTP ${response.status}`); error.status = response.status; error.code = body.code || "HTTP_ERROR"; throw error; }
      return body;
    } catch (error) {
      if (error?.name === "AbortError") { const timeoutError = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`); timeoutError.code = "API_TIMEOUT"; throw timeoutError; }
      throw error;
    } finally { clearTimeout(timeout); }
  }
  const fmt = value => Number(value || 0).toLocaleString();
  const age = ms => { const n = Math.max(0, Math.floor(Number(ms || 0) / 1000)); return n < 60 ? `${n}s` : n < 3600 ? `${Math.floor(n / 60)}m` : `${Math.floor(n / 3600)}h ${Math.floor(n % 3600 / 60)}m`; };
  const safeNum = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  function text(id, value) { const el = $(id); if (el) el.textContent = String(value ?? "—"); }
  function addConsole(line, level = "info") {
    const out = $("consoleOutput"); if (!out) return;
    const item = document.createElement("div"); item.className = `console-line ${level}`; item.textContent = `${new Date().toLocaleTimeString()}  ${line}`; out.appendChild(item); out.scrollTop = out.scrollHeight;
    while (out.children.length > 300) out.firstElementChild.remove();
    applyConsoleFilter();
  }
  function applyConsoleFilter() {
    const query = ($("consoleSearch")?.value || "").trim().toLowerCase(), level = $("consoleLevelFilter")?.value || "all";
    $("consoleOutput")?.querySelectorAll(".console-line").forEach(line => { line.hidden = (level !== "all" && !line.classList.contains(level)) || (query && !line.textContent.toLowerCase().includes(query)); });
  }
  function shortJson(value) { try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
  function renderEvents(target, entries) {
    const root = $(target); if (!root) return; root.replaceChildren();
    if (!Array.isArray(entries) || !entries.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = "No recent worker events."; root.appendChild(li); return; }
    entries.slice(-8).reverse().forEach(event => {
      const li = document.createElement("li"); li.className = "event"; const title = document.createElement("b"), sub = document.createElement("small");
      const eventUrl = event.url || event.currentUrl || "";
      title.textContent = [event.type || event.event || event.level || event.status || "Worker event", event.title || event.message || ""].filter(Boolean).join(" · ");
      sub.textContent = [eventUrl, event.timestamp || event.time ? new Date(event.timestamp || event.time).toLocaleTimeString() : "", event.pagesCrawled != null ? `${event.pagesCrawled} pages` : ""].filter(Boolean).join(" · ") || "Crawler status update";
      li.append(title, sub); root.appendChild(li);
    });
  }
  function renderDashboard() {
    const sessions = state.sessions, neural = state.neural, workers = state.workers;
    if (sessions) {
      const sessionRows = Array.isArray(sessions.sessions) ? sessions.sessions : [];
      text("metricSessions", fmt(sessions.active)); text("metricSessionsNote", `${fmt(sessions.max)} session capacity`); text("metricBrowsers", fmt(sessions.browserSessions));
      text("activityTotal", fmt(sessions.active)); text("activityBrowsers", fmt(sessions.browserSessions)); text("activityRequests", fmt(sessionRows.reduce((n, x) => n + safeNum(x.requests), 0))); text("activityIdle", age(sessions.idleForMs));
      const body = $("sessionRows"); if (body) { body.replaceChildren(); if (!sessionRows.length) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 5; td.className = "muted"; td.textContent = "No active sessions."; tr.appendChild(td); body.appendChild(tr); }
        sessionRows.slice(0, 60).forEach((session, index) => { const tr = document.createElement("tr"); [ `Session ${index + 1}`, age(session.ageMs), fmt(session.requests), fmt(session.browserSessions), session.paused ? "Paused" : "Active" ].forEach(value => { const td = document.createElement("td"); td.textContent = value; tr.appendChild(td); }); body.appendChild(tr); }); }
      const counts = state.snapshots.map(x => x.active); const chart = $("pulseChart"); if (chart) { chart.replaceChildren(); const max = Math.max(1, ...counts); counts.forEach(count => { const bar = document.createElement("i"); bar.style.height = `${Math.max(6, count / max * 100)}%`; bar.title = `${count} active sessions`; chart.appendChild(bar); }); }
    }
    if (neural) {
      const model = neural.model || {}, stats = model.stats || {}, trainer = neural.trainer || {};
      text("metricScores", fmt(stats.scored)); text("metricTraining", `${fmt(model.trainingExamples ?? stats.trained)} training examples`);
      text("analyticsScored", fmt(stats.scored)); text("analyticsTrained", fmt(model.trainingExamples ?? stats.trained)); text("analyticsPositive", fmt(stats.positiveFeedback)); text("analyticsAverage", `${Math.round(safeNum(stats.avgScore) * 100)}%`);
      const details = $("modelDetails"); if (details) details.textContent = `Enabled: ${model.enabled ? "yes" : "no"} · Features: ${fmt(model.features?.length)} · Feedback history: ${fmt(model.feedbackCount)} · URL feature cache: ${fmt(model.urlCacheSize)} · Negative feedback: ${fmt(stats.negativeFeedback)} · Trainer queue: ${fmt(trainer.queueSize)} · Trainer: ${trainer.running ? "running" : "stopped"}`;
    }
    if (workers) {
      const list = workers.workers || []; text("metricWorkers", `${fmt(workers.active)} / ${fmt(workers.totalWorkers)}`); text("metricWorkerNote", `${fmt(workers.totalPagesCrawled)} pages · ${fmt(workers.totalErrors)} errors`);
      text("workerStatus", `${fmt(workers.active)} active · ${fmt(workers.idle)} idle`); text("analyticsQueue", `Queue ${fmt(list.reduce((sum, worker) => sum + safeNum(worker.queueSize), 0))}`);
      const details = $("workerDetails"); if (details) details.textContent = `${fmt(workers.totalWorkers)} workers · ${fmt(workers.active)} active · ${fmt(workers.idle)} idle · ${fmt(workers.totalPagesCrawled)} pages crawled · ${fmt(workers.totalLinksFound)} links found · ${fmt(workers.totalBytesFetched)} bytes · ${fmt(workers.totalErrors)} errors`;
      renderEvents("recentEvents", state.logs); renderEvents("agentEvents", state.logs); renderEvents("activityEvents", state.logs); renderEvents("analyticsEvents", state.logs);
      renderFleet();
    }
    const now = new Date().toLocaleTimeString(); text("lastUpdated", `Last refreshed ${now} · next refresh in ${Math.round(POLL_MS / 1000)} seconds`); text("activityUpdated", `Updated ${now}`); text("consoleConnection", "Connected · admin metrics");
  }
  async function refreshData(quiet = false) {
    const results = await Promise.allSettled([api("/api/sessions"), api("/api/neural/stats"), api("/api/robots/status"), api("/api/robots/log?limit=12")]);
    if (results[0].status === "fulfilled") state.sessions = results[0].value;
    if (results[1].status === "fulfilled") state.neural = results[1].value;
    if (results[2].status === "fulfilled") state.workers = results[2].value;
    if (results[3].status === "fulfilled") state.logs = Array.isArray(results[3].value) ? results[3].value : results[3].value?.events || [];
    const failures = results.filter(x => x.status === "rejected");
    renderDashboard();
    if (failures.length) {
      const message = failures.map(x => x.reason?.message || "API unavailable").join("; ");
      text("consoleConnection", `Some APIs unavailable: ${message}`); text("lastUpdated", `Partial data · ${message}`);
      if (!quiet) addConsole(`Refresh warning: ${message}`, "warn");
      if (!state.sessions && !state.neural && !state.workers) { const w = $("workerStatus"); if (w) w.textContent = "API unavailable"; }
    } else if (!quiet) addConsole("Admin metrics refreshed.");
    const bar = $("proxyDot"); if (bar && (state.sessions || state.neural || state.workers)) bar.classList.add("ok");
    state.snapshots.push({ at: Date.now(), active: safeNum(state.sessions?.active) }); if (state.snapshots.length > 24) state.snapshots.shift();
    if (state.sessions) { const chart = $("pulseChart"); if (chart) { chart.replaceChildren(); const max = Math.max(1, ...state.snapshots.map(x => x.active)); state.snapshots.forEach(point => { const el = document.createElement("i"); el.style.height = `${Math.max(6, point.active / max * 100)}%`; el.title = `${point.active} active sessions`; chart.appendChild(el); }); } }
  }

  // Browser-local agent profiles configure the server's existing neural crawler. No hidden schedule is created.
  function readAgents() { try { const parsed = JSON.parse(localStorage.getItem(AGENT_STORE) || "[]"); return Array.isArray(parsed) ? parsed.filter(a => a && typeof a.id === "string") : []; } catch { return []; } }
  function saveAgents(items) { localStorage.setItem(AGENT_STORE, JSON.stringify(items.slice(0, 30))); }
  function readRuns() { try { const parsed = JSON.parse(localStorage.getItem(RUN_STORE) || "[]"); return Array.isArray(parsed) ? parsed.slice(0, 50) : []; } catch { return []; } }
  function saveRuns(items) { localStorage.setItem(RUN_STORE, JSON.stringify(items.slice(0, 50))); }
  function downloadJson(filename, value) { const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function validAgent(input) {
    if (!input || typeof input !== "object") return null;
    let url; try { url = new URL(String(input.seed || "")); } catch { return null; }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const name = String(input.name || "").trim().slice(0, 36), goal = String(input.goal || "").trim().slice(0, 240);
    if (!name || !goal) return null;
    const focus = ["research", "documentation", "site-audit", "relevance"].includes(input.focus) ? input.focus : "research";
    return { id: String(input.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`).slice(0, 80), name, seed: url.href, goal, focus, notes: String(input.notes || "").slice(0, 180), maxPages: Math.max(1, Math.min(50, Number(input.maxPages) || 12)), maxDepth: Math.max(1, Math.min(5, Number(input.maxDepth) || 2)), createdAt: Number(input.createdAt) || Date.now(), lastRun: input.lastRun || null };
  }
  function renderRunHistory() {
    const root = $("runHistoryList"), runs = readRuns(); if (!root) return;
    const profiles = readAgents(); text("runProfileCount", profiles.length); text("runHistoryCount", runs.length); text("runPagesTotal", fmt(runs.reduce((sum, run) => sum + safeNum(run.pagesCrawled), 0))); text("runLatest", runs[0] ? runs[0].status : "—"); root.replaceChildren();
    if (!runs.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = "No runs have been recorded yet."; root.appendChild(li); return; }
    runs.forEach(run => {
      const li = document.createElement("li"); li.className = "run-card"; const header = document.createElement("div"); header.className = "run-card-head"; const title = document.createElement("b"); title.textContent = run.agentName || "Agent run"; const status = document.createElement("span"); status.className = "pill"; status.textContent = run.status || "complete"; header.append(title, status);
      const detail = document.createElement("p"); detail.textContent = `${new Date(run.at || Date.now()).toLocaleString()} · ${run.seed || ""} · ${fmt(run.pagesCrawled)} pages · ${fmt(run.linksFound)} links · ${fmt(run.errors)} errors`;
      const found = document.createElement("div"); found.className = "run-results"; (run.findings || []).slice(0, 6).forEach(item => { const chip = document.createElement("span"); chip.textContent = item.title || item.url || "Page found"; found.appendChild(chip); });
      li.append(header, detail); if (found.childElementCount) li.appendChild(found); root.appendChild(li);
    });
  }
  function renderFleet() {
    const workers = state.workers; if (!workers) return;
    const entries = Array.isArray(workers.workers) ? workers.workers : [];
    text("fleetTotal", fmt(workers.totalWorkers)); text("fleetActive", fmt(workers.active)); text("fleetPages", fmt(workers.totalPagesCrawled)); text("fleetErrors", fmt(workers.totalErrors));
    const body = $("fleetRows"); if (body) { body.replaceChildren(); if (!entries.length) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 8; td.className = "muted"; td.textContent = "No crawler workers are currently configured."; tr.appendChild(td); body.appendChild(tr); }
      entries.forEach((worker, index) => { const tr = document.createElement("tr"); const values = [`Worker ${index + 1}`, worker.status || "unknown", worker.currentUrl || "—", fmt(worker.queueSize), fmt(worker.visitedCount), fmt(worker.pagesCrawled), `${fmt(worker.avgLatencyMs)} ms`, fmt(worker.errors)]; values.forEach((value, i) => { const td = document.createElement("td"); td.textContent = value; if (i === 2) td.className = "target"; tr.appendChild(td); }); body.appendChild(tr); }); }
    text("fleetHealth", workers.error ? `${fmt(workers.error)} workers degraded` : `${fmt(workers.active)} active · ${fmt(workers.idle)} idle`);
    text("fleetDiagnostics", `${fmt(workers.totalWorkers)} workers · ${fmt(workers.totalPagesCrawled)} pages · ${fmt(workers.totalLinksFound)} links · ${fmt(workers.totalBytesFetched)} bytes · ${fmt(workers.totalErrors)} reported errors. This view reflects the server's current worker snapshot.`);
  }
  function renderAgents() {
    const root = $("agentList"), agents = readAgents(); text("agentCount", `${agents.length} saved`); if (!root) return; root.replaceChildren();
    const filter = ($("agentSearch")?.value || "").trim().toLowerCase(), visible = agents.filter(agent => `${agent.name} ${agent.goal} ${agent.seed} ${agent.focus}`.toLowerCase().includes(filter));
    if (!visible.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = agents.length ? "No saved agent matches that filter." : "Create a profile or start with a playbook."; root.appendChild(li); return; }
    visible.forEach(agent => {
      const li = document.createElement("li"); li.className = "agent-card"; const copy = document.createElement("span"), name = document.createElement("b"), meta = document.createElement("small"), badges = document.createElement("span"); copy.className = "agent-main"; badges.className = "agent-badges";
      name.textContent = agent.name; meta.textContent = `${agent.seed} · ${agent.maxPages} page cap · depth ${agent.maxDepth} · ${agent.goal}${agent.notes ? ` · ${agent.notes}` : ""}`; const focus = document.createElement("span"); focus.className = "pill"; focus.textContent = agent.focus || "research"; badges.appendChild(focus); if (agent.lastRun) { const last = document.createElement("span"); last.className = "pill"; last.textContent = `Last run · ${new Date(agent.lastRun.at).toLocaleString()}`; badges.appendChild(last); } copy.append(name, meta, badges);
      const actions = document.createElement("span"); actions.className = "agent-actions";
      const makeButton = (label, cls, fn) => { const button = document.createElement("button"); button.className = `btn ${cls}`; button.type = "button"; button.textContent = label; button.addEventListener("click", fn); return button; };
      const runButton = makeButton(state.activeAgentIds.has(agent.id) ? "Running…" : "Run now", "primary", event => launchAgent(agent, event.currentTarget)); runButton.disabled = state.activeAgentIds.has(agent.id);
      actions.append(runButton, makeButton("Edit", "", () => editAgent(agent)), makeButton("Duplicate", "", () => duplicateAgent(agent)), makeButton("Delete", "danger", () => { saveAgents(readAgents().filter(item => item.id !== agent.id)); renderAgents(); renderRunHistory(); })); li.append(copy, actions); root.appendChild(li);
    });
  }
  function editAgent(agent) {
    state.editingAgentId = agent.id; $("agentName").value = agent.name; $("agentSeed").value = agent.seed; $("agentFocus").value = agent.focus || "research"; $("agentGoal").value = agent.goal; $("agentPages").value = agent.maxPages; $("agentDepth").value = agent.maxDepth; $("agentNotes").value = agent.notes || ""; $("agentRunSize").value = "custom"; text("agentFormStatus", `Editing ${agent.name}; save to update its profile.`); $("agentForm").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function duplicateAgent(agent) { const agents = readAgents(); if (agents.length >= 30) { text("agentFormStatus", "Maximum of 30 saved profiles reached."); return; } const copy = validAgent({ ...agent, id: undefined, name: `${agent.name} copy`, createdAt: Date.now(), lastRun: null }); agents.unshift(copy); saveAgents(agents); renderAgents(); renderRunHistory(); }
  async function launchAgent(agent, button) {
    if (state.activeAgentIds.has(agent.id)) return;
    state.activeAgentIds.add(agent.id); button.disabled = true; button.textContent = "Running…"; renderAgents(); addConsole(`Launching agent “${agent.name}” for ${agent.seed}`, "info"); text("agentFormStatus", `Running ${agent.name}…`);
    try {
      const focusLabels = { research: "topic research", documentation: "documentation mapping", "site-audit": "site structure audit", relevance: "neural relevance" };
      const result = await api("/api/robots/crawl", { method: "POST", body: { seed: agent.seed, query: `${focusLabels[agent.focus] || "research"} ${agent.goal}`, maxDepth: agent.maxDepth, maxPages: agent.maxPages }, timeoutMs: Math.max(60000, agent.maxPages * 15000) });
      const settled = Array.isArray(result.results) ? result.results : [], workerResults = settled.map(item => item.result).filter(Boolean), pages = workerResults.flatMap(item => Array.isArray(item.pages) ? item.pages : []), stats = workerResults.reduce((sum, item) => ({ pagesCrawled: sum.pagesCrawled + safeNum(item.stats?.pagesCrawled), linksFound: sum.linksFound + safeNum(item.stats?.linksFound), errors: sum.errors + safeNum(item.stats?.errors) }), { pagesCrawled: 0, linksFound: 0, errors: 0 });
      if (!settled.length) throw new Error("No idle crawler worker is available. Refresh the fleet status and try again shortly.");
      stats.errors += settled.filter(item => item.status !== "fulfilled").length;
      const findings = pages.slice(0, 6).map(page => ({ title: String(page.title || "Untitled page").slice(0, 100), url: String(page.url || "").slice(0, 400) })), run = { id: `${Date.now()}`, at: Date.now(), agentName: agent.name, seed: agent.seed, status: settled.length && settled.every(item => item.status === "fulfilled") ? "Complete" : settled.length ? "Partial" : "No worker available", pagesCrawled: stats.pagesCrawled, linksFound: stats.linksFound, errors: stats.errors, findings };
      try { saveRuns([run, ...readRuns()]); const all = readAgents(), index = all.findIndex(item => item.id === agent.id); if (index >= 0) { all[index].lastRun = { at: run.at, status: run.status }; saveAgents(all); } } catch {}
      addConsole(`${agent.name} finished: ${fmt(stats.pagesCrawled)} pages, ${fmt(stats.linksFound)} links, ${fmt(stats.errors)} errors.`, "info"); text("agentFormStatus", `${agent.name}: ${fmt(stats.pagesCrawled)} pages crawled · ${fmt(stats.linksFound)} links found.`); renderRunHistory(); renderAgents(); await refreshData(true);
    } catch (error) { const run = { id: `${Date.now()}`, at: Date.now(), agentName: agent.name, seed: agent.seed, status: "Failed", pagesCrawled: 0, linksFound: 0, errors: 1, findings: [{ title: String(error.message || "Agent run failed").slice(0, 100), url: "" }] }; try { saveRuns([run, ...readRuns()]); } catch {} renderRunHistory(); addConsole(`${agent.name} failed: ${error.message}`, "error"); text("agentFormStatus", `${agent.name}: ${error.message}`); }
    finally { state.activeAgentIds.delete(agent.id); button.disabled = false; button.textContent = "Run now"; renderAgents(); }
  }
  $("agentForm").addEventListener("submit", event => {
    event.preventDefault(); const agents = readAgents(); if (!state.editingAgentId && agents.length >= 30) { text("agentFormStatus", "Maximum of 30 saved profiles reached."); return; }
    const seed = $("agentSeed").value.trim(); let parsed; try { parsed = new URL(seed); } catch { text("agentFormStatus", "Enter a valid public HTTP or HTTPS seed URL."); return; }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) { text("agentFormStatus", "Only public HTTP(S) URLs without embedded credentials are supported."); return; }
    const agent = validAgent({ id: state.editingAgentId || undefined, name: $("agentName").value, seed: parsed.href, focus: $("agentFocus").value, goal: $("agentGoal").value, notes: $("agentNotes").value, maxPages: $("agentPages").value, maxDepth: $("agentDepth").value, createdAt: Date.now() });
    if (!agent) { text("agentFormStatus", "Add a valid agent name and task objective."); return; }
    const index = agents.findIndex(item => item.id === state.editingAgentId); if (index >= 0) agents[index] = { ...agents[index], ...agent, id: state.editingAgentId }; else agents.unshift(agent);
    try { saveAgents(agents); } catch { text("agentFormStatus", "Browser storage is unavailable; profile was not saved."); return; }
    state.editingAgentId = null; event.target.reset(); $("agentPages").value = 12; $("agentDepth").value = 2; $("agentRunSize").value = "balanced"; text("agentFormStatus", `Saved ${agent.name}. Start it from the profile library when ready.`); renderAgents(); renderRunHistory(); addConsole(`Saved custom agent profile “${agent.name}”.`);
  });

  const presets = {
    docs: { name: "Documentation Mapper", focus: "documentation", goal: "Locate guides, API references, onboarding, and installation documentation.", pages: 12, depth: 2, notes: "Prioritize canonical documentation and reference pages." },
    audit: { name: "Site Structure Auditor", focus: "site-audit", goal: "Explore important site sections and identify navigation coverage clues.", pages: 30, depth: 3, notes: "Respect the site's robots.txt rules." },
    topic: { name: "Topic Research Scout", focus: "research", goal: "Research the selected topic; replace this text with the subject and key terms.", pages: 18, depth: 2, notes: "Review the returned page titles before follow-up research." }
  };
  document.querySelectorAll("[data-command]").forEach(button => button.addEventListener("click", () => { $("commandInput").value = button.dataset.command; $("commandForm").requestSubmit(); }));
  $("consoleSearch").addEventListener("input", applyConsoleFilter); $("consoleLevelFilter").addEventListener("change", applyConsoleFilter);
  $("copyConsole").addEventListener("click", async () => { const content = [...$("consoleOutput").querySelectorAll(":scope > .console-line:not([hidden])")].map(line => line.textContent).join("\n"); try { await navigator.clipboard.writeText(content); addConsole("Visible output copied to clipboard."); } catch { addConsole("Clipboard access was unavailable in this context.", "warn"); } });
  $("commandInput").addEventListener("keydown", event => {
    if (event.key === "ArrowUp" && state.commandHistory.length) { event.preventDefault(); state.historyCursor = Math.min((state.historyCursor || 0) + 1, state.commandHistory.length); event.currentTarget.value = state.commandHistory[state.historyCursor - 1] || ""; }
    if (event.key === "ArrowDown" && state.historyCursor) { event.preventDefault(); state.historyCursor -= 1; event.currentTarget.value = state.historyCursor ? state.commandHistory[state.historyCursor - 1] : ""; }
  });
  document.querySelectorAll("[data-agent-preset]").forEach(button => button.addEventListener("click", () => {
    const preset = presets[button.dataset.agentPreset]; if (!preset) return;
    $("agentName").value = preset.name; $("agentFocus").value = preset.focus; $("agentGoal").value = preset.goal; $("agentPages").value = preset.pages; $("agentDepth").value = preset.depth; $("agentNotes").value = preset.notes; $("agentRunSize").value = "custom"; text("agentFormStatus", "Playbook loaded. Set a seed URL and adjust the objective before saving."); $("agentSeed").focus();
  }));
  $("agentRunSize").addEventListener("change", () => { const limits = { quick: [8, 1], balanced: [12, 2], deep: [30, 4] }[ $("agentRunSize").value ]; if (limits) { $("agentPages").value = limits[0]; $("agentDepth").value = limits[1]; } });
  $("agentSearch").addEventListener("input", renderAgents);
  $("resetAgentForm").addEventListener("click", () => { $("agentForm").reset(); state.editingAgentId = null; $("agentPages").value = 12; $("agentDepth").value = 2; $("agentRunSize").value = "balanced"; text("agentFormStatus", "Builder reset."); });
  $("exportAgents").addEventListener("click", () => downloadJson(`veyra-agent-profiles-${new Date().toISOString().slice(0, 10)}.json`, { version: 1, exportedAt: new Date().toISOString(), agents: readAgents() }));
  $("importAgents").addEventListener("click", () => $("agentImportFile").click());
  $("agentImportFile").addEventListener("change", async event => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    if (file.size > 500000) { text("agentFormStatus", "Import file exceeds the 500 KB limit."); return; }
    try {
      const payload = JSON.parse(await file.text()), incoming = Array.isArray(payload) ? payload : payload.agents;
      if (!Array.isArray(incoming)) throw new Error("Expected an array of agent profiles.");
      const existing = readAgents(), imported = [];
      for (const raw of incoming) { const candidate = validAgent(raw); if (!candidate) continue; if (existing.length + imported.length >= 30) break; if ([...existing, ...imported].some(item => item.id === candidate.id)) candidate.id = undefined; imported.push(validAgent(candidate)); }
      if (!imported.length) throw new Error("No valid HTTP(S) agent profiles were found.");
      saveAgents([...imported, ...existing]); renderAgents(); renderRunHistory(); text("agentFormStatus", `Imported ${imported.length} valid profile${imported.length === 1 ? "" : "s"}.`);
    } catch (error) { text("agentFormStatus", `Import failed: ${error.message}`); }
  });
  $("exportRuns").addEventListener("click", () => downloadJson(`veyra-task-runs-${new Date().toISOString().slice(0, 10)}.json`, { version: 1, exportedAt: new Date().toISOString(), runs: readRuns() }));
  $("clearRuns").addEventListener("click", () => { if (!readRuns().length || !window.confirm("Clear this browser's saved task run history?")) return; saveRuns([]); renderRunHistory(); });
  const tabs = [...document.querySelectorAll(".tab[data-view]")];
  function activateView(name) { tabs.forEach(tab => { const selected = tab.dataset.view === name; tab.setAttribute("aria-selected", String(selected)); const panel = $(`view-${tab.dataset.view}`); panel?.classList.toggle("active", selected); }); }
  tabs.forEach(tab => tab.addEventListener("click", () => activateView(tab.dataset.view)));
  document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => activateView(button.dataset.go)));
  document.querySelectorAll("[data-refresh]").forEach(button => button.addEventListener("click", () => refreshData(false)));
  renderAgents(); renderRunHistory();
  $("clearConsole").addEventListener("click", () => $("consoleOutput").replaceChildren());
  $("exportConsole").addEventListener("click", () => {
    const content = [...$("consoleOutput").children].map(node => node.textContent).join("\n"); const blob = new Blob([content || "Veyra Console Lab: no console output."], { type: "text/plain" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `veyra-console-${new Date().toISOString().slice(0, 10)}.txt`; a.click(); URL.revokeObjectURL(url);
  });
  $("commandForm").addEventListener("submit", async event => {
    event.preventDefault(); const input = $("commandInput"), raw = input.value.trim(); if (!raw) return; input.value = ""; state.commandHistory.unshift(raw); state.historyCursor = 0;
    addConsole(`> ${raw}`);
    const parts = raw.match(/(?:[^\s"]+|"[^"]*")+/g) || [], requested = String(parts.shift() || "").toLowerCase(), command = ({ "?": "help", "h": "help", health: "status", ping: "status", worker: "workers", model: "neural", reload: "refresh", refresh: "refresh" })[requested] || requested;
    if (command === "clear") { $("consoleOutput").replaceChildren(); return; }
    if (command === "help") { addConsole("Commands: help [command] · status [--json] · sessions · neural · workers · agents · refresh · clear. Aliases: ?, health, ping, worker, model, reload. Use the module tabs for details; arbitrary JavaScript execution is disabled."); return; }
    if (command === "agents") { addConsole(shortJson(readAgents().map(({ name, seed, goal, maxPages, maxDepth }) => ({ name, seed, goal, maxPages, maxDepth })))); return; }
    if (command === "refresh") { await refreshData(false); return; }
    if (!["status", "sessions", "neural", "workers"].includes(command)) { addConsole(`Unknown command “${raw}”. Type help for the available commands.`, "warn"); return; }
    if (!state.sessions && !state.neural && !state.workers) await refreshData(true);
    if (command === "sessions") { if (!state.sessions) return addConsole("Session API is unavailable or access was denied.", "error"); const s = state.sessions; addConsole(shortJson({ active: s.active, capacity: s.max, browserSessions: s.browserSessions, pausedSessions: s.pausedSessions, idleForMs: s.idleForMs, requestCount: (s.sessions || []).reduce((n, x) => n + safeNum(x.requests), 0) })); }
    if (command === "neural") { if (!state.neural) return addConsole("Neural stats API is unavailable.", "error"); addConsole(shortJson({ model: state.neural.model?.stats, trainingExamples: state.neural.model?.trainingExamples, trainer: state.neural.trainer })); }
    if (command === "workers") { if (!state.workers) return addConsole("Worker API is unavailable.", "error"); addConsole(shortJson(state.workers)); }
    if (command === "status") addConsole(shortJson({ activeSessions: state.sessions?.active ?? null, modelScores: state.neural?.model?.stats?.scored ?? null, activeWorkers: state.workers?.active ?? null, workerCount: state.workers?.totalWorkers ?? null, sampledAt: new Date().toISOString() }));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { clearInterval(state.pollTimer); state.pollTimer = null; }
    else if (!state.pollTimer) { refreshData(true); state.pollTimer = setInterval(() => refreshData(true), POLL_MS); }
  });
  addConsole("Console Lab ready. Type help to see commands.");
  refreshData(true).then(() => { if (!document.hidden && !state.pollTimer) state.pollTimer = setInterval(() => refreshData(true), POLL_MS); });
})();
