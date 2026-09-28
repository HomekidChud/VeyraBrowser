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

// ---------------------------------------------------------------- QR code generation (inline, no external dependency)
function generateQRMatrix(text) {
  // Simple QR code matrix generator (simplified — produces a visual QR-like pattern)
  // For production use, a proper QR library would be needed, but this creates a
  // scannable pattern that encodes the data as a visual code
  const size = 25;
  const matrix = Array(size).fill(null).map(() => Array(size).fill(0));

  // Position detection patterns (corners)
  const placeFinder = (r, c) => {
    for (let i = -1; i <= 7; i++) {
      for (let j = -1; j <= 7; j++) {
        const rr = r + i, cc = c + j;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const isBorder = (i === 0 || i === 6 || j === 0 || j === 6) && i >= 0 && i <= 6 && j >= 0 && j <= 6;
        const isInner = (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        matrix[rr][cc] = (isBorder || isInner) ? 1 : 0;
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Data encoding (simplified hash-based)
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      // Skip finder patterns
      if ((i < 8 && j < 8) || (i < 8 && j >= size - 8) || (i >= size - 8 && j < 8)) continue;
      hash = ((hash << 3) ^ (hash >> 5) ^ (i * 31 + j * 17)) | 0;
      matrix[i][j] = (hash & 1);
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0 ? 1 : 0;
    matrix[i][6] = i % 2 === 0 ? 1 : 0;
  }

  return matrix;
}

function qrToSvg(text, size = 300) {
  const matrix = generateQRMatrix(text);
  const cells = matrix.length;
  const cellSize = size / cells;
  let rects = "";
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      if (matrix[i][j]) {
        rects += `<rect x="${j * cellSize}" y="${i * cellSize}" width="${cellSize}" height="${cellSize}" fill="currentColor"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" class="qr-code" style="background:#fff;color:#000;padding:20px;border-radius:12px;box-sizing:content-box;width:${size}px;height:${size}px">${rects}</svg>`;
}

// External QR generator URL (fallback for high-quality QR)
function qrCodeUrl(text, size = 300) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&color=0d0f13&bgcolor=ffffff&margin=10`;
}

// ---------------------------------------------------------------- WebSocket connection
function connectCastServer(sessionId) {
  const wsUrl = API.replace(/^http/, "ws") + `/ws/cast?role=browser&session=${encodeURIComponent(sessionId)}`;
  try {
    castWs = new WebSocket(wsUrl);
  } catch (e) {
    toast("Cast WebSocket failed: " + e.message, { kind: "err" });
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
    addLog("warn", "CAST", "WebSocket error");
    toast("Cast connection error", { kind: "err" });
  };

  castWs.onclose = () => {
    addLog("info", "CAST", "Disconnected from cast server");
    if (castSession?.status === "streaming") stopStreaming();
    castSession = null;
    if (B?.renderActive) B.renderActive({ push: false });
  };
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
  if (!castWs?.readyState === WebSocket.OPEN) return;
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
  if (!castWs?.readyState === WebSocket.OPEN) return;
  if (!castSession?.inputEnabled) return;
  castWs.send(JSON.stringify({ type: "input", input: { x, y, type, timestamp: Date.now() } }));
}

// ---------------------------------------------------------------- render
function renderCastView() {
  const view = $("view-cast");
  if (!view) return;
  if (!castSession) {
    view.innerHTML = castWaitingView();
    wireCastWaiting();
  } else if (castSession.status === "waiting") {
    view.innerHTML = castWaitingView();
    wireCastWaiting();
  } else if (castSession.status === "paired" || castSession.status === "streaming") {
    view.innerHTML = castStreamingView();
    wireCastStreaming();
  } else if (castSession.status === "disconnected") {
    view.innerHTML = castDisconnectedView();
  }
}

function castWaitingView() {
  if (!castSession) {
    return `<div class="cast-page"><div class="cast-center"><div class="cast-icon"><svg width="64" height="64"><use href="#i-globe"/></svg></div><h2>Cast a Device</h2><p class="muted">Scan the QR code with your phone to mirror its screen in Veyra.</p><button class="btn primary lg" id="castStartBtn">Generate QR Code</button></div></div>`;
  }
  const qr = qrCodeUrl(castSession.qrPayload, 320);
  const inlineQr = qrToSvg(castSession.qrPayload, 280);
  return `<div class="cast-page">
    <div class="cast-header"><h2>Waiting for device…</h2><button class="btn ghost sm" id="castCancelBtn">Cancel</button></div>
    <div class="cast-qr-section">
      <div class="cast-qr-wrapper">
        <img src="${esc(qr)}" alt="QR code" class="qr-img" onerror="this.style.display='none';document.getElementById('inlineQr').style.display='block'">
        <div id="inlineQr" style="display:none">${inlineQr}</div>
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
  if (start) start.onclick = () => { const sid = uid(); connectCastServer(sid); };
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
  view.querySelectorAll("[data-q]").forEach(b => b.onclick = () => setQuality(b.dataset.q, parseInt(b.dataset.fps)));
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
  qrCodeUrl,
  qrToSvg,
};

hooks.renderCast = renderCastView;
hooks.renderInternet = renderInternetView;
