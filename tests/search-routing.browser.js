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
let vpnMode = "off";
api.use((req, res, next) => {
  res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,x-veyra-request-id,authorization,x-veyra-gate" });
  if (req.method === "OPTIONS") return res.sendStatus(204);
  calls.push({ path: req.path, query: { ...req.query } });
  next();
});
api.get("/api/gate/status", (_req, res) => res.json({ ok: true, gated: false }));
api.get("/api/auth/me", (_req, res) => res.json({ ok: true, user: fixtureUser }));
api.get("/api/health", (_req, res) => {
  if (calls.filter(call => call.path === "/api/health").length === 1) return res.type("html").send("<h1>Starting</h1>");
  res.json({ ok: true });
});
api.post("/api/session", (_req, res) => res.json({ ok: true, sessionId: "browser_fixture_session", timeLimitMs: 300000, guest: true }));
api.get("/api/vpn/session", (_req, res) => vpnMode === "unknown"
  ? res.status(503).json({ ok: false }) : res.json({ ok: true, connected: vpnMode === "on" }));
api.get("/api/view", (_req, res) => res.type("html").send("<h1>Fixture website</h1>"));
api.post("/api/search/answer", express.json(), (req, res) => {
  assert.equal(req.headers.authorization, "Bearer preview-test-token");
  assert.equal(req.body.region, "IN");
  assert.equal(req.body.vertical, "research");
  res.json({ hasAnswer: true, answer: "This is a cited fixture summary. [S1]\n\nThis is a second cited paragraph. [S1]", sources: [
    { id: "S1", url: "https://example.test/fixture", title: "Research fixture" }
  ] });
});
api.get(["/api/search/web", "/api/search/vertical", "/api/search"], (req, res) => {
  if (req.query.q === "recover" && calls.filter(call => call.query.q === "recover" && call.path === "/api/search/web").length === 1)
    return res.type("html").send("<h1>Veyra server page</h1>");
  if (req.query.q === "denied") return res.status(403).json({ ok: false, code: "GATE_REQUIRED", error: "Access is required." });
  const type = req.query.type || (req.path === "/api/search" ? "index" : "web");
  const next = Number(req.query.offset || req.query.page || 0);
  const paged = req.query.q === "India rail";
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
    ...(type === "web" && paged ? { source: "mdn", providers: ["mdn", "bing"] } : {}) };
  const second = { title: `More ${type} results`, url: "https://example.in/more", snippet: "Another snippet." };
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
      const mobile = engine === "webkit";
      const context = await browser.newContext(mobile ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } : {});
      let tiktokRequests = 0;
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.hostname === "127.0.0.1") return route.continue();
        if (url.hostname === "www.google.co.in") return route.fulfill({ contentType: "text/html", body: "<h1>External search fixture</h1>" });
        if (url.hostname === "www.amazon.in") return route.fulfill({ contentType: "text/html", body: "<h1>External retailer fixture</h1>" });
        if (url.href === "https://www.tiktok.com/player/v1/6718335390845095173?autoplay=0") {
          tiktokRequests++;
          return route.fulfill({ contentType: "text/html", body: `<h1>TikTok fixture</h1><script>
            parent.postMessage({type:"onPlayerReady","x-tiktok-player":true}, "*");
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
      assert.equal(calls.filter(call => call.path === "/api/session").length, 0);
      assert.ok(calls.filter(call => call.path === "/api/search/vertical").every(call => call.query.private === "1"));

      await page.goto(`${origin}${prefix}/search/?q=India+rail&type=deep`);
      await result("web result for India rail").waitFor();
      assert.match(await page.locator("#searchResults .r-url").first().textContent(), /MDN Web Docs/);
      assert.equal(new URL(page.url()).searchParams.has("type"), false);
      assert.equal(await page.locator("#searchTabs").getByRole("tab").count(), 8);
      assert.equal(await page.getByRole("tab", { name: "Web" }).getAttribute("aria-selected"), "true");
      assert.equal(await page.getByRole("button", { name: "Summarize sources with AI" }).isVisible(), false);
      const [google] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "Open Google in a new tab outside Veyra" }).click()]);
      await google.waitForURL("https://www.google.co.in/search?**");
      assert.equal(new URL(google.url()).searchParams.get("gl"), "in");
      assert.equal(new URL(google.url()).searchParams.get("q"), "India rail");
      await google.close();
      await page.getByRole("button", { name: "More results" }).click();
      await result("More web results").waitFor();
      assert.equal(await result("web result for India rail").count(), 1);
      assert.ok(calls.some(call => call.path === "/api/search/web" && call.query.offset === "20" && call.query.region === "IN"));
      await page.getByRole("tab", { name: "Web" }).press("ArrowRight");
      await result("images result for India rail").waitFor();
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
      await page.locator("#address").fill("veyra://settings");
      await page.locator("#address").press("Enter");
      await page.locator("#view-settings").waitFor();

      await page.goto(`${origin}${prefix}/search/?q=private%20moon&type=images&incognito=1`);
      await result("images result for private moon").waitFor();
      assert.equal(new URL(page.url()).searchParams.has("q"), false);
      assert.equal(new URL(page.url()).searchParams.get("incognito"), "1");
      assert.ok(calls.some(call => call.path === "/api/search/vertical" && call.query.q === "private moon" && call.query.private === "1"));
      assert.equal(await page.locator("#searchResults img").count(), 0);
      assert.equal(await page.locator("#searchOnGoogle").isVisible(), false);
      assert.equal(calls.filter(call => call.path === "/api/session").length, 1);
      await page.goto(`${origin}${prefix}/search/?q=private+web&incognito=1`);
      await result("web result for private web").waitFor();
      assert.ok(calls.some(call => call.path === "/api/search/web" && call.query.q === "private web" && call.query.incognito === "1" && call.query.private === "1"));
      await page.goto(`${origin}${prefix}/search/?q=missing+listing&type=videos&incognito=1`);
      await page.getByText("No matching watch pages from Veyra’s sources.").waitFor();
      assert.equal(await page.getByRole("link", { name: "Search YouTube" }).count(), 0);

      const post = "https://www.tiktok.com/@scout2015/video/6718335390845095173";
      const openPost = async () => {
        await page.locator("#address").fill(post);
        await page.locator("#address").press("Enter");
      };
      const frame = page.frameLocator("#frame-t1");
      const proxyPage = frame.getByRole("heading", { name: "Fixture website" });
      const tiktokPage = frame.getByRole("heading", { name: "TikTok player" });
      await openPost();
      await proxyPage.waitFor();
      assert.equal(tiktokRequests, 0, "incognito did not reach the official player");

      await page.goto(`${origin}${prefix}/browse/?incognito=0`);
      await openPost();
      await tiktokPage.waitFor();
      assert.equal(tiktokRequests, 0, "the panel is local until the user clicks");
      assert.equal(await frame.getByRole("link", { name: "Open on TikTok" }).getAttribute("href"), post);
      await frame.getByRole("button", { name: "Load TikTok player" }).click();
      await frame.getByRole("status").getByText("TikTok player ready.", { exact: false }).waitFor();
      assert.equal(tiktokRequests, 1);
      await frame.getByRole("button", { name: "Use Fast Proxy" }).click();
      await proxyPage.waitFor();
      for (const mode of ["on", "unknown", "off"]) {
        vpnMode = mode;
        await openPost();
        if (mode === "off") await tiktokPage.waitFor();
        else await proxyPage.waitFor();
        assert.equal(tiktokRequests, 1);
      }

      await page.evaluate(user => localStorage.setItem("veyra-auth", JSON.stringify({ token: "preview-test-token", user })), fixtureUser);
      await page.goto(`${origin}${prefix}/search/?q=railway&type=research`);
      await result("research result for railway").waitFor();
      assert.ok(!calls.some(call => call.path === "/api/search/answer"));
      const summary = page.getByRole("button", { name: "Summarize sources with AI" });
      assert.equal(await summary.evaluate(el => Boolean(document.querySelector("#searchResults").compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
      await summary.click();
      await page.getByText("This is a cited fixture summary.", { exact: true }).waitFor();
      await page.getByText("This is a second cited paragraph.", { exact: true }).waitFor();
      assert.equal(await page.locator("#aiAnswer .ai-answer-body > p").count(), 2);
      assert.equal(await page.locator("#aiAnswer .ai-answer-body .ai-source-cite").count(), 2);
      const [cited] = await Promise.all([
        page.waitForResponse(response => response.url().startsWith(`${apiOrigin}/api/view?`)),
        page.getByRole("link", { name: "Source Research fixture" }).first().click()
      ]);
      assert.match(await cited.text(), /Fixture website/);

      assert.deepEqual(errors, []);
      console.log(`${engine}: India category requests and pagination, legacy routing, INR, responsive Images, recovery, private search, opt-in summaries, and TikTok regression`);
    } finally { await browser.close(); }
  }
} finally {
  for (const server of [apiServer, siteServer]) { server.closeAllConnections(); server.close(); }
}
