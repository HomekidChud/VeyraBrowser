export const STREAM_PRESETS = Object.freeze({
  adaptive: { label: "Adaptive", description: "Keeps the picture sharp and drops old frames when the connection slows." },
  responsive: { label: "Low delay", description: "Uses smaller frames for less bandwidth and faster delivery." },
  sharp: { label: "Sharp", description: "Uses the highest available resolution and more bandwidth." }
});
export const streamPreset = value => Object.hasOwn(STREAM_PRESETS, value) ? value : "adaptive";
export const FRAME_MEDIA_TYPE = "application/vnd.veyra.jpeg-stream";
const MAX_FRAME = 768 * 1024;

export async function measureVeyraConnection(base, { request = fetch, signal, clock = () => performance.now() } = {}) {
  const fetchJson = async path => {
    const ctl = new AbortController();
    const abort = () => ctl.abort();
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 4000);
    try {
      const response = await request(`${base}${path}`, { signal: ctl.signal, cache: "no-store", credentials: "omit" });
      return response.ok ? await response.json() : null;
    } catch { return null; }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  };
  const samples = [];
  for (let i = 0; i < 3 && !signal?.aborted; i++) {
    const start = clock();
    if ((await fetchJson("/health"))?.ok === true) samples.push(Math.max(0, Math.round(clock() - start)));
    else break;
  }
  const status = signal?.aborted ? null : await fetchJson("/api/acquisition/status");
  samples.sort((a, b) => a - b);
  return {
    samples: samples.length, median: samples.length === 3 ? samples[1] : null,
    spread: samples.length === 3 ? samples[2] - samples[0] : null,
    availability: typeof status?.chromiumEnabled === "boolean" ? status.chromiumEnabled : null
  };
}

export function frameReader(onFrame) {
  const header = new Uint8Array(4);
  let offset = 0, frame = null;
  return chunk => {
    for (let at = 0; at < chunk.length;) {
      const target = frame || header;
      const count = Math.min(target.length - offset, chunk.length - at);
      target.set(chunk.subarray(at, at + count), offset);
      offset += count; at += count;
      if (offset < target.length) continue;
      offset = 0;
      if (frame) {
        frame = null;
        onFrame(target);
      } else {
        const size = new DataView(header.buffer).getUint32(0);
        if (size > MAX_FRAME) throw new RangeError("Invalid stream frame size");
        if (size) frame = new Uint8Array(size);
      }
    }
  };
}

// One undecoded frame and one decoded frame can wait for the next repaint.
// Decode the newest available image and never build a playback backlog.
export function latestFramePump({ decode, draw, requestPaint, cancelPaint, failed = () => {} }) {
  let waiting = null, ready = null, busy = false, paint = null, done = false;
  const process = async () => {
    if (done || busy || !waiting) return;
    busy = true;
    const bytes = waiting;
    waiting = null;
    try {
      const bitmap = await decode(bytes);
      if (done) { bitmap.close?.(); return; }
      ready?.close?.();
      ready = bitmap;
      if (paint === null) paint = requestPaint(() => {
        paint = null;
        const picture = ready;
        ready = null;
        if (!picture) return;
        try { if (!done) draw(picture); } catch { failed(); } finally { picture.close?.(); }
      });
    } catch { if (!done) failed(); }
    finally { busy = false; if (waiting) void process(); }
  };
  return {
    push(bytes) { if (!done) { waiting = bytes; void process(); } },
    stop() { done = true; waiting = null; ready?.close?.(); ready = null; if (paint !== null) cancelPaint(paint); }
  };
}

export function loadSnapshot(url, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Screenshot cancelled"));
    const img = new Image();
    const cleanup = () => { signal?.removeEventListener("abort", abort); img.onload = null; img.onerror = null; };
    const abort = () => { cleanup(); img.removeAttribute("src"); reject(new Error("Screenshot cancelled")); };
    img.onload = () => { cleanup(); resolve(img); };
    img.onerror = () => { cleanup(); reject(new Error("Screenshot unavailable")); };
    signal?.addEventListener("abort", abort, { once: true });
    img.src = url;
  });
}

export function makeRemoteFrames({ base, request = fetch, draw, onState = () => {} }) {
  let run = null;
  const report = (job, state, data = {}) => { if (run === job) onState(state, data); };
  const stop = () => {
    const job = run;
    run = null;
    if (!job) return;
    job.abort.abort();
    job.pipe?.abort();
    job.pump?.stop();
    clearTimeout(job.retry);
    clearTimeout(job.watch);
    clearInterval(job.stats);
  };
  const fallbackFrame = async job => {
    if (run !== job || job.mode !== "snapshot" || job.pending) return;
    clearTimeout(job.retry); job.retry = null;
    job.pending = true;
    const ctl = new AbortController();
    const cancel = () => ctl.abort();
    job.abort.signal.addEventListener("abort", cancel, { once: true });
    const deadline = setTimeout(cancel, 6500);
    try {
      const img = await loadSnapshot(`${job.url}/screenshot?ts=${Date.now()}`, { signal: ctl.signal });
      if (run === job) {
        draw(img);
        report(job, "snapshot");
      }
    } catch { report(job, "snapshot-unavailable"); }
    finally {
      clearTimeout(deadline);
      job.abort.signal.removeEventListener("abort", cancel);
      job.pending = false;
      if (run === job) job.retry = setTimeout(() => fallbackFrame(job), job.requested ? 50 : 1400);
      job.requested = false;
    }
  };
  const startFallback = job => {
    job.mode = "snapshot";
    report(job, "snapshot");
    void fallbackFrame(job);
  };
  const connect = async job => {
    if (run !== job) return;
    const pipe = job.pipe = new AbortController();
    let drew = false, reconnect = false;
    job.mode = "connecting";
    report(job, "connecting");
    const watch = ms => {
      clearTimeout(job.watch);
      job.watch = setTimeout(() => pipe.abort(), ms);
    };
    watch(6500);
    try {
      if (typeof createImageBitmap !== "function") return startFallback(job);
      const response = await request(`${job.url}/frames?quality=${job.quality}`, {
        headers: { "X-Veyra-Proxy-Session": job.owner }, credentials: "omit", cache: "no-store", signal: pipe.signal
      });
      reconnect = response.status === 409;
      if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith(FRAME_MEDIA_TYPE)) return;
      const reader = response.body.getReader();
      let badFrames = 0;
      const pump = job.pump = latestFramePump({
        decode: bytes => createImageBitmap(new Blob([bytes], { type: "image/jpeg" })),
        requestPaint: requestAnimationFrame, cancelPaint: cancelAnimationFrame,
        draw: bitmap => {
          if (run !== job || pipe.signal.aborted) return;
          draw(bitmap);
          if (!drew) {
            drew = true; job.mode = "live"; reconnect = true;
            report(job, "live");
          }
          badFrames = 0;
          job.drawn++;
        },
        failed: () => { if (++badFrames >= 3) pipe.abort(); }
      });
      const push = frameReader(bytes => pump.push(bytes));
      while (run === job && !pipe.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        if (drew) watch(7500);
        push(value);
      }
    } catch { /* Reconnect if a working stream was interrupted; otherwise fall back. */ }
    finally {
      clearTimeout(job.watch);
      job.pump?.stop();
      pipe.abort();
      if (run === job && job.mode !== "snapshot") {
        if (reconnect && (drew || job.retries < 2)) {
          job.retries = drew ? 0 : job.retries + 1;
          job.mode = "connecting";
          report(job, "connecting");
          job.retry = setTimeout(() => connect(job), 350);
        } else startFallback(job);
      }
    }
  };
  return {
    start(id, owner, quality) {
      quality = streamPreset(quality);
      if (run?.id === id && run.quality === quality && run.owner === owner) return;
      stop();
      const job = run = { id, owner, quality, url: `${base}/api/browser/session/${encodeURIComponent(id)}`,
        abort: new AbortController(), drawn: 0, retries: 0 };
      let since = performance.now();
      job.stats = setInterval(() => {
        const now = performance.now();
        if (job.mode === "live") report(job, "live", { fps: +(job.drawn * 1000 / (now - since)).toFixed(1) });
        job.drawn = 0;
        since = now;
      }, 2000);
      if (owner) void connect(job); else startFallback(job);
    },
    stop,
    interactive(id) { return run?.id === id && run.mode === "live"; },
    refresh(id) {
      if (run?.id !== id || run.mode !== "snapshot") return;
      if (run.pending) run.requested = true;
      else void fallbackFrame(run);
    }
  };
}
