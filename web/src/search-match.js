const common = new Set("a an and are as at by for from how in is of on or the to was with".split(" "));
const segmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter("und", { granularity: "word" }) : null;
function words(value) {
  const text = String(value ?? "").slice(0, 3200).normalize("NFKC").toLowerCase().replace(/[_-]/g, " ");
  if (!/[^\x00-\x7f]/.test(text)) return text.match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) || [];
  if (!segmenter) return text.match(/[\p{L}\p{N}\p{M}]+/gu) || [];
  const tokens = [];
  for (const part of segmenter.segment(text)) if (part.isWordLike) tokens.push(part.segment);
  return tokens;
}
function pathText(value) {
  try {
    const { hostname, pathname } = new URL(value);
    try { return `${hostname} ${decodeURIComponent(pathname)}`; } catch { return `${hostname} ${pathname}`; }
  } catch { return ""; }
}
export function resultMatch(row, query, source) {
  if (Number.isInteger(row.matchPercent) && row.matchPercent >= 1 && row.matchPercent <= 100) return row.matchPercent;
  // Compatibility for an older API. No network request or stored search data.
  const text = String(query).replace(/(^|\s)-?site:(?:"[^"]*"|\S*)/gi, " ");
  const allTerms = words(text);
  const queryWords = allTerms.filter(word => !common.has(word));
  const terms = [...new Set(queryWords.length ? queryWords : allTerms)].slice(0, 24);
  if (!terms.length) return 1;
  const titleWords = words(row.title), title = new Set(titleWords);
  const description = new Set(words([row.snippet, row.description, row.alt, row.caption].filter(Boolean).join(" ")));
  const path = new Set(words(pathText(row.sourcePageUrl || row.url)));
  const coverage = set => terms.filter(term => set.has(term)).length / terms.length;
  const core = (source === "images" || source === "videos") ? 0.23 : 0.16;
  const phrase = terms.length > 1 && ` ${titleWords.join(" ")} `.includes(` ${terms.join(" ")} `);
  const evidence = coverage(new Set([...title, ...description, ...path]));
  const score = .47 * coverage(title) + core * coverage(description) + .07 * coverage(path) + .19 * evidence + (phrase ? .11 : 0);
  return Math.max(1, Math.min(100, Math.round(100 * score)));
}
export function rankResultBatch(rows, query, source) {
  return rows.map(row => ({ ...row, matchPercent: resultMatch(row, query, source) }))
    .sort((a, b) => b.matchPercent - a.matchPercent);
}

export function querySuggestions(values, typed, limit) {
  if (!Array.isArray(values)) return [];
  const q = String(typed).trimStart().slice(0, 600), lowered = q.normalize("NFKC").toLowerCase();
  if (!lowered.trim()) return [];
  const seen = new Set([lowered.trimEnd()]);
  // New servers return whole-query strings. Older ones return only the final
  // word, so retain the preceding words when that is unambiguous.
  const partial = /[\p{L}\p{M}\p{N}'’-]+$/u.exec(q);
  const out = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length > 600 || /[\u0000-\u001f\u007f]/.test(value)) continue;
    let option = value.trim();
    let key = option.normalize("NFKC").toLowerCase();
    if (!key.startsWith(lowered) && partial && !/\s/.test(option) && key.startsWith(partial[0].normalize("NFKC").toLowerCase())) {
      option = q.slice(0, partial.index) + option;
      key = option.normalize("NFKC").toLowerCase();
    }
    if (!key.startsWith(lowered) || option.length > 600 || seen.has(key)) continue;
    seen.add(key);
    out.push(option);
    if (out.length >= limit) break;
  }
  return out;
}
