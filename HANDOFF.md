# IRONTRAIL v3 handoff

## Current state

The v3 implementation is complete. Continue from the current sources, not the earlier cannon release. Claude's `ANALYSIS.md` and `SPEC.md` were used to finish the renderer, physics, audio, progression, menus and integration. Historical milestones remain in `PLAN.md`.

- Project: `/Users/akshaykulkarni/NewGame/irontrail`
- Portable game: `index.html`; identical hosted output: `dist/index.html`
- Private URL: https://irontrail-monster-rally.mellowdew4.chatgpt.site
- Existing Site ID: `appgprj_6ae8bf943e7c8191be3fee438599f6a5`
- Previous v2 cannon source: `244102348680f75f112c660910bf530cb736a4de`
- The completed v3 release is published through the existing owner-private Site and the supported source/packaging workflow. Keep its ID and audience.

## Implemented scope

Ten routes now have distinct biomes, layered terrain and props, ravines, weather, lights and outlined truck/character artwork. Cached sprite banks and persistent filled Path2D chunks replace repeated drawing construction. The camera interpolates poses, looks ahead, changes zoom and applies optional impact shake. Effects use bounded pools.

The full-screen interface includes title, ten-stage selection, briefing, garage, settings, pause, results and failure screens. The HUD writes only changed values, uses transform bars, displays target lock and race position, and reserves a recovery slot clear of touch pedals. Global feedback remains visible during countdown or garage purchases and clears across run/menu transitions. Keyboard, touch and Gamepad API controls are wired, including controller-adjustable settings.

The physics has mixed authored track features, velocity-target air control, landed flips, settled landing quality, grounded/inverted/stalled detection, and torque-only self-righting. Iron Maw uses physical wheels, joints and contact impulses. Its throttle/balance controller never teleports, sets velocity to catch up or rubber-bands.

Score combos, flips, perfect landings, big air, monster kills, cans and checkpoints earn score. Three stars reward completion, par and a route-specific challenge. Scrap buys three levels each of engine, tyres, suspension and fuel economy. A best-time ghost records player chassis/wheels at 20 Hz and replays interpolated poses. Earlier campaign saves migrate without losing unlocks/best times.

Procedural Web Audio includes combustion/engine-load layers, gears, intake, tyre/suspension/air sounds, gun/monster/landing cues, UI/reward cues and adaptive synthesized music. Music uses persistent melodic voices plus buffer-source drums. Suspended contexts retain bounded parameter targets instead of scheduling growing automation queues. Mute, pause and independent volumes work before/after unlock.

## Hard rules to preserve

- One self-contained offline HTML with inline Planck.js 1.5.0 and its MIT license. No remote assets.
- Exactly one cannon charge and one random mandatory giant per fresh attempt. X/J, FIRE or gamepad A shoots; an early/occluded shot may miss. Holding/repeating never reloads. Contact with, passing or finishing past a live giant fails.
- Fuel drains during active play, including idle. Cans add up to 32 points, capped at 100. Recovery costs 12 points and preserves fuel/cans/zombies/ammo/monster/projectile/rival progress. Full retry resets the attempt and rerolls the giant.
- Physical non-graphic zombie knockdowns; genuine chassis/tyre collisions between independently simulated player and rival. First finish wins, with fractional crossing order for same-step finishes.
- Pause/hidden tabs freeze simulation; storage/audio/fullscreen failures must not prevent driving.

## Architecture and APIs

| File | Responsibility |
| --- | --- |
| `src/physics.js` | Track generation, Planck world, vehicles, zombies, fuel, cannon/giant, rival AI, events, pose buffers, upgrade tuning |
| `src/audio.js` | TruckAudio graph, engine/SFX, gating, volumes, safe automation |
| `src/music.js` | TruckMusic persistent synth and lookahead scheduler |
| `src/biomes.js` | Ten frozen art-direction definitions |
| `src/render.js` | IronRenderer cached assets, terrain, entities, effects and camera |
| `src/rules.js` | DOM-free IronRules scoring, stars, scrap, upgrades and save migration |
| `src/ui.js` | IronUI screens, changed-value HUD, navigation, feedback and cached layout metrics |
| `src/shell.html` | Responsive semantic markup/CSS and module placeholders |
| `src/game.js` | Fixed-step loop/interpolation, input, state machine, events, pacing, ghost and module integration |
| `build.py` | Python standard-library bundler; emits nine inline scripts and both identical HTML copies |

Read `SPEC.md` for exact payloads. `TruckPhysics(stageIndex,{tuning,random})` supplies `step`, `fire`, `reset`, `restart`, `getState`, `drainEvents`, `getPose(out)` and `interpolatePose(alpha,out)`. Indices are zero-based; UI stages are 1–10. Metres, seconds, radians and Y-up are used.

Pose slots are player0, rearwheel1, frontwheel2, rival3/rear4/front5, projectile6, zombies7+. Each has x/y/angle. Absent entities use NaNs. Poses snap across reset; angular interpolation follows the shortest path. **getState returns a reused telemetry object and reused nested records; do not retain it as a historical snapshot.** Its stats record is copied. Render from the interpolated pose buffer.

Runtime modes: title/stages/garage/settings/brief/countdown/playing/paused/cleared/failed/victory. Read-only `window.irontrail` getters expose mode, telemetry, physics, audio, campaign, stage and perf; `qa.start(index)` starts immediately for tests. `perf.trace()` returns at most600 `[timestampMs,renderedX,alpha,steps,cpuMs]` rows. FramePacer/GhostTape export in Node for tests.

## Balance

Fixed simulation is120Hz, maximum8steps/display frame. Pose interpolation handles display refresh differences; excess backlog is dropped. Auto quality lowers resolution first, then effects/detail after sustained misses; it restores a tier after8s of headroom. High/Balanced/Performance and reduced-motion settings are available.

Stage lengths:220/250/285/320/355/390/425/465/510/560m. Fuel-drain rates:5.98/6.75/7.90/8.00/8.25/8.30/8.95/8.98/9.25/9.35points/s. Nominal can intervals:78+2×stageIndex metres, adjusted to reachable safe locations.

Fuel per step is `fuelDrain * tankMultiplier * (.35 + abs(throttle)*.65) * dt`. Tank multipliers are1/.93/.86/.79. Engine torque is1/1.1/1.2/1.3 and speed1/1.04/1.08/1.12; tyres multiply grip1/1.08/1.16/1.24. Suspension frequencies4.4/4.6/4.8/5Hz, damping.85/.86/.87/.88 and air-control1/1.15/1.3/1.45. Base air-control target6.5rad/s.

Iron Maw starts6m behind. Its motor speed is34.3×(1+.035×engineLevel)rad/s and fixed torque compensation1+.06×engineLevel. This tuning depends only on purchased engine level, never player position/gap. Self-righting continues through side contact with released wheel motors until upright; player righting requires held lean. See reconciled SPEC §4/§10.

## Saves and controls

Production key remains `irontrail-campaign-v1`; v3 adds version, stars, bestScore, scrap, upgrades, settings and totals to the earlier unlocked/completed/best/selected fields. Best ghosts use `irontrail-ghost-v1-N`. Save migration bounds values, handles corrupt/denied storage, and rewards each result once. Returning from garage/settings/results never credits rewards twice.

Keyboard: Up/W throttle, Down/S reverse, Left/A and Right/D air balance/righting, Space brake, X/J fire, C recover, R retry, P/Escape pause, M mute, F fullscreen. Menus support arrows/Enter/Escape/Tab. Gamepad: RT throttle, LT forward brake/low-speed reverse, left stick/D-pad lean, A fire/activate, X recover, Y retry, Start pause/resume, B back. Up/down navigates settings; left/right changes focused sliders/selects and A toggles checkboxes. Touch controls are visible on small/coarse-pointer displays.

## Reproducible checks

```sh
cd /Users/akshaykulkarni/NewGame/irontrail
python3 build.py
python3 tests/bundle-check.py
node tests/physics-smoke.cjs
node tests/rules-check.cjs
node tests/pacing-check.cjs
node tests/render-check.cjs
python3 -m http.server 4173 --bind 127.0.0.1
```

Browser pages: `/tests/audio-check.html`, `/tests/ui-harness.html`, `/tests/render-harness.html?stage=10`, `/tests/integration-harness.html?phase=all`. Integration also accepts flow/failures/boss/gamepad phases and starts from its Start button. It fetches the current real bundle into an iframe, uses unique QA campaign/ghost namespaces and drives the actual game loop through input/DOM controls. It never changes production progress.

`tests/make-browser-fixture.py` generates deterministic, isolated previews; examples:

```sh
python3 tests/make-browser-fixture.py --stage 10 --output boss-preview.html
python3 tests/make-browser-fixture.py --stage 1 --monster-roll .62 --approach-monster 18 --output cannon-preview.html
python3 tests/make-browser-fixture.py --stage 1 --fuel 1 --output fuel-preview.html
```

These use separate QA storage. Initial positional/fuel/rival changes are test-fixture setup only and do not ship. Retry returns to normal attempt resources. Rebuild/regenerate before browser QA. `dist/` contains only the production HTML; fixture files are ignored.

Claude's optional raw-CDP `page-check.mjs`/`perf-bench.mjs` remain in the repository for developer-controlled Chrome use. They were **not run** by this agent; browser checks used supported CUA tools and self-running test pages.

## Verified v3 results — 3 November 2026

- All ten stages pass at60/120Hz with base and maximum upgrades. Separate60%-throttle tests prove terrain/fuel viability; stage10 omits the rival in that specific test because race pace requires higher throttle.
- No-idle base full-throttle fuel floors:70/65/61/53/51/45/41/33/28/26%. Tests cover missed-can tolerance, fuel depletion/pickup/conservation/retry, all recovery gates and terminal freeze.
- Single-shot/random-giant smoke covers varied safe placement, early miss, repeated fire rejection, terrain occlusion, high-speed swept rays, lethal contact, anti-bypass, recovery conservation and reroll. Another80 varied encounter routes pass.
- Cross-truck contact filtering and two-way impulse transfer pass. Clean boss gaps:9.2/14.3m base/max at120Hz and7.3/8.8m at60Hz. Recovery produces lead changes and rival wins. No AI position/velocity corrections.
- Real course kicker flips with upright landings pass on stages3–10 at both rates. Stage5 flip, stage6 two perfect landings, stage7 landed1.6sair and stage10 15mlead challenges are attainable. Pose wrap/NaNs/snaps/freeze, stats, stuck detection and torque-only righting pass.
- Rules tests pass for combo decay, landed scoring, stars, rewards, upgrade costs, save migration/corruption/denial and idempotence. Pacing tests pass for60–240Hz detection, downgrade/restore hysteresis, bounded trace/ghost storage, ghost validation and constant-speed interpolation under irregular refresh.
- Structural renderer test runs1,400 real-physics frames over all10biomes with simultaneous effects/popups/ghosts: max168/220drawops,3/3fonts,57.7MiB current-stage caches at1600×1000DPR2; no hot canvas/gradient allocations. Retry and adaptive quality reuse caches rather than retain every biome.
- Browser audio tests pass engine, takeoff, landing, every gameplay/UI cue, all5music moods, stacked effects, mute/pause/zero-volume silence, canceled tails and20,000suspended parameter updates with bounded targets. Output remains finite and below clipping.
- Browser UI tests pass all8screens,10cards, focus/navigation, garage/settings events (including controller settings), global feedback, zero-change HUD mutations, transform bars, title fit and recovery hit/overlap checks at1440×900,1280×720,390×844 and844×390.
- Browser full integration passes: stage1clear11.91s, one shot, score/stars/scrap/unlock, ghost save/replay, reward idempotence, next-stage/garage tuning, visible countdown, pause freeze/time, persistent settings, unshot monster failure8.58s, fuel failure/retries, actual boss victory29.07s with7.92mlead, and a synthetic gamepad completing stage1 through RT/Start/A.
- At390×844, actual pointer FIRE clears the locked monster and disables the empty cannon; holding GAS moves the truck (136→143m in the approach fixture) and drains fuel. HUD/pedals fit. Inspected gameplay logs have no errors/warnings.
- All source syntax checks and single-file checks pass:9inline scripts,45real elementIDs, embedded MIT license, no external assets and identical generated copies.

Final boss callback timing,1600×1000CSSpx, High quality, native displayDPR1 at≈59.9Hz:

| Canvas backing | First playing callback | Warmed mean | Warmed p99 | Warmed max | Samples | Max draws |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1600×1000 (native appDPR1) |1.2ms|1.106ms|2.4ms|3.4ms|1,728|160 |
| 3200×2000 (QA appDPR2 override) |0.9ms|1.102ms|2.4ms|3.3ms|1,728|160 |

The second row measures the actual2×canvas workload while explicitly retaining the native1×display. It is not a physical2×/120Hz display test. Both final-source boss runs win in29.76s with6.07mlead. Callback p99 meets the2.5ms target and no sampled warmed callback exceeds8.33ms; full-main-thread/GPU/4×CPU targets are not measured. Earlier all-phase runs also pass; their warmed callback means were.867ms(stage1) and.688ms(boss), p99≤2ms at appDPR1.

## Verification limits and future optional work

120Hz simulation/interpolation and adaptive quality are implemented. The available in-app browser displays at≈60Hz;120Hz display output was not physically verified. Supported browser checks measure callback CPU duration, not full main-thread/GPU traces or4×CPU-throttled runs. Those exact SPEC §0 budgets remain unmeasured, not claimed as passing. The renderer's amber fill does not meet a literal3:1ratio against every gradient stop in every biome; the outlined composite truck was visually checked for readability.

Audio is procedural rather than recorded. Physical phones/controllers, Safari/iOS and speaker/headphone listening remain useful optional hardware checks. The browser automation environment blocks file:// navigation; self-containment is verified structurally and browser QA runs over localhost. Persistence depends on available localStorage. There is no network multiplayer or vehicle-health system.

## Continuation prompt

Continue IRONTRAIL in `/Users/akshaykulkarni/NewGame/irontrail`. Read PLAN.md, SPEC.md, HANDOFF.md and current sources/tests before editing. V3 modules and integration are complete; do not restart or regress to v2. Preserve the single offline HTML, Planck MIT license, one charge/one mandatory random giant, zombie contacts, fuel/can/recovery invariants, torque-only rival, upgrades/stars/scrap, best ghosts and existing saves. Change src files and rebuild with python3 build.py. Run relevant Node and browser harnesses; keep QA storage/fixtures outside dist. Exact full-main-thread/GPU/4×CPU budgets and physical120Hz/mobile/controller hardware checks are optional unverified follow-ups, not completed measurements. For publication use the existing public MaxRecursion/irontrail GitHub repository and Vercel project irontrail in team max-recursion. The user explicitly migrated hosting from Sites; .openai/hosting.json is historical. Rebuild with python3 build.py and deploy the existing Vercel project; preserve the configured custom-domain DNS.


## Current follow-up — shooting UX and Vercel migration

Current sources preserve the user's runner changes, complete partial UI/renderer edits, and add ShotDirector in game.js. Pure Node tests cover bounded aim/shot/impact/miss, retry reset and reduced-motion bypass. Whole-world time scaling preserves120Hz steps and equal rival/fuel/run/ghost time. The render camera fits truck+target, tracer and impactring add feedback, and the engine pitch eases down with time scale. Icon cues retain screen-reader labels.

Build, bundle, rules, pacing, structural render, UI and audio checks pass. Browser integration passes slow-motion flight+impact assertions, stage clear, one-charge encounter, garage/persistence/ghost/pause/retry, both mandatory-monster/fuel failure paths, boss victory and synthetic gamepad. Boss29.07s/7.92mlead; one-shot stage1clear11.91s. Render stress max169drawops.

Public repo: https://github.com/MaxRecursion/irontrail . Vercel team max-recursion/project irontrail is connected. Custom domain irontrail.maxrecursion.dev is assigned and its Namecheap CNAME is saved. Exact Vercel recommendation: CNAME host irontrail target1c83a48bcee72fc4.vercel-dns-017.com. User explicitly authorized browser DNS setup. No other domain records should change. Legacy Sites IDs above are historical hosting; this follow-up uses GitHub/Vercel at the user's request.

Vercel production deploy succeeded: https://irontrail-iota.vercel.app . Phone cinematic camera tracks the projectile and target at a readable scale, then returns smoothly. Custom-domain DNS setup is complete.


Custom-domain delivery verified3November2026: Namecheap browser saved CNAME irontrail →1c83a48bcee72fc4.vercel-dns-017.com. (Automatic TTL). Authoritative DNS and1.1.1.1/8.8.8.8 resolve correctly. Vercel reports configured-correctly; HTTPS certificate issued and strict TLS request to the custom hostname through its publicly resolved Vercel address returns HTTP200 (542230bytes). Local recursive resolver still has a negative A-record cache; Chrome/IAB navigation can report NXDOMAIN until that cache expires. No authentication/protection bypass or changes to other DNS records. GitHub/Vercel deployment is complete.


## Sound pass — 3 November 2026

Implemented original “Deadland Run” eight-bar theme (hook/answer, minor-key chord cycle, syncopated bass, arpeggio, pads, kick/snare/hats), stronger boss rhythm and slow-motion filtering. Nine persistent music voices use the existing25ms/.12slookahead scheduler; live drum sources cap32. User music volume is applied once by musicBus; standalone TruckMusic.setVolume is proportional.

Gameplay audio now layers tyre/suspension release and takeoff sweep, speed/vertical-motion flight wind, strength-sensitive first/second axle landings and gravel, modal steel/rubber collisions, cannon crack/blast/recoil/bolt/early reflections, directional monster shatter/growl/debris and slow-time entry/exit sweeps. Physics event positions pan all layers consistently. Cannon briefly ducks engine and music with8msattacks; impact ducking restores the mix smoothly. Event source cap96, tracked disconnection, original pause/mute cancellation and suspended target bounds remain.

Verification: browser audio harness passes all24cue cases, full19stheme, all5moods, half-volume proportionality, mixed V8/music/heavy impacts, stronger flight wind, stereo direction, source cap/cleanup, exact muted/paused/master0/music0 silence and20,000suspended updates. Combined effects peak≈.224; worst music+V8+heavy events≈.169 (random noise may vary), no non-finite samples. Live integration flow passes stage1in11.91s, slow-motion cannon, progression, garage, pause, settings and ghost; music275notes/81drums, no warnings/errors. Callback mean1.036ms/p992.1ms at1280×530/≈60Hz is a callback observation only. Bundle, shot and pacing checks pass. Audio remains procedural; no physical speaker/headphone listening certification is claimed.

Production target remains irontrail.maxrecursion.dev with irontrail-iota.vercel.app fallback. Do not change DNS or create a new hosting project for this update.
