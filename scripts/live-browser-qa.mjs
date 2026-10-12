import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { classifyOutcome } from './qa-outcomes.mjs';
import { redactDiagnosticText } from '../web/src/diagnostics-export.js';

export const MAJOR_SITES = [
  ['YouTube', 'https://www.youtube.com/'],
  ['TikTok', 'https://www.tiktok.com/'],
  ['Wikipedia', 'https://en.wikipedia.org/wiki/Web_browser'],
  ['GitHub', 'https://github.com/'],
  ['Reddit', 'https://www.reddit.com/'],
  ['Google', 'https://www.google.com/'],
  ['MDN', 'https://developer.mozilla.org/en-US/'],
  ['BBC', 'https://www.bbc.com/'],
  ['Amazon', 'https://www.amazon.com/'],
  ['Instagram', 'https://www.instagram.com/'],
  ['Twitch', 'https://www.twitch.tv/'],
  ['Discord', 'https://discord.com/'],
  ['StackOverflow', 'https://stackoverflow.com/'],
  ['Microsoft', 'https://www.microsoft.com/'],
  ['Apple', 'https://www.apple.com/'],
  ['InternetArchive', 'https://archive.org/'],
];

// Reports must not publish session capabilities, signed query strings or cookies.
export function redact(text) {
  return redactDiagnosticText(text);
}

export async function runSite(context, name, target, output, base) {
  const page = await context.newPage();
  const consoleEntries = [], failedRequests = [], responses = [];
  page.on('console', m => {
    if (['error', 'warning'].includes(m.type()) && consoleEntries.length < 80)
      consoleEntries.push({ type: m.type(), message: redact(m.text()), location: redact(m.location().url) });
  });
  page.on('pageerror', e => {
    if (consoleEntries.length < 80) consoleEntries.push({ type: 'pageerror', message: redact(e.message), stack: redact(e.stack) });
  });
  page.on('requestfailed', r => {
    if (failedRequests.length < 80) failedRequests.push({ url: redact(r.url()), error: r.failure()?.errorText });
  });
  page.on('response', r => {
    if (r.status() >= 400 && responses.length < 80) responses.push({ url: redact(r.url()), status: r.status() });
  });
  const started = Date.now();
  let content = '', outcome = 'unverified', error = '', screenshot;
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#heroInput').fill(target);
    // Each site gets its own Veyra session. Do not collect an old iframe's errors.
    const documentResponse = page.waitForResponse(r => {
      try { const u = new URL(r.url()); return r.request().resourceType() === 'document' &&
        (u.searchParams.get('url') === target || u.pathname.includes('/api/browser/')); }
      catch { return false; }
    }, { timeout: 45000 });
    await page.getByRole('button', { name: 'Open in Veyra', exact: true }).click();
    const response = await documentResponse;
    const f = await page.waitForSelector('iframe.tab-frame', { timeout: 10000 });
    const frame = await f.contentFrame();
    if (!frame) throw new Error('The Veyra page frame was not attached.');
    await frame.waitForLoadState('domcontentloaded', { timeout: 20000 });
    // Custom-element sites render inside open shadow roots. body.innerText
    // alone incorrectly reports those pages as blank.
    await frame.waitForFunction(() => {
      const roots = [document.body];
      let text = '';
      for (let i = 0; i < roots.length && i < 200; i++) {
        const root = roots[i]; if (!root) continue;
        if (root instanceof ShadowRoot) {
          for (const el of root.children) if (!/^(SCRIPT|STYLE)$/.test(el.tagName)) text += el.innerText || '';
        } else text += root.innerText || '';
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
      }
      return text.trim().length > 50;
    }, null, { timeout: 15000 }).catch(() => {});
    content = await frame.evaluate(() => {
      const roots = [document.body], pieces = [];
      for (let i = 0; i < roots.length && i < 200; i++) {
        const root = roots[i]; if (!root) continue;
        // Do not count script/JSON payloads as rendered text.
        if (root instanceof ShadowRoot) {
          for (const el of root.children) if (!/^(SCRIPT|STYLE)$/.test(el.tagName))
            pieces.push(el.innerText || '');
        } else pieces.push(root.innerText || '');
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
      }
      return pieces.join('\n').slice(0, 6000);
    });
    outcome = classifyOutcome(content, response.status());
  } catch (e) { error = redact(e.message); outcome = 'timeout-or-navigation-error'; }
  // One screenshot per distinct failure class, never every navigation.
  if (context.qaCaptureScreenshots !== false && outcome !== 'content-rendered' && !context.qaScreenshots.has(outcome) && context.qaScreenshots.size < 5) {
    context.qaScreenshots.add(outcome);
    screenshot = `${outcome}-${name}.png`;
    await page.screenshot({ path: `${output}/${screenshot}` });
  }
  const result = { name, target, outcome, elapsedMs: Date.now() - started, content, error,
    consoleEntries: [...consoleEntries], failedRequests: [...failedRequests], httpErrors: [...responses], screenshot };
  // End the owned disposable session; do not leave test sessions running.
  await page.evaluate(async () => {
    const script = [...document.querySelectorAll('script[type="module"][src]')]
      .find(x => /\/src\/app\.js(?:\?|$)/.test(x.src));
    if (!script) return;
    const app = await import(script.src); if (app.state?.session) await app.endSession('qa_finished');
  }).catch(() => {});
  await page.close();
  return result;
}

export async function runQA({ base = 'https://homekidchud.github.io/VeyraBrowser/web/',
  output = './qa-output', sites = MAJOR_SITES, captureScreenshots = true } = {}) {
  await mkdir(output, { recursive: true });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, channel: 'chromium',
    ...(process.env.VEYRA_QA_CHROMIUM ? { executablePath: process.env.VEYRA_QA_CHROMIUM } : {}) });
  const screenshots = new Set();
  const results = [];
  try {
    for (const [name, target] of sites) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      context.qaScreenshots = screenshots;
      context.qaCaptureScreenshots = captureScreenshots;
      let r;
      try { r = await runSite(context, name, target, output, base); }
      finally { await context.close(); }
      results.push(r);
      console.log(`${name}: ${r.outcome} (${r.elapsedMs}ms)`);
      await writeFile(`${output}/results.json`, JSON.stringify({ base, recordedAt: new Date().toISOString(), results }, null, 2));
    }
  } finally { await browser.close(); }
  return results;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runQA({ base: process.env.VEYRA_QA_URL, output: process.env.VEYRA_QA_OUTPUT || './qa-output' });
