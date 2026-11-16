"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Verifies the popup relay wiring: OAuth/sign-in popups open as proxied
// Veyra tabs, and the app relays opener semantics (postMessage, close,
// closed, navigation) between the opener frame and the popup frame.
(async () => {
  const root = path.join(__dirname, "..");
  const app = fs.readFileSync(path.join(root, "web", "src", "app.js"), "utf8");

  // The popup-open handler opens a proxied tab and records the relationship.
  assert.match(app, /function openProxiedPopup\(sourceTab, d\)/, "openProxiedPopup must be defined");
  assert.match(app, /popup\.popupOf = sourceTab\.id/, "the popup tab must remember its opener");
  assert.match(app, /popup\.popupId = String\(d\.popupId \|\| ""\)/, "the popup tab must remember the runtime's handle id");
  assert.match(app, /d\.type === "veyra:popup-open" && d\.url/, "the app must handle veyra:popup-open");

  // Both relay directions.
  assert.match(app, /d\.type === "veyra:popup-message" && d\.popupId/, "the app must handle veyra:popup-message (opener → popup)");
  assert.match(app, /from: "opener"/, "messages into the popup must be tagged from: opener");
  assert.match(app, /d\.type === "veyra:popup-to-opener"/, "the app must handle veyra:popup-to-opener (popup → opener)");
  assert.match(app, /from: "popup"/, "messages into the opener must be tagged from: popup");

  // Closing: both the popup's own window.close() and the opener's
  // handle.close() close the tab, and the opener's runtime is told so its
  // handle flips to .closed = true.
  assert.match(app, /d\.type === "veyra:popup-self-close"/, "the app must handle veyra:popup-self-close");
  assert.match(app, /function notifyPopupClosed\(openerTab, popupId\)/, "the opener must be notified when its popup closes");
  assert.match(app, /type: "veyra:popup-closed", popupId/, "the close notification must carry the popup id");
  assert.match(app, /teardownPopupLinks\(t\)/, "closeTab must notify the opener when a popup tab closes");

  // The opener can navigate its popup handle (w.location = url).
  assert.match(app, /d\.type === "veyra:popup-navigate" && d\.url/, "the app must handle veyra:popup-navigate");

  // The relay delivers into the frames via postMessage with the API origin.
  assert.match(app, /function relayIntoFrame\(tab, payload\)/, "relayIntoFrame must be defined");
  assert.match(app, /f\.contentWindow\.postMessage\(payload, API_ORIGIN\)/, "the relay must postMessage into the frame");

  // Popup tabs' frame URLs carry the veyra_popup=1 marker so the runtime
  // installs the window.opener shim synchronously before site scripts run.
  assert.match(app, /tab\?\.popupOf && \/\^https\?:\/i\.test\(src\)/, "setFrameSrc must mark popup frame URLs");
  assert.match(app, /u\.searchParams\.set\("veyra_popup", "1"\)/, "the marker must be veyra_popup=1");

  // The embed-ping handshake re-asserts the popup role after every load
  // (covers the OAuth redirect landing on the site's callback URL).
  assert.match(app, /function ackEmbedPing\(e\)/, "ackEmbedPing must be defined");
  assert.match(app, /relayIntoFrame\(t, \{ type: "veyra:popup-role" \}\)/, "popup tabs must receive veyra:popup-role on embed-ping");

  console.log("VeyraBrowser popup relay wiring checks passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
