// Keep the xHamster watch tab in place on older Fast Proxy servers as well.
// Match the real hostname boundary and ignore tracking parameters/fragments.
export function blockPlaybackPopup(source, destination, explicitLink = false) {
  const site = /^(?:[a-z0-9-]+\.)*xhamster\.com$/i;
  const watch = /^\/videos\/([^/]+)\/?$/i;
  let opener, from;
  try { opener = new URL(source); from = site.test(opener.hostname) && watch.exec(opener.pathname); } catch {}
  if (!from) return false;
  try {
    const next = new URL(destination, opener);
    if (!/^https?:$/.test(next.protocol) || !site.test(next.hostname)) return !explicitLink;
    const to = watch.exec(next.pathname);
    if (!to) return false;
    const videoId = slug => /(?:^|[-_])(x[hx][a-z0-9]+)$/i.exec(slug)?.[1]?.toLowerCase();
    return from[1] === to[1] || (!!videoId(from[1]) && videoId(from[1]) === videoId(to[1]));
  } catch { return !explicitLink; }
}
