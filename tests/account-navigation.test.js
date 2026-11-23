import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountDestination, GOOGLE_SIGN_IN, GOOGLE_SIGN_UP, GITHUB_SIGN_UP, withGitHubSignupBookmark } from "../web/src/account-navigation.js";
import { directSiteUrl } from "../launcher-extension/direct-url.js";

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
for (const field of ["permissions", "optional_permissions", "host_permissions", "optional_host_permissions", "content_scripts", "background", "externally_connectable"]) {
  assert.equal(launcher[field], undefined, `${field} must not be present`);
}
const popup = readFileSync(new URL("../launcher-extension/popup.html", import.meta.url), "utf8");
assert.match(popup, /script-src 'self'.*form-action 'none'/);
assert.match(popup, /<script type="module" src="popup\.js"><\/script>/);
assert.match(popup, /<form class="open-site" id="open-site" novalidate>/);
assert.match(popup, /Open site directly/);
assert.doesNotMatch(popup, /javascript:/i);
assert.equal(directSiteUrl("  HTTPS://example.org/login?next=%2Fdocs#account  "), "https://example.org/login?next=%2Fdocs#account");
assert.equal(directSiteUrl("https://example.org:8443"), "https://example.org:8443/");
assert.equal(directSiteUrl("https://xn--bcher-kva.example/login"), "https://xn--bcher-kva.example/login");
for (const address of [
  "", "example.org", "//example.org", "https:///example.org", "https://", "https://example.org:99999/",
  "http://example.org/login", "javascript:alert(1)", "data:text/html,<p>test</p>", "chrome://extensions",
  "file:///tmp/example", "https://alice:secret@example.org", "https://example.org@other.example",
  "https://exam\nple.org/", "https://example.org\\@other.example", "https://example.org/login page"
]) assert.equal(directSiteUrl(address), "", address);
const popupScript = readFileSync(new URL("../launcher-extension/popup.js", import.meta.url), "utf8");
assert.match(popupScript, /window\.open\(target, "_blank", "noopener,noreferrer"\)/);
assert.doesNotMatch(popupScript, /\b(?:fetch|document\.cookie|chrome\.|XMLHttpRequest|localStorage|sessionStorage|navigator\.clipboard)\b/);
assert.match(popup, /https:\/\/accounts\.google\.com\/signup/);
assert.match(popup, /href="https:\/\/www\.msn\.com\/play" target="_blank" rel="noopener noreferrer"/);
assert.match(popup, /href="https:\/\/homekidchud\.github\.io\/VeyraBrowser\/web\/downloads\/#browser-extension"/);
assert.ok(popup.includes(`v${launcher.version}`), "popup should display the current launcher version");
const downloads = readFileSync(new URL("../web/downloads/index.html", import.meta.url), "utf8");
assert.ok(downloads.includes(`Launcher v${launcher.version}`), "download page should match the launcher version");
assert.ok(downloads.includes(`./veyra-launcher.zip?v=${launcher.version}`), "download link should bypass old cached ZIPs");
assert.match(downloads, /id="browser-extension"/);
assert.match(downloads, /id="launcher-sign-in"/);
const install = readFileSync(new URL("../launcher-extension/INSTALL.txt", import.meta.url), "utf8");
assert.match(install, /Website address and choose Open site directly/);
const appSource = readFileSync(new URL("../web/src/app.js", import.meta.url), "utf8");
assert.match(appSource, /function launcherDownloadAction\(\) \{\s*return \{ label: "Get extension", href: `\$\{APP_BASE\}\/downloads\/#browser-extension` \};/);
assert.doesNotMatch(appSource, /veyra-launcher\.zip/, "sign-in notifications should not initiate a raw ZIP download");
console.log("Official account destination and permission-free launcher checks passed");
