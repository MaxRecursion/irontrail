# IRONTRAIL — Deadland Rally

A single-page 2D monster truck campaign through zombie country, with one cannon charge and one large monster to stop in every round. Open **index.html** in a modern browser and press **Start your engine**. The portable file contains its physics library, graphics, interface and synthesized audio; gameplay has no network dependencies.

Private playable URL: https://irontrail-monster-rally.mellowdew4.chatgpt.site

The ten-stage zombie/fuel campaign is published. The new single-charge cannon and random-monster update is implemented locally; its verification has passed and publication is being finalized. See `HANDOFF.md` for the latest verified result.

## Play

- Up / W: throttle
- Down / S: reverse
- Left / A and Right / D: balance in the air
- Space: brake
- X / J, or the on-screen FIRE button: fire the cannon once
- C: recover at the last checkpoint, spending **12% fuel**; the run clock continues
- R: retry the current stage with a fresh tank, pickups and cannon charge
- P / Escape: pause or resume
- M: mute / unmute
- F: fullscreen, where supported

Touch controls are on screen. Use **Choose stage** or the map icon to open the campaign. Finish a stage to unlock the next one; cleared stages remain replayable. The game saves unlocks, selected stage and per-stage best times locally when browser storage is available. Ammunition and monster state belong to the current attempt and are not campaign-save rewards.

Fuel drains continuously during active play, including at idle. Throttle increases consumption. Collect the amber cans along the track to restore **up to 32% fuel**, capped at 100%. Emptying the tank ends the run. Pause freezes the fuel and rival. Checkpoint recovery preserves collected cans and cleared zombies, so it never supplies a free refill.

Every attempt places one large monster at a random safe location on the route. Your roof-mounted cannon has **one charge for the entire attempt**. Wait for the green **TARGET LOCKED** indication, then press X / J or tap FIRE. Firing too early or into terrain can waste the charge. An unshot monster ends the run when you reach it; retry for a fresh charge. Checkpoint recovery preserves spent ammunition and the current monster, so it does not supply another shot.

Zombies physically tumble when a truck hits them. Keep your wheels underneath you, collect fuel and reach the stage finish. Stage 10 is a race against **Iron Maw**, an AI monster truck with its own suspension and solid vehicle collisions. First truck across the line wins. Lose the race or run dry to retry the stage.

## Ten-stage campaign

| Stage | Route | Length | Fuel-can interval |
| --- | --- | ---: | ---: |
| 01 | Redstone Outbreak | 220 m | 51 m |
| 02 | Dry Creek | 250 m | 54 m |
| 03 | Hollow Ridge | 285 m | 57 m |
| 04 | Graveyard Pass | 320 m | 60 m |
| 05 | Deadwood Dunes | 355 m | 63 m |
| 06 | Rust Canyon | 390 m | 66 m |
| 07 | Bone Valley | 425 m | 69 m |
| 08 | Ashen Heights | 465 m | 72 m |
| 09 | Last Refuge | 510 m | 75 m |
| 10 | Iron Maw Showdown | 560 m | 78 m |

Routes grow longer, gaps and hills become more demanding, zombie density rises, and fuel pressure increases. Can placement is shifted onto safe ground near the nominal intervals.

## Build and validate

```sh
python3 build.py
node --check src/physics.js
node --check src/audio.js
node --check src/game.js
node tests/physics-smoke.cjs
python3 -m http.server 4173 --bind 127.0.0.1
```

Open http://127.0.0.1:4173/ to play, and http://127.0.0.1:4173/tests/audio-check.html for Web Audio signal validation. No npm install is required. Node is needed only for JavaScript syntax and physics checks; the bundler uses the Python standard library.

Optional browser QA fixtures let developers inspect late stages or fuel failure without changing the shipped campaign:

```sh
python3 tests/make-browser-fixture.py --stage 10 --output boss-preview.html
python3 tests/make-browser-fixture.py --stage 1 --fuel 1 --output fuel-preview.html
```

Open `/tests/boss-preview.html` or `/tests/fuel-preview.html` on the local server. Fixtures use the separate `irontrail-campaign-qa-only` storage key and are excluded from the hosted `dist/` output. Production campaign progress uses `irontrail-campaign-v1`.

Edit `src/`, then rebuild. Generated `index.html` and `dist/index.html` must remain identical. `dist/` is the hosted static directory. Planck.js 1.5.0 is included under its MIT license in `vendor/LICENSE-planck.txt` and in the bundled HTML. Preserve the license and the single-file contract.

Read `PLAN.md` and `HANDOFF.md` for architecture, current verification, remaining work and a Claude continuation prompt.
