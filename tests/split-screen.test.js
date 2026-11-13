/* Split screen: panes must stay usable, resize cleanly, and tear down fully. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../web/src/app.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../web/src/ui.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/styles/style.css", import.meta.url), "utf8");

// --- Bug 1: main-menu "Split screen" called B.toggleSplitScreen, which was
// never added to the B export, so the primary toggle silently did nothing.
assert.match(app, /export const B = \{[\s\S]*?toggleSplitScreen[\s\S]*?\};/, "toggleSplitScreen must be part of the B export used by ui.js");
assert.match(ui, /B\.toggleSplitScreen\?\.\(\)/, "the main-menu item must call B.toggleSplitScreen");

// --- Bug 2: teardown only removed .split-pane children, leaving the
// #splitContainer behind. It is an absolute full-viewport z-indexed overlay,
// so it kept covering the page and blocking clicks after split was closed.
assert.match(app, /function teardownSplitScreen\(\)/, "split teardown must be a dedicated helper");
{
  const i = app.indexOf("function teardownSplitScreen()");
  const body = app.slice(i, app.indexOf("function renderSplitScreen"));
  assert.match(body, /document\.getElementById\("splitContainer"\)\?\.remove\(\)/, "teardown must remove the whole #splitContainer overlay, not just its panes");
  assert.match(body, /splitDragCleanup\?\.\(\)/, "teardown must release any active divider drag listeners");
}

// --- Bug 3: getOrCreateFrame always inserted new frames into #frameWrap,
// which is hidden behind the split overlay. A pane tab whose frame was
// created after split started (the background duplicate, or a frame
// recreated after teardownTab) rendered into the hidden layer: blank pane.
{
  const i = app.indexOf("function getOrCreateFrame(");
  const body = app.slice(i, app.indexOf("function onFrameLoad"));
  assert.match(body, /splitLeftContent/, "frame creation must route pane tabs into the split pane content");
  assert.match(body, /splitRightContent/, "frame creation must route pane tabs into the split pane content");
}

// --- Bug 4: closeTab/switchTab/renderActive left split state pointing at
// dead or non-page tabs, showing blank panes behind the overlay.
assert.match(app, /state\.splitScreen\.active && \(state\.splitScreen\.leftTabId === id \|\| state\.splitScreen\.rightTabId === id\)\) teardownSplitScreen\(\)/, "closing a pane tab must exit split view");
assert.match(app, /ss\.active && id !== ss\.leftTabId && id !== ss\.rightTabId\) teardownSplitScreen\(\)/, "switching to a tab outside the panes must exit split view");
assert.match(app, /ss\.active && \(t\.view !== "page" \|\| isRemote\(t\) \|\| \(t\.id !== ss\.leftTabId && t\.id !== ss\.rightTabId\)\)\) teardownSplitScreen\(\)/, "renderActive must exit split when the active pane stops being a proxy page");

// --- Bug 5: the divider drag registered document-level mousemove/mouseup on
// every render and never removed them, and only worked horizontally, so the
// inline gridTemplateColumns broke the mobile stacked (rows) layout.
assert.doesNotMatch(app, /document\.addEventListener\("mousemove"[\s\S]{0,400}splitContainer/, "the divider drag must not leak document-level listeners");
assert.match(app, /pointerdown/, "the divider drag must use pointer events on the divider (mouse + touch)");
assert.match(app, /gridTemplateRows = `\$\{clamped\}fr 6px \$\{100 - clamped\}fr`/, "dragging on the mobile layout must resize rows, not columns");
assert.match(css, /\.split-divider\{[^}]*touch-action:none/, "the divider needs touch-action:none for touch dragging");

// --- Menu item must reflect the current split state.
assert.match(ui, /menuItem\("i-layers", "Split screen", "", \(\) => B\.toggleSplitScreen\?\.\(\), \{ badge: B\.state\.splitScreen\?\.active \? "ON" : "" \}\)/, "the menu item should show an ON badge while split view is active");

console.log("VeyraBrowser split screen checks passed");
