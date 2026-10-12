export function redactDiagnosticText(value) {
  return String(value ?? '').replace(/https?:\/\/[^\s"'<>]+/g, raw => {
    try {
      const url = new URL(raw);
      url.username = ''; url.password = ''; url.search = url.search ? '?[redacted]' : ''; url.hash = '';
      url.pathname = url.pathname.replace(/(\/api\/(?:session|browser\/session|cast\/(?:poll|send|close|device\/(?:poll|push))))\/[^/]+/gi, '$1/[redacted]');
      return url.href;
    }
    catch { return '[URL]'; }
  }).replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[redacted]')
    .replace(/((?:password|token|secret|api[_-]?key|cookie|authorization|session[_-]?id)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]');
}
export function sanitizeHar(har) {
  const copy = structuredClone(har);
  for (const page of copy.log.pages || []) page.title = redactDiagnosticText(page.title);
  for (const entry of copy.log.entries || []) {
    for (const side of [entry.request, entry.response]) {
      if (!side) continue;
      if (side.url) side.url = redactDiagnosticText(side.url);
      side.headers = (side.headers || []).map(h => ({
        name: h.name,
        value: /authorization|cookie|token|secret|key|session|csrf/i.test(h.name) ? '[redacted]' : redactDiagnosticText(h.value),
      }));
      side.cookies = [];
      if (side.queryString) side.queryString = [];
      delete side.postData;
      if (side.content) delete side.content.text;
      if (side.redirectURL) side.redirectURL = redactDiagnosticText(side.redirectURL);
    }
  }
  return copy;
}
export function consoleDiagnostics(tab, rows) {
  return {
    format: 'veyra-console-diagnostics', version: 1, exportedAt: new Date().toISOString(),
    page: redactDiagnosticText(tab.url), mode: tab.browserMode || 'fast-proxy',
    privacy: 'URL queries, bearer tokens and common secret labels redacted. Review free-form messages before sharing.',
    entries: rows.map(({ c, n }) => ({ level: c.level, kind: c.kind, count: n, time: c.time,
      message: redactDiagnosticText(c.message), url: redactDiagnosticText(c.url),
      line: c.line, column: c.column, stack: redactDiagnosticText(c.stack) })),
  };
}
