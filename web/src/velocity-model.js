export const PERFORMANCE_MODES = Object.freeze({
  standard: { name: "Standard", description: "Open background pages immediately and keep optional diagnostics running." },
  balanced: { name: "Balanced", description: "Open background pages normally. Pause optional diagnostics when this window is hidden." },
  boost: { name: "Boost", description: "Defer new background pages, reduce shell effects, and pause optional diagnostics for hidden tabs." }
});

export const performanceMode = value => Object.hasOwn(PERFORMANCE_MODES, value) ? value : "balanced";
export function diagnosticsAllowed(mode, { hidden = false, visible = false, inspecting = false, focus = false } = {}) {
  if (inspecting && !hidden) return true;
  if (focus) return false;
  if (mode === "boost") return !hidden && visible;
  return mode === "standard" || !hidden;
}

export function canPark(tab, { activeId, split, hasFrame, hasPopup, fullscreen } = {}) {
  return Boolean(tab?.view === "page" && /^https?:\/\//i.test(tab.url) && tab.id !== activeId
    && !(split?.active && [split.leftTabId, split.rightTabId].includes(tab.id))
    && hasFrame && !hasPopup && !fullscreen && !tab.pinned && !tab.loading && !tab.needsInitialLoad
    && !tab.browserSessionId && !tab.requiresBrowser && tab.browserMode === "FAST_PROXY" && !tab.youtubeEmbed && !tab.readerOpen);
}

export function rankLauncher(rows, input, filter = "all", limit = 30) {
  const raw = String(input).trim().toLowerCase();
  const scope = /^(commands?|cmd|tabs?|bookmarks?|history):\s*/.exec(raw);
  const kind = scope ? ({ command: "command", commands: "command", cmd: "command", tab: "tab", tabs: "tab", bookmark: "bookmark", bookmarks: "bookmark", history: "history" })[scope[1]] : filter;
  const query = scope ? raw.slice(scope[0].length).trim() : raw;
  const words = query.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const row of rows) {
    if (kind !== "all" && row.kind !== kind) continue;
    const label = row.label.toLowerCase();
    const corpus = `${label} ${row.detail || ""} ${row.keywords || ""}`.toLowerCase();
    if (!words.every(word => corpus.includes(word))) continue;
    let score = Number(row.priority) || 0;
    if (query) score = (label === query ? 500 : label.startsWith(query) ? 250 : label.includes(query) ? 120 : 0)
      + words.filter(word => label.includes(word)).length * 40 + score;
    scored.push({ row, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.row);
}

export const UNIT_GROUPS = Object.freeze({
  Distance: { km: 1000, mi: 1609.344, m: 1, ft: 0.3048, cm: 0.01, in: 0.0254 },
  Mass: { kg: 1, lb: 0.45359237, g: 0.001, oz: 0.028349523125 },
  Temperature: { "°C": 1, "°F": 1, K: 1 },
  Time: { s: 1, min: 60, h: 3600, d: 86400 },
  Data: { B: 1, KB: 1000, MB: 1000000, GB: 1000000000, KiB: 1024, MiB: 1048576, GiB: 1073741824 }
});

export function convertUnits(value, group, from, to) {
  const units = Object.hasOwn(UNIT_GROUPS, group) ? UNIT_GROUPS[group] : null;
  if (!units || !Object.hasOwn(units, from) || !Object.hasOwn(units, to) || !String(value).trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (from === to) return n;
  if (group === "Temperature") {
    const c = from === "°C" ? n : from === "°F" ? (n - 32) * 5 / 9 : n - 273.15;
    const result = to === "°C" ? c : to === "°F" ? c * 9 / 5 + 32 : c + 273.15;
    return Number.isFinite(result) ? result : null;
  }
  const result = n * (units[from] / units[to]);
  return Number.isFinite(result) ? result : null;
}

export const countText = input => ({
  words: (input.trim().match(/\S+/gu) || []).length,
  characters: Array.from(input).length,
  lines: input === "" ? 0 : input.split(/\r\n|\r|\n/).length
});
