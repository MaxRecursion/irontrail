#!/usr/bin/env node
/* Open a local test page in headless Chrome and report its verdict.
 *
 *   node tests/page-check.mjs tests/audio-check.html [--timeout 60] [--query a=b] [--shot out.png]
 *       [--width 1440 --height 900 --dpr 1] [--eval "js expression"]
 *
 * The page reports by setting document.title to "PASS …" or "FAIL …". The runner prints the title,
 * the page's visible text (or the value of --eval), console errors and uncaught exceptions, and
 * exits 0 only for PASS with no uncaught errors. Uses a throwaway profile; no npm packages.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const target = argv.find(a => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.startsWith('--'));
const opt = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
if (!target) { console.error('usage: node tests/page-check.mjs <page.html> [--timeout s] [--query q] [--shot file] [--eval js]'); process.exit(2); }
const timeout = (Number(opt('timeout')) || 60) * 1000;
const width = Number(opt('width')) || 1440, height = Number(opt('height')) || 900, dpr = Number(opt('dpr')) || 1;

function findChrome() {
  if (opt('chrome')) return opt('chrome');
  const cache = path.join(homedir(), 'Library/Caches/ms-playwright'), candidates = [];
  if (existsSync(cache)) for (const dir of readdirSync(cache).filter(d => d.startsWith('chromium-')).sort().reverse()) {
    candidates.push(path.join(cache, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
    candidates.push(path.join(cache, dir, 'chrome-linux/chrome'));
  }
  candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium');
  return candidates.find(existsSync);
}
const chromePath = findChrome();
if (!chromePath) { console.error('No Chrome found; pass --chrome'); process.exit(2); }
const profile = mkdtempSync(path.join(tmpdir(), 'irontrail-page-'));
const chrome = spawn(chromePath, [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--headless=new', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files', `--window-size=${width},${height}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buffer = '';
  const timer = setTimeout(() => reject(new Error('Chrome did not start')), 20000);
  chrome.stderr.on('data', chunk => { buffer += chunk; const m = buffer.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
  chrome.on('exit', code => reject(new Error(`Chrome exited (${code})`)));
});
const socket = new WebSocket(wsUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 1;
const pending = new Map(), errors = [];
socket.onmessage = message => {
  const data = JSON.parse(message.data);
  if (data.id && pending.has(data.id)) { const p = pending.get(data.id); pending.delete(data.id); data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.result); }
  if (data.method === 'Runtime.exceptionThrown') errors.push('uncaught: ' + (data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text));
  if (data.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(data.params.type)) errors.push('console.' + data.params.type + ': ' + data.params.args.map(a => a.value ?? a.description).join(' '));
  if (data.method === 'Log.entryAdded' && data.params.entry.level === 'error') errors.push('log: ' + data.params.entry.text);
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
let code = 1;
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s('Runtime.enable'); await s('Log.enable'); await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
  const url = pathToFileURL(path.resolve(target)).href + (opt('query') ? `?${opt('query')}` : '');
  await s('Page.navigate', { url });
  const started = Date.now();
  let title = '';
  while (Date.now() - started < timeout) {
    title = (await s('Runtime.evaluate', { expression: 'document.title', returnByValue: true })).result.value || '';
    if (/^(PASS|FAIL)/.test(title)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  const expression = opt('eval') || "(document.querySelector('pre,#result,main,body')||document.body).innerText.slice(0, 6000)";
  const text = (await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  if (opt('shot')) {
    const shot = await s('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.resolve(opt('shot')), Buffer.from(shot.data, 'base64'));
  }
  console.log(`TITLE: ${title || '(no verdict before timeout)'}`);
  console.log(typeof text === 'string' ? text : JSON.stringify(text, null, 2));
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  code = /^PASS/.test(title) && !errors.some(e => e.startsWith('uncaught')) ? 0 : 1;
} catch (error) {
  console.error(error);
}
socket.close(); chrome.kill('SIGTERM');
await new Promise(r => setTimeout(r, 300));
try { rmSync(profile, { recursive: true, force: true }); } catch (_) {}
process.exit(code);
