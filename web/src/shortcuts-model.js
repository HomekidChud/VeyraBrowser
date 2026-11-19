const bindingPattern = /^(?:Mod\+)?(?:Ctrl\+)?(?:Meta\+)?(?:Alt\+)?(?:Shift\+)?(?:[A-Z0-9=,./\\;'[\]`-]|F(?:[1-9]|1\d|2[0-4])|Tab|PageUp|PageDown|Home|End|Delete|Backspace|Enter|Space|Insert|Left|Right|Up|Down|Esc)$/;
export const assignableBinding = key => typeof key === "string" && bindingPattern.test(key)
  && (/^(?:Mod|Ctrl|Meta|Alt)\+/.test(key) || /^(?:Shift\+)?F\d+$/.test(key));

export const BINDING_KEY_GROUPS = [
  ["Letters", [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]],
  ["Numbers", [..."0123456789"]],
  ["Punctuation", [..."=,./\\;'[]`-"]],
  ["Navigation and editing", ["Left", "Right", "Up", "Down", "Home", "End", "PageUp", "PageDown", "Tab", "Enter", "Space", "Backspace", "Delete", "Insert", "Esc"]],
  ["Function keys", Array.from({ length: 24 }, (_, i) => `F${i + 1}`)]
];
const selectableKeys = new Set(BINDING_KEY_GROUPS.flatMap(([, keys]) => keys));
export function buildShortcutBinding(key, modifiers) {
  if (!selectableKeys.has(key)) return "";
  return ["Mod", "Ctrl", "Meta", "Alt", "Shift"].filter(mod => modifiers.includes(mod)).concat(key).join("+");
}

export function shortcutKeys(command, overrides) {
  if (!command) return [];
  const value = overrides?.[command.id];
  if (!Array.isArray(value)) return command.keys;
  return [...new Set(value.filter(key => assignableBinding(key) || (key === "Esc" && command.id === "stop")))].slice(0, 3);
}

export function shortcutMap(commands, overrides) {
  const out = new Map();
  for (const cmd of commands) {
    for (const key of shortcutKeys(cmd, overrides)) if (!out.has(key)) out.set(key, cmd);
  }
  return out;
}

export function shortcutClashes(commands, overrides, id, keys) {
  return commands.flatMap(c => c.id === id ? [] : shortcutKeys(c, overrides).filter(key => keys.includes(key)).map(key => ({ id: c.id, label: c.label, key })));
}

export function storeShortcutKeys(commands, overrides, id, keys, { move = false, reset = false } = {}) {
  const target = commands.find(c => c.id === id);
  if (!target) return null;
  const next = reset ? target.keys : shortcutKeys(target, { [id]: keys });
  const clashes = shortcutClashes(commands, overrides, id, next);
  if (!move && clashes.length) return null;
  const bindings = { ...overrides };
  for (const { id: other, key } of clashes) {
    bindings[other] = shortcutKeys(commands.find(c => c.id === other), bindings).filter(k => k !== key);
  }
  if (reset) delete bindings[id];
  else bindings[id] = next;
  return bindings;
}
