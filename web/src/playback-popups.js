const site = /^(?:[a-z0-9-]+\.)*xhamster\.com$/i;

function webUrl(value, base) {
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) && !url.port && !url.username && !url.password ? url : null;
  } catch { return null; }
}

function playbackPage(url) {
  const path = /^(?:\/(videos|embed)\/([^/]+))\/?$/i.exec(url?.pathname || "");
  if (!path) return null;
  const kind = path[1].toLowerCase();
  const id = (kind === "embed" ? /^(x[hx][a-z0-9]+)$/i : /(?:^|[-_])(x[hx][a-z0-9]+)$/i).exec(path[2])?.[1]?.toLowerCase();
  if (kind === "embed" && !id) return null;
  return { kind, id, key: id ? `id:${id}` : `watch:${path[2]}` };
}

export function xhamsterPlaybackKey(value) {
  const url = webUrl(value);
  return url && site.test(url.hostname) ? playbackPage(url)?.key || "" : "";
}

// Recognize the same video across embeds, renamed watch URLs and subdomains.
// The embed can link through an ad redirect; never load that redirect or use
// its query parameters. Open the matching watch path on the official site.
export function playbackPopupDecision(source, destination, explicitLink = false) {
  const opener = webUrl(source);
  const from = opener && site.test(opener.hostname) && playbackPage(opener);
  if (!from) return { action: "allow" };
  const next = webUrl(destination, opener);
  const official = next && site.test(next.hostname);
  const redirect = next?.protocol === "https:" && next.hostname === "adc3.lol";
  const to = (official || redirect) && playbackPage(next);
  if (to && from.key === to.key && (official || (from.id && to.kind === "videos"))) {
    if (from.kind === "embed" && to.kind === "videos") {
      return { action: "watch-in-place", key: from.key, url: official ? next.href : `https://xhamster.com${next.pathname}` };
    }
    return { action: "block" };
  }
  return { action: official || explicitLink ? "allow" : "block" };
}

export function blockPlaybackPopup(source, destination, explicitLink = false) {
  return playbackPopupDecision(source, destination, explicitLink).action !== "allow";
}
