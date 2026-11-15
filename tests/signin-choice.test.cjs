"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Verifies the sign-in choice wiring. A click on a site's sign-in control
// used to go straight to the browser handoff (open the real sign-in in the
// user's own browser). Sign-in is now a choice the user makes each time
// (or once, via settings.signinMode):
//   - "Sign in inside Veyra": the login page loads through the app's normal
//     in-tab navigation (fast proxy) and the user signs in inside Veyra;
//   - "Open real sign-in in my browser": the existing handoff.
(async () => {
  const root = path.join(__dirname, "..");
  const app = fs.readFileSync(path.join(root, "web", "src", "app.js"), "utf8");
  const core = fs.readFileSync(path.join(root, "web", "src", "core.js"), "utf8");
  const settings = fs.readFileSync(path.join(root, "web", "src", "settings.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");

  // The choice dialog exists in the shell.
  assert.match(html, /id="signinDialog"/, "the sign-in choice dialog must exist");
  assert.match(html, /id="signinInVeyra"/, "the in-Veyra option must exist");
  assert.match(html, /id="signinHandoff"/, "the browser-handoff option must exist");

  // veyra:signin routes through the chooser instead of the direct handoff.
  assert.match(app, /chooseSignin\(t, target\)/, "veyra:signin must go through the sign-in chooser");
  assert.match(app, /function chooseSignin\(t, url\)/, "the chooser must be defined");

  // The in-Veyra option loads the login page through the app's normal
  // in-tab navigation (fast proxy), not a new tab.
  assert.match(app, /void loadInTab\(t, url, \{ loadFrame: true \}\)/, "sign in inside Veyra must load the page in the tab");

  // The remembered modes skip the dialog.
  assert.match(app, /settings\.signinMode \|\| "ask"/, "the chooser must respect the saved mode");
  assert.match(app, /mode === "veyra"/, "the veyra mode must skip the dialog");
  assert.match(app, /mode === "handoff"/, "the handoff mode must skip the dialog");

  // The handoff path itself is unchanged and still available.
  assert.match(app, /function handleSigninHandoff\(t, url\)/, "the handoff handler must remain");

  // The default mode is "ask" and the setting is editable in Sessions.
  assert.match(core, /signinMode: "ask"/, "the default sign-in mode must be ask");
  assert.match(settings, /select\("signinMode"/, "Sessions settings must expose the sign-in method");
  assert.match(settings, /\["veyra", "Sign in inside Veyra"\]/, "the in-Veyra option must be listed");
  assert.match(settings, /\["handoff", "Open real sign-in in my browser"\]/, "the handoff option must be listed");

  // veyra:open targets: _top/_parent navigate the tab in place, never a new tab.
  assert.match(app, /d\.target \|\| "_blank"/, "the target must be read from the message");
  assert.match(app, /tgt === "_top" \|\| tgt === "_parent"/, "_top/_parent must be in-place navigation");
  assert.match(app, /void loadInTab\(t, u, \{ loadFrame: true \}\); return; \}/, "the in-place branch must return before newTab");

  console.log("VeyraBrowser sign-in choice + in-place navigation checks passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
