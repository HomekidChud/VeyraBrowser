export const GOOGLE_SIGN_IN = "https://accounts.google.com/";
export const GOOGLE_SIGN_UP = "https://accounts.google.com/signup";
export const GITHUB_SIGN_UP = "https://github.com/signup";

// Never forward state, callback URLs, login hints, or challenge parameters
// from a proxied page. A direct flow starts at an official entry point.
export function accountDestination(input) {
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
  if (url.hostname === "accounts.google.com") {
    const signup = /(?:^|\/)signup(?:\/|$)/i.test(url.pathname);
    return { provider: "Google", url: signup ? GOOGLE_SIGN_UP : GOOGLE_SIGN_IN, signup };
  }
  if (url.hostname === "github.com") {
    const signup = /^\/(?:signup|join)(?:\/|$)/i.test(url.pathname);
    if (signup || /^\/(?:login|session|sessions)(?:\/|$)/i.test(url.pathname)) {
      return { provider: "GitHub", url: signup ? GITHUB_SIGN_UP : "https://github.com/login", signup };
    }
  }
  return null;
}

// A default is added once by the browser, not reinserted on every render.
// Keep the user's existing title if they already bookmarked GitHub signup.
export function withGitHubSignupBookmark(bookmarks) {
  if (bookmarks.some(b => accountDestination(b?.url)?.url === GITHUB_SIGN_UP)) return bookmarks;
  return [...bookmarks, {
    id: "veyra-default-github-signup", url: GITHUB_SIGN_UP, title: "GitHub signup", time: Date.now()
  }];
}
