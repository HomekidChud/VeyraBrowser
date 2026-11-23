import assert from "node:assert/strict";
import { readVpnAvailability } from "../web/src/vpn-availability.js";

const profile = { id: "fixture", name: "London fixture", country: "GB" };
let rejectConnection, published;
const catalogReady = new Promise(resolve => { published = resolve; });
const route = path => {
  if (path.startsWith("/api/vpn/session")) return new Promise((_, reject) => { rejectConnection = reject; });
  if (path.endsWith("/status")) return Promise.resolve({ profiles: [] });
  if (path.endsWith("/profiles")) return Promise.resolve({ enabled: true, profiles: [profile] });
  throw new Error(path);
};
const pending = readVpnAvailability(route, { sessionId: "fixture-session", onProfiles: published });
assert.deepEqual((await catalogReady).status.profiles, [profile], "show exits without waiting for the session");
rejectConnection(new Error("unreachable"));
const delayed = await pending;
assert.deepEqual(delayed.status.profiles, [profile], "a failed session check must not hide exits");
assert.match(delayed.sessionError, /Couldn't check/);

const previous = await readVpnAvailability(async () => { throw new Error("offline"); }, { previous: delayed.status });
assert.deepEqual(previous.status.profiles, [profile], "refresh errors preserve a known list");
assert.ok(previous.error);
const empty = await readVpnAvailability(async () => ({ enabled: true, profiles: [] }), {});
assert.deepEqual(empty.status.profiles, []);
assert.equal(empty.error, "", "a known empty catalog is not an error");
console.log("VPN availability checks passed");
