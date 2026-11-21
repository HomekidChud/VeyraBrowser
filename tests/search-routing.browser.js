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
let vpnMode = "off";
api.use((req, res, next) => {
  res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,x-veyra-request-id,authorization,x-veyra-gate" });
  if (req.method === "OPTIONS") return res.sendStatus(204);
  calls.push({ path: req.path, query: { ...req.query } });
  next();
});
api.get("/api/gate/status", (_req, res) => res.json({ ok: true, gated: false }));
api.get("/api/health", (_req, res) => {
  if (calls.filter(call => call.path === "/api/health").length === 1) return res.type("html").send("<h1>Starting</h1>");
  res.json({ ok: true });
});
api.post("/api/session", (_req, res) => res.json({ ok: true, sessionId: "browser_fixture_session", timeLimitMs: 300000, guest: true }));
api.get("/api/vpn/session", (_req, res) => vpnMode === "unknown"
  ? res.status(503).json({ ok: false }) : res.json({ ok: true, connected: vpnMode === "on" }));
api.get("/api/view", (_req, res) => res.type("html").send("<h1>Fixture website</h1>"));
api.get(["/api/search/web", "/api/search/vertical", "/api/search"], (req, res) => {
  if (req.query.q === "recover" && calls.filter(call => call.query.q === "recover" && call.path === "/api/search/web").length === 1)
    return res.type("html").send("<h1>Veyra server page</h1>");
  if (req.query.q === "denied") return res.status(403).json({ ok: false, code: "GATE_REQUIRED", error: "Access is required." });
  const type = req.query.type || "web";
  res.json({ ok: true, status: "ok", provider: "fixture", more: false, results: [
    { title: `${type} result for ${req.query.q}`, url: "https://example.test/fixture", snippet: "Fixture snippet." }
  ] });
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
    const browser = await playwright[engine].launch();
    try {
      calls.length = 0;
      const mobile = engine === "webkit";
      const context = await browser.newContext(mobile ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } : {});
      let tiktokRequests = 0;
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.hostname === "127.0.0.1") return route.continue();
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
      assert.equal(calls.filter(call => call.path === "/api/session").length, 1);

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

      assert.deepEqual(errors, []);
      console.log(`${engine}: search routing and recovery, sessions, incognito, and opt-in TikTok player with VPN and Fast Proxy fallback`);
    } finally { await browser.close(); }
  }
} finally {
  for (const server of [apiServer, siteServer]) { server.closeAllConnections(); server.close(); }
}
