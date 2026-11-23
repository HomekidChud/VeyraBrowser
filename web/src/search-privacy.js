export const SEARCH_PRIVACY = Object.freeze({
  filtered: ["Filtered", "Hide known adult sources and explicitly labelled adult results."],
  blocked: ["Blocked", "Also stop searches that explicitly target known adult sites before sending them."],
  restricted: ["Restricted", "Keep public filtering. Approved publisher catalogs require sign-in and age verification."],
  unfiltered: ["Unfiltered", "Turn off Veyra’s optional public-result filters. Provider and catalog safeguards still apply."]
});

// Keep in step with VeyraServer's public search rules. This list is not a classifier.
const ADULT_HOSTS = ["porn.com", "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "youporn.com", "redtube.com",
  "tube8.com", "spankbang.com", "phncdn.com", "others-cdn.com"];
const URL_FIELDS = ["url", "canonical", "canonicalUrl", "sourcePageUrl", "imageUrl", "thumbnail", "thumbnailUrl", "posterUrl", "embedUrl", "favicon"];

export const searchPrivacy = value => typeof value === "string" && Object.hasOwn(SEARCH_PRIVACY, value) ? value : "filtered";
const knownHost = host => ADULT_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
function knownAdultUrl(input) {
  if (typeof input !== "string" || !input) return false;
  try {
    const url = new URL(input.startsWith("//") ? `https:${input}` : input);
    return /^https?:$/.test(url.protocol) && knownHost(url.hostname.replace(/\.+$/, ""));
  } catch { return false; }
}
export function masksSearchScope(mode, query, scope) {
  if (mode === "unfiltered") return false;
  if (scope.include.some(knownHost)) return true;
  if (mode !== "blocked") return false;
  return (String(query).match(/[^\s"'<>()[\]{},;]+/g) || []).some(token =>
    !/^-site:/i.test(token) && knownAdultUrl(/^(?:https?:)?\/\//i.test(token) ? token : `https://${token}`));
}
export function allowsSearchResult(mode, row) {
  if (!row) return false;
  if (mode === "unfiltered") return true;
  return ![row, row.media, row.evidence].some(item => item &&
    (item.adult === true || item.nsfw === true || item.isAdult === true || URL_FIELDS.some(key => knownAdultUrl(item[key]))));
}
