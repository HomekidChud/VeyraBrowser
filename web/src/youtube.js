function safeYouTubeUrl(raw) {
  try {
    const url = new URL(String(raw));
    if (!/^https?:$/.test(url.protocol) || !isYouTubeUrl(url.href)) return null;
    return url.href;
  } catch {
    return null;
  }
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
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
    else if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
      else if (/^\/(shorts|live|embed)\//.test(url.pathname)) id = url.pathname.split("/").filter(Boolean)[1] || "";
    }
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;

    const params = new URLSearchParams({ enablejsapi: "1", playsinline: "1", rel: "0" });
    const pageOrigin = String(origin || "");
    if (/^https?:\/\//i.test(pageOrigin)) {
      params.set("origin", pageOrigin);
      params.set("widget_referrer", pageOrigin);
    }
    const start = url.searchParams.get("start") || url.searchParams.get("t");
    if (start && /^\d+$/.test(String(start))) params.set("start", String(start));
    if (url.searchParams.get("list")) params.set("list", url.searchParams.get("list"));
    if (url.searchParams.get("index")) params.set("index", url.searchParams.get("index"));
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

export function youtubeFallbackHtml(raw, origin = globalThis.location?.origin || "") {
  const target = safeYouTubeUrl(raw);
  if (!target) return "";
  const embedUrl = youtubeEmbedUrl(target, origin);
  const signInUrl = youtubeSignInUrl(target);
  const hasVideo = !!embedUrl;
  const title = hasVideo ? "Your YouTube video is ready" : "Open YouTube directly";
  const message = hasVideo
    ? "The video player is shown below. If playback is restricted, open the video directly on YouTube."
    : "YouTube’s interactive home feed cannot run inside Veyra’s Fast Proxy. Open YouTube in a regular browser tab for the full feed.";
  const video = hasVideo ? `<div class="player"><iframe src="${escapeHtml(embedUrl)}" title="YouTube video player" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe></div>` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:#0d0f13;color:#f2f4f8}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:clamp(16px,4vw,40px);background:radial-gradient(ellipse at 50% 0%,#182132 0%,#0d0f13 60%)}
main{width:min(100%,900px)}.card{padding:clamp(20px,4vw,36px);border:1px solid #29303b;border-radius:20px;background:#12161deF;box-shadow:0 22px 70px #0007}.brand{display:flex;align-items:center;gap:10px;color:#f6f7fa;font-weight:750;font-size:18px}.play{display:grid;place-items:center;width:32px;height:23px;border-radius:7px;background:#f22;color:#fff;font-size:14px}.eyebrow{margin:26px 0 8px;color:#aab4c4;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{margin:0;font-size:clamp(25px,5vw,38px);line-height:1.12;letter-spacing:-.035em}p{color:#b7c0ce;line-height:1.6}.player{margin:24px 0 12px;aspect-ratio:16/9;overflow:hidden;border-radius:14px;background:#000}.player iframe{display:block;width:100%;height:100%;border:0}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border:1px solid #3a4352;border-radius:10px;color:#f2f4f8;text-decoration:none;font-weight:650}.button.primary{border-color:#e62117;background:#e62117;color:#fff}.note{margin:16px 0 0;font-size:12px;color:#8994a4}
</style>
</head>
<body><main><section class="card"><div class="brand"><span class="play" aria-hidden="true">▶</span><span>YouTube</span></div><p class="eyebrow">Veyra Fast Proxy</p><h1>${title}</h1><p>${message}</p>${video}<div class="actions"><a class="button primary" href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer">${hasVideo ? "Watch on YouTube" : "Open YouTube in a new tab"}</a><a class="button" href="${escapeHtml(signInUrl)}" target="_blank" rel="noopener noreferrer">Sign in to YouTube</a></div><p class="note">Sign-in opens directly on Google. Veyra does not receive or store your Google credentials.</p></section></main></body>
</html>`;
}
