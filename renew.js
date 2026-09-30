"use strict";
/**
 * Veyra Session Renewal — watch an ad, extend your session.
 *
 * When the session timer drops below 60 seconds, a non-intrusive offer card
 * appears: "Watch an ad to extend this session". The user picks an ad from
 * the server's active list (banner / video / YouTube / sponsor link), keeps
 * it open for the ad's duration, and the session deadline is extended on the
 * server by the ad's reward. The offer also opens from the session pill.
 */

import { $, esc, api, toast, addLog, fmtClock, hooks } from "./core.js";

let offerShown = false;
let active = false;
let lastSessionId = "";

/** Called from the session ticker: shows the offer once per session. */
export function maybeOfferRenew(session, remainingMs) {
  if (!session || session.id !== lastSessionId) { lastSessionId = session?.id || ""; offerShown = false; }
  if (offerShown || active || !session || remainingMs > 60000) return;
  offerShown = true;
  void loadAds().then(ads => {
    if (!ads.length) return;
    showOfferCard(ads);
  }).catch(() => {});
}

/** Force-show the renew flow (session pill click). */
export async function openRenewFlow() {
  if (active) return;
  const ads = await loadAds();
  if (!ads.length) { toast("No renewal ads are available on this server right now", { kind: "warn" }); return; }
  showAdPicker(ads);
}

async function loadAds() {
  try {
    const r = await api("/api/renew/ads", { timeoutMs: 8000 });
    const ads = (r && r.ads) || [];
    const st = await api(`/api/renew/status/${encodeURIComponent(hooks.currentSessionId?.() || "")}`, { timeoutMs: 8000 }).catch(() => null);
    if (st && st.canRenew === false) return [];
    return ads;
  } catch { return []; }
}

// ---------------------------------------------------------------- offer card
function showOfferCard(ads) {
  dismissOfferCard();
  const el = document.createElement("div");
  el.id = "renewOffer";
  el.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:9000;max-width:340px;background:#141a22;border:1px solid #2c3644;border-radius:14px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.45);font:14px/1.5 system-ui,sans-serif;color:#e8eef6";
  el.innerHTML = `<div style="display:flex;gap:10px;align-items:flex-start">
      <svg width="26" height="26" style="flex:none;fill:#8ab4f8"><use href="#i-timer"/></svg>
      <div style="flex:1"><b>Session running low</b><p style="margin:4px 0 10px;color:#aeb9c6">Watch a short ad to keep this session and everything in it.</p>
      <div style="display:flex;gap:8px"><button class="btn primary sm" id="renewYes">Watch an ad</button><button class="btn ghost sm" id="renewNo">Dismiss</button></div></div></div>`;
  document.body.appendChild(el);
  $("#renewYes").onclick = () => { dismissOfferCard(); showAdPicker(ads); };
  $("#renewNo").onclick = dismissOfferCard;
  setTimeout(() => dismissOfferCard(), 55000);
}
function dismissOfferCard() { const el = $("renewOffer"); if (el) el.remove(); }

// ---------------------------------------------------------------- ad picker
function showAdPicker(ads) {
  const over = overlay();
  over.innerHTML = `
    <h2 style="margin:0 0 6px">Extend this session</h2>
    <p class="muted" style="margin:0 0 16px">Pick an ad. Keep it open for its full duration and the session timer is extended — cookies, tabs and everything else stay alive.</p>
    ${ads.map(a => `<button class="btn ghost" data-ad="${esc(a.id)}" style="display:flex;width:100%;text-align:left;gap:12px;align-items:center;margin:6px 0;padding:12px">
      <svg width="22" height="22" style="flex:none;fill:#8ab4f8"><use href="#i-${a.type === "youtube" || a.type === "video" ? "play" : a.type === "banner" ? "globe" : "link"}"/></svg>
      <span style="flex:1"><b>${esc(a.title)}</b><br><span class="muted small">${esc(a.description || a.type)} · ${a.durationSec}s · +${fmtClock(a.rewardMs || 0)} session time</span></span>
    </button>`).join("")}
    <div style="margin-top:14px;text-align:right"><button class="btn ghost" id="renewCancel">Not now</button></div>`;
  over.querySelectorAll("[data-ad]").forEach(b => b.onclick = () => startWatch(b.dataset.ad));
  $("#renewCancel").onclick = closeOverlay;
}

// ---------------------------------------------------------------- ad player
async function startWatch(adId) {
  const sid = hooks.currentSessionId?.() || "";
  if (!sid) { toast("No active session to renew", { kind: "warn" }); return; }
  active = true;
  try {
    const r = await api(`/api/renew/watch/${encodeURIComponent(adId)}`, { method: "POST", json: { sessionId: sid } });
    playAd(r.watchId, r.ad, r.rewardMs);
  } catch (e) {
    active = false;
    toast(e.message, { kind: "err" });
  }
}

function playAd(watchId, ad, rewardMs) {
  const over = overlay();
  over.style.maxWidth = "760px";
  const durationSec = ad.durationSec || 15;
  const started = Date.now();
  over.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
      <h2 style="margin:0">${esc(ad.title)}</h2>
      <b id="renewCount" style="font:600 18px ui-monospace,monospace;color:#8ab4f8">${durationSec}s</b>
    </div>
    <p class="muted small" style="margin:0 0 12px">Keep this ad open for ${durationSec} seconds to earn +${fmtClock(rewardMs || 0)} of session time.</p>
    <div id="renewMedia" style="border-radius:12px;overflow:hidden;background:#0b0e13;min-height:220px;display:grid;place-items:center"></div>
    <div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center">
      <span class="muted small" id="renewState">Ad playing…</span>
      <button class="btn ghost" id="renewAbort">Cancel</button>
    </div>`;
  const media = $("renewMedia");
  if (ad.type === "youtube" && ad.youtubeId) {
    media.innerHTML = `<iframe width="100%" height="340" src="https://www.youtube-nocookie.com/embed/${esc(ad.youtubeId)}?autoplay=1&rel=0&modestbranding=1" title="Ad" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  } else if (ad.type === "video" && ad.url) {
    media.innerHTML = `<video src="${esc(ad.url)}" autoplay controls playsinline style="width:100%;max-height:380px"></video>`;
  } else if (ad.type === "banner" && (ad.imageUrl || ad.url)) {
    media.innerHTML = `<a href="${esc(ad.url || "#")}" target="_blank" rel="noopener"><img src="${esc(ad.imageUrl || ad.url)}" alt="Ad" style="max-width:100%;max-height:380px;object-fit:contain"></a>`;
  } else if (ad.url) {
    media.innerHTML = `<iframe src="${esc(ad.url)}" title="Ad" style="width:100%;height:340px;border:0" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>`;
  } else {
    media.innerHTML = `<div style="padding:60px 20px;color:#aeb9c6">${esc(ad.description || "Sponsored content")}</div>`;
  }
  const tick = setInterval(() => {
    const left = durationSec - Math.floor((Date.now() - started) / 1000);
    const c = $("renewCount");
    if (!c) { clearInterval(tick); return; }
    c.textContent = `${Math.max(0, left)}s`;
    if (left <= 0) { clearInterval(tick); finish(watchId); }
  }, 250);
  $("renewAbort").onclick = () => { clearInterval(tick); active = false; closeOverlay(); };
}

async function finish(watchId) {
  const sid = hooks.currentSessionId?.() || "";
  const state = $("renewState");
  if (state) state.textContent = "Completing…";
  try {
    const r = await api(`/api/renew/complete/${encodeURIComponent(watchId)}`, { method: "POST", json: { sessionId: sid } });
    active = false;
    const renewed = r.session?.renewed !== false;
    if (renewed && r.session?.expiresAt) hooks.onSessionRenewed?.(r.session.expiresAt);
    closeOverlay();
    toast(`Session extended by +${fmtClock(r.rewardMs || 0)}${r.totalRenewals ? ` · renewal ${r.totalRenewals}/${r.maxRenewals}` : ""}`, { ms: 5000 });
  } catch (e) {
    if (state) state.textContent = e.message;
    toast(e.message, { kind: "err" });
    setTimeout(closeOverlay, 2500);
    active = false;
  }
}

// ---------------------------------------------------------------- overlay helpers
function overlay() {
  closeOverlay();
  const el = document.createElement("div");
  el.id = "renewOverlay";
  el.className = "overlay";
  el.style.zIndex = 9500;
  el.innerHTML = `<div class="overlay-card" style="text-align:left;justify-items:stretch;max-width:640px"></div>`;
  el.onclick = e => { if (e.target === el) closeOverlay(); };
  document.body.appendChild(el);
  return el.querySelector(".overlay-card");
}
function closeOverlay() { const el = $("renewOverlay"); if (el) el.remove(); }

hooks.openRenewFlow = openRenewFlow;
addLog("debug", "RENEW", "Session renewal module loaded");
