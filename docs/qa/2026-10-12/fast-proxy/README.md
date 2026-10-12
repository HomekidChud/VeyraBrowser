# Fast Proxy follow-up

This is the 12 October 2026 continuation of the browser/server maintenance pass. Only VeyraBrowser and VeyraServer were changed; VeyraOS and backup repositories remain out of scope. Frontend release metadata is now `8.28.29`, with import/service-worker cache version `8.28.29-fast-proxy`.

## Result and limits

The final local 26-site sample recorded **19 readable initial pages, two provider error screens, three HTTP failures, one verification screen and one empty/visual-only page**. These are initial-content outcomes, not sign-in, playback, shopping, DRM, chat or full compatibility approvals. Sites with readable content can still have resource or console errors.

The earlier 16-site follow-up is retained in `results.json`; the latest 26-site evidence is in [final/results.json](final/results.json). The focused Twitch/Archive sample is in [focused-follow-up/results.json](focused-follow-up/results.json). Samples ran through the actual “Open in Veyra” control, with isolated guest sessions, Chromium at 1440 × 900, service workers deliberately blocked, bounded waits and redacted diagnostic URLs.

The final sample recorded **zero `/api/browser/session` HTTP failures** after the disabled-engine start gate was fixed. This does not mean Chromium is operational: the local server advertises it as disabled, and the client now respects that.

## Confirmed defects and changes

| Finding | Evidence | Resolution / verification |
| --- | --- | --- |
| TikTok router interpreted physical `/api/view` as the website path and navigated to `/404?fromUrl=/api/view` | Earlier local inspection; final virtual path remained `/` | Scope-aware Acorn rewrite and guarded virtual Location reads. Local variables, custom objects, receiver-bound methods and direct writes are preserved. 23 regression checks. |
| Generic quoted-URL rewriting broke Webpack/CDN directory-plus-filename construction | Earlier directory 404 requests; dynamic loader fixture | Leave ordinary URL strings intact; proxy DOM resource URLs after concatenation. Keep the separately tested GeoFS-only compatibility path. |
| Dynamically loaded signed scripts failed native integrity checks after byte rewriting | TikTok SDK integrity failure in earlier local inspection | Preserve original integrity-protected script/style bytes; carry SRI metadata through static and dynamic URLs and validate upstream bytes server-side. Strongest supported hash wins. 14 digest/HTML checks plus Chromium loader verification. Oversize protected assets are not streamed unverified. |
| Page scripts wrote cookies on the proxy origin instead of into their upstream session | Controlled real-browser cookie fixture | Scoped Document.cookie bridge, per-session/origin expiring HMAC capability, validated cookie writes and fetch/async-XHR ordering. HttpOnly values are never exposed or overwritten. |
| Cookie deletion could retain an expired cookie as a session cookie | New zero-age regression failed before correction | Handle tough-cookie's negative-infinite expiry as expired; verify Max-Age=0 and 1970 expiry deletion. 32 scope/capability/HTTP checks including upstream cookie order and path boundary. |
| Twitch's required GraphQL client headers were dropped | Initial `gql.twitch.tv/gql` 400 responses; focused and final samples no longer captured those 400s | Forward `Client-ID`, `Client-Integrity` and `Client-Session-ID` only to `gql.twitch.tv`; do not forward Veyra capability headers. Seven checks. This is not a Twitch playback approval. |
| Veyra favicon fallback used inline onerror, blocked by its own CSP | Browser-console CSP warning | Delegated image error handler and a data attribute; no CSP weakening. Other unused/untested inline-handler surfaces are not claimed repaired. |
| Background engine failures restarted already-rendered proxy pages; disabled starts could recur | Earlier Spotify/probe samples with repeated 503s | Central advertised-capability gate for every engine start; retain a rendered proxy frame when a background engine fails. Source regression checks and zero captured engine-start failures in the final 26-site sample. |
| Internet Archive's open shadow roots were omitted by the QA text metric | Earlier blank classification vs open-shadow-root text in follow-up | Traverse bounded open shadow roots, excluding script/style payloads. Archive has readable sampled content; this is primarily a measurement correction, not proof every Archive feature works. |
| Error-screen and challenge classifiers overstated success or failed valid landing pages | TikTok error UI counted as text; Netflix reCAPTCHA footer misread as challenge | Separate provider-error outcome, constrain generic CAPTCHA matching, classify short “Unknown Error” responses and snapshot diagnostics before teardown. Eight classifier checks. |
| Native-browser handoff was not clear when TikTok's feed was rejected | Fast Proxy feed 403 vs native browser feed 200 and playing video | One bounded notice with “Open directly”, and capability-aware Chromium fallback when available. Real mouse click verified native `https://www.tiktok.com/`, with no `sid` or token in the destination. |

## TikTok: what works and what does not

Fast Proxy no longer sends the app router to the accidental `/404` path. However, the latest sample still shows TikTok's error screen, and signed `/api/recommend/item_list/` requests through the proxy returned 403. A 403 does not establish whether the cause is origin binding, token state, provider policy, hosting reputation or another check; no signing bypass or fabricated token was introduced.

A separate native Chromium context loaded the same public site. It observed two feed responses with status 200, one later feed 403, and an unpaused video with `readyState=4` and `currentTime=0.473858`. The native sample also recorded an SDK error, so even this is not an error-free-site approval. See [native comparison](native-tiktok-comparison.json).

The practical compatibility solution is **hybrid routing**: keep Fast Proxy for compatible pages, use a genuine browser context for incompatible origin-bound/signed workflows, and offer the user's normal browser when server Chromium is unavailable. The new notice was tested end to end; see [handoff test](handoff-test.json) and [handoff screenshot](tiktok-native-handoff.png). Server Chromium remains disabled in this local sample, and its TikTok playback has not been verified or enabled in production.

Signed assets remain byte-exact, so their internal native-origin assumptions are not automatically virtualized. TikTok still attempted a telemetry SDK URL on the loopback host, which the server failed safely instead of fetching a private host. That incompatibility remains open.

## Final public-site sample

| Site | Initial-content outcome | Qualification |
| --- | --- | --- |
| YouTube | Rendered | Search/sign-in/playback not approved; one resource 404 |
| TikTok | Provider error | Feed rejected through proxy; native handoff verified |
| Wikipedia | Rendered | Article text observed |
| GitHub | Rendered | Public landing page only |
| Reddit | HTTP failure | Upstream 403/network-security block |
| Google | Rendered | Landing page only; account authentication not exercised |
| MDN | Rendered | Public developer landing page |
| BBC | Rendered | Cross-origin Location exception; rejected script-cookie writes remain in diagnostics |
| Amazon | Rendered | Resource 400s; checkout/account not exercised |
| Instagram | Rendered | Login screen only, not authenticated content |
| Twitch | Rendered | GraphQL header defect corrected; no streaming approval |
| Discord | Rendered | Final sample captured an XHR responseText/JSON-response exception; attribution remains open |
| Stack Overflow | Verification screen | No challenge bypass attempted |
| Microsoft | Rendered | Resource 404s and undefined-object exceptions remain |
| Apple | Rendered | Public landing page only |
| Internet Archive | Rendered | Open-shadow-root content observed |
| Netflix | Rendered | Public landing page; footer reCAPTCHA notice is not a challenge. No DRM playback test |
| Spotify | Empty/visual-only | Blank sampled page remains unresolved |
| Roblox | Rendered | Public landing content; 401/telemetry failures, games not exercised |
| CNN | Provider error | Short “Unknown Error” response |
| eBay | HTTP failure | Upstream 403 and provider error screen |
| Pinterest | Rendered | Public landing page; resource 404 |
| Facebook | Rendered | Login screen only |
| LinkedIn | Rendered | Public landing/sign-in screen only |
| New York Times | HTTP failure | Upstream 403, no readable sampled text |
| Cloudflare | Rendered | Public company page, not a bypass of other sites' checks |

## Screenshot discipline

Screenshots represent meaningful visible failures or a verified behavior, not every navigation. [Final TikTok error](final/provider-error-ui-TikTok.png), [Reddit block](final/http-error-Reddit.png), [Stack Overflow verification](final/site-challenge-StackOverflow.png), [Spotify blank page](final/empty-or-visual-only-Spotify.png) and [TikTok native handoff](tiktok-native-handoff.png) are the principal evidence. Redundant earlier screenshots were removed; earlier JSON results retain investigation context. Invisible parser/cookie/security defects use executable tests rather than manufactured screenshots of code.

## Regression commands and coverage

```bash
# VeyraBrowser
npm ci
npm run check
npm run build
npm run test:live

# VeyraServer
npm ci
npm test
npm run test:proxy-browser   # requires installed Chromium
npm audit --omit=dev
```

The full server suite passed, including previous acquisition, SSRF, auth, YouTube, worker/module and casting regressions. Casting retained 53 behavioral checks plus 20 actual HTTP checks. The new Fast Proxy server tests cover 76 assertions; the separate Chromium runtime fixture covers 13 assertions, including JSON XHR, loader URL/SRI, fetch/XHR cookie ordering and abort. Browser checks/build passed, including seven compatibility/privacy and eight classification checks. The production-dependency audit reported zero vulnerabilities at test time.

Synchronous XHR cannot await the asynchronous cookie-write bridge. Dynamic import expressions, closed shadow roots, cookie/storage isolation for every browser API, service workers, cross-origin frame access and signed byte-exact assets retain limitations. Actual user accounts, native Chrome login transfer, third-party OAuth return authentication, physical multi-device casting and universal extension compatibility have not been approved by this test pass.

## Release

The paired changes update [browser PR #12](https://github.com/HomekidChud/VeyraBrowser/pull/12) and [server PR #13](https://github.com/HomekidChud/VeyraServer/pull/13), not main. Explicit approval is required before merging/deploying the coordinated release. Browser-native sign-in cookies are not transferred to Veyra; a future Veyra-account Google OAuth return must be a separate authorized, configured flow, not an assertion of third-party website authentication.
