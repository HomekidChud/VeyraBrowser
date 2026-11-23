const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const sharp = require("sharp");

const root = process.argv[2];
const destination = process.argv[3] || path.join(__dirname, "../web/assets/guides");
const width = 1280, height = 720, fps = 24, duration = 5;
const pad = n => String(n).padStart(2, "0");

const guides = [
  { name: "welcome-to-settings", title: "Welcome to Settings", colour: "#a7c7ff", scenes: [
    ["welcome-1", "Find a control", ["Try “wallpaper fit”", "in Search settings."], "SETTINGS / SEARCH"],
    ["welcome-2", "Pin a section", ["Select the star to add", "or remove a shortcut", "in Pinned sections."], "SETTINGS / OVERVIEW"],
    ["welcome-3", "Change the layout", ["Open Appearance,", "then Layout, to set up", "your workspace."], "SETTINGS / APPEARANCE"]
  ] },
  { name: "keyboard-shortcuts", title: "Make a shortcut yours", colour: "#a5e2cc", scenes: [
    ["shortcuts-1", "Find a command", ["Search the list, then", "select Edit."], "SETTINGS / KEYBOARD SHORTCUTS"],
    ["shortcuts-2", "Record your keys", ["Focus the recording", "button and press", "your combination."], "KEYBOARD SHORTCUTS / EDIT"],
    ["shortcuts-3", "Save the binding", ["Use Clear all to", "disable a command,", "or restore its defaults."], "KEYBOARD SHORTCUTS / EDIT"]
  ] },
  { name: "performance-profiles", title: "Choose a performance profile", colour: "#f0c88c", scenes: [
    ["performance-1", "Pick a profile", ["Choose how Veyra", "handles tabs and", "background work."], "SETTINGS / PERFORMANCE"],
    ["performance-2", "Park a tab", ["Unload an eligible", "background page.", "It reloads next time."], "PERFORMANCE / TAB PARKING"],
    ["performance-3", "Test the connection", ["Measure the round trip", "to Veyra, not in-game", "ping or FPS."], "PERFORMANCE / VEYRA CONNECTION"]
  ] }
];

const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const svg = inner => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${inner}</svg>`);
const text = (x, y, value, size, color, weight = 400, mono = false, attrs = "") => `<text x="${x}" y="${y}" font-family="${mono ? "DejaVu Sans Mono" : "DejaVu Sans"}" font-weight="${weight}" font-size="${size}" fill="${color}" ${attrs}>${esc(value)}</text>`;
const rect = (x,y,w,h,fill,r = 0,rest = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${rest}/>`;
const ease = n => 1 - (1 - Math.min(1, Math.max(0, n))) ** 3;

async function loadScene(guide, scene, idx, meta) {
  const [id, heading, words, trail] = scene;
  const { file, box } = meta[id];
  const source = sharp(file);
  const { width: w, height: h } = await source.metadata();
  const scale = Math.min(730 / w, 390 / h, 1.8);
  const dw = Math.round(w * scale), dh = Math.round(h * scale);
  const x = Math.round(838 - dw / 2), y = Math.round(371 - dh / 2);
  const panel = await source.resize(dw, dh, { fit: "fill" }).png().toBuffer();
  const { colour } = guide;
  const background = await sharp(svg(
    rect(0, 0, width, height, "#101319") +
    text(60, 62, `VEYRA  /  SETTINGS GUIDES`, 18, colour, 700, true, 'letter-spacing="2"') +
    text(60, 111, guide.title, 37, "#f2f5fa", 700) +
    rect(60, 140, 1160, 1, "#303943") +
    rect(447, 166, 773, 444, "#141922", 15, 'stroke="#323c49"') +
    rect(448, 573, 771, 36, "#141922", 0) +
    text(472, 595, trail, 13, "#acb8ca", 700, true, 'letter-spacing="1"') +
    text(60, 667, `STEP ${pad(idx + 1)} / 03`, 16, "#c4cddd", 700, true, 'letter-spacing="2"') +
    [0, 1, 2].map(n => rect(248 + 328*n, 656, 308, 5, n < idx ? colour : "#333d4a", 2)).join("")
  )).composite([{ input: panel, left: x, top: y }]).png().toBuffer();
  const callout = {
    x: x + Math.max(0, box.x * scale - 4), y: y + Math.max(0, box.y * scale - 4),
    w: Math.min(dw, box.w * scale + 8), h: Math.min(dh, box.h * scale + 8)
  };
  return { background, heading, words, callout, idx, colour };
}

function effects(scene, f) {
  const { idx, colour, callout: b } = scene;
  const arrived = ease(f / (fps * .42));
  const reveal = ease((f - 6) / (fps * .5));
  const ripple = Math.max(0, Math.min(1, (f - 12) / 27));
  const cursorX = b.x + b.w * .79, cursorY = b.y + b.h * .57;
  return svg(
    `<g transform="translate(0 ${12 * (1-arrived)})" opacity="${arrived}">` +
    rect(60, 229, 39, 4, colour, 2) +
    text(60, 284, scene.heading, 30, "#f5f7fa", 700) +
    scene.words.map((line, i) => text(60, 338 + 35*i, line, 25, "#c4cddd")).join("") + "</g>" +
    `<g opacity="${reveal}">` + rect(b.x, b.y, b.w, b.h, "none", 8, `stroke="${colour}" stroke-width="3"`) +
    `<circle cx="${cursorX}" cy="${cursorY}" r="${10 + 30 * ripple}" fill="none" stroke="${colour}" stroke-width="3" opacity="${ripple * (1-ripple) * 3}"/>` +
    `<path d="M0 0 L4 23 L9 15 L18 13 Z" transform="translate(${cursorX} ${cursorY + 16*(1-reveal)})" fill="${colour}" stroke="#11151d" stroke-width="1.8" stroke-linejoin="round"/>` +
    "</g>" + rect(248 + 328*idx, 656, 308 * (f+1) / (fps*duration), 5, colour, 2)
  );
}

async function render(guide, meta) {
  const out = path.join(destination, `${guide.name}.mp4`);
  const ff = spawn("ffmpeg", ["-hide_banner","-loglevel","error","-y","-f","image2pipe","-framerate",String(fps),"-vcodec","mjpeg","-i","pipe:0","-an","-c:v","libx264","-threads","2","-preset","fast","-crf","19","-pix_fmt","yuv420p","-movflags","+faststart",out], { stdio: ["pipe", "inherit", "inherit"] });
  const exited = once(ff, "exit");
  try {
    for (const [idx, entry] of guide.scenes.entries()) {
      const scene = await loadScene(guide, entry, idx, meta);
      for (let frame = 0; frame < fps*duration; frame++) {
        const image = await sharp(scene.background).composite([{ input: effects(scene, frame) }]).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
        if (idx === 0 && frame === fps) await fs.writeFile(path.join(destination, `${guide.name}.jpg`), image);
        if (!ff.stdin.write(image)) await once(ff.stdin, "drain");
      }
    }
  } finally {
    ff.stdin.end();
  }
  const [code] = await exited;
  if (code !== 0) throw new Error(`ffmpeg failed: ${guide.name}`);
  console.log(out);
}

async function main() {
  if (!root) throw new Error("Usage: node scripts/render-guides.cjs <capture folder with meta.json> [output folder]");
  const meta = JSON.parse(await fs.readFile(path.join(root, "meta.json"), "utf8"));
  await fs.mkdir(destination, { recursive: true });
  sharp.concurrency(2);
  const selected = process.argv[4] ? guides.filter(g => g.name === process.argv[4]) : guides;
  if (!selected.length) throw new Error(`Unknown guide: ${process.argv[4]}`);
  for (const guide of selected) await render(guide, meta);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
