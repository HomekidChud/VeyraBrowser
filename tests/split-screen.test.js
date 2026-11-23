/* Split screen: panes must stay usable, resize cleanly, and tear down fully. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../web/src/app.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../web/src/ui.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/styles/style.css", import.meta.url), "utf8");

assert.match(app, /export const B = \{[\s\S]*?toggleSplitScreen[\s\S]*?\};/, "toggleSplitScreen must be part of the B export used by ui.js");
assert.match(ui, /B\.toggleSplitScreen\?\.\(\)/, "the main-menu item must call B.toggleSplitScreen");

assert.match(app, /function teardownSplitScreen\(\)/, "split teardown must be a dedicated helper");
{
  const i = app.indexOf("function teardownSplitScreen()");
  const body = app.slice(i, app.indexOf("function renderSplitScreen"));
  assert.match(body, /document\.getElementById\("splitContainer"\)\?\.remove\(\)/, "teardown must remove the whole #splitContainer overlay, not just its panes");
  assert.match(body, /splitDragCleanup\?\.\(\)/, "teardown must release any active divider drag listeners");
}

{
  const i = app.indexOf("function getOrCreateFrame(");
  const body = app.slice(i, app.indexOf("function onFrameLoad"));
  assert.match(body, /\$\("frameWrap"\)\.insertBefore\(f/, "a frame is attached to the stable wrapper");
  assert.match(body, /syncSplitFrames\(\)/, "new frames get their split marker immediately");
  const nativeSplit = app.slice(app.indexOf("function syncSplitFrames"), app.indexOf("function makeTab"));
  assert.doesNotMatch(nativeSplit, /appendChild\((?:leftFrame|rightFrame|frame|f)\)|\b(?:removeChild|replaceChild)\b/, "split does not reparent live frames");
  assert.match(css, /tab-frame\[data-split-pane=second\]/, "CSS positions the second live frame");
}

assert.match(app, /state\.splitScreen\.active && \(state\.splitScreen\.leftTabId === id \|\| state\.splitScreen\.rightTabId === id\)\) teardownSplitScreen\(\)/, "closing a pane tab must exit split view");
assert.match(app, /ss\.active && id !== ss\.leftTabId && id !== ss\.rightTabId\) teardownSplitScreen\(\)/, "switching to a tab outside the panes must exit split view");
assert.match(app, /ss\.active && \(t\.view !== "page" \|\| isRemote\(t\) \|\| \(t\.id !== ss\.leftTabId && t\.id !== ss\.rightTabId\)\)\) teardownSplitScreen\(\)/, "renderActive must exit split when the active pane stops being a proxy page");

assert.doesNotMatch(app, /document\.addEventListener\("mousemove"[\s\S]{0,400}splitContainer/, "the divider drag must not leak document-level listeners");
assert.match(app, /pointerdown/, "the divider drag must use pointer events on the divider (mouse + touch)");
assert.match(css, /\[data-split-axis=stack\][^{]+\{[^}]+grid-template-rows:[^}]+--split-position/, "stacked layout resizes rows, not columns");
assert.match(css, /\.split-divider\{[^}]*touch-action:none/, "the divider needs touch-action:none for touch dragging");

assert.match(ui, /menuItem\("i-layers", "Split screen", "", \(\) => B\.toggleSplitScreen\?\.\(\), \{ badge: B\.state\.splitScreen\?\.active \? "ON" : "" \}\)/, "the menu item should show an ON badge while split view is active");

console.log("VeyraBrowser split screen checks passed");
