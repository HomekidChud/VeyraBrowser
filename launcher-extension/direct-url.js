export function directSiteUrl(raw) {
  const value = raw.trim();
  if (!/^https:\/\/[^/?#]+/i.test(value) || /[\s\\\x00-\x1f\x7f]/u.test(value)) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}
