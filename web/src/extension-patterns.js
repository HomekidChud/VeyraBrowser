// Preserve path case: URL paths are case-sensitive; hostnames are not.
export function matchesExtension(ext, rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return false; }
  if (!/^https?:$/.test(url.protocol)) return false;
  const list = Array.isArray(ext.matches) && ext.matches.length ? ext.matches : ['<all_urls>'];
  const excludes = Array.isArray(ext.excludeMatches) ? ext.excludeMatches : [];
  const match = raw => {
    const pattern = String(raw || '').trim();
    if (pattern === '<all_urls>' || pattern === '*') return true;
    const parsed = pattern.match(/^(?:(\*|https?):\/\/)?([^/]+)(\/.*)?$/i);
    if (!parsed) return false;
    const [, scheme = '*', rawHost = '', path = '/*'] = parsed;
    if (scheme !== '*' && url.protocol !== `${scheme.toLowerCase()}:`) return false;
    const host = rawHost.toLowerCase(), hostname = url.hostname.toLowerCase();
    const hostOk = host === '*' || (host.startsWith('*.')
      ? hostname === host.slice(2) || hostname.endsWith(`.${host.slice(2)}`)
      : hostname === host);
    if (!hostOk) return false;
    const regex = new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return regex.test(url.pathname + url.search);
  };
  return list.some(match) && !excludes.some(match);
}
