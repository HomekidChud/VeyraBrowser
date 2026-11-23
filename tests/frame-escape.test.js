import assert from "node:assert/strict";
import fs from "node:fs";
import { originalSiteUrl, proxyStatusNotice, siteLoadErrorMarkup } from "../web/src/site-recovery.js";

const src = fs.readFileSync(new URL("../web/src/app.js", import.meta.url), "utf8");

assert.match(src, /function probeFrameForEscape\(t\) \{/, "the escape watchdog must exist");
const start = src.indexOf("function probeFrameForEscape");
const watchdog = src.slice(start, src.indexOf("\n}", start));
assert.match(watchdog, /if \(origin !== API_ORIGIN\) return;[\s\S]*?postMessage/, "only proxy frames are probed");
assert.match(watchdog, /if \(!f\.src \|\| !\/\^https\?:\/i\.test\(f\.src\)\) return;/, "empty-src frames (about:blank, srcdoc embeds) must not count as escapes");
assert.match(watchdog, /\{ type: "veyra:embed-probe" \}, API_ORIGIN/, "the watchdog must probe the loaded frame");
assert.match(watchdog, /if \(\(t\.lastRuntimeAckAt \|\| 0\) > loadedAt\) return;[\s\S]*?t\.escapeRecoveries =/, "an answered probe must not trigger recovery");
assert.match(watchdog, /t\.escapeRecoveries = \(t\.escapeRecoveries \|\| 0\) \+ 1;/, "recoveries must be counted");
assert.match(watchdog, /if \(t\.escapeRecoveries > 3\) \{/, "recovery must be capped to avoid reload loops");
assert.match(watchdog, /t\.pageLoad !== pageLoad \|\| t\.escapeProbe !== probe/, "a newer navigation or probe must invalidate stale timers");
assert.match(watchdog, /showSiteRecovery\(t,/, "a repeated failure must offer an explicit recovery action");

assert.match(src, /if \(d\.type === "veyra:embed-probe-ack"\) \{ t\.lastRuntimeAckAt = Date\.now\(\); t\.escapeRecoveries = 0; return; \}/, "probe acks must reset the recovery counter");

assert.match(src, /function setFrameSrc\(f, src, tab = null\) \{/, "the forced frame-src helper must exist");
assert.match(src, /if \(f\.src === src\) f\.removeAttribute\("src"\);/, "an identical src must be dropped before reassignment so the frame reloads");
assert.doesNotMatch(src, /f\.src = proxyUrl\(/, "frame src assignments must go through setFrameSrc");

const navigateHandler = src.slice(src.indexOf('if (d.type === "veyra:navigate" && d.url)'));
assert.ok(navigateHandler.length > 100, "the veyra:navigate handler must exist");
assert.match(navigateHandler.slice(0, 2200), /if \(String\(d\.source\)\.startsWith\("history\."\)\) \{[\s\S]*?fromRootFrame[\s\S]*?if \(!fromRootFrame\) return;/, "history events from nested frames must not hijack the tab URL");
assert.match(navigateHandler, /const fromRootFrame = \(\(\) => \{ try \{ return frameFor\(t\)\?\.contentWindow === e\.source; \} catch \{ return false; \} \}\)\(\);\s*\n\s*if \(!fromRootFrame\) return;\s*\n\s*t\.url = target;/, "location.assign/replace events from nested frames must not hijack the tab URL");

const target = "https://example.com/watch?v=1&mode=full#start";
assert.equal(originalSiteUrl(target), target);
assert.equal(originalSiteUrl("http://example.com:8080/"), "http://example.com:8080/");
for (const bad of ["", "/relative", "veyra://settings", "javascript:alert(1)", "https://user:pass@example.com", "https://", null]) {
  assert.equal(originalSiteUrl(bad), "");
}
const errorPage = siteLoadErrorMarkup("Couldn't load", { message: "<script>bad</script>", requestId: '"test"' }, target);
assert.match(errorPage, /id="veyra-local-retry"/);
assert.match(errorPage, /v=1&amp;mode=full#start" target="_blank" rel="noopener noreferrer"/);
assert.match(errorPage, /&lt;script&gt;bad&lt;\/script&gt;/);
assert.match(errorPage, /Request &quot;test&quot;/);
assert.doesNotMatch(errorPage, /<script|onclick=/);
assert.doesNotMatch(siteLoadErrorMarkup("Invalid", {}, "javascript:alert(1)"), /Open original site/);
assert.match(proxyStatusNotice(451), /unavailable for legal reasons/);
assert.notEqual(proxyStatusNotice(451), proxyStatusNotice(403));
const tiktokError = siteLoadErrorMarkup("Couldn't load", {}, "https://www.tiktok.com/", { offerDirect: false, returnToTikTok: true });
assert.match(tiktokError, /id="veyra-local-options"/);
assert.doesNotMatch(tiktokError, /Open original site|<a href=/);
assert.doesNotMatch(src, /veyra:local-retry/, "untrusted frames cannot request the local error screen's retry action");

console.log("frame escape + address-bar hijack regression checks passed");
