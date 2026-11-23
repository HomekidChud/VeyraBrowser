import assert from "node:assert/strict";
import test from "node:test";
import { shareableHar } from "../web/src/diagnostics-export.js";

test("a shareable HAR drops paths and captured payloads even without recognizable secret labels", () => {
  const har = shareableHar("https://account:path-token@shop.example/path-token?text=path-token#path-token", [{
    url: "https://api.example/opaque/path-token?x=path-token",
    startedAt: 1000, method: "POST", status: 201, duration: 50, size: 1024, protocol: "path-token",
    requestHeaders: { "X-Unclassified": "path-token" }, responseHeaders: { "Set-Cookie": "path-token" },
    requestBody: "path-token", responseBody: "path-token", error: "path-token"
  }, { url: "data:text/plain,path-token" }], 1000);
  assert.equal(JSON.stringify(har).includes("path-token"), false);
  assert.equal(har.log.pages[0].title, "https://shop.example/");
  assert.equal(har.log.entries.length, 1);
  const [entry] = har.log.entries;
  assert.equal(entry.request.url, "https://api.example/");
  assert.equal(entry.request.method, "POST");
  assert.equal(entry.response.status, 201);
  assert.equal(entry.response.content.size, 1024);
  assert.equal(entry.timings.wait, 50);
});
