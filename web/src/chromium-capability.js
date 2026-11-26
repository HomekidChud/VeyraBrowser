export function createChromiumCapabilityProbe({ request, ttlMs = 30_000, now = Date.now } = {}) {
  if (typeof request !== "function") throw new TypeError("A capability request function is required");
  const ttl = Math.max(250, Number(ttlMs) || 30_000);
  let value = null;
  let checkedAt = 0;
  let inFlight = null;

  return async function chromiumAvailable() {
    const age = now() - checkedAt;
    if (typeof value === "boolean" && age >= 0 && age < ttl) return value;
    if (inFlight) return inFlight;
    inFlight = Promise.resolve().then(request).then(status => {
      value = status?.chromiumEnabled === true;
      checkedAt = now();
      return value;
    }).catch(() => false).finally(() => { inFlight = null; });
    return inFlight;
  };
}
