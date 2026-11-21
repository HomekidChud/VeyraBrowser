import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATEGORIES, isVertical, searchCategory, searchStateKey, readSearchState, searchParams, resultUrl, posterUrl, mergeResults, providerLabel, deepSourceLabel, displayPrice } from "../web/src/search-deck.js";
import { blockPlaybackPopup, playbackPopupDecision, xhamsterPlaybackKey } from "../web/src/playback-popups.js";

test("category routing preserves the query and upgrades legacy history", () => {
  assert.equal(Object.keys(CATEGORIES).length, 9);
  assert.deepEqual(Object.keys(CATEGORIES).filter(isVertical), ["images", "videos", "news", "shopping", "research", "discussions"]);
  assert.equal(searchCategory("__proto__"), "web");
  assert.deepEqual(readSearchState(searchStateKey('Welsh "hills"?', "news")), { query: 'Welsh "hills"?', source: "news" });
  assert.deepEqual(readSearchState(searchStateKey("日本語 site:example.com", "deep")), { query: "日本語 site:example.com", source: "deep" });
  assert.deepEqual(readSearchState("veyra:search:old history"), { query: "old history" });
  assert.equal(readSearchState("veyra:search-v2:invalid"), null);
});

test("pagination carries category adapter and does not repeat results", () => {
  assert.deepEqual(Object.fromEntries(searchParams("snow and ice", "images", "en", 2, "wikimedia")), { q: "snow and ice", type: "images", lang: "en", page: "2", provider: "wikimedia" });
  assert.deepEqual(Object.fromEntries(searchParams("snow", "all", "en")), { q: "snow", type: "all", lang: "en" });
  const first = { url: "https://example.com/article", title: "first" };
  const later = { url: "https://example.com/other", title: "next" };
  assert.deepEqual(mergeResults([first], [{ ...first, title: "duplicate" }, later]), [first, later]);
  const image = { ...first, imageUrl: "https://science.nasa.gov/example.jpg" };
  assert.deepEqual(mergeResults([image], [{ ...image, url: "https://example.com/another-source" }, later]), [image, later]);
  const deep = { ...first, canonicalUrl: first.url, providers: ["bing"] };
  assert.deepEqual(mergeResults([deep], [{ ...deep, url: `${first.url}?utm_source=other`, providers: ["veyra-index", "bing"] }]),
    [{ ...deep, providers: ["bing", "veyra-index"] }]);
  assert.equal(deepSourceLabel("veyra-index"), "Veyra index");
  assert.equal(deepSourceLabel("__proto__"), "");
});

test("result URLs, thumbnail allowlist, source labels, and optional prices", () => {
  assert.equal(resultUrl("javascript:alert(1)"), "");
  assert.equal(resultUrl("https://test:password@example.com/"), "");
  assert.equal(posterUrl("https://thumb.wikimedia.org/example.jpg"), "https://thumb.wikimedia.org/example.jpg");
  assert.equal(posterUrl("https://thumb.wikimedia.org.example.com/example.jpg"), "");
  assert.equal(posterUrl("http://thumb.wikimedia.org/example.jpg"), "");
  assert.equal(posterUrl("https://science.nasa.gov/example.jpg"), "https://science.nasa.gov/example.jpg");
  assert.equal(posterUrl("https://science.nasa.gov.example.com/example.jpg"), "");
  for (const host of ["assets.science.nasa.gov", "media.esa.int"]) {
    const image = `https://${host}/photo.jpg`;
    assert.equal(posterUrl(image), image);
    assert.equal(posterUrl(`https://${host}.example.com/photo.jpg`), "");
    for (const path of ["../web/index.html", "../web/browse/index.html"]) {
      const csp = readFileSync(new URL(path, import.meta.url), "utf8").match(/img-src ([^;]+)/)?.[1].split(/\s+/) || [];
      assert.ok(csp.includes(`https://${host}`), `${path} permits the exact image host`);
    }
  }
  assert.equal(providerLabel("peertube"), "PeerTube via Sepia Search");
  assert.equal(displayPrice(null), "");
  assert.equal(displayPrice({ value: "-1", currency: "GBP" }), "");
  assert.equal(displayPrice({ value: "4.50", currency: "GBP" }), new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(4.5));
});

test("watch pages reject duplicate and unsolicited popups without blocking explicit links", () => {
  const watch = "https://www.xhamster.com/videos/fixture-xhA123";
  assert.equal(blockPlaybackPopup(watch, `${watch}?utm_source=popup#player`), true);
  assert.equal(blockPlaybackPopup(watch, "https://m.xhamster.com/videos/new-slug-xha123/"), true);
  assert.equal(blockPlaybackPopup(watch, "https://example.com/offer"), true);
  assert.equal(blockPlaybackPopup(watch, "https://example.com/details", true), false);
  assert.equal(blockPlaybackPopup(watch, "/videos/another-xhB456", true), false);
  assert.equal(blockPlaybackPopup(watch, watch, true), true);
  assert.equal(blockPlaybackPopup("https://example.com/videos/fixture", "https://example.com/details"), false);
  assert.equal(blockPlaybackPopup("https://xhamster.com.example.org/videos/fixture", "https://example.com/details"), false);
});

test("the same embed and watch video share an ID and only the embed may open the watch page in place", () => {
  const embed = "https://xhamster.com/embed/xhA123?ref=fixture";
  const watch = "https://www.xhamster.com/videos/test-player-xha123";
  const redirect = "https://adc3.lol/videos/test-player-xhA123?prs=fixture&target=https://example.com/#track";
  assert.deepEqual(playbackPopupDecision(embed, redirect, true), {
    action: "watch-in-place", key: xhamsterPlaybackKey(embed), url: "https://xhamster.com/videos/test-player-xhA123"
  });
  assert.deepEqual(playbackPopupDecision(embed, watch), {
    action: "watch-in-place", key: xhamsterPlaybackKey(embed), url: watch
  });
  assert.equal(xhamsterPlaybackKey(embed), xhamsterPlaybackKey(watch));
  assert.equal(blockPlaybackPopup(embed, watch, true), true, "the watch destination is never a popup");
  for (const [from, to] of [[embed, embed], [watch, embed], [watch, redirect], [embed, "https://example.com/unsolicited"]]) {
    assert.equal(playbackPopupDecision(from, to).action, "block");
  }
  for (const url of ["https://adc3.lol/videos/another-xhB456", "https://adc3.lol.example.com/videos/test-player-xhA123",
    "https://adc3.lol:444/videos/test-player-xhA123", "https://www.xhamster.com/videos/another-xhB456",
    "https://example.com/details"]) assert.equal(playbackPopupDecision(embed, url, true).action, "allow");
  for (const source of ["https://xhamster.com.example.com/embed/xhA123", "https://xhamster.com/embed/not-a-video",
    "https://xhamster.com/embed/xhA123/extra"]) assert.equal(playbackPopupDecision(source, watch).action, "allow");
});
