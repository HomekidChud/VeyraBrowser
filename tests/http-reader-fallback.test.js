import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../web/src/app.js", import.meta.url), "utf8");
assert.match(appSource, /async function serverChromiumAvailable\(\)/, "the client checks the server's advertised Chromium capability");
assert.match(appSource, /status\?\.chromiumEnabled === true/, "missing or disabled Chromium must be treated as unavailable");
assert.match(appSource, /function showHttpReaderFallback\(t, url, key, reason\)/, "an unavailable browser feature has a readable fallback");
assert.match(appSource, /new URL\("\/api\/reader", API_ORIGIN\)/, "reader mode must be served by the Veyra API, not the target site");
assert.match(appSource, /readerUrl\.searchParams\.set\("url", url\)/, "the original target URL is passed as data to the reader route");
assert.match(appSource, /if \(strategy\.youtubeProxy\)\s*\{\s*showHttpReaderFallback\(t, url, `\$\{url\}\|youtube-http-reader`/, "YouTube's non-Chromium path must avoid loading its heavyweight proxied page");
assert.match(appSource, /void routeBrowserRequired\(t, u, key, d\.reason\)/, "browser-required events use the capability-aware fallback");
assert.match(appSource, /t\.httpReaderFallback = true/, "reader fallback is tracked to prevent blank-page fallback loops");
assert.match(appSource, /t\.httpReaderFallback\) return/, "reader pages are not reclassified as blank proxied pages");

console.log("VeyraBrowser HTTP-reader fallback checks passed");
