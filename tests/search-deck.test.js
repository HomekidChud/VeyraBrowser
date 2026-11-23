import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATEGORIES, isVertical, searchCategory, overviewSearchReady, searchEntry, isGoogleWebUrl, searchStateKey, readSearchState, searchParams, resultUrl, posterUrl, mergeResults, providerLabel, displayPrice, externalSearchLinks, scopedMediaHandoff } from "../web/src/search-deck.js";
import { blockPlaybackPopup, playbackPopupDecision, xhamsterPlaybackKey } from "../web/src/playback-popups.js";
import { querySuggestions, annotateResultBatch } from "../web/src/search-match.js";
import { publisherLaunch, publisherPage, publisherScope } from "../web/src/publisher-search.js";
import { siteScope } from "../web/src/search-site-scope.js";

test("site scope exposes the topic separately from its operators", () => {
  assert.equal(siteScope("site:example.com").text, "");
  assert.equal(siteScope('site:example.com "site:literal" -site:sub.example.com aurora').text, '"site:literal" aurora');
  assert.equal(siteScope("Why does the Moon have phases?").text, "Why does the Moon have phases?");
});
import { SEARCH_PRIVACY, searchPrivacy, masksSearchScope, allowsSearchResult } from "../web/src/search-privacy.js";

test("search privacy defaults safely and distinguishes scope, host, and result filtering", () => {
  assert.deepEqual(Object.keys(SEARCH_PRIVACY), ["filtered", "blocked", "restricted", "unfiltered"]);
  for (const input of [undefined, "unknown", ["unfiltered"], "__proto__"]) assert.equal(searchPrivacy(input), "filtered");
  const masked = (mode, raw) => {
    const { query } = searchEntry(raw);
    return masksSearchScope(mode, query, siteScope(query));
  };
  for (const mode of ["filtered", "blocked", "restricted"]) {
    assert.equal(masked(mode, "search:docs.xvideos.com"), true);
    assert.equal(masked(mode, "site:xvideos.com.lookalike.test"), false);
    assert.equal(masked(mode, "biology -site:xvideos.com"), false);
    assert.equal(allowsSearchResult(mode, { url: "https://clean.test", media: { thumbnail: "https://cdn.phncdn.com/fixture.jpg" } }), false);
    assert.equal(allowsSearchResult(mode, { url: "https://clean.test", nsfw: true }), false);
    assert.equal(allowsSearchResult(mode, { url: "https://nasa.gov" }), true);
  }
  assert.equal(masked("blocked", "(https://www.xvideos.com/fixture), clip"), true);
  assert.equal(masked("filtered", "(https://www.xvideos.com/fixture), clip"), false);
  assert.equal(masked("unfiltered", "search:xvideos.com"), false);
  assert.equal(allowsSearchResult("unfiltered", { url: "https://clean.test", nsfw: true }), true);
});

test("protected scope, verifier launch and result pages reject unexpected destinations", () => {
  assert.deepEqual(publisherScope("SEARCH: WWW.XVIDEOS.COM lunar atlas", "videos"),
    { domain: "xvideos.com", q: "search:xvideos.com lunar atlas" });
  for (const q of ["site:xvideos.com", "search:xvideos.com.evil.test", "search:xvideos.com -site:xvideos.com",
    "search:xvideos.com/path", `search:xvideos.com ${"x".repeat(241)}`]) assert.equal(publisherScope(q, "videos"), null);
  assert.equal(publisherScope("search:xvideos.com", "images"), null);
  const nonce = "a".repeat(43), verificationUrl = `https://verify.example.test/check?nonce=${nonce}`;
  assert.equal(publisherLaunch({ nonce, verificationUrl, expiresInSeconds: 600 }).url.origin, "https://verify.example.test");
  for (const url of [verificationUrl + "&unused=x", verificationUrl.replace("https:", "http:"), verificationUrl.replace(nonce, "wrong")])
    assert.equal(publisherLaunch({ nonce, verificationUrl: url, expiresInSeconds: 600 }), null);
  const row = { source: "xvideos.com", type: "videos", title: "Fixture", url: "https://www.xvideos.com/fixture", thumbnail: "https://untrusted.example/poster.jpg" };
  const data = { ok: true, domain: "xvideos.com", page: 0, total: 25, expiresInMs: 5000, nextPage: 1,
    results: [row, { ...row, title: "Spoofed", url: "https://www.xvideos.com.evil.test/fixture" }] };
  assert.deepEqual(publisherPage(data, "xvideos.com", 0), { rows: [{ title: row.title, url: row.url }], total: 25, ttl: 5000, next: 1 });
  assert.equal(publisherPage(data, "pornhub.com", 0), null);
  assert.equal(publisherPage({ ...data, expiresInMs: 0 }, "xvideos.com", 0), null);
});

test("scoped media fallback preserves the query without forcing Google settings", () => {
  const { query } = searchEntry('search:science.nasa.gov "solar winds" & filter=off');
  for (const [category, mode] of [["images", "2"], ["videos", "7"]]) {
    const url = new URL(scopedMediaHandoff(query, category).url);
    assert.equal(url.origin + url.pathname, "https://www.google.com/search");
    assert.deepEqual([...url.searchParams], [["q", 'site:science.nasa.gov "solar winds" & filter=off'], ["udm", mode]]);
  }
  for (const query of ["moon", "-site:nasa.gov moon", "site:localhost.local moon", "site:127.0.0.1 moon", "site:https://nasa.gov/path moon"]) {
    assert.equal(scopedMediaHandoff(query, "images"), null);
  }
  assert.equal(scopedMediaHandoff("site:nasa.gov moon", "web"), null);
});

test("full-query suggestions handle prefixes, trailing spaces and the old one-word API", () => {
  assert.deepEqual(querySuggestions(["moon", "NASA moon", "NASA mission", "<img>", "mo\non"], "NASA mo", 8), ["NASA moon"]);
  assert.deepEqual(querySuggestions(["NASA ", "NASA missions", "NASA moon", "moon"], "NASA ", 1), ["NASA missions"]);
  assert.deepEqual(querySuggestions(["café locations", "Cafe locations"], "  CAFÉ", 8), ["café locations"]);
});

test("badges are bounded and preserve server order, including fallback estimates", () => {
  const rows = [
    { title: " unrelated", url: "https://example.test/unrelated" },
    { title: "月面 地図", url: "https://example.test/maps" },
    { title: "Low authored title", url: "https://example.test/other", matchPercent: 100 },
    { title: "月面", url: "https://example.test/partial", matchPercent: 120 }
  ];
  const annotated = annotateResultBatch(rows, "site:example.test 月面 地図", "images");
  assert.deepEqual(annotated.map(row => row.url), rows.map(row => row.url));
  assert.equal(annotated[0].matchPercent, 1);
  assert.equal(annotated[2].matchPercent, 100);
  assert.ok(annotated[1].matchPercent > annotated[3].matchPercent);
  assert.ok(annotated.every(row => Number.isInteger(row.matchPercent) && row.matchPercent >= 1 && row.matchPercent <= 100));
  assert.equal(rows[3].matchPercent, 120);
  assert.deepEqual(mergeResults(annotated.slice(0, 2), annotated.slice(2)).map(row => row.url), rows.map(row => row.url));
});

test("category routing preserves the query and upgrades legacy history", () => {
  assert.equal(Object.keys(CATEGORIES).length, 8);
  assert.deepEqual(Object.keys(CATEGORIES).filter(isVertical), ["images", "videos", "news", "shopping", "research", "discussions"]);
  assert.equal(searchCategory("__proto__"), "web");
  assert.deepEqual(readSearchState(searchStateKey('Welsh "hills"?', "news")), { query: 'Welsh "hills"?', source: "news" });
  assert.deepEqual(readSearchState(`veyra:search-v2:${JSON.stringify(["日本語 site:example.com", "deep"])}`), { query: "日本語 site:example.com", source: "web" });
  assert.deepEqual(readSearchState("veyra:search:old history"), { query: "old history" });
  assert.equal(readSearchState("veyra:search-v2:invalid"), null);
});

test("signed-in overviews may discover evidence for empty Web and category searches", () => {
  const empty = { results: [] };
  for (const category of Object.keys(CATEGORIES).filter(category => category !== "index")) {
    assert.equal(overviewSearchReady(empty, category, true), true, category);
    assert.equal(overviewSearchReady(empty, category, false), false, category);
    assert.equal(overviewSearchReady(null, category, true), false, "wait for the primary search");
    assert.equal(overviewSearchReady({ ...empty, status: "filtered" }, category, true), false, "never bypass the search filter");
  }
  assert.equal(overviewSearchReady(empty, "index", true), false);
  assert.equal(overviewSearchReady({ results: [{ url: "https://example.com/" }] }, "index", false), true);
});

test("search commands distinguish a domain lookup, Google preference, and site scoping", () => {
  assert.deepEqual(searchEntry("search:google.com"), { command: true, query: "google.com", preferGoogle: false });
  assert.deepEqual(searchEntry("SEARCH: WWW.GOOGLE.COM 日本語 site:example.org"), { command: true, query: "日本語 site:example.org", preferGoogle: true });
  assert.deepEqual(searchEntry("site:google.com anything"), { command: false, query: "site:google.com anything", preferGoogle: false });
  assert.deepEqual(searchEntry("search:NASA.GOV"), { command: true, query: "site:nasa.gov", domain: "nasa.gov", preferGoogle: false });
  assert.deepEqual(searchEntry("search:nasa.gov aurora"), { command: true, query: "site:nasa.gov aurora", domain: "nasa.gov", preferGoogle: false });
  for (const input of ["search:127.0.0.1", "search:example.com@other.test", "search:example.com/path", "search:foo.local"]) {
    assert.equal(searchEntry(input).domain, undefined);
  }
  for (const url of ["https://google.com/", "https://www.google.co.in/search?q=arctic"]) assert.equal(isGoogleWebUrl(url), true);
  for (const url of ["https://google.com.evil.test/", "https://accounts.google.com/", "https://google.com:81/", "https://a@google.com/"]) assert.equal(isGoogleWebUrl(url), false);
});

test("pagination carries category adapter and does not repeat results", () => {
  assert.deepEqual(Object.fromEntries(searchParams("snow and ice", "images", "en", 2, "wikimedia")), { q: "snow and ice", type: "images", lang: "en", region: "IN", page: "2", provider: "wikimedia" });
  assert.deepEqual(Object.fromEntries(searchParams("snow", "all", "en")), { q: "snow", type: "all", lang: "en", region: "IN" });
  const first = { url: "https://example.com/article", title: "first" };
  const later = { url: "https://example.com/other", title: "next" };
  assert.deepEqual(mergeResults([first], [{ ...first, title: "duplicate" }, later]), [first, later]);
  const image = { ...first, imageUrl: "https://science.nasa.gov/example.jpg" };
  assert.deepEqual(mergeResults([image], [{ ...image, url: "https://example.com/another-source" }, later]), [image, later]);
  const canonical = { ...first, canonicalUrl: first.url, providers: ["bing"] };
  assert.deepEqual(mergeResults([canonical], [{ ...canonical, url: `${first.url}?utm_source=other` }]), [canonical]);
  assert.deepEqual(mergeResults([first], [{ url: `${first.url}?utm_source=other&fbclid=123#section` }]), [first]);
  const paper = { url: "https://doi.org/10.1234/paper", doi: "10.1234/paper" };
  assert.deepEqual(mergeResults([paper], [{ url: "https://europepmc.org/article/MED/1", doi: "10.1234/PAPER" }]), [paper]);
  const watch = { url: "https://www.youtube.com/watch?v=abcdefghijk&t=42" };
  const other = { url: "https://youtu.be/abcdefghijl" };
  const lookalike = { url: "https://youtube.com.example.org/watch?v=abcdefghijk" };
  assert.deepEqual(mergeResults([watch], [{ url: "https://m.youtube.com/shorts/abcdefghijk" },
    { url: "https://youtu.be/abcdefghijk" }, other, lookalike]), [watch, other, lookalike]);
});

test("result URLs, thumbnail allowlist, source labels, and optional prices", () => {
  assert.equal(resultUrl("javascript:alert(1)"), "");
  assert.equal(resultUrl("https://test:password@example.com/"), "");
  assert.equal(posterUrl("https://thumb.wikimedia.org/example.jpg"), "https://thumb.wikimedia.org/example.jpg");
  assert.equal(posterUrl("https://thumb.wikimedia.org.example.com/example.jpg"), "");
  assert.equal(posterUrl("http://thumb.wikimedia.org/example.jpg"), "");
  assert.equal(posterUrl("https://science.nasa.gov/example.jpg"), "https://science.nasa.gov/example.jpg");
  assert.equal(posterUrl("https://science.nasa.gov.example.com/example.jpg"), "");
  const openverseThumb = "https://api.openverse.org/v1/images/e211d652-746e-4c8a-b955-30d114360b8f/thumb/";
  assert.equal(posterUrl(openverseThumb), openverseThumb);
  assert.equal(posterUrl(`${openverseThumb}?full_size=true`), "");
  assert.equal(posterUrl("https://api.openverse.org/v1/images/"), "");
  const qtImage = "https://doc.qt.io/qtforpython-6/_images/coroutines.png";
  assert.equal(posterUrl(qtImage), qtImage);
  assert.equal(posterUrl(`${qtImage}?tracking=1`), "");
  assert.equal(posterUrl("https://doc.qt.io/qtforpython-6/_images/other.png"), "");
  for (const path of ["../web/index.html", "../web/browse/index.html"]) {
    const csp = readFileSync(new URL(path, import.meta.url), "utf8").match(/img-src ([^;]+)/)?.[1].split(/\s+/) || [];
    assert.ok(csp.includes(qtImage));
    assert.ok(!csp.includes("https://doc.qt.io"));
  }
  assert.equal(providerLabel("veyra-reference"), "Veyra reference catalog");
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
  assert.equal(providerLabel("verified-videos"), "Verified YouTube watch links");
  assert.equal(providerLabel("india-storefronts"), "Indian retailer listings");
  assert.equal(providerLabel("mdn"), "MDN Web Docs");
  assert.equal(providerLabel("searxng"), "SearXNG");
  assert.equal(providerLabel("nasa-library"), "NASA Image and Video Library");
  assert.equal(displayPrice(null), "");
  assert.equal(displayPrice({ value: "-1", currency: "INR" }), "");
  assert.equal(displayPrice({ value: "4.50", currency: "GBP" }), "");
  assert.equal(displayPrice({ value: "123456.70", currency: "INR" }), "₹1,23,456.70");
});

test("outside search links use consumer sites and carry the unmodified query as data", () => {
  const query = "यूएसबी & 65W";
  const links = externalSearchLinks(query, "shopping").map(({ url }) => new URL(url));
  assert.deepEqual(links.map(url => url.hostname), ["www.amazon.in", "www.flipkart.com"]);
  assert.equal(links[0].searchParams.get("k"), query);
  assert.equal(links[1].searchParams.get("q"), query);
  assert.equal(new URL(externalSearchLinks(query, "videos")[0].url).searchParams.get("search_query"), query);
  assert.deepEqual(externalSearchLinks(query, "index"), []);
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
