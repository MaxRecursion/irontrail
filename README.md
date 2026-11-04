# IRONTRAIL — Deadland Rally

A self-contained 2D monster truck game: ten increasingly demanding routes, physical zombies, depleting fuel, a single-charge cannon, and a final race against Iron Maw.

Play: https://irontrail.maxrecursion.dev . Vercel fallback: https://irontrail-iota.vercel.app . Source: https://github.com/MaxRecursion/irontrail. Open `index.html` in a modern browser. All physics, graphics, music and effects are inside that one file. No installation or network assets are needed.

## Play

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Throttle | Up / W | RT |
| Reverse | Down / S | LT at low speed |
| Brake | Space | LT while moving forward |
| Air balance / self-right | Left / A, Right / D | Left stick / D-pad |
| Fire once | X / J or FIRE | A |
| Recover at checkpoint | C | X |
| Retry stage | R | Y |
| Pause / resume | P / Escape | Start / B |
| Mute | M | Settings menu |
| Fullscreen | F | On-screen button |

Touch pedals and a separate FIRE button appear on small or touch screens. Menus support keyboard and gamepad navigation. Sound starts after the first pointer/key gesture; browsers may require a click before gamepad audio can play.

Each attempt gives you **one cannon charge and one randomly placed giant monster**. Wait for the green target lock and fire. Early shots can miss or hit terrain. Reaching or passing a living monster ends the run. Holding FIRE never reloads it.

Fuel burns while playing, even at idle. Amber cans restore up to **32 fuel**, capped at 100. Recovery costs **12 fuel** and preserves ammunition, the monster, cans, zombies and rival progress. A full retry supplies a new tank, charge and random encounter. Pause freezes the run and rival.

Clear stages to unlock the next route. Earn stars for survival, par time and a route-specific challenge. Score combos, landed flips, perfect landings and big air earn scrap for engine, tyre, suspension and fuel-system upgrades. Your fastest clear leaves a ghost replay. Unlocks and earlier v2 records migrate automatically when browser storage is available.

## Campaign

| Stage | Route | Distance | Par |
| --- | --- | ---: | ---: |
| 01 | Redstone Outbreak | 220 m | 15 s |
| 02 | Dry Creek | 250 m | 17 s |
| 03 | Hollow Ridge | 285 m | 20 s |
| 04 | Graveyard Pass | 320 m | 22 s |
| 05 | Deadwood Dunes | 355 m | 24 s |
| 06 | Rust Canyon | 390 m | 27 s |
| 07 | Bone Valley | 425 m | 29 s |
| 08 | Ashen Heights | 465 m | 32 s |
| 09 | Last Refuge | 510 m | 36 s |
| 10 | Iron Maw Showdown | 560 m | 40 s |

Each route has its own palette, landscape, props and weather. Stage 10 uses two independently simulated trucks with solid chassis/tyre collisions. Iron Maw drives, balances and rights itself through motors and torque; it never teleports or rubber-bands.

## Smoothness and sound

Planck.js runs at a fixed 120 Hz. Rendering interpolates between simulation poses, with cached artwork, bounded effects, a smooth camera and adaptive quality. Auto quality lowers resolution/effects after sustained missed frames and restores detail when there is headroom. Settings also offer High, Balanced and Performance, separate volume controls, reduced motion and an FPS overlay.

120 Hz simulation and rendering support do not guarantee 120 displayed frames on every device. The display, browser and hardware determine the actual rate. Music and V8/jump/impact sounds are synthesized with Web Audio, rather than engine recordings.

## Build and checks

No npm dependencies are required. Python and Node are development tools only.

```sh
python3 build.py
python3 tests/bundle-check.py
node tests/physics-smoke.cjs
node tests/rules-check.cjs
node tests/pacing-check.cjs
node tests/render-check.cjs
python3 -m http.server 4173 --bind 127.0.0.1
```

Browser checks on localhost:

- `/tests/audio-check.html`: real OfflineAudioContext signal, silence, resume and scheduler checks.
- `/tests/audio-live-check.html`: click-only activation and actual running output, engine, cannon, mute/pause checks.
- `/tests/ui-harness.html`: real shell/UI at desktop, phone and landscape dimensions.
- `/tests/render-harness.html?stage=10`: scripted real physics and instrumented Canvas rendering; `?cycle=1` tours the biomes.
- `/tests/integration-harness.html`: isolated gameplay, progression and frame timing checks.

`tests/make-browser-fixture.py` creates isolated developer previews from the current build. Test pages and fixtures are excluded from the deployed `dist/` directory. Claude's optional `page-check.mjs` and `perf-bench.mjs` remain available for a developer-controlled Chrome session; they were not used for this release's browser checks.

Edit `src/`, then rebuild. Generated `index.html` and `dist/index.html` must be identical. Preserve Planck.js 1.5.0 and its inline MIT license. `PLAN.md`, `SPEC.md` and `HANDOFF.md` contain module contracts, exact verification results and continuation instructions. The historical Sites identity remains in `.openai/hosting.json`; production uses the existing GitHub/Vercel project.

## Shooting update

A short automatic aim window eases into slow motion. Firing slows the complete world to22% speed, tracks the shot, adds an impact ring, and smoothly restores pace. The rival, fuel and run/ghost clock share the same simulation time. The one-charge rule and actual projectile raycast still apply. Reduced motion keeps normal speed and removes camera emphasis. Crosshair pulses, one ammo pip, animated icon cues and numeric rewards replace long gameplay prompts.

Vercel builds the portable file with `python3 build.py`, serves `dist/`, and is connected to the public GitHub repository. The custom domain uses a Namecheap CNAME host `irontrail` → `1c83a48bcee72fc4.vercel-dns-017.com.`. Keep other DNS records unchanged.

## Sound update

“Deadland Run” is an original eight-bar synth-rock score with a repeating hook, answering melody, syncopated bass, drums and a stronger boss arrangement. Jump release, suspension, rising flight wind, weight-sensitive landings, steel collisions, cannon recoil/echo and directional monster impacts are synthesized inside the HTML. Slow motion filters the score and lowers engine pitch; cannon and impact cues briefly lower the backing mix. Settings keep separate music, effects and master controls. No audio downloads or licensed recordings are required.

Audio troubleshooting: Settings → Test sound plays two tones and shows a post-limiter output meter. Click/touch/keyboard activation can retry a suspended or interrupted context. The optional `?audioDebug=1` URL displays local output measurements for live-site QA; it requests no microphone access and sends no recordings.

Impact update: cannon and collision audio have sharper attacks, a stronger midrange body and deeper engine/music ducking. A larger muzzle flash, stronger barrel recoil and more collision sparks reinforce the hit. Camera shake amplitude is doubled; Camera Shake off and Reduced Motion still suppress it.
