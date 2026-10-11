import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../web/src/app.js", import.meta.url), "utf8");
assert.match(appSource, /async function serverChromiumAvailable\(\)/, "the client checks the server's advertised Chromium capability");
assert.match(appSource, /status\?\.chromiumEnabled === true/, "missing or disabled Chromium must be treated as unavailable");
assert.match(appSource, /f\.src = proxyUrl\(url, "view", session\.id/, "normal page loads use the upstream page proxy in the browser frame");
assert.match(appSource, /if \(strategy\.forceBrowserHost && !\(await serverChromiumAvailable\(\)\)\)\s*\{\s*strategy = \{ \.\.\.strategy, key: "proxy", proxy: true, crawler: false, browser: false, race: false/, "special SPA hosts use the full proxy when server Chromium is disabled");
assert.match(appSource, /async function routeBrowserRequired\(t, url, key, reason\)/, "browser-required events use the capability-aware fallback");
assert.match(appSource, /keeping the FAST_PROXY page/, "when Chromium is unavailable the proxy frame is retained");
assert.match(appSource, /t\.requiresBrowser = false/, "a failed or unavailable browser attempt must not prevent proxy fallback");
assert.match(appSource, /youtubeProxy: true/, "YouTube keeps its dedicated no-Chromium fast-proxy strategy");
assert.doesNotMatch(appSource, /showHttpReaderFallback|httpReaderFallback|\/api\/reader|HTTP Reader/, "the browser UI no longer replaces the upstream page with an extracted-text reader");
assert.match(appSource, /if \(isYouTubeUrl\(url\)\)\s*\{\s*t\.youtubeEmbed = !!youtubeEmbedUrl\(url\);[\s\S]{0,240}f\.srcdoc = youtubeFallbackHtml\(url\)/, "YouTube pages use a player or a clear direct-open fallback instead of the broken upstream skeleton");

console.log("VeyraBrowser FAST_PROXY fallback checks passed");
