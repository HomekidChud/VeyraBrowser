export function recoverableApiError(error) {
  return ["API_TIMEOUT", "API_NETWORK_ERROR", "API_INVALID_RESPONSE"].includes(error?.code)
    || [502, 503, 504].includes(error?.status);
}

// The host can respond with HTML while it starts. Only the health contract
// counts as ready; neither a quick HTTP response nor an HTTP 200 is enough.
export function createApiReadiness(probe, { waitMs = 60_000, attemptMs = 8_000, intervalMs = 2_000 } = {}) {
  let pending = null;
  return function waitForApi() {
    if (pending) return pending;
    pending = (async () => {
      const until = Date.now() + waitMs;
      do {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(attemptMs, Math.max(0, until - Date.now())));
        try {
          const response = await probe(controller.signal);
          if (response.ok && /\bapplication\/json\b/i.test(response.headers.get("content-type") || "")
            && (await response.json())?.ok === true) return true;
        } catch {}
        finally { clearTimeout(timer); }
        const remaining = until - Date.now();
        if (remaining <= 0) break;
        await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remaining)));
      } while (Date.now() < until);
      return false;
    })().finally(() => { pending = null; });
    return pending;
  };
}
