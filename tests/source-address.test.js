import assert from "node:assert/strict";
import fs from "node:fs";
import { parseSourceUri, resolveSourceUri, validateSourceDisplayUrl } from "../web/src/source-address.js";

const id = "CUrbzmka9bez6mxgJrTn6O7Y";
const link = "aHR0cHM6Ly93d3cuZ2VvLWZzLmNvbS8";
const uri = `veyra://view_source/${id}/${link}`;
const route = `/view_source/${id}/${link}`;

assert.deepEqual(parseSourceUri(uri), { uri, id, encodedLink: link, path: route });
assert.equal(resolveSourceUri(uri, "https://veyraserver-xscy.onrender.com/api").url, `https://veyraserver-xscy.onrender.com${route}`);
assert.equal(validateSourceDisplayUrl(uri, `https://veyraserver-xscy.onrender.com${route}`, "https://veyraserver-xscy.onrender.com"), uri);
assert.equal(validateSourceDisplayUrl(uri, `https://attacker.example${route}`, "https://veyraserver-xscy.onrender.com"), "");
assert.equal(validateSourceDisplayUrl(uri, `https://veyraserver-xscy.onrender.com/view_source/${id}/different___`, "https://veyraserver-xscy.onrender.com"), "");
assert.equal(validateSourceDisplayUrl(uri, `https://veyraserver-xscy.onrender.com${route}?next=https://attacker.example`, "https://veyraserver-xscy.onrender.com"), "");
assert.equal(resolveSourceUri(uri, "javascript:alert(1)"), null);
const appSource = fs.readFileSync(new URL("../web/src/app.js", import.meta.url), "utf8");
assert.match(appSource, /t\.displayUrl \|\| t\.url/, "the address field must show the virtual alias without replacing the HTTP page URL");
assert.match(appSource, /loadInTab\(t, target, \{ loadFrame: true, record: null, displayUrl: sourceDisplayUrl \}\)/, "the HTTP viewer URL remains the actual load target");
assert.match(appSource, /validateSourceDisplayUrl\(d\.veyraSourceUri, target, API_ORIGIN\)/, "a virtual alias is accepted only for a matching same-origin viewer route");
assert.match(appSource, /kind === "source"/, "pasting a Veyra source URI should resolve back to the HTTP viewer");
for (const bad of [
  "veyra://view_source/shortid/aHR0cHM6Ly8",
  "veyra://view_source/aaaaaaaaaaaaaaaaaaaa/has/slash",
  "veyra://view_source/aaaaaaaaaaaaaaaaaaaa/encoded?query",
  "veyra://view-source/aaaaaaaaaaaaaaaaaaaa/encoded",
  "http://example.com/view_source/aaaaaaaaaaaaaaaaaaaa/encoded"
]) assert.equal(parseSourceUri(bad), null, `should reject ${bad}`);

console.log("VeyraBrowser virtual source address tests passed");
