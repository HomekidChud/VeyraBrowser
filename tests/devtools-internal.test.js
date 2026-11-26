import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const devtools = readFileSync(new URL("../web/src/devtools.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../web/src/ui.js", import.meta.url), "utf8");

test("internal browser views are eligible for local Elements DOM inspection and picking", () => {
  assert.match(devtools, /const onInternalView = t => !!t && t\.view !== "page"/);
  assert.match(devtools, /method === "dom\.document"[\s\S]*?localNode\(t, document/);
  assert.match(devtools, /method === "dom\.nodeAt"[\s\S]*?document\.elementFromPoint/);
  assert.match(devtools, /if \(!onPage\(tab\(\)\) && !onInternalView\(tab\(\)\)\) return toast[\s\S]*?open\("elements"\); setPicking\(true\)/);
  assert.match(devtools, /document\.addEventListener\("click", localPick, true\)/);
});

test("Mod+Shift+I invokes the DevTools toggle", () => {
  assert.match(ui, /id: "devtools",[\s\S]*?keys: \["Mod\+Shift\+I", "F12"\],[\s\S]*?run: \(\) => hooks\.dt\?\.toggle\(\)/);
});

test("page views retain the remote DevTools bridge path", () => {
  assert.match(devtools, /const call = \(method, params, ms\) => onInternalView\(tab\(\)\) \? localCall\(tab\(\), method, params\) : dtCall\(tab\(\), method, params, ms\)/);
  assert.match(devtools, /if \(isRemote\(t\)\) \{ \$\("remoteSurface"\)[\s\S]*?call\("dom\.pick", \{ enabled: on \}\)/);
});
