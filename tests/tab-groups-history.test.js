/* Tab groups must survive in-app back/forward navigation and shell reloads. */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const files = {
  app: readFileSync(new URL("../web/src/app.js", import.meta.url), "utf8"),
  core: readFileSync(new URL("../web/src/core.js", import.meta.url), "utf8"),
};
const lines = f => f.split("\n");

// --- app.js: the tab-group state and mutation helpers -----------------------
const app = files.app;
assert.match(app, /tabGroups:\s*load\("veyra-tab-groups",\s*\[\]\)/, "tab group state must be loaded from local storage");

// Bug 1: group membership changes were never persisted. Every mutation of
// t.groupId must be saved, otherwise a shell reload forgets the grouping.
for (const [name, fn] of [
  ["assignTabToGroup", "export function assignTabToGroup"],
  ["removeTabFromGroup", "export function removeTabFromGroup"],
]) {
  const i = app.indexOf(fn);
  assert.ok(i >= 0, `${name} must exist`);
  const body = app.slice(i, app.indexOf("export function", i + 10) === -1 ? i + 800 : app.indexOf("export function", i + 10));
  assert.match(body, /persistTabGroups\(\)/, `${name} must persist group membership`);
}
assert.match(app, /function persistTabGroups\(\)/, "a shared persistTabGroups helper must exist");

// Bug 2: openInternal creates a fresh tab when the active tab is a page, but
// dropped the groupId, so a grouped tab that navigated back into an internal
// view and forward again lost its group. makeTab must inherit the groupId
// from the source tab.
const openInternalIdx = app.indexOf("export function openInternal");
assert.ok(openInternalIdx >= 0, "openInternal must exist");
const openInternalBody = app.slice(openInternalIdx, openInternalIdx + 3000);
assert.match(openInternalBody, /makeTab\(\{\s*sourceTabId:\s*src\.id,\s*groupId:\s*src\.groupId\s*\}\)/, "openInternal must carry the source tab's groupId into the new tab");

// Bug 3: forward/back only restored the URL. The per-tab history entries kept
// the groupId as a property of the tab, so it survived — but the address-bar
// route sync pushed full routes that a reload (or a route-based popstate)
// would rebuild from a single tab, dropping the tab's group. The session
// save/restore below covers that. restoreHistoryEntry must navigate the SAME
// tab object (no tab churn):
const backIdx = app.indexOf("export async function back()");
assert.ok(backIdx >= 0, "back() must exist");
const backBody = app.slice(backIdx, backIdx + 900);
assert.ok(!/newTab|makeTab/.test(backBody), "back() must not create a new tab");
const fwdBody = app.slice(app.indexOf("export async function forward()"), app.indexOf("export async function forward()") + 900);
assert.ok(!/newTab|makeTab/.test(fwdBody), "forward() must not create a new tab");
const restoreIdx = app.indexOf("async function restoreHistoryEntry");
assert.ok(restoreIdx >= 0, "restoreHistoryEntry must exist");
const restoreBody = app.slice(restoreIdx, restoreIdx + 900);
assert.match(restoreBody, /navigate\(e,\s*\{\s*tab:\s*t,\s*pushHist:\s*false\s*\}\)/, "back/forward must restore the history entry in the same tab");
assert.ok(!/newTab|makeTab/.test(restoreBody), "restoreHistoryEntry must not create a new tab");

// Bug 4: session restore dropped tab groups. The per-tab session snapshot must
// include the groupId, and the restore path must re-apply it.
assert.match(app, /function persistTabState\(\)/, "a per-tab session snapshot helper must exist");
assert.match(app, /function restoreTabState\(\)/, "a per-tab session restore helper must exist");
const persistIdx = app.indexOf("function persistTabState()");
const persistBody = app.slice(persistIdx, persistIdx + 700);
assert.match(persistBody, /groupId:\s*t\.groupId/, "persistTabState must save each tab's groupId");

// The restore path must put tabs back into their groups. The session state is
// restored in boot() via restoreTabState(); check the wiring exists and the
// handoff branch (a reload of the shell with a target URL) also goes through
// the same tab object instead of creating a new one.
assert.match(app, /restoreTabState\(\)/, "boot must restore the saved tab state");
const bootIdx = app.indexOf("async function boot()");
const bootBody = app.slice(bootIdx, bootIdx + 4000);
assert.match(bootBody, /restoreTabState\(\)/, "boot() must call restoreTabState() before applyRoute");
// The handoff branch should reuse the active tab, not mint a fresh tab after
// the snapshot was already restored (that would strand the grouping).
assert.ok(!/const t = makeTab\(\); state\.tabs\.push\(t\)/.test(bootBody.slice(bootBody.indexOf("const handoff"))), "handoff branch must reuse the restored active tab");

// --- core.js: the new key must not be treated as ephemeral ------------------
assert.match(files.core, /"veyra-tab-groups",\s*"veyra-live-session"/, "tab groups must stay persistent (not ephemeral)");

console.log("tab-groups-history.test.js — all assertions passed");
