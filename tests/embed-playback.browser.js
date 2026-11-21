// Run with a sibling VeyraServer checkout and its installed dependencies:
// node tests/embed-playback.browser.js [path-to-VeyraServer]
// Optional: POPUP_TEST_CHROME=/path/to/chrome. All upstream responses are fixtures.
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.VEYRA_CHROMIUM_ENABLED = "false";
delete process.env.PUBLIC_API_ORIGIN;
const fromServer = createRequire(resolve(process.argv[2] || "../VeyraServer", "package.json"));
const { app } = fromServer("./src/server.js");
const { chromium } = fromServer("playwright");
const express = fromServer("express");
const web = fileURLToPath(new URL("../web/", import.meta.url));
const entry = readFileSync(new URL("../web/browse/index.html", import.meta.url), "utf8");
const official = "https://xhamster.com";
const documents = [];

app.locals.veyraProxyFetchBuffer = async (target) => {
  const u = new URL(target);
  documents.push(target);
  const watch = /^\/videos\/fixture-(xh[A-C]123)$/.exec(u.pathname);
  const embed = /^\/embed\/(xh[A-C]123)$/.exec(u.pathname);
  if (u.origin !== official || (!watch && !embed)) {
    return { status: 404, finalUrl: target, contentType: "text/plain", body: Buffer.from("Not a fixture") };
  }
  const id = (watch || embed)[1];
  const finalUrl = watch && id === "xhB123" ? `${official}/embed/${id}` : target;
  const watchPage = watch && id !== "xhB123";
  const markup = watchPage
    ? `<h1>Watch fixture</h1><a href="/embed/${id}" target="_blank">Repeat embed</a>`
    : id === "xhC123"
      ? `<button onclick="window.open('${official}/videos/fixture-${id}', '_blank')">Play</button>`
      : `<a href="https://adc3.lol/videos/fixture-${id}?prs=fixture" target="_blank">Play</a>`;
  return { status: 200, finalUrl, contentType: "text/html", cacheControl: "no-store",
    body: Buffer.from(`<!doctype html><title>Playback fixture</title>${markup}`) };
};

const apiServer = app.listen(0, "127.0.0.1");
const shell = express();
shell.get("/browse", (_req, res) => res.type("html").send(
  entry.replaceAll("http://127.0.0.1:10000", `http://127.0.0.1:${apiServer.address().port}`)
));
shell.use(express.static(web));
const shellServer = shell.listen(0, "127.0.0.1");
let browser;
try {
  await Promise.all([once(apiServer, "listening"), once(shellServer, "listening")]);
  browser = await chromium.launch({ executablePath: process.env.POPUP_TEST_CHROME || undefined });
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem("veyra-settings", JSON.stringify({ settingsVersion: 6, runtime: "proxy" }));
    window.peakVeyraTabs = 0;
    new MutationObserver(() => {
      window.peakVeyraTabs = Math.max(window.peakVeyraTabs, document.querySelectorAll('#tabsList [role="tab"]').length);
    }).observe(document, { childList: true, subtree: true });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const nativePopups = [];
  page.on("popup", popup => nativePopups.push(popup));
  const original = page.frameLocator("#frame-t1");
  const assertOneTab = async () => {
    assert.equal(await page.locator('#tabsList [aria-selected="true"]').getAttribute("data-tab"), "t1");
    assert.equal(await page.locator('#tabsList [role="tab"]').count(), 1);
    assert.equal(await page.evaluate(() => window.peakVeyraTabs), 1);
    assert.equal(nativePopups.length, 0);
  };
  for (const id of ["xhA123", "xhB123", "xhC123"]) {
    const route = new URL(`http://127.0.0.1:${shellServer.address().port}/browse/`);
    route.searchParams.set("veyra_api", `http://127.0.0.1:${apiServer.address().port}`);
    route.searchParams.set("url", `${official}/embed/${id}`);
    await page.goto(route.href);
    const target = `${official}/videos/fixture-${id}`;
    const play = original.getByText("Play", { exact: true });
    const navigated = page.waitForResponse(response => {
      const request = new URL(response.url());
      return request.pathname === "/api/view" && request.searchParams.get("url") === target;
    });
    await play.click();
    assert.ok((await navigated).status() < 400, "the proxy accepted the official watch request");
    if (id === "xhB123") {
      await page.waitForFunction(url => document.querySelector("#address")?.value === url, `${official}/embed/${id}`);
      await play.click();
      await page.getByText("The site returned to the embed without starting playback.", { exact: false }).waitFor();
      assert.equal(documents.filter(u => u === target).length, 1, "Play cannot repeat a watch request that fell back to the embed");
    } else {
      await original.getByRole("heading", { name: "Watch fixture" }).waitFor();
      await original.getByText("Repeat embed").click();
    }
    await assertOneTab();
  }
  assert.equal(documents.some(u => new URL(u).hostname === "adc3.lol"), false, "only the official watch destination was fetched");
  console.log("Chromium: embed Play links and scripted Play keep the original tab; a watch-to-embed fallback never retries or opens a tab.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  apiServer.closeAllConnections();
  shellServer.closeAllConnections();
  apiServer.close();
  shellServer.close();
}
