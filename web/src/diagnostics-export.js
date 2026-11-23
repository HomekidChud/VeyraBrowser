function originOnly(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin + "/";
  } catch {}
  return "";
}

const milliseconds = value => Number.isFinite(value) && value >= 0 ? value : 0;
const method = value => typeof value === "string" && /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE)$/.test(value) ? value : "OTHER";
const timestamp = (value, fallback) => new Date(Number.isFinite(value) && value > 0 && value <= 8.64e15 ? value : fallback).toISOString();

// Build a new export from an allowlist. Captured headers, bodies, URL paths and
// free-form messages can contain secrets even when they have no familiar name.
export function shareableHar(pageUrl, rows, now = Date.now()) {
  return { log: {
    version: "1.2", creator: { name: "Veyra DevTools", version: "1" },
    comment: "Shareable summary. Only origins, methods, status codes, sizes and timings are retained. Review hostnames before sharing.",
    pages: [{ id: "page_1", title: originOnly(pageUrl) || "Browser page", startedDateTime: timestamp(rows[0]?.startedAt, now), pageTimings: {} }],
    entries: rows.flatMap(row => {
      const url = originOnly(row.url);
      if (!url) return [];
      const time = milliseconds(row.duration), size = milliseconds(row.size);
      const status = Number.isInteger(row.status) && row.status >= 100 && row.status <= 599 ? row.status : 0;
      return [{
        pageref: "page_1", startedDateTime: timestamp(row.startedAt, now), time,
        request: { method: method(row.method), url, httpVersion: "", headers: [], cookies: [], queryString: [], headersSize: -1, bodySize: -1 },
        response: { status, statusText: "", httpVersion: "", headers: [], cookies: [], content: { size, mimeType: "" }, redirectURL: "", headersSize: -1, bodySize: -1 },
        cache: {}, timings: { send: 0, wait: time, receive: 0 }
      }];
    })
  } };
}
