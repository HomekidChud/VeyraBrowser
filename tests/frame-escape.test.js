// Regression tests for the frame-escape / address-bar hijack fixes in app.js.
//
// MSN's MSAL silent-auth hidden iframes emitted location.assign events that
// the veyra:navigate handler adopted from ANY source, hijacking the tab URL
// to the OAuth authorize URL — the address bar showed the authorize URL and
// the post-handoff cookie-import reload reloaded the hijacked auth URL
// ("imports but bugs out"). Fix: only the tab's own root frame may drive the
// tab URL, and a frame that escapes the proxy is detected via the
// embed-probe handshake and reloaded inside the proxy.
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../web/src/app.js", import.meta.url), "utf8");

// The escape watchdog exists and only probes frames served from the API
// origin (proxy frames carry the runtime; YouTube embeds and app views
// don't and must not be "recovered").
assert.match(src, /function probeFrameForEscape\(t\) \{/, "the escape watchdog must exist");
assert.match(src, /if \(origin !== API_ORIGIN\) return; \/\/ only proxy frames carry the runtime/, "only proxy frames are probed");
assert.match(src, /if \(!f\.src \|\| !\/\^https\?:\/i\.test\(f\.src\)\) return;/, "empty-src frames (about:blank, srcdoc embeds) must not count as escapes");
assert.match(src, /\{ type: "veyra:embed-probe" \}, API_ORIGIN/, "the watchdog must probe the loaded frame");
assert.match(src, /if \(\(t\.lastRuntimeAckAt \|\| 0\) > loadedAt\) return; \/\/ runtime answered — still proxied/, "an answered probe must not trigger recovery");
assert.match(src, /t\.escapeRecoveries = \(t\.escapeRecoveries \|\| 0\) \+ 1;/, "recoveries must be counted");
assert.match(src, /if \(t\.escapeRecoveries > 3\) \{/, "recovery must be capped to avoid reload loops");

// The probe-ack handler resets the recovery counter on a healthy page.
assert.match(src, /if \(d\.type === "veyra:embed-probe-ack"\) \{ t\.lastRuntimeAckAt = Date\.now\(\); t\.escapeRecoveries = 0; return; \}/, "probe acks must reset the recovery counter");

// Reload paths must actually navigate: assigning the same value to iframe.src
// is a no-op, so the handoff's post-import reload and the escape recovery
// must drop the attribute first (setFrameSrc).
assert.match(src, /function setFrameSrc\(f, src, tab = null\) \{/, "the forced frame-src helper must exist");
assert.match(src, /if \(f\.src === src\) f\.removeAttribute\("src"\);/, "an identical src must be dropped before reassignment so the frame reloads");
assert.doesNotMatch(src, /f\.src = proxyUrl\(/, "frame src assignments must go through setFrameSrc");

// Only the tab's own root frame may update t.url — for history events and
// for location.assign/replace events alike.
const navigateHandler = src.slice(src.indexOf('if (d.type === "veyra:navigate" && d.url)'));
assert.ok(navigateHandler.length > 100, "the veyra:navigate handler must exist");
assert.match(navigateHandler.slice(0, 2200), /if \(String\(d\.source\)\.startsWith\("history\."\)\) \{[\s\S]*?fromRootFrame[\s\S]*?if \(!fromRootFrame\) return;/, "history events from nested frames must not hijack the tab URL");
assert.match(navigateHandler, /const fromRootFrame = \(\(\) => \{ try \{ return frameFor\(t\)\?\.contentWindow === e\.source; \} catch \{ return false; \} \}\)\(\);\s*\n\s*if \(!fromRootFrame\) return;\s*\n\s*t\.url = target;/, "location.assign/replace events from nested frames must not hijack the tab URL");

console.log("frame escape + address-bar hijack regression checks passed");
