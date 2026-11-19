import assert from "node:assert/strict";
import { test } from "node:test";
import { BINDING_KEY_GROUPS, assignableBinding, buildShortcutBinding, shortcutKeys, shortcutMap, shortcutClashes, storeShortcutKeys } from "../web/src/shortcuts-model.js";

const commands = [
  { id: "new", label: "New tab", keys: ["Mod+T", "Alt+T"] },
  { id: "find", label: "Find in page", keys: ["Mod+F"] },
  { id: "stop", label: "Stop loading", keys: ["Esc"] },
  { id: "park", label: "Park tab", keys: [] }
];

test("bindings accept physical punctuation, navigation and function keys", () => {
  for (const key of ["Alt+Shift+K", "Mod+=", "Mod+,", "Mod+\\", "Mod+'", "Mod+[", "Mod+]", "Ctrl+Alt+Backspace", "Meta+Up", "F24", "Shift+F1"]) {
    assert.equal(assignableBinding(key), true, key);
  }
  for (const key of ["A", "Shift+A", "Delete", "Esc", "F0", "F25", "Mod+", "Alt+Mod+K", "Mod+Mod+K", "Mod+Unknown", null]) {
    assert.equal(assignableBinding(key), false, key);
  }
});

test("overrides deduplicate, cap at three and preserve disabled commands", () => {
  assert.deepEqual(shortcutKeys(commands[0], { new: ["F7", "F7", "A", "Alt+T", "Mod+T", "F8"] }), ["F7", "Alt+T", "Mod+T"]);
  assert.deepEqual(shortcutKeys(commands[2], { stop: ["Esc", "F7"] }), ["Esc", "F7"]);
  assert.deepEqual(shortcutKeys(commands[1], { find: ["Esc"] }), []);
  assert.deepEqual(shortcutKeys(commands[1], { find: "invalid" }), ["Mod+F"]);
  assert.equal(shortcutMap(commands, { new: [] }).has("Mod+T"), false);
});

test("touch picker produces the same canonical bindings as hardware capture", () => {
  const keys = BINDING_KEY_GROUPS.flatMap(([, group]) => group);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.equal(assignableBinding(buildShortcutBinding(key, ["Shift", "Alt", "Mod"])), true, key);
  assert.equal(buildShortcutBinding("Y", ["Shift", "Alt", "Shift"]), "Alt+Shift+Y");
  assert.equal(buildShortcutBinding("F8", []), "F8");
  assert.equal(assignableBinding(buildShortcutBinding("A", ["Shift"])), false);
  assert.equal(buildShortcutBinding("Alt+Y", ["Mod"]), "");
});

test("conflicts require confirmation and ownership moves without deleting other bindings", () => {
  const state = { park: [] };
  const keys = ["F8", "Mod+T", "Mod+F"];
  assert.deepEqual(shortcutClashes(commands, state, "park", keys), [
    { id: "new", label: "New tab", key: "Mod+T" }, { id: "find", label: "Find in page", key: "Mod+F" }
  ]);
  assert.equal(storeShortcutKeys(commands, state, "park", keys), null);
  const moved = storeShortcutKeys(commands, state, "park", keys, { move: true });
  assert.deepEqual(state, { park: [] });
  assert.deepEqual(moved, { park: keys, new: ["Alt+T"], find: [] });
  assert.equal(shortcutMap(commands, moved).get("Mod+T").id, "park");
  assert.equal(shortcutMap(commands, moved).get("Alt+T").id, "new");
  assert.equal(storeShortcutKeys(commands, moved, "new", [], { reset: true }), null);
  const reset = storeShortcutKeys(commands, moved, "new", [], { reset: true, move: true });
  assert.deepEqual(reset, { park: ["F8", "Mod+F"], find: [] });
  assert.equal(shortcutMap(commands, reset).get("Mod+T").id, "new");
});
