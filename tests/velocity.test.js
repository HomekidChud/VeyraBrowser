import { test } from "node:test";
import assert from "node:assert/strict";
import { performanceMode, diagnosticsAllowed, canPark, rankLauncher, convertUnits, countText } from "../web/src/velocity-model.js";

test("performance profiles pause only optional work, with a foreground diagnostic exception", () => {
  assert.equal(performanceMode("bogus"), "balanced");
  assert.equal(performanceMode("__proto__"), "balanced");
  assert.equal(diagnosticsAllowed("standard", { hidden: true }), true);
  assert.equal(diagnosticsAllowed("balanced", { hidden: false }), true);
  assert.equal(diagnosticsAllowed("balanced", { hidden: true, visible: true }), false);
  assert.equal(diagnosticsAllowed("boost", { visible: true }), true);
  assert.equal(diagnosticsAllowed("boost", { visible: false }), false);
  assert.equal(diagnosticsAllowed("boost", { visible: false, inspecting: true }), true);
  assert.equal(diagnosticsAllowed("boost", { hidden: true, inspecting: true }), false);
  assert.equal(diagnosticsAllowed("standard", { hidden: true, focus: true }), false);
});

test("only a settled background Fast Proxy frame without protected state can be parked", () => {
  const tab = { id: "t1", view: "page", url: "https://example.org", browserMode: "FAST_PROXY" };
  const context = { activeId: "t2", hasFrame: true };
  assert.equal(canPark(tab, context), true);
  for (const status of [
    { pinned: true }, { loading: true }, { needsInitialLoad: true }, { youtubeEmbed: true }, { readerOpen: true },
    { browserMode: "BROWSER_ENGINE" }, { browserSessionId: "remote" }, { requiresBrowser: true }, { url: "veyra://settings" }, { view: "newtab" }
  ]) assert.equal(canPark({ ...tab, ...status }, context), false);
  for (const status of [
    { activeId: tab.id }, { hasFrame: false }, { hasPopup: true }, { fullscreen: true },
    { split: { active: true, leftTabId: "t2", rightTabId: "t1" } }
  ]) assert.equal(canPark(tab, { ...context, ...status }), false);
});

test("launcher scopes, ranks, and caps local results", () => {
  const tabs = { kind: "tab", label: "Performance tests", detail: "example.org", priority: 10 };
  const control = { kind: "command", label: "Performance", keywords: "boost lag" };
  const bookmark = { kind: "bookmark", label: "Guide", detail: "example.org" };
  const list = [tabs, bookmark, control];
  assert.deepEqual(rankLauncher(list, "performance"), [control, tabs]);
  assert.deepEqual(rankLauncher(list, "tabs: EXAMPLE tests", "bookmark"), [tabs]);
  assert.deepEqual(rankLauncher(list, "cmd: boost"), [control]);
  assert.deepEqual(rankLauncher(list, "example", "bookmark"), [bookmark]);
  assert.equal(rankLauncher(list, "", "all", 1).length, 1);
  assert.deepEqual(rankLauncher(list, "history:"), []);
  assert.deepEqual(rankLauncher(list, "no match"), []);
  assert.deepEqual(rankLauncher([tabs, control], "bookmark:"), []);
});

test("unit conversions reject blanks and overflow and distinguish decimal from binary data", () => {
  assert.equal(convertUnits("1", "Distance", "mi", "m"), 1609.344);
  assert.equal(convertUnits("0", "Temperature", "°C", "°F"), 32);
  assert.equal(convertUnits("32", "Temperature", "°F", "K"), 273.15);
  assert.equal(convertUnits("273.15", "Temperature", "K", "°C"), 0);
  assert.equal(convertUnits("1", "Data", "KiB", "B"), 1024);
  assert.equal(convertUnits("1", "Data", "KB", "B"), 1000);
  assert.equal(convertUnits("1", "Time", "h", "min"), 60);
  assert.equal(convertUnits("1", "Mass", "lb", "kg"), 0.45359237);
  assert.equal(convertUnits("", "Distance", "mi", "m"), null);
  assert.equal(convertUnits("1e308", "Distance", "km", "mm"), null);
  assert.equal(convertUnits("1e308", "Distance", "km", "m"), null);
  assert.equal(convertUnits("5", "__proto__", "toString", "toString"), null);
});

test("text counts handle multiline Unicode and empty input", () => {
  assert.deepEqual(countText("hello 🌍\r\nagain"), { words: 3, characters: 14, lines: 2 });
  assert.deepEqual(countText(""), { words: 0, characters: 0, lines: 0 });
});
