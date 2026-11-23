import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { qrMatrix } from "../web/src/qr.js";
import { qrWebDestination } from "../web/src/qr-open.js";

const shared = "https://example.com/one?name=a%20b&count=2#part";

test("QR previews preserve the complete destination and indicate HTTP", () => {
  assert.deepEqual(qrWebDestination(shared), { url: shared, host: "example.com", secure: true });
  assert.deepEqual(qrWebDestination("http://example.com/path"), { url: "http://example.com/path", host: "example.com", secure: false });
  assert.equal(qrWebDestination("https://bücher.example/#part")?.host, "xn--bcher-kva.example");
});

test("QR-only input rules do not send unsupported data to ordinary navigation", () => {
  for (const invalid of [
    "", "WIFI:T:WPA;S:name;P:secret;;", "mailto:x@example.com", "//example.com", "file:///etc/hosts",
    "javascript:void(0)", "veyra://settings", "https:///example.com", "https://?example.com",
    "https://example.com\\foo", "https://example.com/\tfoo", "https://example.com/\u202efoo",
    "https://good.example@elsewhere.example/", "https://@example.com", "https://user:pw@example.com/",
    "http://localhost/", "http://127.0.0.1/", "http://0x7f000001/", "http://[::1]/",
    "http://router.local/", "https://site.internal./", "https://example.com:8181/", "https://example.com/" + "x".repeat(4096)
  ]) assert.equal(qrWebDestination(invalid), null, invalid);
});

function runWorker() {
  const replies = [];
  const script = new URL("../web/src/qr-scan-worker.js", import.meta.url);
  const sandbox = { Uint8ClampedArray, postMessage: value => replies.push(value) };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  sandbox.importScripts = path => vm.runInContext(readFileSync(new URL(path, script), "utf8"), context);
  vm.runInContext(readFileSync(script, "utf8"), context);
  return frame => {
    sandbox.onmessage({ data: frame });
    return JSON.parse(JSON.stringify(replies.shift()));
  };
}

function bitmap(text, invert = false) {
  const modules = qrMatrix(text);
  const side = (modules.length + 8) * 6;
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const dark = !!modules[Math.floor(y / 6) - 4]?.[Math.floor(x / 6) - 4];
      const start = 4 * (y * side + x);
      data.fill(dark !== invert ? 0 : 255, start, start + 3);
      data[start + 3] = 255;
    }
  }
  return { data, width: side, height: side };
}

test("the vendored worker reads actual QR pixels, rejects oversize frames and reports a blank image", () => {
  const decode = runWorker();
  assert.deepEqual(decode(bitmap(shared)), { decoded: shared });
  assert.deepEqual(decode(bitmap(shared, true)), { decoded: shared });
  assert.deepEqual(decode(bitmap("WIFI:T:WPA;S:name;P:secret;;")), { decoded: "WIFI:T:WPA;S:name;P:secret;;" });
  assert.deepEqual(decode({ data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 }), { decoded: "" });
  assert.deepEqual(decode({ data: new Uint8ClampedArray(4), width: 1281, height: 1281 }), { error: true });
});
