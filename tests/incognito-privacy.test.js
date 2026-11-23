/* Incognito privacy: rotating 32-char private address, no history recording,
 * and no persistence of any user data into localStorage during incognito. */
import assert from "node:assert";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../web/src/app.js", import.meta.url), "utf8");
const core = readFileSync(new URL("../web/src/core.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../web/src/ui.js", import.meta.url), "utf8");

const rotIdx = app.indexOf("function rotateIncognitoAddressToken()");
assert.ok(rotIdx >= 0, "rotateIncognitoAddressToken must exist");
const rotBody = app.slice(rotIdx, app.indexOf("function startIncognitoAddressRotation"));
assert.match(rotBody, /new Uint8Array\(32\)/, "the private address token must be 32 random chars");
assert.ok(!/new Uint8Array\(48\)/.test(rotBody), "the old 48-char token must be gone");
assert.match(rotBody, /INCOGNITO_TOKEN_ALPHABET/, "token chars must come from the fixed alphabet");
assert.match(rotBody, /veyra:\/\/private\//, "token keeps the veyra://private/ scheme");

const startIdx = app.indexOf("function startIncognitoAddressRotation()");
assert.ok(startIdx >= 0, "startIncognitoAddressRotation must exist");
const startBody = app.slice(startIdx, startIdx + 900);
const intervalMatch = startBody.match(/setInterval\(rotateIncognitoAddressToken,\s*(\d+)\)/);
assert.ok(intervalMatch, "rotation must run on a setInterval");
const intervalMs = Number(intervalMatch[1]);
assert.ok(intervalMs >= 400 && intervalMs <= 900, `rotation interval ${intervalMs}ms must stay under Chrome's replaceState throttle (~100 calls / 30s)`);
assert.ok(intervalMs !== 1, "the old 1ms interval (instantly throttled) must be gone");
assert.match(startBody, /if \(!INCOGNITO \|\| window\.__veyraIncognitoAddressRotation\) return;/, "rotation must be idempotent and incognito-only");

const recIdx = app.indexOf("export function recordHistory");
assert.ok(recIdx >= 0, "recordHistory must exist");
const recBody = app.slice(recIdx, recIdx + 700);
assert.match(recBody, /if \(INCOGNITO\) return;/, "recordHistory must be a no-op in incognito");

assert.match(core, /const ephemeral = key => INCOGNITO && EPHEMERAL_KEYS\.has\(key\)/, "ephemeral keys must be memory-only in incognito");
for (const key of ["veyra-history", "veyra-downloads", "veyra-last-tabs", "veyra-auth", "veyra-settings", "veyra-bookmarks"]) {
  assert.ok(core.includes(`"${key}"`), `ephemeral key set must include ${key}`);
}
assert.match(app, /const ephemeralSession = \(\) => INCOGNITO \|\| !auth\.user/);
assert.match(app, /if \(ephemeralSession\(\)\) return false;/, "guest sessions cannot restore tabs");
assert.match(app, /display-capture 'none'; fullscreen 'none'; picture-in-picture 'none'/);
assert.match(ui, /cover\.showModal\(\)/);
assert.match(ui, /cover\.addEventListener\("cancel", event => event\.preventDefault\(\)\)/);
assert.match(ui, /document\.addEventListener\("visibilitychange"/);

console.log("incognito privacy regression checks passed");
