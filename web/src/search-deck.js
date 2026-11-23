import { siteScope } from "./search-site-scope.js?v=1";

export const CATEGORIES = Object.freeze({
  web: { label: "Web", icon: "i-globe", description: "Pages from across the web" },
  images: { label: "Images", icon: "i-search-image", description: "Photos, illustrations and visual references" },
  videos: { label: "Videos", icon: "i-search-video", description: "Watch pages and clips from video publishers" },
  news: { label: "News", icon: "i-search-news", description: "Reporting from news publishers" },
  shopping: { label: "Shopping", icon: "i-search-shopping", description: "Marketplace listings and product pages" },
  research: { label: "Research", icon: "i-search-research", description: "Papers and journal articles from scholarly indexes" },
  discussions: { label: "Discussions", icon: "i-search-discussions", description: "Threads from Hacker News and topic-specific communities" },
  index: { label: "Veyra index", icon: "i-layers", description: "Pages indexed by Veyra" }
});
export const SEARCH_REGION = "IN";
export const SEARCH_LOCALE = "en-IN";
export const isVertical = key => Object.hasOwn(CATEGORIES, key) && !["web", "index"].includes(key);
export const searchCategory = value => Object.hasOwn(CATEGORIES, value) ? value : "web";
const GOOGLE_WEB_HOST = /^(?:www\.)?google\.(?:com|co\.uk|co\.in)$/i;

export function searchEntry(value) {
  const input = String(value || "").trim();
  const command = /^search:\s*/i.exec(input);
  const text = command ? input.slice(command[0].length) : input;
  const google = command && /^(?:www\.)?google\.com\s+(\S[\s\S]*)$/i.exec(text);
  const site = command && /^([\p{L}\p{M}\p{N}.-]+)(?:\s+([\s\S]+))?$/u.exec(text);
  if (site && !/^(?:www\.)?google\.com$/i.test(site[1])) {
    const [domain] = siteScope(`site:${site[1]}`).include;
    if (domain && /\.[a-z][a-z0-9-]*$/.test(domain) && !/\.(?:localhost|local|internal|lan)$/.test(domain)) {
      return { query: `site:${domain}${site[2] ? ` ${site[2]}` : ""}`, domain, command: true, preferGoogle: false };
    }
  }
  return { query: google ? google[1] : text, command: Boolean(command), preferGoogle: Boolean(google) };
}

export function isGoogleWebUrl(value) {
  try {
    const u = new URL(value);
    return /^https?:$/.test(u.protocol) && !u.username && !u.password && !u.port && GOOGLE_WEB_HOST.test(u.hostname) &&
      /^\/(?:search|webhp)?$/.test(u.pathname);
  } catch { return false; }
}
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
  if (url === "https://doc.qt.io/qtforpython-6/_images/coroutines.png") return url;
  if (url.startsWith("https://api.openverse.org/")) {
    const u = new URL(url);
    return /^\/v1\/images\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/thumb\/$/i.test(u.pathname) && !u.search && !u.hash ? url : "";
  }
  return url && url.startsWith("https:") && ["imgs.search.brave.com", "upload.wikimedia.org", "thumb.wikimedia.org", "i.ebayimg.com", "i.ytimg.com",
    "images-assets.nasa.gov", "science.nasa.gov", "assets.science.nasa.gov", "www.esa.int", "media.esa.int"].includes(new URL(url).hostname) ? url : "";
}
export function mediaPageKey(value) {
  const url = resultUrl(value);
  if (!url) return "";
  const u = new URL(url);
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  return u.href;
}
export function mergeResults(previous, next) {
  const key = row => {
    if (/^10\.\d{4,9}\/[^\s?#%]{1,500}$/i.test(row.doi || "")) return `doi:${row.doi.toLowerCase()}`;
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
    "google-news-rss": "Google News feed", "web-discovery": "Web discovery", "veyra-crawler": "Veyra crawler", crossref: "Crossref", "hacker-news": "Hacker News", peertube: "PeerTube via Sepia Search", openverse: "Openverse",
    "verified-videos": "Verified YouTube watch links", "reference-images": "Publisher reference images", "india-storefronts": "Indian retailer listings",
    "space-images": "Space image archives", "nasa-library": "NASA Image and Video Library", "research-mix": "Scholarly indexes",
    "europe-pmc": "Europe PMC", "discussion-mix": "Community search", "stack-exchange": "Stack Exchange",
    google: "Google API", duckduckgo: "DuckDuckGo", bing: "Bing", mojeek: "Mojeek", ecosia: "Ecosia", yahoo: "Yahoo",
    startpage: "Startpage", searxng: "SearXNG", local: "Veyra index", "veyra-index": "Veyra index", "veyra-crawl": "Veyra crawler", "veyra-reference": "Veyra reference catalog", "veyra-navigation": "Website",
    wikipedia: "Wikipedia", stackoverflow: "Stack Overflow", mdn: "MDN Web Docs", github: "GitHub", npm: "npm",
    "crates-io": "crates.io", "open-library": "Open Library", wikivoyage: "Wikivoyage", wiktionary: "Wiktionary", wikibooks: "Wikibooks"
  };
  return Object.hasOwn(labels, provider) ? labels[provider] : "";
}
export function externalSearchLinks(query, source) {
  const link = (label, base, param) => ({ label, url: `${base}?${new URLSearchParams({ [param]: query })}` });
  if (source === "videos") return [link("Search YouTube", "https://www.youtube.com/results", "search_query")];
  if (source === "shopping") return [
    link("Search Amazon India", "https://www.amazon.in/s", "k"),
    link("Search Flipkart", "https://www.flipkart.com/search", "q")
  ];
  if (source === "images") return [link("Search Openverse", "https://openverse.org/search/image", "q")];
  return [];
}
export function displayPrice(price) {
  if (price?.currency !== "INR" || !/^\d{1,12}(?:\.\d{1,2})?$/.test(price.value) || !(Number(price.value) > 0)) return "";
  try { return new Intl.NumberFormat(SEARCH_LOCALE, { style: "currency", currency: "INR" }).format(Number(price.value)); }
  catch { return ""; }
}
