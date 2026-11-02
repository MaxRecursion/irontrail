# IRONTRAIL handoff — ready to play

## User request and current result

The user requested a single HTML 2D monster truck game with realistic engine/jump sound, correct physics/animation, and a plan first so Claude can continue if usage runs out. The plan was written before implementation. The game is now complete, playable and bundled; private hosting is being finalized.

Portable game: `/Users/akshaykulkarni/NewGame/irontrail/index.html` (about 363 KB).
Project directory: `/Users/akshaykulkarni/NewGame/irontrail`.
`dist/index.html` is an identical copy used by hosting. No CDN/network/audio assets are needed to play. No package install is needed to build.

## Features implemented

- 440 m desert course, hills, physical launch ramps, three real 4 m gaps, three checkpoint gates and a finish/replay state.
- Planck.js 1.5.0, AWD motors, actual wheel joints with spring/damper suspension, collision contact detection, physical air rotation and a modest torque-based grounded slope assist.
- Canvas truck artwork follows physical chassis/wheel transforms; visible coilovers, rotating tyre tread, dust, landing shake, parallax mountains, desert scenery and signs.
- Keyboard and touch controls; brake, reverse, airborne balance, checkpoint recovery, pause/resume, restart, fullscreen and mute.
- Run timer, normalized distance/progress, completed-jump airtime record, speed, gear/RPM, local best time.
- Procedural V8 engine firing harmonics, RPM/automatic gear/load response, exhaust/gravel noise, airborne wind, suspension release and impact-scaled layered landing sound.

## Build / run / verify

```sh
cd /Users/akshaykulkarni/NewGame/irontrail
python3 build.py
node tests/physics-smoke.cjs
python3 -m http.server 4173 --bind 127.0.0.1
```

Play at `http://127.0.0.1:4173/`. For audio signal validation open `http://127.0.0.1:4173/tests/audio-check.html` in a browser. You can also open `index.html` directly as a local file.

Do not edit generated HTML. Edit `src/`, then rebuild.

## Source map / integration contracts

- `src/shell.html`: semantic UI, responsive CSS, canvas and overlays, inline script placeholders.
- `src/physics.js`: global `TruckPhysics`. Owns world, terrain, truck and contacts. `.step(dt,{throttle,brake,lean})`, `.getState()`, `.drainEvents()`, `.reset(checkpointIndex)`. `.track`, `.checkpointIndex`, `.finished` expose course progress. All units are metres/seconds/radians; Y is up. Lean +1 rotates nose down. State exposes actual body transforms, velocity, wheel speed, grounding and airborne duration.
- `src/audio.js`: global `TruckAudio`. `.unlock()` must run from a gesture. `.update(state,dt)`, `.setMuted(bool)`, `.setPaused(bool)`, `.takeoff(strength)`, `.landing(strength)`. `.rpm` and `.gear` drive HUD. Locked calls are safe.
- `src/game.js`: UI and state machine (`ready`, `playing`, `paused`, `finished`), input, fixed 120 Hz accumulator, renderer, camera, HUD, persistence and audio integration.
- `vendor/planck.min.js`, `vendor/LICENSE-planck.txt`: pinned MIT library. Keep license in the HTML.
- `build.py`: Python standard-library bundler, writes both HTML outputs.
- `tests/physics-smoke.cjs`: deterministic physical completion, event counts, recovery, leaks, reverse/braking, 60/120 Hz comparison.
- `tests/audio-check.html`: OfflineAudioContext signal checks, muted silence and safe pre-unlock API calls.
- `.openai/hosting.json`: private Sites project ID and static directory. Reuse project ID; never create a replacement Site to update it.

Read-only diagnostic handle in browser: `window.irontrail` provides `mode`, `telemetry`, `physics`, `audio`.

## Physics tuning and course coordinates

- Start X=7.5, finish X=447.5, length=440; use `(x-startX)/length` consistently.
- Radius .72 m, wheelbase 3.14 m; gravity (0,-14).
- Suspension 4.4 Hz / damping .85; motor torque 48 grounded, 7 airborne; max motor speed -34 rad/s forward, +13 reverse. Brake torque125.
- All truck fixtures collision group -1; tyre friction1.55; ground friction .95.
- Track uses separate connected chains across gaps, avoiding invisible gap collisions and internal-edge catches.
- Successful landing events carry flight duration and impact strength. Best-air record commits only on landing.

## Verification actually performed

- Python build succeeds, all three JS source files pass `node --check`, generated outputs are identical.
- Physics smoke: after final course origin correction, continuous throttle completes in22.40 s at120 Hz and22.38 s at60 Hz,11 takeoffs/10 landings, longest flight1.13 s. Checkpoint reset, body count, braking and reverse checks pass.
- Real browser: full run reaches finish/replay; pause/resume work; no error/warning console entries in inspected logs. Earlier UI run before the final7.5 m finish extension completed in21.55 s. Final extension is verified by the physics smoke test.
- Real browser at390×844: responsive layout has no horizontal overflow; pointer-held throttle moves truck, HUD/progression/checkpoint work. Driving camera was subsequently lifted to keep the flat-track truck above pedals. Fullscreen responsive CSS added for short landscape viewports.
- Audio OfflineAudioContext: finite engine signal, peak~.257, RMS~.063, no clipped samples; mute peak=0; pre-unlock API calls safe. Actual gesture unlock in browser gameplay caused no warnings/errors.
- Single-file validation checks absence of external script/style/image/network dependencies. Audio is synthesized; subjective listening on actual speakers/headphones remains a potential refinement, not a recorded-engine realism claim.
- `preview.jpg` contains a full-page visual QA screenshot.

## Known limits / optional future work

No required gameplay feature is unfinished. Potential follow-on improvements:

1. Subjectively tune engine/landing timbre on speakers and phones, or add licensed recordings encoded inline for greater recorded realism.
2. Add more tracks, difficulty choices, or visual truck customization while retaining the one-file delivery contract.
3. Add interpolated transforms if physics stepping becomes visible on high-refresh displays. Current120 Hz simulation reads physical transforms directly.
4. At sustained rendering below20 FPS, the50 ms frame clamp intentionally causes slow motion rather than unlimited catch-up. Hidden tabs pause automatically.
5. Local best time uses localStorage key `irontrail-best-v2`; storage can be denied in private/file mode. The game still runs.
6. Mobile layout/pedal input was tested in responsive desktop browser mode, not on physical iOS/Android devices. Fullscreen depends on browser support.

## Claude continuation prompt

Continue IRONTRAIL in `/Users/akshaykulkarni/NewGame/irontrail`. Read PLAN.md, HANDOFF.md and README.md, inspect existing sources, then implement the user's next requested improvements without starting over. The original game is already complete. Keep the deliverable as a single offline HTML page with inline Planck physics and Web Audio, retaining the library MIT license. Preserve real wheel-joint suspension, collision-driven jumps/landings, keyboard/touch controls, checkpoint recovery, complete run loop, and the authored course. Edit src files, rebuild with python3 build.py, run node tests/physics-smoke.cjs, inspect audio-check.html and perform relevant browser checks. Update the plan/handoff with exact results and any remaining work. If republishing, reuse project_id in .openai/hosting.json and follow the supported Sites source/packaging workflow; do not create another Site.
