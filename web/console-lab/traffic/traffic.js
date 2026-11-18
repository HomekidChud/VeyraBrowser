import * as engine from "./engine.js?v=1";

(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const buttons = [...document.querySelectorAll("[data-task]")], format = new Intl.NumberFormat("en-GB");
  let data = null, source = null, result = null, uploadVersion = 0;
  const write = (id, value) => { $(id).textContent = value; };
  const node = (tag, value) => {
    const element = document.createElement(tag);
    if (value !== undefined) element.textContent = value;
    return element;
  };
  function status(id, message, error = false) {
    write(id, message); $(id).classList.toggle("error", error);
  }
  function table(target, headers, rows) {
    const root = $(target); root.replaceChildren();
    if (!headers.length || !rows.length) return;
    const wrap = node("div"), el = node("table"), head = node("thead"), tr = node("tr"), body = node("tbody");
    wrap.className = "table-wrap";
    for (const header of headers) { const th = node("th", header); th.scope = "col"; tr.append(th); }
    head.append(tr);
    for (const row of rows) {
      const line = node("tr");
      for (const value of row) line.append(node("td", value));
      body.append(line);
    }
    el.append(head, body); wrap.append(el); root.append(wrap);
  }
  function drawTimeline() {
    const recent = data.timeline.slice(-14), last = recent.at(-1);
    const max = Math.max(1, ...recent.map(row => row.sessions ?? 0));
    $("chart").replaceChildren(...recent.map(row => {
      const meter = node("meter"); meter.max = max; meter.value = row.sessions ?? 0;
      meter.title = `${row.date}: ${row.sessions === null ? "not reported" : `${format.format(row.sessions)} sessions`}`;
      if (row.sessions === null) meter.dataset.gap = "";
      return meter;
    }));
    $("chart-labels").replaceChildren(node("span", recent[0].date), node("span", last.date));
    write("trend-scope", `Latest ${recent.length} calendar days. Dimming marks unreported days.`);
    const value = n => n === null ? "Not reported" : format.format(n);
    table("trend-table", ["Date", "Sessions", "Pageviews"], recent.map(row => [row.date, value(row.sessions), value(row.pageviews)]));
  }
  const provenance = () => `${source === "demo" ? "Synthetic demo" : "Imported CSV (not independently verified)"} · ${data.start} to ${data.end}`;
  function showTask(task, focus = false) {
    if (!data) { status("task-status", "Import an aggregate traffic CSV or load the demo first.", true); return; }
    result = engine.run(task, data);
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.task === task));
    write("result-source", provenance());
    write("results-title", result.title);
    $("narrative").replaceChildren(...result.desc.map(line => node("p", line)));
    table("task-table", result.headers, result.rows);
    status("task-status", `Completed: ${result.title}.`);
    if (focus) $("results-title").focus();
  }
  function load(csv, kind) {
    const next = engine.parse(csv);
    data = next; source = kind;
    write("source-label", kind === "demo" ? "Synthetic demo" : "Imported CSV");
    $("source-label").dataset.type = kind;
    status("import-status", `${format.format(next.rows)} aggregate rows · ${next.start} to ${next.end}.`);
    for (const [id, count] of [["sessions", next.sessions], ["pageviews", next.pageviews], ["days", next.reportedDays], ["pages", next.pages.length]]) write(id, format.format(count));
    $("results").hidden = false; $("clear").hidden = false;
    drawTimeline(); showTask("summary");
  }
  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = node("a"); link.href = url; link.download = filename; document.body.append(link);
    link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1200);
  }
  $("traffic-file").addEventListener("change", async event => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    const version = ++uploadVersion;
    status("import-status", "Reading the file on this device…");
    try {
      if (file.size > engine.MAX_BYTES) throw new Error("Use a CSV smaller than 2 MB.");
      const csv = await file.text();
      if (version === uploadVersion) load(csv, "import");
    } catch (error) { if (version === uploadVersion) status("import-status", `Import failed. ${error.message}${data ? " Previous data is still displayed." : ""}`, true); }
  });
  $("demo").onclick = () => { ++uploadVersion; load(engine.demoCsv(), "demo"); };
  $("template").onclick = () => download("veyra-traffic-template.csv", "date,page,channel,sessions,pageviews\n", "text/csv;charset=utf-8");
  $("clear").onclick = () => {
    ++uploadVersion; data = source = result = null;
    $("results").hidden = true; $("clear").hidden = true;
    $("source-label").removeAttribute("data-type"); write("source-label", "No data loaded");
    for (const button of buttons) button.setAttribute("aria-pressed", "false");
    for (const id of ["narrative","task-table","trend-table","chart","chart-labels"]) $(id).replaceChildren();
    for (const id of ["sessions","pageviews","days","pages","result-source","results-title","trend-scope"]) write(id, "");
    status("import-status", "Traffic data cleared. Import a file or load the demo.");
    status("task-status", "Tasks use only the imported metrics. This is not a general chat box.");
    $("traffic-file").focus();
  };
  $("task-form").onsubmit = event => {
    event.preventDefault();
    const task = engine.suggest($("question").value);
    if (!task) { status("task-status", "I couldn’t confidently match that request. Choose one of the five listed tasks.", true); return; }
    showTask(task, true);
  };
  for (const button of buttons) button.onclick = () => showTask(button.dataset.task, true);
  $("export").onclick = () => {
    if (!result || !data) return;
    const lines = [result.title, provenance(), "", ...result.desc];
    if (result.rows.length) lines.push("", result.headers.join("\t"), ...result.rows.map(row => row.join("\t")));
    lines.push("", "Counting scope: aggregate sessions and pageviews by date, landing page and acquisition channel.");
    download(`veyra-${result.task}-${data.end}.txt`, lines.join("\n"), "text/plain;charset=utf-8");
  };
})();
