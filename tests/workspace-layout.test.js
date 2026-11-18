import assert from "node:assert/strict";
import { arrangeTabs, paneLayout, paneRatio, tabLayout, validColour } from "../web/src/workspace.js";

const tabs = [
  { id: 1, groupId: "a" }, { id: 2 }, { id: 3, groupId: "a" },
  { id: 4, pinned: true }, { id: 5, groupId: "missing" }, { id: 6, groupId: "b", pinned: true },
  { id: 7, groupId: "b" }
];
assert.deepEqual(arrangeTabs(tabs, [{ id: "a" }, { id: "b" }]).map(t => t.id), [4, 6, 1, 3, 2, 5, 7]);
assert.deepEqual(tabs.map(t => t.id), [1, 2, 3, 4, 5, 6, 7]);
assert.equal(paneRatio("80"), 80);
assert.equal(paneRatio(3), 20);
assert.equal(paneRatio(undefined), 50);
assert.equal(paneLayout("unrecognized"), "columns");
assert.equal(tabLayout("right"), "right");
assert.equal(tabLayout("unrecognized"), "top");
assert.ok(validColour("#Ff769C"));
assert.equal(validColour("#f;overflow:hidden"), false);

console.log("Workspace tab grouping, layouts, colours and split bounds passed");
