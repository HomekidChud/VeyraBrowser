const IDENTITY_HOSTS = new Set([
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "login.yahoo.com",
  "appleid.apple.com"
]);

const AUTH_PATH = /(^|\/)(?:log-?in|sign-?in|oauth2?|authorize|sso)(?:\/|$)/i;

export function isSignInUrl(url) {
  try {
    const parsed = new URL(url);
    return IDENTITY_HOSTS.has(parsed.hostname.toLowerCase()) || AUTH_PATH.test(parsed.pathname);
  } catch {
    return false;
  }
}
