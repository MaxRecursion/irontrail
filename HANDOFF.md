# IRONTRAIL handoff — zombie campaign expansion

## Request and current status

Original request: a single HTML 2D monster truck track game with realistic engine/jump sounds, correct physics/animation, and a plan first so Claude can continue development if needed.

Expansion request: add zombies, continuously dropping fuel with periodic fuel cans, ten stages of increasing difficulty, and a final boss race against another monster truck with designed collision physics.

The original single-course game was completed and published on 2 November 2026. The zombie campaign expansion is implemented and verified. Republication to the same private URL is in progress. Current expansion results are recorded below; original publication identifiers are historical.

- Private playable URL: https://irontrail-monster-rally.mellowdew4.chatgpt.site
- Project ID: `appgprj_6ae8bf943e7c8191be3fee438599f6a5`
- Original published source commit: `075d7d9862c76828c11ce128195ce4d028f71162`
- Original deployment ID: `appgdep_6ae8c2d238c48191b584529ad3c67b38`
- Project: `/Users/akshaykulkarni/NewGame/irontrail`
- Portable game: `/Users/akshaykulkarni/NewGame/irontrail/index.html`
- Hosted output: identical `dist/index.html`

Preserve the existing Sites identity and private audience when publishing updates. Never create a replacement Site for this project. Read the expansion checklist in `PLAN.md` for remaining work.

## Single-file contract

The portable HTML contains Planck.js, the page/CSS, Canvas graphics, gameplay and procedural Web Audio. It has no CDN, remote font, external image or audio dependencies. No build/runtime packages need installation. Edit sources in `src/`, then run `python3 build.py`; never edit generated HTML directly. Preserve the inline Planck MIT license.

## Current campaign behavior

- Ten stage cards show the selected, locked and cleared stages. Completing a stage unlocks the next; previous stages can be replayed.
- Stages increase course length, hill/gap severity, zombie density and fuel pressure. Stage 10 adds the Iron Maw race.
- Fuel drains only while the simulation is playing. Idle still consumes fuel; throttle increases the rate. Pause freezes all simulation resources and the rival.
- Amber fuel cans restore up to 32 percentage points, capped at 100. Their first nominal position is 35 m after the start; later cans use the stage interval and are moved onto safe terrain if needed. Pickup uses a 3.9 m player/can proximity check, accommodating the truck size and jumps.
- Empty tank produces a failed/retry state. Retry restarts the selected stage with fuel 100, fresh cans and zombies.
- Checkpoint recovery costs 12 percentage points. It preserves remaining fuel, collected cans, cleared zombies and rival progress. If the cost exhausts the tank, recovery fails the run. The run clock continues across recovery.
- Zombies have actual lightweight Planck bodies and contact-driven impacts. They walk gently upright; truck contact knocks them into a short, fading cartoon tumble. There are no graphic effects. After the initial hit, fallen zombie fixtures collide with terrain only so they cannot wedge an axle. The cleared count includes zombies hit by either truck.
- Iron Maw has its own chassis, wheels, wheel joints, motor drive and airborne balance AI. It starts 6 m behind the player and uses slightly slower gearing. First truck to cross the finish wins; same-step crossings use a crossing-fraction comparison. Rival win produces a race-loss/retry state.
- Gameplay modes are `ready`, `playing`, `paused`, `cleared`, `failed`, `victory`. Stage clear offers the next stage; final victory offers a new campaign run.

## Stage definitions and balance

`TruckPhysics.STAGES` is the authoritative immutable definition array. Indices are zero-based in code; UI stage numbers are 1–10.

| Stage | Route | Length | Can interval | Zombies | Full-throttle fuel drain |
| --- | --- | ---: | ---: | ---: | ---: |
| 01 | Redstone Outbreak | 220 m | 51 m | 5 | 2.60% / s |
| 02 | Dry Creek | 250 m | 54 m | 8 | 3.12% / s |
| 03 | Hollow Ridge | 285 m | 57 m | 11 | 3.64% / s |
| 04 | Graveyard Pass | 320 m | 60 m | 14 | 4.16% / s |
| 05 | Deadwood Dunes | 355 m | 63 m | 17 | 4.68% / s |
| 06 | Rust Canyon | 390 m | 66 m | 20 | 5.20% / s |
| 07 | Bone Valley | 425 m | 69 m | 23 | 5.72% / s |
| 08 | Ashen Heights | 465 m | 72 m | 26 | 6.24% / s |
| 09 | Last Refuge | 510 m | 75 m | 29 | 6.76% / s |
| 10 | Iron Maw Showdown | 560 m | 78 m | 32 | 7.28% / s |

Fuel consumed per step is `stage.fuelDrain * (0.35 + abs(throttle) * 0.65) * dt`; idle therefore uses 35% of the listed rate. `fuelDrain = 2.6 + stageIndex * 0.52`, `fuelInterval = 51 + stageIndex * 3`, and `gapWidth = 2.2 + stageIndex * 0.38` metres. Check actual definitions before further tuning; values may be adjusted during final QA.

## Source map and APIs

- `src/shell.html`: semantic page, responsive CSS, Canvas, overlays, fuel/zombie HUD, boss HUD and campaign cards container. All assets are inline/code generated.
- `src/physics.js`: global `TruckPhysics(stageIndex=0)`. `.step(dt,{throttle,brake,lean})`, `.getState()`, `.drainEvents()`, `.reset(checkpointIndex)` for paid recovery, `.restart()` for a fresh stage. `.track`, `.stage`, `.stageIndex`, `.checkpointIndex`, `.fuel`, `.zombies`, `.fuelCans`, `.rival`, `.failed`, `.winner`, `.finished` expose state. `.finished` means the player won; `.failed` is null, `'fuel'` or `'rival'`; `.winner` is null, `'player'` or `'rival'`.
- Physics state includes actual player transform/velocities, physical wheels/anchors, grounding/airtime, fuel, cleared/total zombie counts, rival snapshot and race position. Events: `takeoff`, `land`, `zombie`, `fuel`, `collision`, `empty`. Fuel events carry the actual refill amount; collision events carry a normalized impulse strength.
- `src/audio.js`: global `TruckAudio`. Gesture-started `.unlock()`, `.update(state,dt)`, `.setMuted(bool)`, `.setPaused(bool)`, `.takeoff(strength)`, `.landing(strength)`, `.pickup()`, `.zombieHit(strength)`, `.collision(strength)`, `.result(won)`. RPM/gear feed the HUD. All layers/effects route through mute/pause gating, and pre-unlock calls are safe.
- `src/game.js`: stage unlock/best-time persistence, input, state transitions, fixed-step loop, scene rendering, particles/camera, HUD and event/audio integration. Best air is committed on landing or a successful airborne finish, so an uncompleted fall does not set a record.
- `build.py`: Python standard-library bundler inlines four scripts into `index.html`, then copies the same file to `dist/index.html`.
- `vendor/planck.min.js`, `vendor/LICENSE-planck.txt`: pinned Planck.js 1.5.0 and license.
- `tests/physics-smoke.cjs`: physics/campaign checks; read the current test before interpreting its coverage.
- `tests/audio-check.html`: OfflineAudioContext engine/effect signal checks, muted/paused silence, pre-unlock calls and interrupted effect handling.
- `tests/make-browser-fixture.py`: developer-only late-stage/low-fuel fixture generator. It reads the latest generated HTML; rebuild first.
- `.openai/hosting.json`: existing project ID and `dist` static-directory declaration.

Read-only browser diagnostics: `window.irontrail` exposes `mode`, `telemetry`, `physics`, `audio`, `campaign` and the 1-based `stage`.

## Physics and collision design

All simulation coordinates use metres, seconds, radians and Y-up. Lean +1 rotates the nose down. Start X is 7.5 m; finish X is `startX + stage.length`. Progress consistently uses `(x-startX)/length`.

Wheel radius is .72 m; wheelbase 3.14 m. Gravity is (0,-14). Wheel springs use 4.4 Hz frequency and .85 damping. Grounded motor torque is 48 per wheel and airborne torque 7, with brake torque 125. Player forward motor speed is -34 rad/s; reverse +13 rad/s. Rival forward speed is -31.3 rad/s. The torque-based grounded slope assist never teleports or directly rotates a truck.

Player fixture group **-1** suppresses player self-collisions. Rival group **-2** suppresses rival self-collisions. Different groups and compatible category/mask bits allow actual chassis/tyre player–rival collisions. Categories are ground1, player2, rival4 and zombies8. Post-solve vehicle collision impulses drive effects with a cooldown. Contact callbacks enqueue mutations; zombie filter/body changes occur only after the world step is unlocked.

Connected Chain fixtures reduce internal-edge catches, and separate chains represent actual gaps. Rival movement is motor/torque-driven; no position or velocity corrections are used for overtaking.

## Persistence and controls

Production localStorage key: `irontrail-campaign-v1`, containing `{unlocked,completed,best,selected}`. `completed` and `selected` use zero-based indices; best times are keyed per index. Storage failures do not prevent play. The old `irontrail-best-v2` single-course record is no longer used by the campaign.

Keyboard: Up/W throttle; Down/S reverse; Left/A or Right/D air balance; Space brake; C paid checkpoint recovery; R stage retry; P/Escape pause/resume; M sound; F fullscreen. Touch pedals are on screen. Campaign map is available from the toolbar or overlay. Choosing a stage pauses the active run.

## Build, preview and checks

```sh
cd /Users/akshaykulkarni/NewGame/irontrail
python3 build.py
node --check src/physics.js
node --check src/audio.js
node --check src/game.js
node tests/physics-smoke.cjs
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/` for gameplay and `http://127.0.0.1:4173/tests/audio-check.html` for audio signal validation.

Optional browser fixtures:

```sh
python3 tests/make-browser-fixture.py --stage 10 --output boss-preview.html
python3 tests/make-browser-fixture.py --stage 1 --fuel 1 --output fuel-preview.html
python3 tests/make-browser-fixture.py --stage 10 --rival-lead 30 --output boss-loss-preview.html
```

The generated pages are `/tests/boss-preview.html` and `/tests/fuel-preview.html` on the local server. They unlock stage selection and optionally set initial fuel, using **`irontrail-campaign-qa-only`** so they do not alter the normal campaign save. They are excluded from `dist/` and are not shipped. They must never replace the production HTML or its storage key.

## Expansion verification results

- Build and all source syntax checks pass. Single-file check confirms four inline scripts, unique element IDs, no external asset dependencies, and byte-identical index.html/dist/index.html.
- `node tests/physics-smoke.cjs` passes for all ten stages at both120and60Hz. At120Hz the test runs (including1s idle) finish in12.12/13.37/15.16/16.63/18.59/20.14/22.18/24.09/26.97/29.26seconds. Stage10 has two natural vehicle impacts,5fuelpickups and18.6minimumfuel.
- Smoke coverage includes all checkpoint safe spawns, no recovery body leaks, fuel and can conservation, depletion, terminal freeze, full retry, actual zombie contacts, no same-truck collisions, cross-truck physical impulse transfer to both bodies, rival win, brakes and reverse.
- Production browser campaign: stage1 clears in11.19s,5/5zombies,97fuel. Continue starts stage2, which clears in18.72s with8/8zombies and95fuel while partlycoasting. Stage unlocks, current selection and per-stage besttimes persist.
- Browser developerfixtures (isolated QA storage): stage10 player victory in31.30s,26/32zombies,80fuel; bossloss through actualrivalfinish in30.21s using an initial30mopponentlead. The lead is a fixture-only starting condition; production AI does not teleport.
- Low-fuel browserfixture fails atzero, displaysretry, retry restores100fuel/time0/freshstage. Phone390×844 pointer-heldgas moves the truck and usesfuel100to93; pause preservesfuel andtime. HUD, overlays, horizontal stagecards and controls fit with no observed horizontal pageoverflow.
- Browser OfflineAudioContext tests pass for engine, pickup,zombie,collision,win/loss cues, stacked cues, same-frame cooldowns, exact muted/paused silence, safepreunlockcalls, and cancellation of one-shot tails onpause/resume. Enginepeak~.259; combinedeffectspeak~.042. Inspected browser gameplaylogs contain no errors/warnings.
- Late-stagebrowserfixtures use the realbundle plus changedinitialstage/resources and separate QAstorage. They are ignored and excluded fromdist; they do not change the user's production campaign.

No requested gameplay work remains. Publication is the remaining delivery step. After its success, record the new sourcecommit/deploymentID here.

## Known limits and possible refinements

- Audio is synthesized, not a real engine recording. Subjective tuning on actual speakers/headphones and physical phones remains useful.
- Responsive browser emulation is not physical iOS/Android testing. Fullscreen support varies by browser.
- Direct `file://` loading was blocked by the automation browser's HTTP/HTTPS-only policy in the baseline release. The source contract is self-contained; browser QA uses localhost. Users can open the generated HTML locally in a normal browser.
- The 50 ms frame cap causes slow motion below sustained 20 FPS rather than unlimited catch-up. Hidden tabs pause automatically. Simulation is fixed at 120 Hz; graphics read physical transforms directly.
- The campaign is local single-player. Iron Maw is AI, not a network player. The race uses finish order; there is no truck health/damage system.
- The boss uses the same side-view course and can bump or climb the player's tyres. Changes to tuning/filtering should be verified with actual race runs, not visual overlap alone.
- Best records and unlocks depend on localStorage availability; private browsing/file mode may deny it.

## Claude continuation prompt

Continue IRONTRAIL in `/Users/akshaykulkarni/NewGame/irontrail`. Read PLAN.md, HANDOFF.md and README.md, inspect current sources and tests, then continue from the latest recorded expansion status without starting over. The user wants a ten-stage zombie monster-truck campaign with depleting fuel, periodic cans and a final AI rival race with actual collision physics. Keep a single offline HTML deliverable with inline Planck.js and Web Audio, retaining the MIT license. Preserve wheel-joint suspension, physical zombies and truck collisions, the fuel/recovery conservation rules, keyboard/touch controls, campaign unlocks, win/loss/retry/next-stage states and per-stage best records. Edit src files, run python3 build.py, run meaningful physics/audio/browser checks and update the plan/handoff with exact results and remaining work. Developer QA fixtures use separate storage and must not be shipped. When publishing, reuse project_id in .openai/hosting.json and the existing private Site URL via the supported source/packaging workflow; do not create another Site.
