import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WORKSPACE_PRESETS } from "../web/src/workspace.js";
import {
  APPEARANCE, appearanceValues, readSetup, resolvedWallpaper, setupForExport, setupName,
  validWallpaper, DEVICE_APPEARANCE_KEYS, STUDIO_LOCAL_KEYS, MAX_SETUP_BYTES, WALLPAPERS, moveToolbarItem, toolbarOrder
} from "../web/src/studio-model.js";

const file = path => readFileSync(new URL(`../web/${path}`, import.meta.url), "utf8");
assert.equal(Object.keys(WORKSPACE_PRESETS).length, 12);
assert.ok(Object.values(WORKSPACE_PRESETS).every(preset => Object.hasOwn(WALLPAPERS, preset.wallpaper)));
assert.deepEqual(toolbarOrder(["downloads", "downloads", "menu"]), ["downloads", "vpn", "extensions"]);
assert.deepEqual(moveToolbarItem(["downloads", "vpn", "extensions"], "downloads", -1), ["downloads", "vpn", "extensions"]);
assert.deepEqual(moveToolbarItem([], "extensions", -1), ["extensions", "vpn", "downloads"]);
assert.deepEqual(moveToolbarItem([], "unknown", 1), APPEARANCE.toolbarOrder);
assert.deepEqual(moveToolbarItem([], "vpn", 12), APPEARANCE.toolbarOrder);
assert.deepEqual(appearanceValues({}), APPEARANCE);
assert.deepEqual(appearanceValues(null), APPEARANCE);
assert.deepEqual(appearanceValues({ toolbarHidden: ["vpn", "menu", "vpn", "extensions"], wallpaperStrength: 400 }).toolbarHidden, ["vpn", "extensions"]);
assert.equal(appearanceValues({ accent: "url(https://example.com)" }).accent, APPEARANCE.accent);
assert.equal(appearanceValues({ chromeTint: "url(https://example.com)" }).chromeTint, "");
assert.equal(appearanceValues({ chromeTint: "#AA8866" }).chromeTint, "#aa8866");
assert.equal(appearanceValues({ wallpaperX: -5, wallpaperShade: 950 }).wallpaperX, 0);
assert.equal(appearanceValues({ tabWidth: 999 }).tabWidth, 260);
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
  ...APPEARANCE, accent: "#88AAFF", chromeTint: "#F8E5EE", studioWallpaper: "custom", wallpaperFit: "contain",
  wallpaperY: 10, wallpaperShade: 33, studioSound: "synth", theme: "light", toolbarOrder: ["downloads", "vpn", "extensions"],
  ntpBrand: false, ntpSearch: false, ntpAlign: "start", tabIndicator: "outline", tabWidth: 250,
  history: [{ url: "https://private.example" }], ntpTiles: [{}], adminToken: "test", image, __proto__: { homepage: "test" }
});
assert.equal(config.appearance.studioWallpaper, "none");
assert.equal(config.appearance.studioSound, "synth");
assert.equal(config.appearance.accent, "#88aaff");
assert.equal(config.appearance.chromeTint, "#f8e5ee");
assert.equal(config.appearance.wallpaperFit, "contain");
assert.equal(config.appearance.ntpSearch, false);
assert.equal(config.appearance.tabIndicator, "outline");
assert.equal(config.appearance.tabWidth, 250);
assert.deepEqual(config.appearance.toolbarOrder, ["downloads", "vpn", "extensions"]);
assert.deepEqual(Object.keys(config.appearance), Object.keys(APPEARANCE));
assert.deepEqual(readSetup(JSON.stringify(config)), config);
for (const [id, name, mode, accent, wallpaper] of [
  ["sakura", "Sakura", "light", "#963b69", "bloom"],
  ["tide", "Tide", "dark", "#8acfff", "tide"]
]) {
  const preset = WORKSPACE_PRESETS[id];
  const look = { ...APPEARANCE, workspacePreset: id, theme: preset.mode, accent: preset.accent, studioWallpaper: "auto",
    wallpaperFit: "contain", wallpaperX: 27, wallpaperY: 81, wallpaperShade: 64 };
  const exported = JSON.parse(JSON.stringify(setupForExport(name, look)));
  assert.equal(exported.name, name);
  assert.equal(exported.format, "veyra-appearance");
  assert.equal(exported.version, 1);
  assert.equal(exported.appearance.workspacePreset, id);
  assert.equal(exported.appearance.theme, mode);
  assert.equal(exported.appearance.accent, accent);
  assert.equal(resolvedWallpaper(exported.appearance, ""), wallpaper);
  assert.deepEqual(readSetup(JSON.stringify(exported)).appearance, look);
}
assert.deepEqual(readSetup('{"format":"veyra-appearance","version":1,"appearance":{"theme":"light","__proto__":{"polluted":true},"adminToken":"ignored"}}').appearance, { ...APPEARANCE, theme: "light" });
assert.equal({}.polluted, undefined);
for (const invalid of [
  "not JSON", " ", "x".repeat(MAX_SETUP_BYTES + 1),
  JSON.stringify({ ...config, version: 2 }),
  JSON.stringify({ ...config, appearance: { adminToken: "test" } }),
  JSON.stringify({ ...config, appearance: { theme: "light", toolbarHidden: ["menu"] } }),
  JSON.stringify({ ...config, appearance: { toolbarOrder: ["vpn", "vpn", "downloads"] } }),
  JSON.stringify({ ...config, appearance: { wallpaperFit: "tile" } }),
  JSON.stringify({ ...config, appearance: { wallpaperX: 101 } }),
  JSON.stringify({ ...config, appearance: { chromeTint: "var(--anything)" } }),
  JSON.stringify({ ...config, appearance: { accent: "red" } }),
  JSON.stringify({ ...config, appearance: { studioVolume: -1 } })
]) assert.throws(() => readSetup(invalid));

for (const entry of ["index.html", "browse/index.html"]) {
  assert.match(file(entry), /id="studioBtn"/);
  assert.match(file(entry), /id="ntpStudioBtn"/);
  const bootstrap = file(entry).match(/bootstrap\.js\?v=[\w.-]+/)?.[0];
  assert.ok(bootstrap && file("sw.js").includes(bootstrap), "Studio entry and service worker agree on the shell release");
}
const studioStyle = file("src/bootstrap.js").match(/styles\/studio\.css\?v=[\w.-]+/)?.[0];
assert.ok(studioStyle && file("sw.js").includes(studioStyle), "the service worker preloads the current Studio stylesheet");
assert.match(file("src/core.js"), /EPHEMERAL_KEYS = new Set\(\[[\s\S]*?\.\.\.STUDIO_LOCAL_KEYS/);
assert.match(file("src/ui.js"), /for \(const key of \[\.\.\.DEVICE_APPEARANCE_KEYS,[^\]]*\]\) delete s\[key\]/);
assert.match(file("src/ui.js"), /for \(const key of \[\.\.\.DEVICE_APPEARANCE_KEYS,[^\]]*\]\) delete remote\[key\]/);
assert.ok(!DEVICE_APPEARANCE_KEYS.includes(STUDIO_LOCAL_KEYS[0]));
assert.match(file("src/app.js"), /"customize", "customise", "customization-studio"[\s\S]*?view: "settings", section: "appearance"/);
console.log("Customization Studio: defaults, presets, safe setup imports, device-only assets and route wiring passed.");
