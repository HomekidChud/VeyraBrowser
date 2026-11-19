export const EXTENSION_PIN_LIMIT = 3;
const validId = id => typeof id === "string" && /^[a-z0-9][a-z0-9_.-]{1,63}$/i.test(id);

export function extensionPins(value) {
  return Array.isArray(value) ? [...new Set(value.filter(validId))].slice(0, EXTENSION_PIN_LIMIT) : [];
}

export function pinExtension(value, id) {
  const pins = extensionPins(value);
  if (!validId(id)) return pins;
  if (pins.includes(id)) return pins.filter(pin => pin !== id);
  if (pins.length >= EXTENSION_PIN_LIMIT) throw new Error(`Unpin one of your ${EXTENSION_PIN_LIMIT} toolbar extensions first.`);
  return [...pins, id];
}

export function actionAvailability(extension, workerStatus) {
  if (extension?.kind !== "chrome" || !extension.action) return "No toolbar action";
  if (!extension.enabled) return "Disabled";
  if (extension.action.defaultPopup) return "Popup not supported";
  if (workerStatus !== "running") return "No running background";
  return "";
}

export function actionBadge(text) {
  if (typeof text !== "string") throw new Error("Badge text must be a string.");
  return Array.from(text.slice(0, 24).replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, "")).slice(0, 4).join("");
}

export function safeExtensionIcon(value) {
  if (typeof value !== "string" || value.length > 180_000) return "";
  if (/^data:image\/(?:png|jpeg|gif|webp|bmp|vnd\.microsoft\.icon|x-icon);base64,[a-z0-9+/]+={0,2}$/i.test(value)) return value;
  if (value.startsWith("data:image/svg+xml,")) return value;
  return "";
}
