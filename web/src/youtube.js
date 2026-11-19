function safeYouTubeUrl(raw) {
  try {
    const url = new URL(String(raw));
    if (!/^https?:$/.test(url.protocol) || !isYouTubeUrl(url.href)) return null;
    if (url.hostname.toLowerCase() === "m.youtube.com") url.hostname = "www.youtube.com";
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeYouTubeUrl(raw) {
  return safeYouTubeUrl(raw) || String(raw ?? "");
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

export function youtubeFallbackHtml(raw, origin = globalThis.location?.origin || "") {
  const target = safeYouTubeUrl(raw);
  const embedUrl = target && youtubeEmbedUrl(target, origin);
  if (!target || !embedUrl) return "";

  return `<!doctype html>
<html lang="en" data-veyra-youtube-fallback="true">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YouTube video</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0d0f13;color:#f2f4f8}
*{box-sizing:border-box}body{margin:0}main{min-height:100vh;display:grid;grid-template-rows:minmax(200px,1fr) auto}.player{display:flex;justify-content:center;background:#000;min-height:200px}.player iframe{display:block;width:100%;height:100%;min-height:200px;border:0}
footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.25rem 1rem;padding:.25rem clamp(.6rem,3vw,1.5rem);border-top:1px solid #2c3645}p{margin:0;color:#bac6d6;font-size:.8rem;line-height:1.4}a{display:inline-flex;align-items:center;min-height:44px;color:#d9e7ff;font-weight:650;font-size:.875rem;text-underline-offset:.18em}
</style>
</head>
<body><main aria-label="Official YouTube player"><div class="player"><iframe src="${escapeHtml(embedUrl)}" title="YouTube video player" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe></div><footer><p>YouTube loads directly, outside the Veyra proxy. Some videos require YouTube sign-in or do not allow embeds.</p><a href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a></footer></main>
</body>
</html>`;
}
