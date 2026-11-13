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
assert.ok(html.includes('<script type="module" src="./app.js?v=1">'), "index.html loads app.js as a versioned module");
assert.ok(html.includes('href="./styles.css?v=1"'), "index.html loads styles.css with a versioned query");
assert.ok(!/[?&]v=2/.test(html), "the script and stylesheet versions stay in sync");

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

// --- API docs document workspaces, keys and the public API with curl examples ---
for (const doc of [
  "POST $API/api/platform/workspaces",
  "POST $API/api/platform/workspaces/$WS_ID/keys",
  "GET /api/v1/me",
  "GET /api/v1/usage",
  "authorization: Bearer $VYR_KEY",
  "PLATFORM_RATE_LIMITED",
  "BILLING_REQUIRED"
]) assert.ok(html.includes(doc), `the docs cover ${doc}`);

console.log("Developer platform portal tests passed");
