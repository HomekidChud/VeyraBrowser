import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const script = read("web/src/admin-entry.js");
const pagesFallback = read("404.html").match(/<script>([\s\S]*?)<\/script>/)[1];
function follow(code, href) {
  let destination;
  const url = new URL(href);
  runInNewContext(code, {
    URL, location: {
      href: url.href, search: url.search, hash: url.hash,
      replace: value => { assert.equal(destination, undefined); destination = new URL(value, href); }
    }
  });
  assert.equal(destination.origin, url.origin);
  return destination;
}

for (const prefix of ["/VeyraBrowser/web", "/web", ""]) {
  for (const suffix of ["/admin", "/admin/", "/admin/index.html"]) {
    const target = follow(script, `https://example.test${prefix}${suffix}?view=compact&veyra_route=dev#details`);
    assert.equal(target.pathname, `${prefix}/`);
    assert.equal(target.searchParams.get("veyra_route"), "admin");
    assert.equal(target.searchParams.get("view"), "compact");
    assert.equal(target.hash, "#details");
  }
}
for (const suffix of ["/admin", "/admin/", "/admin/logs/", "/settings", "/settings/appearance", "/settings/appearance/"]) {
  const target = follow(pagesFallback, `https://example.test/VeyraBrowser/web${suffix}?view=compact#details`);
  assert.equal(target.pathname, "/VeyraBrowser/web/");
  assert.equal(target.searchParams.get("veyra_route"), suffix.replace(/^\/|\/$/g, ""));
  assert.equal(target.searchParams.get("view"), "compact");
  assert.equal(target.hash, "#details");
}
assert.equal(follow(pagesFallback, "https://example.test/VeyraBrowser/unknown").pathname, "/VeyraBrowser/web/");
for (const shell of ["web/index.html", "web/browse/index.html"]) {
  assert.match(read(shell), /id="view-admin"[\s\S]*?id="adminPanel"/);
}
console.log("Admin entry and Pages fallback routes for admin and settings passed");
