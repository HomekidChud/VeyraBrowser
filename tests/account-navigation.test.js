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
for (const field of ["permissions", "optional_permissions", "host_permissions", "optional_host_permissions", "content_scripts", "background"]) {
  assert.equal(launcher[field], undefined, `${field} must not be present`);
}
const popup = readFileSync(new URL("../launcher-extension/popup.html", import.meta.url), "utf8");
assert.doesNotMatch(popup, /<script|javascript:|<form/i);
assert.match(popup, /https:\/\/accounts\.google\.com\/signup/);
console.log("Official account destination and permission-free launcher checks passed");
