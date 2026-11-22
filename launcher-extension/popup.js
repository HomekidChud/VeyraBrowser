"use strict";
// Veyra Browser Launcher — cookie transfer to an open Veyra tab.
//
// Flow: the user clicks Send on a site they are signed into. The extension
// reads that site's cookies (chrome.cookies — includes HttpOnly), finds the
// user's open Veyra Browser tab, asks that tab's page for its current Veyra
// session id, and posts the cookies to the session's own jar. The transfer
// only ever targets the user's own open session and only happens on click.

const DEFAULT_API = "https://veyraserver-xscy.onrender.com";
const VEYRA_TAB_PATTERNS = ["https://homekidchud.github.io/VeyraBrowser/*", "http://localhost/*", "http://127.0.0.1/*"];
const SAME_SITE = { no_restriction: "None", lax: "Lax", strict: "Strict", unspecified: "Lax" };

const siteLine = document.getElementById("site-line");
const sendBtn = document.getElementById("send");
const xferStatus = document.getElementById("xfer-status");
const apiInput = document.getElementById("api-input");
const apiSave = document.getElementById("api-save");
const apiStatus = document.getElementById("api-status");

let current = { url: "", cookies: [] };
let sending = false;

function setStatus(el, text, kind) {
  el.textContent = text || "";
  el.className = kind || "";
}

function toVeyraCookie(c) {
  return {
    name: c.name,
    value: c.value || "",
    domain: c.domain || "",
    path: c.path || "/",
    secure: !!c.secure,
    // chrome.cookies: expirationDate (unix seconds, absent for session
    // cookies); the Veyra API expects Playwright's `expires`.
    expires: c.expirationDate ? Math.floor(c.expirationDate) : 0,
    httpOnly: !!c.httpOnly,
    sameSite: SAME_SITE[c.sameSite] || "Lax"
  };
}

function isHttpUrl(url) {
  try { const u = new URL(url); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function captureCookies(url) {
  const raw = await chrome.cookies.getAll({ url });
  return raw.map(toVeyraCookie).filter(c => c.name);
}

// Injected into the Veyra app tab: ask the page for its session id, falling
// back to the last persisted session in localStorage.
function askVeyraTabForSession() {
  return new Promise(resolve => {
    let settled = false;
    const done = value => { if (!settled) { settled = true; window.removeEventListener("message", onMsg); resolve(value || ""); } };
    const onMsg = ev => { if (ev.data && ev.data.type === "veyra:session") done(ev.data.sid); };
    window.addEventListener("message", onMsg);
    try { window.postMessage({ type: "veyra:request-session" }, "*"); } catch { done(""); return; }
    setTimeout(() => {
      try { done(JSON.parse(localStorage.getItem("veyra-live-session") || "null")?.id || ""); }
      catch { done(""); }
    }, 600);
  });
}

async function findVeyraSessionId() {
  const tabs = await chrome.tabs.query({ url: VEYRA_TAB_PATTERNS });
  for (const tab of tabs) {
    if (!/veyrabrowser/i.test(tab.url || "")) continue;
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: askVeyraTabForSession });
      if (res?.result) return { sid: String(res.result), tab };
    } catch { /* tab not injectable (chrome:// etc.) — keep looking */ }
  }
  return { sid: "", tab: null };
}

async function send() {
  if (sending || !current.url || !current.cookies.length) return;
  sending = true;
  sendBtn.disabled = true;
  setStatus(xferStatus, "Sending…");
  try {
    const { sid } = await findVeyraSessionId();
    if (!sid) {
      setStatus(xferStatus, "No Veyra session found. Open your Veyra Browser tab (with a session running) and try again.", "err");
      return;
    }
    const api = (apiInput.value || DEFAULT_API).replace(/\/+$/, "");
    const r = await fetch(`${api}/api/handoff/cookies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sid, url: current.url, cookies: JSON.stringify(current.cookies), userAgent: navigator.userAgent })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`);
    setStatus(xferStatus, `Sent ${j.imported || current.cookies.length} cookie(s) to your Veyra session. Reload the Veyra tab if it doesn't refresh itself.`, "ok");
  } catch (err) {
    setStatus(xferStatus, `Transfer failed: ${err.message}`, "err");
  } finally {
    sending = false;
    sendBtn.disabled = !current.cookies.length;
  }
}

async function refresh() {
  setStatus(xferStatus, "");
  const tab = await activeTab();
  const url = tab?.url || "";
  if (!isHttpUrl(url)) {
    current = { url: "", cookies: [] };
    sendBtn.disabled = true;
    siteLine.textContent = "Open the site you want to send, then click the extension.";
    return;
  }
  current = { url, cookies: await captureCookies(url) };
  const host = new URL(url).hostname;
  if (!current.cookies.length) {
    sendBtn.disabled = true;
    siteLine.textContent = `${host} has no cookies in this browser — sign in there first.`;
    return;
  }
  sendBtn.disabled = false;
  siteLine.textContent = `${host} — ${current.cookies.length} cookie(s) ready to send.`;
}

async function loadSettings() {
  const { veyraApi } = await chrome.storage.local.get("veyraApi");
  apiInput.value = veyraApi || DEFAULT_API;
}

apiSave.addEventListener("click", () => {
  const value = (apiInput.value || "").trim();
  if (!isHttpUrl(value)) { setStatus(apiStatus, "Enter the API origin as https://…", "err"); return; }
  chrome.storage.local.set({ veyraApi: value.replace(/\/+$/, "") }, () => setStatus(apiStatus, "Saved.", "ok"));
});
apiInput.addEventListener("keydown", ev => { if (ev.key === "Enter") apiSave.click(); });
sendBtn.addEventListener("click", send);

loadSettings().then(refresh);
