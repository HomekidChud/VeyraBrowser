"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Verifies the direct-login handoff return wiring: when the site's login page
// sends the user back to the app with ?veyra_handoff=<url>, the app picks the
// tab back up through the fast proxy and cleans the parameter from the URL.
(async () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "web", "src", "app.js"), "utf8");
  assert.match(app, /params\.get\("veyra_handoff"\)/, "boot must read the veyra_handoff parameter");
  assert.match(app, /params\.delete\("veyra_handoff"\)/, "the parameter must be removed from the URL after use");
  assert.match(app, /\/\^https\?:\$\/\.test\(u\.protocol\)/, "only http(s) handoff targets may be opened");
  assert.match(app, /void navigate\(u\.href, \{ tab: t, push: false \}\)/, "the handoff target must load through the app's normal navigation (fast proxy)");
  console.log("VeyraBrowser handoff return wiring checks passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
