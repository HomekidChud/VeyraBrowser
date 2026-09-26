// Veyra Browse frontend.
// The Render service is deliberately the only moving part on the client.
// Keep the Render service named "veyra-browse-crawler" so this works without settings.
const API = "https://veyraserver-xscy.onrender.com";

const state = {
  jobId: null,
  data: null,
  resources: [],
  selected: -1,
  poll: null,
  logs: [],
  lastLogId: 0
};

const $ = (id) => document.getElementById(id);

function addLog(level, message) {
  state.logs.push({ id: ++state.lastLogId, time: new Date(), level, message: String(message) });
  if (state.logs.length > 2000) state.logs.splice(0, state.logs.length - 2000);
  renderConsole();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[m]);
}
function pathOf(url) {
  try {
    const u = new URL(url);
    return (u.pathname || "/") + (u.search || "");
  } catch {
    return url;
  }
}

function showView(mode) {
  $("homeView").classList.toggle("hidden", mode !== "home");
  $("crawlView").classList.toggle("hidden", mode !== "crawl");
}

function openNormally() {
  const raw = $("urlInput").value.trim();
  if (!raw) return;
  let u = raw;
  if (!/^https?:\/\//i.test(u)) {
    if (/^[\w.-]+\.[A-Za-z]{2,}(\/.*)?$/.test(u)) u = "https://" + u;
    else u = "https://www.google.com/search?q=" + encodeURIComponent(u);
  }
  addLog("info", "Opening " + u);
  window.open(u, "_blank", "noopener");
}

async function startCrawl() {
  const raw = $("urlInput").value.trim();
  if (!raw) return addLog("warn", "Enter a URL first.");
  $("crawlBtn").disabled = true;
  $("stopBtn").disabled = false;
  showView("crawl");
  addLog("info", "Sending crawl job to Render…");

  try {
    const res = await fetch(API + "/api/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: raw })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "HTTP " + res.status);
    state.jobId = body.id;
    state.data = body;
    state.resources = [];
    state.selected = -1;
    $("jobUrl").textContent = body.url;
    $("sourceCode").textContent = "Crawler started on Render…";
    addLog("info", "Job " + body.id + " started.");
    beginPolling();
  } catch (e) {
    addLog("error", "Could not start crawl: " + (e.stack || e.message || e));
    $("crawlBtn").disabled = false;
    $("stopBtn").disabled = true;
  }
}

function beginPolling() {
  if (state.poll) clearInterval(state.poll);
  pollStatus();
  state.poll = setInterval(pollStatus, 450);
}

async function pollStatus() {
  if (!state.jobId) return;
  try {
    const res = await fetch(API + "/api/crawl/" + encodeURIComponent(state.jobId));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "HTTP " + res.status);
    state.data = body;
    updateDashboard(body);

    if (Array.isArray(body.logs)) {
      for (const entry of body.logs) {
        const key = entry.id || (entry.time + "|" + entry.message);
        if (!state.logs.some(x => x.remoteKey === key)) {
          state.logs.push({remoteKey:key, id:key, time:new Date(entry.time), level:entry.level, message:"[backend] "+entry.message});
        }
      }
      if (state.logs.length > 2000) state.logs.splice(0, state.logs.length - 2000);
      renderConsole();
    }

    if (body.done) {
      clearInterval(state.poll);
      state.poll = null;
      $("stopBtn").disabled = true;
      $("crawlBtn").disabled = false;
      $("exportBtn").disabled = false;
      addLog("info", "Crawl finished: " + body.reason);
      await loadResources();
      await loadLinks();
    } else if (body.status === "stopped") {
      clearInterval(state.poll);
      state.poll = null;
      $("stopBtn").disabled = true;
      $("crawlBtn").disabled = false;
      $("exportBtn").disabled = true;
      addLog("warn", "Crawl stopped.");
      await loadResources();
      await loadLinks();
    }
  } catch (e) {
    addLog("error", "Polling error: " + (e.stack || e.message || e));
  }
}

function updateDashboard(d) {
  $("jobStatus").textContent = d.statusText || d.status || "Running…";
  $("mPages").textContent = d.counts?.htmlPages ?? 0;
  $("mCss").textContent = d.counts?.css ?? 0;
  $("mJs").textContent = d.counts?.js ?? 0;
  $("mLinks").textContent = d.counts?.links ?? 0;
  const pct = d.maxUrls ? Math.min(100, (d.counts?.processed || 0) / d.maxUrls * 100) : 0;
  $("progressBar").style.width = pct + "%";
}

async function stopCrawl() {
  if (!state.jobId) return;
  try {
    await fetch(API + "/api/crawl/" + encodeURIComponent(state.jobId) + "/stop", { method: "POST" });
    addLog("warn", "Stop requested.");
  } catch (e) {
    addLog("error", "Stop request failed: " + (e.message || e));
  }
}

async function loadResources() {
  if (!state.jobId) return;
  try {
    const res = await fetch(API + "/api/crawl/" + encodeURIComponent(state.jobId) + "/resources");
    const body = await res.json();
    state.resources = body.resources || [];
    renderResources();
  } catch (e) {
    addLog("error", "Resource list failed: " + (e.message || e));
  }
}

function renderResources() {
  const q = $("filterInput").value.trim().toLowerCase();
  const arr = state.resources.filter(r =>
    !q || r.type.includes(q) || r.url.toLowerCase().includes(q) || pathOf(r.url).toLowerCase().includes(q)
  );
  if (!arr.length) {
    $("resourceList").innerHTML = '<div class="empty">No matching resources.</div>';
    return;
  }
  $("resourceList").innerHTML = arr.map(r => {
    const idx = state.resources.indexOf(r);
    return `<div class="resource ${idx===state.selected?'active':''}" data-idx="${idx}">
      <div class="rtype">${escapeHtml(r.type)} · ${escapeHtml(String(r.status))}</div>
      <div class="rurl">${escapeHtml(pathOf(r.url))}</div>
      <div class="rmeta">${escapeHtml(r.url)} · ${escapeHtml(r.bytesLabel)}${r.truncated?' · truncated':''}</div>
    </div>`;
  }).join("");
  $("resourceList").querySelectorAll(".resource").forEach(el =>
    el.addEventListener("click", () => selectResource(Number(el.dataset.idx)))
  );
}

async function selectResource(index) {
  state.selected = index;
  renderResources();
  const r = state.resources[index];
  if (!r || !state.jobId) return;
  $("sourceTitle").textContent = r.type.toUpperCase() + " — " + pathOf(r.url);
  $("sourceMeta").textContent = `${r.url} · ${r.status} · ${r.bytesLabel}${r.truncated?' · truncated':''}`;
  $("sourceCode").textContent = "Loading source…";
  try {
    const res = await fetch(API + "/api/crawl/" + encodeURIComponent(state.jobId) + "/source/" + encodeURIComponent(r.id));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "HTTP " + res.status);
    $("sourceCode").textContent = body.source || "[empty source]";
  } catch (e) {
    $("sourceCode").textContent = "SOURCE ERROR\n\n" + (e.stack || e.message || e);
    addLog("error", "Source fetch failed: " + (e.message || e));
  }
}

async function loadLinks() {
  if (!state.jobId) return;
  try {
    const res = await fetch(API + "/api/crawl/" + encodeURIComponent(state.jobId) + "/links");
    const body = await res.json();
    const links = body.links || [];
    $("linkCount").textContent = links.length;
    $("linkBody").innerHTML = links.map(l => `
      <tr>
        <td><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(pathOf(l.url))}</a></td>
        <td>${escapeHtml(l.url)}</td>
        <td><span class="badge ${l.internal?'internal':'external'}">${escapeHtml(l.type)}</span></td>
        <td>${escapeHtml(pathOf(l.source))}</td>
        <td><span class="${l.captured?'captured':'discovered'}">${l.captured?'captured':'discovered'}</span></td>
      </tr>
    `).join("");
  } catch (e) {
    addLog("error", "Link list failed: " + (e.message || e));
  }
}

function renderConsole() {
  const filter = $("consoleFilter").value;
  const rows = state.logs.filter(x => filter === "all" || x.level === filter);
  if (!rows.length) {
    $("consoleLog").innerHTML = '<div class="empty">No matching logs.</div>';
    return;
  }
  $("consoleLog").innerHTML = rows.map(x => {
    const d = x.time instanceof Date ? x.time : new Date(x.time);
    return `<div class="log ${x.level}">
      <span class="time">${d.toLocaleTimeString([], {hour12:false})}</span>
      <span class="level">${escapeHtml(x.level.toUpperCase())}</span>
      <span class="msg">${escapeHtml(x.message)}</span>
    </div>`;
  }).join("");
  $("consoleLog").scrollTop = $("consoleLog").scrollHeight;
}

async function exportCrawl() {
  if (!state.jobId) return;
  try {
    const res = await fetch(API + "/api/crawl/" + encodeURIComponent(state.jobId) + "/export");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "veyra-browse-" + state.jobId + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    addLog("info", "Export downloaded.");
  } catch (e) {
    addLog("error", "Export failed: " + (e.message || e));
  }
}

async function copyConsole() {
  const text = state.logs.map(x => `[${new Date(x.time).toISOString()}] [${x.level.toUpperCase()}] ${x.message}`).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    addLog("info", "Console copied.");
  } catch (e) {
    addLog("error", "Clipboard failed: " + (e.message || e));
  }
}

function setPanel(panel) {
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x.dataset.panel === panel));
  ["sourcePanel","linkPanel","consolePanel"].forEach(id => $(id).classList.toggle("hidden", id !== panel));
  if (panel === "consolePanel") renderConsole();
  if (panel === "linkPanel") loadLinks();
  if (panel === "sourcePanel") renderResources();
}

document.querySelectorAll(".tab").forEach(x => x.addEventListener("click", () => setPanel(x.dataset.panel)));
$("crawlBtn").addEventListener("click", startCrawl);
$("stopBtn").addEventListener("click", stopCrawl);
$("openBtn").addEventListener("click", openNormally);
$("exportBtn").addEventListener("click", exportCrawl);
$("filterInput").addEventListener("input", renderResources);
$("consoleFilter").addEventListener("change", renderConsole);
$("copyConsoleBtn").addEventListener("click", copyConsole);
$("clearConsoleBtn").addEventListener("click", () => { state.logs=[]; renderConsole(); addLog("info", "Console cleared."); });
$("consoleBtn").addEventListener("click", () => { showView("crawl"); setPanel("consolePanel"); });
$("linksBtn").addEventListener("click", () => { showView("crawl"); setPanel("linkPanel"); });
$("filesBtn").addEventListener("click", () => { showView("crawl"); setPanel("sourcePanel"); });
document.querySelectorAll(".quick button").forEach(b => b.addEventListener("click", () => {
  $("urlInput").value = b.dataset.url;
}));

window.addEventListener("error", e => addLog("error", `Frontend error: ${e.message} @ ${e.filename||"inline"}:${e.lineno||"?"}`));
window.addEventListener("unhandledrejection", e => addLog("error", "Unhandled promise: " + (e.reason?.stack || e.reason || "")));

addLog("info", "Veyra Browse frontend ready.");
