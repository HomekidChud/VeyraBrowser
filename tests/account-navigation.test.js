import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountDestination, GOOGLE_SIGN_IN, GOOGLE_SIGN_UP, GITHUB_SIGN_UP, withGitHubSignupBookmark } from "../web/src/account-navigation.js";

assert.deepEqual(accountDestination("https://accounts.google.com/v3/signin/identifier?continue=secret&sid=abc"),
  { provider: "Google", url: GOOGLE_SIGN_IN, signup: false });
assert.deepEqual(accountDestination("https://accounts.google.com/lifecycle/steps/signup/name?state=private#private"),
  { provider: "Google", url: GOOGLE_SIGN_UP, signup: true });
assert.deepEqual(accountDestination("https://github.com/join?token=private"),
  { provider: "GitHub", url: "https://github.com/signup", signup: true });
assert.deepEqual(accountDestination("https://github.com/login/device?code=private"),
  { provider: "GitHub", url: "https://github.com/login", signup: false });
for (const url of [
  null, "", "https://github.com/HomekidChud/VeyraBrowser", "https://www.google.com/search?q=veyra",
  "https://accounts.google.com.invalid/signup", "https://github.com.evil.test/signup",
  "http://accounts.google.com/", "https://accounts.google.com:444/", "https://anyone@accounts.google.com/"
]) assert.equal(accountDestination(url), null, String(url));

const existing = [{ id: "custom", url: "https://example.org/docs", title: "My docs" }];
const seeded = withGitHubSignupBookmark(existing);
assert.equal(seeded.length, 2);
assert.equal(seeded[0], existing[0]);
assert.equal(seeded[1].url, GITHUB_SIGN_UP);
assert.equal(seeded[1].title, "GitHub signup");
assert.equal(withGitHubSignupBookmark(seeded), seeded);
const legacy = [{ url: "https://github.com/join?legacy=1", title: "My GitHub shortcut" }];
assert.equal(withGitHubSignupBookmark(legacy), legacy);

const launcher = JSON.parse(readFileSync(new URL("../launcher-extension/manifest.json", import.meta.url), "utf8"));
assert.equal(launcher.manifest_version, 3);
// Cookie transfer: exactly these permissions, nothing broader. activeTab
// (the clicked tab's url), cookies (read on Send), scripting (ask the open
// Veyra tab for its session id), storage (remember the API origin).
assert.deepEqual(launcher.permissions, ["activeTab", "cookies", "storage", "scripting"]);
assert.deepEqual(launcher.host_permissions, ["<all_urls>"]);
for (const field of ["optional_permissions", "optional_host_permissions", "content_scripts", "background"]) {
  assert.equal(launcher[field], undefined, `${field} must not be present`);
}
const popup = readFileSync(new URL("../launcher-extension/popup.html", import.meta.url), "utf8");
// No inline script (MV3 CSP), no javascript: URIs, no form; the only script
// is the local popup.js.
assert.doesNotMatch(popup, /<script(?![^>]*src="popup\.js")/i);
assert.doesNotMatch(popup, /javascript:|<form/i);
assert.match(popup, /https:\/\/accounts\.google\.com\/signup/);
const popupJs = readFileSync(new URL("../launcher-extension/popup.js", import.meta.url), "utf8");
// Cookie transfer contract: reads cookies only via chrome.cookies, targets
// the user's own session found in their open Veyra tab, and posts only to
// the /api/handoff/cookies import. No eval, no remote code.
assert.match(popupJs, /chrome\.cookies\.getAll/);
assert.match(popupJs, /veyra:request-session/);
assert.match(popupJs, /\/api\/handoff\/cookies/);
assert.doesNotMatch(popupJs, /eval\(|new Function|innerHTML\s*=/);
assert.match(popupJs, /https:\/\/veyraserver-xscy\.onrender\.com/);
console.log("Official account destination and launcher cookie-transfer checks passed");
