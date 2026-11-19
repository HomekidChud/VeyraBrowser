import { $, esc, settings, load, save, remove, saveSettings, promptDialog, confirmDialog, toast, uid, INCOGNITO } from "./core.js?v=8.30.0-studio";
import { WORKSPACE_PRESETS } from "./workspace.js?v=2";
import {
  APPEARANCE, WALLPAPERS, SOUND_PACKS, TOOLBAR_ITEMS, MAX_SETUPS, MAX_SETUP_BYTES, MAX_IMAGE_BYTES,
  STUDIO_LOCAL_KEYS, appearanceValues, readSetup, setupForExport, setupName, resolvedWallpaper, validWallpaper
} from "./studio-model.js?v=1";

const [IMAGE_KEY, SETUP_KEY] = STUDIO_LOCAL_KEYS;
const descriptions = { glacier: "Cool & clean", pulse: "Neon dusk", circuit: "Terminal green", ember: "Warm copper", midnight: "Ultraviolet", daybreak: "Soft daylight" };
const icons = { look: "i-moon", newtab: "i-tab", layout: "i-dock-right", sound: "i-sound", setups: "i-layers" };
const panels = { look: "Themes", newtab: "New tab", layout: "Layout", sound: "Sound", setups: "My setups" };
const accents = ["#8fb0f0", "#6fd3b8", "#f0b86f", "#f08f9e", "#c49bf0", "#9fd46a", "#e8e8e8"];
const icon = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
const action = (id, label, symbol, extra = "") => `<button type="button" class="btn" data-studio-act="${id}" ${extra}>${symbol ? icon(symbol) : ""}${label}</button>`;
const options = values => Object.entries(values);
let activePanel = "look";
let soundContext;
let imageValue = load(IMAGE_KEY, "");
let savedSetups = load(SETUP_KEY, []);
const setups = () => Array.isArray(savedSetups) ? savedSetups.filter(p => p && /^[\w-]{1,60}$/.test(p.id || "") && setupName(p.name)).slice(0, MAX_SETUPS) : [];
const persist = (key, value) => {
  save(key, value);
  return INCOGNITO || JSON.stringify(load(key, null)) === JSON.stringify(value);
};

export function playStudioSound(event = "open") {
  const { studioSound, studioVolume, gameFocus } = appearanceValues(settings);
  if (gameFocus || studioSound === "off" || !studioVolume || document.hidden) return;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio || (!soundContext && !navigator.userActivation?.hasBeenActive)) return;
  try {
    soundContext ||= new Audio();
    // Don't queue sounds on boot or while playback is suspended by the browser.
    if (soundContext.state !== "running") { void soundContext.resume().then(() => { if (event === "preview" && soundContext.state === "running") playStudioSound(event); }).catch(() => {}); return; }
    const osc = soundContext.createOscillator(), gain = soundContext.createGain(), at = soundContext.currentTime;
    osc.type = { soft: "sine", synth: "triangle", arcade: "square" }[studioSound];
    const base = { soft: 580, synth: 420, arcade: 760 }[studioSound];
    osc.frequency.setValueAtTime(event === "close" ? base * 1.3 : base, at);
    osc.frequency.exponentialRampToValueAtTime(event === "close" ? base * .72 : event === "switch" ? base * 1.06 : base * 1.45, at + .075);
    gain.gain.setValueAtTime(.001, at);
    gain.gain.linearRampToValueAtTime((studioSound === "arcade" ? .028 : .05) * studioVolume / 100, at + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, at + .11);
    osc.connect(gain).connect(soundContext.destination);
    osc.start(at); osc.stop(at + .12);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  } catch { /* Audio is optional and never blocks tabs. */ }
}

export function applyStudioVisuals(app, root) {
  const p = appearanceValues(settings);
  const wallpaper = resolvedWallpaper(p, imageValue);
  app.dataset.wallpaper = wallpaper;
  app.dataset.dial = p.speedDialLayout;
  app.dataset.wallpaperMotion = String(p.studioMotion && !p.reduceMotion && !p.gameFocus);
  app.style.setProperty("--wallpaper-strength", p.wallpaperStrength / 100);
  if (validWallpaper(imageValue)) app.style.setProperty("--studio-custom-wall", `url("${imageValue}")`);
  else app.style.removeProperty("--studio-custom-wall");
  root.dataset.typeface = p.uiTypeface;
  for (const [key, id] of [["vpn", "vpnBtn"], ["extensions", "extBtn"], ["downloads", "downloadBtn"]]) {
    $(id).classList.toggle("studio-hidden-tool", p.toolbarHidden.includes(key));
  }
  const preview = $("studioPreview");
  if (!preview) return;
  preview.dataset.previewShortcuts = String(p.ntpShortcuts);
  preview.dataset.previewClock = String(p.ntpClock);
  preview.dataset.previewRecent = String(p.ntpRecent);
  preview.dataset.previewRail = p.tabLayout;
  preview.dataset.previewIconRail = String(p.tabRailCompact);
  const state = $("studioPreviewState");
  if (state) state.textContent = `${WORKSPACE_PRESETS[p.workspacePreset].name} / ${p.gameFocus ? "Game Focus" : WALLPAPERS[wallpaper]}`;
  const sound = $("studioSoundTest");
  if (sound) sound.disabled = p.studioSound === "off" || p.gameFocus || !p.studioVolume;
}

const cardHead = (title, desc) => `<header class="studio-card-head"><h3>${title}</h3><p>${desc}</p></header>`;
const block = (title, desc, body) => `<div class="studio-block">${cardHead(title, desc)}<div class="s-card">${body}</div></div>`;
const range = (row, key, label, desc, min, max) => row(label, desc, `<div class="studio-range"><input type="range" data-studio-range="${key}" min="${min}" max="${max}" value="${appearanceValues(settings)[key]}" aria-label="${label}"><output>${appearanceValues(settings)[key]}%</output></div>`);

export function studioMarkup({ row, toggle, select, number }, searching) {
  const p = appearanceValues(settings), custom = validWallpaper(imageValue);
  const looks = block("Theme collection", "Start with a preset, then adjust any part of the look.", `<div class="studio-presets" aria-label="Theme presets">${
    options(WORKSPACE_PRESETS).map(([id, preset]) => `<button class="studio-preset" data-studio-theme="${id}" aria-pressed="${p.workspacePreset === id}" style="--preset-tint:${preset.palette};--preset-accent:${preset.accent}" type="button"><span class="studio-preset-art" data-preset-art="${id}"><i></i><i></i><i></i>${icon("i-check")}</span><span class="studio-preset-name">${preset.name}</span><small>${descriptions[id]}</small></button>`).join("")
  }</div>`)
    + block("Color and type", "Set the mood, contrast, and typography of Veyra’s interface.",
      select("theme", "Color mode", "Follow your device or choose a mode manually.", [["dark", "Dark"], ["light", "Light"], ["system", "Device"]])
      + row("Accent colour", "Highlights, selection, and focus.", `<div class="swatches">${accents.map(c => `<button type="button" class="swatch ${p.accent === c ? "on" : ""}" data-studio-accent="${c}" style="background:${c}" aria-pressed="${p.accent === c}" aria-label="Accent ${c}"></button>`).join("")}<input type="color" value="${p.accent}" id="studioAccent" aria-label="Custom accent"></div>`)
      + select("uiTypeface", "Interface font", "Changes browser controls, not website fonts.", [["default", "Veyra default"], ["system", "System sans"], ["mono", "Monospace"]])
      + select("fontScale", "Font size", "Scales the Veyra interface.", [[.9, "Small"], [1, "Medium"], [1.1, "Large"], [1.2, "Very large"]]));
  const newtab = block("Wallpaper gallery", "Mix any wallpaper with any theme. Your own image stays in this browser.",
    `<div class="studio-wallpapers">${options(WALLPAPERS).filter(([key]) => key !== "custom" || custom).map(([id, title]) => `<button class="studio-wallpaper" type="button" data-studio-wall="${id}" aria-pressed="${p.studioWallpaper === id}"><i data-wall-art="${id}">${icon("i-check")}</i><span>${title}</span></button>`).join("")}</div>`
    + row("Custom wallpaper", "JPEG, PNG or WebP up to 8 MB. Converted to a static image on this device.", `${action("image", custom ? "Replace image" : "Upload image", "i-plus")}${custom ? action("clear-image", "Remove", "i-trash") : ""}<input class="hidden" type="file" id="studioImageFile" accept="image/png,image/jpeg,image/webp">`)
    + range(row, "wallpaperStrength", "Wallpaper intensity", "Adjust how strongly the wallpaper shows behind your shortcuts.", 20, 90)
    + select("newTabBackdrop", "Base backdrop", "Used without a wallpaper and beneath translucent ones.", [["glow", "Accent glow"], ["grid", "Grid"], ["plain", "Plain"]])
    + toggle("studioMotion", "Wallpaper drift", "Subtle movement on the New tab page. Respects reduced motion."))
    + block("Speed Dial", "Decide what you see on every New tab.",
      select("speedDialLayout", "Shortcut layout", "Choose a layout for your pinned sites.", [["classic", "Classic"], ["compact", "Compact grid"], ["wide", "Wide cards"], ["minimal", "Minimal list"]])
      + toggle("ntpShortcuts", "Shortcut tiles", "Show pinned sites.") + toggle("ntpClock", "Clock and greeting", "") + toggle("ntpRecent", "Recent sites", ""));
  const layout = block("Tabs and toolbar", "Pick where your tabs live and keep just the shortcuts you use.",
    select("tabLayout", "Tab position", "Use the top strip or a side rail.", [["top", "Top"], ["left", "Left side"], ["right", "Right side"]])
    + number("tabRailWidth", "Side rail width", "160–320 pixels when tab titles are shown.", 160, 320, 1)
    + toggle("tabRailCompact", "Icon-only side rail", "")
    + select("chromeShape", "Tab shape", "", [["soft", "Soft corners"], ["sharp", "Square"], ["round", "Rounded"]])
    + toggle("compact", "Compact mode", "Tighter tabs and toolbar.")
    + toggle("showHomeButton", "Show home button", "")
    + toggle("showBookmarksBar", "Show bookmarks bar", "Ctrl+Shift+B toggles the bookmarks bar.")
    + options(TOOLBAR_ITEMS).map(([id, name]) => row(`${name} shortcut`, "Still available from the browser menu.", `<input type="checkbox" class="switch" aria-label="${name} shortcut" data-studio-tool="${id}" ${p.toolbarHidden.includes(id) ? "" : "checked"}>`)).join(""))
    + block("Browsing comfort", "Set defaults for reading, multitasking, and a quieter interface.",
      select("zoomDefault", "Default page zoom", "Applied to new page tabs.", [[.8, "80%"], [.9, "90%"], [1, "100%"], [1.1, "110%"], [1.25, "125%"], [1.5, "150%"]])
      + select("splitLayout", "Default split layout", "Small screens stack panes automatically.", [["columns", "Side by side"], ["stack", "Stacked"]])
      + toggle("gameFocus", "Game Focus", "Turns off wallpaper, sounds, and visual effects. Pauses background diagnostics.")
      + toggle("reduceMotion", "Reduce motion", "Minimize animations and transitions."));
  const sound = block("Interface sounds", "Opt-in sounds for opening, switching, and closing Veyra tabs. Websites are unaffected.",
    select("studioSound", "Sound pack", "Off by default. Game Focus also mutes these sounds.", options(SOUND_PACKS))
    + range(row, "studioVolume", "Volume", "Applies only to interface sounds.", 0, 100)
    + row("Sound preview", "Play a short sample at the current volume.", action("sound", "Play sample", "i-play", `id="studioSoundTest" ${p.studioSound === "off" || p.gameFocus || !p.studioVolume ? "disabled" : ""}`)));
  const entries = setups();
  const library = block("Saved setups", `Save up to ${MAX_SETUPS} looks and switch between them whenever you want.`,
    `<div class="studio-setups">${entries.length ? entries.map(item => `<div class="studio-setup"><span class="studio-setup-mark" style="--setup-color:${appearanceValues(item.appearance).accent}">${icon("i-layers")}</span><div><b>${esc(setupName(item.name))}</b><small>${WORKSPACE_PRESETS[appearanceValues(item.appearance).workspacePreset].name}</small></div><div class="studio-actions">${action("apply", "Apply", null, `data-setup="${esc(item.id)}"`)}${action("export", "Export", null, `data-setup="${esc(item.id)}"`)}${action("delete", "Remove", null, `data-setup="${esc(item.id)}"`)}</div></div>`).join("") :
      `<div class="studio-empty">${icon("i-layers")}<div><b>No saved setups yet</b><p>Save your current look to return to it later.</p></div></div>`}</div>`
    + `<div class="studio-actions studio-library-actions">${action("save", "Save current look", "i-plus")}${action("export", "Export current", "i-download")}${action("import", "Import setup", "i-file")}<input class="hidden" type="file" id="studioSetupFile" accept=".json,application/json"></div>`
    + `<p class="studio-library-note">JSON contains appearance settings only. Personal wallpaper images, site shortcuts, and browsing data aren’t included.</p>`);
  const content = { look: looks, newtab, layout, sound, setups: library };
  return `<section class="s-section studio" id="s-appearance" data-section="appearance" data-studio-search="${searching}">
    <div class="studio-hero">
      <div class="studio-intro"><span class="studio-kicker">${icon("i-sliders")} WORKSPACE DESIGN</span><h2>Customization <span>Studio</span></h2><p>Make Veyra yours. Mix themes, layouts, and sounds, then save the looks you want to keep.</p><span class="studio-status"><i></i>${INCOGNITO ? "Private window · changes are temporary" : "Changes apply instantly"}</span></div>
      <div class="studio-live"><div class="studio-live-head"><span>LIVE PREVIEW</span><span id="studioPreviewState"></span></div>
      <div class="studio-preview" id="studioPreview" aria-hidden="true">
        <div class="studio-preview-tabs"><span>${icon("logo")} New tab</span><span></span><b>+</b></div>
        <div class="studio-preview-bar"><i></i><i></i><i></i><div></div></div>
        <div class="studio-preview-page"><div class="studio-preview-art"></div><div class="studio-preview-content"><small class="studio-preview-clock">09:41</small><strong>${icon("logo")} Veyra</strong><div class="studio-preview-search">${icon("i-search")} Search or type a URL</div><div class="studio-preview-links"><i>W</i><i>G</i><i>M</i><i>+</i></div><div class="studio-preview-recent">Recently visited</div></div></div>
      </div></div>
    </div>
    ${searching ? "" : `<nav class="studio-nav" aria-label="Studio categories">${options(panels).map(([id, label]) => `<button type="button" data-studio-panel="${id}" aria-pressed="${activePanel === id}">${icon(icons[id])}${label}</button>`).join("")}</nav>`}
    ${options(content).map(([id, markup]) => `<div class="studio-panel" data-studio-content="${id}" ${searching || activePanel === id ? "" : "hidden"}>${markup}</div>`).join("")}
    <footer class="studio-footer"><span>${icon("i-lock")} ${INCOGNITO ? "This look stays in this private window." : "Custom images and saved setups stay on this device."}</span>${action("reset", "Reset appearance", "i-reload")}</footer>
  </section>`;
}

async function convertWallpaper(file) {
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw Error("Choose a JPEG, PNG or WebP image up to 8 MB.");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const signature = (...matches) => matches.every((byte, index) => bytes[index] === byte);
  const mime = signature(137, 80, 78, 71, 13, 10, 26, 10) ? "image/png" : signature(255, 216, 255) ? "image/jpeg" :
    signature(82, 73, 70, 70) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" ? "image/webp" : "";
  if (!mime) throw Error("Choose a valid JPEG, PNG or WebP image.");
  let bitmap;
  try { bitmap = await createImageBitmap(file.slice(0, file.size, mime)); }
  catch { throw Error("This image couldn’t be opened."); }
  try {
    if (bitmap.width * bitmap.height > 32_000_000) throw Error("Choose an image under 32 megapixels.");
    const canvas = document.createElement("canvas");
    for (const [limit, quality] of [[1600, .8], [1200, .68], [800, .55]]) {
      const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const webp = canvas.toDataURL("image/webp", quality);
      const image = webp.startsWith("data:image/webp;") ? webp : canvas.toDataURL("image/jpeg", quality);
      if (validWallpaper(image)) return image;
    }
    throw Error("This image is too large to store as a wallpaper.");
  } finally { bitmap.close(); }
}

export function wireStudio(body, refresh) {
  function repaint(el) {
    const attrs = ["data-studio-theme", "data-studio-wall", "data-studio-act"];
    const attr = attrs.find(name => el.hasAttribute(name));
    const value = attr && el.getAttribute(attr);
    const setup = el.dataset.setup;
    refresh();
    if (attr && !el.isConnected) [...body.querySelectorAll(`[${attr}]`)].find(node => node.getAttribute(attr) === value && node.dataset.setup === setup)?.focus({ preventScroll: true });
  }
  body.addEventListener("input", e => {
    const el = e.target;
    if (el.dataset.studioRange) {
      settings[el.dataset.studioRange] = Number(el.value);
      el.nextElementSibling.textContent = `${el.value}%`;
      saveSettings();
    } else if (el.id === "studioAccent") {
      settings.accent = el.value; saveSettings(); markAccents(body);
    }
  });
  body.addEventListener("change", async e => {
    const el = e.target;
    if (Object.hasOwn(TOOLBAR_ITEMS, el.dataset.studioTool)) {
      const hidden = new Set(appearanceValues(settings).toolbarHidden);
      if (el.checked) hidden.delete(el.dataset.studioTool); else hidden.add(el.dataset.studioTool);
      settings.toolbarHidden = [...hidden]; saveSettings();
    }
    if (!["studioImageFile", "studioSetupFile"].includes(el.id) || !el.files?.[0]) return;
    const file = el.files[0]; el.value = "";
    try {
      if (el.id === "studioImageFile") {
        const image = await convertWallpaper(file);
        imageValue = image;
        const stored = persist(IMAGE_KEY, image);
        settings.studioWallpaper = "custom"; saveSettings();
        toast(stored ? "Wallpaper applied" : "Wallpaper applied for this window only");
      } else {
        if (file.size > MAX_SETUP_BYTES) throw Error("Choose a Veyra setup JSON file under 16 KB.");
        const setup = readSetup(await file.text());
        if (!await confirmDialog("Import appearance setup?", `Apply “${setup.name}” to the current look? Existing saved setups won’t change.`, "Apply setup")) return;
        Object.assign(settings, setup.appearance); saveSettings(); toast(`Applied ${setup.name}`);
      }
      refresh();
      body.querySelector(`[data-studio-act="${el.id === "studioImageFile" ? "image" : "import"}"]`)?.focus({ preventScroll: true });
    } catch (err) { toast(err.message, { kind: "err" }); }
  });
  body.addEventListener("click", async e => {
    const tab = e.target.closest("[data-studio-panel]");
    if (tab) {
      activePanel = tab.dataset.studioPanel;
      body.querySelectorAll("[data-studio-panel]").forEach(btn => btn.setAttribute("aria-pressed", btn === tab));
      body.querySelectorAll("[data-studio-content]").forEach(panel => { panel.hidden = panel.dataset.studioContent !== activePanel; });
      return;
    }
    const theme = e.target.closest("[data-studio-theme]");
    if (theme && Object.hasOwn(WORKSPACE_PRESETS, theme.dataset.studioTheme)) {
      const preset = WORKSPACE_PRESETS[theme.dataset.studioTheme];
      Object.assign(settings, { workspacePreset: theme.dataset.studioTheme, theme: preset.mode, accent: preset.accent }); saveSettings(); repaint(theme); return;
    }
    const accent = e.target.closest("[data-studio-accent]");
    if (accent) { settings.accent = accent.dataset.studioAccent; $("studioAccent").value = settings.accent; saveSettings(); markAccents(body); return; }
    const wall = e.target.closest("[data-studio-wall]");
    if (wall && Object.hasOwn(WALLPAPERS, wall.dataset.studioWall)) {
      settings.studioWallpaper = wall.dataset.studioWall; saveSettings();
      body.querySelectorAll("[data-studio-wall]").forEach(btn => btn.setAttribute("aria-pressed", btn === wall)); return;
    }
    const el = e.target.closest("[data-studio-act]");
    if (!el) return;
    const profile = setups().find(p => p.id === el.dataset.setup);
    switch (el.dataset.studioAct) {
      case "sound": playStudioSound("preview"); return;
      case "image": $("studioImageFile").click(); return;
      case "import": $("studioSetupFile").click(); return;
      case "clear-image":
        imageValue = ""; remove(IMAGE_KEY);
        if (settings.studioWallpaper === "custom") settings.studioWallpaper = "auto";
        saveSettings(); refresh(); body.querySelector('[data-studio-act="image"]')?.focus(); return;
      case "reset":
        if (!await confirmDialog("Reset appearance?", "This restores the default look. Your saved setups, wallpaper image, and browsing data stay.", "Reset appearance")) return;
        const restored = appearanceValues(APPEARANCE);
        Object.assign(settings, restored); saveSettings(); repaint(el); toast("Default look restored"); return;
      case "save": {
        if (setups().length >= MAX_SETUPS) { toast("Remove a setup before saving another.", { kind: "err" }); return; }
        const result = await promptDialog({ title: "Save current look", ok: "Save setup", fields: [{ name: "name", label: "Setup name", placeholder: "e.g. Late night" }] });
        if (!result) return;
        const name = setupName(result.name);
        if (!name) { toast("Enter a setup name.", { kind: "err" }); return; }
        savedSetups = [...setups(), { id: uid(), name, appearance: appearanceValues(settings) }];
        const stored = persist(SETUP_KEY, savedSetups); repaint(el);
        toast(stored ? `Saved ${name}` : `Saved ${name} for this window only`); return;
      }
      case "apply":
        if (!profile) return;
        Object.assign(settings, appearanceValues(profile.appearance)); saveSettings(); repaint(el); toast(`Applied ${setupName(profile.name)}`); return;
      case "delete":
        if (!profile || !await confirmDialog("Remove saved setup?", `“${setupName(profile.name)}” will be removed. Your current look won’t change.`, "Remove setup")) return;
        savedSetups = setups().filter(item => item.id !== profile.id);
        const stored = persist(SETUP_KEY, savedSetups); refresh(); body.querySelector('[data-studio-act="save"]')?.focus();
        toast(stored ? "Setup removed" : "Setup removed for this window only"); return;
      case "export": {
        const config = setupForExport(profile?.name, profile?.appearance ?? settings);
        const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url;
        link.download = `veyra-${config.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "appearance"}.json`;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000); return;
      }
    }
  });
}

function markAccents(body) {
  body.querySelectorAll("[data-studio-accent]").forEach(btn => {
    const active = btn.dataset.studioAccent === settings.accent;
    btn.classList.toggle("on", active); btn.setAttribute("aria-pressed", active);
  });
}
