"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const root = path.join(__dirname, "..");
  const app = fs.readFileSync(path.join(root, "web", "src", "app.js"), "utf8");
  const ui = fs.readFileSync(path.join(root, "web", "src", "ui.js"), "utf8");
  const settings = fs.readFileSync(path.join(root, "web", "src", "settings.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");

  assert.match(app, /chooseSignin\(t, target\)/, "veyra:signin must route through the sign-in loader");
  assert.match(app, /function chooseSignin\(t, url\)/, "the sign-in loader must be defined");
  assert.match(app, /function chooseSignin\(t, url\) \{\s*if \(interceptAccount\(url, t.url\)\) return;/, "direct account routing must happen before a proxy request");
  assert.match(app, /void loadInTab\(t, url, \{ loadFrame: true \}\)/, "sign-in must load the page in the tab through the fast proxy");

  assert.ok(!app.includes("handleSigninHandoff"), "the sign-in handoff handler must be removed");
  assert.ok(!app.includes("handoffPolls"), "the cookie-jar watcher must be removed");
  assert.ok(!app.includes("openHandoffWindow"), "the handoff popup opener must be removed");
  assert.ok(!app.includes("params.get(\"veyra_handoff\")"), "the veyra_handoff return trip must be removed");
  assert.ok(!/function handoffBookmarklet|export function handoffBookmarklet/.test(ui), "the bookmarklet generator must be removed");
  assert.ok(!ui.includes("/api/handoff/cookies"), "ui.js must never reference the cookie import endpoint");
  assert.ok(!ui.includes("popHandoff"), "the site-info handoff button must be removed");
  assert.ok(!settings.includes("signinMode"), "the old cookie-handoff mode setting must be gone");
  assert.ok(!html.includes("signinDialog"), "the old cookie-handoff dialog must be gone");
  assert.ok(!app.includes("/api/handoff/cookies"), "the app must never call the cookie import endpoint");
  assert.ok(!app.includes("/api/handoff/login"), "the app must never call the handoff login endpoint");

  assert.match(ui, /Google and GitHub account pages open directly for verification/, "the site-info popover must explain direct account routing");
  assert.match(ui, /Google sign-in options/, "the browser menu exposes the new account choices");

  console.log("VeyraBrowser in-proxy sign-in wiring checks passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
