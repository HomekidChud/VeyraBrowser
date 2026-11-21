const PLAYER_ORIGIN = "https://www.tiktok.com";

export function publicTikTokPost(raw) {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== "https:" || !["www.tiktok.com", "tiktok.com"].includes(url.hostname)
        || url.username || url.password || url.port) return null;
    const match = /^\/@([A-Za-z0-9_.]{1,32})\/(video|photo)\/([0-9]{15,22})\/?$/.exec(url.pathname);
    if (!match) return null;
    const [, user, kind, id] = match;
    return { url: `${PLAYER_ORIGIN}/@${user}/${kind}/${id}`, player: `${PLAYER_ORIGIN}/player/v1/${id}?autoplay=0` };
  } catch { return null; }
}

export function tiktokPlayerPage() {
  return new URL("../media/tiktok.html", import.meta.url).href;
}

const mounted = new WeakSet();
export function mountTikTokPlayer(doc, raw, { directAllowed, openProxy }) {
  const post = publicTikTokPost(raw);
  const button = doc.querySelector("#loadPlayer");
  const proxy = doc.querySelector("#tryProxy");
  const original = doc.querySelector("#openOriginal");
  const container = doc.querySelector("#player");
  const status = doc.querySelector("#playerStatus");
  const view = doc.defaultView;
  if (!post || !button || !proxy || !original || !container || !status || !view || mounted.has(doc)) return;
  mounted.add(doc);
  const blockDirect = () => { status.textContent = "Direct playback is unavailable in this session. You can still use Fast Proxy."; };
  original.href = post.url;
  original.hidden = false;
  button.disabled = false;
  proxy.disabled = false;
  proxy.addEventListener("click", openProxy, { once: true });
  original.addEventListener("click", event => { if (!directAllowed()) { event.preventDefault(); blockDirect(); } });
  button.addEventListener("click", () => {
    if (!directAllowed()) { blockDirect(); return; }
    button.disabled = true;
    const frame = doc.createElement("iframe");
    frame.title = "Official TikTok player";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allow = "fullscreen";
    frame.src = post.player;
    status.textContent = "Connecting directly to TikTok…";
    const timer = view.setTimeout(() => {
      status.textContent = "TikTok hasn’t confirmed playback. You can open the original post instead.";
    }, 12000);
    view.addEventListener("message", event => {
      if (event.origin !== PLAYER_ORIGIN || event.source !== frame.contentWindow || event.data?.["x-tiktok-player"] !== true) return;
      if (!["onPlayerReady", "onPlayerError"].includes(event.data.type)) return;
      view.clearTimeout(timer);
      status.textContent = event.data.type === "onPlayerReady"
        ? "TikTok player ready. Use the player controls to start."
        : "TikTok couldn’t load this post here. You can open the original post instead.";
    });
    container.replaceChildren(frame);
  });
}
