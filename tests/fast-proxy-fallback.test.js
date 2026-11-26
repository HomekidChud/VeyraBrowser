import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../web/src/app.js", import.meta.url), "utf8");
const chromiumSource = fs.readFileSync(new URL("../web/src/chromium-capability.js", import.meta.url), "utf8");
const swSource = fs.readFileSync(new URL("../web/sw.js", import.meta.url), "utf8");
assert.match(appSource, /async function serverChromiumAvailable\(\)/, "the client checks the server's advertised Chromium capability");
assert.match(chromiumSource, /status\?\.chromiumEnabled === true/, "missing or disabled Chromium must be treated as unavailable");
assert.match(chromiumSource, /age < ttl/, "server Chromium capability results must expire instead of remaining stale for a whole tab session");
assert.match(appSource, /setProxyFrame\(f, proxyUrl\(url, "view", session\.id/, "normal page loads use the upstream page proxy in the browser frame");
assert.match(appSource, /if \(strategy\.forceBrowserHost && !\(await serverChromiumAvailable\(\)\)\)\s*\{\s*strategy = \{ \.\.\.strategy, key: "proxy", proxy: true, crawler: false, browser: false, race: false/, "special SPA hosts use the full proxy when server Chromium is disabled");
assert.match(appSource, /async function routeBrowserRequired\(t, url, key, reason\)/, "browser-required events use the capability-aware fallback");
assert.match(appSource, /keeping the FAST_PROXY page/, "when Chromium is unavailable the proxy frame is retained");
assert.match(appSource, /t\.requiresBrowser = false/, "a failed or unavailable browser attempt must not prevent proxy fallback");
assert.doesNotMatch(appSource, /showHttpReaderFallback|httpReaderFallback|\/api\/reader|HTTP Reader/, "the browser UI no longer replaces the upstream page with an extracted-text reader");
assert.match(appSource, /youtubeAllowed && inlineYouTubeAllowed\(\) && youtubeEmbedUrl\(url\)/, "supported video routes use the standalone recovery desk");
assert.match(appSource, /openProxy: \(\) => \{ if \(current\(\)\) void loadInTab\(t, url, \{ trackHistory: false, useMediaProxy: true \}\)/, "the recovery desk can retry the original document through Fast Proxy");
assert.match(appSource, /if \(isYouTubeUrl\(url\)\) \{\s*return \{ key: "browser", proxy: false, crawler: false, browser: true, race: false, forceBrowserHost: true \};/, "YouTube home and non-video pages retain the previous routing");
assert.match(appSource, /url = normalizeYouTubeUrl\(url\)/, "m.youtube.com URLs are normalized before they are loaded");
assert.match(appSource, /frame\.srcdoc = youtubeFallbackHtml\(url\);[\s\S]{0,470}return;[\s\S]{0,400}await ensureSession\(\)/, "direct pages are visible before a new proxy session starts");
assert.match(appSource, /target !== t\.url && e\.origin === API_ORIGIN && frameFor\(t\)\?\.contentWindow === e\.source && \(localPageKind\(target, !keepYouTubeProxy\) \|\| watchChanged\)/, "only a trusted root frame can restart a video navigation");
assert.match(appSource, /mediaDirectAllowed\(\) && settings\.youtubeInline !== false/);
assert.match(appSource, /!INCOGNITO && !state\.vpn\.connected && !pendingVpnConnections && !settings\.vpnAutoProfile/, "private and VPN sessions stay on regular routes");
assert.match(appSource, /if \(!current\(\) \|\| result\?\.stale\) return;/, "stale Chromium starts may not replace the direct page");

assert.match(swSource, /cache\.put\(request, response\.clone\(\)\)\.catch\(\(\) => \{\}\)/, "cache writes must be failure-safe");
assert.match(swSource, /return cached \|\| Response\.error\(\);/, "a network failure with no cached copy must return a network-error response");
assert.match(swSource, /url\.searchParams\.has\("v"\)\) return cached;[\s\S]{0,55}const network = fetch/, "versioned scripts and styles avoid a network fetch on a warm load");
assert.match(swSource, /return \(await cache\.match\("\.\/index\.html"\)\) \|\| Response\.error\(\);/, "offline shell cache misses still return a response");

console.log("VeyraBrowser FAST_PROXY fallback checks passed");
