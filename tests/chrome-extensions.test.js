/* Chrome MV2/MV3 extension support: manifest parsing, permission model,
 * chrome.* shims, and injection-source building. Plain node, no deps. */
import assert from "node:assert/strict";
import {
  parseChromeManifest, classifyPermissions,
  buildContentScriptShim, buildContentScriptSource, buildBackgroundWorkerSource,
  patternMatchesUrl, matchesUrl
} from "../web/src/extension-manifest.js";

const mv3Manifest = {
  manifest_version: 3,
  name: "Example Enhancer",
  version: "2.1.0",
  description: "Makes examples better",
  icons: { "16": "icons/16.png", "48": "icons/48.png" },
  minimum_chrome_version: "126",
  permissions: ["storage", "tabs", "cookies", "webRequest", "nativeMessaging", "debugger", "management"],
  optional_permissions: ["clipboardRead"],
  host_permissions: ["*://example.com/*"],
  action: { default_title: "Enhance", default_icon: "icons/48.png", default_popup: "popup.html" },
  web_accessible_resources: [{ resources: ["images/logo.png"], matches: ["*://example.com/*"] }],
  background: { service_worker: "sw.js", type: "module" },
  content_scripts: [
    {
      matches: ["*://a.example.com/*", "*://b.example.com/*"],
      exclude_matches: ["*://a.example.com/private/*"],
      js: ["cs1.js"],
      css: ["style.css"],
      run_at: "document_start",
      all_frames: true,
      match_about_blank: true
    },
    { matches: ["*://c.example.com/*"], js: ["cs2.js"], run_at: "document_end" }
  ]
};
const mv3Files = {
  "sw.js": "chrome.runtime.onInstalled.addListener(() => {});",
  "cs1.js": "chrome.runtime.sendMessage({from: 'cs1'});",
  "cs2.js": "console.log('cs2');",
  "style.css": "body { color: red; }",
  "icons/16.png": "x", "icons/48.png": "x"
};

// --- 1. MV3 manifest with content scripts + background + permissions -------
{
  const rec = parseChromeManifest(mv3Manifest, mv3Files);
  assert.equal(rec.manifestVersion, 3);
  assert.equal(rec.name, "Example Enhancer");
  assert.equal(rec.version, "2.1.0");
  assert.match(rec.id, /^chrome-[a-z0-9]+$/);
  assert.equal(rec.contentScripts.length, 2);
  assert.equal(rec.contentScripts[0].runAt, "document_start");
  assert.equal(rec.contentScripts[1].runAt, "document_end");
  assert.equal(rec.contentScripts[0].js[0], mv3Files["cs1.js"]);
  assert.equal(rec.contentScripts[0].css[0], mv3Files["style.css"]);
  assert.deepEqual(rec.matches, ["*://a.example.com/*", "*://b.example.com/*", "*://c.example.com/*"]);
  assert.deepEqual(rec.excludeMatches, ["*://a.example.com/private/*"]);
  assert.equal(rec.background.kind, "service_worker");
  assert.equal(rec.background.serviceWorker, "sw.js");
  assert.equal(rec.background.type, "module");
  assert.equal(rec.background.scripts[0], mv3Files["sw.js"]);
  // permissions: safe ones granted, dangerous ones denied with warnings
  assert.deepEqual(rec.permissions.granted, ["storage"]);
  assert.deepEqual(rec.permissions.unsupported, ["tabs", "clipboardRead"]);
  assert.deepEqual(rec.permissions.denied.sort(), ["cookies", "debugger", "management", "nativeMessaging", "webRequest"]);
  assert.deepEqual(rec.hostPermissions, ["*://example.com/*"]);
  assert.ok(rec.warnings.some(w => w.includes('"cookies" is disabled')));
  assert.ok(rec.warnings.some(w => w.includes('"webRequest" is disabled')));
  assert.ok(rec.warnings.some(w => w.includes('"tabs" has no Veyra implementation')));
  // metadata
  assert.equal(rec.action.defaultTitle, "Enhance");
  assert.equal(rec.action.defaultPopup, "popup.html");
  assert.deepEqual(rec.webAccessibleResources[0].resources, ["images/logo.png"]);
  assert.equal(rec.minimumChromeVersion, "126");
  assert.ok(rec.warnings.some(w => w.includes("all_frames")));
  assert.ok(rec.warnings.some(w => w.includes("Action popups")));
  // the warning badge data never blocks install
  assert.equal(rec.enabled, true);
}

// --- 2. MV2 fallback --------------------------------------------------------
{
  const rec = parseChromeManifest({
    manifest_version: 2,
    name: "Legacy Helper",
    version: "1.4.2",
    description: "Old school",
    permissions: ["storage", "https://*.legacy.org/*"],
    browser_action: { default_title: "Legacy" },
    background: { scripts: ["bg1.js", "bg2.js"], persistent: false },
    content_scripts: [{ matches: ["https://legacy.org/*"], js: ["cs.js"] }]
  }, { "bg1.js": "a();", "bg2.js": "b();", "cs.js": "c();" });
  assert.equal(rec.manifestVersion, 2);
  assert.equal(rec.background.kind, "scripts");
  assert.equal(rec.background.scripts.join(""), "a();b();"); // MV2 order preserved
  assert.deepEqual(rec.hostPermissions, ["https://*.legacy.org/*"]); // host patterns lifted out of permissions
  assert.deepEqual(rec.permissions.granted, ["storage"]);
  assert.equal(rec.action.defaultTitle, "Legacy");
  assert.ok(rec.warnings.some(w => w.includes("event pages")));
  assert.equal(rec.backgroundKind ?? rec.background.kind, "scripts");
}

// --- 3. Deny-list permissions produce warnings, not failures ---------------
{
  const dangerous = ["nativeMessaging", "cookies", "webRequest", "debugger", "management"];
  const classified = classifyPermissions(dangerous);
  assert.deepEqual(classified.granted, []);
  assert.deepEqual(classified.denied.sort(), dangerous.sort());
  const rec = parseChromeManifest(
    { manifest_version: 3, name: "Risky", version: "1.0", permissions: dangerous, content_scripts: [{ matches: ["*://r/*"], js: ["x.js"] }] },
    { "x.js": ";" }
  );
  assert.equal(rec.permissions.denied.length, 5);
  assert.ok(rec.warnings.length >= 5);
  assert.equal(rec.enabled, true); // installs anyway
  assert.doesNotThrow(() => classifyPermissions(dangerous));
  // safe + unknown permissions still install cleanly
  const ok = classifyPermissions(["storage", "unlimitedStorage", "alarms", "tabs"]);
  assert.deepEqual(ok.granted.sort(), ["storage", "unlimitedStorage"]);
  assert.deepEqual(ok.unsupported.sort(), ["alarms", "tabs"]);
}

// --- 4. Missing content script files still error ---------------------------
{
  assert.throws(() => parseChromeManifest(
    { manifest_version: 3, name: "Broken", content_scripts: [{ matches: ["*://x/*"], js: ["missing.js"] }] }, {}
  ), /Missing content script: missing\.js/);
  assert.throws(() => parseChromeManifest(
    { manifest_version: 3, name: "Broken", content_scripts: [{ matches: ["*://x/*"], css: ["missing.css"] }] }, {}
  ), /Missing stylesheet: missing\.css/);
  assert.throws(() => parseChromeManifest(
    { manifest_version: 3, name: "Broken", background: { service_worker: "gone.js" } }, {}
  ), /Missing background service worker: gone\.js/);
  assert.throws(() => parseChromeManifest({ manifest_version: 1, name: "Fossil" }, {}), /Manifest version 1 is obsolete/);
  assert.throws(() => parseChromeManifest({ manifest_version: 4, name: "Future" }, {}), /Unsupported manifest_version 4/);
  assert.throws(() => parseChromeManifest({ manifest_version: 3, name: "Nothing" }, {}), /no supported content scripts, styles, or background code/);
}

// --- 5. chrome.* content-script shim (executed in this node realm) ---------
{
  const rec = parseChromeManifest(mv3Manifest, mv3Files);
  const chrome = new Function(buildContentScriptShim(rec) + "\n;return chrome;")();
  // identity + manifest
  assert.equal(chrome.runtime.id, rec.id);
  assert.equal(chrome.runtime.getManifest().name, "Example Enhancer");
  assert.equal(chrome.runtime.getManifest().manifest_version, 3);
  assert.ok(chrome.runtime.getURL("img/x.png").startsWith(`chrome-extension://${rec.id}/`));
  // storage.local / storage.sync with Chrome's key semantics
  await new Promise(r => chrome.storage.local.set({ a: 1, b: "two" }, r));
  assert.deepEqual(await new Promise(r => chrome.storage.local.get(null, r)), { a: 1, b: "two" });
  assert.deepEqual(await new Promise(r => chrome.storage.local.get(["a"], r)), { a: 1 });
  assert.deepEqual(await new Promise(r => chrome.storage.local.get({ a: 0, c: 3 }, r)), { a: 1, c: 3 });
  await new Promise(r => chrome.storage.sync.set({ s: 1 }, r));
  assert.deepEqual(await new Promise(r => chrome.storage.sync.get("s", r)), { s: 1 });
  await new Promise(r => chrome.storage.local.remove("a", r));
  assert.deepEqual(await new Promise(r => chrome.storage.local.get(null, r)), { b: "two" });
  await new Promise(r => chrome.storage.local.clear(r));
  assert.deepEqual(await new Promise(r => chrome.storage.local.get(null, r)), {});
  // messaging: no listener -> Chrome-style lastError; listener -> delivery
  let seen = null;
  chrome.runtime.sendMessage({ hi: 1 }, function () { seen = chrome.runtime.lastError; });
  assert.match(seen?.message, /Could not establish connection\. Receiving end does not exist\./);
  let deliver = null;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => { deliver = msg; sendResponse("pong"); });
  let reply = null;
  chrome.runtime.sendMessage({ hi: 2 }, r => { reply = r; });
  assert.deepEqual(deliver, { hi: 2 });
  assert.equal(reply, "pong");
  chrome.runtime.onMessage.removeListener(() => {});
  // unsupported APIs throw helpful errors instead of existing-but-broken
  assert.throws(() => chrome.webRequest.onBeforeSendHeaders.addListener(() => {}), /chrome\.webRequest\.onBeforeSendHeaders\.addListener is not available in Veyra Browser/);
  assert.throws(() => chrome.tabs.query({ active: true }, () => {}), /chrome\.tabs\.query is not available in Veyra Browser/);
  assert.throws(() => chrome.cookies.getAll({}, () => {}), /chrome\.cookies\.getAll is not available in Veyra Browser/);
  assert.throws(() => chrome.management.getAll(() => {}), /chrome\.management\.getAll is not available in Veyra Browser/);
}

// --- 6. Built content-script source ----------------------------------------
{
  const rec = parseChromeManifest(mv3Manifest, mv3Files);
  const src = buildContentScriptSource(rec);
  assert.ok(src.includes("chrome.runtime.sendMessage")); // shim + code present
  assert.ok(src.includes('GM_addStyle('), "CSS rides along through GM_addStyle");
  assert.ok(src.includes('"document_start"') && src.includes('"document_end"'), "run_at gating per entry");
  assert.ok(src.includes("document.addEventListener(\"DOMContentLoaded\""), "document_end waits for DOMContentLoaded");
  assert.ok(src.includes("chrome.storage"), "shim storage is defined");
  assert.ok(!/await /.test(src.replace(/\(async function[\s\S]*$/, "")), "top level stays synchronous");
  // run_at gating for document_idle falls back to load + timeout
  assert.ok(src.includes("setTimeout(finish, 400)"));
  // an extension with only a background (no content scripts) yields no page code
  const bgOnly = parseChromeManifest(
    { manifest_version: 3, name: "BgOnly", background: { service_worker: "sw.js" } }, { "sw.js": "x" });
  assert.equal(buildContentScriptSource(bgOnly).includes("cs1.js"), false);
  assert.ok(buildContentScriptSource(bgOnly).includes("var chrome"));
}

// --- 7. Background worker source -------------------------------------------
{
  const rec = parseChromeManifest(mv3Manifest, mv3Files);
  const src = buildBackgroundWorkerSource(rec);
  assert.ok(src.startsWith("self.chrome"), "worker defines chrome on self");
  assert.ok(src.includes("chrome.runtime.onInstalled.addListener"), "original service worker code included unchanged");
  assert.ok(src.includes("onInstalled"), "onInstalled shim present");
  assert.ok(src.includes("__veyraRpc"), "host RPC protocol present");
  assert.ok(src.includes('rpc("storage." + area + ".get")'), "storage RPC present");
  // MV2 scripts concatenate in manifest order
  const mv2 = parseChromeManifest(
    { manifest_version: 2, name: "L", background: { scripts: ["a.js", "b.js"] } },
    { "a.js": "first();", "b.js": "second();" });
  const mv2Src = buildBackgroundWorkerSource(mv2);
  assert.ok(mv2Src.indexOf("first();") < mv2Src.indexOf("second();"));
}

// --- 8. Match patterns and excludes ----------------------------------------
{
  assert.equal(patternMatchesUrl("*://a.example.com/*", "https://a.example.com/page?x=1"), true);
  assert.equal(patternMatchesUrl("*://*.example.com/*", "https://sub.example.com/x"), true);
  assert.equal(patternMatchesUrl("https://a.example.com/*", "http://a.example.com/x"), false);
  assert.equal(patternMatchesUrl("<all_urls>", "ftp://a.example.com/x"), false);
  assert.equal(patternMatchesUrl("<all_urls>", "https://anything.org/"), true);
  const ext = { matches: ["*://a.example.com/*"], excludeMatches: ["*://a.example.com/private/*"] };
  assert.equal(matchesUrl(ext.matches, "https://a.example.com/private/x", ext.excludeMatches), false);
  assert.equal(matchesUrl(ext.matches, "https://a.example.com/public/x", ext.excludeMatches), true);
  assert.equal(matchesUrl([], "https://any.site/", []), true); // no matches = all sites
}

console.log("Chrome extension tests passed: MV3 + MV2 parsing, permission allow/deny with warnings, missing-file errors, chrome.* shims, run_at gating, and match patterns.");
