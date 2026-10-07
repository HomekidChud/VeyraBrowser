"use strict";
/**
 * Veyra Device Cast — frontend module for phone-to-browser mirroring.
 *
 * Features:
 *   - QR code generation with veyra://casteddevice:/<id>?code=<pairingCode> URL scheme
 *   - WebSocket connection to the Veyra cast server
 *   - Real-time screen mirroring display
 *   - Touch/input relay (send clicks/swipes back to phone)
 *   - Quality controls (low/medium/high/auto)
 *   - Connection type display (WiFi/LAN/Cellular/Custom)
 *   - Internet connection profile selector
 *   - Network quality indicator
 */

import { $, esc, hostOf, uid, api, addLog, toast, hooks, settings, saveSettings, VERSION, API } from "./core.js?v=8.28.8";
import { qrSvg } from "./qr.js";

let B;
let castWs = null;
let castSession = null;
let castCanvas = null;
let castCtx = null;
let frameBuffer = [];
let renderLoop = null;
let inputLoop = false;
let lastFrameTime = 0;
let fpsCounter = { count: 0, lastReset: 0, fps: 0 };








let castPollTimer = null;
let castSessionId = null;
let castConnectionGeneration = 0;
let castFallbackStarted = false;
let castPollInFlight = false;

function stopPollingFallback() {
  if (castPollTimer) { clearInterval(castPollTimer); castPollTimer = null; }
}

function startPollingFallback(sessionId = "", generation = castConnectionGeneration) {
  if (castFallbackStarted || castPollTimer) return;
  castFallbackStarted = true;
  if (castWs) { try { castWs.close(); } catch {} castWs = null; }
  addLog("info", "CAST", "Using HTTP polling for cast connection");
  const createOrReuse = sessionId && castSession?.id === sessionId
    ? Promise.resolve({ ok: true, sessionId: castSession.id, pairingCode: castSession.pairingCode, qrPayload: castSession.qrPayload, qrUrl: castSession.qrUrl, existing: true })
    : api("/api/cast/create", { method: "POST", json: {}, timeoutMs: 10000 });
  createOrReuse.then(result => {
    if (generation !== castConnectionGeneration) return;
    if (!result.ok) throw new Error(result.error || "Cast server rejected the session");
    castSessionId = result.sessionId;
    if (!castSession || castSession.id !== result.sessionId) castSession = {
      id: result.sessionId, pairingCode: result.pairingCode, qrPayload: result.qrPayload, qrUrl: result.qrUrl,
      status: "waiting", deviceName: "", deviceType: "", connectionType: "", networkStrength: 0, frameCount: 0,
    };
    renderCastView();
    castPollTimer = setInterval(async () => {
      if (castPollInFlight || generation !== castConnectionGeneration || !castSession?.id) return;
      castPollInFlight = true;
      try {
        const msgs = await api(`/api/cast/poll/${encodeURIComponent(castSession.id)}`, { timeoutMs: 5000 });
        if (generation === castConnectionGeneration && msgs.ok && msgs.messages) for (const msg of msgs.messages) handleMessage(msg);
      } catch {} finally { castPollInFlight = false; }
    }, 500);
  }).catch(e => {
    if (generation !== castConnectionGeneration) return;
    castFallbackStarted = false;
    toast("Cast polling failed: " + e.message, { kind: "err" });
  });
}

function connectCastServer(sessionId = "") {
  const generation = ++castConnectionGeneration;
  castSessionId = sessionId;
  castFallbackStarted = false;
  stopPollingFallback();
  if (castWs) { try { castWs.close(); } catch {} castWs = null; }
  const wsUrl = API.replace(/^http/, "ws") + `/ws/cast?role=browser&session=${encodeURIComponent(sessionId)}`;
  try {
    castWs = new WebSocket(wsUrl);
  } catch (e) {
    startPollingFallback(sessionId, generation);
    return;
  }

  castWs.onopen = () => {
    if (generation !== castConnectionGeneration) return;
    addLog("info", "CAST", "Connected to cast server");
  };

  castWs.onmessage = (event) => {
    if (generation !== castConnectionGeneration) return;
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (e) {
      
      addLog("debug", "CAST", `Frame received (${event.data?.length || 0} bytes)`);
    }
  };

  castWs.onerror = (e) => {
    if (generation !== castConnectionGeneration) return;
    addLog("warn", "CAST", "WebSocket error — falling back to HTTP polling");
    startPollingFallback(sessionId, generation);
  };

  castWs.onclose = (event) => {
    if (generation !== castConnectionGeneration) return;
    addLog("info", "CAST", `WebSocket closed (code ${event.code})`);
    if (event.code !== 1000 && event.code !== 1001) {
      startPollingFallback(sessionId, generation);
    } else {
      if (castSession?.status === "streaming") stopStreaming();
      castWs = null;
      stopPollingFallback();
      if (B?.renderActive) B.renderActive({ push: false });
    }
  };
}

function handleMessage(msg) {
  if (msg.type !== "session_created" && msg.sessionId && msg.sessionId !== castSession?.id) return;
  switch (msg.type) {
    case "session_created":
      castSessionId = msg.sessionId;
      castFallbackStarted = false;
      castSession = {
        id: msg.sessionId,
        pairingCode: msg.pairingCode,
        qrPayload: msg.qrPayload,
        qrUrl: msg.qrUrl,
        status: "waiting",
        deviceName: "",
        deviceType: "",
        connectionType: "",
        networkStrength: 0,
        frameCount: 0,
      };
      renderCastView();
      break;

    case "device_paired":
      if (castSession) {
        castSession.status = "paired";
        castSession.deviceId = msg.deviceId;
        castSession.deviceName = msg.deviceName;
        castSession.deviceType = msg.deviceType;
        castSession.connectionType = msg.connectionType;
        castSession.networkStrength = msg.networkStrength;
      }
      toast(`Device paired: ${msg.deviceName}`, { ms: 4000 });
      renderCastView();
      break;

    case "frame":
      if (castSession) {
        castSession.frameCount++;
        castSession.lastFrame = Date.now();
        
        
        frameBuffer = [msg.data];
        fpsCounter.count++;
        const now = Date.now();
        if (now - fpsCounter.lastReset > 1000) {
          fpsCounter.fps = fpsCounter.count;
          fpsCounter.count = 0;
          fpsCounter.lastReset = now;
        }
        renderFrame();
      }
      break;

    case "device_disconnected":
      if (castSession) {
        castSession.status = "disconnected";
        toast("Device disconnected: " + (msg.reason || "unknown"), { kind: "warn" });
      }
      stopStreaming({ preserveStatus: true });
      renderCastView();
      break;

    case "network_update":
      if (castSession) {
        castSession.connectionType = msg.connectionType;
        castSession.networkStrength = msg.networkStrength;
        renderCastStatus();
      }
      break;

    case "device_info":
      if (castSession) {
        castSession.deviceName = msg.name || castSession.deviceName;
        castSession.battery = msg.battery;
        castSession.screenSize = msg.screen;
        renderCastStatus();
      }
      break;

    case "pong":
      
      if (castSession) {
        castSession.latency = Date.now() - (msg.timestamp || Date.now());
      }
      break;
  }
}

function disconnectCastSession(reason = "client_closed") {
  const id = castSession?.id || castSessionId;
  ++castConnectionGeneration;
  stopPollingFallback();
  const ws = castWs;
  castWs = null;
  try { ws?.close(1000, reason); } catch {}
  if (id) void api(`/api/cast/close/${encodeURIComponent(id)}`, { method: "POST", json: { reason }, timeoutMs: 5000 }).catch(() => {});
  castSession = null;
  castSessionId = null;
  castFallbackStarted = false;
  frameBuffer = [];
  stopRenderLoop();
  castCanvas = null;
  castCtx = null;
}
function cleanupCastResources() {
  stopDeviceStream(); stopDevicePolling();
  if (castSession || castSessionId || castWs) disconnectCastSession("view_left");
}


function renderFrame() {
  if (!castCanvas) return;
  const ctx = castCtx;
  const frame = frameBuffer[frameBuffer.length - 1];
  if (!frame) return;

  
  if (typeof frame === "string" && frame.startsWith("data:")) {
    const img = new Image();
    img.onload = () => {
      if (frameBuffer[frameBuffer.length - 1] !== frame) return;
      if (castCanvas.width !== img.naturalWidth || castCanvas.height !== img.naturalHeight) {
        castCanvas.width = img.naturalWidth; castCanvas.height = img.naturalHeight;
      }
      ctx.clearRect(0, 0, castCanvas.width, castCanvas.height);
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
    };
    img.src = frame;
  } else if (typeof frame === "string") {
    
    ctx.clearRect(0, 0, castCanvas.width, castCanvas.height);
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, castCanvas.width, castCanvas.height);
    ctx.fillStyle = "#8fb0f0";
    ctx.font = "14px monospace";
    ctx.fillText("Streaming from " + (castSession?.deviceName || "device"), 20, 30);
    ctx.fillText(`Frame ${castSession?.frameCount || 0} · ${fpsCounter.fps} FPS`, 20, 50);
    ctx.fillText(`Connection: ${castSession?.connectionType || "unknown"} (${castSession?.networkStrength || 0}%)`, 20, 70);
  }
}

function sendCastMessage(msg) {
  if (castWs?.readyState === 1) {
    try { castWs.send(JSON.stringify(msg)); return true; } catch {}
  }
  if (!castSession?.id) return false;
  void api(`/api/cast/send/${encodeURIComponent(castSession.id)}`, { method: "POST", json: msg, timeoutMs: 5000 })
    .catch(e => addLog("warn", "CAST", `Command delivery failed: ${e.message}`));
  return true;
}

function startRenderLoop() {
  if (renderLoop) cancelAnimationFrame(renderLoop);
  renderLoop = requestAnimationFrame(function loop() {
    renderFrame();
    renderLoop = requestAnimationFrame(loop);
  });
}

function stopRenderLoop() {
  if (renderLoop) cancelAnimationFrame(renderLoop);
  renderLoop = null;
}


function startStreaming() {
  if (!castSession || castSession.status !== "paired") return toast("No device paired", { kind: "err" });
  if (!sendCastMessage({ type: "start_streaming" })) return toast("Not connected to cast server", { kind: "err" });
  castSession.status = "streaming";
  startRenderLoop();
  renderCastView();
}

function stopStreaming({ preserveStatus = false } = {}) {
  if (castSession) sendCastMessage({ type: "stop_streaming" });
  if (castSession && !preserveStatus) castSession.status = "paired";
  stopRenderLoop();
  renderCastView();
}

function setQuality(q, fps) {
  if (!sendCastMessage({ type: "set_quality", quality: q, fps })) return;
  if (castSession) { castSession.quality = q; castSession.fps = fps; }
  toast(`Quality set to ${q} (${fps} FPS)`, { ms: 2000 });
}


function renderCastView() {
  const view = $("view-cast");
  if (!view) return;
  
  
  
  const joinParams = new URLSearchParams(location.search);
  const joinSession = joinParams.get("session"), joinCode = joinParams.get("code");
  if (joinSession && joinCode) { renderDeviceJoinView(view, joinSession, joinCode); return; }
  if (!castSession) {
    view.innerHTML = castWaitingView();
    wireCastWaiting();
  } else if (castSession.status === "waiting") {
    view.innerHTML = castWaitingView();
    wireCastWaiting();
  } else if (castSession.status === "paired" || castSession.status === "streaming") {
    view.innerHTML = castStreamingView();
    wireCastStreaming();
    
    if (castSession.status === "paired" && !castSession._autoStarted) {
      castSession._autoStarted = true;
      setTimeout(() => { if (castSession?.status === "paired") startStreaming(); }, 800);
    }
  } else if (castSession.status === "disconnected") {
    view.innerHTML = castDisconnectedView();
  }
}

function castWaitingView() {
  if (!castSession) {
    return `<div class="cast-page"><div class="cast-center"><div class="cast-icon"><svg width="64" height="64"><use href="#i-globe"/></svg></div><h2>Cast a Device</h2><p class="muted">Scan the QR code with your phone to mirror its screen in Veyra.</p><button class="btn primary lg" id="castStartBtn">Generate QR Code</button></div></div>`;
  }
  let inlineQr;
  try {
    inlineQr = qrSvg(castSession.qrPayload, 300);
  } catch (e) {
    addLog("warn", "CAST", `QR generation failed: ${e.message}`);
    inlineQr = `<div style="padding:40px;color:#aeb9c6">QR unavailable — use the deep link below.</div>`;
  }
  return `<div class="cast-page">
    <div class="cast-header"><h2>Waiting for device…</h2><button class="btn ghost sm" id="castCancelBtn">Cancel</button></div>
    <div class="cast-qr-section">
      <div class="cast-qr-wrapper">
        <div id="inlineQr">${inlineQr}</div>
      </div>
      <div class="cast-pairing-info">
        <h3>Pair your device</h3>
        <ol class="cast-steps">
          <li>Open your phone's camera or QR scanner</li>
          <li>Point it at the QR code</li>
          <li>Tap the notification to open Veyra Cast</li>
          <li>Enter the pairing code if prompted</li>
        </ol>
        <div class="cast-code-display">
          <span class="muted small">Pairing code</span>
          <div class="cast-code" id="castPairingCode">${esc(castSession.pairingCode)}</div>
          <button class="btn ghost sm" id="castCopyCode">Copy code</button>
        </div>
        <div class="cast-url-display">
          <span class="muted small">Deep link</span>
          <code class="mono small">${esc(castSession.qrPayload)}</code>
        </div>
      </div>
    </div>
  </div>`;
}

function castStreamingView() {
  const s = castSession;
  const streaming = s.status === "streaming";
  const connIcon = { wifi: "i-vpn", lan: "i-layers", cellular: "i-globe", custom: "i-settings", bridge: "i-link", mesh: "i-grid" }[s.connectionType] || "i-globe";
  const connName = { wifi: "Wi-Fi", lan: "LAN", cellular: "Cellular", custom: "Custom", bridge: "Bridge", mesh: "Mesh", unknown: "Unknown" }[s.connectionType] || s.connectionType;
  return `<div class="cast-page">
    <div class="cast-header">
      <div><h2>${esc(s.deviceName || "Device")}</h2><p class="muted small">${esc(s.deviceType || "phone")} · ${esc(connName)} · ${s.networkStrength || 0}% signal</p></div>
      <div class="cast-controls">
        ${streaming ? `<button class="btn ghost sm" id="castStopBtn">Stop</button>` : `<button class="btn primary sm" id="castStartStreamBtn">Start mirroring</button>`}
        <button class="btn ghost sm" id="castDisconnectBtn">Disconnect</button>
      </div>
    </div>
    <div class="cast-mirror-section">
      <div class="cast-mirror-frame ${streaming ? "streaming" : ""}">
        <canvas id="castCanvas" width="360" height="640"></canvas>
        ${!streaming ? `<div class="cast-mirror-overlay"><p>Click "Start mirroring" to receive the screen</p></div>` : ""}
      </div>
      <div class="cast-side-panel">
        <div class="cast-stat-card"><b>${s.frameCount || 0}</b><span>Frames received</span></div>
        <div class="cast-stat-card"><b>${fpsCounter.fps || 0}</b><span>FPS</span></div>
        <div class="cast-stat-card"><b>${s.networkStrength || 0}%</b><span>Signal strength</span></div>
        <div class="cast-stat-card"><b>${esc(connName)}</b><span>Connection type</span></div>
        <div class="cast-quality-section">
          <h4>Quality</h4>
          <div class="cast-quality-btns">
            <button class="dt-chip ${s.quality === "low" ? "on" : ""}" data-q="low" data-fps="15">Low (15 FPS)</button>
            <button class="dt-chip ${s.quality === "medium" || s.quality === "auto" ? "on" : ""}" data-q="medium" data-fps="30">Medium (30 FPS)</button>
            <button class="dt-chip ${s.quality === "high" ? "on" : ""}" data-q="high" data-fps="60">High (60 FPS)</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function castDisconnectedView() {
  return `<div class="cast-page"><div class="cast-center">
    <div class="cast-icon"><svg width="64" height="64"><use href="#i-ban"/></svg></div>
    <h2>Device Disconnected</h2>
    <p class="muted">${esc(castSession?.deviceName || "The device")} disconnected from the session.</p>
    <button class="btn primary lg" id="castReconnectBtn">Reconnect</button>
  </div></div>`;
}


let deviceWs = null;
let deviceStream = null;
let deviceCanvas = null;
let deviceTimer = null;
let deviceJoined = false;
let deviceVideo = null;
let deviceFrameFps = 15;
let deviceUploadInFlight = false;
let devicePendingFrame = null;

function renderDeviceJoinView(view, sessionId, code) {
  view.innerHTML = `<div class="cast-page"><div class="cast-center">
    <div class="cast-icon"><svg width="64" height="64"><use href="#i-globe"/></svg></div>
    <h2 id="djTitle">${deviceJoined ? "Paired with Veyra" : "Joining cast session…"}</h2>
    <p class="muted" id="djSub">${deviceJoined ? "Your screen can now be mirrored into the Veyra browser." : "Connecting to the cast session from the QR code."}</p>
    <div id="djBody" style="margin-top:18px;display:grid;gap:10px;justify-items:center"></div>
    <button class="btn ghost sm" id="djLeave" style="margin-top:16px">Leave</button>
  </div></div>`;
  const body = view.querySelector("#djBody");
  if (deviceJoined) renderDevicePaired(body);
  else connectDevice(sessionId, code, body);
  view.querySelector("#djLeave").onclick = () => {
    try { deviceWs && deviceWs.close(); } catch {}
    stopDeviceStream();
    stopDevicePolling();
    deviceWs = null; deviceJoined = false;
    try { history.replaceState({}, "", (window.VEYRA_BASE || "./") + "cast"); } catch {}
    renderCastView();
  };
}

function connectDevice(sessionId, code, body) {
  deviceSessionId = sessionId; 
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  const wsUrl = API.replace(/^http/, "ws") + `/ws/cast?role=device&session=${encodeURIComponent(sessionId)}&code=${encodeURIComponent(code)}&deviceId=${encodeURIComponent(uid())}&name=${encodeURIComponent((isMobile ? "Phone" : "Device"))}&type=phone&connection=${navigator.connection?.effectiveType?.includes("2") || navigator.connection?.effectiveType?.includes("3") || navigator.connection?.effectiveType?.includes("4") ? "cellular" : "wifi"}`;
  try { deviceWs = new WebSocket(wsUrl); } catch (e) {
    
    deviceWs = null;
    body.innerHTML = `<p class="muted">WebSocket unavailable. Trying HTTP fallback…</p>`;
    startDevicePolling(sessionId, code, body);
    return;
  }
  deviceWs.onopen = () => {
    deviceJoined = true;
    const t = $("djTitle"), s = $("djSub");
    if (t) t.textContent = "Paired with Veyra";
    if (s) s.textContent = "Your screen can now be mirrored into the Veyra browser.";
    renderDevicePaired(body);
    addLog("info", "CAST", "Device joined cast session");
  };
  deviceWs.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "start_streaming") startDeviceStream(msg.fps || 15);
      else if (msg.type === "stop_streaming") stopDeviceStream();
      else if (msg.type === "set_quality") { if (deviceTimer) setDeviceFrameRate(msg.fps || 15); }
    } catch {}
  };
  deviceWs.onerror = () => {
    if (deviceJoined || devicePollTimer) return;
    try { deviceWs?.close(); } catch {}
    deviceWs = null;
    if (body) body.innerHTML = `<p class="muted">WebSocket unavailable. Trying HTTP fallback…</p>`;
    startDevicePolling(sessionId, code, body);
  };
  deviceWs.onclose = ev => {
    if (!deviceJoined && !devicePollTimer && ev.code !== 1000 && ev.code !== 1001) {
      deviceWs = null;
      if (body) body.innerHTML = `<p class="muted">WebSocket unavailable. Trying HTTP fallback…</p>`;
      startDevicePolling(sessionId, code, body);
      return;
    }
    deviceJoined = false; stopDeviceStream();
    const t = $("djTitle"), s = $("djSub");
    if (t) t.textContent = ev.code === 4003 ? "Wrong pairing code" : "Disconnected";
    if (s) s.textContent = ev.code === 4003 ? "This QR code has expired. Generate a new one in the Veyra browser." : "The cast session closed. You can close this page.";
    if (body) body.innerHTML = "";
  };
}

function renderDevicePaired(body) {
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  const hasDisplayMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  
  let shareButtons = '';
  if (isMobile && !hasDisplayMedia) {
    
    shareButtons = `<div style="display:grid;gap:10px;justify-items:center">
      <p class="muted small" style="max-width:320px;text-align:center">Screen capture is not available on mobile browsers. You can mirror your camera instead.</p>
      <button class="btn primary lg" id="djShareBack">Share back camera</button>
      <button class="btn ghost lg" id="djShareFront">Share front camera</button>
    </div>`;
  } else {
    shareButtons = `<button class="btn primary lg" id="djShare">Share this screen</button>
    <button class="btn ghost lg" id="djShareBack">Share camera instead</button>
    <p class="muted small">Screen sharing uses your browser's built-in screen capture. Camera sharing is available only when you choose it.</p>`;
  }
  body.innerHTML = shareButtons + `
    <div id="djStatus" class="muted small"></div>
    <canvas id="djCanvas" style="display:none;max-width:100%;border-radius:12px"></canvas>`;
  const shareBtn = body.querySelector("#djShare");
  if (shareBtn) shareBtn.onclick = () => startDeviceStream(15, true);
  const backBtn = body.querySelector("#djShareBack");
  if (backBtn) backBtn.onclick = () => startDeviceStream(15, true, "environment");
  const frontBtn = body.querySelector("#djShareFront");
  if (frontBtn) frontBtn.onclick = () => startDeviceStream(15, true, "user");
}


let devicePollTimer = null;
let devicePollInFlight = false;
function startDevicePolling(sessionId, code, body) {
  if (devicePollTimer) clearInterval(devicePollTimer);
  deviceSessionId = sessionId; 
  
  api("/api/cast/device/join", { method: "POST", json: { sessionId, code, deviceId: uid(), name: /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent) ? "Phone" : "Device", type: "phone" }, timeoutMs: 10000 }).then(result => {
    if (!result.ok) { body.innerHTML = `<p class="muted">Could not join: ${esc(result.error || "unknown error")}</p>`; return; }
    devicePollId = result.deviceId; 
    deviceJoined = true;
    const t = $("djTitle"), s = $("djSub");
    if (t) t.textContent = "Paired with Veyra";
    if (s) s.textContent = "Your screen can now be mirrored into the Veyra browser.";
    renderDevicePaired(body);
    addLog("info", "CAST", "Device joined cast session via HTTP polling");
    
    devicePollTimer = setInterval(async () => {
      if (devicePollInFlight) return;
      devicePollInFlight = true;
      try {
        const msgs = await api(`/api/cast/device/poll/${encodeURIComponent(result.deviceId)}`, { timeoutMs: 5000 });
        if (msgs.ok && msgs.messages) {
          for (const msg of msgs.messages) {
            if (msg.type === "start_streaming") startDeviceStream(msg.fps || 15);
            else if (msg.type === "stop_streaming") stopDeviceStream();
            else if (msg.type === "set_quality") { if (deviceTimer) setDeviceFrameRate(msg.fps || 15); }
          }
        }
      } catch {} finally { devicePollInFlight = false; }
    }, 500);
  }).catch(e => {
    body.innerHTML = `<p class="muted">Connection failed: ${esc(e.message)}</p>`;
  });
}

function stopDevicePolling() {
  if (devicePollTimer) { clearInterval(devicePollTimer); devicePollTimer = null; }
}


let deviceSessionId = null;
let devicePollId = null;

async function startDeviceStream(fps = 15, manual = false, facingMode = null) {
  if (deviceStream) { if (manual) { const st = $("djStatus"); if (st) st.textContent = "Already sharing."; } return; }
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  const hasDisplayMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  
  
  if (facingMode) {
    try {
      deviceStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, frameRate: fps, width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: false
      });
    } catch (e) {
      const st = $("djStatus");
      if (st) st.textContent = `Camera unavailable: ${e.message}`;
      return;
    }
  } else if (hasDisplayMedia && !isMobile) {
    
    try {
      deviceStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: fps }, audio: false });
    } catch (e) {
      const st = $("djStatus");
      if (st) st.textContent = `Screen sharing was not started: ${e.message}. Choose “Share camera instead” if you want to use a camera.`;
      addLog("warn", "CAST", `Screen capture failed: ${e.message}`);
      return;
    }
  } else {
    
    try {
      deviceStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", frameRate: fps, width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: false
      });
    } catch (e) {
      const st = $("djStatus");
      if (st) st.textContent = `Camera unavailable: ${e.message}`;
      addLog("warn", "CAST", `Camera capture failed: ${e.message}`);
      return;
    }
  }
  deviceCanvas = $("djCanvas");
  if (deviceCanvas) { deviceCanvas.style.display = "block"; }
  const video = document.createElement("video");
  video.muted = true; video.srcObject = deviceStream; video.play().catch(() => {});
  deviceVideo = video;
  const st = $("djStatus"); if (st) st.textContent = "Sharing your screen…";
  deviceStream.getVideoTracks()[0]?.addEventListener("ended", () => stopDeviceStream());
  setDeviceFrameRate(fps);
}

function pushDeviceFrame(frameData) {
  if (!deviceSessionId) return;
  if (deviceUploadInFlight) { devicePendingFrame = frameData; return; }
  deviceUploadInFlight = true;
  void api(`/api/cast/push/${encodeURIComponent(deviceSessionId)}`, { method: "POST", json: { type: "frame", data: frameData }, timeoutMs: 3000 })
    .catch(() => {})
    .finally(() => { deviceUploadInFlight = false; const next = devicePendingFrame; devicePendingFrame = null; if (next) pushDeviceFrame(next); });
}
function captureDeviceFrame() {
  const ctx = deviceCanvas?.getContext("2d"), video = deviceVideo;
  if (!ctx || !video || video.videoWidth === 0) return;
  const w = deviceFrameFps >= 50 ? 960 : deviceFrameFps >= 30 ? 640 : 360;
  const h = Math.round(video.videoHeight * (w / video.videoWidth)) || 640;
  deviceCanvas.width = w; deviceCanvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);
  const frameData = deviceCanvas.toDataURL("image/jpeg", deviceFrameFps >= 50 ? 0.82 : deviceFrameFps >= 30 ? 0.72 : 0.6);
  if (deviceWs?.readyState === 1) { try { deviceWs.send(JSON.stringify({ type: "frame", data: frameData })); } catch {} }
  else pushDeviceFrame(frameData);
}
function setDeviceFrameRate(fps) {
  deviceFrameFps = Math.max(1, Math.min(60, Number(fps) || 15));
  if (deviceTimer) clearInterval(deviceTimer);
  deviceTimer = setInterval(captureDeviceFrame, Math.max(16, Math.round(1000 / deviceFrameFps)));
}

function stopDeviceStream() {
  if (deviceTimer) { clearInterval(deviceTimer); deviceTimer = null; }
  if (deviceStream) { try { deviceStream.getTracks().forEach(t => t.stop()); } catch {} deviceStream = null; }
  deviceVideo = null; devicePendingFrame = null;
  const st = $("djStatus"); if (st) st.textContent = "";
  if (deviceCanvas) deviceCanvas.style.display = "none";
}


function renderInternetView() {
  const view = $("view-internet");
  if (!view) return;
  const sessionId = B?.state?.session?.id || "ui";
  const profiles = [
    { id: "auto", name: "Automatic", desc: "Veyra selects the best available connection", icon: "i-bolt" },
    { id: "lan", name: "Local Area Network", desc: "Connect via LAN/Ethernet. Fastest, most stable.", icon: "i-layers" },
    { id: "wifi", name: "Wi-Fi", desc: "Shows Wi-Fi connection information when available from the system.", icon: "i-vpn" },
    { id: "cellular", name: "Cellular / Mobile", desc: "Shows cellular connection information when available from the system.", icon: "i-globe" },
    { id: "custom", name: "Custom Connection", desc: "Configuration requires an operating-system or managed-network integration.", icon: "i-settings" },
    { id: "bridge", name: "Bridge Mode", desc: "Share the phone's internet connection with Veyra.", icon: "i-link" },
    { id: "mesh", name: "Mesh Network", desc: "Connect through multiple nodes for redundancy.", icon: "i-grid" },
  ];
  const current = settings.internetProfile || "auto";
  view.innerHTML = `<div class="cast-page">
    <div class="cast-header"><h2>Internet Connection</h2><span class="muted small">Selected for preview: ${esc(profiles.find(p => p.id === current)?.name || "Automatic")}</span></div>
    <div class="internet-profiles">
      ${profiles.map(p => `<div class="internet-card ${p.id === current ? "active" : ""}" data-net="${p.id}">
        <span class="net-icon"><svg><use href="#${p.icon}"/></svg></span>
        <div><h3>${esc(p.name)}</h3><p class="muted small">${esc(p.desc)}</p></div>
        <span class="net-status ${p.id === current ? "on" : ""}">${p.id === current ? "Selected" : ""}</span>
      </div>`).join("")}
    </div>
    <div class="internet-config" id="internetConfig"></div>
    <div class="internet-test">
      <button class="btn primary sm" id="netTestBtn">Test server connection</button>
      <span id="netTestResult" class="muted small"></span>
    </div>
  </div>`;
  view.querySelectorAll("[data-net]").forEach(el => {
    el.onclick = async () => {
      const next = el.dataset.net;
      settings.internetProfile = next;
      saveSettings();
      if (["auto", "lan"].includes(next) || settings.customProxy) {
        try {
          await api("/api/internet/profile", { json: { sessionId, profile: next, config: settings.customProxy ? { proxy: settings.customProxy } : {} }, timeoutMs: 30000 });
          renderInternetView();
        } catch (e) { toast(`Could not connect this transport: ${e.message}`, { kind: "err" }); }
      } else renderInternetView();
      showInternetConfig(next);
    };
  });
  $("netTestBtn").onclick = async () => {
    $("netTestResult").textContent = "Testing…";
    try {
      const r = await api("/api/internet/test", { method: "POST", json: { sessionId }, timeoutMs: 10000 });
      $("netTestResult").textContent = `${r.ok ? "Profile available" : "No profile selected"}${r.latency != null ? ` · ${r.latency}ms` : ""}${r.note ? ` · ${r.note}` : ""}`;
    } catch (e) {
      $("netTestResult").textContent = "Test failed: " + e.message;
    }
  };
  showInternetConfig(current);
}

function showInternetConfig(profileId) {
  const el = $("internetConfig");
  if (!el) return;
  const needsTransport = !["auto", "lan"].includes(profileId);
  el.innerHTML = `<div class="s-card"><div class="s-row"><div class="s-label"><b>${needsTransport ? "Transport endpoint" : "Direct server connection"}</b><span>${needsTransport ? "Enter the proxy endpoint or bridge gateway that Veyra should use. Supported transports: HTTP, HTTPS, SOCKS5, or WireGuard." : "Veyra will use the server's normal network route for this session."}</span></div>${needsTransport ? `<div class="s-ctl"><input class="input" id="internetProxy" placeholder="socks5://user:password@host:1080" value="${esc(settings.customProxy || "")}"><button class="btn primary sm" id="internetApply">Apply transport</button></div>` : ""}</div></div>`;
  $("internetApply")?.addEventListener("click", async () => {
    const endpoint = $("internetProxy")?.value.trim();
    if (!endpoint) return toast("Enter a proxy endpoint first", { kind: "warn" });
    settings.customProxy = endpoint; saveSettings();
    const sid = B?.state?.session?.id || "ui";
    try {
      await api("/api/internet/profile", { json: { sessionId: sid, profile: profileId, config: { proxy: endpoint } }, timeoutMs: 30000 });
      toast("Internet transport connected; Veyra traffic now uses this route");
    } catch (e) { toast(`Transport connection failed: ${e.message}`, { kind: "err" }); }
  });
}


function wireCastWaiting() {
  const start = $("castStartBtn");
  if (start) start.onclick = () => { connectCastServer(""); };
  const cancel = $("castCancelBtn");
  if (cancel) cancel.onclick = () => { disconnectCastSession("cancelled"); renderCastView(); };
  const copy = $("castCopyCode");
  if (copy) copy.onclick = () => { navigator.clipboard?.writeText(castSession?.pairingCode || "").then(() => toast("Code copied")); };
}

function wireCastStreaming() {
  castCanvas = $("castCanvas");
  castCtx = castCanvas?.getContext("2d");
  const startStream = $("castStartStreamBtn");
  if (startStream) startStream.onclick = startStreaming;
  const stop = $("castStopBtn");
  if (stop) stop.onclick = stopStreaming;
  const disconnect = $("castDisconnectBtn");
  if (disconnect) disconnect.onclick = () => { disconnectCastSession(); renderCastView(); };
  document.querySelectorAll("[data-q]").forEach(b => b.onclick = () => setQuality(b.dataset.q, parseInt(b.dataset.fps)));
}


export function initCast(b) {
  B = b;
}

export const cast = {
  init: initCast,
  renderCastView,
  renderInternetView,
  connectCastServer,
  startStreaming,
  stopStreaming,
  setQuality,
  renderDeviceJoinView,
};

hooks.renderCast = renderCastView;
hooks.renderInternet = renderInternetView;
hooks.cleanupCast = cleanupCastResources;
window.addEventListener("pagehide", cleanupCastResources, { once: true });
