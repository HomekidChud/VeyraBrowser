export function originalSiteUrl(raw) {
  if (typeof raw !== "string" || !/^https?:\/\//i.test(raw)) return "";
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

export const DIRECT_SITE_NOTICE = "Opens a separate browser tab outside Veyra’s proxy, VPN and private window. Veyra’s session cookies do not carry over.";
export const SLOW_PROXY_NOTICE = "This site is taking longer than expected in Fast Proxy.";
export function proxyStatusNotice(status) {
  if (status === 401) return "This site requires sign-in or authorization.";
  if (status === 403) return "This site refused the Fast Proxy request.";
  if (status === 451) return "This site says this page is unavailable for legal reasons (HTTP 451).";
  if (status === 429) return "This site is rate-limiting requests. Wait before trying again.";
  if ([500, 502, 503, 504].includes(status)) return "This site returned a server error. You can retry when it’s responding again.";
  return "";
}

export function siteLoadErrorMarkup(title, error, raw, { offerDirect = true, returnToTikTok = false } = {}) {
  const target = offerDirect ? originalSiteUrl(raw) : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>:root{color-scheme:dark light;font:1rem/1.5 system-ui,sans-serif;color:CanvasText;background:Canvas}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center}main{width:min(100%,36rem);padding:clamp(1rem,6vw,2rem);overflow-wrap:anywhere}h1{font-size:clamp(1.35rem,5vw,1.75rem);line-height:1.2;margin:0 0 .75rem}p{margin:.5rem 0}code,small{font-size:.875rem}.actions{display:flex;flex-wrap:wrap;gap:.625rem;margin-top:1rem}button,a{display:inline-flex;align-items:center;min-height:44px;padding:.5rem .8rem;border:1px solid color-mix(in srgb,CanvasText 45%,Canvas);border-radius:.4rem;background:Canvas;color:CanvasText;font:inherit;font-weight:650;text-decoration:none;cursor:pointer}:is(button,a):focus-visible{outline:2px solid Highlight;outline-offset:2px}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(error?.message || "Unknown error")}</p>${error?.requestId ? `<code>Request ${escapeHtml(error.requestId)}</code>` : ""}
<div class="actions"><button type="button" id="veyra-local-retry">Try again</button>${returnToTikTok ? `<button type="button" id="veyra-local-options">Return to TikTok options</button>` : ""}${target ? `<a href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer">Open original site</a>` : ""}</div>${target ? `<p><small>${DIRECT_SITE_NOTICE}</small></p>` : ""}</main></body></html>`;
}
