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
11. [x] Package/publish private playable copy; return game and handoff links.

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

All milestones complete. Private deployment succeeded: https://irontrail-monster-rally.mellowdew4.chatgpt.site . Single-file HTML and handoff are ready. See HANDOFF.md for exact validation and continuation instructions.

## Final tuning decisions

- World start X is 7.5 m; finish X is 447.5 m, so the displayed course is exactly 440 m. Progress and checkpoint markers share that origin.
- Wheel radius .72 m, wheelbase 3.14 m, gravity 14 m/s², suspension 4.4 Hz with .85 damping, 48 Nm motor torque per grounded wheel. A modest torque-based slope assist improves playability; it never teleports the body.
- Best air is committed on landing. Falling into a gap does not set a jump record.
- Mobile camera lifts the driving line above touch pedals. Fullscreen uses a flexible scene height.
- Browser audio signal QA found a finite non-clipping engine waveform (~.26 peak) and exact silence while muted. Subjective sound realism is a future listening/tuning task if desired.

# Expansion plan — zombie campaign (2 November 2026)

User request: add zombies on the track, continuously depleting fuel with periodic collectible cans, and ten stages with increasing difficulty. Stage 10 is a race against another monster truck with real vehicle collisions.

## Gameplay decisions

- Keep the original single-file/offline delivery, visual identity, Planck suspension and Web Audio.
- Ten named, individually selectable stages. Winning unlocks the next stage; unlocked stages and per-stage best times persist locally. Stage 1 is initially open. A campaign map shows the progression and the final boss.
- Increase course length, terrain severity, gap size, zombie density and fuel pressure across stages. Stage 10 introduces IRON MAW, an AI-driven physical rival on the same course.
- Zombies are stylized green characters. Physical vehicle contact knocks them into a brief cartoon tumble; no graphic effects. Track the cleared count.
- Fuel drains during active play, with throttle adding consumption. Floating fuel cans appear at regular safe track intervals and refill the tank on contact. The level fails when the tank empties. Fuel freezes on pause and restarts on stage retry.
- Checkpoint recovery costs fuel and run time continues. Depleted fuel never becomes a free refill through recovery; a full stage retry restores the tank/cans.
- Rival truck has its own chassis, wheels and joints. Collision filters suppress self-collision per vehicle but permit player/rival chassis and tyre contact. Restitution, friction, mass and impulse-based effects produce a physical battle. Rival uses motor/torque AI; first across the line wins. No teleporting to overtake.
- Fuel/lose/retry/stage-clear/campaign-win states must be explicit; the next-stage button works and the boss has a race position/distance HUD.

## Expanded API / file ownership

- `src/physics.js`: `TruckPhysics(stageIndex=0)`, static `STAGES`, procedural authored stage layouts, zombies, fuel pickups/depletion, rival AI/collisions, finish winner and resource telemetry/events. Own smoke tests for all stages and collision behavior.
- `src/audio.js`: retain V8 graph and add fuel pickup, zombie impact, truck collision and stage result cues.
- `src/shell.html`: fuel HUD, boss race HUD, ten-stage selector/progression panel, revised labels and responsive presentation.
- `src/game.js`: campaign persistence/state transitions, physics/audio event integration, zombie/fuel/rival rendering and complete UI wiring.
- `build.py`: unchanged four-script bundle contract; regenerate both HTML copies.

## Expansion checklist

1. [x] Open same hosted Site and preserve existing source/project identity.
2. [x] Record expansion plan before implementation; agree module boundaries.
3. [x] Implement ten tuned tracks, resource loop, zombie contact physics, rival AI and collision filtering.
4. [x] Implement fuel/race/progression UI and persistent stage unlocks.
5. [x] Draw zombies, cans and boss truck from simulation state; add event sound/particles.
6. [x] Implement stage retry, fuel failure, boss loss, next-stage and campaign victory.
7. [x] Validate all ten stages, pickups/depletion, recovery, same-vehicle filtering/cross-vehicle impacts and race outcomes; inspect browser desktop/mobile and audio.
8. [x] Update README/HANDOFF with exact new controls, architecture and checks.
9. [x] Rebuild and republish the same private URL; return updated HTML and handoff.

## Continuation note

This expansion supersedes the original single-course scope. Keep historical verification distinguished from expansion results. Resume unchecked work in this section; avoid undoing existing work. Subagents may own individual files, but main agent owns game.js, integration, browser QA and publication.

## Expansion validation results

- All ten stages pass at 60 and 120 Hz. Complete campaign physics checks, all recovery gates, fuel depletion/pickup/conservation/retry, real-contact zombies, self/cross-truck filtering, two-way impulse transfer, both race outcomes, brake/reverse pass.
- The one-second-idle headless runs finish stages1–9 in12.12–26.97 s and stage10 in29.26 s at120 Hz. Boss run includes two vehicle impacts and a minimum18.6 fuel; missing all cans fails later stages.
- Production browser save: stage1 cleared in11.19 s, 5/5zombies,97fuel; stage2 cleared in18.72 s whilecoasting, unlock/continue buttons work and per-stage records persist.
- Isolated browser QA fixtures (separate storage): boss won in31.30 s,26/32zombies,80fuel; actual rival crossing produced a loss/retry at30.21 s in a fixture with an initial opponent lead. Low-fuel fixture reached0, displayedfailure and retry restored100fuel.
- Phone viewport390×844: touch throttle works, fuel drops from100to93, pause keeps time/fuel fixed, campaign scroll and HUD fit. Fullscreen styles avoid resource/pedal overlap; real devices remain untested.
- Audio checks: engine and every new cue audible/finite/belowclipping; stacked events safe; mute/pause producezero; canceled eventtails do not reappear onresume. Inspected gameplay console hasnoerrors/warnings.
- Final build containsfourinline scripts, uniqueUI IDs, noexternalassetdependencies andidentical index/distHTML.

## Expansion delivery

Private deployment succeeded on 2 November 2026 at the existing URL: https://irontrail-monster-rally.mellowdew4.chatgpt.site . All expansion milestones are complete. Published source: b3b6a5aae6656e88b59d6d3dc28043a916e7ae8e. Deployment: appgdep_6ae8c91c083c8191a78f334aaaefd820. Local final notes record the completed delivery; gameplay sources and both generated HTML files match the published release.

# Weapon encounter plan — one charge, one monster

User request: mount a gun on the monster truck with exactly one shot per round. Place one monster randomly on the track. The player must fire to clear it; hitting it alive ends the run.

## Decisions

- A round means one stage attempt. Each new stage/full retry starts with one charge and one newly randomized large monster. Checkpoint recovery does not restore ammunition or reroll/resurrect the monster.
- Keep the existing zombies, ten stages, fuel loop and final rival race. The new large monster is a distinct, mandatory encounter on every stage.
- Mount an auto-aiming forward cannon on the truck. Press X or J, or tap/click the dedicated FIRE button. One press consumes the charge, even if the shot misses or is fired too early. Holding a key/button never reloads it.
- A 45 m aim window and visible distance/lock indicator give fair notice on phones. A projectile traces its actual path against the physics world; terrain can block the shot. An impact clears the monster with a brief cartoon effect.
- Spawn the monster at one of many safe interior track positions, away from gaps, spawn, finish and checkpoint pads. It remains stationary for that attempt. Tests inject a seeded random source; production uses Math.random.
- A living monster physically collides with the player and causes immediate game over. Crossing past it alive also fails, preventing jump/recovery skips. Iron Maw cannot clear the player's target or shoot the player's charge.
- Add explicit ammo/target HUD, aiming/recoil/shot trail/monster artwork, gunshot/hit/crash sounds, and a monster-crash retry explanation. Preserve the single offline HTML contract.

## Ownership / APIs

- `src/physics.js`: optional constructor RNG, one monster, one charge, fire/projectile/raycast collision, mandatory encounter/failure, recovery invariants. `getState()` adds ammo, monster, projectile, weapon {muzzle,angle,range,canHit,distance}. New events: shot, monsterHit, monsterCrash. Failure: monster.
- `src/game.js`: X/J and FIRE event wiring, encounter HUD and warnings, mounted cannon and monster/projectile rendering, failure/clear effects, campaign integration.
- `src/shell.html`: ammo/target/FIRE controls and responsive layout. Keep old control IDs.
- `src/audio.js`: gunshot, monsterHit, monsterCrash cues and signal checks.

## Checklist

1. [x] Reopen the same Site and record this plan before integration.
2. [x] Implement/test random encounter, one-shot projectile, crash and recovery rules.
3. [x] Add gun/monster rendering, ammo/lock HUD, keyboard/touch controls and failure flow.
4. [x] Add/test gunshot, monster hit and crash audio.
5. [x] Test hit, early miss, empty charge, crash, recovery/retry, all ten stages and browser desktop/phone controls.
6. [ ] Update README/HANDOFF, rebuild portable HTML and republish the existing private URL.

## Weapon validation results

- Source syntax, bundle checks and physics smoke pass. All ten stages still complete at 60 and 120 Hz when the one shot is fired on a valid lock.
- A further 100 simulated runs cover ten stages, five random placements and both rates. Monster position varies safely; the worst first clear firing line opened at 37.9 m, with most opening at 45 m.
- Focused checks cover exactly one monster, early misses, repeated/held fire, terrain occlusion, high-speed raycasts, lethal contact, jump/finish/checkpoint bypass rejection, charge/monster/projectile conservation on recovery, and full-retry reload/reroll.
- Browser: unshot monster caused failure at 8.94 s; an early shot spent the charge and a later collision caused failure at 10.13 s. A new retry restored 1/1; X fired on lock at 33 m, cleared the monster with 0/1 remaining, and the stage finished at 12.43 s.
- Phone 390×844: dedicated FIRE tap cleared the target, changed ammo from 1/1 to 0/1, and disabled FIRE. HUD and controls fit. Inspected gameplay logs have no errors/warnings.
- Audio validation passes for gunshot, monster hit/crash and all earlier cues, stacked effects, silence while muted/paused and voice cancellation.
- Preview image: preview-cannon.jpg. Publication is the remaining delivery step.
