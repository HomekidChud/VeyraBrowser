import { rankLauncher, UNIT_GROUPS, convertUnits, countText, PERFORMANCE_MODES, performanceMode } from "./velocity-model.js?v=1";

const filters = { all: "All", command: "Commands", tab: "Tabs", bookmark: "Bookmarks", history: "History" };
const icons = { command: "i-bolt", tab: "i-tab", bookmark: "i-star", history: "i-history" };
const toolId = "velocity-tools";
const launcherId = "velocity-launcher";
const makeIcon = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
const formatNumber = value => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 10 }).format(value);

function openDialog(id, label, markup) {
  const existing = document.getElementById(id);
  if (existing?.open) return null;
  if (document.querySelector("dialog[open]")) return null;
  const dialog = document.createElement("dialog");
  dialog.id = id;
  dialog.className = "velocity-dialog";
  dialog.setAttribute("aria-label", label);
  dialog.innerHTML = markup;
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.addEventListener("click", e => {
    if (e.target === dialog || e.target.closest("[data-v-close]")) dialog.close();
  });
  dialog.showModal();
  return dialog;
}

export function openLauncher({ rows, isPrivate = false, scope = "all", esc }) {
  const dialog = openDialog(launcherId, "Command palette", `
    <div class="velocity-dialog-inner">
      <header class="velocity-dialog-head"><div><span class="velocity-kicker">VEYRA / NAVIGATION</span><h2>Command palette</h2></div>
      <button class="icon-btn velocity-close" data-v-close aria-label="Close command palette" title="Close">${makeIcon("i-x")}</button></header>
      <label class="velocity-search">${makeIcon("i-search")}<input type="text" role="combobox" aria-label="Search commands and tabs" aria-autocomplete="list" aria-expanded="true" aria-controls="velocity-results" placeholder="Find a tab, tool or command" autocomplete="off" autofocus></label>
      <div class="velocity-filters" role="group" aria-label="Result type">${Object.entries(filters)
        .filter(([id]) => !isPrivate || !["bookmark", "history"].includes(id))
        .map(([id, label]) => `<button type="button" data-filter="${id}" aria-pressed="${id === scope}">${label}</button>`).join("")}</div>
      <div class="velocity-results" id="velocity-results" role="listbox" aria-label="Results"></div>
      <p class="velocity-empty" role="status" hidden>No matches. Try a different term or filter.</p>
      <footer class="velocity-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> Move</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></footer>
    </div>`);
  if (!dialog) return;
  const input = dialog.querySelector("input");
  const results = dialog.querySelector(".velocity-results");
  const empty = dialog.querySelector(".velocity-empty");
  let current = [], selected = 0;
  function select(i) {
    results.children[selected]?.setAttribute("aria-selected", "false");
    selected = i;
    const button = results.children[i];
    if (!button) { input.removeAttribute("aria-activedescendant"); return; }
    button.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", button.id);
    if (button.offsetTop < results.scrollTop || button.offsetTop + button.offsetHeight > results.scrollTop + results.clientHeight) {
      button.scrollIntoView({ block: "nearest" });
    }
  }
  function draw() {
    current = rankLauncher(rows(), input.value, scope);
    results.innerHTML = current.map((row, i) => `<button type="button" role="option" tabindex="-1" id="velocity-option-${i}" data-choice="${i}" aria-selected="false" class="velocity-result">
      <span class="velocity-result-icon">${makeIcon(icons[row.kind])}</span><span class="velocity-result-copy"><b>${esc(row.label)}</b><small>${esc(row.detail || filters[row.kind])}</small></span>
      ${row.key ? `<kbd>${esc(row.key)}</kbd>` : `<small class="velocity-result-type">${esc(filters[row.kind])}</small>`}</button>`).join("");
    results.scrollTop = 0;
    empty.hidden = current.length > 0;
    results.hidden = !current.length;
    select(0);
  }
  function run(i) {
    const row = current[i]; if (!row) return;
    dialog.close(); dialog.remove();
    row.run();
  }
  input.addEventListener("input", draw);
  input.addEventListener("keydown", e => {
    if (e.isComposing) return;
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      if (current.length) select((selected + (e.key === "ArrowDown" ? 1 : -1) + current.length) % current.length);
    } else if (e.key === "Enter") { e.preventDefault(); run(selected); }
  });
  results.addEventListener("click", e => {
    const button = e.target.closest("[data-choice]"); if (button) run(Number(button.dataset.choice));
  });
  dialog.querySelector(".velocity-filters").addEventListener("click", e => {
    const button = e.target.closest("[data-filter]"); if (!button) return;
    scope = button.dataset.filter;
    for (const candidate of dialog.querySelectorAll("[data-filter]")) candidate.setAttribute("aria-pressed", String(candidate === button));
    draw(); input.focus();
  });
  draw();
}

export function openQuickTools({ browser, copyText }) {
  const dialog = openDialog(toolId, "Quick Tools", `
    <div class="velocity-dialog-inner">
      <header class="velocity-dialog-head"><div><span class="velocity-kicker">VEYRA / UTILITIES</span><h2>Quick Tools</h2></div>
      <button class="icon-btn velocity-close" data-v-close aria-label="Close Quick Tools" title="Close">${makeIcon("i-x")}</button></header>
      <div class="velocity-filters" role="group" aria-label="Tool">
        <button type="button" data-tool="converter" aria-pressed="true">Unit converter</button>
        <button type="button" data-tool="text" aria-pressed="false">Text and JSON</button>
        <button type="button" id="velocity-calculator">Open Calculator</button>
      </div>
      <section class="velocity-tool" data-view="converter" aria-label="Unit converter">
        <div class="velocity-fields">
          <label>Category<select class="input" id="velocity-unit-group">${Object.keys(UNIT_GROUPS).map(group => `<option>${group}</option>`).join("")}</select></label>
          <label>Value<input class="input" id="velocity-unit-input" type="number" inputmode="decimal" step="any" placeholder="Enter a number" autofocus></label>
          <label>From<select class="input" id="velocity-unit-from"></select></label>
          <label>To<select class="input" id="velocity-unit-to"></select></label>
        </div>
        <div class="velocity-output"><output for="velocity-unit-input velocity-unit-from velocity-unit-to" aria-live="polite">Enter a value</output><button type="button" class="btn ghost" id="velocity-swap">Swap units</button></div>
      </section>
      <section class="velocity-tool" data-view="text" aria-label="Text and JSON" hidden>
        <label class="velocity-text-label">Text or JSON<textarea class="input" maxlength="50000" placeholder="Paste text to count it, or JSON to format it." rows="6"></textarea></label>
        <div class="velocity-text-actions"><button type="button" class="btn" data-text="format">Format JSON</button><button type="button" class="btn ghost" data-text="minify">Minify JSON</button><button type="button" class="btn ghost" data-text="copy">Copy text</button></div>
        <p class="velocity-text-count"></p><p class="velocity-feedback" role="status"></p>
      </section>
      <footer class="velocity-foot">Runs on this device. Text is discarded when you close the tools.</footer>
    </div>`);
  if (!dialog) return;
  const select = id => dialog.querySelector(`#velocity-unit-${id}`);
  const group = select("group"), input = select("input"), from = select("from"), to = select("to");
  const output = dialog.querySelector("output");
  const scratch = dialog.querySelector("textarea");
  const feedback = dialog.querySelector(".velocity-feedback");
  const count = dialog.querySelector(".velocity-text-count");
  function drawUnits() {
    const units = Object.keys(UNIT_GROUPS[group.value]);
    for (const picker of [from, to]) picker.replaceChildren(...units.map(unit => new Option(unit)));
    to.selectedIndex = 1;
    convert();
  }
  function convert() {
    const result = convertUnits(input.value, group.value, from.value, to.value);
    output.textContent = result === null
      ? (input.validity.badInput || input.value ? "Enter a valid finite number" : "Enter a value")
      : `${formatNumber(result)} ${to.value}`;
  }
  function updateCount() {
    const { words, characters, lines } = countText(scratch.value);
    count.textContent = `${words.toLocaleString()} words · ${characters.toLocaleString()} characters · ${lines.toLocaleString()} lines`;
  }
  group.onchange = drawUnits;
  input.oninput = from.onchange = to.onchange = convert;
  dialog.querySelector("#velocity-swap").onclick = () => { [from.value, to.value] = [to.value, from.value]; convert(); };
  scratch.oninput = () => { feedback.textContent = ""; updateCount(); };
  dialog.querySelector("#velocity-calculator").onclick = () => { dialog.close(); browser.openInternal("calculator"); };
  dialog.addEventListener("click", async e => {
    const tool = e.target.closest("[data-tool]");
    if (tool) {
      for (const view of dialog.querySelectorAll("[data-view]")) view.hidden = view.dataset.view !== tool.dataset.tool;
      for (const b of dialog.querySelectorAll("[data-tool]")) b.setAttribute("aria-pressed", String(b === tool));
      return;
    }
    const act = e.target.closest("[data-text]")?.dataset.text;
    if (!act) return;
    if (act === "copy") {
      if (!scratch.value) { feedback.textContent = "There is no text to copy."; return; }
      const copied = await copyText(scratch.value);
      feedback.textContent = copied ? "Text copied." : "Clipboard unavailable. Select the text and copy it manually."; return;
    }
    try {
      const formatted = JSON.stringify(JSON.parse(scratch.value), null, act === "format" ? 2 : 0);
      if (formatted.length > scratch.maxLength) { feedback.textContent = "Formatted text would exceed 50,000 characters."; return; }
      scratch.value = formatted;
      feedback.textContent = act === "format" ? "JSON formatted." : "JSON minified.";
      updateCount();
    } catch { feedback.textContent = "Invalid JSON. Your text was not changed."; }
  });
  drawUnits(); updateCount();
}

let observedLongTasks = null, slowest = 0;
function observeLongTasks() {
  if (observedLongTasks !== null || !globalThis.PerformanceObserver?.supportedEntryTypes?.includes("longtask")) return;
  try {
    const observer = new PerformanceObserver(list => {
      for (const task of list.getEntries()) { observedLongTasks++; slowest = Math.max(slowest, task.duration); }
    });
    observer.observe({ type: "longtask", buffered: true });
    observedLongTasks = 0;
  } catch { /* Metrics remain unavailable, not zero. */ }
}

export function performanceMarkup(browser, settings, esc) {
  observeLongTasks();
  const active = performanceMode(settings.performanceMode);
  const stats = browser.performanceTabs();
  const nav = performance.getEntriesByType("navigation")[0];
  const ready = nav?.domContentLoadedEventEnd;
  return `<section class="s-section velocity-panel" data-section="performance" aria-label="Performance">
    <header class="velocity-panel-head"><span class="velocity-kicker">VEYRA / VELOCITY</span><h2>Performance</h2>
      <p>Control how Veyra handles background pages and visual effects. This does not set system-wide CPU, RAM or download limits.</p></header>
    <fieldset class="velocity-profiles">
      <legend>Performance profile</legend>
      <div>${Object.entries(PERFORMANCE_MODES).map(([id, mode]) =>
        `<label><input type="radio" name="velocity-profile" data-performance-mode value="${id}" ${active === id ? "checked" : ""}><span><b>${mode.name}</b><small>${mode.description}</small></span></label>`).join("")}</div>
    </fieldset>
    <section class="velocity-block velocity-tab-panel">
      <div class="velocity-block-head"><div><h3>Tab parking</h3><p>Unload a background Fast Proxy page until you select it again. It will reload and may lose unsaved work or stop playing media.</p></div><button type="button" class="btn ghost" data-performance-refresh>Refresh</button></div>
      <ul class="velocity-tabs">${stats.length ? stats.map(t =>
        `<li><span class="velocity-tab-name"><b>${esc(t.title)}</b><small>${esc(t.status)}</small></span>${t.parkable
          ? `<button type="button" class="btn ghost" data-park-tab="${esc(t.id)}" aria-label="Park ${esc(t.title)}">Park</button>`
          : t.queued ? `<button type="button" class="btn ghost" data-wake-tab="${esc(t.id)}" aria-label="Open ${esc(t.title)}">Open</button>` : ""}</li>`).join("")
        : `<li><span class="muted">No web pages open yet. This list fills when you visit a site.</span></li>`}</ul>
    </section>
    <section class="velocity-block">
      <div class="velocity-block-head"><div><h3>Shell timing snapshot</h3><p>Local readings for this Veyra window. They do not measure remote page speed or gaming FPS.</p></div></div>
      <dl class="velocity-metrics"><div><dt>Shell DOM ready</dt><dd>${ready ? `${Math.round(ready)} ms` : "Unavailable"}</dd></div>
      <div><dt>Observed long tasks</dt><dd>${observedLongTasks === null ? "Unavailable" : observedLongTasks}</dd></div>
      <div><dt>Longest observed task</dt><dd>${slowest ? `${Math.round(slowest)} ms` : observedLongTasks === null ? "Unavailable" : "None observed"}</dd></div></dl>
    </section>
  </section>`;
}
