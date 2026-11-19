import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../web/src/app.js", import.meta.url), "utf8");
const swSource = fs.readFileSync(new URL("../web/sw.js", import.meta.url), "utf8");
assert.match(appSource, /async function serverChromiumAvailable\(\)/, "the client checks the server's advertised Chromium capability");
assert.match(appSource, /status\?\.chromiumEnabled === true/, "missing or disabled Chromium must be treated as unavailable");
assert.match(appSource, /setFrameSrc\(f, proxyUrl\(url, "view", session\.id/, "normal page loads use the upstream page proxy in the browser frame");
assert.match(appSource, /if \(strategy\.forceBrowserHost && !\(await serverChromiumAvailable\(\)\)\)\s*\{\s*strategy = \{ \.\.\.strategy, key: "proxy", proxy: true, crawler: false, browser: false, race: false/, "special SPA hosts use the full proxy when server Chromium is disabled");
assert.match(appSource, /async function routeBrowserRequired\(t, url, key, reason\)/, "browser-required events use the capability-aware fallback");
assert.match(appSource, /keeping the FAST_PROXY page/, "when Chromium is unavailable the proxy frame is retained");
assert.match(appSource, /t\.requiresBrowser = false/, "a failed or unavailable browser attempt must not prevent proxy fallback");
assert.doesNotMatch(appSource, /showHttpReaderFallback|httpReaderFallback|\/api\/reader|HTTP Reader/, "the browser UI no longer replaces the upstream page with an extracted-text reader");
assert.match(appSource, /inlineYouTubeAllowed\(\) && !youtubeWatchId\(url\) && youtubeEmbedUrl\(url\)/, "valid watch pages are excluded from the standalone player");
assert.match(appSource, /watchInline && inlineYouTubeAllowed\(\) \? `\$\{src\}&__veyra_youtube_inline=1`/, "watch pages keep their proxied document and opt into the in-place player");
assert.match(appSource, /if \(isYouTubeUrl\(url\)\) \{\s*return \{ key: "browser", proxy: false, crawler: false, browser: true, race: false, forceBrowserHost: true \};/, "YouTube home and non-video pages retain the previous routing");
assert.match(appSource, /url = normalizeYouTubeUrl\(url\)/, "m.youtube.com URLs are normalized before they are loaded");
assert.match(appSource, /frame\.srcdoc = direct === "youtube" \? youtubeFallbackHtml\(url\) : nowGameMarkup\(url\);[\s\S]{0,440}return;[\s\S]{0,320}await ensureSession\(\)/, "direct pages are visible before the proxy session starts");
assert.match(appSource, /target !== t\.url && e\.origin === API_ORIGIN && frameFor\(t\)\?\.contentWindow === e\.source && \(localPageKind\(target\) \|\| watchChanged\)/, "only a trusted root frame can restart a video navigation");
assert.match(appSource, /!INCOGNITO && !state\.vpn\.connected && settings\.youtubeInline/, "private and VPN sessions stay on regular routes");
assert.match(appSource, /if \(!current\(\) \|\| result\?\.stale\) return;/, "stale Chromium starts may not replace the direct page");

assert.match(swSource, /cache\.put\(request, response\.clone\(\)\)\.catch\(\(\) => \{\}\)/, "cache writes must be failure-safe");
assert.match(swSource, /return cached \|\| Response\.error\(\);/, "a network failure with no cached copy must return a network-error response");
assert.match(swSource, /url\.searchParams\.has\("v"\)\) return cached;[\s\S]{0,55}const network = fetch/, "versioned scripts and styles avoid a network fetch on a warm load");
assert.match(swSource, /return \(await cache\.match\("\.\/index\.html"\)\) \|\| Response\.error\(\);/, "offline shell cache misses still return a response");

console.log("VeyraBrowser FAST_PROXY fallback checks passed");
