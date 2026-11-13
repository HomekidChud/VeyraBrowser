// Chrome (MV2/MV3) extension manifest handling for Veyra Browser.
//
// This module is intentionally dependency-free (no imports): the browser app
// loads it for manifest parsing and shim building, and the node test suite
// imports it directly to unit-test the normalization logic.
//
// Design notes
// ------------
// - parseChromeManifest() is the pure parser: it never touches Veyra storage
//   or settings, so it can run inside `node tests/chrome-extensions.test.js`.
// - buildContentScriptSource() returns JS source that runs inside the page
//   through the existing `ext.script` DevTools-bridge channel. It prepends a
//   chrome.*-compatible shim (runtime messaging, storage, unsupported-API
//   stubs that throw helpful errors) and wraps every content_scripts entry so
//   run_at is respected whenever the injection point allows it.
// - buildBackgroundWorkerSource() returns JS source for an inline Web Worker
//   (classic, or module for MV3 `background.type: "module"`). The worker shim
//   talks to the Veyra host over postMessage RPC: storage is persisted by the
//   host under a per-extension namespace, so background code never touches
//   Veyra's own storage keys.

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const arr = v => Array.isArray(v) ? v : [];

export const RUN_AT_VALUES = ["document_start", "document_end", "document_idle"];

// Permissions the Veyra shim actually implements.
export const SUPPORTED_PERMISSIONS = new Set(["storage", "unlimitedStorage"]);

// Dangerous / impossible-in-a-web-app permissions: the extension still
// installs, but these are stripped and surfaced as a visible warning badge.
export const DENIED_PERMISSIONS = new Set([
  "nativeMessaging", "cookies", "webRequest", "webRequestBlocking", "webRequestAuthProvider",
  "debugger", "management", "proxy", "privacy", "downloads", "downloads.ui", "identity",
  "platformKeys", "documentScan", "certificateProvider", "fileBrowserHandler", "mediaRouter",
  "tts", "ttsEngine", "usb", "serial", "bluetooth", "bluetoothLowEnergy", "declarativeNetRequest"
]);

export function classifyPermissions(list) {
  const granted = [], denied = [], unsupported = [];
  for (const raw of arr(list)) {
    const p = String(raw);
    if (SUPPORTED_PERMISSIONS.has(p)) granted.push(p);
    else if (DENIED_PERMISSIONS.has(p)) denied.push(p);
    else unsupported.push(p);
  }
  return { granted, denied, unsupported };
}

export function isHostPattern(p) {
  const v = String(p || "");
  return v === "<all_urls>" || v.includes("://") || v.includes("/") || v.startsWith("*.");
}

// --- URL pattern matching (same semantics the old matches() used) -----------

export function patternMatchesUrl(rawPattern, rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return false; }
  const pattern = String(rawPattern || "").trim().toLowerCase();
  if (pattern === "<all_urls>" || pattern === "*") return /^https?:$/.test(url.protocol);
  const parsed = pattern.match(/^(?:(\*|https?):\/\/)?([^/]+)(\/.*)?$/);
  if (!parsed) return false;
  const [, scheme = "*", host = "", path = "/*"] = parsed;
  if (scheme !== "*" && url.protocol !== `${scheme}:`) return false;
  const hostname = url.hostname.toLowerCase();
  const hostOk = host === "*" ? true
    : host.startsWith("*.") ? hostname === host.slice(2) || hostname.endsWith(`.${host.slice(2)}`)
    : hostname === host || hostname === `www.${host}`;
  if (!hostOk) return false;
  const re = new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return re.test(url.pathname + url.search);
}

export function matchesUrl(patterns, rawUrl, excludes = []) {
  const list = arr(patterns).length ? arr(patterns) : ["<all_urls>"];
  if (excludes.some(x => patternMatchesUrl(x, rawUrl))) return false;
  return list.some(p => patternMatchesUrl(p, rawUrl));
}

// --- Manifest parsing -------------------------------------------------------

function manifestId(name, version) {
  const seed = `${name}:${version}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
  let h1 = 0x811c9dc5, h2 = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h1 = (h1 ^ seed.charCodeAt(i)) * 16777619 % 0x100000000;
    h2 = (h2 + seed.charCodeAt(i) * 31) % 0x100000000;
  }
  const rand = Math.random().toString(36).slice(2, 10).replace(/[^a-z]/g, "");
  return "chrome-" + (h1.toString(36) + h2.toString(36)).replace(/[^a-z0-9]/g, "").slice(0, 24).padEnd(20, "0") + rand.slice(0, 6);
}

function readFiles(files, paths, what, strict) {
  const out = [];
  for (const p of arr(paths)) {
    const code = files[String(p)];
    if (typeof code !== "string") {
      if (strict) throw new Error(`Missing ${what}: ${p}`);
      return null;
    }
    out.push(code);
  }
  return out;
}

/**
 * Parse a Chrome MV2/MV3 manifest into a Veyra extension record.
 * Throws for fatal problems (bad manifest shape, missing content script or
 * background files, remote dependencies). Collects recoverable issues in
 * `warnings` (dangerous permissions, unsupported metadata, etc.) — the caller
 * shows those as a badge instead of blocking install.
 */
export function parseChromeManifest(manifest, files = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("The extension manifest must be a JSON object.");
  const mv = Number(manifest.manifest_version);
  if (mv !== 2 && mv !== 3) {
    if (mv === 1) throw new Error("Manifest version 1 is obsolete; Veyra supports Chrome MV2 and MV3 extensions.");
    throw new Error(`Unsupported manifest_version ${str(manifest.manifest_version, 20) || "(missing)"}; Veyra supports Chrome MV2 and MV3 extensions.`);
  }
  const name = str(manifest.name, 80);
  if (!name) throw new Error("The extension manifest is missing a name.");
  const warnings = [];
  const version = str(manifest.version, 20);
  if (!version) warnings.push("Manifest has no version; defaulting to 1.0.0.");

  // icons (metadata only; missing icon files are a warning, not an error)
  const icons = {};
  for (const [size, path] of Object.entries(manifest.icons && typeof manifest.icons === "object" ? manifest.icons : {})) {
    icons[size] = String(path);
    if (typeof files[String(path)] !== "string") warnings.push(`Icon file "${path}" is missing from the bundle.`);
  }

  // content_scripts: multiple entries, each with its own match/run_at rules
  const contentScripts = [];
  const matchSet = new Set(), excludeSet = new Set(), cssParts = [], jsParts = [];
  for (const group of arr(manifest.content_scripts)) {
    if (!group || typeof group !== "object") continue;
    const matches = arr(group.matches).map(String).slice(0, 30);
    const excludeMatches = arr(group.exclude_matches).map(String).slice(0, 30);
    const js = readFiles(files, group.js, "content script", true);
    const css = readFiles(files, group.css, "stylesheet", true);
    let runAt = "document_idle";
    if (group.run_at != null) {
      if (RUN_AT_VALUES.includes(group.run_at)) runAt = group.run_at;
      else warnings.push(`Unsupported run_at "${group.run_at}"; using document_idle.`);
    }
    const allFrames = !!group.all_frames;
    if (allFrames) warnings.push("all_frames is requested, but Veyra injects content scripts into the top frame only.");
    if (group.match_about_blank) warnings.push("match_about_blank is not supported; about:blank frames are not injected.");
    contentScripts.push({ matches, excludeMatches, js, css, runAt, allFrames, matchAboutBlank: !!group.match_about_blank });
    matches.forEach(m => matchSet.add(m));
    excludeMatches.forEach(m => excludeSet.add(m));
    cssParts.push(...css);
    jsParts.push(...js);
  }

  // background: MV3 service worker or MV2 scripts, run in an inline worker
  let background = null;
  const bg = manifest.background;
  if (bg && typeof bg === "object") {
    if (mv === 3 && bg.service_worker) {
      const code = readFiles(files, [bg.service_worker], "background service worker", true)[0];
      background = { kind: "service_worker", serviceWorker: String(bg.service_worker), type: String(bg.type || "classic"), scripts: [code] };
      if (bg.type === "module" && /^\s*import\b/m.test(code)) warnings.push("The service worker uses ES module imports, which Veyra's blob workers cannot resolve; background may fail to start.");
      if (/\bimportScripts\s*\(\s*["']/.test(code)) warnings.push("The background code calls importScripts() with a relative path, which blob workers cannot resolve.");
    } else if (arr(bg.scripts).length) {
      if (mv === 3) warnings.push("MV3 manifests should use background.service_worker; treating background.scripts as classic scripts.");
      const scripts = readFiles(files, bg.scripts, "background script", true);
      background = { kind: "scripts", serviceWorker: null, type: "classic", scripts };
      if (bg.page) warnings.push("background.page is not supported; background scripts run in a sandboxed worker instead.");
      if (bg.persistent === false) warnings.push("MV2 event pages (persistent: false) run like normal background workers in Veyra.");
    } else if (bg.page) {
      throw new Error("background.page is not supported; provide background.scripts or a service_worker instead.");
    }
  }

  if (!contentScripts.length && !background) throw new Error("This manifest has no supported content scripts, styles, or background code.");

  // Remote userscript-style dependencies stay blocked for code we execute.
  const allCode = [...jsParts, ...(background ? background.scripts : [])].join("\n");
  if (allCode && /@(?:require|resource|connect)\b/i.test(allCode)) throw new Error("Remote userscript dependencies and network grants are blocked.");

  // permissions: allow/deny model with visible warnings, never install blockers
  const permList = arr(manifest.permissions).map(String);
  const optionalList = arr(manifest.optional_permissions).map(String);
  const hostPatterns = permList.filter(isHostPattern);
  const apiPerms = permList.filter(p => !isHostPattern(p));
  const hosts = [...new Set([...arr(mv === 3 ? manifest.host_permissions : []).map(String), ...hostPatterns])].slice(0, 30);
  const classified = classifyPermissions(apiPerms);
  const optionalClassified = classifyPermissions(optionalList);
  for (const p of classified.denied) warnings.push(`Permission "${p}" is disabled: this API is dangerous or impossible inside Veyra, so the extension installs without it.`);
  for (const p of [...new Set([...classified.unsupported, ...optionalClassified.unsupported])]) warnings.push(`Permission "${p}" has no Veyra implementation; calls to that API throw a helpful error.`);
  const denied = [...new Set([...classified.denied, ...optionalClassified.denied])];

  // web_accessible_resources (MV3 objects / MV2 strings)
  const war = arr(manifest.web_accessible_resources).map(r => r && typeof r === "object"
    ? { resources: arr(r.resources).map(String), matches: arr(r.matches).map(String) }
    : String(r));

  // action / browser_action metadata
  const actionMeta = manifest.action || manifest.browser_action || null;
  const action = actionMeta && typeof actionMeta === "object" ? {
    defaultTitle: str(actionMeta.default_title, 100),
    defaultIcon: actionMeta.default_icon && typeof actionMeta.default_icon === "object" ? { ...actionMeta.default_icon } : null,
    defaultPopup: actionMeta.default_popup ? String(actionMeta.default_popup) : null
  } : null;
  if (action?.defaultPopup) warnings.push("Action popups are not supported; the action is recorded as metadata only.");

  if (manifest.options_ui || manifest.options_page) warnings.push("Options pages are not supported.");
  if (manifest.devtools_page) warnings.push("devtools_page is not supported.");
  if (manifest.commands) warnings.push("Keyboard commands are not supported.");
  if (manifest.externally_connectable) warnings.push("externally_connectable is not supported.");

  const minimumChromeVersion = str(manifest.minimum_chrome_version, 12);
  const minVer = parseInt(minimumChromeVersion, 10);
  if (Number.isFinite(minVer) && minVer > 120) warnings.push(`The extension requires Chrome >= ${minVer}; some APIs it uses may be missing from the Veyra shim.`);

  return {
    id: manifestId(name, version),
    kind: "chrome",
    manifestVersion: mv,
    name,
    version: version || "1.0.0",
    description: str(manifest.description, 300) || `Imported Chrome MV${mv} extension`,
    icons,
    contentScripts,
    css: cssParts.join("\n"),
    script: jsParts.join("\n\n"),
    matches: [...matchSet].slice(0, 30),
    excludeMatches: [...excludeSet].slice(0, 30),
    background,
    permissions: {
      granted: classified.granted,
      denied,
      unsupported: [...new Set([...classified.unsupported, ...optionalClassified.unsupported])],
      optional: optionalList
    },
    hostPermissions: hosts,
    webAccessibleResources: war,
    action,
    minimumChromeVersion,
    warnings,
    enabled: true,
    installedAt: Date.now(),
    source: "browser-manifest",
    verified: false,
    publisher: "Local import",
    author: str(manifest.author, 100)
  };
}

// --- chrome.* shim for content scripts --------------------------------------
//
// Runs inside the remote page (via the DevTools bridge's ext.script channel).
// Storage is namespaced per extension id in the page's own localStorage
// (a remote page can never reach Veyra's origin storage) with an in-memory
// fallback for opaque origins. Unsupported APIs (webRequest, tabs, ...) become
// proxies that throw a descriptive error when called, so a real Chrome
// content script keeps running as unchanged as possible.

export function buildContentScriptShim(ext) {
  const manifest = {
    manifest_version: ext.manifestVersion,
    name: ext.name,
    version: ext.version,
    description: ext.description,
    permissions: [...(ext.permissions?.granted || []), ...(ext.permissions?.unsupported || [])],
    host_permissions: ext.hostPermissions || []
  };
  return `var chrome = (function () {
  var EXT_ID = ${JSON.stringify(ext.id)};
  var MANIFEST = ${JSON.stringify(manifest)};
  var NS = "veyra-ext:" + EXT_ID + ":";
  var here = function () { return typeof location !== "undefined" ? location.href : ""; };

  // ---- storage backend: page-localStorage, namespaced per extension ----
  var ls = null;
  try { ls = globalThis.localStorage; ls.getItem(NS + "local"); } catch (e) { ls = null; }
  var mem = { local: {}, sync: {} };
  function readStore(area) {
    if (ls) { try { var raw = ls.getItem(NS + area); var v = raw ? JSON.parse(raw) : null; if (v && typeof v === "object") return v; } catch (e) {} }
    return mem[area];
  }
  function writeStore(area, value) {
    mem[area] = value;
    if (ls) { try { ls.setItem(NS + area, JSON.stringify(value)); } catch (e) {} }
  }
  function bytesOf(value) { try { return JSON.stringify(value).length; } catch (e) { return 0; } }
  function storageArea(area, quota) {
    return {
      get: function (keys, cb) {
        var store = readStore(area), out = {};
        if (keys == null) { out = {}; for (var k in store) out[k] = store[k]; }
        else if (typeof keys === "string") out[keys] = store[keys];
        else if (Array.isArray(keys)) { for (var i = 0; i < keys.length; i++) out[keys[i]] = store[keys[i]]; }
        else if (typeof keys === "object") { out = {}; for (var k2 in keys) out[k2] = keys[k2]; for (var k3 in store) if (k3 in out) out[k3] = store[k3]; }
        if (typeof cb === "function") { cb(out); return undefined; }
        return Promise.resolve(out);
      },
      set: function (items, cb) {
        var store = readStore(area);
        for (var k in items) store[k] = items[k];
        if (area === "sync" && bytesOf(store) > quota) throw new Error("chrome.storage.sync quota exceeded (" + quota + " bytes max in Veyra).");
        writeStore(area, store);
        if (typeof cb === "function") cb();
        return undefined;
      },
      remove: function (keys, cb) {
        var store = readStore(area);
        (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { delete store[k]; });
        writeStore(area, store);
        if (typeof cb === "function") cb();
        return undefined;
      },
      clear: function (cb) {
        writeStore(area, {});
        if (typeof cb === "function") cb();
        return undefined;
      },
      getBytesInUse: function (keys, cb) {
        var store = readStore(area), total = 0;
        if (keys == null) total = bytesOf(store);
        else (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { total += bytesOf(store[k] == null ? null : store[k]); });
        if (typeof cb === "function") { cb(total); return undefined; }
        return Promise.resolve(total);
      }
    };
  }

  // ---- runtime messaging (same-page listeners; remote pages cannot reach
  //      Veyra's background worker, so sendMessage behaves like Chrome with
  //      no other end connected) ----
  var listeners = new Set();
  var lastError = null;
  var BUS = "__veyraChromeExtBus";
  var bus = (globalThis[BUS] = globalThis[BUS] || new Map());
  var pageListeners = bus.get(EXT_ID) || new Set();
  bus.set(EXT_ID, pageListeners);
  function onMessageRegistry(set) {
    return {
      addListener: function (fn) { if (typeof fn === "function") set.add(fn); },
      removeListener: function (fn) { set.delete(fn); },
      hasListener: function (fn) { return set.has(fn); }
    };
  }
  var runtime = {
    id: EXT_ID,
    get lastError() { return lastError; },
    getManifest: function () { return JSON.parse(JSON.stringify(MANIFEST)); },
    getURL: function (path) { return "chrome-extension://" + EXT_ID + "/" + String(path || "").replace(/^\\/+/, ""); },
    sendMessage: function () {
      var args = Array.prototype.slice.call(arguments);
      var msg = args[0], cb = null;
      if (args.length > 1 && typeof args[0] === "string" && args[0] !== EXT_ID) {
        if (typeof args[args.length - 1] === "function") args[args.length - 1]();
        return;
      }
      for (var i = args.length - 1; i >= 1; i--) if (typeof args[i] === "function") { cb = args[i]; break; }
      lastError = null;
      var targets = Array.from(pageListeners);
      if (!targets.length) {
        lastError = { message: "Could not establish connection. Receiving end does not exist." };
        if (cb) cb();
        else if (typeof Promise !== "undefined") return Promise.resolve();
        return;
      }
      var responded = false;
      var respond = function (v) { if (!responded && cb) { responded = true; cb(v); } };
      var async = false;
      var sender = { id: EXT_ID, url: here(), tab: null };
      targets.forEach(function (fn) {
        try { if (fn(msg, sender, respond) === true) async = true; }
        catch (e) { try { console.error("[chrome shim " + EXT_ID + "] onMessage listener failed:", e); } catch (e2) {} }
      });
      if (!async) respond(undefined);
    },
    onMessage: onMessageRegistry(pageListeners),
    onInstalled: { addListener: function () {}, removeListener: function () {}, hasListener: function () { return false; } }
  };

  // ---- unsupported APIs: callable-looking stubs that throw ----
  function unsupported(path) {
    var fn = function () { throw new Error("chrome." + path + " is not available in Veyra Browser extensions."); };
    try { fn.toString = function () { return "function () { [chrome shim: " + path + " unsupported] }"; } } catch (e) {}
    return new Proxy(fn, {
      get: function (target, key) {
        if (key === Symbol.toPrimitive || key === "then" || key === "toJSON") return undefined;
        return typeof key === "string" ? unsupported(path + "." + key) : undefined;
      },
      apply: function () { throw new Error("chrome." + path + " is not available in Veyra Browser extensions."); }
    });
  }
  var PASSTHRU = { then: 1, toJSON: 1, constructor: 1, valueOf: 1, toString: 1 };
  var base = {
    runtime: runtime,
    storage: {
      local: storageArea("local", 5 * 1024 * 1024),
      sync: storageArea("sync", 8192),
      onChanged: { addListener: function () {}, removeListener: function () {}, hasListener: function () { return false; } }
    }
  };
  return new Proxy(base, {
    get: function (target, key) {
      if (typeof key !== "string") return target[key];
      if (key in target) return target[key];
      if (PASSTHRU[key]) return undefined;
      return unsupported(String(key));
    },
    has: function () { return true; }
  });
})();`;
}

/**
 * Build the full source injected into a page for a Chrome extension:
 * shim + GM_addStyle(css) + every content_scripts entry wrapped so run_at
 * (document_start/document_end/document_idle) is respected whenever the
 * DevTools-bridge injection point allows it.
 */
export function buildContentScriptSource(ext) {
  const css = String(ext.css || "");
  const parts = [buildContentScriptShim(ext)];
  if (css.trim()) parts.push(`GM_addStyle(${JSON.stringify(css)});`);
  for (const entry of arr(ext.contentScripts)) {
    const code = arr(entry.js).join("\n;\n");
    if (!code.trim()) continue;
    parts.push(`(async function () {
  var runAt = ${JSON.stringify(entry.runAt || "document_idle")};
  await new Promise(function (resolve) {
    var state = document.readyState;
    if (runAt === "document_start" || state === "interactive" || state === "complete") return resolve();
    if (runAt === "document_end") return document.addEventListener("DOMContentLoaded", function () { resolve(); }, { once: true });
    var done = false;
    var finish = function () { if (!done) { done = true; resolve(); } };
    document.addEventListener("load", finish, { once: true });
    setTimeout(finish, 400);
  });
  try {
${code}
  } catch (e) { try { console.error("[chrome shim ${JSON.stringify(ext.id)}] content script failed:", e); } catch (e2) {} }
})();`);
  }
  return parts.join("\n\n");
}

// --- chrome.* shim for background workers -----------------------------------
//
// Runs inside an inline Web Worker owned by the Veyra app. Storage and
// runtime.sendMessage go through postMessage RPC to the host, which persists
// them under a per-extension namespace (never Veyra's own storage keys).

export function buildBackgroundWorkerSource(ext) {
  const manifest = {
    manifest_version: ext.manifestVersion,
    name: ext.name,
    version: ext.version,
    description: ext.description,
    permissions: [...(ext.permissions?.granted || []), ...(ext.permissions?.unsupported || [])],
    host_permissions: ext.hostPermissions || []
  };
  const code = arr(ext.background?.scripts).join("\n;\n");
  return `${`self.chrome = (function () {
  var EXT_ID = ${JSON.stringify(ext.id)};
  var MANIFEST = ${JSON.stringify(manifest)};
  var NS = "veyra-ext:" + EXT_ID + ":";
  var seq = 0;
  var pending = new Map();
  function rpc(kind, payload) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      self.postMessage({ __veyraRpc: id, ext: EXT_ID, kind: kind, payload: payload });
      setTimeout(function () {
        if (pending.has(id)) { pending.delete(id); reject(new Error("Veyra extension host did not respond in time.")); }
      }, 15000);
    });
  }
  var listeners = new Set();
  var installed = new Set();
  var lastError = null;
  var runtime = {
    id: EXT_ID,
    get lastError() { return lastError; },
    getManifest: function () { return JSON.parse(JSON.stringify(MANIFEST)); },
    getURL: function (path) { return "chrome-extension://" + EXT_ID + "/" + String(path || "").replace(/^\\/+/, ""); },
    sendMessage: function (msg, cb) {
      lastError = null;
      rpc("sendMessage", msg).then(function (r) {
        if (cb) { lastError = r && r.lastError ? r.lastError : null; cb(r ? r.response : undefined); }
      }, function (e) {
        if (cb) { lastError = { message: e.message }; cb(); }
      });
    },
    onMessage: {
      addListener: function (fn) { if (typeof fn === "function") listeners.add(fn); },
      removeListener: function (fn) { listeners.delete(fn); },
      hasListener: function (fn) { return listeners.has(fn); }
    },
    onInstalled: {
      addListener: function (fn) { if (typeof fn === "function") installed.add(fn); },
      removeListener: function (fn) { installed.delete(fn); },
      hasListener: function (fn) { return installed.has(fn); }
    }
  };
  function deliver(area) {
    return {
      get: function (keys, cb) {
        return rpc("storage." + area + ".get").then(function (store) {
          var out = {};
          if (keys == null) { out = {}; for (var k in store) out[k] = store[k]; }
          else if (typeof keys === "string") out[keys] = store[keys];
          else if (Array.isArray(keys)) { for (var i = 0; i < keys.length; i++) out[keys[i]] = store[keys[i]]; }
          else if (typeof keys === "object") { out = {}; for (var k2 in keys) out[k2] = keys[k2]; for (var k3 in store) if (k3 in out) out[k3] = store[k3]; }
          if (typeof cb === "function") { cb(out); return undefined; }
          return out;
        });
      },
      set: function (items, cb) { return rpc("storage." + area + ".set", items).then(function () { if (typeof cb === "function") cb(); }); },
      remove: function (keys, cb) { return rpc("storage." + area + ".remove", Array.isArray(keys) ? keys : [keys]).then(function () { if (typeof cb === "function") cb(); }); },
      clear: function (cb) { return rpc("storage." + area + ".clear").then(function () { if (typeof cb === "function") cb(); }); }
    };
  }
  function unsupported(path) {
    var fn = function () { throw new Error("chrome." + path + " is not available in Veyra Browser extensions."); };
    try { fn.toString = function () { return "function () { [chrome shim: " + path + " unsupported] }"; } } catch (e) {}
    return new Proxy(fn, {
      get: function (target, key) {
        if (key === Symbol.toPrimitive || key === "then" || key === "toJSON") return undefined;
        return typeof key === "string" ? unsupported(path + "." + key) : undefined;
      },
      apply: function () { throw new Error("chrome." + path + " is not available in Veyra Browser extensions."); }
    });
  }
  var PASSTHRU = { then: 1, toJSON: 1, constructor: 1, valueOf: 1, toString: 1 };
  var base = {
    runtime: runtime,
    storage: {
      local: deliver("local"),
      sync: deliver("sync"),
      onChanged: { addListener: function () {}, removeListener: function () {}, hasListener: function () { return false; } }
    }
  };
  self.onmessage = function (ev) {
    var m = ev.data;
    if (!m) return;
    if (m.__veyraRpcReply) {
      var p = pending.get(m.__veyraRpcReply);
      if (p) {
        pending.delete(m.__veyraRpcReply);
        if (m.error) p.reject(new Error(m.error));
        else p.resolve(m.result);
      }
      return;
    }
    if (m.__veyraMessage) {
      var respond = function (response) { self.postMessage({ __veyraSendResponse: m.__veyraMessage, response: response }); };
      listeners.forEach(function (fn) {
        try { fn(m.message, { id: EXT_ID }, respond); } catch (e) {}
      });
    }
  };
  var chromeObj = new Proxy(base, {
    get: function (target, key) {
      if (typeof key !== "string") return target[key];
      if (key in target) return target[key];
      if (PASSTHRU[key]) return undefined;
      return unsupported(String(key));
    },
    has: function () { return true; }
  });
  queueMicrotask(function () {
    installed.forEach(function (fn) { try { fn({ reason: "install" }); } catch (e) {} });
  });
  return chromeObj;
})();`}

${code}`;
}
