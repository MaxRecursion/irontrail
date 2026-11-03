# IRONTRAIL v2 analysis — what stands between it and a polished 120 FPS indie game

Date: 3 November 2026. Method: full source review, headless-Chrome frame/trace benchmarks
(`tests/perf-bench.mjs`), instrumented builds that count every Canvas2D call, Node physics experiments
(scripted drivers, flips, stuck states, rival behaviour, fuel margins), Web Audio cost benches, and
colour-contrast/layout measurements of the shipped page. Machine: Apple M4, Chrome 156, ANGLE Metal.
Numbers are from 1600×1000 @ DPR 2 (canvas 2900×1140 device px) unless stated.

## 1. Performance and smoothness

| Measurement (stage 10) | v2 result | Why it matters at 120 FPS (8.33 ms budget) |
| --- | --- | --- |
| Main-thread work per frame (trace) | 3.3–3.8 ms | ~40 % of the budget on a top-end M4 before any slower device |
| GPU-process work per frame | 2.0–2.2 ms | Proportional to canvas op count |
| Canvas API calls / draw ops per frame | 3,582 / 577 | `lineTo` 1,105, `fillStyle` 415, `beginPath` 318, `fillRect` 241 per frame |
| Distinct `ctx.font` strings seen | 485 | Font sizes follow the zoom, so fonts re-parse constantly |
| `_heightAt` linear scans per frame | 195–237 | Each scans ~860 terrain points |
| CPU throttled 6× (weak laptop/phone proxy) | 22 % of frames > 8.33 ms | Visible stutter |
| First frame of a run (throttled 4×/6×) | 57–97 ms | AudioContext + graph built in the click handler (73–99 ms), cold Planck JIT (first steps 9–50 ms), then a 6-step catch-up |
| Render interpolation | none | Simulated judder: 3.7–7 px at 144/165/240 Hz and 120 Hz with jitter; interpolation cuts it to 0.1–0.5 px |
| HUD bar `width` transitions | layout + paint every frame | Removing them cut Layout calls 361→94 and Paint calls 1,187→194 per run |

Other findings:
- **Audio automation leak (bug):** while the AudioContext is suspended, `audio.update()` keeps adding
  `setTargetAtTime` events at a frozen `currentTime`; per-update cost grows linearly (0.04 ms → 3.8 ms after
  10 minutes) and renderer memory grows ~60 MB. A player whose audio never starts slowly loses frame rate.
- `audio.update` performs 13 automation calls per rendered frame, so the cost scales with refresh rate.
- Physics is cheap (60–140 µs per step); letting far zombies sleep cut stage 5 from 70 to 42 µs/step.
- A prototype that drew terrain from persistent world-space `Path2D` chunks cut canvas serialization
  0.90→0.21 ms and commit 1.09→0.38 ms per frame. A second prototype that lazily baked terrain into bitmap
  tiles raised GPU flush from 1.1 to 3.6 ms/frame — runtime-created large textures are a trap.
- Micro-benchmark (2,500 shapes): individual calls 1.08 ms main + 1.75 ms GPU; per-frame path 0.84 + 0.75;
  persistent `Path2D` 0.26 + 0.27; cached sprite 0.28 + 0.19.

## 2. Game feel and progression

- **Flips are physically impossible.** Air-lean torque gives 2.8 rad/s² on a 17.5 kg truck (I ≈ 34);
  typical flights last 0.3–0.74 s and rotate −18…−20° nose-down. Prototypes show 22–28° kickers plus
  velocity-targeted air control (≈6.5 rad/s cap) make 1 flip possible without hurting a hold-throttle run.
- **No skill expression:** a "hold W" bot and a "competent" bot finish every stage in the same time.
- **Monotone level design:** every stage repeats flat → hill → flat → ramp → gap; slopes max 9–17°.
  Prototyped features (kickers 14–28°, climbs 30–40°, 4 m drops, rollers, table-tops) are all passable.
- **Fuel curve has no middle:** stages 1–9 end with 74–91 % minimum fuel; stage 10 drops to 18.6 %, missing
  its first can is fatal, and the hold-W line flies over two cans (115 m, 204 m).
- **Boss race is not a race:** hold-W wins by ~48 m with zero lead changes. Iron Maw can flip onto its roof
  and stay stuck forever (observed at 12.6 s, −231°), handing the player a free win.
- **Stuck without help (bug):** an upright wedge (e.g. Iron Maw's wheel on the player's chassis at part
  throttle) stalled the player 16 s until the tank ran dry; the recover button only appears when flipped or
  fallen, so touch players had no way out.
- **Roof state is mis-reported (bug):** upside down on flat ground the wheels are clear, so the truck counts
  as airborne — airtime climbs (6 s seen), a takeoff event fires, the HUD says "CATCHING SOME AIR".
- Cannon lock windows are fair: ≥ 1.74 s between lock and impact at full throttle on every stage.
- Missing genre staples: score/combos, trick rewards, star objectives, result breakdowns, upgrades,
  ghost of your best run, contextual onboarding, gamepad support.

## 3. Art direction and UX

- **Readability:** the lime truck (#ccdb78) has 1.07–1.16:1 contrast against the sky; 122 of the 155
  colours in the renderer sit in one yellow-green hue band, so every stage looks the same.
- **Gaps look like holes** showing the background instead of ravines.
- **The game is a widget in a web page:** the play area is only 41–59 % of a laptop viewport, under a
  marketing header and above a details/footer section; no title screen, pause menu or results screen.
- **Overlapping controls (bug):** the recover button is covered by the cannon HUD on desktop and by the
  pedals on phones (hit-testing its centre does not reach the button).
- HUD clutter: seven panels compete; the critical cannon-lock state is small text.

## 4. Audio

- Engine is a good base (finite, no clipping) but loses ~2.7 dB at idle on phone speakers (energy is
  below 200 Hz) and the saturator curve is nearly linear (little grit).
- a-rate automation doubles audio-thread cost; k-rate params cut it ~45 %. Persistent synth voices are
  ~5× cheaper than creating node graphs per note — the right shape for procedural music.
- No music, no trick/score/UI sounds, no skid/creak/backfire texture.

## 5. What v3 changes (see SPEC.md for the contract, PLAN.md for status)

Fixed-step physics with render interpolation; a cached-sprite + persistent-Path2D renderer with ten
biomes; frame-pacing monitor with adaptive resolution; allocation-free HUD updates; JIT warm-up and early
audio unlock; the suspended-audio fix; flips/landing quality, score/combos, three-star objectives, scrap
and a four-track garage; ghost replays; varied track features with a smoother fuel curve; a competitive,
self-righting Iron Maw; stuck/roof fixes; full-viewport title/menus/results; gamepad; procedural music.
All hard rules (one charge, one monster, fuel, recovery cost, no rival teleporting) stay.
