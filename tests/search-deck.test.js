import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, isVertical, searchCategory, searchStateKey, readSearchState, searchParams, resultUrl, posterUrl, mergeResults, providerLabel, displayPrice } from "../web/src/search-deck.js";

test("category routing preserves the query and upgrades legacy history", () => {
  assert.equal(Object.keys(CATEGORIES).length, 8);
  assert.deepEqual(Object.keys(CATEGORIES).filter(isVertical), ["images", "videos", "news", "shopping", "research", "discussions"]);
  assert.equal(searchCategory("__proto__"), "web");
  assert.deepEqual(readSearchState(searchStateKey('Welsh "hills"?', "news")), { query: 'Welsh "hills"?', source: "news" });
  assert.deepEqual(readSearchState("veyra:search:old history"), { query: "old history" });
  assert.equal(readSearchState("veyra:search-v2:invalid"), null);
});

test("pagination carries category adapter and does not repeat results", () => {
  assert.deepEqual(Object.fromEntries(searchParams("snow and ice", "images", "en", 2, "wikimedia")), { q: "snow and ice", type: "images", lang: "en", page: "2", provider: "wikimedia" });
  assert.deepEqual(Object.fromEntries(searchParams("snow", "all", "en")), { q: "snow", type: "all", lang: "en" });
  const first = { url: "https://example.com/article", title: "first" };
  const later = { url: "https://example.com/other", title: "next" };
  assert.deepEqual(mergeResults([first], [{ ...first, title: "duplicate" }, later]), [first, later]);
});

test("result URLs, thumbnail allowlist, source labels, and optional prices", () => {
  assert.equal(resultUrl("javascript:alert(1)"), "");
  assert.equal(resultUrl("https://test:password@example.com/"), "");
  assert.equal(posterUrl("https://thumb.wikimedia.org/example.jpg"), "https://thumb.wikimedia.org/example.jpg");
  assert.equal(posterUrl("https://thumb.wikimedia.org.example.com/example.jpg"), "");
  assert.equal(posterUrl("http://thumb.wikimedia.org/example.jpg"), "");
  assert.equal(providerLabel("peertube"), "PeerTube via Sepia Search");
  assert.equal(displayPrice(null), "");
  assert.equal(displayPrice({ value: "-1", currency: "GBP" }), "");
  assert.equal(displayPrice({ value: "4.50", currency: "GBP" }), new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(4.5));
});
