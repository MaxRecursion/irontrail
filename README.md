# IRONTRAIL — Monster Rally

A complete single-page 2D monster truck rally. Open **index.html** in a modern browser and press **Start your engine**. The file contains its physics library, graphics, UI and procedural audio; it works without a network connection.

## Play

- Up / W: throttle
- Down / S: reverse
- Left / A and Right / D: balance in the air
- Space: brake
- C: recover at the last checkpoint (run clock continues)
- R: new run
- P / Escape: pause or resume
- M: mute / unmute
- F: fullscreen, where supported

Phone controls are on screen. Ramps launch the truck physically. Keep the wheels under you and follow the flags to the finish. The 440 m course includes three gaps and three recovery checkpoints. Best time is stored in the browser when storage is available.

## Build and validate

```sh
python3 build.py
node tests/physics-smoke.cjs
python3 -m http.server 4173 --bind 127.0.0.1
```

Open http://127.0.0.1:4173/ to play. Open http://127.0.0.1:4173/tests/audio-check.html for Web Audio signal validation. Node is only needed for the physics smoke test; no npm install is required.

Edit files in `src/` and rebuild. `index.html` and `dist/index.html` are generated, identical outputs. `dist/` is the hosted static directory. Planck.js 1.5.0 is included under its MIT license in `vendor/LICENSE-planck.txt` and in the bundled HTML.

Read `PLAN.md` and `HANDOFF.md` for architecture, completed milestones, testing and a Claude continuation prompt.
