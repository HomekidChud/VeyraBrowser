import assert from "node:assert/strict";
import fs from "node:fs";
import { runInNewContext } from "node:vm";

const root = new URL("../", import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), "utf8");

const html = read("web/dev/platform/index.html");
const css = read("web/dev/platform/styles.css");
const app = read("web/dev/platform/app.js");
const serverUrl = "https://veyraserver-xscy.onrender.com";

const scriptVersion = html.match(/<script type="module" src="\.\/app\.js\?v=(\d+)">/)?.[1];
const styleVersion = html.match(/href="\.\/styles\.css\?v=(\d+)"/)?.[1];
assert.ok(scriptVersion && styleVersion);
assert.equal(scriptVersion, styleVersion, "the script and stylesheet versions stay in sync");

assert.ok(html.includes('meta name="veyra-api"'), "the portal declares its API origin like the other pages");
assert.ok(html.includes(serverUrl), "the default API origin matches the deployment");
assert.ok(html.includes('http-equiv="Content-Security-Policy"'), "the page ships a CSP like web/browse");
assert.ok(!/\son[a-z]+\s*=/i.test(html), "no inline event handlers in index.html");
assert.ok(!html.includes("extensions.js") && !html.includes("device-cast.js"), "the portal must not touch modules owned by other agents");

for (const token of ["--accent:#8fb0f0", "--bg:#0d0f13", "--font-mono:'JetBrains Mono'", "color-scheme: dark"]) {
  assert.ok(css.replace(/\s/g, "").includes(token.replace(/\s/g, "")), `styles.css keeps the app token ${token}`);
}

assert.ok(app.includes('localStorage.getItem("veyra-auth")'), "the portal reads the shared veyra-auth session");
assert.ok(app.includes('localStorage.setItem("veyra-auth", JSON.stringify({ token: r.token, user: r.user }))'), "login stores the same token shape as core.js setAuth");
assert.ok(app.includes('headers.set("Authorization", `Bearer ${authToken}`)'), "requests send the Bearer token like api() in core.js");
assert.ok(app.includes("/api/auth/login"), "the sign-in form posts to /api/auth/login");
assert.ok(app.includes("/api/auth/me"), "a stored session is validated against /api/auth/me");
assert.ok(app.includes("/api/auth/signup") && html.includes('id="authToggle"'), "the console offers first-time account signup");
assert.ok(app.includes("X-Veyra-Gate") && app.includes("AUTH_SIGNUP_KEY_REQUIRED"), "the console honors the gate and signup policy");

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

assert.ok(html.includes('id="secretOverlay"'), "the one-time secret modal exists in the page");
assert.ok(app.includes("showSecret(r.key"), "created key secrets go through the one-time modal");
assert.ok(app.includes("showSecret(r.key, \"Your replacement API key\")") || app.includes("showSecret(r.key,"), "rotated secrets go through the one-time modal");

assert.ok(app.includes("usage?.requests") && app.includes("usage?.last24h"), "the usage view renders per-key request counts");

for (const doc of [
  "POST /api/platform/workspaces",
  "POST /api/platform/workspaces/:id/keys",
  "authorization: Bearer $VYR_KEY",
  "PLATFORM_RATE_LIMITED",
  "BILLING_REQUIRED"
]) assert.ok(html.includes(doc), `the docs cover ${doc}`);

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
for (const lang of ["curl", "python", "node"]) assert.ok(new RegExp(`data-lang="${lang}"`).test(html), `the quickstart covers ${lang}`);
assert.match(html, /class="view active" id="view-guide"/, "the default view is the public fetch guide");
assert.match(html, /--json '\{"url":"https:\/\/example\.com\/","format":"text"\}'/);
assert.match(html, /iframe src="\/preview" sandbox title="Page preview"/);
assert.match(html, /sanitizeHtml\(page\.body/);
assert.match(html, /never receives your Veyra key/);

assert.ok(html.includes('id="secretEye"'), "the secret modal has an eye toggle");
assert.ok(html.includes('id="pgKeyEye"'), "the playground key field has an eye toggle");
assert.ok(app.includes("maskSecret("), "app.js masks the secret by default");
assert.ok(app.includes("copyText(currentSecret)"), "copy always uses the real secret, never the masked text");
assert.ok(app.includes('input.type = revealed ? "text" : "password"'), "the playground key field toggles between password and text");

assert.ok(app.includes("const V1_ENDPOINTS = ["), "app.js defines the playground endpoint catalog");
for (const path of ["/api/v1/status", "/api/v1/verify", "/api/v1/keys/:id", "/api/v1/usage/hours", "/api/v1/search", "/api/v1/suggest", "/api/v1/fetch"]) {
  assert.ok(app.includes(path), `the playground catalog covers ${path}`);
}
assert.ok(app.includes("function pgSend()"), "the playground can send real requests");
assert.ok(app.includes("function pgCode(lang)"), "the playground generates code samples");
assert.ok(html.includes('id="pgSend"'), "the playground has a send button");
assert.ok(html.includes('id="pgCopyCode"'), "generated code has a copy button");
{
  const code = app.slice(app.indexOf("function pgCode(lang)"), app.indexOf("function pgRenderCode()"));
  const key = "vyr_live_fixture_should_not_be_printed";
  for (const lang of ["node", "python", "curl"]) {
    const render = auth => runInNewContext(`${code}\npgCode(lang)`, {
      lang,
      pgBuildRequest: () => ({ ep: { auth, method: "GET" }, url: "https://example.test/api/v1/status", body: null }),
      $: id => id === "pgKey" ? { value: key } : null,
      document: { getElementById: id => id === "pgKey" ? { value: key } : null }
    });
    const authed = render("key");
    assert.match(authed, /VYR_KEY/, `${lang} refers to the environment variable`);
    assert.ok(!authed.includes(key), `${lang} never embeds the pasted key`);
    assert.doesNotMatch(render("public"), /VYR_KEY|Authorization/, `${lang} omits auth in a public example`);
  }
}

assert.ok(html.includes('id="usageChartWrap"'), "the usage view has an hourly chart");
assert.ok(app.includes("renderUsageChart(keys)"), "the usage chart renders from per-key byHour buckets");

assert.ok(app.includes("wireCodeTabs()"), "code tab switching is wired for all groups");

{
  const bootCalls = [...app.matchAll(/(^|\n)\s*boot\(\);/g)].map(m => m.index);
  const catalogAt = app.indexOf("const V1_ENDPOINTS");
  assert.ok(bootCalls.length === 1, "boot() is invoked exactly once");
  assert.ok(catalogAt >= 0, "the V1_ENDPOINTS catalog exists");
  assert.ok(bootCalls[0] > catalogAt, "boot() runs after the V1_ENDPOINTS declaration (no temporal dead zone)");
}

console.log("Developer platform portal tests passed");
