export const CATEGORIES = Object.freeze({
  web: { label: "Web", icon: "i-globe", description: "Pages from across the web" },
  images: { label: "Images", icon: "i-search-image", description: "Photos, illustrations and visual references" },
  videos: { label: "Videos", icon: "i-search-video", description: "Watch pages and clips from video publishers" },
  news: { label: "News", icon: "i-search-news", description: "Reporting from news publishers" },
  shopping: { label: "Shopping", icon: "i-search-shopping", description: "Marketplace listings and product pages" },
  research: { label: "Research", icon: "i-search-research", description: "Journal articles indexed by Crossref" },
  discussions: { label: "Discussions", icon: "i-search-discussions", description: "Community threads from Hacker News" },
  index: { label: "Veyra index", icon: "i-layers", description: "Pages indexed by Veyra" }
});
export const SEARCH_REGION = "IN";
export const SEARCH_LOCALE = "en-IN";
export const isVertical = key => Object.hasOwn(CATEGORIES, key) && !["web", "index"].includes(key);
export const searchCategory = value => Object.hasOwn(CATEGORIES, value) ? value : "web";
export const searchStateKey = (query, category) => `veyra:search-v2:${JSON.stringify([query, searchCategory(category)])}`;
export function readSearchState(value) {
  if (value.startsWith("veyra:search:")) return { query: value.slice("veyra:search:".length) };
  if (!value.startsWith("veyra:search-v2:")) return null;
  try {
    const [query, category] = JSON.parse(value.slice("veyra:search-v2:".length));
    if (typeof query === "string") return { query, source: searchCategory(category) };
  } catch {}
  return null;
}
export function searchParams(query, category, lang, page = 0, provider = "") {
  const params = new URLSearchParams({ q: query, type: category, lang, region: SEARCH_REGION });
  if (page) { params.set("page", page); params.set("provider", provider); }
  return params;
}
export function resultUrl(value) {
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return "";
    return u.href;
  } catch { return ""; }
}
export function posterUrl(value) {
  const url = resultUrl(value);
  return url && url.startsWith("https:") && ["imgs.search.brave.com", "upload.wikimedia.org", "thumb.wikimedia.org", "i.ebayimg.com", "i.ytimg.com",
    "images-assets.nasa.gov", "science.nasa.gov", "assets.science.nasa.gov", "www.esa.int", "media.esa.int"].includes(new URL(url).hostname) ? url : "";
}
export function mergeResults(previous, next) {
  const key = row => {
    try {
      const u = new URL(row.imageUrl || row.canonicalUrl || row.url);
      u.hash = "";
      for (const name of [...u.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid|mc_cid|mc_eid)$/i.test(name)) u.searchParams.delete(name);
      if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(u.hostname)) {
        const videoId = u.hostname === "youtu.be" ? /^\/([\w-]{11})\/?$/.exec(u.pathname)?.[1] :
          u.pathname === "/watch" ? u.searchParams.get("v") : /^\/shorts\/([\w-]{11})\/?$/.exec(u.pathname)?.[1];
        if (/^[\w-]{11}$/.test(videoId || "")) return `youtube:${videoId}`;
      }
      return u.href;
    } catch { return row.url; }
  };
  const merged = new Map(previous.map(row => [key(row), row]));
  for (const row of next) {
    const id = key(row), existing = merged.get(id);
    if (!existing) merged.set(id, row);
  }
  return [...merged.values()];
}
export function icon(name) { return `<svg aria-hidden="true"><use href="#${name}"/></svg>`; }
export function providerLabel(provider) {
  const labels = {
    brave: "Brave Search", youtube: "YouTube", wikimedia: "Wikimedia Commons", ebay: "eBay", "image-mix": "Image providers and Veyra crawler",
    "google-news-rss": "Google News feed", "web-discovery": "Web discovery", "veyra-crawler": "Veyra crawler", crossref: "Crossref", "hacker-news": "Hacker News", peertube: "PeerTube via Sepia Search"
  };
  return Object.hasOwn(labels, provider) ? labels[provider] : "";
}
export function displayPrice(price) {
  if (price?.currency !== "INR" || !/^\d{1,12}(?:\.\d{1,2})?$/.test(price.value) || !(Number(price.value) > 0)) return "";
  try { return new Intl.NumberFormat(SEARCH_LOCALE, { style: "currency", currency: "INR" }).format(Number(price.value)); }
  catch { return ""; }
}
