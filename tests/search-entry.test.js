import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createApiReadiness, recoverableApiError } from "../web/src/api-readiness.js";

function redirect(entry, href) {
  const html = readFileSync(new URL(`../${entry}`, import.meta.url), "utf8");
  const [, script] = html.match(/<script>([\s\S]*?)<\/script>/);
  let destination;
  const url = new URL(href);
  runInNewContext(script, { URL, location: {
    href, pathname: url.pathname, search: url.search, hash: url.hash,
    replace(value) { assert.equal(destination, undefined); destination = new URL(value, url); }
  } });
  return destination;
}

test("branch-based Pages has a single publisher and the project root hands off to web/", () => {
  const workflows = new URL("../.github/workflows/", import.meta.url);
  for (const name of readdirSync(workflows).filter(name => /\.ya?ml$/.test(name))) {
    const yaml = readFileSync(new URL(name, workflows), "utf8");
    assert.doesNotMatch(yaml, /actions\/(?:upload-pages-artifact|deploy-pages)@/,
      `${name} must not publish an Actions artifact in addition to the main branch`);
  }
  const start = redirect("index.html", "https://pages.example/VeyraBrowser/?q=moon&type=images#results");
  assert.equal(start.href, "https://pages.example/VeyraBrowser/web/?q=moon&type=images#results");
  for (const [file, bootstrap] of [["web/index.html", "./src/bootstrap.js"], ["web/browse/index.html", "../src/bootstrap.js"]]) {
    const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(html.includes(`src="${bootstrap}?`), `${file} loads its app entry within web/`);
  }
});

test("legacy Pages and Android/static search entries preserve query, category, and fragment", () => {
  const suffix = "?q=moon%20%26%20stars&type=images#results";
  for (const route of ["/VeyraBrowser/search", "/VeyraBrowser/web/search", "/VeyraBrowser/web/search/"]) {
    const target = redirect("404.html", `https://pages.example${route}${suffix}`);
    assert.equal(target.pathname, "/VeyraBrowser/web/");
    assert.equal(target.searchParams.get("veyra_route"), "search");
    assert.equal(target.searchParams.get("q"), "moon & stars");
    assert.equal(target.searchParams.get("type"), "images");
    assert.equal(target.hash, "#results");
  }
  for (const base of ["/", "/VeyraBrowser/web/"]) {
    const target = redirect("web/search/index.html", `https://localhost${base}search/${suffix}`);
    assert.equal(target.origin, "https://localhost");
    assert.equal(target.pathname, base);
    assert.equal(target.searchParams.get("veyra_route"), "search");
    assert.equal(target.searchParams.get("q"), "moon & stars");
    assert.equal(target.hash, "#results");
  }
  assert.equal(redirect("404.html", "https://pages.example/VeyraBrowser/bad/nested/path").pathname, "/VeyraBrowser/web/");
  assert.equal(redirect("404.html", "https://pages.example/VeyraBrowser/web/"), undefined, "missing shell cannot cause a redirect loop");
});

test("a cached host page, malformed JSON and unsuccessful health never count as ready", async () => {
  const responses = [
    new Response("Starting Veyra", { headers: { "content-type": "text/html" } }),
    new Response('{"ok":true}', { status: 503, headers: { "content-type": "application/json" } }),
    new Response("{", { headers: { "content-type": "application/json" } }),
    new Response('{"ok":false}', { headers: { "content-type": "application/json" } }),
    new Response('{"ok":true}', { headers: { "content-type": "application/json; charset=utf-8" } })
  ];
  const readiness = createApiReadiness(async () => responses.shift(), { intervalMs: 0 });
  const first = readiness();
  assert.equal(readiness(), first, "simultaneous callers share the probe");
  assert.equal(await first, true);
  assert.equal(responses.length, 0);
});

test("an expired readiness check does not prevent a later reconnect, and access policy is not retried", async () => {
  let ready = false;
  const readiness = createApiReadiness(async () => new Response(JSON.stringify({ ok: ready }), {
    headers: { "content-type": "application/json" }
  }), { waitMs: 5, attemptMs: 2, intervalMs: 1 });
  assert.equal(await readiness(), false);
  ready = true;
  assert.equal(await readiness(), true);
  assert.equal(recoverableApiError({ status: 503 }), true);
  assert.equal(recoverableApiError({ code: "API_INVALID_RESPONSE" }), true);
  assert.equal(recoverableApiError({ status: 403, code: "GATE_REQUIRED" }), false);
  assert.equal(recoverableApiError({ status: 429 }), false);
  assert.equal(recoverableApiError({ code: "API_CANCELLED" }), false);
});
