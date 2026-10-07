(() => {
  "use strict";

  const MAX_REQUESTS_PER_RUN = 20;
  const MAX_SERVER_RUNS = 3;
  const REQUEST_TIMEOUT_MS = 9000;
  const RESOURCE_TIMEOUT_MS = 4000;
  const REQUEST_GAP_MS = 180;
  const API_ORIGIN = (document.querySelector('meta[name="veyra-api"]')?.content || "https://veyraserver-xscy.onrender.com").replace(/\/$/, "");
  const PAGE_URL = window.__VEYRA_PAGE_URL__ || location.href;
  const proxied = window.__VEYRA_PROXY__ === true;
  const $ = (id) => document.getElementById(id);
  const state = { running: false, stopRequested: false, currentController: null, currentResource: null, serverRuns: 0, rows: 0, runId: "" };
  const runLocalButton = $("runLocal");
  const runServerButton = $("runServer");
  const runFullButton = $("runFull");
  const stopButton = $("stopRun");

  function setStatus(text) { $("runState").textContent = text; }
  function updateCount() { $("counts").textContent = `${state.rows} case${state.rows === 1 ? "" : "s"} recorded · ${state.serverRuns}/${MAX_SERVER_RUNS} server batches used`; }
  function row(level, title, detail = "") {
    const li = document.createElement("li"); li.className = "result";
    const badge = document.createElement("span"); badge.className = `kind ${level}`; badge.textContent = level;
    const box = document.createElement("span"); box.className = "detail";
    const strong = document.createElement("strong"); strong.textContent = title; box.appendChild(strong);
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
    setStatus(`Running Veyra Console Lab ${state.runId}…`); updateCount();
    return state.runId;
  }
  function finishState(message) {
    state.running = false; state.currentController = null; state.currentResource = null;
    for (const button of [runLocalButton, runServerButton, runFullButton]) button.disabled = false;
    stopButton.disabled = true; setStatus(message); updateCount();
    runServerButton.disabled = !proxied || state.serverRuns >= MAX_SERVER_RUNS;
    runFullButton.disabled = !proxied || state.serverRuns >= MAX_SERVER_RUNS;
  }

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
    window.dispatchEvent(new ErrorEvent("error", {
      message: detailError.message,
      filename: new URL("fixtures/controlled-throw.js", PAGE_URL).href,
      lineno: 42,
      colno: 17,
      error: detailError
    }));
    window.dispatchEvent(new ErrorEvent("error", { message: "Script error.", filename: "", lineno: 0, colno: 0, error: null }));
    setTimeout(() => { throw new RangeError(marker("async-throw", "controlled uncaught timer exception")); }, 40);
    setTimeout(() => { Promise.reject(new TypeError(marker("rejection", "controlled unhandled rejection"))); }, 80);

    for (let i = 1; i <= 3; i += 1) {
      const img = document.createElement("img");
      img.id = `veyra-lab-local-img-${i}`; img.alt = ""; img.hidden = true;
      img.onerror = () => img.remove();
      document.body.appendChild(img);
      img.src = `data:image/png;base64,VEYRA-LAB-invalid-image-${i}`;
    }
    row("ok", "Local diagnostic events scheduled", "Console levels, Error/TypeError/RangeError, source coordinates, generic Script error, unhandled rejection, duplicates, and three intentionally invalid data images.");
  }

  function apiProbePlan() {
    const run = encodeURIComponent(state.runId);
    const page = new URL(PAGE_URL);
    const api = new URL(API_ORIGIN);
    const probes = [
      { id: "api-health-1", label: "VeyraServer health", url: new URL(`/api/health?veyraLab=${run}&case=health-1`, api).href, kind: "health" },
      { id: "api-health-2", label: "VeyraServer health (cache-bypass query)", url: new URL(`/api/health?veyraLab=${run}&case=health-2`, api).href, kind: "health" }
    ];
    for (const status of [404, 418, 429, 500, 502, 503]) {
      probes.push({ id: `http-${status}`, label: `Controlled HTTP ${status} response via httpbin`, url: `https://httpbin.org/status/${status}?veyraLab=${run}`, kind: "status" });
    }
    for (let i = 1; i <= 4; i += 1) {
      probes.push({ id: `dns-invalid-${i}`, label: `Reserved .invalid DNS failure ${i}/4`, url: `https://probe-${run}-${i}.veyra-lab.invalid/diagnostic?case=${i}`, kind: "dns" });
    }
    for (let i = 1; i <= 4; i += 1) {
      const missing = new URL(`fixtures/missing-${run}-${i}.json`, PAGE_URL);
      probes.push({ id: `pages-404-${i}`, label: `GitHub Pages missing-fixture 404 ${i}/4`, url: missing.href, kind: "missing" });
    }
    const elements = [
      { id: "resource-img-dns", label: "Image resource: reserved .invalid host", tag: "img", url: `https://image-${run}.veyra-lab.invalid/missing.png` },
      { id: "resource-img-404", label: "Image resource: controlled HTTP 404", tag: "img", url: `https://httpbin.org/status/404?veyraLab=${run}&resource=image` },
      { id: "resource-script-dns", label: "Script resource: reserved .invalid host", tag: "script", url: `https://script-${run}.veyra-lab.invalid/missing.js` },
      { id: "resource-css-404", label: "Stylesheet resource: GitHub Pages 404", tag: "link", url: new URL(`fixtures/missing-${run}.css`, PAGE_URL).href }
    ];
    return { probes, elements };
  }

  async function probe(url, id, label) {
    const controller = new AbortController(); state.currentController = controller;
    const timeout = setTimeout(() => controller.abort(new DOMException("Veyra Lab probe timed out", "TimeoutError")), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method: "GET", cache: "no-store", credentials: "omit", signal: controller.signal });
      const summary = {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get("content-type") || "",
        requestId: response.headers.get("x-veyra-request-id") || "",
        remaining: response.headers.get("x-ratelimit-remaining") || ""
      };
      const line = marker(id, `${label}: HTTP ${response.status}`);
      if (response.ok) { console.info(line, summary); row("ok", label, `HTTP ${response.status}${summary.contentType ? ` · ${summary.contentType}` : ""}${summary.requestId ? ` · request ${summary.requestId}` : ""}`); }
      else { console.error(line, summary); row("warn", label, `HTTP ${response.status} (expected for this fixture)${summary.requestId ? ` · Veyra request ${summary.requestId}` : ""}`); }
    } catch (error) {
      const detail = { name: error?.name || "Error", message: error?.message || String(error), url };
      console.error(marker(id, `${label}: request failed as expected`), error, detail);
      row("warn", label, `${detail.name}: ${detail.message}`);
    } finally { clearTimeout(timeout); if (state.currentController === controller) state.currentController = null; }
  }

  function resourceProbe(test) {
    return new Promise(resolve => {
      let finished = false;
      const element = document.createElement(test.tag);
      element.id = `veyra-lab-${test.id}-${state.runId}`;
      if (test.tag === "img") { element.alt = ""; element.hidden = true; }
      if (test.tag === "script") element.async = true;
      if (test.tag === "link") element.rel = "stylesheet";
      const timeout = setTimeout(() => finish("timeout", "No load/error event before the fixture timeout."), RESOURCE_TIMEOUT_MS);
      function finish(result, note) {
        if (finished) return; finished = true; clearTimeout(timeout);
        element.onload = null; element.onerror = null; element.remove();
        if (state.currentResource === element) state.currentResource = null;
        const msg = marker(test.id, `${test.label}: ${result}`);
        if (result === "load") console.info(msg, { url: test.url, tag: test.tag });
        else console.error(msg, { url: test.url, tag: test.tag, result, note });
        row(result === "load" ? "ok" : "warn", test.label, note || `Resource ${result}; expand its Console row and check Network.`);
        resolve();
      }
      element.onload = () => finish("load", "The fixture returned a load event; inspect Network for its status.");
      element.onerror = () => finish("error", "Expected resource failure; inspect the expanded Console detail and Network row.");
      state.currentResource = element;
      (test.tag === "link" ? document.head : document.body).appendChild(element);
      if (test.tag === "link") element.href = test.url; else element.src = test.url;
    });
  }

  async function runServerSuite() {
    if (!proxied) { row("warn", "Server suite not run", "Open this page through Veyra's Fast proxy so requests are routed by VeyraServer."); return; }
    if (state.serverRuns >= MAX_SERVER_RUNS) { row("warn", "Per-tab server-run cap reached", "This page allows at most three manual batches. Reloading is not required for local-only tests."); return; }
    state.serverRuns += 1;
    const { probes, elements } = apiProbePlan();
    const total = probes.length + elements.length;
    if (total !== MAX_REQUESTS_PER_RUN) { console.error(marker("plan", "Test plan safety cap mismatch"), { total, cap: MAX_REQUESTS_PER_RUN }); row("error", "Probe plan stopped", `Planned ${total} requests but the safety cap is ${MAX_REQUESTS_PER_RUN}.`); return; }
    let completed = 0;
    for (const test of probes) {
      if (state.stopRequested) break;
      await probe(test.url, test.id, test.label); completed += 1; updateProgress(completed, total);
      if (!state.stopRequested) await wait(REQUEST_GAP_MS);
    }
    for (const test of elements) {
      if (state.stopRequested) break;
      await resourceProbe(test); completed += 1; updateProgress(completed, total);
      if (!state.stopRequested) await wait(REQUEST_GAP_MS);
    }
    const message = state.stopRequested ? `Stopped after ${completed}/${total} VeyraServer probes.` : `Finished ${completed}/${total} sequential VeyraServer probes.`;
    console.info(marker("summary", message), { planned: total, completed, sequential: true, retries: 0 });
    row(state.stopRequested ? "warn" : "ok", message, "Inspect this page's DevTools Console and Network panels for the matching [VEYRA-LAB] entries.");
  }

  async function start(mode) {
    if (state.running) return;
    if ((mode === "server" || mode === "full") && state.serverRuns >= MAX_SERVER_RUNS) { row("warn", "Per-tab server-run cap reached", "At most three manual server batches are allowed per page load."); return; }
    startState();
    try {
      if (mode !== "server") { runLocalDiagnostics(); await wait(120); }
      if (mode !== "local") await runServerSuite();
      finishState(state.stopRequested ? `Stopped run ${state.runId}.` : `Completed run ${state.runId}. Expand the Console diagnostics for detail.`);
    } catch (error) {
      console.error(marker("runner", "Test runner caught an unexpected error"), error);
      row("error", "Runner error", error?.stack || error?.message || String(error));
      finishState(`Run ${state.runId} ended with a runner error.`);
    }
  }

  runLocalButton.addEventListener("click", () => start("local"));
  runServerButton.addEventListener("click", () => start("server"));
  runFullButton.addEventListener("click", () => start("full"));
  stopButton.addEventListener("click", () => {
    state.stopRequested = true;
    state.currentController?.abort(new DOMException("Stopped by user", "AbortError"));
    state.currentResource?.remove();
    setStatus("Stop requested — the current probe is being cancelled; no later probes will start.");
  });
  $("clearReport").addEventListener("click", () => { $("results").replaceChildren(); state.rows = 0; updateCount(); setStatus("Report cleared. Existing Veyra Console entries are unchanged."); $("progressBar").style.width = "0%"; });

  const dot = $("proxyDot");
  if (proxied) {
    dot.classList.add("ok");
    $("proxyState").textContent = `Veyra proxy detected · server probes target ${new URL(API_ORIGIN).host}`;
  } else {
    $("proxyState").textContent = "Direct page view · open this URL inside Veyra for server-proxy tests";
    runServerButton.disabled = true; runFullButton.disabled = true;
  }
  updateCount();
})();
