# IRONTRAIL — implementation plan and cross-model handoff

User brief: A single HTML page containing a playable 2D monster truck track game, with realistic engine and jump sounds, correct physics/animation, and enough durable planning to continue development in Claude.

## Product and delivery decisions

- Deliver `index.html` as one self-contained, offline-capable file. No CDN, remote fonts, audio downloads, framework, or runtime build tools required.
- Build a polished side-view desert rally: oversized tyres, visible moving suspension, undulating dirt, ramps, gaps, checkpoint flags, a finish line, dust, parallax mountains, and a camera that follows the truck.
- Use Planck.js 1.5.0 (Box2D algorithms) with rigid bodies, motorized wheel joints, spring/damper suspension, friction, collision contacts, and a fixed simulation timestep. Canvas draws the actual body transforms.
- Use procedural Web Audio: engine combustion pulses, RPM-dependent harmonics/exhaust/noise, load and gear response, airborne wind/takeoff and suspension/tyre landing transients. Audio starts only after a user gesture; mute is available. Procedural synthesis is an approximation, not a claim of recorded real-engine audio.
- Desktop keyboard and mobile pointer controls: throttle/reverse/brake, airborne balance, restart, pause, sound. Ramps cause physical jumps; no artificial jump button is needed.
- One complete authored course, checkpoints, timer, distance/progress, speed/RPM, airtime/best jump, local best time, recovery after flipping, and a finish/replay state.
- Private hosted playable copy through Sites, plus the portable local file. No accounts or backend required for gameplay.

## Architecture and ownership

`src/shell.html`: page UI, responsive CSS, canvas, overlays, controls, placeholders for inline scripts.
`src/physics.js`: `TruckPhysics` owns Planck world, track, truck bodies/joints, fixed stepping and telemetry/events. All physics uses metres, seconds, radians; positive Y is up.
`src/audio.js`: `TruckAudio` owns Web Audio lifecycle, continuous engine and one-shot effects.
`src/game.js`: input, state machine, rendering, particles, camera, HUD, timer and audio integration.
`vendor/planck.min.js` + license: pinned third-party physics distribution.
`build.py`: standard-library build to inline all scripts into `index.html`, then copy the same file to `dist/index.html` for hosting.
`PLAN.md`: this plan; update completed work and decisions as implementation progresses.
`HANDOFF.md`: exact working state, run/build steps, validation, remaining tasks, known limits and a copy/paste Claude continuation prompt.

Do not edit generated `index.html` directly. Edit `src/`, then run `python3 build.py`.

## Milestones / execution checklist

1. [x] Inspect workspace; write this plan before implementation.
2. [x] Select physics/audio approach and offline packaging architecture.
3. [x] Vendor physics library and preserve its license.
4. [x] Implement course and stable wheel-joint truck with checkpoint/reset API.
5. [x] Implement gesture-unlocked engine and jump/landing audio.
6. [x] Implement coherent page, canvas environment/truck renderer, HUD and controls.
7. [x] Integrate full playable loop: ready, driving, pause, recovery, finish, replay.
8. [x] Bundle the single file and launch a local preview.
9. [x] Validate keyboard/touch input, progression, jumps, landing, checkpoint recovery, pause/mute/restart, finish and offline loading. Fix observed issues.
10. [x] Update HANDOFF.md with real results and any unfinished items.
11. [ ] Package/publish private playable copy; return game and handoff links.

## Verification / acceptance criteria

- Opening `index.html` directly works with the network disabled; Planck and audio code are inline.
- The initial screen is a designed game scene with a clear start action and concise controls.
- Throttle moves both physical wheels, suspension visibly compresses, truck follows slopes, ramps launch it, landing responds to velocity, and airborne balance applies torque.
- Physics timestep is fixed and frame time is bounded; pause/hidden-tab resume does not create huge simulation steps.
- The course can be completed; checkpoints permit recovery; restart clears run stats; best result persists when storage is available.
- Audio changes with speed/load, responds to takeoff/landing, silences during pause/mute, and starts without autoplay errors.
- Layout fits desktop and phone; all buttons have labels; focus/keyboard behavior is usable.
- No uncaught browser errors. Check source syntax and run targeted physics simulations in Node where available, then inspect/play in a real browser.

## Physics references

- https://piqnt.com/ — Planck overview and Box2D lineage.
- https://piqnt.github.io/planck.js/docs/api/classes/WheelJoint.html — suspension and motor API.
- https://github.com/piqnt/planck.js/blob/master/example/Car.ts — official car demo.

## Continuation protocol (Codex or Claude)

Read this file and `HANDOFF.md` first. Inspect the actual sources before changing anything. Preserve the single-file/offline contract and library license. Finish unchecked milestones in order, using the documented API boundaries. Rebuild after edits. Record validation honestly and keep the handoff synchronized. Do not replace Planck physics with visual-only motion or remove procedural audio to simplify the work.

## Status

Implementation and browser QA complete. Single-file bundle is ready. Private publication is being packaged. See HANDOFF.md for exact validation and continuation instructions.

## Final tuning decisions

- World start X is 7.5 m; finish X is 447.5 m, so the displayed course is exactly 440 m. Progress and checkpoint markers share that origin.
- Wheel radius .72 m, wheelbase 3.14 m, gravity 14 m/s², suspension 4.4 Hz with .85 damping, 48 Nm motor torque per grounded wheel. A modest torque-based slope assist improves playability; it never teleports the body.
- Best air is committed on landing. Falling into a gap does not set a jump record.
- Mobile camera lifts the driving line above touch pedals. Fullscreen uses a flexible scene height.
- Browser audio signal QA found a finite non-clipping engine waveform (~.26 peak) and exact silence while muted. Subjective sound realism is a future listening/tuning task if desired.
