function safeYouTubeUrl(raw) {
  try {
    const url = new URL(String(raw));
    if (!/^https?:$/.test(url.protocol) || !isYouTubeUrl(url.href) || url.username || url.password || url.port) return null;
    if (url.hostname.toLowerCase() === "m.youtube.com") url.hostname = "www.youtube.com";
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeYouTubeUrl(raw) {
  return safeYouTubeUrl(raw) || String(raw ?? "");
}

export function youtubeWatchId(raw) {
  try {
    const url = new URL(safeYouTubeUrl(raw));
    if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com"].includes(url.hostname) || url.pathname !== "/watch") return "";
    const id = url.searchParams.get("v");
    return /^[\w-]{11}$/.test(id || "") ? id : "";
  } catch { return ""; }
}

export function isYouTubeUrl(raw) {
  try {
    const url = new URL(String(raw));
    return /^https?:$/.test(url.protocol) && /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function youtubeEmbedUrl(raw, origin = globalThis.location?.origin || "") {
  const safeUrl = safeYouTubeUrl(raw);
  if (!safeUrl) return null;

  try {
    const url = new URL(safeUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = /^\/([\w-]{11})\/?$/.exec(url.pathname)?.[1] || "";
    else if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
      else id = /^\/(?:shorts|live|embed)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1] || "";
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;

    const params = new URLSearchParams({ playsinline: "1", rel: "0" });
    const pageOrigin = String(origin || "");
    if (/^https?:\/\//i.test(pageOrigin)) {
      params.set("origin", pageOrigin);
      params.set("widget_referrer", pageOrigin);
    }
    const start = url.searchParams.get("start") || url.searchParams.get("t") || new URLSearchParams(url.hash.slice(1)).get("t");
    const parts = /^(\d+)$/.test(start || "") ? [null, 0, 0, start] : /^(?:(\d{1,4})h)?(?:(\d{1,4})m)?(?:(\d{1,5})s)?$/i.exec(start || "");
    const seconds = parts ? Number(parts[1] || 0) * 3600 + Number(parts[2] || 0) * 60 + Number(parts[3] || 0) : 0;
    if (Number.isFinite(seconds) && seconds > 0) params.set("start", String(Math.min(seconds, 86400)));
    const list = url.searchParams.get("list"), index = url.searchParams.get("index");
    if (/^[A-Za-z0-9_-]{2,100}$/.test(list || "")) {
      params.set("list", list);
      if (/^\d{1,5}$/.test(index || "")) params.set("index", index);
    }
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params.toString()}`;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

export function youtubeSignInUrl(raw) {
  const target = safeYouTubeUrl(raw);
  if (!target) return null;
  const signIn = new URL("https://accounts.google.com/ServiceLogin");
  signIn.searchParams.set("service", "youtube");
  signIn.searchParams.set("continue", target);
  signIn.searchParams.set("hl", "en");
  return signIn.href;
}

export function youtubeDeskVideo(raw) {
  const embed = youtubeEmbedUrl(raw);
  if (!embed) return null;
  const frame = new URL(embed);
  const id = frame.pathname.split("/").pop();
  // A playlist could load a second, unchecked video inside the same frame.
  // The desk plays one explicitly selected and checked video at a time.
  frame.searchParams.delete("list");
  frame.searchParams.delete("index");
  const kind = /^\/(shorts|live)\//.exec(new URL(safeYouTubeUrl(raw)).pathname)?.[1];
  const watch = new URL(kind ? `https://www.youtube.com/${kind}/${id}` : "https://www.youtube.com/watch");
  if (!kind) watch.searchParams.set("v", id);
  if (frame.searchParams.has("start")) watch.searchParams.set("t", frame.searchParams.get("start"));
  return { id, embed: frame.href, url: watch.href };
}

export function youtubeFallbackHtml(raw) {
  const video = youtubeDeskVideo(raw);
  if (!video) return "";
  return `<!doctype html>
<html lang="en" data-veyra-youtube-fallback="true">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YouTube Watch Desk</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#10141a;color:#eff3fa;--surface:#181e27;--line:#343e4d;--muted:#afbccc;--accent:#b7cefa}
*{box-sizing:border-box}body{margin:0}main{max-width:1600px;margin:auto;padding:clamp(.65rem,2vw,1.5rem);display:grid;grid-template-columns:minmax(0,1fr) minmax(16rem,22rem);gap:clamp(.8rem,2vw,1.5rem);align-items:start}
.watch,.queue{min-width:0}.eyebrow{display:block;color:var(--accent);font-size:.73rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.45rem}
h1,h2{margin:0;line-height:1.15}h1{font-size:clamp(1.4rem,3vw,2rem)}h2{font-size:1.1rem}header{margin-bottom:.8rem}
.player{display:grid;place-items:center;width:100%;aspect-ratio:16/9;min-height:200px;background:#080a0d;border:1px solid var(--line);border-radius:.65rem;overflow:hidden}.player iframe{display:block;width:100%;height:100%;min-height:200px;border:0}
.player p{padding:.8rem;max-width:33rem;text-align:center}.queue{border:1px solid var(--line);border-radius:.65rem;padding:.9rem;background:var(--surface)}p{margin:.55rem 0;color:var(--muted);font-size:.84rem;line-height:1.5}
.watch-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0 1rem;padding:.3rem 0}.watch-footer p{flex:1 1 16rem}
.queue form{display:grid;gap:.45rem;margin:.85rem 0}.queue label{font-size:.83rem;font-weight:650}input,button{font:inherit;border:1px solid var(--line);border-radius:.4rem;min-height:44px}input{min-width:0;padding:.5rem .6rem;background:#10141a;color:inherit}button{padding:.45rem .75rem;font-size:.83rem;font-weight:700;background:#242f40;color:inherit;cursor:pointer}
form button{background:var(--accent);color:#142131;border-color:transparent;justify-self:start}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
a{display:inline-flex;align-items:center;min-height:44px;color:var(--accent);font-weight:650;font-size:.84rem;text-underline-offset:.18em}[hidden]{display:none!important}.player-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin:.65rem 0}
ol{margin:.6rem 0 0;padding:0;list-style:none;display:grid;gap:.35rem}li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.4rem}li button:first-child{text-align:left;overflow-wrap:anywhere}li [aria-current="true"]{border-color:var(--accent)}.notice:empty{display:none}
@media(max-width:760px){main{grid-template-columns:minmax(0,1fr)}}
</style>
</head>
<body><main aria-label="YouTube Watch Desk">
<section class="watch" aria-labelledby="watchTitle"><header><span class="eyebrow">Veyra · Media</span><h1 id="watchTitle">YouTube Watch Desk</h1></header>
<div class="player" data-player><p role="status" data-player-status>Checking whether this video can play here…</p></div>
<footer class="watch-footer"><p>The official player and Open on YouTube connect directly, outside the Veyra proxy and VPN.</p><a data-open-original href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer">Open on YouTube</a></footer>
<div class="player-actions"><button type="button" data-player-action hidden></button><button type="button" data-proxy-action>Use Fast Proxy</button></div></section>
<aside class="queue" aria-labelledby="queueTitle"><span class="eyebrow">This tab only</span><h2 id="queueTitle">Watch queue</h2>
<p>Keep a short list of video links and switch without leaving the tab.</p>
<form data-queue-form novalidate><label for="videoLink">YouTube video link</label><input id="videoLink" type="url" maxlength="2048" placeholder="https://youtu.be/…" autocomplete="off"><button type="submit">Add to queue</button></form>
<p class="notice" role="status" data-queue-note></p><ol data-queue></ol></aside></main>
</body>
</html>`;
}

export function wireYouTubeDesk(doc, raw, queue, { open, check, current, directAllowed, openProxy }) {
  const target = youtubeDeskVideo(raw);
  const player = doc?.querySelector("[data-player]");
  if (!target || !player || player.dataset.ready) return;
  player.dataset.ready = "true";
  const list = doc.querySelector("[data-queue]"), input = doc.querySelector("#videoLink");
  const note = doc.querySelector("[data-queue-note]");
  const render = () => {
    list.replaceChildren();
    for (const [index, item] of queue.entries()) {
      const row = doc.createElement("li"), play = doc.createElement("button"), remove = doc.createElement("button");
      play.type = remove.type = "button";
      play.textContent = `Video ${item.id}`;
      if (item.id === target.id) play.setAttribute("aria-current", "true");
      play.addEventListener("click", () => { if (current() && item.id !== target.id) open(item.url); });
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove video ${item.id}`);
      remove.addEventListener("click", () => { queue.splice(index, 1); render(); input.focus(); note.textContent = "Removed from this tab’s queue."; });
      row.append(play, remove);
      list.append(row);
    }
  };
  if (!queue.some(item => item.id === target.id)) {
    if (queue.length >= 12) queue.pop();
    queue.unshift(target);
  }
  render();
  doc.querySelector("[data-queue-form]").addEventListener("submit", event => {
    event.preventDefault();
    const next = youtubeDeskVideo(input.value.trim());
    if (!next) { note.textContent = "Enter a YouTube link to a specific video."; return; }
    if (queue.some(item => item.id === next.id)) { note.textContent = "That video is already listed."; return; }
    if (queue.length >= 12) { note.textContent = "Remove a video before adding another. The queue holds 12."; return; }
    queue.push(next); input.value = ""; render(); note.textContent = "Video added to this tab’s queue.";
  });
  const status = player.querySelector("[data-player-status]"), action = doc.querySelector("[data-player-action]");
  const original = doc.querySelector("[data-open-original]"), proxy = doc.querySelector("[data-proxy-action]");
  function blocked() {
    action.hidden = true;
    original.hidden = true;
    player.replaceChildren(status);
    status.textContent = "Direct playback is unavailable in this session. You can still use Fast Proxy.";
  }
  original.addEventListener("click", event => { if (!directAllowed()) { event.preventDefault(); blocked(); } });
  proxy.addEventListener("click", () => { if (current()) openProxy(); }, { once: true });
  function loadPlayer() {
    if (!current()) return;
    if (!directAllowed()) return blocked();
    if (player.clientWidth < 200) {
      status.textContent = "Widen this pane, then select Load YouTube player again.";
      return;
    }
    const frame = doc.createElement("iframe");
    frame.title = "Official YouTube video player";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allow = "encrypted-media; fullscreen; picture-in-picture";
    frame.allowFullscreen = true;
    frame.src = target.embed;
    player.replaceChildren(frame);
    action.textContent = "Close YouTube player";
    action.onclick = () => {
      player.replaceChildren(status);
      offerPlayer();
    };
  }
  function offerPlayer() {
    status.textContent = "YouTube allows this video to be embedded. Load its official player when you’re ready.";
    action.textContent = "Load YouTube player";
    action.hidden = false;
    action.onclick = loadPlayer;
  }
  async function verify() {
    if (!current()) return;
    if (!directAllowed()) return blocked();
    action.hidden = true;
    status.textContent = "Checking whether this video can play here…";
    const result = await Promise.resolve().then(() => check(target.id)).catch(() => null);
    if (!current()) return;
    if (!directAllowed()) return blocked();
    if (result?.state === "ready") return offerPlayer();
    if (result?.state === "external") {
      status.textContent = "YouTube doesn’t allow this video in the embedded player. Open it on YouTube.";
      return;
    }
    status.textContent = "Veyra couldn’t verify this video. Retry the check, use Fast Proxy, or open it on YouTube.";
    action.textContent = "Retry eligibility check";
    action.hidden = false;
    action.onclick = verify;
  }
  void verify();
}
