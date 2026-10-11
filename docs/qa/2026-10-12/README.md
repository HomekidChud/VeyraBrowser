# Veyra Browser: October maintenance QA

This is a bounded continuation of the previous AI's regression work, not a claim to have found every bug since the first release. Changes are prepared on review branches in VeyraBrowser and VeyraServer; neither backup repository nor VeyraOS was cloned or edited. Production deployment is a separate step.

## Scope and evidence

- **Browser baseline:** `dfb7a2161a2fa093617ebf1a2cd58a8116d0d617`; maintenance client build `8.28.28-browser-qa`.
- **Server baseline:** `b523a8fd28ad6a1fac37acb56fb3bc2fe2cf1efd`.
- **Live method:** Chromium, 1440 × 900, one isolated Veyra session per site, sequential navigation through the actual “Open in Veyra” control, console/pageerror and failed-request collection, and bounded waits for the requested document and readable content.
- **Privacy:** report URL queries and common secrets are redacted. The Reddit screenshot is cropped to remove the challenge-token address bar. Review free-form console messages before sharing any future exports.
- **Screenshot policy:** one representative image per distinct live failure class, plus three focused verification images. Screenshots do not accompany every page, click or navigation. Source-only defects use behavioral regression evidence instead of misleading screenshots of code.

The service-worker console warning caused by deliberately blocking workers in the automation context is test-environment noise, not an application defect. Early local attempts using an unsupported CSP port or the repository-root 404 page were discarded; the local verification used the supported loopback API port, 10000, and the web app entry point.

## Live major-site results

“Content rendered” means readable initial page content was observed, not that sign-in, media playback, checkout, chat, DRM, every resource or every interaction was verified. The production baseline had **11 readable pages, two site challenges, two blank/visual-only pages, and one navigation timeout** across 16 sites.

| Site | Production baseline | Patch-local follow-up |
| --- | --- | --- |
| YouTube | Content rendered | Existing YouTube route/direct-asset regression suites retained; live playback not signed off |
| TikTok | Blank page; syntax error observed | Still blank; final sample had no captured pageerror. Not fixed end to end |
| Wikipedia | Content rendered | Not re-run live after patch |
| GitHub | Navigation timed out | Content rendered in the local follow-up; different hosting conditions prevent a fair speed comparison |
| Reddit | Network-security challenge | External site policy/challenge, not bypassed |
| Google | Content rendered | Authentication not exercised |
| MDN | Content rendered | Not re-run live after patch |
| BBC | Content rendered | Not re-run live after patch |
| Amazon | Content rendered | No sign-in, purchase or checkout attempted |
| Instagram | Content rendered | No account sign-in attempted |
| Twitch | Content rendered | Playback not signed off |
| Discord | Content rendered | No signed-in chat or voice call attempted |
| Stack Overflow | Site challenge | External site policy/challenge, not bypassed |
| Microsoft | Content rendered | No account sign-in attempted |
| Apple | Content rendered | Not re-run live after patch |
| Internet Archive | Blank page | Duplicate custom-element exceptions disappeared in the later sample, but readable content still did not render |

Machine-readable evidence is in [production-results.json](production-results.json), [patch-follow-up-results.json](patch-follow-up-results.json) and [final-problem-site-results.json](final-problem-site-results.json). Latencies are observations from different environments, not a performance benchmark.

## Defect ledger and changes

“Fixed” below means the source change passed the stated local regression check. A related site's blank page can still have additional causes; fixing one rewrite defect is not equivalent to fixing TikTok as a whole.

| ID | Finding | Change / status | Evidence |
| --- | --- | --- | --- |
| JS-01 | Service-worker registration rewriting inserted assignment statements inside expressions, breaking valid JavaScript | Removed the text substitution; the existing injected runtime already enforces worker policy | Server `script-expression.test.js`: seven expression/string samples compile and remain intact |
| JS-02 | Regex import rewriting missed compact `import{x}from"..."` syntax and could rewrite code-looking strings | Replaced import matching with `es-module-lexer/js`; preserve comments, strings and bare import-map aliases | Server `module-identity.test.js` |
| JS-03 | The same ES module acquired different proxy URLs depending on its importing parent, allowing duplicate evaluation and element registration | Stable per-session module URLs; modulepreload and module script URLs use the same identity | Nine module syntax/identity checks; Internet Archive follow-up still blank |
| BR-01 | Messages were sent to the future API origin while a newly created frame was still `about:blank` | Wait for a usable frame origin; return a clear loading error to DevTools instead of a browser-origin exception | Local DevTools smoke flow; no pageerrors in that flow |
| DT-01 | HAR exports retained cookies, authorization/session headers, URL queries, request bodies and response content | Privacy-preserving HAR transformation and dedicated tests | Browser `diagnostics-export.test.js`; actual HAR download exercised |
| DT-02 | There was no downloadable, redacted console diagnostic bundle | Added “Download diagnostics” with explicit metadata and a privacy warning | Actual `1 + 1` execution and download; [DevTools verification](screenshots/devtools-verified.png) |
| EX-01 | Lowercasing complete extension patterns changed case-sensitive path permissions | Lowercase hostnames only; preserve paths and query casing | Eight pattern behavior checks |
| EX-02 | Exact-host permissions silently included a `www.` subdomain | Exact hosts now remain exact; `*.` wildcard permits explicit subdomains | Browser `extension-patterns.test.js` |
| EX-03 | Userscript exclusion rules were discarded | Preserve `@exclude` and `@exclude-match`; reject unsupported regex URL rules | Matching/exclusion behavior checks and source validation |
| EX-04 | Merging multiple Chrome/Edge content-script groups broadened where every script could run; unsupported exclusions/frame rules were ignored | Reject packages whose permission semantics cannot be safely preserved, rather than pretending they are supported | Existing extension checks retained; explicit import validation |
| EX-05 | Imported manifest CSS bypassed validation, and one malformed saved extension could abort the application batch | Validate manifest CSS and script size; skip invalid extensions individually with a warning | Extension checks; local package import and enable/disable cycle; [extension verification](screenshots/extensions-verified.png) |
| SW-01 | Offline navigation fallback used a Promise as a truthy response; cache-first misses could resolve to `undefined` | Await the cached fallback and return `Response.error()` for misses | Source validation; offline browser/network chaos testing remains a follow-up |
| CAST-01 | Manual code-only HTTP pairing could not find a session without its ID | Find the live session by pairing code when ID is omitted | Real HTTP integration test and browser receiver pairing |
| CAST-02 | HTTP device messages were queued back to the sender, while frame posts bypassed the actual relay/state accounting | Authenticated device-push route dispatches validated frames and messages to the receiver | Casting HTTP and transport tests |
| CAST-03 | WS/HTTP mixed transports missed paired, command and disconnect messages | Session methods share the same transport router | Browser-WS/device-HTTP and browser-HTTP/device-WS behavior checks |
| CAST-04 | Replacing sockets/devices left stale mappings, and an old socket's close handler could corrupt the replacement | Identity-checked close handlers and centralized detachment/cleanup | Casting transport checks |
| CAST-05 | Repeated start/stop actions corrupted active-stream counters | Idempotent transitions and frame/stop accounting | Casting transport checks |
| CAST-06 | Slow polling receivers accumulated obsolete frames; payloads and session counts were insufficiently bounded | Keep the newest queued frame; 400 KB image data limit, 512 KB WS payload limit, receiver backpressure check and default 64-session cap | Casting transport/payload/capacity checks |
| CAST-07 | Public session enumeration and unauthenticated ID-based polling/push/close routes exposed casting control | Separate cryptographic browser/device capabilities; no public ID/code listing; legacy push route returns 410 | 20 real HTTP authorization, routing and isolation checks |
| CAST-08 | Account authorization headers overwrote explicit cast capabilities for signed-in users | Preserve explicitly supplied `Authorization`; account bearer remains the default | Three API header behavior checks |
| CAST-09 | Screen sharing stopped locally without informing the receiver | Send/handle `stream_ended`, returning the receiver to paired state | Backend stop-state handling; physical track-ended callback not exercised |
| CAST-10 | Cast WebSocket server could reject upgrades belonging to other socket services | Explicit `/ws/cast` no-server upgrade routing, with listener cleanup | Non-cast socket handoff behavior checks |
| CAST-11 | A graceful server close or expired polling capability left a stale pairing code on screen | Clear cast state and require a fresh pairing code | Source checks; real browser pairing/start/stop flow |
| CAST-12 | HTTP join discarded connection metadata and treated 0% signal as 100% | Preserve connection type and zero signal, clamp input to 0–100 | Transport checks and simulated receiver showing Wi-Fi / 75% |
| CAST-13 | Server responses advertised an external QR service URL containing pairing credentials | Stop advertising that URL; the existing browser QR encoder remains local | HTTP response privacy checks |
| MAINT-01 | Dynamic unversioned imports created separate `core.js` instances; release assertions hardcoded a historical build | Normalize core imports, align cache-busting and SW version, and derive release checks from boot metadata | Browser build/check suites |

## Verified controls and tests

- **Regression suites:** browser `npm run check` and `npm run build` pass. Server `npm test` passes, including the earlier authentication, proxy, acquisition, Google transport, YouTube, crawler, search, source-view, HTTP reader and network suites.
- **New casting coverage:** 53 transport/capacity/lifecycle behavior checks plus 20 real HTTP authorization/routing/isolation checks. Two simultaneous receiver sessions remain isolated; tokens for one cannot poll the other.
- **New source/privacy coverage:** seven JavaScript expression samples, nine module checks, eight extension pattern checks, eight diagnostics privacy checks and three API header behavior checks.
- **Actual DevTools controls:** Elements tree inspection, Console execution through the page bridge (`1 + 1` returns `2`), console diagnostics download, Network panel and HAR download.
- **Actual extension controls:** local CSS package upload, installed package rendering, disable and re-enable. This is not a full Chrome-extension compatibility claim.
- **Actual cast receiver:** local browser receiver paired to an explicitly labelled simulated QA phone; authenticated image frame ingestion, Start/Stop mirroring and Disconnect. The [receiver screenshot](screenshots/casting-verified.png) is simulation evidence, not a physical phone, TV or Chromecast test.
- **Dependency audit:** production dependency audit reported no known vulnerabilities in either repository at the time of testing. This is not a comprehensive security audit.

## Selected visual evidence

- [TikTok blank-page defect](screenshots/tiktok-blank.png)
- [Reddit network-policy challenge](screenshots/reddit-challenge-cropped.png)
- [GitHub navigation timeout](screenshots/github-timeout.png)
- [DevTools command and diagnostics control](screenshots/devtools-verified.png)
- [Installed extension and permission controls](screenshots/extensions-verified.png)
- [Simulated casting receiver](screenshots/casting-verified.png)

## Fast Proxy and authentication

The concrete proxy improvements in this patch are syntax-safe registration handling and consistent ES-module identity. A bounded HTTP proxy is not equivalent to Chromium: challenges, dynamically computed module imports, site storage assumptions, account cookies, WebSockets, DRM and media can still require a real browser context.

Do not enable or increase Chromium capacity blindly. The server's existing documentation makes Chromium opt-in using `VEYRA_CHROMIUM_ENABLED`; evaluate it with the actual deployment memory/CPU limits and a bounded session budget. The next useful test is a controlled browser-engine comparison for TikTok and Internet Archive, not more regex substitutions or an automatic claim that all blank pages are solved.

For **Veyra account sign-in**, the proposed secure flow is: open the authorization page in a normal top-level/system browser; use a registered Google OAuth client and HTTPS callback; validate a short-lived, single-use state value and PKCE; exchange the authorization code on VeyraServer; issue Veyra's own authenticated session; return to the allowlisted Veyra URL without exposing Google tokens. This flow is **not implemented or enabled** in this patch, because a registered OAuth client/callback and deployment configuration were not supplied or verified.

Google forbids authorization in developer-controlled embedded user agents and requires compliant, authorized HTTPS redirect origins; its [OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies) also require secure token handling. Cookies are host/domain-scoped, as described by [MDN's cookie guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies), so logging into Google in Chrome must not be misrepresented as transferring that browser's third-party cookies to an unrelated Fast Proxy session. A top-level web link also cannot reliably force a particular browser application such as Chrome on every device.

## Remaining work and release gate

- **Production:** changes are on review branches, not yet deployed. Release the browser and server as a coordinated update; an old frontend cannot use the new capability-protected casting routes.
- **Still unresolved:** TikTok and Internet Archive readable rendering; third-party account login; live YouTube/Twitch media playback; physical screen capture, iOS/Android permission behavior, TV discovery/Chromecast/AirPlay and multi-device hardware interoperability.
- **Multiple devices:** isolated simultaneous server sessions were tested. A receiver currently mirrors one paired device at a time; a same-window multi-stream device dashboard was not built.
- **Extensions/inspector:** safer matching/imports and export tooling shipped in the patch. A complete Chrome extension engine, arbitrary privileged APIs, iframe/shadow-DOM inspection expansion and a native-CDP-equivalent debugger were not built.
- **Security hardening:** capability authorization is a substantial improvement, not a full threat model. Deployment-specific pairing-attempt rate limits, WSS origin policy, device ownership/account binding and load testing should be reviewed before wider exposure.
- **Offline/mobile:** the service-worker fix is source-reviewed, not a full offline browser test. Dedicated mobile, accessibility, viewport and network-chaos passes remain necessary.

## Repeatable commands

```sh
# Browser regression
npm ci
npm run check
npm run build

# Public, read-only live site smoke pass
npx playwright install chromium
npm run test:live

# Supported loopback API target for local browser testing
# http://127.0.0.1:3000/web/?veyra_api=http%3A%2F%2F127.0.0.1%3A10000

# Server, from the VeyraServer checkout
npm ci
npm test
npm run test:cast
```

`VEYRA_QA_URL` changes the test target, `VEYRA_QA_OUTPUT` changes the artifact directory, and `VEYRA_QA_CHROMIUM` can select an existing Chromium executable. The harness collects evidence without purchases, account sign-ins, posting messages or attempting to bypass site challenges.
