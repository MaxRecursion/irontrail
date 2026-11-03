#!/usr/bin/env node
/* Frame-time benchmark for the built game, using Chrome DevTools Protocol directly.
 * No npm packages: Node 22+ (global WebSocket) and a local Chrome / Chrome for Testing.
 *
 *   node tests/perf-bench.mjs --stage 10 --seconds 12 --dpr 2 [--uncapped] [--file index.html]
 *
 * It drives a real run (throttle held, cannon fired on lock) in a throwaway browser
 * profile, so it never touches a player's saved campaign. Each requestAnimationFrame
 * callback is wrapped from outside the game, so the same harness measures any build.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((out, arg, i, all) => {
  if (arg.startsWith('--')) out.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return out;
}, []));
const stage = Math.max(1, Math.min(10, Number(args.stage) || 10));
const seconds = Number(args.seconds) || 12;
const dpr = Number(args.dpr) || 2;
const width = Number(args.width) || 1600, height = Number(args.height) || 1000;
const file = path.resolve(args.file || path.join(here, '..', 'index.html'));
const uncapped = !!args.uncapped;
const throttle = Math.max(1, Number(args.throttle) || 1);
const profileTop = args.profile ? (Number(args.profile) || 30) : 0;
const trace = !!args.trace;
// --shots dir: save PNG screenshots of the canvas area at a few points in the run.
const shotsDir = typeof args.shots === 'string' ? path.resolve(args.shots) : null;
const headless = args.headed ? false : true;

function findChrome() {
  if (args.chrome) return args.chrome;
  const cache = path.join(homedir(), 'Library/Caches/ms-playwright');
  const candidates = [];
  try {
    for (const dir of (existsSync(cache) ? readdirSync(cache) : []).filter(d => d.startsWith('chromium-')).sort().reverse()) {
      candidates.push(path.join(cache, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
      candidates.push(path.join(cache, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'));
      candidates.push(path.join(cache, dir, 'chrome-linux/chrome'));
    }
  } catch (_) { /* fall through */ }
  candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium');
  return candidates.find(existsSync);
}

const chromePath = findChrome();
if (!chromePath) { console.error('No Chrome binary found; pass --chrome /path/to/chrome'); process.exit(2); }
const profile = mkdtempSync(path.join(tmpdir(), 'irontrail-bench-'));
const flags = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', `--window-size=${width},${height}`, '--allow-file-access-from-files'];
if (headless) flags.push('--headless=new');
if (uncapped) flags.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const chrome = spawn(chromePath, [...flags, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buffer = '';
  const timer = setTimeout(() => reject(new Error('Chrome did not expose DevTools in time')), 20000);
  chrome.stderr.on('data', chunk => {
    buffer += chunk;
    const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) { clearTimeout(timer); resolve(match[1]); }
  });
  chrome.on('exit', code => reject(new Error(`Chrome exited early (${code})`)));
});

const socket = new WebSocket(wsUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 1;
const pending = new Map();
socket.onmessage = message => {
  const data = JSON.parse(message.data);
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id); pending.delete(data.id);
    if (data.error) reject(new Error(data.error.message)); else resolve(data.result);
  }
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

async function cleanup(code) {
  try { socket.close(); } catch (_) {}
  chrome.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 300));
  try { rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  process.exit(code);
}

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => send(method, params, sessionId);
  await s('Page.enable'); await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
  await s('Emulation.setFocusEmulationEnabled', { enabled: true });
  if (throttle > 1) await s('Emulation.setCPUThrottlingRate', { rate: throttle });
  // Unlock every stage in this throwaway profile only, and time each rAF callback.
  await s('Page.addScriptToEvaluateOnNewDocument', { source: `
    try { localStorage.setItem('irontrail-campaign-v1', JSON.stringify({unlocked:10,completed:[0,1,2,3,4,5,6,7,8],best:{},selected:${stage - 1}})); } catch (_) {}
    window.__bench = { frames: [] };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => raf(t => {
      const t0 = performance.now(); cb(t); const t1 = performance.now();
      const mode = window.irontrail ? window.irontrail.mode : 'boot';
      // v3 builds report their own draw-op count and render scale per frame.
      const perf = window.irontrail && window.irontrail.perf;
      if (perf && window.__bench.frames.length % 30 === 0) window.__bench.perf = { drawOps: perf.drawOps, renderScale: perf.renderScale, quality: perf.quality, refreshHz: perf.refreshHz };
      window.__bench.frames.push([t, t1 - t0, mode]);
    });
  ` });
  const loaded = new Promise(resolve => { socket.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.method === 'Page.loadEventFired' && d.sessionId === sessionId) resolve(); }); });
  await s('Page.navigate', { url: pathToFileURL(file).href + (args.query ? `?${args.query}` : '') });
  await loaded;
  await new Promise(r => setTimeout(r, 800));
  const evaluate = async expression => (await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  const info = await evaluate(`(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const c = document.getElementById('gameCanvas');
    return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', canvas: [c.width, c.height], stage: window.irontrail && window.irontrail.stage };
  })()`);
  const traceEvents = [];
  let traceDone = null;
  if (trace) {
    traceDone = new Promise(resolve => socket.addEventListener('message', m => {
      const d = JSON.parse(m.data);
      if (d.method === 'Tracing.dataCollected') traceEvents.push(...d.params.value);
      if (d.method === 'Tracing.tracingComplete') resolve();
    }));
    await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'blink', 'cc', 'gpu', 'toplevel'] } });
  }
  if (profileTop) { await s('Profiler.enable'); await s('Profiler.setSamplingInterval', { interval: 100 }); await s('Profiler.start'); }
  // Start, hold throttle, fire on lock, and keep driving through retries.
  await evaluate(`(() => {
    window.__bench.frames.length = 0;
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    // v3 builds expose a QA-only entry point that starts the selected stage directly;
    // v2 builds start from the overlay's primary button.
    if (window.irontrail && window.irontrail.qa && window.irontrail.qa.start) window.irontrail.qa.start(${stage - 1});
    else document.getElementById('playButton').click();
    key('keydown', 'KeyW');
    window.__bench.driver = setInterval(() => {
      const g = window.irontrail; if (!g) return;
      if (g.mode === 'playing') {
        key('keydown', 'KeyW');
        const t = g.telemetry;
        if (t.weapon && t.weapon.canHit && t.ammo > 0) { key('keydown', 'KeyX'); key('keyup', 'KeyX'); }
      } else if (g.mode === 'failed' || g.mode === 'cleared' || g.mode === 'victory') {
        key('keyup', 'KeyW');
        // Retry the same stage so the benchmark keeps measuring gameplay frames.
        if (g.qa && g.qa.start) g.qa.start(${stage - 1});
        else if (g.mode === 'failed') document.getElementById('playButton').click();
        else key('keydown', 'KeyR');
      }
    }, 40);
    return true;
  })()`);
  if (shotsDir) {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(shotsDir, { recursive: true });
    const marks = [0.18, 0.42, 0.66, 0.9].map(f => f * seconds);
    let waited = 0;
    for (const [i, mark] of marks.entries()) {
      await new Promise(r => setTimeout(r, (mark - waited) * 1000)); waited = mark;
      const shot = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(path.join(shotsDir, `stage${String(stage).padStart(2, '0')}-${i + 1}.png`), Buffer.from(shot.data, 'base64'));
    }
    await new Promise(r => setTimeout(r, Math.max(0, seconds - waited) * 1000));
  } else await new Promise(r => setTimeout(r, seconds * 1000));
  const frames = await evaluate(`(() => { clearInterval(window.__bench.driver); return window.__bench.frames; })()`);
  let hot = null, traceSummary = null;
  if (trace) {
    await send('Tracing.end'); await traceDone;
    // Attribute complete events on the renderer main thread by name (self time is
    // approximated by total duration of top-level-ish timeline events).
    const threads = new Map();
    for (const e of traceEvents) if (e.ph === 'M' && e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args.name);
    const names = ['RunTask', 'FunctionCall', 'FireAnimationFrame', 'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'UpdateLayer', 'CompositeLayers', 'Commit', 'MajorGC', 'MinorGC', 'V8.GC_SCAVENGER', 'V8.GCScavenger', 'V8.GCFinalizeMC', 'V8.GC_MC_BACKGROUND_MARKING', 'EventDispatch', 'ParseHTML', 'HitTest', 'ScheduleStyleRecalculation', 'InvalidateLayout', 'Canvas2DLayerBridge::FlushRecording', 'CanvasResourceProvider::FlushCanvas'];
    const totals = {};
    for (const e of traceEvents) {
      const thread = threads.get(`${e.pid}:${e.tid}`) || '';
      if (e.ph !== 'X' || !e.dur) continue;
      const key = `${thread} :: ${e.name}`;
      if (!names.includes(e.name) && !/GC|Canvas|Raster|Draw|Gpu|Swap/.test(e.name)) continue;
      totals[key] = (totals[key] || 0) + e.dur / 1000;
    }
    traceSummary = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, ms]) => `${ms.toFixed(1).padStart(8)}ms  ${k}`);
    // Per-frame cost of whole threads, which includes canvas serialization and DOM work
    // that happens outside the rAF callback.
    const perFrame = name => +((totals[name] || 0) / Math.max(1, frames.length)).toFixed(3);
    traceSummary.unshift(`main thread RunTask/frame: ${perFrame('CrRendererMain :: RunTask')}ms, GPU main RunTask/frame: ${perFrame('CrGpuMain :: RunTask')}ms, Commit/frame: ${perFrame('CrRendererMain :: Commit')}ms, canvas serialize/frame: ${perFrame('CrRendererMain :: RasterImplementation::RasterCHROMIUM')}ms`);
  }
  if (profileTop) {
    const { profile } = await s('Profiler.stop');
    const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
    const dt = new Map();
    for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
    let total = 0;
    for (const [id, us] of dt) {
      const f = byId.get(id).callFrame, key = `${f.functionName || '(anonymous)'} ${f.url ? path.basename(f.url) : ''}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) || 0) + us); total += us;
    }
    hot = [...self].sort((a, b) => b[1] - a[1]).slice(0, profileTop).map(([k, us]) => `${(us / total * 100).toFixed(1).padStart(5)}%  ${(us / 1000).toFixed(0).padStart(6)}ms  ${k}`);
  }
  const playing = frames.filter(f => f[2] === 'playing');
  const cpu = playing.map(f => f[1]).sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < frames.length; i++) intervals.push(frames[i][0] - frames[i - 1][0]);
  intervals.sort((a, b) => a - b);
  const pct = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : NaN;
  const mean = arr => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
  const summary = {
    build: path.relative(process.cwd(), file), stage, dpr, viewport: `${width}x${height}`, headless, uncapped, cpuThrottle: throttle, ...info,
    frames: frames.length, playingFrames: playing.length,
    cpuMs: { mean: +mean(cpu).toFixed(3), p50: +pct(cpu, .5).toFixed(3), p95: +pct(cpu, .95).toFixed(3), p99: +pct(cpu, .99).toFixed(3), max: +(cpu[cpu.length - 1] || 0).toFixed(3) },
    over8_33ms: cpu.filter(v => v > 1000 / 120).length, over4ms: cpu.filter(v => v > 4).length,
    intervalMs: { mean: +mean(intervals).toFixed(3), p50: +pct(intervals, .5).toFixed(3), p95: +pct(intervals, .95).toFixed(3), p99: +pct(intervals, .99).toFixed(3) },
    achievedFps: +(1000 / mean(intervals)).toFixed(1),
    gamePerf: await evaluate('window.__bench.perf || null'),
    pacing: await evaluate(`(() => {
      // v3 only: rendered chassis X per frame. With interpolation, on-screen velocity stays steady
      // even when frame intervals are irregular; without it, X advances in 120 Hz stair steps.
      const perf = window.irontrail && window.irontrail.perf;
      if (!perf || typeof perf.trace !== 'function') return null;
      const rows = perf.trace().filter(r => Number.isFinite(r[1]));
      const ratios = [];
      for (let i = 2; i < rows.length; i++) {
        const dt1 = rows[i][0] - rows[i - 1][0], dt0 = rows[i - 1][0] - rows[i - 2][0];
        const v1 = (rows[i][1] - rows[i - 1][1]) / dt1, v0 = (rows[i - 1][1] - rows[i - 2][1]) / dt0;
        if (dt0 > 0 && dt1 > 0 && Math.abs(v0) > 0.004 && Math.abs(v1) > 0.004) ratios.push(Math.abs(Math.log(Math.abs(v1 / v0))));
      }
      ratios.sort((a, b) => a - b);
      const q = p => ratios.length ? +ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * p))].toFixed(3) : null;
      const stalls = rows.slice(1).filter((r, i) => r[1] === rows[i][1]).length;
      return { frames: rows.length, velocityJumpLogRatio: { p50: q(.5), p95: q(.95), p99: q(.99) }, frozenFrames: stalls };
    })()`),
    worstFrames: playing.map((f, i) => [i, +f[1].toFixed(2)]).sort((a, b) => b[1] - a[1]).slice(0, 6)
  };
  console.log(JSON.stringify(summary, null, 2));
  if (hot) console.log('Self time (sampled):\n' + hot.join('\n'));
  if (traceSummary) console.log('Trace totals over the run:\n' + traceSummary.join('\n'));
  await cleanup(0);
} catch (error) {
  console.error(error);
  await cleanup(1);
}
