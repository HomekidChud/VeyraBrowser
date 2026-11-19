/* Chrome MV2/MV3 extension support: manifest parsing, permission model,
 * chrome.* shims, and injection-source building. Plain node, no deps. */
import assert from "node:assert/strict";
import {
  parseChromeManifest, classifyPermissions,
  buildContentScriptShim, buildContentScriptSource, buildBackgroundWorkerSource,
  patternMatchesUrl, matchesUrl, readExtensionFolder, isBinaryPath, FOLDER_LIMITS
} from "../web/src/extension-manifest.js";
import { actionAvailability, actionBadge, extensionPins, pinExtension, safeExtensionIcon, sameChromePackage } from "../web/src/extension-actions.js";

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

  assert.deepEqual(rec.permissions.granted, ["storage"]);
  assert.deepEqual(rec.permissions.unsupported, ["tabs", "clipboardRead"]);
  assert.deepEqual(rec.permissions.denied.sort(), ["cookies", "debugger", "management", "nativeMessaging", "webRequest"]);
  assert.deepEqual(rec.hostPermissions, ["*://example.com/*"]);
  assert.ok(rec.warnings.some(w => w.includes('"cookies" is disabled')));
  assert.ok(rec.warnings.some(w => w.includes('"webRequest" is disabled')));
  assert.ok(rec.warnings.some(w => w.includes('"tabs" has no Veyra implementation')));

  assert.equal(rec.action.defaultTitle, "Enhance");
  assert.deepEqual(rec.action.defaultIcon, { 16: "icons/48.png" });
  assert.equal(rec.action.defaultPopup, "popup.html");
  assert.deepEqual(rec.webAccessibleResources[0].resources, ["images/logo.png"]);
  assert.equal(rec.minimumChromeVersion, "126");
  assert.ok(rec.warnings.some(w => w.includes("all_frames")));
  assert.ok(rec.warnings.some(w => w.includes("Action popups")));

  assert.equal(rec.enabled, true);
}

{
  const rec = parseChromeManifest({
    manifest_version: 3, name: "Toolbar", default_locale: "en",
    action: { default_title: "__MSG_actionTitle__", default_icon: { 16: "icon.png" } },
    background: { service_worker: "worker.js" }
  }, { "_locales/en/messages.json": '{"actionTitle":{"message":"Play"}}', "icon.png": "data:image/png;base64,YQ==", "worker.js": ";" });
  assert.equal(rec.action.defaultTitle, "Play");
  assert.equal(rec.action.iconData[16], "data:image/png;base64,YQ==");
  assert.equal(safeExtensionIcon(rec.action.iconData[16]), rec.action.iconData[16]);
  for (const invalid of ["https://example.test/icon.png", "data:text/html;base64,YQ==", "javascript:0"]) assert.equal(safeExtensionIcon(invalid), "");
  assert.equal(actionAvailability(rec, "running"), "");
  assert.equal(actionAvailability(rec, "error"), "No running background");
  assert.equal(actionAvailability({ ...rec, enabled: false }, "running"), "Disabled");
  assert.equal(actionAvailability({ ...rec, action: { defaultPopup: "popup.html" } }, "running"), "Popup not supported");
  assert.deepEqual(extensionPins(["chrome-a", {}, "chrome-a", "<script>", "chrome-b", "chrome-c", "chrome-d"]), ["chrome-a", "chrome-b", "chrome-c"]);
  assert.deepEqual(pinExtension(["chrome-a", "chrome-b"], "chrome-b"), ["chrome-a"]);
  assert.deepEqual(pinExtension(["chrome-a"], "chrome-b"), ["chrome-a", "chrome-b"]);
  assert.throws(() => pinExtension(["chrome-a", "chrome-b", "chrome-c"], "chrome-d"), /Unpin one/);
  assert.equal(actionBadge("A\u202EB\u0000CDE"), "ABCD");
  assert.equal(actionBadge(""), "");
  assert.throws(() => actionBadge(1), /string/);
  const local = { kind: "chrome", name: "Test", manifest: { name: "Test" } };
  assert.equal(sameChromePackage(local, { ...local, version: "2" }), true);
  assert.equal(sameChromePackage(local, { ...local, manifest: { name: "Another" } }), false);
  assert.equal(sameChromePackage(local, { ...local, manifest: { ...local.manifest, key: "pub" } }), false);
}

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
  assert.equal(rec.background.scripts.join(""), "a();b();");
  assert.deepEqual(rec.hostPermissions, ["https://*.legacy.org/*"]);
  assert.deepEqual(rec.permissions.granted, ["storage"]);
  assert.equal(rec.action.defaultTitle, "Legacy");
  assert.ok(rec.warnings.some(w => w.includes("event pages")));
  assert.equal(rec.backgroundKind ?? rec.background.kind, "scripts");
}

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
  assert.equal(rec.enabled, true);
  assert.doesNotThrow(() => classifyPermissions(dangerous));

  const ok = classifyPermissions(["storage", "unlimitedStorage", "alarms", "tabs"]);
  assert.deepEqual(ok.granted.sort(), ["storage", "unlimitedStorage"]);
  assert.deepEqual(ok.unsupported.sort(), ["alarms", "tabs"]);
}

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

{
  const rec = parseChromeManifest(mv3Manifest, mv3Files);
  const chrome = new Function(buildContentScriptShim(rec) + "\n;return chrome;")();

  assert.equal(chrome.runtime.id, rec.id);
  assert.equal(chrome.runtime.getManifest().name, "Example Enhancer");
  assert.equal(chrome.runtime.getManifest().manifest_version, 3);
  assert.ok(chrome.runtime.getURL("img/x.png").startsWith(`chrome-extension://${rec.id}/`));

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

  assert.throws(() => chrome.webRequest.onBeforeSendHeaders.addListener(() => {}), /chrome\.webRequest\.onBeforeSendHeaders\.addListener is not available in Veyra Browser/);
  assert.throws(() => chrome.tabs.query({ active: true }, () => {}), /chrome\.tabs\.query is not available in Veyra Browser/);
  assert.throws(() => chrome.cookies.getAll({}, () => {}), /chrome\.cookies\.getAll is not available in Veyra Browser/);
  assert.throws(() => chrome.management.getAll(() => {}), /chrome\.management\.getAll is not available in Veyra Browser/);
}

{
  const rec = parseChromeManifest(mv3Manifest, mv3Files);
  const src = buildContentScriptSource(rec);
  assert.ok(src.includes("chrome.runtime.sendMessage"));
  assert.ok(src.includes('GM_addStyle('), "CSS rides along through GM_addStyle");
  assert.ok(src.includes('"document_start"') && src.includes('"document_end"'), "run_at gating per entry");
  assert.ok(src.includes("document.addEventListener(\"DOMContentLoaded\""), "document_end waits for DOMContentLoaded");
  assert.ok(src.includes("chrome.storage"), "shim storage is defined");
  assert.ok(!/await /.test(src.replace(/\(async function[\s\S]*$/, "")), "top level stays synchronous");

  assert.ok(src.includes("setTimeout(finish, 400)"));

  const bgOnly = parseChromeManifest(
    { manifest_version: 3, name: "BgOnly", background: { service_worker: "sw.js" } }, { "sw.js": "x" });
  assert.equal(buildContentScriptSource(bgOnly).includes("cs1.js"), false);
  assert.ok(buildContentScriptSource(bgOnly).includes("var chrome"));

  assert.doesNotThrow(() => new Function(src), "the full built content-script source must be valid JavaScript");
  const i18nRec = parseChromeManifest({
    manifest_version: 3, name: "Compile", version: "1.0", default_locale: "en",
    web_accessible_resources: [{ resources: ["images/logo.png"], matches: ["*://e/*"] }],
    content_scripts: [{ matches: ["*://e/*"], js: ["cs.js"], css: ["style.css"] }]
  }, {
    "_locales/en/messages.json": JSON.stringify({ greeting: { message: "Hi $1" } }),
    "images/logo.png": "data:image/png;base64,AAA",
    "cs.js": "chrome.i18n.getMessage('greeting', ['World']);",
    "style.css": "body { outline: 3px solid rgb(255, 0, 7); }"
  });
  assert.doesNotThrow(() => new Function(buildContentScriptSource(i18nRec)), "the i18n/resources content-script source must compile");
}

{
  const rec = parseChromeManifest(mv3Manifest, mv3Files);
  const src = buildBackgroundWorkerSource(rec);
  assert.ok(src.startsWith("self.chrome"), "worker defines chrome on self");
  assert.ok(src.includes("chrome.runtime.onInstalled.addListener"), "original service worker code included unchanged");
  assert.ok(src.includes("onInstalled"), "onInstalled shim present");
  assert.ok(src.includes("__veyraRpc"), "host RPC protocol present");
  assert.ok(src.includes('rpc("storage." + area + ".get")'), "storage RPC present");

  const mv2 = parseChromeManifest(
    { manifest_version: 2, name: "L", background: { scripts: ["a.js", "b.js"] } },
    { "a.js": "first();", "b.js": "second();" });
  const mv2Src = buildBackgroundWorkerSource(mv2);
  assert.ok(mv2Src.indexOf("first();") < mv2Src.indexOf("second();"));
}

{
  assert.equal(patternMatchesUrl("*://a.example.com/*", "https://a.example.com/page?x=1"), true);
  assert.equal(patternMatchesUrl("*://*.example.com/*", "https://sub.example.com/x"), true);
  assert.equal(patternMatchesUrl("https://a.example.com/*", "http://a.example.com/x"), false);
  assert.equal(patternMatchesUrl("<all_urls>", "ftp://a.example.com/x"), false);
  assert.equal(patternMatchesUrl("<all_urls>", "https://anything.org/"), true);
  const ext = { matches: ["*://a.example.com/*"], excludeMatches: ["*://a.example.com/private/*"] };
  assert.equal(matchesUrl(ext.matches, "https://a.example.com/private/x", ext.excludeMatches), false);
  assert.equal(matchesUrl(ext.matches, "https://a.example.com/public/x", ext.excludeMatches), true);
  assert.equal(matchesUrl([], "https://any.site/", []), true);
}

{
  const entries = [
    { path: "my-ext/manifest.json", text: JSON.stringify({ manifest_version: 3, name: "Folder Ext", version: "1.0.0", content_scripts: [{ matches: ["*://f/*"], js: ["cs.js"] }] }) },
    { path: "my-ext/cs.js", text: "console.log('cs');" },
    { path: "my-ext/style.css", text: "body{color:red}" },
    { path: "my-ext/icons/icon48.png", dataUrl: "data:image/png;base64,AAA" },
    { path: "my-ext/.DS_Store", text: "junk" },
    { path: "__MACOSX/my-ext/._manifest.json", text: "junk" },
    { path: "unrelated.txt", text: "outside the extension folder" }
  ];
  const { manifest, files, rootPath } = readExtensionFolder(entries);
  assert.equal(rootPath, "my-ext/");
  assert.equal(manifest.name, "Folder Ext");
  assert.deepEqual(Object.keys(files).sort(), ["cs.js", "icons/icon48.png", "manifest.json", "style.css"]);
  assert.equal(files["cs.js"], "console.log('cs');");

  const root = readExtensionFolder([
    { path: "manifest.json", text: JSON.stringify({ manifest_version: 2, name: "Root", background: { scripts: ["bg.js"] } }) },
    { path: "bg.js", text: "x();" }
  ]);
  assert.equal(root.rootPath, "");
  assert.ok("bg.js" in root.files);

  assert.throws(() => readExtensionFolder([{ path: "a.txt", text: "x" }]), /No manifest\.json found/);
  assert.throws(() => readExtensionFolder([
    { path: "one/manifest.json", text: "{}" },
    { path: "two/manifest.json", text: "{}" }
  ]), /more than one manifest\.json/);
  assert.throws(() => readExtensionFolder([{ path: "manifest.json", text: "{oops" }]), /not valid JSON/);
  assert.throws(() => readExtensionFolder([
    { path: "manifest.json", text: JSON.stringify({ manifest_version: 3, name: "Big" }) },
    { path: "huge.js", text: "x".repeat(FOLDER_LIMITS.maxFileKb * 1024 + 1) }
  ]), /larger than/);
  const tooMany = [{ path: "manifest.json", text: JSON.stringify({ manifest_version: 3, name: "Crowd" }) }];
  for (let i = 0; i < FOLDER_LIMITS.maxFiles; i++) tooMany.push({ path: `f${i}.js`, text: "x" });
  assert.throws(() => readExtensionFolder(tooMany), /Too many files/);
  assert.equal(isBinaryPath("icons/a.png"), true);
  assert.equal(isBinaryPath("cs.js"), false);
}

{
  const folderManifest = {
    manifest_version: 3,
    name: "__MSG_appName__",
    description: "__MSG_appDesc__",
    version: "1.2.3",
    default_locale: "en",
    icons: { "48": "icons/48.png", "128": "icons/logo.svg" },
    web_accessible_resources: [{ resources: ["images/logo.png"], matches: ["*://e/*"] }],
    content_scripts: [{ matches: ["*://e/*"], js: ["cs.js"] }]
  };
  const files = {
    "_locales/en/messages.json": JSON.stringify({ appName: { message: "Localized Ext" }, appDesc: { message: "Hello $1" }, greeting: { message: "Hi $1, welcome" } }),
    "icons/48.png": "data:image/png;base64,AAA",
    "icons/logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
    "images/logo.png": "data:image/png;base64,BBB",
    "cs.js": "chrome.i18n.getMessage('greeting', ['World']);"
  };
  const rec = parseChromeManifest(folderManifest, files);
  assert.equal(rec.name, "Localized Ext", "__MSG_ substitution in name");
  assert.equal(rec.description, "Hello $1", "__MSG_ substitution in description");
  assert.equal(rec.i18n.defaultLocale, "en");
  assert.equal(rec.i18n.messages.greeting, "Hi $1, welcome");
  assert.equal(rec.iconData[48], "data:image/png;base64,AAA", "binary icon passes through as data URL");
  assert.ok(rec.iconData[128].startsWith("data:image/svg+xml,"), "SVG icon encoded to a data URL");
  assert.deepEqual(rec.resources, { "images/logo.png": "data:image/png;base64,BBB" }, "WAR files embedded for getURL");

  const missing = parseChromeManifest({ ...folderManifest, web_accessible_resources: ["gone.png"] }, files);
  assert.ok(missing.warnings.some(w => w.includes('Web-accessible resource "gone.png" is missing')));

  const plain = parseChromeManifest({ manifest_version: 3, name: "__MSG_x__", content_scripts: [{ matches: ["*://e/*"], js: ["cs.js"] }] }, files);
  assert.equal(plain.name, "__MSG_x__");
  assert.deepEqual(plain.i18n.messages, {});
}

{
  const folderManifest = {
    manifest_version: 3, name: "GetURL", version: "1.0", default_locale: "en",
    web_accessible_resources: [{ resources: ["images/logo.png", "page.html"], matches: ["*://e/*"] }],
    content_scripts: [{ matches: ["*://e/*"], js: ["cs.js"] }]
  };
  const files = {
    "_locales/en/messages.json": JSON.stringify({ greeting: { message: "Hi $1" } }),
    "images/logo.png": "data:image/png;base64,AAA",
    "page.html": "<b>hello</b>",
    "cs.js": ";"
  };
  const rec = parseChromeManifest(folderManifest, files);
  const chrome = new Function(buildContentScriptShim(rec) + "\n;return chrome;")();
  assert.equal(chrome.runtime.getURL("images/logo.png"), "data:image/png;base64,AAA", "binary WAR served as its data URL");
  const htmlUrl = chrome.runtime.getURL("page.html");
  assert.ok(htmlUrl.startsWith("blob:"), "text WAR served as a blob URL");
  assert.equal(chrome.runtime.getURL("not/a/resource.png"), `chrome-extension://${rec.id}/not/a/resource.png`, "non-WAR falls back to the placeholder");
  assert.equal(chrome.i18n.getMessage("greeting", ["World"]), "Hi World", "$1 substitution");
  assert.equal(chrome.i18n.getMessage("missing"), "", "unknown message key -> empty string");
  assert.match(chrome.i18n.getUILanguage(), /^[a-z]{2}(_[A-Z]{2})?$/);
}

{
  const rec = parseChromeManifest({
    manifest_version: 3, name: "Tabby", version: "1.0",
    background: { service_worker: "sw.js" }
  }, { "sw.js": "self.chrome.tabs.query({active:true});" });
  const src = buildBackgroundWorkerSource(rec);
  assert.ok(src.includes('rpc("tabs.query"'), "tabs.query goes through host RPC");
  assert.ok(src.includes('rpc("tabs.get"'));
  assert.ok(src.includes('rpc("tabs.create"'));
  assert.ok(src.includes('rpc("tabs.sendMessage"'));
  assert.ok(src.includes('rpc("scripting.executeScript"'), "scripting.executeScript through host RPC");
  assert.ok(src.includes("actionListeners"), "action.onClicked listener registry");
  assert.ok(src.includes("__veyraActionClick"), "host action-click delivery");
  assert.ok(src.includes("getURL: function (path)"), "getURL in the worker shim");
  assert.ok(src.includes("var MESSAGES ="), "i18n messages embedded in the worker shim");

  const posted = [];
  const fakeSelf = {
    postMessage: m => posted.push(m),
    onmessage: null
  };
  const workerChrome = new Function("self", buildBackgroundWorkerSource(rec) + "\n;return self.chrome;")(fakeSelf);
  assert.equal(workerChrome.runtime.id, rec.id);
  let clicked = null;
  workerChrome.browserAction.onClicked.addListener(tab => { clicked = tab; });
  const activeTab = { id: "veyra-tab", active: true, windowId: 1 };
  fakeSelf.onmessage({ data: { __veyraActionClick: true, tab: activeTab } });
  assert.deepEqual(clicked, activeTab, "the MV2 alias and MV3 action receive the active Veyra tab");

  const setting = workerChrome.action.getUserSettings();
  const request = posted.at(-1);
  assert.equal(request.kind, "action.getUserSettings");
  fakeSelf.onmessage({ data: { __veyraRpcReply: request.__veyraRpc, result: { isOnToolbar: true } } });
  assert.deepEqual(await setting, { isOnToolbar: true });

  const badgeSet = workerChrome.action.setBadgeText({ text: "ON" });
  const setRequest = posted.at(-1);
  assert.equal(setRequest.kind, "action.setBadgeText");
  assert.deepEqual(setRequest.payload, { text: "ON" });
  fakeSelf.onmessage({ data: { __veyraRpcReply: setRequest.__veyraRpc } });
  await badgeSet;

  const badgeGet = workerChrome.action.getBadgeText({});
  const getRequest = posted.at(-1);
  assert.equal(getRequest.kind, "action.getBadgeText");
  fakeSelf.onmessage({ data: { __veyraRpcReply: getRequest.__veyraRpc, result: "ON" } });
  assert.equal(await badgeGet, "ON");
}

console.log("Chrome extension tests passed: MV3 + MV2 parsing, permission allow/deny with warnings, missing-file errors, chrome.* shims, run_at gating, match patterns, unpacked folders, _locales i18n, web-accessible resources, tabs/scripting/action RPC.");
