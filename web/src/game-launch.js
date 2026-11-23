export function nowGameUrl(raw) {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== "https:" || !["now.gg", "www.now.gg"].includes(url.hostname) || url.username || url.password || url.port) return null;
    return url.href;
  } catch { return null; }
}

export function nowGameMarkup(raw) {
  const target = nowGameUrl(raw);
  if (!target) return "";
  const href = target.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Launch now.gg</title>
  <style>:root{color-scheme:dark;font-family:system-ui,sans-serif;color:#eef3fa;background:#101319}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1rem}main{width:min(100%,36rem);padding:clamp(1rem,5vw,2.5rem);border:1px solid #414b5a;border-radius:1rem;background:#191f28}span,p{color:#bac8d8;line-height:1.55}span{font-size:.8rem;letter-spacing:.09em;text-transform:uppercase}h1{margin:.4rem 0;font-size:clamp(1.55rem,5vw,2.3rem)}a{display:inline-flex;align-items:center;min-height:44px;padding:0 1rem;margin:.35rem 0;border-radius:.55rem;background:#c9deff;color:#122038;font-weight:750;text-decoration:none}a:focus-visible{outline:2px solid #fff;outline-offset:3px}.note{font-size:.85rem;margin-bottom:0}</style>
  </head><body><main><span>Cloud gaming</span><h1>Open now.gg directly</h1><p>This public now.gg link isn’t set up for in-tab play. Open the official page, then choose “Play in browser” when offered.</p><a href="${href}" target="_blank" rel="noopener noreferrer">Open on now.gg</a><p class="note">This opens a separate browser tab outside the Veyra proxy and VPN. now.gg controls game and region availability.</p></main></body></html>`;
}
