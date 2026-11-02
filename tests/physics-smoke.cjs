/* Run: node tests/physics-smoke.cjs [optional path to Planck UMD build] */
const assert = require('node:assert/strict');
const path = require('node:path');
global.planck = require(process.argv[2] || path.join(__dirname, '../vendor/planck.min.js'));
require('../src/physics.js');

for (const dt of [1 / 120, 1 / 60]) {
  const game = new global.TruckPhysics();
  let takeoffs = 0, landings = 0, peakFlight = 0, elapsed = 0;
  while (elapsed < 45 && !game.finished) {
    game.step(dt, { throttle: elapsed < 1 ? 0 : 1 });
    elapsed += dt;
    const state = game.getState();
    assert.ok([state.x, state.y, state.angle, state.vx, state.vy].every(Number.isFinite), 'finite truck telemetry');
    assert.ok(state.y > -15, 'continuous-throttle route does not fall through terrain or into a gap');
    peakFlight = Math.max(peakFlight, state.airtime);
    for (const event of game.drainEvents()) {
      if (event.type === 'takeoff') takeoffs++;
      if (event.type === 'land') landings++;
      assert.ok(event.strength >= 0 && event.strength <= 1);
    }
  }
  assert.ok(game.finished, `course completes with normal throttle at ${1 / dt} Hz`);
  assert.equal(game.checkpointIndex, game.track.checkpoints.length - 1);
  assert.ok(takeoffs >= 3 && landings >= 3 && peakFlight > 0.5, 'ramps create physical airborne and landing transitions');
  console.log(`PASS ${1 / dt} Hz: finish ${elapsed.toFixed(2)}s, ${takeoffs} takeoffs, ${landings} landings, longest flight ${peakFlight.toFixed(2)}s`);
}

const recovery = new global.TruckPhysics();
for (let i = 0; i < recovery.track.checkpoints.length; i++) {
  recovery.reset(i);
  for (let frame = 0; frame < 240; frame++) recovery.step(1 / 120, {});
  const state = recovery.getState();
  assert.ok(state.grounded && state.y > 0.5 && Math.abs(state.angle) < 0.2, `checkpoint ${i} spawns safely on its track`);
  assert.equal(recovery.world.getBodyCount(), 4, 'repeated recovery does not leak truck bodies');
}

recovery.reset();
for (let frame = 0; frame < 360; frame++) recovery.step(1 / 120, { throttle: 1 });
const beforeBrake = recovery.getState().speed;
for (let frame = 0; frame < 120; frame++) recovery.step(1 / 120, { brake: true });
assert.ok(Math.abs(recovery.getState().speed) < beforeBrake * 0.4, 'brakes dissipate wheel and vehicle motion');
recovery.reset();
for (let frame = 0; frame < 240; frame++) recovery.step(1 / 120, { throttle: -1 });
assert.ok(recovery.getState().x < recovery.track.checkpoints[0].x, 'reverse drives left');
console.log('PASS checkpoint recovery, no reset leaks, braking, reverse');
