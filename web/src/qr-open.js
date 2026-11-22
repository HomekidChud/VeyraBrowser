const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 50_000_000;
const MAX_SCAN_SIDE = 1280;
const IMAGE_TYPES = "image/jpeg,image/png,image/webp";

export function qrWebDestination(raw) {
  if (typeof raw !== "string" || raw.length > 4096 || /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\\]/u.test(raw)) return null;
  const value = raw.trim();
  const authority = /^https?:\/\/([^/?#\s]+)/i.exec(value)?.[1];
  if (!authority || authority.includes("@")) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/\.$/, "");
    // This entry point is for public websites, not device pairing or local
    // network addresses. The normal navigation policy still applies on open.
    if (url.username || url.password || url.port || !hostname.includes(".")
        || !/(?:^|\.)[a-z][a-z0-9-]*$/i.test(hostname)
        || /\.(?:localhost|local|internal|lan|home|onion)$/i.test(hostname)) return null;
    return { url: url.href, host: url.host, secure: url.protocol === "https:" };
  } catch { return null; }
}

function readPhoto(file, signal) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    const finish = (callback, value) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      img.onload = img.onerror = null;
      URL.revokeObjectURL(src);
      if (callback === reject) img.removeAttribute("src");
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, new Error("Reading the photo took too long. Try a smaller image.")), 7000);
    const onAbort = () => finish(reject, signal.reason);
    img.onload = () => finish(resolve, img);
    img.onerror = () => finish(reject, new Error("This photo couldn’t be read. Try a JPEG, PNG or WebP."));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    else img.src = src;
  });
}

function scanPixels({ data, width, height }, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./qr-scan-worker.js?v=1", import.meta.url));
    const timer = setTimeout(() => finish(reject, new Error("Scanning took too long. Try a closer photo of one code.")), 7000);
    const finish = (callback, value) => {
      clearTimeout(timer);
      worker.terminate();
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, signal.reason);
    worker.onmessage = ({ data: result }) => result?.error
      ? finish(reject, new Error("This photo couldn’t be scanned. Try another image."))
      : finish(resolve, typeof result?.decoded === "string" ? result.decoded : "");
    worker.onerror = () => finish(reject, new Error("The QR reader couldn’t start. Reopen the scanner and try again."));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    else {
      try { worker.postMessage({ data, width, height }, [data.buffer]); }
      catch (error) { finish(reject, error); }
    }
  });
}

async function scanPhoto(file, signal) {
  if (file.size > MAX_FILE_BYTES) throw new Error("Choose a photo under 12 MB.");
  if (!IMAGE_TYPES.split(",").includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP photo.");
  const img = await readPhoto(file, signal);
  if (signal.aborted) throw signal.reason;
  const { naturalWidth: width, naturalHeight: height } = img;
  if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw new Error("Choose a smaller photo or crop it to the code.");
  const scale = Math.min(1, MAX_SCAN_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  try {
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error("Image scanning isn’t available on this device.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await scanPixels(ctx.getImageData(0, 0, canvas.width, canvas.height), signal);
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export function openQrScanner({ openLink, returnFocus }) {
  if (document.getElementById("qrOpenDialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "qrOpenDialog";
  dialog.className = "modal";
  dialog.setAttribute("aria-labelledby", "qrOpenTitle");
  dialog.innerHTML = `<section class="modal-card sm">
    <h2 id="qrOpenTitle">Scan a QR link</h2>
    <p class="muted">Take a photo or choose an image with one QR code. Veyra reads it on this device and never uploads the photo.</p>
    <div class="qr-open-actions">
      <button type="button" class="btn ghost" data-qr-camera autofocus>Take photo</button>
      <button type="button" class="btn ghost" data-qr-library>Choose image</button>
      <input hidden type="file" accept="image/*" capture="environment" data-qr-camera-file>
      <input hidden type="file" accept="${IMAGE_TYPES}" data-qr-library-file>
    </div>
    <p class="qr-open-status" role="status" aria-live="polite">No image selected.</p>
    <div class="qr-open-preview" hidden>
      <strong class="qr-open-host"></strong>
      <p class="qr-open-url" dir="ltr"></p>
      <small class="qr-open-insecure" hidden>This link uses unencrypted HTTP.</small>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn ghost" data-qr-close>Cancel</button>
      <button type="button" class="btn primary" data-qr-open disabled>Open in Veyra</button>
    </div>
  </section>`;
  const find = selector => dialog.querySelector(selector);
  const status = find(".qr-open-status"), preview = find(".qr-open-preview"), host = find(".qr-open-host");
  const url = find(".qr-open-url"), insecure = find(".qr-open-insecure"), confirm = find("[data-qr-open]");
  let activeScan, destination;
  const cleanup = () => { activeScan?.abort(); destination = null; host.textContent = url.textContent = ""; };
  for (const kind of ["camera", "library"]) {
    const fileInput = find(`[data-qr-${kind}-file]`);
    find(`[data-qr-${kind}]`).onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      cleanup();
      preview.hidden = confirm.disabled = true;
      status.textContent = "Reading your photo…";
      const request = activeScan = new AbortController();
      try {
        const raw = await scanPhoto(file, request.signal);
        if (request.signal.aborted || !dialog.open) return;
        if (!raw) { status.textContent = "No QR code found. Try a clearer photo that shows one entire code."; return; }
        destination = qrWebDestination(raw);
        if (!destination) { status.textContent = "This code doesn’t contain a supported public HTTP or HTTPS web link."; return; }
        host.textContent = destination.host;
        url.textContent = destination.url;
        insecure.hidden = destination.secure;
        status.textContent = "Check the address before opening this link.";
        preview.hidden = confirm.disabled = false;
      } catch (error) {
        if (!request.signal.aborted) status.textContent = error instanceof Error ? error.message : "The photo couldn’t be scanned.";
      }
    };
  }
  find("[data-qr-close]").onclick = () => dialog.close();
  confirm.onclick = () => {
    const selected = destination?.url;
    if (!selected || !dialog.open) return;
    dialog.close();
    openLink(selected);
  };
  const onPageHide = () => dialog.close();
  dialog.addEventListener("close", () => {
    cleanup();
    window.removeEventListener("pagehide", onPageHide);
    dialog.remove();
    returnFocus?.focus();
  }, { once: true });
  window.addEventListener("pagehide", onPageHide, { once: true });
  document.body.append(dialog);
  dialog.showModal();
}
