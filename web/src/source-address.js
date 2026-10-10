const SOURCE_URI = /^veyra:\/\/view_source\/([A-Za-z0-9_-]{20,40})\/([A-Za-z0-9_-]{8,4096})$/;

export function parseSourceUri(value) {
  const uri = String(value || "").trim();
  const match = SOURCE_URI.exec(uri);
  return match ? { uri, id: match[1], encodedLink: match[2], path: `/view_source/${match[1]}/${match[2]}` } : null;
}

export function resolveSourceUri(value, apiBase) {
  const parsed = parseSourceUri(value);
  if (!parsed) return null;
  try {
    const base = new URL(String(apiBase || ""));
    if (!/^https?:$/.test(base.protocol) || base.username || base.password) return null;
    const target = new URL(parsed.path, base.origin);
    return { ...parsed, url: target.href };
  } catch { return null; }
}

export function validateSourceDisplayUrl(displayUrl, targetUrl, apiOrigin) {
  const parsed = parseSourceUri(displayUrl);
  if (!parsed) return "";
  try {
    const target = new URL(String(targetUrl || ""));
    const expectedOrigin = new URL(String(apiOrigin || "")).origin;
    if (!/^https?:$/.test(target.protocol) || target.origin !== expectedOrigin || target.pathname !== parsed.path || target.search || target.hash) return "";
    return parsed.uri;
  } catch { return ""; }
}
