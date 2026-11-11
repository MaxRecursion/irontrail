# IRONTRAIL v3 — "Indie polish at 120 FPS" module contract

Status: authoritative interface contract for the v3 upgrade (3 November 2026). `PLAN.md` holds the
decisions and checklist; `HANDOFF.md` holds verified results. Every module owner implements exactly the
API below so the modules integrate without guesswork. When something here conflicts with older docs,
this file wins for v3 work. Hard gameplay rules from earlier releases are listed in §1 and still apply.

## 0. Goals and budgets

1. Parity with polished indie 2D physics-driving games in look, feel, audio, UX and progression.
2. Smooth at 120 FPS and any refresh rate (60/90/120/144/165/240 Hz):
   - Physics stays fixed at 120 Hz (`STEP = 1/120`); rendering interpolates between the last two physics
     states with `alpha = accumulator / STEP`, so motion is smooth even when display rate ≠ 120 Hz.
   - Steady-state budgets measured with `tests/perf-bench.mjs` (Apple M4, 1600×1000 @ DPR 2, stage 10):
     main-thread total ≤ 1.6 ms/frame (trace `main thread RunTask/frame`), GPU main ≤ 1.0 ms/frame,
     rAF callback p99 ≤ 2.5 ms, zero playing frames > 8.33 ms after the first second.
     At `--throttle 4`: rAF mean ≤ 3 ms and p99 ≤ 8.33 ms. Baseline (v2) for comparison: main 3.3 ms,
     GPU 1.96 ms, ~577 canvas draw ops and ~3600 canvas API calls per frame, first frame 57–97 ms throttled.
   - Canvas budget: ≤ 220 draw ops/frame on stage 10 at High quality (each fill/stroke/drawImage/fillText
     counts as one), no per-frame gradient creation, no `shadowBlur`, ≤ 3 distinct `ctx.font` strings per
     frame, no `matchMedia`/layout reads per frame, no per-frame allocation in hot loops.
   - Adaptive quality: a frame-pacing monitor lowers backing-store resolution and effect density when the
     device cannot hold its refresh rate, and raises them again with hysteresis.
3. Keep the single offline HTML contract (`python3 build.py` inlines everything; `tests/bundle-check.py`).

## 1. Hard rules (unchanged gameplay contract)

- Single self-contained HTML; Planck.js 1.5.0 inline with its MIT license; no CDN/remote fonts/assets.
- Ten stages with rising length, hill/gap severity, zombie density and fuel pressure (`TruckPhysics.STAGES`).
- Fuel drains while playing (idle 35% of rate), cans restore up to 32 points (cap 100); empty tank fails.
- Zombies are real Planck bodies; contact knocks them into a cartoon tumble (no gore, no vocal screams).
- Stage 10 is a race against Iron Maw, an AI truck with its own chassis/wheels/joints, driven only by
  motor torque/balance torque. No position/velocity corrections, no teleporting. First across wins.
- Cannon: exactly ONE charge per attempt; exactly ONE randomly placed large monster per attempt; touching
  it alive or passing it alive fails the run (`'monster'`); the charge is spent even on a miss.
- Checkpoint recovery costs 12 fuel points, keeps ammo/monster/cans/zombies/rival state, never refills.
- Full retry restores fuel 100, cans, zombies, one charge and re-rolls the monster.
- Keyboard + touch controls; per-stage unlocks and best times persist (`irontrail-campaign-v1`).
- Upgrades (new) never change the one-charge rule, can-refill amount or recovery cost.

## 2. Files, ownership and load order

| Module | Global | Owner (wave) | Tests |
| --- | --- | --- | --- |
| `vendor/planck.min.js` | `planck` | — | — |
| `src/physics.js` | `TruckPhysics` | P (1) | `tests/physics-smoke.cjs` |
| `src/audio.js` | `TruckAudio` | A (1) | `tests/audio-check.html` |
| `src/music.js` | `TruckMusic` | A (1) | `tests/audio-check.html` |
| `src/biomes.js` | `IRON_BIOMES` | R (1) | `tests/render-harness.html` |
| `src/rules.js` | `IronRules` | U (1) | `tests/rules-check.cjs` |
| `src/ui.js` | `IronUI` | U (1) | `tests/ui-harness.html` |
| `src/render.js` | `IronRenderer` | R (1) | `tests/render-harness.html` |
| `src/game.js` | (IIFE) `window.irontrail` | main (2) | browser QA, `tests/perf-bench.mjs` |
| `src/shell.html` | markup + CSS | U (1) | `tests/ui-harness.html` |

`build.py` inlines `<!-- VENDOR -->`, `<!-- PHYSICS -->`, `<!-- AUDIO -->`, `<!-- MUSIC -->`, `<!-- BIOMES -->`,
`<!-- RULES -->`, `<!-- UI -->`, `<!-- RENDER -->`, `<!-- GAME -->` in that order (main agent adds RULES/UI).
Every module is a classic script (no ES modules, no imports) that attaches one global to `globalThis`,
uses `'use strict'`, ES2020 syntax, and has no dependencies other than the globals listed above it.
Modules must not touch DOM they do not own: physics/rules are DOM-free (they run in Node); audio/music
touch only Web Audio; render touches only its canvas; ui owns all DOM except the canvas.

## 3. Shared conventions

- Units: metres, seconds, radians; +Y up; trucks face +X. Lean +1 rotates the nose down (clockwise).
- `TruckPhysics.POSE` slot layout, 3 numbers per slot (`x, y, angle`) in a `Float64Array`:
  `PLAYER 0, PLAYER_WHEEL_REAR 1, PLAYER_WHEEL_FRONT 2, RIVAL 3, RIVAL_WHEEL_REAR 4, RIVAL_WHEEL_FRONT 5,
  PROJECTILE 6, ZOMBIES 7` (zombie `i` is slot `7 + i`), `STRIDE 3`. Absent bodies (no rival, no shell in
  flight) are `NaN` in all three numbers. Length is `physics.poseLength === 3 * (7 + zombies.length)`.
  Wheel order everywhere is `[rear (-1.57 m), front (+1.57 m)]`.
- Event objects from `physics.drainEvents()` are plain data with a `type` string (§4.4). Consumers must
  ignore unknown types and unknown fields.
- Colours are CSS strings. Times shown to players use `mm:ss.cc`.

## 4. `src/physics.js` — `TruckPhysics` (owner P)

All v2 API, fields, events and behaviour stay. Additions:

### 4.1 Construction and upgrades
- `new TruckPhysics(stageIndex = 0, options = {})`; `options.random` unchanged; new `options.tuning =
  {engine, tyres, suspension, tank}` integer levels 0..3 (clamped, missing → 0), stored frozen as
  `this.tuning` and applied to the PLAYER truck on every spawn (restart and checkpoint reset).
- `static get UPGRADES()` — frozen effect table shared with rules/UI (index = level):
  `engine: {torque:[1,1.1,1.2,1.3], speed:[1,1.04,1.08,1.12]}`, `tyres: {grip:[1,1.08,1.16,1.24]}`,
  `suspension: {frequencyHz:[4.4,4.6,4.8,5.0], dampingRatio:[.85,.86,.87,.88], airControl:[1,1.15,1.3,1.45]}`,
  `tank: {drain:[1,.93,.86,.79]}`. Player grounded torque `48·torque`, airborne motor torque `7·torque`,
  forward motor speed `34·speed` (reverse 13 unchanged), wheel friction `1.55·grip`, joint spring per table,
  air control strength × `airControl`, fuel drain × `drain`.
- Race balance (v3 refinement): on stage 10 the rival's forward motor speed is
  `34.3 · (1 + 0.035 · tuning.engine)`, and its motor torque scales by
  `1 + 0.06 · tuning.engine`. These fixed pre-race factors keep both base and upgraded trucks competitive;
  they never depend on race position. No position or velocity corrections or rubber-banding.
- All-zero tuning preserves the v2 hard rules; §10's new routes, fuel curve and AI supersede the old course timings.

### 4.2 Pose buffers and interpolation (see §3 layout)
- `poseLength`, `posePrev`, `poseCurr` (`Float64Array`), rebuilt by `restart()`.
- `step()` copies `poseCurr → posePrev` at the start of EVERY call (also early-return calls when failed,
  finished or `dt` is 0, so a frozen world does not drift) and captures `poseCurr` after a simulated step.
- `restart()` and a successful `reset()` capture into BOTH buffers (snap; never interpolate a teleport).
- `interpolatePose(alpha, out)`: clamps alpha to [0,1]; `out` is a caller-owned reused buffer (allocate
  only when omitted); x/y lerp; angle `prev + wrap(curr − prev)·alpha`; a NaN on either side yields curr.
- `getPose(out)` copies `poseCurr`.

### 4.3 Air control, flips and landing quality (player)
- Air control becomes an angular-velocity target while `|lean| > 0.05`: target ω = `−lean · 6.5 rad/s ·
  airControl`, torque `clamp((targetω − ω) · I / 0.22, ±mass·22)`; with `|lean| ≤ 0.05` no torque is applied
  (free rotation exactly as v2). The target uses §10's tuned cap, compensating chassis angular drag while steering.
  The rival keeps its separate balance controller. A held lean from level flight must
  complete one full rotation in ≲ 1.5 s so flips are possible on the bigger jumps.
- While airborne accumulate `airRotation += wrap(angle − lastAngle)` (+ = counter-clockwise = nose up =
  backflip); reset at takeoff. When `|airRotation|` passes `k·2π − 0.45` emit `{type:'flip', dir:'back'|'front',
  count:k, x, y}` once per k.
- `land` keeps its fields and gains `rotation`, `flips` (`floor((|rotation| + 0.45) / 2π)`), `dir`.
  When airtime ≥ 0.45 s, a settled `{type:'landing', airtime, rotation, flips, dir, upright, perfect, bigAir,
  x, y}` follows once both wheels touch or 0.15 s after first contact (whichever first). `upright` =
  `|wrap(angle − slope)| < 0.6`; `perfect` = upright && both wheels touched within 0.12 s &&
  `|wrap(angle − slope)| < 0.26`; `bigAir` = airtime ≥ 1.6 s. Flips only count when upright.
- `this.stats = {flips, perfectLandings, bigAirs, maxAir, airTotal, cans, rivalImpacts}` resets on
  `restart()` and survives `reset()`.
- New event `{type:'checkpoint', index, x, y}` when `checkpointIndex` advances.

### 4.4 `getState()` additions (existing fields unchanged)
`airRotation`, `wheelContact: [rear, front]` booleans, `suspension: [rear, front]` joint translation in m,
`slip` 0..1 (wheel surface speed vs chassis speed, grounded only), `tuning`, `stats` (copies),
`checkpointIndex`, `poseLength`.

### 4.5 Performance (behaviour-neutral)
- Binary-search `_segmentAt`/`_heightAt`/`_slopeAt` over precomputed sorted arrays.
- Zombies more than 45 m from the player chassis get no upright/walk forces and are not woken (they
  sleep); within 45 m they behave exactly as v2.
- `_weaponState()` computed at most once per step (cache invalidated by `fire()`, `reset()`, `restart()`).
- Reuse scratch `Vec2`s for repeated forces; no per-step closures.
- Smoke test prints mean `step()` and `getState()` µs for stage 10 (informational).

### 4.6 Tests to add (`tests/physics-smoke.cjs`)
Pose snap on restart/reset, interpolation midpoint/wrap/NaN, early-return freeze; zero and max tuning
both finish all ten stages at 60 and 120 Hz; max engine is faster than base on stage 1; rival speed scale;
flip events and landing fields in a controlled zero-gravity spin + drop; perfect landing on a controlled
flat drop; stats survive reset and clear on restart; every v2 assertion unchanged.

## 9. Verification plan (all owners)

- `python3 build.py && python3 tests/bundle-check.py` — single-file contract.
- `node --check` every `src/*.js`; `node tests/physics-smoke.cjs`; `node tests/rules-check.cjs`.
- `tests/audio-check.html` in a browser (title becomes `PASS — …`).
- `node tests/perf-bench.mjs --stage 10 --seconds 10 --dpr 2 --trace` and `--throttle 4` against §0.
- Browser QA desktop 1440×900 and phone 390×844 (landscape 844×390 too): title → stage → play → pause →
  results → next; fail paths (fuel, monster, rival); garage purchase; settings persistence; gamepad mapping
  by synthetic `navigator.getGamepads` stub; no console errors.

## 5. `src/biomes.js` + `src/render.js` (owner R)

### 5.1 `IRON_BIOMES` (biomes.js)
Frozen array of ten biome objects, index = stage index, each matching its stage name/theme:
```
{ key, title, timeOfDay,                       // 'morning'|'noon'|'afternoon'|'dusk'|'night'|'storm'
  sky: [top, middle, horizon], haze,           // gradient stops + horizon haze colour
  sun: {kind:'sun'|'moon', color, glow, radius, x, y},   // x/y as 0..1 of the viewport
  stars: 0..1, clouds: {color, alpha, count},
  ridges: [{style, color, shade, height, parallax}, …3],  // far → near; style 'peaks'|'mesa'|'dunes'|'spires'|'ruins'|'industrial'
  ground: {body, top, rim, strata:[4], speckle:[2], grass, chasm:[top, bottom]},
  props: [{kind, weight}], propDensity,        // kinds drawn by render.js (cactus, rock, deadTree, tombstone,
                                               // cross, bones, wreck, drum, fence, ruin, lamp, chimney, …)
  weather: {kind:'none'|'dust'|'embers'|'ash'|'fog'|'fireflies', density},
  light: {headlights:boolean, ambient:0..1, tint, vignette},
  dust, accent }                               // tyre-dust colour; UI accent colour for this stage
```

### 5.2 `IronRenderer` (render.js)
```
const r = new IronRenderer(canvas, {biomes: IRON_BIOMES});
r.setStage(physics, stageIndex)   // build/reuse terrain Path2D chunks, prop layout, biome sprites.
                                  // Call on stage load and on restart (same track → reuse caches).
r.resize(cssWidth, cssHeight)     // backing store = css × renderScale; rebuild screen-sized caches.
r.setQuality({renderScale, particleScale, detail})   // renderScale: absolute backing-store multiplier
                                  // (game passes min(devicePixelRatio, 2) × dynamic factor); particleScale 0..1;
                                  // detail 'high'|'medium'|'low' (weather, props density, extra layers).
r.render(frame)                   // draw one frame (below). Never throws on missing optional fields.
r.onEvent(event, state)           // visual reaction to a physics event (dust, debris, sparks, poofs,
                                  // muzzle flash/smoke, fuel sparkle, monster burst, trauma, zoom punch).
r.popup(text, x, y, style)        // world-space floating text; style 'score'|'trick'|'fuel'|'warn'|'big'
r.addTrauma(amount)               // 0..1 camera trauma (shake ∝ trauma²), decays ~1.4/s
r.flash(color, seconds)           // full-screen additive flash
r.celebrate(kind)                 // 'clear'|'victory' confetti/sparks burst at the truck
r.snapCamera()                    // after restart/recovery/stage load
r.camera                          // {x, y, scale} (read-only snapshot)
r.worldToScreen(x, y, out)        // css-pixel coordinates, for UI markers
r.stats                           // {drawOps, particles, renderMs, spriteBytes, renderScale}
```
`frame` = `{state, pose, alpha, dt, time, mode, input:{throttle, brake, lean}, ghost, layout, settings}`:
`state` = latest `physics.getState()`; `pose` = interpolated pose buffer (§3); `dt` = real seconds since
the previous render (0 while paused so particles freeze); `time` = run clock; `mode` = game mode
(`'title'` uses an attract camera that pans slowly along the track; no truck input); `ghost` = `null` or
`{pose: Float64Array(9), alpha}` (chassis + rear + front wheel); `layout` = `{touch, safeTop, safeBottom}` in
css px (keep the truck clear of HUD/pedals); `settings` = `{shake, reducedMotion}`.

Rendering contract:
- World layer uses `ctx.setTransform(k, 0, 0, −k, ox, oy)` with persistent world-space `Path2D` objects
  for terrain (body, strata, speckles, grass, rim) split into ~30 m chunks and culled to the view.
  Gaps render as ravines (dark gradient + cliff faces), not as holes showing the sky.
- Background: cached sky gradient, sun/moon glow sprite, clouds, three pre-rendered horizontally
  periodic ridge strips per biome (parallax, drawn as 2 `drawImage`s each), haze/fog bands, stars at night.
- Sprites: offscreen canvases rendered at `pxPerMetre = scale × renderScale`, rebuilt when that changes
  by > 6 %. Trucks (player + rival body, cab, decals baked), wheels (+ motion-blurred variant above
  ~18 rad/s), cannon, fuel can + glow, zombie variants × walk-cycle frames, monster, flags, signs,
  props, particles. Text in the world is baked into sprites (≤ 3 `ctx.font` strings per frame).
- Coilovers are drawn from interpolated chassis/wheel poses; brake lights glow while braking;
  headlights cone at night biomes; cannon recoils on `shot`; projectile tracer + glow.
- Pooled particles in typed arrays (≤ 600 at High, scaled by `particleScale`), no per-frame allocation:
  tyre dust (biome `dust`, by speed/slip), landing bursts + debris, exhaust smoke with throttle, sparks
  on truck impacts and monster hit, zombie hit poof + cartoon stars, fuel sparkle, weather particles.
- Camera: frame-rate-independent critically damped follow on the interpolated chassis, velocity
  look-ahead ≈ 0.35 s·vx clamped to [−3, 7] m, keeps the truck in the safe area, zoom out ≤ 12 % with
  speed and ≤ 8 % more while airborne > 0.4 s, trauma shake from smooth noise (off when `settings.shake`
  is false), small zoom punch on big events.
- Screen-space: off-screen indicators (rival, monster with distance), speed lines > 75 km/h, vignette,
  flash, ghost truck at 35 % alpha.
- No DOM access besides the canvas; no `matchMedia`, `getBoundingClientRect` or layout reads per frame.
- `tests/render-harness.html` loads planck, physics, biomes, render directly from `../src` / `../vendor`,
  drives a scripted run with fixed-step + interpolation, cycles all ten biomes (`?stage=N`), shows stats,
  and is compatible with `tests/perf-bench.mjs` (`window.irontrail = {mode, telemetry}`, `#playButton`).

## 6. `src/audio.js` + `src/music.js` (owner A)

- Keep every v2 `TruckAudio` method and its gating semantics (mute/pause → exact silence, pending voices
  cancelled on pause, safe before `unlock()`, cooldowns, no clipping).
- Buses: `engineBus`, `sfxBus`, `musicBus` → `master` → limiter → destination.
  `setVolumes({master, music, sfx})` (0..1, default 0.9 / 0.55 / 0.9) works before and after unlock.
- `update(state, dt, input)` — `input = {throttle, brake}` (falls back to `state.throttle`); no object
  spread needed by callers. Automation writes are rate-limited (≤ 60 Hz) and skipped when the change is
  negligible, so render rate (120–240 Hz) does not multiply audio work.
- New continuous layers inside `update`: tyre skid (from `state.slip`), suspension creak on hard
  compression (from `state.suspension` deltas), throttle-lift backfire pops at high RPM, wind by airtime.
- New one-shots: `flip(count)`, `landing(strength, {perfect})` (existing signature + option),
  `perfect()`, `combo(n)`, `scoreTick()`, `star(index)`, `checkpoint()`, `lowFuel()`, `countdown(n)`, `go()`,
  `ui(kind)` with kind `'move'|'confirm'|'back'|'buy'|'error'`, `celebrate()`; all cooldown-guarded.
- Music (`TruckMusic`, music.js), created by `TruckAudio` on unlock with `(context, musicBus)`:
  lookahead scheduler (timer ≈ 25 ms, schedule ≈ 0.12 s ahead on `context.currentTime`), fully synthesized
  drums/bass/pad/lead, per-biome tempo/key/pattern variants, intensity layers 0..1, moods
  `'menu'|'drive'|'boss'|'danger'|'results'`, short stingers for clear/fail. Engine stays the hero: music
  ducks under big SFX and sits low in the mix.
  `audio.setMusicState({biome, intensity, mood, playing, timeScale})` (cheap; game calls it ≤ 10 Hz).
  Music volume 0 or mute → the scheduler stops creating nodes. Pause → menu mood (quiet) or silence per
  the pause gate. No vocals.
- `tests/audio-check.html`: extend for every new cue (audible, finite, < 0.95 peak), stacked worst case,
  music rendered offline for each mood (finite, below clipping, non-silent), volume 0 silence,
  mute/pause exact silence, pre-unlock safety.

## 7. `src/rules.js`, `src/ui.js`, `src/shell.html` (owner U)

### 7.1 `IronRules` (rules.js, DOM-free, Node-testable)
- `PAR_TIMES` (s) per stage, used for ★2. `CHALLENGES[i] = {id, label, check(result)}` for ★3 (one
  readable objective per stage, e.g. clear every zombie, collect every can, no recovery, land a flip,
  finish with ≥ X % fuel, beat Iron Maw by ≥ 15 m). ★1 = finish.
- Scoring: `createRun(stageIndex)`, `onEvent(run, event, ctx)` → `{points, label, kind, combo}` or null
  (zombie hits chain into a combo multiplier with a decay timer; flips, perfect landings, big air,
  monster kill, rival bumps score), `tick(run, dt)`, `finish(run, summary)` →
  `{score, breakdown:[{label, value}], stars:[bool×3], newStars, challenge, scrap}`.
  `summary = {time, fuel, won, recoveries, cleared, totalZombies, cans, totalCans, stats, rivalGap}`.
- Economy: scrap earned from score (+ first-time star bonuses; partial scrap on failure),
  `UPGRADE_COSTS`, `upgradeCost(track, level)`, labels/descriptions built from `TruckPhysics.UPGRADES`
  when present (rules must not require physics in Node tests — pass the table in or duplicate labels).
- `Save`: `defaults()`, `load(storage)`, `save(storage, data)`, `migrate(raw)` for key
  `irontrail-campaign-v1` (keeps v2 `unlocked, completed, best, selected`; adds `version:3, stars, bestScore,
  scrap, upgrades, settings{music, sfx, quality, shake, showFps, reducedMotion}, totals`). Tolerates
  corrupt/missing data and throwing storage. Ghosts live in `irontrail-ghost-v1-<stage>` (owned by game.js).
- `tests/rules-check.cjs` covers scoring, combo decay, stars, challenges, scrap, costs, migration.

### 7.2 `IronUI` (ui.js) + shell.html
- Full-viewport game: `#app` fills the window; the canvas `#gameCanvas` fills `#app`; no marketing
  header/footer/details. Screens are overlays inside `#app`: title (attract mode behind it), stage select
  (10 cards with stars/best/lock and biome accent), garage (4 upgrade tracks, levels, costs, scrap),
  settings, brief (stage intro: name, length, par, ★3 objective, best, start), pause, results (animated
  stars, time vs par, score breakdown, scrap, new-best badges, next/retry/garage/stages), failed
  (reason-specific tip). Keyboard/gamepad navigable, focus-visible styles, aria labels.
- HUD (hidden outside play): top-left stage + progress bar with checkpoint ticks, monster marker (until
  cleared) and rival marker; top-right run time, score, ghost delta; bottom-left fuel gauge + zombies;
  bottom-right speed/gear/RPM; contextual cannon pill (ammo, LOCKED state, distance); combo meter;
  toast + big banner area; FPS overlay (optional). Phone: compact HUD, large touch controls
  (lean ↶/↷ left, brake/reverse + gas right, FIRE separate), recover button when stuck.
- HUD performance: cache elements once; write text/classes only when a value changes; bars use
  `transform: scaleX()` (no width transitions); containers use `contain: layout paint style`; no
  `backdrop-filter` over the live canvas; menu transitions animate opacity/transform only.
- API (game.js consumes it; events are emitted, never call game code directly):
```
const ui = new IronUI(document);
ui.on(name, fn)   // 'play','selectStage'(i),'retry','next','resume','pause','title','stages','garage',
                  // 'buy'(track),'settings','setting'(key,value),'fire','recover','restart','sound',
                  // 'fullscreen','back'
ui.showScreen(name, data)   // 'title'|'stages'|'garage'|'settings'|'brief'|'pause'|'results'|'failed'|null
ui.setCampaign(save, stages, biomes, rulesInfo)
ui.hud.setVisible(bool); ui.hud.update(view)   // view fields listed in ui.js header; write-on-change
ui.toast(text, seconds, style); ui.banner(text, style, seconds); ui.setRecoverVisible(bool)
ui.setFps(statsOrNull); ui.setTouchMode(bool); ui.metrics()   // {safeTop, safeBottom} (cached on resize)
ui.pedals    // elements with data-input = gas|reverse|brake|left|right (game wires pointer events)
```
- Keep IDs `gameCanvas`, `playButton` (primary action of the visible screen), `fireButton`,
  `recoverButton`, `pauseButton`, `soundButton`, `fullscreenButton`, `restartButton`.
- `tests/ui-harness.html` loads rules.js + ui.js with the real shell markup and fake data; exercises every
  screen and HUD state.

## 8. `src/game.js` (wave 2, main agent)

- Loop: rAF, `dt = clamp(now − last, 0, 0.1 s)`; hit-stop/slow-motion scale; fixed `STEP` steps
  (max 8 per frame, backlog dropped beyond); `alpha = accumulator / STEP`; `physics.interpolatePose(alpha,
  poseBuffer)`; `renderer.render(frame)`; `ui.hud.update(view)`; audio `update` + `setMusicState`.
- Input: keyboard (v2 keys + Enter/Escape for menus), touch pedals, Gamepad API (RT/LT analog throttle
  and brake/reverse, left stick/d-pad lean, A fire, X recover, Y retry, Start pause, B back).
- Events: each physics event → `audio`, `renderer.onEvent`, `IronRules.onEvent` (popups/combos via
  renderer.popup + ui.banner/toast).
- Frame-pacing monitor: estimate refresh rate from rAF intervals; if > 10 % of frames miss their vsync
  interval for 2 s, lower quality (renderScale steps 1.0→0.85→0.72→0.6 of the device cap, then particles,
  then detail); raise again after 8 s of headroom; user setting `quality` = auto|high|balanced|performance.
- Ghost: record player pose at 20 Hz; save quantized on a new best time; replay as `frame.ghost`.
- Diagnostics: `window.irontrail` read-only getters (v2 fields) plus `perf` {fps, refreshHz, renderScale,
  quality, cpuMs, drawOps, trace()} where `trace()` returns the last ≤ 600 frames as
  `[tMs, renderedChassisX, alpha, steps, cpuMs]` (used by `tests/pacing-check.cjs` to prove interpolation
  keeps on-screen velocity steady under irregular frame intervals), and `qa.start(stageIndex)` which
  starts a stage immediately (tests only; never alters saves beyond normal play).


## 10. Amendments from the v2 analysis (ANALYSIS.md) — binding for all owners

### Physics (P)
- **Grounded vs inverted:** a vehicle whose chassis touches the ground counts as NOT airborne (no airtime
  growth, no takeoff/land events, no air-control) — fixes the roof state. Add `state.inverted` (|wrapped
  angle| > 1.75 rad while touching ground) and `state.stalledTime` (seconds with throttle applied and
  |vx| < 0.6 m/s while not airborne); game shows the recover button when flipped, fallen or stalled > 2.5 s.
- **Self-righting:** when a truck is inverted, nearly still (< 2.5 m/s) and touching ground, a righting
  torque toward upright (up to mass × 30, measured at about 1.6–1.8 s from a flat roof fixture) applies — always for Iron Maw,
  and for the player only while they hold lean in either direction. Torque-only; never position changes.
  Once started, righting continues through the side contact until upright, with wheel motors released so
  they do not oppose the chassis torque. Releasing player lean stops this assistance.
- **JIT warm-up:** `static warmUp(milliseconds = 60)` builds a throwaway stage-1 world and steps it so
  Planck's hot paths are compiled before the first real run (game calls it during the title screen).
- **Track generator v3:** deterministic per stage, built from a feature grammar instead of one repeated
  pattern: run-ups, rollers, hills, climbs (≤ 30° early, ≤ 36° late), drops (≤ 4 m), table-tops, and
  kickers (14–28°) — at least one flip-capable kicker (22–28°, followed by a long flat or downslope landing)
  from stage 3 on, optional rather than mandatory where possible. Keep: gaps as separate chains with
  stage-scaled `gapWidth`, checkpoints on flat aprons after gaps, flat monster zones in the 65 m/38 m window,
  can positions reachable on the hold-throttle line (cans never sit where that line flies > 2.5 m above them),
  zombies on walkable ground. Stage length/difficulty fields stay monotonic.
- **Fuel curve:** retune `fuelDrain` (and can interval if needed, can value stays 32, cap 100) so the
  hold-throttle bot's minimum fuel declines smoothly from ~70 % (stage 1) to ~25–30 % (stages 9–10), every
  stage's terrain and fuel supply stay finishable at 60 % throttle, and no single missed can is fatal
  before stage 9. Stage-10's 60 %-throttle viability fixture omits the rival: winning the competitive race
  still requires faster driving. Drain keeps the exact linear rule
  `fuelDrain · tankMultiplier · (0.35 + 0.65 · |throttle|) · dt`. Monotonic full-throttle fuel pressure.
- **Iron Maw AI:** competent-driver behaviours via torque/throttle only — lifts throttle before ramp lips
  to avoid over-rotation, balances toward the landing slope in the air, self-rights when inverted. Tune its
  motor speed so a clean hold-throttle player wins by a modest margin (~3–15 m, both 60 and 120 Hz), a
  checkpoint recovery or a bad landing usually loses the race, and lead changes happen. Still no position or
  velocity corrections and no rubber-banding. Starting gap stays 6 m behind.
- **Air control:** velocity-target model from §4.3 (cap ≈ 6.5 rad/s × airControl, gain tuned; free
  rotation with no lean input). The rival keeps its own balance controller.

### Renderer (R)
- GPU lessons: draw terrain with persistent world-space `Path2D` FILLS (strata as filled ribbons, grass as
  filled blades, rim as a filled strip) — avoid per-frame `clip()` with complex paths and long round-join
  strokes; never create large canvases during play (build every sprite/strip in `setStage`/`resize`, or in
  small idle-time batches before they are needed); prefer `createPattern` textures anchored to world space.
  Verify with `--trace`: GPU main ≤ 1.0 ms/frame.
- Readability: every gameplay object gets a dark outline (≈ 0.06 m, biome `outline` colour); the player
  truck uses a signature paint chosen to keep ≥ 3:1 contrast against each biome's sky and nearest ridge
  (amber/mustard family suggested, e.g. `#d9a13b` with dark trim), Iron Maw stays rust-red with menace.
- Snap the camera translation to whole device pixels after interpolation (removes sub-pixel shimmer).
- Zombie variants are visual only (physics bodies unchanged); keep cartoon/non-graphic.

### Audio (A)
- **Suspended-context bug:** never schedule automation unless `context.state === 'running'`; when
  suspended or throttled, keep internal targets and apply them on resume. Rate-limit updates (≤ 60 Hz).
- Use `automationRate = 'k-rate'` for params that do not need sample accuracy (filters, layer gains).
- Music: persistent synth voices (oscillator + filter + gain per part, re-triggered by automation) and
  buffer-source drums; never build a node graph per note for sustained parts.
- Engine: add upper harmonic / intake content so idle is audible on phone speakers; increase saturator
  drive for grit while keeping peak < 0.5 for the engine alone.
- Create the AudioContext on the FIRST user gesture anywhere (pointerdown/keydown on the page), not on
  "Start", so starting a run never builds the graph (game wires this; audio exposes `prime()` = unlock).

### UI (U) and game (main)
- The recover button has its own reserved slot that no HUD panel or pedal can overlap (desktop + phone).
- Show recover when flipped > 1.2 s, fallen, inverted, or stalled > 2.5 s (from `state.stalledTime`).
- No width transitions; bars use `transform: scaleX`; HUD writes only on change.
- During the title screen: `TruckPhysics.warmUp()`, renderer sprite builds, and audio priming on the first
  gesture, so the first run starts without a hitch (first playing frame < 8.33 ms at 1× CPU).


## 11. Final validation scope (3 November 2026)

The implementation and supported functional checks are complete; `HANDOFF.md` records exact results. The §0 CPU/GPU
trace and4×CPU targets remain targets, not certified results. This agent used supported browser controls and
self-running harness pages, not the optional raw-CDP runners. Callback timing includes game-loop work but does not
measure the full renderer-process main-thread/GPU trace. The available browser displays at about60Hz; physics and
interpolation are checked independently through240Hz display sampling. The integration harness can request
`?phase=boss&dpr=2` to build an actual3200×2000canvas inside a1600×1000CSSviewport; it labels this as an appDPR override,
separate from native displayDPR.

The amber truck uses a dark outline and was visually checked in the biomes. A literal3:1 fill ratio against every
stop of every sky gradient is not satisfied; this visual check concerns the outlined composite object. No blanket
claim of all-stop fill contrast or universal120FPS is made. Hardware refresh/controller/mobile/audio listening and
full trace budgets remain documented verification limits.


## 12. Sound pass (3 November 2026)

Original eight-bar “Deadland Run” replaces the sparse score; nine persistent melodic/percussive voices and32bounded live drum sources. Music volume is applied once by musicBus. Slow motion eases the music lowpass/tempo and engine pitch. Engine focus gain supplies brief cannon ducking before master/limiter. Event sound sources cap96 and disconnect onended, including stereo panners. Physics callbacks call setScene(state,event), dispatch the cue, then reset the event position so UI cues stay centered. Flight wind includes vertical velocity; landings/collisions retain strength scaling. All new layers preserve existing mute/pause/zero-volume, cooldown and pre-unlock guards. Expanded browser checks cover the complete score, integrated mix, proportional volume, wind, stereo and voice disposal.


## 13. Impact emphasis (4 November 2026)

Cannon and collision audio add midrange impact harmonics and stronger transients/tails. Engine/music duck envelopes preserve the deepest active attenuation through overlapping events. Camera trauma amplitude uses14CSSpixels at full strength (previously7), and remains gated by Camera Shake/Reduced Motion. Muzzle flash and recoil are stronger, with particles still capped by the existing renderer budget. Gameplay physics, one-charge rule and refresh scheduling are unchanged.


## 14. Ojas’s edition (4 November 2026)

Parent-directed personalization replaces the amber signature with red/black OJAS-01 across every biome, with white web/spider details and outline contrast. The UI adds a dedication screen/event routed through existing navigation, an animated vector title showcase and personal trophy/result messages. Stage1 display name becomes Ojas Speedway; numerical stage IDs, track geometry, tuning, storage and gameplay contracts stay the same. The new dedication is revisitable via the heart button, and Reduced Motion disables title/trophy animations. This personalization supersedes earlier amber-paint/old-title wording.


## 15. Redline pass (v4, 11 November 2026) — speed, nitro, impact and spectacle

Goal: raise IRONTRAIL to the production values of a top-tier arcade-racing studio: a relentless sense of speed,
a risk→reward boost loop, impacts and wrecks staged as spectacle, the engine and mix as the hero, constant kinetic
reward feedback, zero-friction flow and a locked frame budget. Every mechanic, name and asset is original to
IRONTRAIL (NITRO, SMASH, SLAM, WRECKED); nothing is copied from another game. §1 hard rules, §0 budgets, the
single-file contract, Ojas's red/black edition, saves and the kid-friendly, non-graphic tone all stay.

### 15.0 Ground rules for every owner
- **Additive and baseline-neutral.** With `input.boost` never set, vehicle dynamics, fuel, rules, existing events
  and results are bit-identical to v3: no new Planck bodies/fixtures/joints, no extra `options.random` draws, the
  same joint calls with the same values in the same order. Every existing assertion in the suite keeps passing
  unmodified; new behaviour gets new assertions.
- Shared signature colours: nitro `#4fd6ff` (hot core `#eafcff`, deep `#1f8fff`); fuel stays amber; brand red/black.
- `settings.reducedMotion` disables slow motion, letterbox, afterimages, speed streaks, screen flashes and camera
  kicks. `settings.shake === false` disables shake and kicks only. Flashes stay mild: no strobing, at most one
  screen flash per 250 ms, never a full-screen inversion.
- Missing/unknown optional fields never throw (older fixtures and harnesses pass partial data).
- Ownership — P: `src/physics.js`, `tests/physics-smoke.cjs`. R: `src/render.js`, `src/biomes.js`,
  `tests/render-check.cjs`, `tests/render-harness.html`. A: `src/audio.js`, `src/music.js`, `tests/audio-check.html`,
  `tests/audio-live-check.html`. U: `src/ui.js`, `src/shell.html`, `src/rules.js`, `tests/ui-harness.html`,
  `tests/rules-check.cjs`. Main: `src/game.js`, `build.py`, docs, `tests/pacing-check.cjs`, `tests/shot-check.cjs`,
  `tests/integration-harness.html`, fixtures, generated `index.html`/`dist/`. Never edit another owner's files and
  never run `build.py` (main builds).

### 15.1 Physics (P)
**Input.** `step(dt, input)` reads `input.boost` (truthy = hold nitro).

**Constants.** `static get NITRO()` — frozen: `{max:100, start:25, engage:8, drain:30, torque:1.75, speed:1.32,
thrustGround:9, thrustAir:5, gain:{airPerSecond:7, airDelay:.25, landing:4, perfect:10, flip:16, bigAir:6, zombie:4,
smash:1.5, checkpoint:8, monster:35, slipstreamPerSecond:6, slam:25}}`. P may retune the numbers by simulation
(targets below) but keeps the keys. `RIVAL_TUNING` gains `nitroPower` (0..1 scale of the rival's nitro effect),
`nitroBurnAt` (meter level at which it lights, default 40), `stun` (seconds, default 1.1), `slamStrength`
(minimum collision strength, default .35), `slamCooldown` (default 4).

**Nitro (per vehicle).** `vehicle.nitro` 0..max; the player's meter starts at `start` on `restart()` and survives
checkpoint `reset()`. Burn: `wants = input.boost && throttle >= -0.05 && !brake`; a burn starts when `wants` and
`nitro >= engage`, and ends when `!wants`, the meter hits 0, or the run ends. While burning: meter −`drain`/s;
effective throttle = max(throttle, 1) for BOTH the motor and the unchanged fuel formula; wheel motor torque ×`torque`
and motor speed ×`speed`; plus a forward thrust force at the chassis centre along the chassis +X axis of
`totalVehicleMass × thrustGround` (grounded) or `× thrustAir` (airborne). No boost while self-righting or inverted.
Gains (clamped to max; all apply whether or not burning): airtime `airPerSecond`·dt once airtime > `airDelay`;
settled `landing` event: upright `landing`, perfect +`perfect`, each landed flip +`flip`, bigAir +`bigAir`; zombie
knockdown `zombie`; breakable `smash`; checkpoint `checkpoint`; `monsterHit` `monster`; slipstream
`slipstreamPerSecond`·strength·dt; nitro slam `slam`. `grantNitro(amount)` adds a game-level bonus (clamped; no-op
after the run ends; returns the new level).
Tuning targets (measure with bots, 60 and 120 Hz, zero and max upgrades): nitro top speed ≥ 1.25× base; an
always-hold-boost bot that fires at lock finishes every stage, 10–22 % faster than the no-boost bot, never fails
because of nitro (no gap/landing/monster/fuel regressions), and has boost uptime of roughly 25–45 % of the run.

**Iron Maw escalation (stage 10).** The rival earns nitro at all times by the same airtime/landing rules, but
burns it only after the player's FIRST burn of the attempt (`{type:'escalate', x, y}` fires once). It never reads
the player's position, speed or gap. Burn rule: escalated, grounded, upright, not righting, not stunned, not in
the ramp-lift window, meter ≥ `nitroBurnAt` → burn until empty/airborne-inverted/stunned. Same multipliers scaled
by `nitroPower`. Targets: without player boost the race is bit-identical to v3; with an always-boost player and an
escalated rival a clean run wins by about 3–20 m at 60 and 120 Hz for base and max upgrades, and a sloppy run
(one recovery) can still lose.

**Nitro slam.** When the existing vehicle↔vehicle `collision` is emitted with strength ≥ `slamStrength`, the
player burned nitro within the last 0.4 s, the rival is not already stunned and `slamCooldown` has elapsed: the
rival is stunned for `stun` seconds (throttle 0, balance lean 0, no burn; self-righting still works), the player
gains `slam` nitro, `stats.slams++`, and `{type:'slam', x, y, strength}` follows the `collision` event.

**Slipstream.** Player grounded, rival chassis 2–10 m ahead, |Δy| < 3 m → `state.slipstream` 0..1 (1 between
3 and 7 m, linear fade at the edges), meter +`slipstreamPerSecond`·slipstream·dt. No force.

**Zombie punt.** On knockdown replace the fixed nudge with a launch proportional to the hitting vehicle's speed
(cosmetic only: a hit zombie already collides with terrain only, so the truck is unaffected). The `zombie` event
gains `vx` (vehicle speed) and `boosted` (bool).

**Breakables.** `physics.breakables = [{id, x, y, variant (0..7), broken, active}]`, deterministic per stage from a
local integer hash (never `this.random`), no Planck bodies. Placement: on walkable ground with |slope| < 0.25,
≥ 6 m from chain ends, ≥ 5 m from fuel cans, ≥ 8 m from checkpoints, ≥ 2.5 m from zombie spawns, x within
`[startX+18, finishX−12]`, typical spacing 9–15 m (denser on later stages, 8–40 per stage). `restart()` clears
`broken` and sets `active=false` within 7 m of this attempt's monster; `reset()` keeps `broken`. A vehicle chassis
within 1.6 m horizontally and < 2.2 m above the ground at the prop breaks it: `{type:'smash', id, variant,
owner:'player'|'rival', x, y, strength}` (strength = clamp(|vx|/25, .2, 1)); player smashes add `stats.smashes`
and nitro.

**Wreck events.** `{type:'wreck', kind:'roof', x, y, strength}` when the player becomes inverted-on-ground
(cooldown 1.5 s); `{type:'wreck', kind:'fall', x, y, strength:1}` once when the player drops below y = −3 (re-armed
by a spawn).

**Terminal coast.** `coast(dt)` returns false unless `failed` or `winner` is set. Otherwise it copies
`poseCurr → posePrev`, steps the world with no rules (no fuel, nitro, pickups, checkpoints, monster, finish, stats or
score events): player throttle 0 with brake when `winner === 'player'` or `failed === 'fuel'`, free-rolling
otherwise; the rival keeps its controller until it has crossed the finish, then brakes. `land`/`collision` events may
still be emitted for presentation. `step()` keeps its exact terminal freeze.

**State and stats.** `getState()` adds `nitro`, `boosting`, `boostTime` (s of the current burn), `nitroReady`
(meter ≥ engage), `slipstream`, `escalated`; each vehicle snapshot (player and `state.rival`) adds `nitro`,
`boosting`, `stunned` (seconds left). `stats` adds `smashes`, `slams`, `topSpeed` (m/s), `nitroBurned`, `nitroEarned`.
Nitro events: `{type:'nitro', phase:'start'|'end'|'full', owner:'player'|'rival', empty?:bool, x, y}` (`full` fires
when the player's meter reaches max from below).

**Tests to add.** Baseline digest equality (capture v3 numbers before editing: final time/x/fuel/cleared for
stages 1, 5 and 10 at 60 and 120 Hz with no boost, and assert them exactly); body/joint counts unchanged; nitro
engage/drain/gain/clamp/reset/restart rules; top-speed ratio; always-boost bots finish all ten stages at both rates
and upgrade levels; escalation only after the player's first burn and never position-dependent; boosted boss
margins; slam stun/cooldown; slipstream accrual; breakable determinism/reset/restart/monster clearance/smash events
for both owners; wreck events; coast semantics; `grantNitro`.

### 15.2 Renderer (R)
Reads the new state (`boosting`, `nitro`, `boostTime`, `slipstream`, `rival.boosting`, `rival.stunned`),
`physics.breakables`, the new events and `frame.cinema = {kind:'idle'|'slam'|'wreck'|'finish'|'fail', bars:0..1,
zoom:0..1, progress:0..1}` (optional; `bars` already includes the cannon shot). All of it inside §0: ≤ 220 draw ops
on stage 10 at High in the worst case (both trucks burning, slipstream, letterbox, full particles), ≤ 3 `ctx.font`
strings per frame (the current three), no per-frame gradients/canvases/allocations, no DOM/layout reads.
- **Speed.** Velocity streaks as ONE batched stroke (plus one tinted batch while burning) whose length/alpha follow
  speed; a pre-rendered periodic foreground silhouette strip (parallax > 1, bottom edge only, alpha by speed, two
  `drawImage`s) that whips past; stronger speed zoom-out and look-ahead; camera lag + zoom kick when a burn starts
  and a low rumble while it lasts.
- **Nitro.** Additive exhaust flame sprites with flicker and a ground glow for the player and the rival, cyan
  ember trail, up to two chassis afterimages, a cached warm/cool edge vignette pulse, small X stretch of the truck.
- **Impact.** Directional camera kicks (landing, shot recoil, slam, wreck), landing dust ring, sparks on
  slam/wreck, stronger giant defeat (double shock ring, chunky debris), breathing idle for the giant.
- **Cinema.** Letterbox bars from `frame.cinema.bars` (≤ 9 % of the height each, ≤ 6 % in touch layout) and extra
  push-in from `frame.cinema.zoom` during slam/wreck/finish/fail; `frame.mode` stays `'playing'` during outros.
- **Breakables.** Sprites per `variant` from the biome's small props (plus new crate/barrel/cone art), drawn in
  front of the terrain like signs; decorative props within 2.5 m are dropped; `smash` spawns debris/dust by variant;
  broken or inactive props are not drawn.
- **Slipstream.** A few flowing lines from the rival to the player while `state.slipstream > 0` (one stroke).
- `onEvent` handles `nitro`, `escalate`, `smash`, `slam`, `wreck` (unknown types still ignored); `popup` gains style
  `'nitro'`. `tests/render-check.cjs` gains a worst-case Redline scenario and reduced-motion/shake-off assertions.

### 15.3 Audio (A)
Same gates as §6/§12/§13 (mute/pause exact silence, pre-unlock safety, cooldowns, ≤ 96 event sources, k-rate
≤ 60 Hz automation, no growth while suspended, no clipping).
- `update(state, dt, input)` drives persistent nitro layers from `state.boosting`/`state.boostTime`/`state.nitro`
  (jet noise + afterburner tone + sub, pitch rising through the burn, engine pitch/intake lift), slipstream wind
  from `state.slipstream`, and a quieter rival burn from `state.rival.boosting`.
- Engine as the hero: detuned second combustion voice, RPM-swept exhaust resonance, throttle-on bark, turbo spool
  whine with blow-off on lift/shift, lift-off crackle, airborne limiter flutter. Engine alone stays < 0.5 peak.
- One-shots (cooldown-guarded, pan via `setScene`): `nitro(phase, {owner, empty})` (ignition whump + rising sweep /
  blow-off + crackle / full chime), `escalate()`, `smash(strength, variant)` (wood, metal, stone timbres),
  `slam(strength)`, `wreck(strength, kind)`, `whoosh(strength)`, `stall()` (fuel-out sputter), `finishLine(won)`
  (crossing hit before `result`), plus the existing set. `scoreTick()`/`star()` stay available for results count-up.
- `setMusicState` accepts `boost` 0..1 and `tension` 0..1: the score adds a driving sixteenth layer, octave lead
  and opens its filter with `boost`; `tension` (boss proximity/low fuel) tightens it. `music.hit(kind)` plays short
  stingers for `'slam'`/`'finish'`. `tests/audio-check.html` covers every new cue and layer, stacked worst case,
  silence gates and the suspended-context bound.

### 15.4 UI and rules (U)
- HUD view additions (all optional, write-on-change): `nitro` 0..100, `boosting`, `nitroReady`, `nitroHint` (short
  string such as `Z / N` or `RB`, empty on touch), `slipstream` 0..1, `gap` (metres ahead of Iron Maw, or null).
- NITRO meter (`#nitroHud`, `#nitroFill`, `#nitroHint`) joined to the speed cluster: transform bar, states
  `ready`/`burning`/`full`/`empty`; boss gap badge `#hudGap`; a larger chain multiplier. Touch layout adds a
  `data-input="nitro"` pedal (hit area ≥ 56 px, no overlap with other controls or the recover slot at 390×844
  and 844×390).
- `ui.award(kind, {label, value})`: kinetic award slabs (pooled nodes, at most three stacked, icon + one or two
  words + number, transform/opacity animation only, cleared by `clearFeedback()`); kinds `perfect`, `flip`, `air`,
  `smash`, `chain`, `slam`, `nitro`, `giant`, `checkpoint`, `wreck`, `start`. Existing `cue`/`toast`/`banner` stay.
- Results: `data.awards = [{id, label, value}]` row and a count-up of the score rows driven by `ui.tick(dt)`,
  emitting `ui.emit('sfx', 'tick'|'stamp')` for audio; reduced motion shows final values at once.
- Settings add `haptics` (default true, "Controller vibration") and `autoNitro` (default false, "Auto nitro");
  brief/title hints mention nitro.
- Rules: `smash` (player only) +25 × chain multiplier, joins and refreshes the combo chain (bucket "Roadside
  smashes"); `slam` +500 (bucket "Nitro slams"); finish adds "Nitro burn" = floor(stats.nitroBurned) × 2;
  `finish()` returns `awards` built from `summary.stats` (`topSpeed` in km/h, `maxAir`, best chain, smashes, slams,
  nitro burned); `Save.defaults()/migrate()` carry `settings.haptics`, `settings.autoNitro` and `totals.smashes`,
  `totals.slams`; `recordResult` accumulates them. No change to stars, pars, challenges, upgrade costs or keys.

### 15.5 Runtime (main)
- Input: nitro on `Z`, `N` or Shift, gamepad RB/LB, touch pedal; optional auto-nitro; keys held through the
  countdown count at GO; a throttle press within 0.25 s of GO earns a rocket-start nitro bonus.
- `ImpactDirector` (pure, exported for Node tests): real-time envelopes for `slam`, `wreck`, `finish` and `fail`
  giving `{kind, timeScale, bars, zoom, progress}`; the world time scale is the minimum of the shot and impact
  envelopes; reduced motion pins it to 1.
- Outro: when the run ends the result is computed and saved immediately, then the world coasts through
  `physics.coast()` under the finish/fail envelope (≤ 1.5 s, skippable, skipped with reduced motion) before the
  results/failed screen; `irontrail.mode` stays `playing` until the screen appears and the run clock stops at the
  terminal step.
- Hit-stop on heavy hits, gamepad dual-rumble haptics (setting), pass-by whooshes, a snappier countdown and
  instant retry, HUD/award/music wiring for every new event.


### 15.6 As shipped (supersedes the draft numbers above)

The values in 15.1 were the design draft. Tuning against always-boost bots settled on these, which `src/physics.js` and `tests/physics-smoke.cjs` now hold:

- `NITRO`: `start 25`, `engage 8`, `drain 34`, `torque 1.6`, `speed 1.27`, `thrustGround 5`, `thrustAir 3`. Gains: air `4/s` after `0.25 s` (none while burning), landing `3`, perfect `8`, flip `14`, big air `5`, zombie `3`, smash `1`, checkpoint `6`, giant `30`, slipstream `6/s`, slam `25`, rival trickle `8/s`.
- Rival: `nitroPower 0.95`, `nitroBurnAt 40`, `stun 1.1 s`, `slamStrength 0.35`, `slamCooldown 4 s`.
- Nitro raises wheel torque and speed only while grounded; in the air it adds thrust alone, so a burn cannot flip the truck.
- The zombie punt is drawn by the renderer from `zombie.punt`; the physics body keeps the original nudge. Moving the body broke bit-identity with the v3 recordings.
- Engine extras in 15.3 (second combustion voice, turbo whine, limiter flutter) were not built.

## 16. Picture interface completion (11 November 2026)

The Redline game uses pictograms, numbers and colour for gameplay feedback, briefing goals, garage upgrades, retry tips and results. Title/dedication/settings and route names may retain words. Controls and feedback retain descriptive accessible names; hidden copy preserves stage, pause and scoring information. Renderer popups use cached pictogram sprites, bounded to the existing pool, with no new hot-path canvases or gradients.

HUD additions are optional and write only changed values: `par` (seconds), `goal` (current challenge boolean) and `goalId` (the existing rules challenge ID). The clock star remains eligible at exactly par (`time <= par`), matching the final scoring rule. Objective status uses the same recovery count, fuel, collection totals, landing stats and boss gap as `Rules.finish`; it is provisional until the player finishes. Retry and route changes reset it.

`IronUI.setInputMode('keyboard'|'touch'|'gamepad')` changes briefing and retry control hints. Runtime synchronizes it with the connected pad and touch layout; hints must not change the underlying input bindings. Touch driving/FIRE targets are at least 44 CSS px in both axes, nitro is at least 56 px, and no pedal overlaps another or the reserved recovery slot in the checked portrait/landscape sizes.

Both in-app Reduced Motion and the OS animation preference show award badges statically instead of hiding them. Score details remain reachable with Tab/menu navigation and open with Enter, Space or gamepad A. Results count-up is bounded, reaches exact totals once and shows final totals immediately under Reduced Motion.


## 17. Picture pass 2 (11 November 2026)

Optional additions; every one degrades to the §16 behaviour when absent.

- `Rules.CHALLENGES[n].progress(summary)` returns the fraction of the challenge currently met (unclamped; callers clamp to 0..1). It must agree with `check`: `check` true implies `progress >= 1`.
- HUD view field `goalProgress` (0..1) drives `#hudGoalRing` (`stroke-dashoffset = 100 − round(progress·100)`, written only on change). `goalId` of `fuel-60`/`fuel-35` shows `#fuelGoalMark` at that percentage of the fuel bar.
- `IronUI.setNudge(name,on)` toggles `nudge-<name>` on `#app` (`gas`, `left`, `right`); CSS bounces the matching touch pedal. `cue('drive')` and `cue('tilt')` use `#cue-drive` / `#cue-tilt`.
- Runtime tilt prompt: airborne longer than 0.25 s, |chassis angle| between 0.4 and 1.5 rad, and lean input not already opposing it. At most five tilt badges per attempt, three seconds apart; the pedal nudge follows the condition. It never changes input.
- Renderer: while `state.fuel < 35`, each visible uncollected can draws one filled arrow (one draw op each).
- Stage scenes are inline SVG built from biome data in `src/ui.js`; they add no hot-path work and no element IDs outside menu markup.


## 18. Endless Boss (12 November 2026)

- The ten campaign stages and their physics/rewards stay unchanged. Winning stage10 unlocks a separate survival round via results ∞, stage select and title. `TruckPhysics(9,{endless:true,tuning})` / `qa.start(10)` select it; the production UI checks `save.completed.includes(9)`.
- Terrain-only survival: no rival finish gate or mandatory cannon target. Distance is peak forward travel from start. No finish, victory, recovery, self-righting grace or post-terminal coasting. A wrapped chassis angle of at least1.75rad in either direction ends as `overturn`; chassis more than3m below local surface ends as `fall`. Ordinary jumps remain allowed. Empty fuel ends as `fuel`.
- Fuel drains at6.8points/s × tank economy × (.35+.65×abs(throttle)); burning nitro uses full-throttle drain. One reachable can per96m chunk gives up to32points, capped100. Chunk generation never refills fuel, and collected cans cannot replenish twice.
- Generate96m chunks at least480m ahead; prune geometry/cans/features over192m behind. Height increases with chunk index; later stretches add more rollers and widening ravines. Arrays/Planck fixtures and renderer paths stay bounded; retained segment arrays are immutable. `terrainVersion` signals append/prune; renderer refreshes only terrain/layout and reuses sprite banks and retained paths. No finish arch/cannon/giant in this mode.
- Telemetry adds `endless`, `distance`, `difficulty` (1+floor(distance/250)) and `terrainVersion`. Campaign save adds `endless:{bestDistance,bestTime,runs}` with paired distance/time and idempotent `Save.recordEndless(save,summary)`; no campaign scrap/stars/unlocks are credited by survival.
- HUD keeps current fuel, nitro, speed and inputs; replaces finite route/goals with ∞ distance and terrain tier. End screen reports distance/best and Retry. Existing compact campaign results remain.
