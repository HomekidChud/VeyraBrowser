// Only confirmed, narrow compatibility failures get a native-browser handoff.
// A 403 does not establish why the provider rejected a request.
export function nativeBrowserReason({ pageUrl, url, status }) {
  if (Number(status) !== 403) return "";
  try {
    const page = new URL(pageUrl), resource = new URL(url);
    const tiktok = host => host === "tiktok.com" || host.endsWith(".tiktok.com");
    if (page.protocol === "https:" && resource.protocol === "https:" &&
        tiktok(page.hostname) && tiktok(resource.hostname) &&
        /^\/api\/(?:recommend|preload)\/item_list\/?$/.test(resource.pathname))
      return "TikTok rejected its feed request through Fast Proxy. Try a normal browser; its cookies stay separate.";
  } catch {}
  return "";
}
