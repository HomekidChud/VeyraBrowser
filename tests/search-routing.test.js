import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../web/src/app.js", import.meta.url), "utf8");
const goStart = app.indexOf("export async function go(");
const goEnd = app.indexOf("\nexport async function navigate(", goStart);
const go = app.slice(goStart, goEnd);

test("new-tab search input opens a Veyra search tab rather than proxying the raw query", () => {
  assert.ok(goStart >= 0 && goEnd > goStart, "go() navigation handler is present");
  const searchBranch = go.indexOf('if (inNew && r.kind === "search")');
  const genericNewTabBranch = go.indexOf("if (inNew) {", searchBranch + 1);
  assert.ok(searchBranch >= 0, "new-tab search has a dedicated route");
  assert.ok(genericNewTabBranch > searchBranch, "search routing precedes generic new-tab handling");
  const branch = go.slice(searchBranch, genericNewTabBranch);
  assert.match(branch, /const target = makeTab\(\)/);
  assert.match(branch, /showSearch\(r\.query, \{ tab: target/);
  assert.doesNotMatch(branch, /newTab\(\{ url: input \}\)/);
});
