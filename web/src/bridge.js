

import { api, API_ORIGIN, uid } from "./core.js?v=8.28.29-fast-proxy";

const pending = new Map();
const listeners = new Set();

export function frameFor(tab) { return tab ? document.getElementById("frame-" + tab.id) : null; }
export function isRemote(tab) { return tab?.browserMode === "BROWSER_ENGINE" && !!tab.browserSessionId; }
export function bridgeTargetOrigin(frame) {
  if (!frame?.contentWindow || !frame.getAttribute("src") || frame.src === "about:blank") return null;
  // A newly created iframe is still about:blank even after assigning its src.
  // Sending to the future API origin at this point causes browser errors.
  try { if (frame.contentWindow.location.href === "about:blank") return null; } catch {}
  if (!frame.sandbox?.contains("allow-same-origin")) return "*";
  try { return new URL(frame.src).origin === API_ORIGIN ? API_ORIGIN : null; } catch { return null; }
}

export function dtCall(tab, method, params = {}, timeoutMs = 8000) {
  if (!tab) return Promise.reject(new Error("No tab."));
  if (isRemote(tab)) {
    return api(`/api/browser/session/${encodeURIComponent(tab.browserSessionId)}/devtools`, { json: { method, params }, timeoutMs: timeoutMs + 2000 }).then(r => r?.result);
  }
  const frame = frameFor(tab);
  if (!frame?.contentWindow || !tab.url) return Promise.reject(new Error("No page is loaded in this tab."));
  return new Promise((resolve, reject) => {
    const id = uid();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("The page did not answer. It may still be loading, or it blocks the Veyra runtime.")); }, timeoutMs);
    pending.set(id, { resolve, reject, timer, tabId: tab.id });
    
    
    const targetOrigin = bridgeTargetOrigin(frame);
    if (!targetOrigin) { clearTimeout(timer); pending.delete(id); reject(new Error("The page frame is still loading.")); return; }
    try { frame.contentWindow.postMessage({ type: "veyra:dt", id, method, params }, targetOrigin); }
    catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
  });
}


export function handleBridgeMessage(tab, d) {
  if (d.type === "veyra:dt-result") {
    const p = pending.get(d.id); if (!p) return true;
    if (!tab || p.tabId !== tab.id) return true;
    clearTimeout(p.timer); pending.delete(d.id);
    if (d.ok) p.resolve(d.result); else p.reject(new Error(d.error?.message || d.error || "DevTools call failed."));
    return true;
  }
  if (d.type === "veyra:dt-event") { for (const fn of listeners) { try { fn(tab, d.event, d.data); } catch {} } return true; }
  return false;
}
export function onBridgeEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function rejectTab(tabId) { for (const [id, p] of pending) if (p.tabId === tabId) { clearTimeout(p.timer); pending.delete(id); p.reject(new Error("The page navigated away.")); } }
