// With VeyraServer and its node_modules in a sibling directory:
// node tests/search-routing.browser.js [server-checkout] [chromium,firefox,webkit]
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(resolve(process.argv[2] || "../VeyraServer", "package.json"));
const playwright = require("playwright");
const express = require("express");
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const web = fileURLToPath(new URL("../web/", import.meta.url));
const prefix = "/VeyraBrowser/web";
const api = express();
const calls = [];
const fixtureUser = { id: "fixture", email: "fixture@example.test" };
const blankSite = "https://example.test/blank";
const shortLink = "https://vm.tiktok.com/ZXy42/";
const qtDiagram = "https://doc.qt.io/qtforpython-6/_images/coroutines.png";
const qtSource = "https://doc.qt.io/qtforpython-6/PySide6/QtAsyncio/index.html";
let vpnMode = "off";
let sessionsAvailable = true;
let publisherMode = "off", publisherVerified = false, publisherPosterRequests = 0;
const publisherNonce = "a".repeat(43);
const verifierOrigin = "https://verify.example.test";
const publisherPath = "/api/search/publisher";
api.use((req, res, next) => {
  res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,x-veyra-request-id,authorization,x-veyra-gate" });
  if (req.method === "OPTIONS") return res.sendStatus(204);
  res.locals.call = { path: req.path, query: { ...req.query } };
  calls.push(res.locals.call);
  next();
});
api.get("/api/gate/status", (_req, res) => res.json({ ok: true, gated: false }));
api.get("/api/auth/me", (_req, res) => res.json({ ok: true, user: fixtureUser }));
api.post("/api/auth/login", (_req, res) => res.json({ ok: true, token: "preview-test-token", user: fixtureUser }));
api.post("/api/auth/logout", (_req, res) => res.json({ ok: true }));
api.get(`${publisherPath}/status`, (req, res) => {
  assert.equal(req.headers.authorization, "Bearer preview-test-token");
  assert.equal(req.query.privacy, "restricted");
  assert.equal(Object.keys(req.query).length, 2);
  res.status(publisherMode === "off" ? 404 : 200).json({ ok: publisherMode !== "off" });
});
api.post(`${publisherPath}/challenge`, (req, res) => {
  assert.equal(req.query.privacy, "restricted");
  publisherVerified = false;
  res.json({ ok: true, nonce: publisherNonce, expiresInSeconds: 600, verificationUrl: `${verifierOrigin}/check?nonce=${publisherNonce}` });
});
api.post(`${publisherPath}/verify`, express.json(), (req, res) => {
  assert.equal(req.query.privacy, "restricted");
  assert.equal(req.headers.authorization, "Bearer preview-test-token");
  publisherVerified = req.body.assertion === "signed.fixture.accepted";
  res.status(publisherVerified ? 200 : 403).json({ ok: publisherVerified });
});
api.post(publisherPath, express.json(), (req, res) => {
  assert.equal(req.query.privacy, "restricted");
  assert.ok(publisherVerified, "search must wait for verified decision");
  assert.equal(req.body.nonce, publisherNonce);
  assert.equal(req.headers.authorization, "Bearer preview-test-token");
  const domain = /^search:(pornhub\.com|xvideos\.com)(?: |$)/.exec(req.body.q)?.[1];
  assert.ok(domain);
  const { page } = req.body;
  const results = Array.from({ length: page ? 1 : 24 }, (_item, i) => {
    const n = page * 24 + i + 1;
    return { title: `Publisher fixture ${n}`, source: domain, url: `https://www.${domain}/fixture-${n}`,
      type: "videos", thumbnail: "https://publisher-fixtures.example.test/poster.jpg" };
  });
  res.json({ ok: true, domain, page, total: 25, nextPage: page ? null : 1, expiresInMs: publisherMode === "expire" ? 1250 : 60_000, results });
});
api.get("/api/health", (_req, res) => {
  if (calls.filter(call => call.path === "/api/health").length === 1) return res.type("html").send("<h1>Starting</h1>");
  res.json({ ok: true });
});
api.post("/api/session", (_req, res) => sessionsAvailable
  ? res.json({ ok: true, sessionId: "browser_fixture_session", timeLimitMs: 300000, guest: true })
  : res.status(503).json({ error: "Fixture browsing session unavailable" }));
api.get("/api/vpn/session", (_req, res) => vpnMode === "unknown"
  ? res.status(503).json({ ok: false }) : res.json({ ok: true, connected: vpnMode === "on" }));
api.get("/api/view", (req, res) => {
  if (req.query.url === "https://google.com/") return res.type("html").send("<h1>Google homepage fixture</h1>");
  if (req.query.url === "https://www.google.com/search?q=clear") return res.type("html").send("<h1>Google results fixture</h1>");
  if (req.query.url === "https://www.google.com/search?q=northern+lights") return res.type("html").send(`
    <h1>Google is asking for a captcha</h1>
    <button onclick="parent.postMessage({type:'veyra:google-search-fallback',query:'northern lights',sessionId:'wrong_session'},'*')">Invalid session</button>
    <button onclick="parent.postMessage({type:'veyra:google-search-fallback',query:'northern lights',sessionId:'browser_fixture_session'},'*')">Search with Veyra</button>`);
  if (req.query.url === blankSite) return res.type("html").send(`<div id="app"></div><script>
    setTimeout(() => parent.postMessage({type:"veyra:browser-required",reason:"empty-spa-shell",pageUrl:${JSON.stringify(blankSite)},sessionId:"browser_fixture_session"},"*"),250);
  </script>`);
  return res.type("html").send("<h1>Fixture website</h1>");
});
api.get("/api/acquisition/status", (_req, res) => res.json({ ok: true, chromiumEnabled: false }));
api.post("/api/media/tiktok/share", express.json(), (req, res) => {
  assert.deepEqual(req.body, { url: shortLink });
  assert.equal(req.headers.authorization, undefined);
  res.json({ state: "resolved", url: "https://m.tiktok.com/@sample/video/6718335390845095173?tracking=fixture" });
});
api.post("/api/search/answer", express.json(), (req, res) => {
  assert.equal(req.headers.authorization, "Bearer preview-test-token");
  assert.equal(req.body.region, "IN");
  assert.equal(req.query.private, undefined);
  assert.equal(req.body.followUp, undefined);
  res.locals.call.body = req.body;
  const { query, source, vertical, results } = req.body;
  if (vertical) { assert.equal(vertical, source); assert.equal(results, undefined); }
  else assert.ok(Array.isArray(results) && results.every(row => Object.keys(row).join() === "url"));
  const sources = [
    { id: "S1", url: "https://example.test/fixture", title: "Research fixture", passages: [{ text: "A quoted source excerpt." }] },
    { id: "S2", url: "https://second.example/fixture", title: "Second fixture source" },
    { id: "S3", url: "https://third.example/fixture", title: "Third fixture source" }
  ];
  if (query === "no evidence") return res.json({ hasAnswer: false, reason: "No readable source evidence found" });
  if (query === "bad citation") return res.json({ hasAnswer: true, answer: "Unmapped citation fixture. [S1] [S9]", sources });
  if (query === "site:example.test scoped fixture") return res.json({ hasAnswer: true, answer: "Out of scope. [S1]",
    sources: [{ ...sources[0], canonicalUrl: "https://outside.example/redirect" }] });
  if (query === "retry overview" && calls.filter(call => call.body?.query === query).length === 1) {
    return res.json({ hasAnswer: false, diagnosticCode: "http_503" });
  }
  const reply = () => res.json({ hasAnswer: true,
    answer: query === "railway" ? `This is a cited ${source} overview. [S1]\n\nThis is a second cited paragraph. [S2] [S3]`
      : `Cited fixture for ${query}. [S1]`, sources, observationId: "obs_abcdefghijabcdefghij",
    relatedQuestions: query === "railway" ? [
      { question: "Where does the railway run?", answer: "The railway crosses the valley. [S2]" },
      { question: "Where can this unverified answer be seen?", answer: "Unsupported fixture. [S9]" }
    ] : [] });
  if (query === "slow overview" || query === "railway" && source === "news") return setTimeout(reply, 1200);
  return reply();
});
api.post("/api/search/answer/feedback", express.json(), (req, res) => {
  assert.deepEqual(req.body, { observationId: "obs_abcdefghijabcdefghij", rating: "helpful" });
  res.json({ ok: true });
});
api.get(["/api/search/web", "/api/search/vertical", "/api/search"], (req, res) => {
  if (req.query.q === "recover" && calls.filter(call => call.query.q === "recover" && call.path === "/api/search/web").length === 1)
    return res.type("html").send("<h1>Veyra server page</h1>");
  if (req.query.q === "denied") return res.status(403).json({ ok: false, code: "GATE_REQUIRED", error: "Access is required." });
  const type = req.query.type || (req.path === "/api/search" ? "index" : "web");
  if (/^search:(?:pornhub\.com|xvideos\.com)(?: |$)/.test(req.query.q)) {
    return res.json({ status: "empty", results: [], siteFilter: { active: true } });
  }
  if (req.query.q === "privacy fixture") {
    const clean = { title: "Ordinary privacy fixture", url: "https://example.test/ordinary" };
    const flagged = { title: "Labelled privacy fixture", url: "https://example.test/labelled", adult: true };
    const reply = () => res.json({ status: "ok", results: req.query.preview === "1"
      ? [{ ...flagged, thumbnail: "https://upload.wikimedia.org/fixture.jpg" }] : [clean, flagged] });
    if (req.query.privacy === "unfiltered") return setTimeout(reply, 450);
    return reply();
  }
  const next = Number(req.query.offset || req.query.page || 0);
  const paged = req.query.q === "India rail";
  if (req.query.q === "search:example.com lunar atlas") {
    return res.json(type === "web" ? { status: "ok", results: [
      { url: "https://example.com/lunar", title: "Lunar atlas fixture" }
    ] } : { status: "empty", results: [] });
  }
  if (req.query.q === "search:example.com lunar mission") {
    const video = { url: "https://example.com/lunar-video", title: "Lunar mission video fixture",
      thumbnail: "https://unapproved.example/poster.jpg" };
    return res.json(type === "images" ? { status: "empty", results: [] } : { status: "ok", results: [video] });
  }
  if (req.query.q === "search:nasa.gov") {
    const watch = { url: "https://www.nasa.gov/watch?id=42", title: "NASA watch fixture", thumbnail: "https://upload.wikimedia.org/fixture.jpg", duration: "2:15" };
    const image = { url: "https://upload.wikimedia.org/fixture.jpg", title: "NASA image fixture", sourcePageUrl: watch.url,
      thumbnail: "https://upload.wikimedia.org/fixture.jpg" };
    const offsite = { url: "https://nasa.gov.other.test/watch", title: "Offsite fixture", thumbnail: image.thumbnail };
    return res.json({ status: "ok", results: type === "images" ? [image, offsite] : type === "videos" ? [watch, offsite] :
      [{ title: "NASA watch page", url: `${watch.url}&utm_source=result` },
        { url: "https://nasa.gov/research", title: "NASA research page" },
        { url: "https://nasa.gov/direct", title: "NASA direct media page",
          media: { type: "videos", thumbnail: "https://imgs.search.brave.com/fixture.jpg", duration: "3:35" } }, offsite] });
  }
  if (req.query.preview === "1") {
    if (req.query.q === "slow preview") return setTimeout(() => res.json({ results: [{
      title: "Stale thumbnail", url: "https://example.test/stale", thumbnail: "https://upload.wikimedia.org/stale.jpg"
    }] }), 1200);
    if (!paged && req.query.q !== "site:example.in India rail") return res.json({ results: [], status: "empty" });
    return res.json({ results: [{ title: "Rail thumbnail", url: "https://example.test/image", sourcePageUrl: "https://example.test/rail-photo",
      thumbnail: "https://upload.wikimedia.org/fixture.jpg" }, { title: "Untrusted thumbnail", url: "https://example.test/not-shown",
      thumbnail: "https://untrusted.example/fixture.jpg" }] });
  }
  if (type === "web" && req.query.q === "search:google.com") {
    return res.json({ status: "ok", results: [{ title: "Google", url: "https://www.google.com/", source: "veyra-navigation" }] });
  }
  if (type === "web" && req.query.q === "search:google.com northern lights") {
    return res.json({ status: "ok", preferredEngine: "google", googleIncluded: false, results: [
      { title: "web result for northern lights", url: "https://example.test/aurora" }
    ] });
  }
  if (type === "images" && /^(?:site:doc\.qt\.io )?Python asyncio$/.test(req.query.q)) {
    return res.json({ provider: "reference-images", status: "ok", results: [{
      url: qtDiagram, imageUrl: qtDiagram, thumbnail: qtDiagram, sourcePageUrl: qtSource,
      title: "Python asyncio coroutine flow diagram", source: "The Qt Company", license: "GNU FDL 1.3"
    }] });
  }
  if (req.query.q === "dense photos" && type === "images") {
    const indices = Array.from({ length: next ? 25 : 24 }, (_, i) => i + (next ? 23 : 0));
    return res.json({ provider: "wikimedia", status: "ok", nextPage: next ? null : 1, results: indices.map(i => ({
      title: `Dense photos ${i}`, url: `https://commons.wikimedia.org/photo/${i}`,
      imageUrl: `https://upload.wikimedia.org/full-${i}.jpg`, thumbnail: `https://upload.wikimedia.org/preview-${i}.jpg`
    })) });
  }
  if (/missing listing/.test(req.query.q)) return res.json({ provider: "none", status: "empty", results: [] });
  if (req.query.q === "repeat fixture" && next === 20 &&
      calls.filter(call => call.query.q === "repeat fixture" && call.query.offset === "20").length === 1) {
    return res.json({ provider: "none", status: "unavailable", results: [] });
  }
  if (req.query.q === "repeat fixture") return res.json({ provider: "bing", nextOffset: next < 20 ? next + 10 : null,
    results: [{ title: next === 20 ? "New after repeat" : "First result", url: next === 20 ? "https://example.in/new" : `https://example.in/repeat?utm_source=${next}` }] });
  if (paged && type === "images" && req.query.provider === "wikimedia") {
    return res.json({ provider: "wikimedia", nextPage: null,
      results: [{ title: "Commons continuation", url: "https://example.in/commons" }] });
  }
  if (req.query.q === "scroll fixture") {
    if (!next) return res.json({ provider: "fixture", nextOffset: 10, results: Array.from({ length: 14 }, (_, i) => ({
      title: `Scroll result ${i + 1}`, url: `https://example.in/scroll/${i + 1}`, snippet: "This is a long results feed.",
      ...(i === 0 ? { displayUrl: `example.in/${"a".repeat(104)}` } : {})
    })) });
    if (next === 20 && calls.filter(call => call.query.q === "scroll fixture" && call.query.offset === "20").length === 1) {
      return res.status(503).json({ ok: false, error: "Provider temporarily unavailable." });
    }
    if (next === 10) return res.json({ provider: "fixture", nextOffset: 20, results: [
      { title: "Duplicate first result", url: "https://example.in/scroll/1?utm_campaign=test#section" },
      ...Array.from({ length: 14 }, (_, i) => ({ title: `Scroll result ${i + 15}`, url: `https://example.in/scroll/${i + 15}` }))
    ] });
    return res.json({ provider: "veyra-index", nextOffset: null, results: [{ title: "Final indexed result", url: "https://example.in/archive" }] });
  }
  const row = { title: `${type} result for ${req.query.q}`, url: "https://example.test/fixture", snippet: "Fixture snippet.",
    ...(type === "web" && paged ? { source: "mdn", providers: ["mdn", "bing"] } : {}),
    ...(type === "web" && (paged || req.query.incognito === "1") ? {
      snippet: "India rail publisher excerpt.",
      evidence: { level: "strong", basis: "catalog-passage" }
    } : {}) };
  const second = { title: `More ${type} results`, url: "https://example.in/more", snippet: "Another snippet.",
    ...(type === "web" && paged ? { evidence: { level: "unverified", basis: "not-checked" } } : {}) };
  const results = next ? [row, second] : type === "shopping" ? [
    { ...row, price: { value: "123456.00", currency: "INR" } },
    { ...second, price: { value: "19.99", currency: "USD" } }
  ] : paged && type === "images" ? [row, { ...second, title: "Second image", url: "https://example.in/gallery" }] : [row];
  if (type === "images") results[0].thumbnail = "https://upload.wikimedia.org/fixture.jpg";
  res.json({ ok: true, status: "ok", provider: "fixture", nextOffset: paged && type === "web" && !next ? 20 : null,
    nextPage: paged && type === "images" ? 1 : null,
    nextProvider: paged && type === "images" && next ? "wikimedia" : undefined, more: false, results });
});
api.use((_req, res) => res.json({ ok: true }));

const apiServer = api.listen(0, "127.0.0.1");
await once(apiServer, "listening");
const apiOrigin = `http://127.0.0.1:${apiServer.address().port}`;
const site = express();
site.get("/VeyraBrowser/", (_req, res) => res.type("html").send(read("index.html")));
for (const base of ["", prefix]) {
  site.get([`${base}/`, `${base}/browse/`], (req, res) => {
    res.type("html").send(read(req.path.endsWith("/browse/") ? "web/browse/index.html" : "web/index.html")
      .replaceAll("https://veyraserver-xscy.onrender.com", apiOrigin));
  });
}
site.use(prefix, express.static(web));
site.use("/VeyraBrowser", (_req, res) => res.status(404).type("html").send(read("404.html")));
site.use(express.static(web));
const siteServer = site.listen(0, "127.0.0.1");
await once(siteServer, "listening");
const origin = `http://127.0.0.1:${siteServer.address().port}`;

try {
  for (const engine of (process.argv[3] || "chromium,firefox,webkit").split(",")) {
    const browser = await playwright[engine].launch(engine === "chromium" ? {
      channel: "chromium", executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    } : {});
    try {
      calls.length = 0;
      const mobile = engine === "webkit" || process.env.VEYRA_TEST_MOBILE === "1";
      const context = await browser.newContext(mobile ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } : {});
      let tiktokRequests = 0, tiktokMode = "error";
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.hostname === "127.0.0.1") return route.continue();
        if (url.hostname === "publisher-fixtures.example.test") { publisherPosterRequests++; return route.abort(); }
        if (url.origin === verifierOrigin && url.pathname === "/check") {
          assert.equal(route.request().headers().referer, undefined);
          return route.fulfill({ contentType: "text/html", body: `<h1>Test-only verification bridge</h1>
            <button id="wrong">Send unrelated decision</button><button id="ok">Send approved fixture decision</button><button id="deny">Send denied fixture decision</button>
            <script>
            for (const [id, nonce, assertion] of ${JSON.stringify([
              ["wrong", "wrong-nonce", "signed.fixture.accepted"], ["ok", publisherNonce, "signed.fixture.accepted"],
              ["deny", publisherNonce, "signed.fixture.denied"]
            ])}) document.getElementById(id).onclick = () =>
              window.opener.postMessage({type:"veyra:publisher-age-decision",nonce,assertion}, ${JSON.stringify(origin)});
            </script>` });
        }
        if (url.href === qtDiagram || (url.hostname === "icons.duckduckgo.com" && url.pathname === "/ip3/example.in.ico") ||
            (url.hostname === "upload.wikimedia.org" && url.pathname !== "/preview-0.jpg")) {
          return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#6b7e91"/></svg>' });
        }
        if (url.hostname === "www.google.co.in") return route.fulfill({ contentType: "text/html", body: "<h1>External search fixture</h1>" });
        if (url.hostname === "www.amazon.in") return route.fulfill({ contentType: "text/html", body: "<h1>External retailer fixture</h1>" });
        if (url.href === shortLink) return route.fulfill({ contentType: "text/html", body: "<h1>Official share link fixture</h1>" });
        if (url.href === "https://www.tiktok.com/") return route.fulfill({ contentType: "text/html", body: "<h1>TikTok home fixture</h1>" });
        if (url.href === "https://www.tiktok.com/embed/@scout2015") {
          tiktokRequests++;
          return route.fulfill({ contentType: "text/html", body: "<h1>TikTok creator preview fixture</h1>" });
        }
        if (url.href === "https://www.tiktok.com/player/v1/6718335390845095173?autoplay=0") {
          tiktokRequests++;
          if (tiktokMode === "silent") return route.fulfill({ contentType: "text/html", body: `<h1>Silent player fixture</h1>
            <button onclick="parent.postMessage({'x-tiktok-player':true,type:'onStateChange',value:1},'*')">Play fixture</button>` });
          const event = tiktokMode === "error" ? { type: "onPlayerError", value: { errorCode: 1001 } }
            : { type: "onStateChange", value: 1 };
          return route.fulfill({ contentType: "text/html", body: `<h1>TikTok fixture</h1><script>
            parent.postMessage(${JSON.stringify({ ...event, "x-tiktok-player": true })}, "*");
          </script>` });
        }
        return route.abort();
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.stack || error.message));
      page.setDefaultTimeout(15_000);
      const result = title => page.locator("#searchResults").getByText(title, { exact: true });
      for (const path of [
        "/VeyraBrowser/search?q=moon&type=images",
        `${prefix}/search/?q=moon&type=images`,
        "/search/?q=moon&type=images"
      ]) {
        await page.goto(origin + path);
        await result("images result for moon").waitFor();
        await page.reload();
        await result("images result for moon").waitFor();
        assert.equal(new URL(page.url()).searchParams.get("type"), "images");
      }
      await page.getByRole("tab", { name: "Videos", exact: true }).click();
      await result("videos result for moon").waitFor();
      assert.equal(new URL(page.url()).searchParams.get("q"), "moon");
      assert.equal(new URL(page.url()).searchParams.get("type"), "videos");
      await page.reload();
      await result("videos result for moon").waitFor();
      await page.locator("#searchInput").fill("guest route");
      await page.locator("#searchInput").press("Enter");
      await result("videos result for guest route").waitFor();
      assert.equal(new URL(page.url()).search, "", "new guest queries stay out of the address");
      assert.equal(JSON.stringify(await page.evaluate(() => history.state)).includes("guest route"), false);
      await page.getByRole("tab", { name: "News", exact: true }).click();
      await result("news result for guest route").waitFor();
      await page.goBack();
      await result("videos result for guest route").waitFor();
      await page.goForward();
      await result("news result for guest route").waitFor();
      assert.equal(calls.filter(call => call.path === "/api/session").length, 0);
      assert.ok(calls.filter(call => call.path === "/api/search/vertical").every(call => call.query.private === "1"));

      await page.goto(`${origin}${prefix}/search/?q=India+rail&type=deep`);
      await result("web result for India rail").waitFor();
      await page.waitForFunction(() => document.querySelector("#searchImagePreview img")?.naturalWidth > 0);
      assert.equal(await page.getByRole("link", { name: "Rail thumbnail" }).getAttribute("href"), "https://example.test/rail-photo");
      assert.equal(await page.getByRole("link", { name: "Untrusted thumbnail" }).count(), 0);
      const evidence = page.locator(".search-evidence summary").getByText("Source evidence: Strong", { exact: true });
      await evidence.focus();
      await evidence.press("Enter");
      await page.locator(".search-evidence").filter({ hasText: "Source evidence: Strong" })
        .getByText(/This rating is not a fact-check or an accuracy percentage/).waitFor();
      await page.locator("#searchResults").getByText(/India rail publisher excerpt/).waitFor();
      assert(await page.locator(".search-evidence").first().evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      assert.match(await page.locator("#searchResults .r-url").first().textContent(), /MDN Web Docs/);
      assert.equal(new URL(page.url()).searchParams.has("type"), false);
      assert.equal(await page.locator("#searchTabs").getByRole("tab").count(), 8);
      assert.equal(await page.getByRole("tab", { name: "Web" }).getAttribute("aria-selected"), "true");
      assert.equal(await page.getByRole("button", { name: "Sign in to use Veyra AI" }).isVisible(), true);
      const [google] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "Open Google in a new tab outside Veyra" }).click()]);
      await google.waitForURL("https://www.google.co.in/search?**");
      assert.equal(new URL(google.url()).searchParams.get("gl"), "in");
      assert.equal(new URL(google.url()).searchParams.get("q"), "India rail");
      await google.close();
      // A short mobile viewport may load this page automatically when the
      // preceding evidence interaction scrolls the result deck.
      const moreResults = page.getByRole("button", { name: "More results" });
      if (await moreResults.isVisible()) {
        await moreResults.click({ timeout: 3000 }).catch(() => result("More web results").waitFor());
      }
      await result("More web results").waitFor();
      await page.getByText("Source evidence: Not checked", { exact: true }).waitFor();
      assert.equal(await page.getByText("Source evidence: Strong", { exact: true }).count(), 1);
      assert.equal(await result("web result for India rail").count(), 1);
      await page.locator('#searchResults .search-site-icon img[src*="example.in.ico"]').waitFor();
      assert.equal(await page.locator("#searchResults .search-site-icon").count(), 2);
      assert.equal(await page.locator("#searchResults .search-site-icon img").count(), 1);
      assert.ok(calls.some(call => call.path === "/api/search/web" && call.query.offset === "20" && call.query.region === "IN"));
      await page.getByRole("tab", { name: "Web" }).press("ArrowRight");
      await result("images result for India rail").waitFor();
      assert.equal(await page.locator(".search-evidence").count(), 0);
      await page.setViewportSize({ width: 375, height: 812 });
      assert.equal(await page.locator("#searchResults").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length), 2);
      assert.equal(await page.locator("#view-search").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      assert.equal(await page.locator("#searchTabs").evaluate(el => el.scrollWidth > el.clientWidth &&
        new Set([...el.children].map(child => Math.round(child.getBoundingClientRect().top))).size === 1), true);
      await page.locator("#searchTabs").hover();
      await page.mouse.wheel(260, 0);
      await page.waitForFunction(() => document.querySelector("#searchTabs").scrollLeft > 0);
      await page.getByRole("tab", { name: "Images" }).press("End");
      await result("index result for India rail").waitFor();
      assert.ok(await page.locator("#searchTabs").evaluate(el => el.scrollLeft > 0));
      await page.getByRole("tab", { name: "Veyra index" }).press("Home");
      await result("web result for India rail").waitFor();
      await page.getByRole("tab", { name: "Web" }).press("ArrowRight");
      await result("images result for India rail").waitFor();
      assert.equal(await page.locator("#searchOnGoogle").isVisible(), false);
      await page.getByRole("button", { name: "More results" }).click();
      await result("More images results").waitFor();
      assert.ok(calls.some(call => call.query.type === "images" && call.query.page === "1" && call.query.region === "IN"));
      await page.getByRole("button", { name: "More results" }).click();
      await result("Commons continuation").waitFor();
      assert.ok(calls.some(call => call.query.provider === "wikimedia" && call.query.page === "1" && call.query.region === "IN"));
      assert.equal(await result("More images results").count(), 1);
      for (const [label, type] of [["Videos", "videos"], ["News", "news"], ["Shopping", "shopping"], ["Research", "research"], ["Discussions", "discussions"], ["Veyra index", "index"]]) {
        await page.getByRole("tab", { name: label }).click();
        await result(`${type} result for India rail`).waitFor();
        assert.ok(calls.some(call => call.query.q === "India rail" && call.query.region === "IN"
          && (type === "index" ? call.path === "/api/search" : call.query.type === type)));
        if (type === "shopping") assert.deepEqual(await page.locator(".search-price").allTextContents(), ["₹1,23,456.00"]);
      }
      assert.ok(!calls.some(call => call.path === "/api/search/deep" || call.path === "/api/search/answer"));
      await page.getByRole("tab", { name: "Web" }).click();
      await result("web result for India rail").waitFor();
      await page.goto(`${origin}${prefix}/search/?q=scroll+fixture`);
      await result("Scroll result 14").waitFor();
      assert.equal(await page.locator("#view-search").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true,
        "long unbroken result URLs must not expand the mobile result column");
      const firstNode = await result("Scroll result 1").elementHandle();
      await firstNode.focus();
      assert.ok(!calls.some(call => call.query.q === "scroll fixture" && call.query.offset === "10"));
      await page.mouse.move(210, 570);
      await page.mouse.wheel(0, 5000);
      await result("Scroll result 28").waitFor();
      assert.equal(await firstNode.evaluate(el => el.isConnected), true, "appending must preserve existing result elements");
      assert.equal(await firstNode.evaluate(el => el === document.activeElement), true, "appending must preserve keyboard focus");
      assert.equal(await result("Duplicate first result").count(), 0);
      assert.ok(calls.some(call => call.query.q === "scroll fixture" && call.query.feed === "1" && call.query.offset === "10"));
      await page.mouse.wheel(0, 5000);
      await page.getByRole("button", { name: "Retry more results" }).waitFor();
      await page.getByRole("button", { name: "Retry more results" }).click();
      await result("Final indexed result").waitFor();
      await page.getByText("End of available results").waitFor();
      assert.equal(await page.getByRole("button", { name: "More results" }).count(), 0);
      await page.goto(`${origin}${prefix}/search/?q=repeat+fixture`);
      await result("First result").waitFor();
      await page.getByRole("button", { name: "More results" }).click();
      await page.getByRole("button", { name: "Retry more results" }).click();
      await result("New after repeat").waitFor();
      assert.equal(await result("First result").count(), 1);
      assert.deepEqual(calls.filter(call => call.query.q === "repeat fixture" && call.path === "/api/search/web").map(call => call.query.offset), ["0", "10", "20", "20"]);
      await page.goto(`${origin}${prefix}/search/?q=missing+listing&type=shopping`);
      await page.getByText("Search outside Veyra").waitFor();
      assert.equal(await page.locator("#searchResults article").count(), 0);
      const [retailer] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: "Search Amazon India" }).click()]);
      await retailer.waitForURL("https://www.amazon.in/s?**");
      assert.equal(new URL(retailer.url()).searchParams.get("k"), "missing listing");
      assert.equal(await retailer.evaluate(() => document.referrer), "");
      await retailer.close();
      await page.goto(`${origin}${prefix}/search/?q=site%3Aamazon.in+missing+listing&type=shopping`);
      await page.getByText("No results within the requested site scope").waitFor();
      assert.equal(await page.getByRole("link", { name: "Search Amazon India" }).count(), 0);
      if (!mobile) await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${origin}${prefix}/browse/`);
      await page.locator("#ntpInput").fill("recover");
      await page.locator("#ntpInput").press("Enter");
      await page.getByText("Waiting for the Veyra server…", { exact: true }).waitFor();
      await result("web result for recover").waitFor();
      assert.equal(calls.filter(call => call.path === "/api/health").length, 2);
      assert.equal(calls.filter(call => call.path === "/api/session").length, 0);

      await page.locator("#searchInput").fill("denied");
      await page.locator("#searchInput").press("Enter");
      await page.getByText("Access is required.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Try again" }).waitFor();
      assert.equal(calls.filter(call => call.path === "/api/health").length, 2, "policy errors don't start reconnect polling");
      await page.locator("#searchInput").fill("moon");
      await page.locator("#searchInput").press("Enter");
      const loaded = page.waitForResponse(response => response.url().startsWith(`${apiOrigin}/api/view?`));
      await result("web result for moon").click();
      assert.match(await (await loaded).text(), /Fixture website/);
      await page.locator("#frame-t1").waitFor();
      assert.equal(calls.filter(call => call.path === "/api/session").length, 1);
      await page.goBack();
      await result("web result for moon").waitFor();
      await page.goForward();
      await page.locator("#frame-t1").waitFor();
      await page.locator("#address").fill("veyra://settings");
      await page.locator("#address").press("Enter");
      await page.locator("#view-settings").waitFor();

      await page.goto(`${origin}${prefix}/search/?q=site%3Adoc.qt.io+Python+asyncio&type=images`);
      await result("Python asyncio coroutine flow diagram").waitFor();
      await page.waitForFunction(() => document.querySelector("#searchResults .search-card-art img")?.naturalWidth > 0);
      assert.equal(await page.getByRole("link", { name: /Source page for Python asyncio/ }).getAttribute("href"), qtSource);
      assert.equal(await result("GNU FDL 1.3").isVisible(), true);
      await page.goto(`${origin}${prefix}/search/?q=Python+asyncio&type=images&incognito=1`);
      await result("Python asyncio coroutine flow diagram").waitFor();
      assert.equal(await page.locator("#searchResults .search-card-art img").count(), 0);

      await page.goto(`${origin}${prefix}/search/?q=private%20moon&type=images&incognito=1`);
      await result("images result for private moon").waitFor();
      assert.equal(await page.locator("#aiAnswer").isVisible(), false);
      assert.equal(new URL(page.url()).searchParams.has("q"), false);
      assert.equal(new URL(page.url()).searchParams.get("incognito"), "1");
      assert.ok(calls.some(call => call.path === "/api/search/vertical" && call.query.q === "private moon" && call.query.private === "1"));
      assert.equal(await page.locator("#searchResults img").count(), 0);
      assert.equal(await page.locator("#searchOnGoogle").isVisible(), false);
      assert.equal(calls.filter(call => call.path === "/api/session").length, 1);
      await page.goto(`${origin}${prefix}/search/?q=private+web&incognito=1`);
      await result("web result for private web").waitFor();
      assert.equal(await page.locator("#searchImagePreview").isVisible(), false);
      assert.ok(!calls.some(call => call.query.q === "private web" && call.query.preview === "1"));
      assert.equal(await page.locator(".search-evidence").count(), 0, "incognito ignores any evidence metadata returned by the API");
      assert.ok(calls.some(call => call.path === "/api/search/web" && call.query.q === "private web" && call.query.incognito === "1" && call.query.private === "1"));
      assert.equal(await page.locator("#searchResults .search-site-icon img").count(), 0);
      assert.equal(await page.locator("#searchResults .search-site-icon").count(), 1);
      await page.goto(`${origin}${prefix}/search/?q=missing+listing&type=videos&incognito=1`);
      await page.getByText("No matching watch pages from Veyra’s sources.").waitFor();
      assert.equal(await page.getByRole("link", { name: "Search YouTube" }).count(), 0);

      const post = "https://www.tiktok.com/@scout2015/video/6718335390845095173";
      const openPost = async (url = post) => {
        await page.locator("#address").fill(url);
        await page.locator("#address").press("Enter");
      };
      const frame = page.frameLocator("#frame-t1");
      const proxyPage = frame.getByRole("heading", { name: "Fixture website" });
      const tiktokPage = frame.getByRole("heading", { name: "TikTok player" });
      await openPost(post.replace("https:", "http:"));
      await tiktokPage.waitFor();
      await frame.getByText("Direct TikTok access is unavailable in this session.").waitFor();
      assert.equal(await frame.getByRole("link", { name: "Open on TikTok" }).count(), 0);
      await frame.getByRole("button", { name: "Use Fast Proxy" }).click();
      await proxyPage.waitFor();
      assert.equal(tiktokRequests, 0, "incognito did not reach the official player");

      await page.goto(`${origin}${prefix}/browse/?incognito=0`);
      await openPost();
      await tiktokPage.waitFor();
      assert.equal(tiktokRequests, 0, "the panel is local until the user clicks");
      assert.equal(await frame.getByRole("link", { name: "Open on TikTok" }).getAttribute("href"), post);
      await frame.getByRole("button", { name: "Load TikTok player" }).click();
      await frame.getByRole("status").getByText("TikTok says this post isn’t available", { exact: false }).waitFor();
      assert.equal(tiktokRequests, 1);
      await frame.locator("#player iframe").evaluate(el => { el.ownerDocument.defaultView.previousPlayer = el.contentWindow; });
      tiktokMode = "playing";
      await frame.getByRole("button", { name: "Retry TikTok player" }).click();
      await frame.getByText("Playing in the TikTok player.").waitFor();
      assert.equal(await frame.locator("#playerStatus").evaluate(el => {
        const w = el.ownerDocument.defaultView;
        w.dispatchEvent(new w.MessageEvent("message", {
          source: w.previousPlayer, origin: "https://www.tiktok.com",
          data: { "x-tiktok-player": true, type: "onPlayerError", value: { errorCode: 1001 } }
        }));
        return el.textContent;
      }), "Playing in the TikTok player.");
      await frame.getByRole("button", { name: "Close TikTok player" }).click();
      assert.equal(await frame.locator("#player iframe").count(), 0);
      assert.equal(tiktokRequests, 2);
      assert.equal(await frame.getByRole("button", { name: "Load TikTok player" }).evaluate(el => el === el.ownerDocument.activeElement), true);
      await page.setViewportSize({ width: 375, height: 812 });
      tiktokMode = "silent";
      await frame.getByRole("button", { name: "Load TikTok player" }).click();
      await frame.frameLocator("#player iframe").getByRole("heading", { name: "Silent player fixture" }).waitFor();
      assert.equal(await frame.locator("body").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      await frame.getByText("TikTok didn’t send a status update.", { exact: false }).waitFor();
      assert.equal(await frame.getByRole("button", { name: "Retry TikTok player" }).isEnabled(), true);
      assert.equal(tiktokRequests, 3);
      await frame.frameLocator("#player iframe").getByRole("button", { name: "Play fixture" }).click();
      await frame.getByText("Playing in the TikTok player.").waitFor();
      await frame.getByRole("button", { name: "Use Fast Proxy" }).click();
      await proxyPage.waitFor();
      const proxyResponse = target => page.waitForResponse(res => res.url().startsWith(`${apiOrigin}/api/view?`) && new URL(res.url()).searchParams.get("url") === target);
      const [reloaded] = await Promise.all([proxyResponse(post), page.locator('#reloadBtn:not([data-loading="1"])').click()]);
      assert.equal(reloaded.status(), 200);
      await proxyPage.waitFor();
      for (const mode of ["on", "unknown", "off"]) {
        vpnMode = mode;
        await openPost();
        await tiktokPage.waitFor();
        if (mode === "off") await frame.getByRole("link", { name: "Open on TikTok" }).waitFor();
        else await frame.getByText("Direct TikTok access is unavailable in this session.").waitFor();
        assert.equal(tiktokRequests, 3);
      }
      await openPost("http://tiktok.com/");
      await frame.getByRole("heading", { name: "TikTok", exact: true }).waitFor();
      assert.equal(await page.locator("#address").inputValue(), "https://www.tiktok.com/");
      assert.equal(await frame.locator("#player iframe").count(), 0);
      assert.equal(await frame.getByRole("link", { name: "Open on TikTok" }).evaluate(el => {
        const proxy = el.ownerDocument.getElementById("tryProxy"), view = el.ownerDocument.defaultView;
        return el.nextElementSibling === proxy && view.getComputedStyle(el).backgroundColor !== view.getComputedStyle(proxy).backgroundColor;
      }), true, "the recommended action is primary and comes first in keyboard order");
      const [home] = await Promise.all([context.waitForEvent("page"), frame.getByRole("link", { name: "Open on TikTok" }).click()]);
      await home.getByRole("heading", { name: "TikTok home fixture" }).waitFor();
      assert.equal(await home.evaluate(() => document.referrer), "");
      await home.close();
      await openPost("https://www.tiktok.com/@scout2015");
      await frame.getByRole("heading", { name: "TikTok profile: @scout2015" }).waitFor();
      assert.equal(tiktokRequests, 3);
      await frame.getByRole("button", { name: "Load TikTok profile" }).click();
      await frame.frameLocator("#player iframe").getByRole("heading", { name: "TikTok creator preview fixture" }).waitFor();
      assert.equal(tiktokRequests, 4);
      await frame.getByRole("button", { name: "Close TikTok profile" }).click();
      assert.equal(await frame.locator("#player iframe").count(), 0);
      await openPost(`${shortLink}?ignored=yes`);
      await frame.getByRole("heading", { name: "TikTok share link" }).waitFor();
      assert.equal(await frame.getByRole("button", { name: "Load TikTok player" }).count(), 0);
      await page.locator("#siteChip").click();
      await page.locator("#popover").getByText("The TikTok panel is local.", { exact: false }).waitFor();
      await page.locator("#popover").getByRole("button", { name: "Site options" }).click();
      assert.equal(await page.getByRole("link", { name: "Open original site" }).getAttribute("href"), shortLink);
      await page.getByRole("button", { name: "Dismiss Site options: vm.tiktok.com" }).click();
      const [original] = await Promise.all([context.waitForEvent("page"), frame.getByRole("link", { name: "Open on TikTok" }).click()]);
      await original.getByRole("heading", { name: "Official share link fixture" }).waitFor();
      assert.equal(original.url(), shortLink);
      assert.equal(await original.evaluate(() => document.referrer), "");
      await original.close();
      await frame.getByRole("button", { name: "Use Fast Proxy" }).click();
      await proxyPage.waitFor();
      await page.locator("#siteChip").click();
      await page.locator("#popover").getByRole("button", { name: "Site options" }).click();
      await page.getByRole("button", { name: "Return to TikTok options" }).click();
      await frame.getByRole("heading", { name: "TikTok share link" }).waitFor();
      await frame.getByRole("button", { name: "Find public post" }).click();
      await frame.getByRole("button", { name: "Load TikTok player" }).waitFor();
      assert.equal(await frame.locator("#openOriginal").getAttribute("href"), "https://www.tiktok.com/@sample/video/6718335390845095173");
      await openPost(blankSite);
      const blankNotice = page.getByText("This page appears blank in Fast Proxy.", { exact: false });
      await blankNotice.waitFor();
      const [retry] = await Promise.all([
        proxyResponse(blankSite),
        page.getByRole("button", { name: "Retry in Veyra" }).click()
      ]);
      assert.equal(retry.status(), 200);
      await blankNotice.waitFor();
      await openPost("https://example.test/normal");
      await proxyPage.waitFor();
      await blankNotice.waitFor({ state: "hidden" });
      if (!mobile) await page.setViewportSize({ width: 1280, height: 900 });

      await page.goto(`${origin}${prefix}/search/?q=dense+photos&type=images`);
      await result("Dense photos 0").waitFor();
      const tiles = page.locator("#searchResults .search-card-images"), imageNodes = tiles.locator("img");
      assert.equal(await tiles.count(), 24);
      assert.equal(await imageNodes.count(), 24);
      await page.waitForFunction(() => document.querySelector('img[src$="/preview-0.jpg"]')?.hidden);
      assert.equal(await imageNodes.evaluateAll(images => images.every(img => img.loading === "lazy" && !img.hasAttribute("onerror"))), true);
      await page.locator("#view-search").evaluate(el => { el.scrollTop = el.scrollHeight; });
      await result("Dense photos 47").waitFor();
      assert.equal(await tiles.count(), 48, "pagination appends 24 unique image tiles");
      assert.equal(await result("Dense photos 23").count(), 1);

      await page.goto(`${origin}${prefix}/search/?q=railway&type=research`);
      await result("research result for railway").waitFor();
      const signInAI = page.getByRole("button", { name: "Sign in to use Veyra AI" });
      await signInAI.click();
      await page.getByRole("heading", { name: "Welcome back" }).waitFor();
      await page.keyboard.press("Escape");
      await page.locator("#authDialog").waitFor({ state: "hidden" });
      await result("research result for railway").waitFor();
      assert.ok(!calls.some(call => call.path === "/api/search/answer"));
      await signInAI.click();
      await page.locator('#authDialog input[name="email"]').fill(fixtureUser.email);
      await page.locator('#authDialog input[name="password"]').fill("fixture-only");
      await page.locator("#authSubmit").click();
      await page.locator("#authDialog").waitFor({ state: "hidden" });
      const overview = page.locator("#aiAnswer");
      const body = overview.locator(".ai-answer-body");
      await body.getByText(/^This is a cited research overview\./).waitFor();
      assert.equal(await overview.evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector("#searchResults")) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
      assert.equal(await page.locator("#view-search").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      assert.equal(await overview.locator("form,input,textarea,[data-ai-prompt]").count(), 0);
      assert.equal(await body.locator(":scope > p").count(), 2);
      assert.equal(await body.locator(".ai-source-cite").count(), 3);
      const related = overview.getByRole("region", { name: "Related questions" });
      const question = related.getByText("Where does the railway run?", { exact: true });
      await question.waitFor();
      assert.equal(await related.locator("details").count(), 1, "reject any unmapped citation in a related answer");
      assert.equal(await related.getByText("The railway crosses the valley.").isVisible(), false);
      await question.press("Enter");
      await related.getByRole("link", { name: "Source Second fixture source" }).waitFor();
      await overview.getByText("A quoted source excerpt.").waitFor();
      const sourcePanel = overview.getByRole("complementary", { name: "Sources" });
      const sourceBox = await sourcePanel.boundingBox(), answerBox = await body.boundingBox();
      assert.ok(mobile ? sourceBox.y >= answerBox.y + answerBox.height : sourceBox.x > answerBox.x + answerBox.width);
      await sourcePanel.getByText("Show 1 more source").click();
      await sourcePanel.getByRole("link", { name: /Third fixture source/ }).waitFor();
      await overview.getByRole("button", { name: "Helpful", exact: true }).click();
      await overview.getByText("Feedback saved.").waitFor();
      assert.equal(calls.filter(call => call.path === "/api/search/answer" && call.body?.source === "research").length, 1);
      const input = page.locator("#searchInput");
      const submit = async q => { await input.fill(q); await input.press("Enter"); };
      const isAnswer = (request, query, source) => new URL(request.url()).pathname === "/api/search/answer"
        && request.postDataJSON()?.query === query && request.postDataJSON()?.source === source;
      const slow = page.waitForRequest(req => isAnswer(req, "slow overview", "research"));
      await submit("slow overview");
      assert.equal(new URL(page.url()).searchParams.get("q"), "slow overview");
      assert.equal(new URL(page.url()).searchParams.get("type"), "research");
      await slow;
      await overview.getByText("Checking sources for an answer…").waitFor();
      await result("research result for slow overview").waitFor();
      const cancelledQuery = page.waitForEvent("requestfailed", req => isAnswer(req, "slow overview", "research"));
      await submit("no evidence");
      await cancelledQuery;
      await overview.getByText("Veyra couldn’t verify an answer from the available sources.").waitFor();
      assert.equal(await body.count(), 0);
      await result("research result for no evidence").waitFor();
      await submit("bad citation");
      await result("research result for bad citation").waitFor();
      await overview.getByText("Veyra couldn’t verify an answer from the available sources.").waitFor();
      assert.equal(await body.count(), 0);
      await submit("site:example.test scoped fixture");
      await result("research result for site:example.test scoped fixture").waitFor();
      await overview.getByText("Veyra couldn’t verify an answer from the available sources.").waitFor();
      assert.equal(await body.count(), 0);
      await submit("retry overview");
      const retryOverview = overview.getByRole("button", { name: "Retry overview" });
      await retryOverview.click();
      await body.getByText(/^Cited fixture for retry overview/).waitFor();
      assert.equal(calls.filter(call => call.body?.query === "retry overview").length, 2);
      await submit("railway");
      await body.getByText(/^This is a cited research overview\./).waitFor();
      const slowCategory = page.waitForRequest(req => isAnswer(req, "railway", "news"));
      await page.getByRole("tab", { name: "News" }).click();
      await slowCategory;
      const cancelledCategory = page.waitForEvent("requestfailed", req => isAnswer(req, "railway", "news"));
      await page.getByRole("tab", { name: "Research" }).click();
      await cancelledCategory;
      await body.getByText(/^This is a cited research overview\./).waitFor();
      const [cited] = await Promise.all([
        page.waitForResponse(response => response.url().startsWith(`${apiOrigin}/api/view?`)),
        body.getByRole("link", { name: "Source Research fixture" }).click()
      ]);
      assert.match(await cited.text(), /Fixture website/);
      await page.goto(`${origin}${prefix}/search/?q=dense+photos&type=images`);
      await body.getByText(/^Cited fixture for dense photos/).waitFor();
      await page.locator("#view-search").evaluate(el => { el.scrollTop = el.scrollHeight; });
      await result("Dense photos 47").waitFor();
      assert.equal(calls.filter(call => call.path === "/api/search/answer" && call.body?.query === "dense photos").length, 1,
        "pagination does not request the same overview again");
      const signedInIncognito = await context.newPage();
      await signedInIncognito.goto(`${origin}${prefix}/search/?q=private+overview&type=research&incognito=1`);
      await signedInIncognito.locator("#searchResults").getByText("research result for private overview").waitFor();
      assert.equal(await signedInIncognito.locator("#aiAnswer").isVisible(), false);
      assert.ok(!calls.some(call => call.body?.query === "private overview"));
      await signedInIncognito.close();
      await page.goto(`${origin}${prefix}/search/?q=railway&type=research`);
      await body.getByText(/^This is a cited research overview\./).waitFor();
      await page.evaluate(async base => {
        const { setAuth } = await import(`${base}/src/core.js?v=8.36.0-workbench`);
        setAuth("", null);
      }, prefix);
      await signInAI.waitFor();
      assert.equal(await body.count(), 0);

      await page.goto(`${origin}${prefix}/browse/`);
      await openPost("google.com");
      await frame.getByRole("heading", { name: "Google homepage fixture" }).waitFor();
      await openPost("https://www.google.com/search?q=clear");
      await frame.getByRole("heading", { name: "Google results fixture" }).waitFor();
      assert.ok(!calls.some(call => call.query.q === "clear"));
      await openPost("https://www.google.com/search?q=northern+lights");
      await frame.getByRole("heading", { name: "Google is asking for a captcha" }).waitFor();
      await frame.getByRole("button", { name: "Invalid session" }).click();
      await frame.getByRole("heading", { name: "Google is asking for a captcha" }).waitFor();
      await frame.getByRole("button", { name: "Search with Veyra" }).click();
      await result("web result for northern lights").waitFor();
      await page.getByText(/No Google results from the API/).waitFor();
      assert.ok(calls.some(call => call.path === "/api/search/web" && call.query.q === "search:google.com northern lights"));
      await openPost("search:google.com");
      await page.locator("#searchResults").getByRole("link", { name: "Google", exact: true }).waitFor();
      await page.locator("#searchInput").fill("India rail");
      await page.locator("#searchInput").press("Enter");
      await page.getByRole("button", { name: "See all images" }).click();
      await result("images result for India rail").waitFor();
      assert.equal(await page.getByRole("tab", { name: "Images" }).getAttribute("aria-selected"), "true");

      await page.goto(`${origin}${prefix}/search/?q=slow+preview`);
      await result("web result for slow preview").waitFor();
      assert.equal(await page.locator("#searchImagePreview").isVisible(), false, "Web renders before a slow preview");
      const aborted = page.waitForEvent("requestfailed", request => request.url().includes("preview=1") && request.url().includes("slow+preview"));
      await page.locator("#searchInput").fill("search:google.com");
      await page.locator("#searchInput").press("Enter");
      await page.locator("#searchResults").getByRole("link", { name: "Google", exact: true }).waitFor();
      await aborted;
      await page.locator("#searchInput").fill("site:example.in India rail");
      const scopedPreview = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.searchParams.get("preview") === "1" && url.searchParams.get("q") === "site:example.in India rail";
      });
      await page.locator("#searchInput").press("Enter");
      await (await scopedPreview).finished();
      await page.locator("#searchStat").getByText("0 results", { exact: true }).waitFor();
      assert.equal(await page.locator("#searchImagePreview").isVisible(), false, "Neither a stale nor an out-of-scope image is shown");
      await openPost("search:nasa.gov");
      await result("NASA watch page").waitFor();
      assert.ok(calls.some(call => call.path === "/api/search/web" && call.query.q === "search:nasa.gov" && !call.query.region));
      assert.equal(await page.locator("#searchResults .search-match").count(), 0, "a domain without keywords does not show a match percentage");
      await page.locator("#searchImagePreview").getByRole("heading", { name: "Videos", exact: true }).waitFor();
      await page.locator("#searchImagePreview").getByRole("link", { name: "NASA image fixture" }).waitFor();
      await page.locator("#searchImagePreview").getByRole("link", { name: /NASA watch fixture/ }).waitFor();
      const watchPage = page.locator("#searchResults .result").filter({ hasText: "NASA watch page" });
      await watchPage.getByRole("link", { name: /Watch video/ }).waitFor();
      await page.locator("#searchResults").getByRole("link", { name: "Image preview" }).waitFor();
      const directMedia = page.locator("#searchResults .result").filter({ hasText: "NASA direct media page" });
      assert.equal(await directMedia.getByText("3:35").textContent(), "3:35");
      assert.equal(await directMedia.locator(".search-result-media img").getAttribute("src"), "https://imgs.search.brave.com/fixture.jpg");
      assert.equal(await page.getByText("Offsite fixture").count(), 0);
      assert.equal(await page.locator("#searchResults .result").filter({ hasText: "NASA research page" }).locator(".search-result-media").count(), 0);
      await page.getByRole("button", { name: "See all videos" }).click();
      await result("NASA watch fixture").waitFor();
      assert.equal(await page.locator("#searchInput").inputValue(), "search:nasa.gov");
      assert.equal(await result("Offsite fixture").count(), 0);
      await page.goto(`${origin}${prefix}/search/?q=search%3Aexample.com+lunar+atlas&type=web`);
      await result("Lunar atlas fixture").waitFor();
      for (const [label, mode] of [["Images", "2"], ["Videos", "7"]]) {
        const handoff = page.locator("#searchImagePreview").getByRole("link", { name: `Search Google ${label}` });
        await handoff.waitFor();
        const destination = new URL(await handoff.getAttribute("href"));
        assert.equal(destination.origin, "https://www.google.com");
        assert.equal(destination.searchParams.get("q"), "site:example.com lunar atlas");
        assert.equal(destination.searchParams.get("udm"), mode);
        assert.equal(await handoff.getAttribute("target"), "_blank");
        assert.equal(await handoff.getAttribute("rel"), "noopener noreferrer");
      }
      await page.getByRole("button", { name: "See all videos" }).click();
      await page.locator("#searchResults").getByRole("link", { name: "Search Google Videos" }).waitFor();
      await page.goto(`${origin}${prefix}/search/?q=search%3Aexample.com+lunar+mission&type=web`);
      await page.locator("#searchImagePreview").getByText("No video previews from Veyra’s sources.").waitFor();
      assert.equal(await page.locator("#searchImagePreview [data-media-section=videos] img").count(), 0);
      await page.getByRole("button", { name: "See all videos" }).click();
      await result("Lunar mission video fixture").waitFor();
      assert.equal(await page.locator("#searchResults img[src*='unapproved.example']").count(), 0);
      await page.goto(`${origin}${prefix}/search/?q=search%3Aexample.com+lunar+atlas&type=videos&incognito=1`);
      await page.getByText("No results within the requested site scope").waitFor();
      assert.equal(await page.locator(".search-media-handoff").count(), 0);
      calls.length = 0;
      await page.goto(`${origin}${prefix}/search/?q=search%3Anasa.gov&type=web&incognito=1`);
      await result("NASA direct media page").waitFor();
      assert.equal(await page.locator(".search-result-media").count(), 0);
      assert.ok(!calls.some(call => call.query.q === "search:nasa.gov" && call.query.preview === "1"));

      await page.goto(`${origin}${prefix}/search/?q=privacy+fixture&type=web&incognito=0`);
      const modeControl = page.getByLabel("Search privacy", { exact: true });
      await result("Ordinary privacy fixture").waitFor();
      assert.equal(await modeControl.inputValue(), "filtered");
      assert.equal(await result("Labelled privacy fixture").count(), 0);
      assert.equal(await page.locator("#searchImagePreview img").count(), 0);
      const early = page.waitForRequest(r => r.url().includes("/api/search/web?") && r.url().includes("privacy=unfiltered"));
      await modeControl.selectOption("unfiltered");
      await early;
      await modeControl.selectOption("blocked");
      await result("Ordinary privacy fixture").waitFor();
      assert.equal(await result("Labelled privacy fixture").count(), 0);
      await modeControl.selectOption("unfiltered");
      await result("Labelled privacy fixture").waitFor();
      await page.locator("#searchImagePreview img").waitFor();
      await page.reload();
      await result("Labelled privacy fixture").waitFor();
      assert.equal(await modeControl.inputValue(), "unfiltered");
      await page.goto(`${origin}${prefix}/settings/search/?incognito=0`);
      await page.getByRole("radio", { name: /^Blocked/ }).check();
      await page.goto(`${origin}${prefix}/search/?q=privacy+fixture&type=web&incognito=0`);
      await result("Ordinary privacy fixture").waitFor();
      assert.equal(await modeControl.inputValue(), "blocked");
      await page.locator("#searchInput").fill("(https://www.xvideos.com/fixture), clip");
      await page.locator("#searchInput").press("Enter");
      await page.getByText("This search is excluded by the current mode").waitFor();
      assert.ok(!calls.some(call => call.query.q?.includes("xvideos.com/fixture")), "blocked query never reaches the API");
      assert.equal(await page.locator("#searchOnGoogle").isVisible(), false);
      for (const host of ["porn.com", "pornhub.com", "xvideos.com", "xhamster.com"]) {
        const query = `site:${host}`;
        await page.locator("#searchInput").fill(query);
        await page.locator("#searchInput").press("Enter");
        await page.getByText("This search is excluded by the current mode").waitFor();
        assert.ok(!calls.some(call => call.query.q === query), `${host} scope stays inside the client`);
        assert.equal(await page.locator("#searchOnGoogle").isVisible(), false);
      }
      await modeControl.selectOption("restricted");

      const restricted = (domain, type = "videos", privateMode = false) =>
        `${origin}${prefix}/search/?${new URLSearchParams({ q: `search:${domain} lunar atlas`, type, incognito: privateMode ? "1" : "0" })}`;
      const panel = page.locator("#publisherSearch");
      const start = async () => {
        const opened = page.waitForEvent("popup");
        await panel.getByRole("button", { name: "Verify age" }).click();
        const popup = await opened;
        await popup.getByRole("heading", { name: "Test-only verification bridge" }).waitFor();
        return popup;
      };
      await page.evaluate(user => localStorage.setItem("veyra-auth", JSON.stringify({ token: "preview-test-token", user })), fixtureUser);
      await Promise.all([page.waitForResponse(r => r.url().includes(`${publisherPath}/status`)), page.goto(restricted("pornhub.com"))]);
      assert.equal(await panel.isVisible(), false, "disabled server does not offer its catalog");
      publisherMode = "on";
      await page.goto(restricted("pornhub.com", "web"));
      await panel.getByRole("button", { name: "Verify age" }).waitFor();
      assert.equal(await panel.locator("li").count(), 0);
      let popup = await start();
      await popup.getByRole("button", { name: "Send unrelated decision" }).click();
      await page.evaluate(nonce => postMessage({ type: "veyra:publisher-age-decision", nonce, assertion: "signed.fixture.accepted" }, location.origin), publisherNonce);
      await panel.getByText("Waiting for age verification…").waitFor();
      assert.ok(!calls.some(call => call.path === `${publisherPath}/verify`));
      await popup.getByRole("button", { name: "Send denied fixture decision" }).click();
      await panel.getByText("Age verification did not unlock publisher results.").waitFor();
      assert.equal(await panel.locator("li").count(), 0);
      popup = await start();
      await Promise.all([popup.waitForEvent("close"), panel.getByRole("button", { name: "Cancel" }).click()]);
      await panel.getByText("Age verification cancelled.").waitFor();
      assert.ok(popup.isClosed());
      popup = await start();
      await popup.getByRole("button", { name: "Send approved fixture decision" }).click();
      await panel.getByText(/^24 of 25 verified catalog results/).waitFor();
      const watch = panel.getByRole("link", { name: "Publisher fixture 1", exact: true });
      assert.equal(await watch.getAttribute("rel"), "noopener noreferrer");
      assert.equal(await watch.getAttribute("href"), "https://www.pornhub.com/fixture-1");
      const viewport = await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1);
      assert.equal(viewport, true, "catalog does not overflow");
      await panel.getByRole("button", { name: "More publisher results" }).click();
      await panel.getByText(/^25 of 25 verified catalog results/).waitFor();
      assert.equal(await panel.locator("li").count(), 25);
      assert.equal(await panel.locator("img, video, iframe").count(), 0);
      assert.equal(publisherPosterRequests, 0);
      await modeControl.selectOption("unfiltered");
      await panel.waitFor({ state: "hidden" });
      assert.equal(await panel.locator("li").count(), 0);
      await modeControl.selectOption("restricted");
      await panel.getByRole("button", { name: "Verify age" }).waitFor();
      popup = await start();
      await popup.getByRole("button", { name: "Send approved fixture decision" }).click();
      await panel.getByText(/^24 of 25 verified catalog results/).waitFor();
      await panel.getByRole("button", { name: "Close publisher results" }).click();
      await panel.getByRole("button", { name: "Verify age" }).waitFor();
      await page.getByRole("tab", { name: "Videos", exact: true }).click();
      popup = await start();
      await Promise.all([popup.waitForEvent("close"), page.getByRole("tab", { name: "Images", exact: true }).click()]);
      await panel.waitFor({ state: "hidden" });
      assert.ok(popup.isClosed());
      assert.equal(await panel.locator("li").count(), 0);
      publisherMode = "expire";
      await page.goto(restricted("xvideos.com"));
      popup = await start();
      await popup.getByRole("button", { name: "Send approved fixture decision" }).click();
      await panel.getByText(/^24 of 25 verified catalog results/).waitFor();
      await panel.getByText(/Age verification expired/).waitFor();
      assert.equal(await panel.locator("li").count(), 0);
      publisherMode = "on";
      popup = await start();
      await popup.getByRole("button", { name: "Send approved fixture decision" }).click();
      await panel.getByText(/^24 of 25 verified catalog results/).waitFor();
      await page.locator("#profileBtn").click();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await panel.waitFor({ state: "hidden" });
      assert.equal(await panel.locator("li").count(), 0);
      const before = calls.filter(call => call.path.startsWith(publisherPath)).length;
      for (const privateMode of [false, true]) {
        await page.goto(restricted("xvideos.com", "videos", privateMode));
        await page.getByText("This search is excluded by the current mode").waitFor();
        assert.equal(await panel.isVisible(), false);
      }
      assert.equal(calls.filter(call => call.path.startsWith(publisherPath)).length, before);
      publisherMode = "off";
      assert.deepEqual(errors, []);
      const offlineContext = await browser.newContext();
      try {
        sessionsAvailable = false;
        const offline = await offlineContext.newPage();
        await offline.goto(`${origin}${prefix}/browse/?incognito=1`);
        const address = offline.locator("#address");
        await address.fill("http://tiktok.com/");
        await address.press("Enter");
        const offlineFrame = offline.frameLocator("#frame-t1");
        await offlineFrame.getByRole("button", { name: "Use Fast Proxy" }).click();
        await offlineFrame.getByRole("heading", { name: "Veyra couldn't reach its server" }).waitFor();
        assert.equal(await offlineFrame.getByRole("link", { name: "Open original site" }).count(), 0);
        // A background or blurred incognito tab can legitimately cover the
        // error screen. Resume through the same control as a returning user.
        await offline.bringToFront();
        const reveal = offline.getByRole("button", { name: "Reveal screen" });
        if (await reveal.isVisible()) await reveal.click();
        await offlineFrame.getByRole("button", { name: "Return to TikTok options" }).click();
        await offlineFrame.getByRole("heading", { name: "TikTok", exact: true }).waitFor();
        await offlineFrame.getByText("Direct TikTok access is unavailable in this session.").waitFor();
      } finally {
        sessionsAvailable = true;
        await offlineContext.close();
      }
      console.log(`${engine} ${mobile ? "mobile" : "desktop"}: Google Fast Proxy and fallback, site-scoped media, category pagination, privacy modes, automatic cited overviews, TikTok recovery, and publisher gate lifecycle`);
    } finally { await browser.close(); }
  }
} finally {
  for (const server of [apiServer, siteServer]) { server.closeAllConnections(); server.close(); }
}
