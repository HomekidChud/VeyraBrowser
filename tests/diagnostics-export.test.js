import assert from 'node:assert/strict';
import { sanitizeHar, consoleDiagnostics, redactDiagnosticText } from '../web/src/diagnostics-export.js';
const har = { log: { pages: [{ title: 'https://example.com/?session=secret' }], entries: [{
  request: { url: 'https://example.com/?token=secret', headers: [{ name: 'Cookie', value: 'private' }, { name: 'Authorization', value: 'Bearer secret' }], postData: { text: 'password=private' }, cookies: ['private'] },
  response: { headers: [{ name: 'Set-Cookie', value: 'private' }, { name: 'X-Veyra-Session-ID', value: 'private' }], content: { text: 'private' } },
}] } };
const clean = JSON.stringify(sanitizeHar(har));
assert.equal(clean.includes('secret'), false);
assert.equal(clean.includes('private'), false);
assert.equal(har.log.entries[0].request.postData.text, 'password=private');
assert.equal(redactDiagnosticText('https://user:pass@example.com/a?code=123#token'), 'https://example.com/a?[redacted]');
assert.equal(redactDiagnosticText('Bearer abc.def password=testing'), 'Bearer [redacted] password=[redacted]');
const report = consoleDiagnostics({ url: 'https://example.com/?token=123' }, [{ c: { message: 'token=123', level: 'error', preview: { secret: 'private' } }, n: 1 }]);
assert.equal(JSON.stringify(report).includes('private'), false);
assert.equal(report.entries[0].message, 'token=[redacted]');
assert.equal(redactDiagnosticText('https://example.com/api/session/private/heartbeat').includes('private'), false);
console.log('Diagnostics export: 8 privacy checks passed.');
