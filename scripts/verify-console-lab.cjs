const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "web/console-lab/index.html"), "utf8");
const runner = fs.readFileSync(path.join(root, "web/console-lab/runner.js"), "utf8");

assert.match(html, /id="runFull"/);
assert.match(html, /20 sequential resource requests/);
assert.match(html, /without page-side fetch\/CORS ambiguity/);
assert.match(html, /No crawler\/session creation, login, writes, retries, background loop/);
assert.match(runner, /const MAX_REQUESTS_PER_RUN = 20;/);
assert.match(runner, /const MAX_SERVER_RUNS = 3;/);
assert.match(runner, /const REQUEST_GAP_MS = 180;/);
assert.match(runner, /if \(!proxied\)/);
assert.match(runner, /for \(const test of tests\)/);
assert.match(runner, /if \(tests.length !== MAX_REQUESTS_PER_RUN\)/);
assert.match(runner, /window\.dispatchEvent\(new ErrorEvent\("error", \{ message: "Script error\."/);
assert.match(runner, /Promise\.reject\(new TypeError/);
assert.match(runner, /console\.table\(/);
assert.match(runner, /httpbin\.org\/status/);
assert.match(runner, /\.veyra-lab\.invalid/);
assert.match(runner, /tag: "script"/);
assert.match(runner, /tag: "link"/);
assert.doesNotMatch(runner, /\bfetch\s*\(/);
assert.doesNotMatch(runner, /Promise\.all\s*\(/);
assert.doesNotMatch(runner, /setInterval\s*\(/);

console.log("Console Lab checks passed: opt-in serial resource probes, 20-request cap, and diagnostic cases are present.");
