/* The image stays in this same-origin worker and is discarded after the scan. */
importScripts("../vendor/jsQR-1.4.0.js");

self.onmessage = ({ data: { data, width, height } }) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || width > 1280 || height > 1280 || !(data instanceof Uint8ClampedArray)
      || data.length !== width * height * 4) {
    self.postMessage({ error: true });
    return;
  }
  try {
    const decoded = self.jsQR(data, width, height, { inversionAttempts: "attemptBoth" })?.data || "";
    self.postMessage({ decoded });
  } catch {
    self.postMessage({ error: true });
  }
};
