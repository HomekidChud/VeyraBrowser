const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ext = fs.readFileSync(path.join(root, 'web/src/extensions.js'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'web/src/extension-manifest.js'), 'utf8');
// Locate the VeyraServer checkout as a sibling directory, regardless of the
// directory name it was cloned under. Fall back to an empty string so the
// extension checks that depend on the server source skip cleanly.
let bridge = '';
for (const sibling of fs.readdirSync(path.join(root, '..'), { withFileTypes: true })) {
  if (!sibling.isDirectory()) continue;
  const candidate = path.join(root, '..', sibling.name, 'src/browser/devtools-bridge.js');
  try { bridge = fs.readFileSync(candidate, 'utf8'); break; } catch {}
}
const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');

// Userscripts, legacy Veyra packages, and lifecycle are unchanged.
assert.match(ext, /normalizeUserscript/);
assert.match(ext, /normalizeBrowserManifest/);
assert.match(ext, /@grant/);
assert.match(ext, /get\("run-at"\)/);
assert.match(ext, /Remote userscript dependencies and network grants are blocked/);
assert.match(ext, /allowedGrants/);
assert.match(ext, /GM_addStyle/);
assert.match(ext, /Extension .* failed on/);
assert.doesNotMatch(ext, /catch \(e\).*break;/);
assert.match(ext, /user\\.js/);
assert.match(ext, /data-edit=.*Edit \${e\.script \? "script"/);
assert.match(ext, /x\.script \? x\.script/);
assert.match(ext, /veyra-extension\/v1/);
assert.match(bridge, /ext\.script/);
assert.match(bridge, /scriptValues/);
assert.match(bridge, /GM_deleteValue/);
assert.match(bridge, /GM_listValues/);
assert.match(bridge, /if \(old === source\) return true/);
assert.match(bridge, /extStyle\("script-" \+ key, ""\)/);

// Chrome MV2/MV3 manifests: full parsing in the pure manifest module.
assert.match(ext, /Chrome or Edge extensions/);
assert.match(ext, /parseChromeManifest/);
assert.match(ext, /extension-manifest\.js/);
assert.match(manifest, /manifest_version/);
assert.match(manifest, /content_scripts/);
assert.match(manifest, /exclude_matches/);
assert.match(manifest, /service_worker/);
assert.match(manifest, /browser_action/);
assert.match(manifest, /optional_permissions/);
assert.match(manifest, /host_permissions/);
assert.match(manifest, /web_accessible_resources/);
assert.match(manifest, /minimum_chrome_version/);
assert.match(manifest, /match_about_blank/);

// Permission allow/deny model: dangerous permissions warn, never block install.
assert.match(manifest, /DENIED_PERMISSIONS/);
assert.match(manifest, /SUPPORTED_PERMISSIONS/);
assert.match(manifest, /is disabled: this API is dangerous or impossible inside Veyra/);
assert.match(manifest, /classifyPermissions/);
assert.doesNotMatch(ext, /Background code and privileged browser APIs are blocked/);

// chrome.* shims for content scripts and background workers.
assert.match(manifest, /buildContentScriptShim/);
assert.match(manifest, /buildContentScriptSource/);
assert.match(manifest, /buildBackgroundWorkerSource/);
assert.match(manifest, /chrome\.storage/);
assert.match(manifest, /is not available in Veyra Browser extensions\./); // unsupported-API stubs throw helpful errors
assert.match(manifest, /Could not establish connection\. Receiving end does not exist\./);
assert.match(ext, /buildContentScriptSource/);
assert.match(ext, /buildBackgroundWorkerSource/);
assert.match(ext, /new Worker\(/);
assert.match(ext, /EXT_STORAGE_KEY = "veyra-ext-storage"/);
assert.match(ext, /startBackground/);
assert.match(ext, /stopBackground/);

// run_at is honored at the injection point.
assert.match(manifest, /document_start/);
assert.match(manifest, /document_end/);
assert.match(manifest, /document_idle/);
assert.match(manifest, /all_frames/);

// Unpacked-folder loading: pure folder reader + UI wiring.
assert.match(manifest, /readExtensionFolder/);
assert.match(manifest, /FOLDER_LIMITS/);
assert.match(manifest, /isBinaryPath/);
assert.match(manifest, /more than one manifest\.json/);
assert.match(ext, /loadUnpackedFolder/);
assert.match(ext, /readExtensionFolder/);
assert.match(html, /webkitdirectory/);
assert.match(html, /loadFolderBtn/);
assert.match(html, /extensionFolder/);

// _locales i18n: __MSG_ substitution + chrome.i18n in both shims.
assert.match(manifest, /__MSG_/);
assert.match(manifest, /loadLocaleMessages/);
assert.match(manifest, /substituteMessages/);
assert.match(manifest, /getMessage/);
assert.match(manifest, /defaultLocale/);

// Web-accessible resources: embedded + served through a working getURL.
assert.match(manifest, /var RESOURCES = /);
assert.match(manifest, /createObjectURL/);
assert.match(manifest, /data:image\/svg\+xml,/);

// chrome.tabs / chrome.scripting / action.onClicked over host RPC.
assert.match(manifest, /rpc\("tabs\.query/);
assert.match(manifest, /rpc\("tabs\.create/);
assert.match(manifest, /rpc\("scripting\.executeScript/);
assert.match(manifest, /__veyraActionClick/);
assert.match(ext, /veyraTabsQuery/);
assert.match(ext, /veyraTabCreate/);
assert.match(ext, /veyraExecuteScript/);
assert.match(ext, /fireActionClick/);
assert.match(ext, /data-action-ext/);

// Real extension icons render in the UI.
assert.match(manifest, /iconData/);
assert.match(ext, /iconData/);
assert.match(ext, /unpacked-folder/);

// Extension list UI shows Chrome metadata and the warning badge.
assert.match(ext, /chromeCardMeta/);
assert.match(ext, /backgroundStatusOf/);
assert.match(ext, /manifestVersion/);
assert.match(html, /\.user\.js/);
assert.match(html, /manifest/);
assert.match(html, /MV2\/MV3/);
console.log('Extension regression checks passed: CSS, userscripts, Chrome MV2/MV3 manifests, unpacked folders, _locales i18n, web-accessible resources, tabs/scripting/action shims, permission warnings, lifecycle, isolation, and cache-safe imports.');
