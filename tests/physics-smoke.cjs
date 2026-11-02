/* Run: node tests/physics-smoke.cjs [optional path to Planck UMD build] */
const assert = require('node:assert/strict');
const path = require('node:path');
global.planck = require(process.argv[2] || path.join(__dirname, '../vendor/planck.min.js'));
require('../src/physics.js');
const V = global.planck.Vec2;

function advance(game, seconds, controls = {}) {
  for (let i = 0; i < seconds * 120; i++) game.step(1 / 120, controls);
}
function moveTruck(vehicle, x, y, vx = 0) {
  const origin = vehicle.chassis.getPosition(), dx = x - origin.x, dy = y - origin.y;
  for (const body of [vehicle.chassis, ...vehicle.wheels]) {
    const p = body.getPosition(); body.setTransform(V(p.x + dx, p.y + dy), 0);
    body.setLinearVelocity(V(vx, 0)); body.setAngularVelocity(0);
  }
}

assert.equal(TruckPhysics.STAGES.length, 10);
for (let i = 1; i < 10; i++) {
  const before = TruckPhysics.STAGES[i - 1], after = TruckPhysics.STAGES[i];
  for (const field of ['length', 'difficulty', 'fuelDrain', 'fuelInterval', 'zombieCount', 'gapWidth']) {
    assert.ok(after[field] > before[field], `${field} increases across the campaign`);
  }
}
assert.ok(TruckPhysics.STAGES[9].boss && !TruckPhysics.STAGES[8].boss);

for (const dt of [1 / 120, 1 / 60]) for (let stage = 0; stage < 10; stage++) {
  const game = new TruckPhysics(stage);
  let elapsed = 0, minFuel = 100, takeoffs = 0, landings = 0, pickups = 0, impacts = 0;
  const actualZombieContacts = new Set();
  game.world.on('begin-contact', contact => {
    const a = contact.getFixtureA().getBody().getUserData(), b = contact.getFixtureB().getBody().getUserData();
    if (a?.type === 'zombie' && b?.type === 'vehicle') actualZombieContacts.add(a.entity.id);
    if (b?.type === 'zombie' && a?.type === 'vehicle') actualZombieContacts.add(b.entity.id);
  });
  while (elapsed < 65 && !game.finished && !game.failed) {
    game.step(dt, { throttle: elapsed < 1 ? 0 : 1 }); elapsed += dt;
    const s = game.getState(); minFuel = Math.min(minFuel, s.fuel);
    assert.ok([s.x, s.y, s.angle, s.vx, s.vy, s.fuel].every(Number.isFinite));
    assert.ok(s.y > -15, 'clean throttle does not fall through terrain or miss a gap');
    assert.ok(s.fuel >= 0 && s.fuel <= 100);
    for (const event of game.drainEvents()) {
      if (event.type === 'takeoff') takeoffs++;
      if (event.type === 'land') landings++;
      if (event.type === 'fuel') { pickups++; assert.ok(event.amount >= 0 && event.amount <= 32); }
      if (event.type === 'collision') impacts++;
      if (event.strength !== undefined) assert.ok(event.strength >= 0 && event.strength <= 1);
    }
  }
  assert.equal(game.winner, 'player', `stage ${stage + 1} is rideable at ${1 / dt} Hz`);
  assert.ok(game.finished && !game.failed);
  assert.equal(game.checkpointIndex, game.track.checkpoints.length - 1);
  assert.equal(game.track.finishX - game.track.startX, game.track.length);
  assert.ok(pickups >= 3 && takeoffs >= 2 && landings >= 1);
  assert.ok(game.cleared > 0 && game.cleared <= actualZombieContacts.size, 'zombie clears require actual solid vehicle contacts');
  assert.equal(game.cleared, game.zombies.filter(z => !z.alive && z.hit).length);
  for (let i = 1; i < game.track.segments.length; i++) {
    const prev = game.track.segments[i - 1], next = game.track.segments[i];
    assert.ok(next[0].x - prev[prev.length - 1].x >= game.stage.gapWidth - 0.01, 'no chain bridges an actual gap');
  }
  console.log(`PASS ${1 / dt} Hz stage ${stage + 1}: ${elapsed.toFixed(2)}s, ${pickups} cans, ${game.cleared}/${game.zombies.length} zombies, fuel floor ${minFuel.toFixed(1)}, ${impacts} vehicle impacts`);
}

// All recovery gates are on safe, flat landing aprons. A recovery charges fuel.
for (let stage = 0; stage < 10; stage++) {
  const count = new TruckPhysics(stage).track.checkpoints.length;
  for (let cp = 0; cp < count; cp++) {
    const game = new TruckPhysics(stage), bodies = game.world.getBodyCount();
    assert.equal(game.reset(cp), true); assert.equal(game.fuel, 88);
    advance(game, 1.5);
    const s = game.getState();
    assert.ok(s.grounded && s.y > 0.5 && Math.abs(s.angle) < 0.22, `stage ${stage + 1} checkpoint ${cp} is safe`);
    assert.equal(game.world.getBodyCount(), bodies, 'recovery does not leak bodies');
  }
}
const recovery = new TruckPhysics(9);
advance(recovery, 8, { throttle: 1 }); recovery.drainEvents();
const oldFuel = recovery.fuel, oldCleared = recovery.cleared;
const collected = recovery.fuelCans.map(can => can.collected), zombieBodies = recovery.zombies.map(z => z.body);
const rivalBody = recovery.rival.chassis, rivalX = rivalBody.getPosition().x;
assert.equal(recovery.reset(recovery.checkpointIndex), true);
assert.ok(Math.abs(recovery.fuel - (oldFuel - 12)) < 1e-8);
assert.equal(recovery.cleared, oldCleared); assert.deepEqual(recovery.fuelCans.map(can => can.collected), collected);
assert.deepEqual(recovery.zombies.map(z => z.body), zombieBodies);
assert.equal(recovery.rival.chassis, rivalBody); assert.equal(rivalBody.getPosition().x, rivalX);
while (!recovery.failed) recovery.reset(0);
assert.equal(recovery.failed, 'fuel'); assert.equal(recovery.fuel, 0); assert.equal(recovery.reset(), false);
recovery.restart();
assert.equal(recovery.fuel, 100); assert.equal(recovery.cleared, 0); assert.equal(recovery.failed, null);
assert.ok(recovery.fuelCans.every(can => !can.collected) && recovery.zombies.every(z => z.alive));

const fuelFailure = new TruckPhysics(8);
fuelFailure.fuelCans = []; // Simulate missing every optional pickup.
advance(fuelFailure, 40, { throttle: 1 });
assert.equal(fuelFailure.failed, 'fuel'); assert.ok(!fuelFailure.finished && fuelFailure.fuel === 0);
assert.equal(fuelFailure.drainEvents().filter(e => e.type === 'empty').length, 1);
const stopped = fuelFailure.getState().x;
advance(fuelFailure, 1, { throttle: 1 }); assert.equal(fuelFailure.getState().x, stopped);
assert.equal(fuelFailure.drainEvents().length, 0);

// Isolate a midair impact to prove collision impulses transfer momentum both ways.
const collision = new TruckPhysics(9);
collision.world.setGravity(V(0, 0));
moveTruck(collision.player, 20, 20, 14); moveTruck(collision.rival, 26, 20, 0);
const playerFixture = collision.chassis.getFixtureList(), rivalFixture = collision.rival.chassis.getFixtureList();
assert.equal(playerFixture.getFilterGroupIndex(), -1); assert.equal(rivalFixture.getFilterGroupIndex(), -2);
assert.equal(playerFixture.shouldCollide(collision.wheels[0].getFixtureList()), false);
assert.equal(rivalFixture.shouldCollide(collision.rival.wheels[0].getFixtureList()), false);
assert.equal(playerFixture.shouldCollide(rivalFixture), true);
let physicalImpulse = 0;
collision.world.on('post-solve', (contact, impulse) => {
  const a = contact.getFixtureA().getBody().getUserData(), b = contact.getFixtureB().getBody().getUserData();
  if (a?.type === 'vehicle' && b?.type === 'vehicle' && a.owner !== b.owner) physicalImpulse += impulse.normalImpulses.reduce((sum, n) => sum + n, 0);
});
advance(collision, 0.8);
assert.ok(physicalImpulse > 20 && collision.getState().vx < 11 && collision.getState().rival.vx > 3, 'physical two-way momentum response');
assert.ok(collision.drainEvents().some(e => e.type === 'collision'));

// A missed jump leaves room for the opponent to win; no forced finish flags.
const rivalWin = new TruckPhysics(9);
moveTruck(rivalWin.player, rivalWin.track.startX, -25);
advance(rivalWin, 35);
assert.equal(rivalWin.winner, 'rival'); assert.equal(rivalWin.failed, 'rival'); assert.equal(rivalWin.finished, false);
assert.ok(rivalWin.getState().rival.x >= rivalWin.track.finishX && rivalWin.fuel > 0);

const brakes = new TruckPhysics(); advance(brakes, 3, { throttle: 1 });
const beforeBrake = brakes.getState().speed; advance(brakes, 1, { brake: true });
assert.ok(Math.abs(brakes.getState().speed) < beforeBrake * 0.4);
const reverse = new TruckPhysics(); advance(reverse, 2, { throttle: -1 });
assert.ok(reverse.getState().x < reverse.track.startX);
console.log('PASS all recovery gates, fuel conservation/failure/retry, contact filtering, two-way collision impulse, rival victory, brakes and reverse');
