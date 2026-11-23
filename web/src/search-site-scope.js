export function siteScope(query) {
  const include = [], exclude = [], terms = [];
  let invalid = false;
  for (const token of String(query).match(/"[^"]*"|-?site:(?:"[^"]*"(?=\s|$)|[^\s]*)|[^\s]+/gi) || []) {
    const op = /^(-?)site:(.*)$/i.exec(token);
    if (!op) { terms.push(token); continue; }
    const value = op[2].replace(/^"([^"]*)"$/, "$1").replace(/^https?:\/\//i, "").replace(/\/$/, "");
    try {
      if (!/^[\p{L}\p{M}\p{N}.-]+$/u.test(value)) throw new Error();
      const domain = new URL(`https://${value}`).hostname.replace(/\.$/, "");
      if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) throw new Error();
      (op[1] ? exclude : include).push(domain);
    } catch { invalid = true; }
  }
  return { include, exclude, invalid, active: invalid || !!(include.length || exclude.length), text: terms.join(" ") };
}

export function scopedUrl(scope, value) {
  if (!scope.active) return true;
  if (scope.invalid) return false;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.replace(/\.$/, "");
    const matches = domain => host === domain || host.endsWith(`.${domain}`);
    return scope.include.every(matches) && !scope.exclude.some(matches);
  } catch { return false; }
}
