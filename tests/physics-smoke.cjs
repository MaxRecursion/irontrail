/* Run: node tests/physics-smoke.cjs [optional path to Planck UMD build] */
const assert = require('node:assert/strict');
const path = require('node:path');
global.planck = require(process.argv[2] || path.join(__dirname, '../vendor/planck.min.js'));
require('../src/physics.js');
const V = global.planck.Vec2;
const make = (stage = 0, roll = 0.5) => new TruckPhysics(stage, { random: () => roll });

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
function clearMonster(game) {
  moveTruck(game.player, game.monster.x - 6, game.monster.y + 1.43);
  assert.ok(game.getState().weapon.canHit);
  assert.equal(game.fire(), true);
  advance(game, 0.2);
  assert.equal(game.monster.alive, false);
}

assert.equal(TruckPhysics.STAGES.length, 10);
for (let i = 1; i < 10; i++) {
  const before = TruckPhysics.STAGES[i - 1], after = TruckPhysics.STAGES[i];
  for (const field of ['length', 'difficulty', 'fuelDrain', 'fuelInterval', 'zombieCount', 'gapWidth']) {
    assert.ok(after[field] > before[field], `${field} increases across the campaign`);
  }
}
assert.ok(TruckPhysics.STAGES[9].boss && !TruckPhysics.STAGES[8].boss);

// Exactly one large monster, sampled from safe terrain, on every new round.
for (let stage = 0; stage < 10; stage++) {
  const positions = new Set();
  for (const roll of [0, 0.2, 0.5, 0.8, 0.999]) {
    const game = make(stage, roll), monster = game.monster;
    let monsters = 0;
    for (let body = game.world.getBodyList(); body; body = body.getNext()) if (body.getUserData()?.type === 'monster') monsters++;
    assert.equal(monsters, 1); assert.equal(game.ammo, 1); assert.ok(monster.alive && monster.height >= 4);
    assert.ok(monster.x - game.track.startX >= 65 && game.track.finishX - monster.x >= 38);
    const segment = game._segmentAt(monster.x);
    assert.ok(monster.x - segment[0].x >= 12 && segment[segment.length - 1].x - monster.x >= 12);
    assert.ok(game.track.checkpoints.every(cp => Math.abs(cp.x - monster.x) >= 14));
    assert.ok(Math.abs(game._heightAt(monster.x + 2) - game._heightAt(monster.x - 2)) / 4 <= 0.055);
    const fixture = monster.body.getFixtureList();
    assert.equal(fixture.shouldCollide(game.chassis.getFixtureList()), true);
    assert.equal(fixture.shouldCollide(game.zombies[0].body.getFixtureList()), false);
    if (game.rival) assert.equal(fixture.shouldCollide(game.rival.chassis.getFixtureList()), false);
    positions.add(monster.x);
  }
  assert.ok(positions.size >= 3, 'injectable random rolls vary monster placement');
}

const earlyMiss = make();
assert.equal(earlyMiss.getState().weapon.canHit, false);
assert.equal(earlyMiss.fire(), true); assert.equal(earlyMiss.ammo, 0);
for (let frame = 0; frame < 120; frame++) earlyMiss.step(1 / 120, { fire: true });
assert.equal(earlyMiss.fire(), false); assert.equal(earlyMiss.monster.alive, true);
assert.equal(earlyMiss.projectile, null); assert.equal(earlyMiss.drainEvents().filter(e => e.type === 'shot').length, 1);

for (const dt of [1 / 120, 1 / 60]) {
  const hit = make();
  moveTruck(hit.player, hit.monster.x - 9, hit.monster.y + 1.43);
  assert.equal(hit.getState().weapon.canHit, true); assert.equal(hit.fire(), true);
  hit.projectile.speed = 1000; // Stress a segment longer than the entire target.
  hit.step(dt, {});
  assert.equal(hit.monster.alive, false, 'continuous ray cast cannot tunnel through the target');
  assert.equal(hit.ammo, 0); assert.equal(hit.fire(), false);
  assert.equal(hit.drainEvents().filter(e => e.type === 'monsterHit').length, 1);

  const occluded = make();
  moveTruck(occluded.player, occluded.monster.x - 12, occluded.monster.y + 1.43);
  const wall = occluded.world.createBody({ position: V(occluded.monster.x - 6, occluded.monster.y + 4) });
  wall.setUserData({ type: 'ground' }); wall.createFixture(new planck.Box(0.3, 4));
  assert.equal(occluded.getState().weapon.canHit, false, 'terrain blocks the auto-aim sight line');
  assert.equal(occluded.fire(), true);
  for (let frame = 0; frame < 1 / dt; frame++) occluded.step(dt, {});
  assert.equal(occluded.projectile, null); assert.equal(occluded.monster.alive, true);
  assert.equal(occluded.ammo, 0); assert.ok(!occluded.drainEvents().some(e => e.type === 'monsterHit'));
}

const crash = make(0, 0);
let actualMonsterContact = false;
crash.world.on('begin-contact', contact => {
  const a = contact.getFixtureA().getBody().getUserData(), b = contact.getFixtureB().getBody().getUserData();
  if ((a?.type === 'monster' && b?.owner === 'player') || (b?.type === 'monster' && a?.owner === 'player')) actualMonsterContact = true;
});
advance(crash, 15, { throttle: 1 });
assert.equal(crash.failed, 'monster'); assert.ok(actualMonsterContact && crash.monster.alive && !crash.finished);
const crashedAt = crash.getState().x;
assert.equal(crash.reset(), false); assert.equal(crash.fire(), false);
advance(crash, 1, { throttle: 1 }); assert.equal(crash.getState().x, crashedAt);
assert.equal(crash.drainEvents().filter(e => e.type === 'monsterCrash').length, 1);

for (const jumpToFinish of [false, true]) {
  const bypass = make();
  moveTruck(bypass.player, jumpToFinish ? bypass.track.finishX + 1 : bypass.monster.x + 2, bypass.monster.y + 15);
  bypass.step(1 / 120, {});
  assert.equal(bypass.failed, 'monster'); assert.equal(bypass.finished, false); assert.equal(bypass.winner, null);
}
const checkpointSkip = make(9, 0);
assert.equal(checkpointSkip.reset(checkpointSkip.track.checkpoints.length - 1), true);
assert.ok(checkpointSkip.getState().x + 12 < checkpointSkip.monster.x, 'live monster clamps recovery to a prior gate');
assert.equal(checkpointSkip.ammo, 1); assert.equal(checkpointSkip.monster.alive, true);

const flyingRecovery = make();
moveTruck(flyingRecovery.player, flyingRecovery.monster.x - 10, flyingRecovery.monster.y + 1.43);
assert.equal(flyingRecovery.fire(), true);
const sameBullet = flyingRecovery.projectile, sameMonster = flyingRecovery.monster;
assert.equal(flyingRecovery.reset(0), true);
assert.equal(flyingRecovery.projectile, sameBullet); assert.equal(flyingRecovery.monster, sameMonster); assert.equal(flyingRecovery.ammo, 0);
advance(flyingRecovery, 0.3); assert.equal(flyingRecovery.monster.alive, false);
const deadPosition = flyingRecovery.monster.x;
flyingRecovery.reset(0); assert.equal(flyingRecovery.monster.x, deadPosition); assert.equal(flyingRecovery.monster.alive, false);

let roundRoll = 0;
const newRound = new TruckPhysics(0, { random: () => [0.1, 0.9][roundRoll++ % 2] });
const previousPosition = newRound.monster.x;
newRound.fire(); newRound.restart();
assert.equal(newRound.ammo, 1); assert.equal(newRound.projectile, null); assert.ok(newRound.monster.alive);
assert.notEqual(newRound.monster.x, previousPosition, 'full restart draws a new random placement');
console.log('PASS random monster placement, one-shot misses/repeat rejection, raycast/occlusion, lethal contact, anti-bypass, weapon recovery and round reroll');

for (const dt of [1 / 120, 1 / 60]) for (let stage = 0; stage < 10; stage++) {
  const game = make(stage);
  let elapsed = 0, minFuel = 100, takeoffs = 0, landings = 0, pickups = 0, impacts = 0;
  const actualZombieContacts = new Set();
  game.world.on('begin-contact', contact => {
    const a = contact.getFixtureA().getBody().getUserData(), b = contact.getFixtureB().getBody().getUserData();
    if (a?.type === 'zombie' && b?.type === 'vehicle') actualZombieContacts.add(a.entity.id);
    if (b?.type === 'zombie' && a?.type === 'vehicle') actualZombieContacts.add(b.entity.id);
  });
  while (elapsed < 65 && !game.finished && !game.failed) {
    if (game.getState().weapon.canHit) game.fire();
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
  assert.equal(game.ammo, 0); assert.equal(game.monster.alive, false);
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
  const count = make(stage).track.checkpoints.length;
  for (let cp = 0; cp < count; cp++) {
    const game = make(stage), bodies = game.world.getBodyCount();
    clearMonster(game); const beforeFuel = game.fuel;
    assert.equal(game.reset(cp), true); assert.ok(Math.abs(game.fuel - (beforeFuel - 12)) < 1e-8);
    advance(game, 1.5);
    const s = game.getState();
    assert.ok(s.grounded && s.y > 0.5 && Math.abs(s.angle) < 0.22, `stage ${stage + 1} checkpoint ${cp} is safe`);
    assert.equal(game.world.getBodyCount(), bodies, 'recovery does not leak bodies');
  }
}
const recovery = make(9); clearMonster(recovery);
advance(recovery, 2, { throttle: 1 }); recovery.drainEvents();
const oldFuel = recovery.fuel, oldCleared = recovery.cleared;
const collected = recovery.fuelCans.map(can => can.collected), zombieBodies = recovery.zombies.map(z => z.body);
const rivalBody = recovery.rival.chassis, rivalX = rivalBody.getPosition().x;
assert.equal(recovery.reset(recovery.checkpointIndex), true);
assert.ok(Math.abs(recovery.fuel - (oldFuel - 12)) < 1e-8);
assert.equal(recovery.cleared, oldCleared); assert.deepEqual(recovery.fuelCans.map(can => can.collected), collected);
assert.deepEqual(recovery.zombies.map(z => z.body), zombieBodies);
assert.equal(recovery.rival.chassis, rivalBody); assert.equal(rivalBody.getPosition().x, rivalX);
assert.equal(recovery.ammo, 0); assert.equal(recovery.monster.alive, false);
while (!recovery.failed) recovery.reset(0);
assert.equal(recovery.failed, 'fuel'); assert.equal(recovery.fuel, 0); assert.equal(recovery.reset(), false);
recovery.restart();
assert.equal(recovery.fuel, 100); assert.equal(recovery.cleared, 0); assert.equal(recovery.failed, null);
assert.equal(recovery.ammo, 1); assert.equal(recovery.monster.alive, true);
assert.ok(recovery.fuelCans.every(can => !can.collected) && recovery.zombies.every(z => z.alive));

const fuelFailure = make(8); clearMonster(fuelFailure); fuelFailure.reset(0);
fuelFailure.fuelCans = []; // Simulate missing every optional pickup.
advance(fuelFailure, 40, { throttle: 1 });
assert.equal(fuelFailure.failed, 'fuel'); assert.ok(!fuelFailure.finished && fuelFailure.fuel === 0);
assert.equal(fuelFailure.drainEvents().filter(e => e.type === 'empty').length, 1);
const stopped = fuelFailure.getState().x;
advance(fuelFailure, 1, { throttle: 1 }); assert.equal(fuelFailure.getState().x, stopped);
assert.equal(fuelFailure.drainEvents().length, 0);

// Isolate a midair impact to prove collision impulses transfer momentum both ways.
const collision = make(9);
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
const rivalWin = make(9);
moveTruck(rivalWin.player, rivalWin.track.startX, -25);
advance(rivalWin, 35);
assert.equal(rivalWin.winner, 'rival'); assert.equal(rivalWin.failed, 'rival'); assert.equal(rivalWin.finished, false);
assert.ok(rivalWin.getState().rival.x >= rivalWin.track.finishX && rivalWin.fuel > 0);

const brakes = make(); advance(brakes, 3, { throttle: 1 });
const beforeBrake = brakes.getState().speed; advance(brakes, 1, { brake: true });
assert.ok(Math.abs(brakes.getState().speed) < beforeBrake * 0.4);
const reverse = make(); advance(reverse, 2, { throttle: -1 });
assert.ok(reverse.getState().x < reverse.track.startX);
console.log('PASS all recovery gates, fuel conservation/failure/retry, contact filtering, two-way collision impulse, rival victory, brakes and reverse');
