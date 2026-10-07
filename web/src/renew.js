"use strict";
/** Session renewal ads: automatic, labeled, time-bounded sponsor gate. */
import { $, esc, api, proxyUrl, toast, addLog, fmtClock, hooks } from "./core.js?v=8.28.7";

let active = false;
let lastSessionId = "";
let gateStarted = false;
let adCursor = 0;

export function maybeOfferRenew(session, remainingMs) {
  if (!session || session.id !== lastSessionId) { lastSessionId = session?.id || ""; gateStarted = false; adCursor = 0; }
  
  if (active || gateStarted || !session || remainingMs > 60000) return;
  gateStarted = true;
  void loadAds().then(ads => {
    if (!ads.length) { gateStarted = false; return; }
    startWatch(ads[adCursor++ % ads.length].id);
  }).catch(() => { gateStarted = false; });
}

export async function openRenewFlow() {
  if (active) return;
  const ads = await loadAds();
  if (!ads.length) { toast("No eligible sponsor ads are available", { kind: "warn" }); return; }
  startWatch(ads[adCursor++ % ads.length].id);
}

async function loadAds() {
  try {
    const r = await api("/api/renew/ads", { timeoutMs: 8000 });
    const ads = (r && r.ads) || [];
    const st = await api(`/api/renew/status/${encodeURIComponent(hooks.currentSessionId?.() || "")}`, { timeoutMs: 8000 }).catch(() => null);
    return st?.canRenew === false ? [] : ads;
  } catch { return []; }
}

async function startWatch(adId) {
  const sid = hooks.currentSessionId?.() || "";
  if (!sid) { gateStarted = false; toast("No active session to renew", { kind: "warn" }); return; }
  active = true;
  try {
    const r = await api(`/api/renew/watch/${encodeURIComponent(adId)}`, { method: "POST", json: { sessionId: sid } });
    playAd(r.watchId, r.ad, r.rewardMs);
  } catch (e) { active = false; gateStarted = false; toast(e.message, { kind: "err" }); }
}

function playAd(watchId, ad, rewardMs) {
  const over = overlay();
  const durationSec = ad.durationSec || 15;
  const started = Date.now();
  over.innerHTML = `
    <div class="ad-gate-header"><span class="eyebrow">SPONSORED SESSION EXTENSION</span><b id="renewCount">${durationSec}s</b></div>
    <h2>${esc(ad.title)}</h2>
    <p class="muted">This sponsor message started automatically. It must play for ${durationSec} seconds to extend your session by ${fmtClock(rewardMs || 0)}.</p>
    <div id="renewMedia" class="ad-gate-media" aria-label="Sponsored advertisement"></div>
    <div class="ad-gate-footer"><span class="muted small" id="renewState">Playing · no action required</span><span class="pill">Ad ${adCursor} · rotating inventory</span></div>`;
  const media = $("renewMedia");
  const sid = hooks.currentSessionId?.() || "";
  const mediaUrl = ad.url ? proxyUrl(ad.url, "resource", sid) : "";
  const sponsorUrl = ad.url ? proxyUrl(ad.url, "view", sid) : "#";
  if (ad.type === "youtube" && ad.youtubeId) media.innerHTML = `<iframe width="100%" height="340" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(ad.youtubeId)}?autoplay=1&rel=0&modestbranding=1" title="Sponsored advertisement" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  else if (ad.type === "video" && ad.url) media.innerHTML = `<video src="${esc(mediaUrl)}" autoplay muted playsinline controls style="width:100%;max-height:380px"></video>`;
  else if (ad.type === "banner" && (ad.imageUrl || ad.url)) media.innerHTML = `<a href="${esc(sponsorUrl)}" target="_blank" rel="noopener"><img src="${esc(ad.imageUrl ? proxyUrl(ad.imageUrl, "resource", sid) : mediaUrl)}" alt="Sponsored advertisement" style="max-width:100%;max-height:380px;object-fit:contain"></a>`;
  else if (ad.url) {
    const interactive = ad.type === "interactive";
    media.innerHTML = `<div class="ad-gate-embed-label">${interactive ? "Interactive sponsor experience" : "Sponsor website"}</div><iframe src="${esc(sponsorUrl)}" title="${esc(ad.title || "Sponsored website")}" class="renew-site-frame" sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin allow-downloads" referrerpolicy="no-referrer" allow="fullscreen; autoplay"></iframe><p class="muted small renew-site-fallback">If the site is unavailable inside the frame, <a href="${esc(sponsorUrl)}" target="_blank" rel="noopener">view it in a separate tab</a>.</p>`;
  }
  else media.innerHTML = `<div class="ad-gate-copy">${esc(ad.description || "Sponsored content")}</div>`;
  media.querySelector("video")?.addEventListener("error", () => { media.innerHTML = `<div class="ad-gate-copy">This sponsor video could not be loaded. <a href="${esc(sponsorUrl)}" target="_blank" rel="noopener">Open sponsor website</a></div>`; });
  media.querySelector("a")?.addEventListener("click", () => api(`/api/renew/click/${encodeURIComponent(ad.id)}`, { method: "POST" }).catch(() => {}), { once: true });
  const tick = setInterval(() => {
    const left = durationSec - Math.floor((Date.now() - started) / 1000), c = $("renewCount");
    if (!c) { clearInterval(tick); return; }
    c.textContent = `${Math.max(0, left)}s`;
    if (left <= 0) { clearInterval(tick); finish(watchId); }
  }, 250);
}

async function finish(watchId) {
  const sid = hooks.currentSessionId?.() || "", state = $("renewState");
  if (state) state.textContent = "Verifying completed view…";
  try {
    const r = await api(`/api/renew/complete/${encodeURIComponent(watchId)}`, { method: "POST", json: { sessionId: sid } });
    active = false; gateStarted = false;
    if (r.session?.renewed !== false && r.session?.expiresAt) hooks.onSessionRenewed?.(r.session.expiresAt);
    closeOverlay();
    toast(`Session extended by +${fmtClock(r.rewardMs || 0)}${r.totalRenewals ? ` · renewal ${r.totalRenewals}/${r.maxRenewals}` : ""}`, { ms: 5000 });
  } catch (e) { if (state) state.textContent = e.message; toast(e.message, { kind: "err" }); active = false; gateStarted = false; setTimeout(closeOverlay, 2500); }
}

function overlay() {
  closeOverlay();
  const el = document.createElement("div"); el.id = "renewOverlay"; el.className = "overlay"; el.style.zIndex = 9500;
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
  el.innerHTML = `<div class="overlay-card ad-gate-card"></div>`;
  
  document.body.appendChild(el); return el.querySelector(".overlay-card");
}
function closeOverlay() { $("renewOverlay")?.remove(); }
hooks.openRenewFlow = openRenewFlow;
addLog("debug", "RENEW", "Automatic rotating ad gate loaded");
