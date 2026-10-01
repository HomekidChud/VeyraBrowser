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

import { $, esc, hostOf, uid, api, addLog, toast, hooks, settings, saveSettings, VERSION, API } from "./core.js";
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

// ---------------------------------------------------------------- QR code
// Real QR codes come from ./qr.js — a self-contained encoder (byte mode, ECC L,
// versions 1-9). The old "QR" here was a decorative hash pattern that phones
// could not scan ("no usable data found"), and the old image fallback
// depended on a third-party QR service. Both are gone.

// ---------------------------------------------------------------- Cast connection (WebSocket with HTTP polling fallback)
let castPollTimer = null;
let castSessionId = null;

function connectCastServer(sessionId) {
  castSessionId = sessionId;
  // Try WebSocket first
  const wsUrl = API.replace(/^http/, "ws") + `/ws/cast?role=browser&session=${encodeURIComponent(sessionId)}`;
  try {
    castWs = new WebSocket(wsUrl);
  } catch (e) {
    // WebSocket not available — fall back to HTTP polling
    startPollingFallback(sessionId);
    return;
  }

  castWs.onopen = () => {
    addLog("info", "CAST", "Connected to cast server");
  };

  castWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (e) {
      // Could be binary frame data
      addLog("debug", "CAST", `Frame received (${event.data?.length || 0} bytes)`);
    }
  };

  castWs.onerror = (e) => {
    addLog("warn", "CAST", "WebSocket error — falling back to HTTP polling");
    // Don't show error toast — silently fall back to polling
    if (castWs) { try { castWs.close(); } catch {} castWs = null; }
    startPollingFallback(sessionId);
  };

  castWs.onclose = (event) => {
    addLog("info", "CAST", `WebSocket closed (code ${event.code})`);
    if (event.code !== 1000 && event.code !== 1001) {
      // Abnormal close — try polling fallback
      startPollingFallback(sessionId);
    } else {
      if (castSession?.status === "streaming") stopStreaming();
      castSession = null;
      if (B?.renderActive) B.renderActive({ push: false });
    }
  };
}

// HTTP polling fallback — works without WebSocket support on the server
function startPollingFallback(sessionId) {
  if (castPollTimer) clearInterval(castPollTimer);
  addLog("info", "CAST", "Using HTTP polling for cast connection");
  // Create session via HTTP if not already created
  api("/api/cast/create", { method: "POST", json: {}, timeoutMs: 10000 }).then(result => {
    if (result.ok) {
      castSession = {
        id: result.sessionId,
        pairingCode: result.pairingCode,
        qrPayload: result.qrPayload,
        qrUrl: result.qrUrl,
        status: "waiting",
        deviceName: "",
        deviceType: "",
        connectionType: "",
        networkStrength: 0,
        frameCount: 0,
      };
      renderCastView();
      // Poll for messages every 500ms
      castPollTimer = setInterval(async () => {
        try {
          const msgs = await api(`/api/cast/poll/${castSession.id}`, { timeoutMs: 5000 });
          if (msgs.ok && msgs.messages) {
            for (const msg of msgs.messages) handleMessage(msg);
          }
        } catch {}
      }, 500);
    }
  }).catch(e => {
    toast("Cast polling failed: " + e.message, { kind: "err" });
  });
}

function stopPollingFallback() {
  if (castPollTimer) { clearInterval(castPollTimer); castPollTimer = null; }
}

function handleMessage(msg) {
  switch (msg.type) {
    case "session_created":
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
        frameBuffer.push(msg.data);
        if (frameBuffer.length > 3) frameBuffer.shift();
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
      stopStreaming();
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
      // Latency check
      if (castSession) {
        castSession.latency = Date.now() - (msg.timestamp || Date.now());
      }
      break;
  }
}

// ---------------------------------------------------------------- frame rendering
function renderFrame() {
  if (!castCanvas) return;
  const ctx = castCtx;
  const frame = frameBuffer[frameBuffer.length - 1];
  if (!frame) return;

  // If frame is a data URL, draw it as an image
  if (typeof frame === "string" && frame.startsWith("data:")) {
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, castCanvas.width, castCanvas.height);
      ctx.drawImage(img, 0, 0, castCanvas.width, castCanvas.height);
    };
    img.src = frame;
  } else if (typeof frame === "string") {
    // Raw frame data — display as text placeholder
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

// ---------------------------------------------------------------- streaming control
function startStreaming() {
  if (!castWs || castWs.readyState !== WebSocket.OPEN) return toast("Not connected to cast server", { kind: "err" });
  if (!castSession || castSession.status !== "paired") return toast("No device paired", { kind: "err" });
  castWs.send(JSON.stringify({ type: "start_streaming" }));
  castSession.status = "streaming";
  startRenderLoop();
  renderCastView();
}

function stopStreaming() {
  if (castWs?.readyState === WebSocket.OPEN) castWs.send(JSON.stringify({ type: "stop_streaming" }));
  if (castSession) castSession.status = "paired";
  stopRenderLoop();
  renderCastView();
}

function setQuality(q, fps) {
  if (castWs?.readyState !== WebSocket.OPEN) return;
  castWs.send(JSON.stringify({ type: "set_quality", quality: q, fps }));
  if (castSession) { castSession.quality = q; castSession.fps = fps; }
  toast(`Quality set to ${q} (${fps} FPS)`, { ms: 2000 });
}

function setInputEnabled(enabled) {
  if (castWs?.readyState === WebSocket.OPEN) castWs.send(JSON.stringify({ type: "set_input", enabled }));
  if (castSession) castSession.inputEnabled = enabled;
}

// ---------------------------------------------------------------- touch/input relay
function sendTouchInput(x, y, type = "tap") {
  if (castWs?.readyState !== WebSocket.OPEN) return;
  if (!castSession?.inputEnabled) return;
  castWs.send(JSON.stringify({ type: "input", input: { x, y, type, timestamp: Date.now() } }));
}

// ---------------------------------------------------------------- render
function renderCastView() {
  const view = $("view-cast");
  if (!view) return;
  // Device join mode: the phone scanned the QR code, which now points at
  // /cast?session=<id>&code=<code>. Render the phone-side join + screen share
  // view instead of the desktop "generate QR" flow.
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
    // Auto-start mirroring when a device pairs — no need to click a button
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
        <div class="cast-input-section">
          <h4>Input</h4>
          <label class="switch-row"><span>Touch input relay</span><input type="checkbox" class="switch" id="castInputToggle" ${s.inputEnabled !== false ? "checked" : ""}></label>
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

// ---------------------------------------------------------------- device join (phone side, opened from the QR code)
let deviceWs = null;
let deviceStream = null;
let deviceCanvas = null;
let deviceTimer = null;
let deviceJoined = false;

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
  deviceSessionId = sessionId; // Store for HTTP frame delivery fallback
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  const wsUrl = API.replace(/^http/, "ws") + `/ws/cast?role=device&session=${encodeURIComponent(sessionId)}&code=${encodeURIComponent(code)}&deviceId=${encodeURIComponent(uid())}&name=${encodeURIComponent((isMobile ? "Phone" : "Device"))}&type=phone&connection=${navigator.connection?.effectiveType?.includes("2") || navigator.connection?.effectiveType?.includes("3") || navigator.connection?.effectiveType?.includes("4") ? "cellular" : "wifi"}`;
  try { deviceWs = new WebSocket(wsUrl); } catch (e) {
    // WebSocket not available — try HTTP polling fallback for mobile
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
      else if (msg.type === "set_quality") { if (deviceTimer) { stopDeviceStream(); startDeviceStream(msg.fps || 15); } }
    } catch {}
  };
  deviceWs.onclose = ev => {
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
    // Mobile device without screen capture support — offer camera options
    shareButtons = `<div style="display:grid;gap:10px;justify-items:center">
      <p class="muted small" style="max-width:320px;text-align:center">Screen capture is not available on mobile browsers. You can mirror your camera instead.</p>
      <button class="btn primary lg" id="djShareBack">Share back camera</button>
      <button class="btn ghost lg" id="djShareFront">Share front camera</button>
    </div>`;
  } else {
    shareButtons = `<button class="btn primary lg" id="djShare">Share this screen</button>
    <p class="muted small">Screen sharing uses your browser's built-in screen capture. The Veyra browser will automatically start receiving frames.</p>`;
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

// HTTP polling fallback for device connections (mobile/Android)
let devicePollTimer = null;
function startDevicePolling(sessionId, code, body) {
  if (devicePollTimer) clearInterval(devicePollTimer);
  deviceSessionId = sessionId; // Store for HTTP frame delivery
  // Register device via HTTP
  api("/api/cast/device/join", { method: "POST", json: { sessionId, code, deviceId: uid(), name: /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent) ? "Phone" : "Device", type: "phone" }, timeoutMs: 10000 }).then(result => {
    if (!result.ok) { body.innerHTML = `<p class="muted">Could not join: ${esc(result.error || "unknown error")}</p>`; return; }
    devicePollId = result.deviceId; // Store device ID for polling
    deviceJoined = true;
    const t = $("djTitle"), s = $("djSub");
    if (t) t.textContent = "Paired with Veyra";
    if (s) s.textContent = "Your screen can now be mirrored into the Veyra browser.";
    renderDevicePaired(body);
    addLog("info", "CAST", "Device joined cast session via HTTP polling");
    // Poll for commands from the browser
    devicePollTimer = setInterval(async () => {
      try {
        const msgs = await api(`/api/cast/device/poll/${encodeURIComponent(result.deviceId)}`, { timeoutMs: 5000 });
        if (msgs.ok && msgs.messages) {
          for (const msg of msgs.messages) {
            if (msg.type === "start_streaming") startDeviceStream(msg.fps || 15);
            else if (msg.type === "stop_streaming") stopDeviceStream();
            else if (msg.type === "set_quality") { if (deviceTimer) { stopDeviceStream(); startDeviceStream(msg.fps || 15); } }
          }
        }
      } catch {}
    }, 500);
  }).catch(e => {
    body.innerHTML = `<p class="muted">Connection failed: ${esc(e.message)}</p>`;
  });
}

function stopDevicePolling() {
  if (devicePollTimer) { clearInterval(devicePollTimer); devicePollTimer = null; }
}

// Store session info for HTTP polling frame delivery
let deviceSessionId = null;
let devicePollId = null;

async function startDeviceStream(fps = 15, manual = false, facingMode = null) {
  if (deviceStream) { if (manual) { const st = $("djStatus"); if (st) st.textContent = "Already sharing."; } return; }
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  const hasDisplayMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  
  // If facingMode is specified (camera chosen explicitly), go straight to getUserMedia
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
    // Desktop: try getDisplayMedia first
    try {
      deviceStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: fps }, audio: false });
    } catch (e) {
      // getDisplayMedia failed — try getUserMedia as fallback
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          deviceStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", frameRate: fps, width: { ideal: 720 }, height: { ideal: 1280 } },
            audio: false
          });
        } catch (e2) {
          const st = $("djStatus");
          if (st) st.textContent = `Screen capture unavailable. getDisplayMedia: ${e.message}. getUserMedia: ${e2.message}`;
          addLog("warn", "CAST", `Screen capture failed: ${e2.message}`);
          return;
        }
      } else {
        const st = $("djStatus");
        if (st) st.textContent = `Screen capture unavailable: ${e.message}`;
        addLog("warn", "CAST", `Screen capture failed: ${e.message}`);
        return;
      }
    }
  } else {
    // Mobile without getDisplayMedia — default to back camera
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
  const ctx = deviceCanvas?.getContext("2d");
  const video = document.createElement("video");
  video.muted = true; video.srcObject = deviceStream; video.play().catch(() => {});
  const st = $("djStatus"); if (st) st.textContent = "Sharing your screen…";
  deviceStream.getVideoTracks()[0]?.addEventListener("ended", () => stopDeviceStream());
  const interval = Math.max(66, Math.round(1000 / Math.max(1, fps)));
  deviceTimer = setInterval(() => {
    if (!ctx || video.videoWidth === 0) return;
    const w = 360, h = Math.round(video.videoHeight * (w / video.videoWidth)) || 640;
    deviceCanvas.width = w; deviceCanvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const frameData = deviceCanvas.toDataURL("image/jpeg", 0.6);
    // Send via WebSocket if available, otherwise via HTTP polling
    if (deviceWs && deviceWs.readyState === 1) {
      try { deviceWs.send(JSON.stringify({ type: "frame", data: frameData })); } catch {}
    } else if (deviceSessionId) {
      // HTTP polling fallback — push frame to session buffer
      try { api(`/api/cast/push/${encodeURIComponent(deviceSessionId)}`, { method: "POST", json: { type: "frame", data: frameData }, timeoutMs: 3000 }); } catch {}
    }
  }, interval);
}

function stopDeviceStream() {
  if (deviceTimer) { clearInterval(deviceTimer); deviceTimer = null; }
  if (deviceStream) { try { deviceStream.getTracks().forEach(t => t.stop()); } catch {} deviceStream = null; }
  if (devicePollTimer) { clearInterval(devicePollTimer); devicePollTimer = null; }
  const st = $("djStatus"); if (st) st.textContent = "";
  if (deviceCanvas) deviceCanvas.style.display = "none";
}

// ---------------------------------------------------------------- internet connection view
function renderInternetView() {
  const view = $("view-internet");
  if (!view) return;
  const profiles = [
    { id: "auto", name: "Automatic", desc: "Veyra selects the best available connection", icon: "i-bolt" },
    { id: "lan", name: "Local Area Network", desc: "Connect via LAN/Ethernet. Fastest, most stable.", icon: "i-layers" },
    { id: "wifi", name: "Wi-Fi", desc: "Connect via Wi-Fi network. Requires SSID + password.", icon: "i-vpn" },
    { id: "cellular", name: "Cellular / Mobile", desc: "Connect via mobile data (4G/5G). Requires APN settings.", icon: "i-globe" },
    { id: "custom", name: "Custom Connection", desc: "Manually configure proxy, DNS, and routing.", icon: "i-settings" },
    { id: "bridge", name: "Bridge Mode", desc: "Share the phone's internet connection with Veyra.", icon: "i-link" },
    { id: "mesh", name: "Mesh Network", desc: "Connect through multiple nodes for redundancy.", icon: "i-grid" },
  ];
  const current = settings.internetProfile || "auto";
  view.innerHTML = `<div class="cast-page">
    <div class="cast-header"><h2>Internet Connection</h2><span class="muted small">Current: ${esc(profiles.find(p => p.id === current)?.name || "Automatic")}</span></div>
    <div class="internet-profiles">
      ${profiles.map(p => `<div class="internet-card ${p.id === current ? "active" : ""}" data-net="${p.id}">
        <span class="net-icon"><svg><use href="#${p.icon}"/></svg></span>
        <div><h3>${esc(p.name)}</h3><p class="muted small">${esc(p.desc)}</p></div>
        <span class="net-status ${p.id === current ? "on" : ""}">${p.id === current ? "Active" : ""}</span>
      </div>`).join("")}
    </div>
    <div class="internet-config" id="internetConfig"></div>
    <div class="internet-test">
      <button class="btn primary sm" id="netTestBtn">Test connection</button>
      <span id="netTestResult" class="muted small"></span>
    </div>
  </div>`;
  view.querySelectorAll("[data-net]").forEach(el => {
    el.onclick = () => {
      settings.internetProfile = el.dataset.net;
      saveSettings();
      renderInternetView();
      showInternetConfig(el.dataset.net);
    };
  });
  $("netTestBtn").onclick = async () => {
    $("netTestResult").textContent = "Testing…";
    try {
      const r = await api("/api/internet/test", { json: { profile: settings.internetProfile }, timeoutMs: 10000 });
      $("netTestResult").textContent = `Latency: ${r.latency}ms · Bandwidth: ${r.bandwidth} Mbps · ${r.ok ? "Connected" : "Failed"}`;
    } catch (e) {
      $("netTestResult").textContent = "Test failed: " + e.message;
    }
  };
  showInternetConfig(current);
}

function showInternetConfig(profileId) {
  const el = $("internetConfig");
  if (!el) return;
  if (profileId === "wifi") {
    el.innerHTML = `<div class="s-card"><div class="s-row"><div class="s-label"><b>SSID</b><span>Wi-Fi network name</span></div><input class="input" id="wifiSsid" placeholder="Network name" value="${esc(settings.wifiSsid || "")}"></div>
      <div class="s-row"><div class="s-label"><b>Password</b><span>WPA2/WPA3 key</span></div><input class="input" type="password" id="wifiPass" placeholder="Password" value="${esc(settings.wifiPass || "")}"></div>
      <div class="s-row"><div class="s-label"><b>Frequency</b><span>2.4 or 5 GHz</span></div><select class="input" id="wifiFreq"><option value="auto">Auto</option><option value="2.4">2.4 GHz</option><option value="5">5 GHz</option></select></div></div>`;
    el.querySelector("#wifiSsid").oninput = e => { settings.wifiSsid = e.target.value; saveSettings(); };
    el.querySelector("#wifiPass").oninput = e => { settings.wifiPass = e.target.value; saveSettings(); };
    el.querySelector("#wifiFreq").onchange = e => { settings.wifiFreq = e.target.value; saveSettings(); };
  } else if (profileId === "cellular") {
    el.innerHTML = `<div class="s-card"><div class="s-row"><div class="s-label"><b>APN</b><span>Access Point Name</span></div><input class="input" id="cellApn" placeholder="internet.com" value="${esc(settings.cellApn || "")}"></div>
      <div class="s-row"><div class="s-label"><b>Carrier</b><span>Mobile carrier</span></div><input class="input" id="cellCarrier" placeholder="Vodafone" value="${esc(settings.cellCarrier || "")}"></div>
      <div class="s-row"><div class="s-label"><b>Network type</b><span>3G/4G/5G</span></div><select class="input" id="cellType"><option value="4g">4G LTE</option><option value="5g">5G</option><option value="3g">3G</option></select></div></div>`;
    el.querySelector("#cellApn").oninput = e => { settings.cellApn = e.target.value; saveSettings(); };
    el.querySelector("#cellCarrier").oninput = e => { settings.cellCarrier = e.target.value; saveSettings(); };
    el.querySelector("#cellType").onchange = e => { settings.cellType = e.target.value; saveSettings(); };
  } else if (profileId === "custom") {
    el.innerHTML = `<div class="s-card"><div class="s-row"><div class="s-label"><b>Proxy</b><span>HTTP/SOCKS5 proxy URL</span></div><input class="input" id="customProxy" placeholder="socks5://host:port" value="${esc(settings.customProxy || "")}"></div>
      <div class="s-row"><div class="s-label"><b>DNS servers</b><span>Comma-separated</span></div><input class="input" id="customDns" placeholder="1.1.1.1, 8.8.8.8" value="${esc(settings.customDns || "")}"></div>
      <div class="s-row"><div class="s-label"><b>Gateway</b><span>Custom gateway IP</span></div><input class="input" id="customGateway" placeholder="192.168.1.1" value="${esc(settings.customGateway || "")}"></div></div>`;
    el.querySelector("#customProxy").oninput = e => { settings.customProxy = e.target.value; saveSettings(); };
    el.querySelector("#customDns").oninput = e => { settings.customDns = e.target.value; saveSettings(); };
    el.querySelector("#customGateway").oninput = e => { settings.customGateway = e.target.value; saveSettings(); };
  } else if (profileId === "bridge") {
    el.innerHTML = `<div class="s-card"><div class="s-row"><div class="s-label"><b>Bridge interface</b><span>Network interface to bridge</span></div><input class="input" id="bridgeIf" placeholder="eth0" value="${esc(settings.bridgeInterface || "")}"></div>
      <div class="s-row"><div class="s-label"><b>Share from</b><span>Device to share internet from</span></div><select class="input" id="bridgeFrom"><option value="phone">Phone (USB tethering)</option><option value="wifi">Wi-Fi adapter</option><option value="ethernet">Ethernet</option></select></div></div>`;
    el.querySelector("#bridgeIf").oninput = e => { settings.bridgeInterface = e.target.value; saveSettings(); };
    el.querySelector("#bridgeFrom").onchange = e => { settings.bridgeFrom = e.target.value; saveSettings(); };
  } else {
    el.innerHTML = "";
  }
}

// ---------------------------------------------------------------- event wiring
function wireCastWaiting() {
  const start = $("castStartBtn");
  if (start) start.onclick = () => { startPollingFallback(uid()); };
  const cancel = $("castCancelBtn");
  if (cancel) cancel.onclick = () => { if (castWs) castWs.close(); castSession = null; renderCastView(); };
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
  if (disconnect) disconnect.onclick = () => { if (castWs) castWs.close(); castSession = null; renderCastView(); };
  document.querySelectorAll("[data-q]").forEach(b => b.onclick = () => setQuality(b.dataset.q, parseInt(b.dataset.fps)));
  const inputToggle = $("castInputToggle");
  if (inputToggle) inputToggle.onchange = e => setInputEnabled(e.target.checked);
  // Touch input relay
  if (castCanvas) {
    castCanvas.ontouchstart = e => { const r = castCanvas.getBoundingClientRect(); const t = e.touches[0]; sendTouchInput((t.clientX - r.left) / r.width, (t.clientY - r.top) / r.height, "tap"); };
    castCanvas.onclick = e => { const r = castCanvas.getBoundingClientRect(); sendTouchInput((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, "tap"); };
  }
}

// ---------------------------------------------------------------- init
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
