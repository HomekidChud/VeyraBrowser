import { WORKSPACE_PRESETS, validColour } from "./workspace.js?v=2";

export const WALLPAPERS = Object.freeze({ auto: "Match theme", none: "None", ridge: "Alpine ridge", signal: "Signal grid", dunes: "Copper dunes", orbit: "Night orbit", custom: "My wallpaper" });
export const SOUND_PACKS = Object.freeze({ off: "Off", soft: "Soft tap", synth: "Synth", arcade: "Arcade" });
export const TOOLBAR_ITEMS = Object.freeze({ vpn: "VPN", extensions: "Extensions", downloads: "Downloads" });
export const APPEARANCE = Object.freeze({
  workspacePreset: "glacier", theme: "dark", accent: "#8fb0f0", fontScale: 1, uiTypeface: "default",
  compact: false, chromeShape: "soft", showHomeButton: true, showBookmarksBar: true, toolbarHidden: [],
  tabLayout: "top", tabRailWidth: 212, tabRailCompact: false, newTabBackdrop: "glow",
  studioWallpaper: "auto", wallpaperStrength: 75, speedDialLayout: "classic", studioMotion: false,
  ntpClock: true, ntpRecent: true, ntpShortcuts: true, gameFocus: false, reduceMotion: false,
  studioSound: "off", studioVolume: 35, zoomDefault: 1, splitLayout: "columns"
});
export const MAX_SETUPS = 8;
export const MAX_SETUP_BYTES = 16 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const STUDIO_LOCAL_KEYS = ["veyra-studio-image", "veyra-studio-setups"];
export const DEVICE_APPEARANCE_KEYS = ["studioWallpaper", "wallpaperStrength", "studioMotion", "studioSound", "studioVolume"];

const choices = {
  workspacePreset: Object.keys(WORKSPACE_PRESETS), theme: ["dark", "light", "system"],
  uiTypeface: ["default", "system", "mono"], chromeShape: ["soft", "sharp", "round"], tabLayout: ["top", "left", "right"],
  newTabBackdrop: ["glow", "grid", "plain"], studioWallpaper: Object.keys(WALLPAPERS),
  speedDialLayout: ["classic", "compact", "wide", "minimal"], studioSound: Object.keys(SOUND_PACKS),
  fontScale: [0.9, 1, 1.1, 1.2], zoomDefault: [0.8, 0.9, 1, 1.1, 1.25, 1.5], splitLayout: ["columns", "stack"]
};
const numeric = { tabRailWidth: [160, 320], wallpaperStrength: [20, 90], studioVolume: [0, 100] };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function appearanceValues(input) {
  const source = object(input) ? input : {};
  return Object.fromEntries(Object.entries(APPEARANCE).map(([key, fallback]) => {
    const value = Object.hasOwn(source, key) ? source[key] : undefined;
    if (Object.hasOwn(choices, key)) return [key, choices[key].includes(value) ? value : fallback];
    if (Object.hasOwn(numeric, key)) return [key, Number.isFinite(value) ? Math.round(Math.max(numeric[key][0], Math.min(numeric[key][1], value))) : fallback];
    if (key === "accent") return [key, typeof value === "string" && validColour(value) ? value.toLowerCase() : fallback];
    if (key === "toolbarHidden") return [key, Array.isArray(value) ? Object.keys(TOOLBAR_ITEMS).filter(item => value.includes(item)) : []];
    return [key, typeof value === "boolean" ? value : fallback];
  }));
}

export function setupName(value) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 40) : "";
}
export function setupForExport(name, settings) {
  const appearance = appearanceValues(settings);
  if (appearance.studioWallpaper === "custom") appearance.studioWallpaper = "none";
  return { format: "veyra-appearance", version: 1, name: setupName(name) || "My Veyra setup", appearance };
}
export function readSetup(raw) {
  if (typeof raw !== "string" || raw.length > MAX_SETUP_BYTES) throw Error("Choose a Veyra setup JSON file under 16 KB.");
  let data;
  try { data = JSON.parse(raw); } catch { throw Error("This file is not valid JSON."); }
  if (!object(data) || data.format !== "veyra-appearance" || data.version !== 1 || !object(data.appearance) ||
      !Object.keys(data.appearance).some(key => Object.hasOwn(APPEARANCE, key))) throw Error("This isn’t a supported Veyra appearance setup.");
  const normalized = appearanceValues(data.appearance);
  for (const [key, value] of Object.entries(data.appearance)) {
    if (!Object.hasOwn(APPEARANCE, key)) continue;
    const same = key === "accent" ? typeof value === "string" && value.toLowerCase() === normalized[key] :
      key === "toolbarHidden" ? Array.isArray(value) && value.every(item => normalized[key].includes(item)) : value === normalized[key];
    if (!same) throw Error(`The setup has an invalid value for ${key}. Nothing was applied.`);
  }
  return setupForExport(data.name, data.appearance);
}
export function resolvedWallpaper(settings, image) {
  const { studioWallpaper, workspacePreset, gameFocus } = settings;
  if (gameFocus || !Object.hasOwn(WALLPAPERS, studioWallpaper)) return "none";
  if (studioWallpaper === "auto") return WORKSPACE_PRESETS[workspacePreset]?.wallpaper || "none";
  if (studioWallpaper === "custom") return validWallpaper(image) ? "custom" : "none";
  return studioWallpaper;
}
export const validWallpaper = value => typeof value === "string" && value.length < 700_000 &&
  /^data:image\/(?:webp|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value);
