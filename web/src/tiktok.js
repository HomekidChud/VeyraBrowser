const PLAYER_ORIGIN = "https://www.tiktok.com";
const MAIN_HOSTS = ["www.tiktok.com", "tiktok.com", "m.tiktok.com"];
const SHARE_HOSTS = ["vm.tiktok.com", "vt.tiktok.com"];
const PLAYER_STATES = new Map([
  [-1, "TikTok is initializing the player…"], [0, "TikTok playback ended."],
  [1, "Playing in the TikTok player."], [2, "TikTok playback paused."], [3, "TikTok is buffering…"]
]);

export function publicTikTokPost(raw) {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== "https:" || !MAIN_HOSTS.includes(url.hostname)
        || url.username || url.password || url.port) return null;
    const match = /^\/@([A-Za-z0-9_.]{1,32})\/(video|photo)\/([0-9]{15,22})\/?$/.exec(url.pathname);
    if (!match) return null;
    const [, user, kind, id] = match;
    return { url: `${PLAYER_ORIGIN}/@${user}/${kind}/${id}`, player: `${PLAYER_ORIGIN}/player/v1/${id}?autoplay=0` };
  } catch { return null; }
}

export function tiktokTarget(raw) {
  const post = publicTikTokPost(raw);
  if (post) return post;
  try {
    const url = new URL(String(raw));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const share = SHARE_HOSTS.includes(url.hostname) ? /^\/[A-Za-z0-9]{3,40}\/?$/ : /^\/t\/[A-Za-z0-9]{3,40}\/?$/;
    if (![...MAIN_HOSTS, ...SHARE_HOSTS].includes(url.hostname) || !share.test(url.pathname)) return null;
    return { url: url.origin + url.pathname, player: "" };
  } catch { return null; }
}

export function tiktokPlayerPage() {
  return new URL("../media/tiktok.html?v=3", import.meta.url).href;
}

const mounted = new WeakSet();
export function mountTikTokPlayer(doc, raw, { directAllowed, openProxy }) {
  const post = tiktokTarget(raw);
  const button = doc.querySelector("#loadPlayer");
  const stop = doc.querySelector("#closePlayer");
  const proxy = doc.querySelector("#tryProxy");
  const original = doc.querySelector("#openOriginal");
  const container = doc.querySelector("#player");
  const status = doc.querySelector("#playerStatus");
  const view = doc.defaultView;
  if (!post || !button || !stop || !proxy || !original || !container || !status || !view || mounted.has(doc)) return;
  mounted.add(doc);
  const photo = new URL(post.url).pathname.includes("/photo/");
  let frame, timer, phase = "idle", proxyPending = false;
  const clearPlayer = () => {
    view.clearTimeout(timer);
    frame?.remove();
    frame = null;
    phase = "idle";
    stop.hidden = true;
    button.disabled = false;
  };
  const blockDirect = () => {
    clearPlayer();
    button.hidden = true;
    original.hidden = true;
    status.textContent = "Direct access is unavailable in this session. You can still use Fast Proxy.";
  };
  original.href = post.url;
  original.hidden = false;
  proxy.disabled = false;
  proxy.addEventListener("click", () => {
    if (proxyPending) return;
    proxyPending = true;
    clearPlayer();
    proxy.disabled = button.disabled = true;
    original.hidden = true;
    status.textContent = "Opening this link in Fast Proxy…";
    openProxy();
  });
  original.addEventListener("click", event => { if (!directAllowed()) { event.preventDefault(); blockDirect(); } });
  if (!directAllowed()) { blockDirect(); return; }
  if (!post.player) {
    doc.querySelector("h1").textContent = "TikTok share link";
    doc.querySelector("#playerInfo").textContent = "This shortened URL doesn’t contain a post ID. Open it on TikTok to go to the original post, or try it inside Veyra.";
    status.textContent = "Opening on TikTok connects directly, outside Veyra’s Fast Proxy and VPN.";
    return;
  }
  button.hidden = false;
  button.disabled = false;
  if (photo) button.textContent = "Load TikTok photo post";
  stop.addEventListener("click", () => {
    clearPlayer();
    button.textContent = photo ? "Load TikTok photo post" : "Load TikTok player";
    status.textContent = "TikTok player closed.";
    button.focus();
  });
  function watchdog(message) {
    view.clearTimeout(timer);
    timer = view.setTimeout(() => {
      if (!directAllowed()) { blockDirect(); return; }
      phase = "timeout";
      button.disabled = false;
      status.textContent = message;
    }, 12000);
  }
  view.addEventListener("message", event => {
    if (!frame || event.origin !== PLAYER_ORIGIN || event.source !== frame.contentWindow || event.data?.["x-tiktok-player"] !== true) return;
    const { type, value } = event.data;
    if (!["onPlayerReady", "onPlayerError", "onError", "onStateChange", "onImageChange"].includes(type)) return;
    if (!directAllowed()) { blockDirect(); return; }
    if (phase === "failed") return;
    if (type === "onStateChange" && !PLAYER_STATES.has(value)) return;
    if (type === "onImageChange" && (!photo || !Number.isSafeInteger(value) || value < 0)) return;
    const code = type === "onPlayerError" ? value?.errorCode : type === "onError" ? value : null;
    if (["onPlayerError", "onError"].includes(type) && !Number.isInteger(code)) return;
    if (type === "onPlayerReady" && !["connecting", "initializing", "timeout"].includes(phase)) return;
    if (type === "onStateChange" && [-1, 3].includes(value)) {
      if (value === -1 && !["connecting", "initializing"].includes(phase)) return;
      if (phase !== "timeout") {
        status.textContent = PLAYER_STATES.get(value);
        if (value === 3 && phase !== "buffering") watchdog("TikTok is taking longer than expected. Try its controls, retry, or open the original post.");
        phase = value === -1 ? "initializing" : "buffering";
      }
      return;
    }
    view.clearTimeout(timer);
    if (type === "onPlayerError" || type === "onError") {
      phase = code === 3002 ? "autoplay-blocked" : "failed";
      status.textContent = code === 1001 ? "TikTok says this post isn’t available in its embedded player."
        : code === 2001 ? "TikTok couldn’t serve this post. You can retry or open the original post."
        : code === 3002 ? "Automatic playback was blocked. Try pressing Play in the TikTok player."
        : "TikTok reported a playback problem. You can retry or open the original post.";
      button.disabled = false;
    } else {
      phase = "active";
      status.textContent = type === "onImageChange" ? `Showing photo ${value + 1} in the TikTok player.`
        : type === "onPlayerReady" ? (photo ? "TikTok photo post ready. Use its controls to browse the photos." : "TikTok player ready. Use its controls to start.")
        : photo && value === 1 ? "Playing audio in the TikTok photo post." : PLAYER_STATES.get(value);
      button.disabled = true;
    }
  });
  view.addEventListener("pagehide", clearPlayer);
  button.addEventListener("click", () => {
    if (proxyPending) return;
    if (!directAllowed()) { blockDirect(); return; }
    clearPlayer();
    button.disabled = true;
    button.textContent = "Retry TikTok player";
    stop.hidden = false;
    frame = doc.createElement("iframe");
    frame.title = photo ? "Official TikTok photo post" : "Official TikTok player";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allow = "fullscreen";
    frame.src = post.player;
    phase = "connecting";
    status.textContent = "Waiting for TikTok to confirm the player is ready…";
    watchdog("TikTok didn’t send a status update. If you can see the player, try its controls, or retry the player.");
    container.replaceChildren(frame);
  });
}
