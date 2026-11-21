"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const root = path.join(__dirname, "..");
  const app = fs.readFileSync(path.join(root, "web", "src", "app.js"), "utf8");

  assert.match(app, /function openProxiedPopup\(sourceTab, d\)/, "openProxiedPopup must be defined");
  assert.match(app, /newTab\(\{ url: target, .*popupOf: sourceTab\.id, popupId \}\)/, "the popup tab must remember its opener and handle before navigation");
  assert.match(app, /"allow-scripts allow-same-origin allow-forms allow-downloads"/, "proxy frames cannot open native popups");
  assert.match(app, /d\.type === "veyra:popup-open" && d\.url/, "the app must handle veyra:popup-open");

  assert.match(app, /d\.type === "veyra:popup-message" && d\.popupId/, "the app must handle veyra:popup-message (opener → popup)");
  assert.match(app, /from: "opener"/, "messages into the popup must be tagged from: opener");
  assert.match(app, /d\.type === "veyra:popup-to-opener"/, "the app must handle veyra:popup-to-opener (popup → opener)");
  assert.match(app, /from: "popup"/, "messages into the opener must be tagged from: popup");

  assert.match(app, /d\.type === "veyra:popup-self-close"/, "the app must handle veyra:popup-self-close");
  assert.match(app, /function notifyPopupClosed\(openerTab, popupId\)/, "the opener must be notified when its popup closes");
  assert.match(app, /type: "veyra:popup-closed", popupId/, "the close notification must carry the popup id");
  assert.match(app, /teardownPopupLinks\(t\)/, "closeTab must notify the opener when a popup tab closes");

  assert.match(app, /d\.type === "veyra:popup-navigate" && d\.url/, "the app must handle veyra:popup-navigate");

  assert.match(app, /function relayIntoFrame\(tab, payload\)/, "relayIntoFrame must be defined");
  assert.match(app, /f\.contentWindow\.postMessage\(payload, API_ORIGIN\)/, "the relay must postMessage into the frame");

  assert.match(app, /tab\?\.popupOf && \/\^https\?:\/i\.test\(src\)/, "setFrameSrc must mark popup frame URLs");
  assert.match(app, /u\.searchParams\.set\("veyra_popup", "1"\)/, "the marker must be veyra_popup=1");

  assert.match(app, /function ackEmbedPing\(e\)/, "ackEmbedPing must be defined");
  assert.match(app, /relayIntoFrame\(t, \{ type: "veyra:popup-role" \}\)/, "popup tabs must receive veyra:popup-role on embed-ping");

  console.log("VeyraBrowser popup relay wiring checks passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
