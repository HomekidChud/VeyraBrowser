import { test } from "node:test";
import assert from "node:assert/strict";
import { frameReader, latestFramePump, measureVeyraConnection, streamPreset } from "../web/src/remote-frames.js";

test("frames survive split headers, chunks, multiple frames and heartbeats", () => {
  const frames = [];
  const push = frameReader(a => frames.push([...a]));
  const wire = Uint8Array.of(0, 0, 0, 3, 8, 9, 10, 0, 0, 0, 0, 0, 0, 0, 1, 11);
  for (const [a, b] of [[0, 1], [1, 6], [6, 8], [8, 16]]) push(wire.subarray(a, b));
  assert.deepEqual(frames, [[8, 9, 10], [11]]);
  assert.throws(() => push(Uint8Array.of(255, 255, 255, 255)), RangeError);
  assert.equal(streamPreset("__proto__"), "adaptive");
});

test("a burst keeps only the latest queued picture, and stop releases pending work", async () => {
  const decoded = [], drawn = [], released = [], paints = new Map();
  const pause = () => new Promise(resolve => setImmediate(resolve));
  let id = 0;
  const pump = latestFramePump({
    decode: n => new Promise(resolve => decoded.push([n, () => resolve({ n, close: () => released.push(n) })])),
    draw: bitmap => drawn.push(bitmap.n),
    requestPaint: fn => { paints.set(++id, fn); return id; },
    cancelPaint: key => paints.delete(key)
  });
  for (const n of [1, 2, 3, 4]) pump.push(n);
  assert.deepEqual(decoded.map(([n]) => n), [1]);
  decoded[0][1](); await pause();
  assert.deepEqual(decoded.map(([n]) => n), [1, 4]);
  decoded[1][1](); await pause();
  paints.get(1)();
  assert.deepEqual(drawn, [4]);
  pump.push(5); pump.stop();
  decoded[2][1](); await pause();
  assert.deepEqual(released, [1, 4, 5]);
  assert.deepEqual(drawn, [4]);
});

test("connection check uses non-cacheable HTTP round trips and reports missing data explicitly", async () => {
  let now = 0;
  const times = [51, 27, 36];
  const measured = await measureVeyraConnection("https://veyra.invalid", {
    clock: () => now,
    request: async (url, options) => {
      assert.equal(options.cache, "no-store");
      if (url.endsWith("/health")) { now += times.shift(); return Response.json({ ok: true }); }
      return Response.json({ chromiumEnabled: false });
    }
  });
  assert.deepEqual(measured, { samples: 3, median: 36, spread: 24, availability: false });
  const offline = await measureVeyraConnection("https://veyra.invalid", { request: async () => { throw new Error("offline"); } });
  assert.deepEqual(offline, { samples: 0, median: null, spread: null, availability: null });
});
