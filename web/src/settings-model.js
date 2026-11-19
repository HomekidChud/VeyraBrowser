export const DEFAULT_SETTINGS_PINS = Object.freeze(["appearance", "performance", "shortcuts"]);

export function settingsPins(value, allowed) {
  const ids = new Set(allowed);
  return [...new Set((Array.isArray(value) ? value : DEFAULT_SETTINGS_PINS).filter(id => ids.has(id)))];
}

export function settingSearchTerms(input) {
  return [...new Set(String(input ?? "").toLowerCase().slice(0, 100).trim().split(/\s+/).filter(Boolean))];
}

export function settingTextMatches(text, terms) {
  return terms.every(term => text.includes(term));
}
