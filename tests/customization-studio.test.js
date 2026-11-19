import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WORKSPACE_PRESETS } from "../web/src/workspace.js";
import {
  APPEARANCE, appearanceValues, readSetup, resolvedWallpaper, setupForExport, setupName,
  validWallpaper, DEVICE_APPEARANCE_KEYS, STUDIO_LOCAL_KEYS, MAX_SETUP_BYTES
} from "../web/src/studio-model.js";

const file = path => readFileSync(new URL(`../web/${path}`, import.meta.url), "utf8");
assert.equal(Object.keys(WORKSPACE_PRESETS).length, 6);
assert.deepEqual(appearanceValues({}), APPEARANCE);
assert.deepEqual(appearanceValues(null), APPEARANCE);
assert.deepEqual(appearanceValues({ toolbarHidden: ["vpn", "menu", "vpn", "extensions"], wallpaperStrength: 400 }).toolbarHidden, ["vpn", "extensions"]);
assert.equal(appearanceValues({ accent: "url(https://example.com)" }).accent, APPEARANCE.accent);
assert.equal(appearanceValues({ studioSound: "other", studioVolume: 120 }).studioVolume, 100);
assert.equal(appearanceValues({ studioMotion: "true" }).studioMotion, false);
assert.equal(setupName(" Test\u202E name "), "Test name");

const image = "data:image/webp;base64,aGVsbG8=";
assert.equal(validWallpaper(image), true);
assert.equal(validWallpaper("data:image/svg+xml;base64,aGVsbG8="), false);
assert.equal(validWallpaper(`${image}'");url(https://example.com)`), false);
assert.equal(resolvedWallpaper(APPEARANCE, ""), "none");
assert.equal(resolvedWallpaper({ ...APPEARANCE, workspacePreset: "pulse" }, ""), "orbit");
assert.equal(resolvedWallpaper({ ...APPEARANCE, workspacePreset: "pulse", studioWallpaper: "signal" }, ""), "signal");
assert.equal(resolvedWallpaper({ ...APPEARANCE, studioWallpaper: "custom" }, image), "custom");
assert.equal(resolvedWallpaper({ ...APPEARANCE, studioWallpaper: "custom" }, ""), "none");
assert.equal(resolvedWallpaper({ ...APPEARANCE, studioWallpaper: "orbit", gameFocus: true }, ""), "none");

const config = setupForExport("Late night", {
  ...APPEARANCE, accent: "#88AAFF", studioWallpaper: "custom", studioSound: "synth", theme: "light",
  history: [{ url: "https://private.example" }], ntpTiles: [{}], adminToken: "test", image, __proto__: { homepage: "test" }
});
assert.equal(config.appearance.studioWallpaper, "none");
assert.equal(config.appearance.studioSound, "synth");
assert.equal(config.appearance.accent, "#88aaff");
assert.deepEqual(Object.keys(config.appearance), Object.keys(APPEARANCE));
assert.deepEqual(readSetup(JSON.stringify(config)), config);
assert.deepEqual(readSetup('{"format":"veyra-appearance","version":1,"appearance":{"theme":"light","__proto__":{"polluted":true},"adminToken":"ignored"}}').appearance, { ...APPEARANCE, theme: "light" });
assert.equal({}.polluted, undefined);
for (const invalid of [
  "not JSON", " ", "x".repeat(MAX_SETUP_BYTES + 1),
  JSON.stringify({ ...config, version: 2 }),
  JSON.stringify({ ...config, appearance: { adminToken: "test" } }),
  JSON.stringify({ ...config, appearance: { theme: "light", toolbarHidden: ["menu"] } }),
  JSON.stringify({ ...config, appearance: { accent: "red" } }),
  JSON.stringify({ ...config, appearance: { studioVolume: -1 } })
]) assert.throws(() => readSetup(invalid));

for (const entry of ["index.html", "browse/index.html"]) {
  assert.match(file(entry), /id="studioBtn"/);
  assert.match(file(entry), /id="ntpStudioBtn"/);
  const bootstrap = file(entry).match(/bootstrap\.js\?v=[\w.-]+/)?.[0];
  assert.ok(bootstrap && file("sw.js").includes(bootstrap), "Studio entry and service worker agree on the shell release");
}
assert.match(file("src/core.js"), /EPHEMERAL_KEYS = new Set\(\[[\s\S]*?\.\.\.STUDIO_LOCAL_KEYS/);
assert.match(file("src/ui.js"), /for \(const key of \[\.\.\.DEVICE_APPEARANCE_KEYS,[^\]]*\]\) delete s\[key\]/);
assert.match(file("src/ui.js"), /for \(const key of \[\.\.\.DEVICE_APPEARANCE_KEYS,[^\]]*\]\) delete remote\[key\]/);
assert.ok(!DEVICE_APPEARANCE_KEYS.includes(STUDIO_LOCAL_KEYS[0])); // Image data lives outside the settings object.
assert.match(file("src/app.js"), /"customize", "customise", "customization-studio"[\s\S]*?view: "settings", section: "appearance"/);
console.log("Customization Studio: defaults, presets, safe setup imports, device-only assets and route wiring passed.");
