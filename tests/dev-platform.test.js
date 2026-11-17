import assert from "node:assert/strict";
import fs from "node:fs";

// Static checks for the developer platform portal (web/dev/platform/):
// wiring, cache-busted imports, the auth pattern shared with web/src/core.js,
// and the documented API surface. Plain node, no dependencies.
const root = new URL("../", import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), "utf8");

const html = read("web/dev/platform/index.html");
const css = read("web/dev/platform/styles.css");
const app = read("web/dev/platform/app.js");
const serverUrl = "https://veyraserver-xscy.onrender.com";

// --- the portal ships all three files with versioned (cache-bust) references ---
assert.ok(html.includes('<script type="module" src="./app.js?v=2">'), "index.html loads app.js as a versioned module");
assert.ok(html.includes('href="./styles.css?v=2"'), "index.html loads styles.css with a versioned query");
assert.ok(!/[?&]v=3/.test(html), "the script and stylesheet versions stay in sync");

// --- same conventions as the rest of the static site ---
assert.ok(html.includes('meta name="veyra-api"'), "the portal declares its API origin like the other pages");
assert.ok(html.includes(serverUrl), "the default API origin matches the deployment");
assert.ok(html.includes('http-equiv="Content-Security-Policy"'), "the page ships a CSP like web/browse");
assert.ok(!/\son[a-z]+\s*=/i.test(html), "no inline event handlers in index.html");
assert.ok(!html.includes("extensions.js") && !html.includes("device-cast.js"), "the portal must not touch modules owned by other agents");

// --- styles match the main app's dark theme tokens (web/styles/style.css) ---
for (const token of ["--accent:#8fb0f0", "--bg:#0d0f13", "--font-mono:'JetBrains Mono'", "color-scheme: dark"]) {
  assert.ok(css.replace(/\s/g, "").includes(token.replace(/\s/g, "")), `styles.css keeps the app token ${token}`);
}

// --- sign-in reuses the Veyra account session (core.js auth pattern) ---
assert.ok(app.includes('localStorage.getItem("veyra-auth")'), "the portal reads the shared veyra-auth session");
assert.ok(app.includes('localStorage.setItem("veyra-auth", JSON.stringify({ token: r.token, user: r.user }))'), "login stores the same token shape as core.js setAuth");
assert.ok(app.includes('headers.set("Authorization", `Bearer ${authToken}`)'), "requests send the Bearer token like api() in core.js");
assert.ok(app.includes("/api/auth/login"), "the sign-in form posts to /api/auth/login");
assert.ok(app.includes("/api/auth/me"), "a stored session is validated against /api/auth/me");

// --- the portal covers the full management surface ---
for (const path of [
  "/api/platform/overview",
  "/api/platform/workspaces",
  "/api/platform/billing/setup",
  "/api/platform/workspaces/${w.id}/keys",
  "/api/platform/workspaces/${w.id}/keys/${k.id}",
  "/api/platform/workspaces/${w.id}/keys/${keyId}/rotate",
  "/api/platform/waitlist",
  "/api/platform/waitlist/status"
]) assert.ok(app.includes(path), `app.js wires ${path}`);

// --- the secret is displayed exactly once via the modal ---
assert.ok(html.includes('id="secretOverlay"'), "the one-time secret modal exists in the page");
assert.ok(app.includes("showSecret(r.key"), "created key secrets go through the one-time modal");
assert.ok(app.includes("showSecret(r.key, \"Your replacement API key\")") || app.includes("showSecret(r.key,"), "rotated secrets go through the one-time modal");

// --- usage dashboard reads per-key counters from the overview ---
assert.ok(app.includes("usage?.requests") && app.includes("usage?.last24h"), "the usage view renders per-key request counts");

// --- the API reference documents workspaces, keys and the full public API ---
for (const doc of [
  "POST $API/api/platform/workspaces",
  "POST $API/api/platform/workspaces/$WS_ID/keys",
  "authorization: Bearer $VYR_KEY",
  "PLATFORM_RATE_LIMITED",
  "BILLING_REQUIRED"
]) assert.ok(html.includes(doc), `the docs cover ${doc}`);
// Every /api/v1 endpoint is documented in the reference with method badges.
for (const ep of [
  ["/api/v1/status", "GET"],
  ["/api/v1/verify", "GET"],
  ["/api/v1/me", "GET"],
  ["/api/v1/keys", "GET"],
  ["/api/v1/keys/:id", "GET"],
  ["/api/v1/usage", "GET"],
  ["/api/v1/usage/hours", "GET"],
  ["/api/v1/search", "GET"],
  ["/api/v1/suggest", "GET"],
  ["/api/v1/fetch", "POST"]
]) assert.ok(html.includes(`<span class="method ${ep[1].toLowerCase()}">${ep[1]}</span><code>${ep[0]}</code>`), `the reference documents ${ep[1]} ${ep[0]}`);
assert.ok(html.includes('id="referenceFilter"'), "the reference has an endpoint filter");
assert.ok(html.includes("data-code-tabs=\"quickstart\""), "the quickstart has language tabs");
for (const lang of ["curl", "js", "python", "node"]) assert.ok(new RegExp(`data-lang="${lang}"`).test(html), `the quickstart covers ${lang}`);

// --- eye mode: the secret modal masks the key until the eye reveals it ---
assert.ok(html.includes('id="secretEye"'), "the secret modal has an eye toggle");
assert.ok(html.includes('id="pgKeyEye"'), "the playground key field has an eye toggle");
assert.ok(app.includes("maskSecret("), "app.js masks the secret by default");
assert.ok(app.includes("copyText(currentSecret)"), "copy always uses the real secret, never the masked text");
assert.ok(app.includes('input.type = revealed ? "text" : "password"'), "the playground key field toggles between password and text");

// --- playground: endpoint picker, live request sender, code generator ---
assert.ok(app.includes("const V1_ENDPOINTS = ["), "app.js defines the playground endpoint catalog");
for (const path of ["/api/v1/status", "/api/v1/verify", "/api/v1/keys/:id", "/api/v1/usage/hours", "/api/v1/search", "/api/v1/suggest", "/api/v1/fetch"]) {
  assert.ok(app.includes(path), `the playground catalog covers ${path}`);
}
assert.ok(app.includes("function pgSend()"), "the playground can send real requests");
assert.ok(app.includes("function pgCode(lang)"), "the playground generates code samples");
assert.ok(html.includes('id="pgSend"'), "the playground has a send button");
assert.ok(html.includes('id="pgCopyCode"'), "generated code has a copy button");
assert.ok(app.includes('vyr_live_…"; // never print a real key into samples') || app.includes("never print a real key into samples"), "generated samples never embed the pasted key");

// --- usage chart ---
assert.ok(html.includes('id="usageChartWrap"'), "the usage view has an hourly chart");
assert.ok(app.includes("renderUsageChart(keys)"), "the usage chart renders from per-key byHour buckets");

// --- code tabs work for both quickstart and playground groups ---
assert.ok(app.includes("wireCodeTabs()"), "code tab switching is wired for all groups");

// --- boot ordering: boot() wires the playground/reference UI, which reads the
// V1_ENDPOINTS catalog; calling it before that const is evaluated throws a
// temporal-dead-zone ReferenceError and leaves the portal stuck on
// "Loading…" for every signed-in visitor. The boot call must come AFTER the
// catalog declaration (positionally) in the module.
{
  const bootCalls = [...app.matchAll(/(^|\n)\s*boot\(\);/g)].map(m => m.index);
  const catalogAt = app.indexOf("const V1_ENDPOINTS");
  assert.ok(bootCalls.length === 1, "boot() is invoked exactly once");
  assert.ok(catalogAt >= 0, "the V1_ENDPOINTS catalog exists");
  assert.ok(bootCalls[0] > catalogAt, "boot() runs after the V1_ENDPOINTS declaration (no temporal dead zone)");
}

console.log("Developer platform portal tests passed");
