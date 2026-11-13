/* Device cast: transport lifecycle, polling fallback, render loop, input relay. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../web/src/device-cast.js", import.meta.url), "utf8");
const body = (marker, endMarker = "function ") => {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `${marker} must exist`);
  return src.slice(i, src.indexOf(endMarker, i + marker.length) === -1 ? undefined : src.indexOf(endMarker, i + marker.length));
};
const bodyUntil = (marker, end) => {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `${marker} must exist`);
  const j = src.indexOf(end, i);
  return src.slice(i, j === -1 ? undefined : j);
};

// --- Bug 1: renderCastStatus was invoked by the network_update and device_info
// handlers but never defined. Any such message threw a silent ReferenceError and
// swallowed the rest of its polling batch. It must exist and update the live
// DOM elements without a full re-render.
assert.match(src, /function renderCastStatus\(\)/, "renderCastStatus must be defined (it was called but missing)");
assert.match(src, /case "network_update":[\s\S]*?renderCastStatus\(\)/, "network_update must refresh the status display");
assert.match(src, /case "device_info":[\s\S]*?renderCastStatus\(\)/, "device_info must refresh the status display");
assert.match(src, /id="castStatSignal"/, "signal stat card must carry an id for live updates");
assert.match(src, /id="castConnType"/, "connection-type stat card must carry an id for live updates");

// --- Bug 2: the disconnected view's Reconnect button had no handler. A device
// disconnect left the UI permanently stuck. renderCastView must wire it, and
// the handler must fully tear down the dead session before reconnecting.
assert.match(bodyUntil("} else if (castSession.status === \"disconnected\") {", "function castWaitingView"), /wireCastDisconnected\(\)/, "renderCastView must wire the disconnected view");
{
  const i = src.indexOf("function wireCastDisconnected()");
  assert.ok(i >= 0, "wireCastDisconnected must exist");
  const b = src.slice(i, i + 700);
  assert.match(b, /\$\("castReconnectBtn"\)/, "the reconnect handler must target the rendered button");
  assert.match(b, /disconnectCastSession\("reconnect"\)/, "reconnect must tear down the dead session first");
  assert.match(b, /connectCastServer\(""\)/, "reconnect must start a fresh WebSocket connection");
}

// --- Bug 3: the render loop re-decoded the latest frame into a new Image on
// every animation frame (~60x/s). renderFrame must skip unchanged frames, and
// re-wiring a fresh canvas must reset the guard so the next frame paints.
assert.match(src, /if \(!frame \|\| frame === lastDrawnFrame\) return;/, "renderFrame must skip frames that are already on the canvas");
assert.match(bodyUntil("function wireCastStreaming()", "function wireCastDisconnected"), /lastDrawnFrame = null;/, "re-wiring a fresh canvas must reset the drawn-frame guard");

// --- Bug 4: the polling loop called handleMessage directly; one malformed
// message dropped the rest of the batch. Each message must be handled
// independently.
assert.match(src, /for \(const msg of msgs\.messages\) \{\s*\n\s*try \{ handleMessage\(msg\); \} catch \{\}\s*\n\s*\}/, "each polled message must be handled in its own try/catch");

// --- Bug 5: the WS clean-close path called stopPollingFallback()
// unconditionally. If onerror had already started the HTTP fallback, that
// killed the only remaining transport and stranded the session. The clean-close
// teardown must be guarded by !castFallbackStarted.
assert.match(src, /\} else if \(!castFallbackStarted\) \{/, "the clean-close teardown must not run while the polling fallback owns the connection");

// --- Bug 6: when the fallback's create call failed, only a toast was shown —
// the stale waiting view stayed up with no transport. The failure path must
// reset the session state and re-render back to the start view.
{
  const i = src.indexOf("Cast polling failed");
  assert.ok(i >= 0, "the fallback failure path must still surface an error");
  const b = src.slice(Math.max(0, i - 600), i);
  assert.match(b, /castSession = null;/, "fallback create failure must clear the stale session");
  assert.match(b, /renderCastView\(\);/, "fallback create failure must re-render the view");
}

// --- Bug 7: disconnectCastSession must be idempotent and leak-free — every
// generation-scoped timer/counter must be reset on teardown.
{
  const b = bodyUntil("function disconnectCastSession", "function cleanupCastResources");
  assert.match(b, /\+\+castConnectionGeneration;/, "teardown must invalidate the connection generation");
  assert.match(b, /castPollInFlight = false;/, "teardown must reset the poll-in-flight flag");
  assert.match(b, /fpsCounter = \{ count: 0, lastReset: 0, fps: 0 \};/, "teardown must reset the fps counter");
  assert.match(b, /lastDrawnFrame = null;/, "teardown must reset the drawn-frame guard");
  assert.match(b, /stopRenderLoop\(\);/, "teardown must stop the render loop");
}

// --- Bug 8: input relay. The server supports {type:"input"} relay but the
// browser never sent any. Pointer events on the mirror canvas must produce
// normalized input messages via sendCastMessage.
{
  const b = bodyUntil("function wireCastInput()", "function wireCastStreaming");
  assert.match(b, /pointerup/, "the canvas must listen for pointerup to finish a tap/swipe");
  assert.match(b, /sendCastMessage\(\{ type: "input", input \}\)/, "canvas input must be relayed as {type:\"input\"}");
  assert.match(b, /action: Math\.hypot\(dx, dy\) > 24 \? "swipe" : "tap"/, "input must be classified as tap or swipe");
  assert.match(b, /x: clamp01\(/, "input coordinates must be normalized");
  assert.match(bodyUntil("function wireCastStreaming()", "function wireCastDisconnected"), /wireCastInput\(\)/, "the streaming view must wire canvas input");
}

// --- Bug 9: start_streaming over the HTTP /api/cast/send fallback is relayed
// verbatim by the server, so the message itself must carry quality/fps or the
// device defaults to 15 FPS.
assert.match(src, /sendCastMessage\(\{ type: "start_streaming", quality: castSession\.quality \|\| "auto", fps: castSession\.fps \|\| 30 \}\)/, "start_streaming must carry quality and fps for the verbatim HTTP fallback path");

// --- Bug 10: the device's HTTP join payload omitted the connection field, so
// the server always recorded "wifi" even for cellular devices (unlike the WS
// path). Both transports must report the same connection type.
assert.match(src, /json: \{ sessionId, code, deviceId: uid\(\), name:[^\n]*type: "phone", connection: deviceConnectionType\(\) \}/, "the HTTP device join payload must include the connection type");
assert.match(src, /function deviceConnectionType\(\)/, "a shared connection-type helper must exist");
assert.match(bodyUntil("function deviceConnectionType()", "function connectDevice"), /cellular" : "wifi"/, "the helper must map 2g/3g/4g to cellular");

// --- Bug 11: the device leave handler must reset all device-side session
// state so a later join cannot push frames to a stale session id.
assert.match(src, /deviceWs = null; deviceJoined = false; deviceSessionId = null; devicePollId = null;/, "leaving the device view must clear session ids and device ids");

// --- Stats: frames/FPS cards must be updated live by the render loop, not
// only when the whole view re-renders.
assert.match(src, /function updateCastStats\(\)/, "a live stat updater must exist");
assert.match(bodyUntil("function startRenderLoop()", "function stopRenderLoop"), /updateCastStats\(\);/, "the render loop must refresh the stat cards");
assert.match(src, /id="castStatFrames"/, "frames stat card must carry an id");
assert.match(src, /id="castStatFps"/, "fps stat card must carry an id");

console.log("device-cast.test.js — all assertions passed");
