const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "web/console-lab/index.html"), "utf8");
const runner = fs.readFileSync(path.join(root, "web/console-lab/runner.js"), "utf8");
const gate = fs.readFileSync(path.join(root, "web/console-lab/admin-gate.js"), "utf8");
const app = fs.readFileSync(path.join(root, "web/src/app.js"), "utf8");
const ui = fs.readFileSync(path.join(root, "web/src/ui.js"), "utf8");

assert.match(html, /id="accessGate"/);
assert.match(html, /id="lab" hidden/);
assert.match(html, /admin-gate\.js\?v=2/);
assert.doesNotMatch(html, /runner\.js/);
assert.match(gate, /api\/auth\/config/);
assert.match(gate, /veyra:console-lab:auth-check/);
assert.match(gate, /runner\.js\?v=4/);
assert.ok(gate.indexOf("if (!access.allowed)") < gate.indexOf("loadRunner();"), "the runner must only load after admin verification");
assert.match(runner, /document\.body\?\.dataset\.consoleLabAccess !== "granted"/);
assert.match(app, /isConsoleLabPageUrl\(t\.url\)/);
assert.match(app, /api\("\/api\/auth\/config"/);
assert.match(app, /veyra:console-lab:auth-result/);
assert.match(ui, /isAdmin\(\) \? \[[\s\S]*?menuItem\("i-terminal", "Console Lab"/);

for (const module of ["overview", "console", "agents", "activity", "analytics", "diagnostics"]) {
  assert.match(html, new RegExp(`data-view="${module}"`), `missing ${module} module`);
}
assert.match(html, /id="runFull"/);
assert.match(html, /20 sequential resource probes/);
assert.match(html, /50 pages and depth 5/);
assert.match(html, /aggregate-only[\s\S]*without browsing URLs or page content/);
assert.doesNotMatch(html, /incognito/i, "Console Lab must not include incognito mode");
assert.match(runner, /const MAX_REQUESTS_PER_RUN = 20;/);
assert.match(runner, /const MAX_SERVER_RUNS = 3;/);
assert.match(runner, /const REQUEST_GAP_MS = 180;/);
assert.match(runner, /if \(!proxied\)/);
assert.match(runner, /for \(const test of tests\)/);
assert.match(runner, /if \(tests\.length !== MAX_REQUESTS_PER_RUN\)/);
assert.match(runner, /window\.dispatchEvent\(new ErrorEvent\("error", \{ message: "Script error\."/);
assert.match(runner, /Promise\.reject\(new TypeError/);
assert.match(runner, /console\.table\(/);
assert.match(runner, /httpbin\.org\/status/);
assert.match(runner, /\.veyra-lab\.invalid/);
assert.match(runner, /tag: "script"/);
assert.match(runner, /tag: "link"/);
assert.match(runner, /api\("\/api\/sessions"\)/);
assert.match(runner, /api\("\/api\/neural\/stats"\)/);
assert.match(runner, /api\("\/api\/robots\/status"\)/);
assert.match(runner, /api\("\/api\/robots\/log\?limit=12"\)/);
assert.match(runner, /api\("\/api\/robots\/crawl"/);
assert.match(runner, /maxPages: Math\.max\(1, Math\.min\(50,/);
assert.match(runner, /maxDepth: Math\.max\(1, Math\.min\(5,/);
assert.match(runner, /document\.hidden/);
assert.match(runner, /arbitrary JavaScript execution is disabled/);
assert.match(runner, /setInterval\(\(\) => refreshData\(true\), POLL_MS\)/);
assert.doesNotMatch(runner, /\/api\/robots\/reset/);
assert.doesNotMatch(runner, /localStorage\.getItem\([^)]*(?:incognito|private)[^)]*\)/i);

console.log("Console Lab checks passed: admin-only launcher, advanced modules, live aggregate monitoring, neural telemetry, bounded custom agents, and 20-request diagnostics cap.");
