const PLAYER_ORIGIN = "https://www.tiktok.com";
const MAIN_HOSTS = ["www.tiktok.com", "tiktok.com", "m.tiktok.com"];
const SHARE_HOSTS = ["vm.tiktok.com", "vt.tiktok.com"];
function httpsTikTok(raw) {
  try {
    const url = new URL(String(raw));
    if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
        (MAIN_HOSTS.includes(url.hostname) || SHARE_HOSTS.includes(url.hostname))) return url;
  } catch {}
  return null;
}
export function normalizeTikTokHome(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && url.hostname === "tiktok.com" && url.pathname === "/" &&
        !url.username && !url.password && !url.port) {
      url.hostname = "www.tiktok.com";
      return url.href;
    }
  } catch {}
  return raw;
}
const PLAYER_STATES = new Map([
  [-1, "TikTok is initializing the player…"], [0, "TikTok playback ended."],
  [1, "Playing in the TikTok player."], [2, "TikTok playback paused."], [3, "TikTok is buffering…"]
]);

export function publicTikTokPost(raw) {
  const url = httpsTikTok(raw);
  if (!url || !MAIN_HOSTS.includes(url.hostname)) return null;
  const match = /^\/@([A-Za-z0-9_.]{1,32})\/(video|photo)\/([0-9]{15,22})\/?$/.exec(url.pathname);
  if (!match) return null;
  const [, user, kind, id] = match;
  return { url: `${PLAYER_ORIGIN}/@${user}/${kind}/${id}`, player: `${PLAYER_ORIGIN}/player/v1/${id}?autoplay=0` };
}

export function tiktokTarget(raw) {
  const post = publicTikTokPost(raw);
  if (post) return post;
  const url = httpsTikTok(raw);
  if (!url) return null;
  const separateShareHost = SHARE_HOSTS.includes(url.hostname);
  const share = separateShareHost ? /^\/[A-Za-z0-9]{3,40}\/?$/ : /^\/t\/[A-Za-z0-9]{3,40}\/?$/;
  if (share.test(url.pathname)) return { url: url.origin + url.pathname, player: "", kind: "share" };
  if (separateShareHost) return null;
  const handle = /^\/@([A-Za-z0-9_.]{1,32})\/?$/.exec(url.pathname)?.[1];
  if (handle) return { url: `${PLAYER_ORIGIN}/@${handle}`, player: "", kind: "profile", handle };
  return { url: normalizeTikTokHome(url.href), player: "", kind: "site" };
}

export function tiktokPlayerPage() {
  return new URL("../media/tiktok.html?v=5", import.meta.url).href;
}

function makeProfileFrame(doc, post) {
  // Host the creator preview in a TikTok document, not by loading embed.js
  // as a script on the Veyra origin.
  const iframe = doc.createElement("iframe");
  iframe.className = "profile-embed";
  iframe.title = `TikTok creator profile for @${post.handle}`;
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.src = `${PLAYER_ORIGIN}/embed/@${post.handle}`;
  return iframe;
}

const mounted = new WeakSet();
export async function resolveSharedTikTokPost(apiOrigin, link, signal, request = fetch) {
  const share = tiktokTarget(link);
  if (share?.kind !== "share") return "";
  const response = await request(`${apiOrigin}/api/media/tiktok/share`, { method: "POST", credentials: "omit",
    redirect: "error", referrerPolicy: "no-referrer", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: share.url }) });
  if (!response.ok) return "";
  const data = await response.json();
  return data?.state === "resolved" ? publicTikTokPost(data.url)?.url || "" : "";
}

export function mountTikTokPlayer(doc, raw, { directAllowed, openProxy, resolveShare, openPost }) {
  const post = tiktokTarget(raw);
  const button = doc.querySelector("#loadPlayer");
  const stop = doc.querySelector("#closePlayer");
  const proxy = doc.querySelector("#tryProxy");
  const original = doc.querySelector("#openOriginal");
  const info = doc.querySelector("#playerInfo");
  const heading = doc.querySelector("h1");
  const container = doc.querySelector("#player");
  const status = doc.querySelector("#playerStatus");
  const view = doc.defaultView;
  if (!post || !button || !stop || !proxy || !original || !info || !heading || !container || !status || !view || mounted.has(doc)) return;
  mounted.add(doc);
  const photo = new URL(post.url).pathname.includes("/photo/");
  const profile = post.kind === "profile";
  const loadLabel = profile ? "Load TikTok profile" : photo ? "Load TikTok photo post" : "Load TikTok player";
  if (profile) {
    heading.textContent = `TikTok profile: @${post.handle}`;
    info.textContent = "Load the official creator preview, or open the full profile on TikTok. Both connect directly, outside Veyra’s Fast Proxy and VPN.";
  } else if (post.kind === "share") {
    heading.textContent = "TikTok share link";
    info.textContent = "Find the original public post in Veyra, or open the share link directly on TikTok in a separate tab. The TikTok player connects outside Veyra’s Fast Proxy and VPN.";
  } else if (post.kind === "site") {
    heading.textContent = "TikTok";
    info.textContent = "The full TikTok site can appear blank in Fast Proxy. Open TikTok in a separate tab for the feed, search and account features. This connects directly, outside Veyra’s Fast Proxy and VPN.";
  }
  let frame, timer, shareRequest, phase = "idle", proxyPending = false;
  const clearPlayer = () => {
    shareRequest?.abort();
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
    info.textContent = "Fast Proxy keeps your current privacy settings, but TikTok may not load through it.";
    status.textContent = "Direct TikTok access is unavailable in this session.";
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
  if (post.kind === "share" && resolveShare && openPost) {
    button.hidden = false;
    button.textContent = "Find public post";
    view.addEventListener("pagehide", clearPlayer);
    button.addEventListener("click", async () => {
      if (proxyPending || button.disabled) return;
      if (!directAllowed()) { blockDirect(); return; }
      const request = shareRequest = new AbortController();
      button.disabled = true;
      status.textContent = "Looking up the original public post…";
      let destination;
      try { destination = await resolveShare(post.url, AbortSignal.any([request.signal, AbortSignal.timeout(6500)])); } catch {}
      if (request.signal.aborted || shareRequest !== request) return;
      if (!directAllowed()) { blockDirect(); return; }
      shareRequest = null;
      if (destination) { status.textContent = "Public post found."; openPost(destination); return; }
      status.textContent = "Veyra couldn’t find a public post. Retry or open the link on TikTok.";
      button.textContent = "Retry post lookup";
      button.disabled = false;
    });
    return;
  }
  if (!post.player && !profile) return;
  button.hidden = false;
  button.disabled = false;
  button.textContent = loadLabel;
  if (profile) stop.textContent = "Close TikTok profile";
  stop.addEventListener("click", () => {
    clearPlayer();
    button.textContent = loadLabel;
    status.textContent = profile ? "TikTok profile preview closed." : "TikTok player closed.";
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
    if (profile || !frame || event.origin !== PLAYER_ORIGIN || event.source !== frame.contentWindow || event.data?.["x-tiktok-player"] !== true) return;
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
    stop.hidden = false;
    if (profile) {
      frame = makeProfileFrame(doc, post);
      status.textContent = "If TikTok’s preview doesn’t appear, retry or open the full profile on TikTok.";
      button.textContent = "Retry TikTok profile";
      container.replaceChildren(frame);
      return;
    }
    button.disabled = true;
    button.textContent = "Retry TikTok player";
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
