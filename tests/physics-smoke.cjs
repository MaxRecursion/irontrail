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
  assert.ok(pickups >= 2 && pickups === game.fuelCans.length && takeoffs >= 2 && landings >= 1,
    'the authored supply line is reachable and the course has jumps and landings');
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

// Isolate braking on the flat spawn apron, rather than during a roller jump.
const brakes = make(); moveTruck(brakes.player, -10, 1.43, 12); advance(brakes, 0.25);
const beforeBrake = brakes.getState().speed; advance(brakes, 1, { brake: true });
assert.ok(Math.abs(brakes.getState().speed) < beforeBrake * 0.4);
const reverse = make(); advance(reverse, 2, { throttle: -1 });
assert.ok(reverse.getState().x < reverse.track.startX);
console.log('PASS all recovery gates, fuel conservation/failure/retry, contact filtering, two-way collision impulse, rival victory, brakes and reverse');

// v3 pose buffers are caller-owned, wrap angles over the shortest arc, and snap
// recoveries/restarts rather than blending a truck across the whole map.
const poses = make(9), poseOut = new Float64Array(poses.poseLength);
assert.equal(poses.poseLength, 3 * (7 + poses.zombies.length));
assert.deepEqual(poses.posePrev, poses.poseCurr);
assert.equal(poses.getPose(poseOut), poseOut);
poses.step(1 / 120, { throttle: 1 });
assert.equal(poses.interpolatePose(0.5, poseOut), poseOut);
assert.ok(Math.abs(poseOut[0] - (poses.posePrev[0] + poses.poseCurr[0]) / 2) < 1e-10);
poses.posePrev[2] = Math.PI - 0.1; poses.poseCurr[2] = -Math.PI + 0.1;
poses.interpolatePose(0.5, poseOut); assert.ok(Math.abs(poseOut[2] - Math.PI) < 1e-10);
poses.posePrev[0] = NaN; poses.poseCurr[0] = 42;
poses.interpolatePose(0.5, poseOut); assert.equal(poseOut[0], 42);
poses.interpolatePose(-5, poseOut); assert.equal(poseOut[2], Math.PI - 0.1);
poses.interpolatePose(5, poseOut); assert.ok(Math.abs(poseOut[2] - (Math.PI + 0.1)) < 1e-10);
poses.step(0); assert.deepEqual(poses.posePrev, poses.poseCurr);
poses.reset(0); assert.deepEqual(poses.posePrev, poses.poseCurr);
poses.failed = 'fixture'; poses.step(1 / 120); assert.deepEqual(poses.posePrev, poses.poseCurr);
poses.restart(); assert.deepEqual(poses.posePrev, poses.poseCurr);
assert.ok(Number.isNaN(poses.poseCurr[TruckPhysics.POSE.PROJECTILE * 3]));
assert.ok(Number.isNaN(make().getPose()[TruckPhysics.POSE.RIVAL * 3]));

const clamped = new TruckPhysics(0, { tuning: { engine: 8, tyres: -1, suspension: 2.9, tank: NaN } });
assert.deepEqual(clamped.tuning, { engine: 3, tyres: 0, suspension: 2, tank: 0 });
assert.ok(Object.isFrozen(clamped.tuning) && Object.isFrozen(TruckPhysics.UPGRADES.engine.speed));
const maxTuning = { engine: 3, tyres: 3, suspension: 3, tank: 3 };
function runCourse(stage, hz, options = {}) {
  const game = new TruckPhysics(stage, { random: () => options.roll ?? 0.5, tuning: options.tuning });
  // Separate resource/terrain viability from beating the competitive boss at
  // only 60% throttle. Race win/loss is tested with the real rival below.
  if (options.courseOnly && game.rival) {
    for (const body of [game.rival.chassis, ...game.rival.wheels]) game.world.destroyBody(body);
    game.rival = null;
  }
  if (options.miss !== undefined) game.fuelCans[options.miss].collected = true;
  let time = 0, fuelFloor = 100, leadChanges = 0, lastLead = 1, didRecover = false;
  while (time < 90 && !game.finished && !game.failed) {
    const state = game.getState();
    if (state.weapon.canHit) game.fire();
    if (options.recover && !didRecover && game.checkpointIndex >= 2) {
      game.reset(game.checkpointIndex); didRecover = true;
    }
    game.step(1 / hz, { throttle: options.throttle ?? 1 }); time += 1 / hz;
    const after = game.getState(); fuelFloor = Math.min(fuelFloor, after.fuel);
    if (after.rival) {
      const lead = Math.sign(after.x - after.rival.x);
      if (lead && lead !== lastLead) leadChanges++;
      if (lead) lastLead = lead;
    }
    assert.ok([after.x, after.y, after.angle, after.fuel].every(Number.isFinite));
    game.drainEvents();
  }
  return { game, time, fuelFloor, leadChanges, gap: game.rival ? game.getState().x - game.getState().rival.x : NaN };
}
const floors = [], bossGaps = [], baseAirs = [], upgradedAirs = [];
for (const hz of [120, 60]) {
  let baseFirst = 0, maxFirst = 0;
  for (let stage = 0; stage < 10; stage++) {
    const base = runCourse(stage, hz), max = runCourse(stage, hz, { tuning: maxTuning });
    assert.equal(base.game.winner, 'player'); assert.equal(max.game.winner, 'player');
    assert.equal(base.game.ammo, 0); assert.equal(max.game.ammo, 0);
    assert.equal(base.game.stats.cans, base.game.fuelCans.length);
    assert.equal(max.game.stats.cans, max.game.fuelCans.length);
    if (!stage) { baseFirst = base.time; maxFirst = max.time; }
    if (hz === 120) {
      floors.push(base.fuelFloor); baseAirs.push(base.game.stats.maxAir); upgradedAirs.push(max.game.stats.maxAir);
    }
    if (stage === 5) assert.ok(base.game.stats.perfectLandings >= 2, 'stage 6 perfect-landing challenge is attainable');
    if (stage === 6) assert.ok(max.game.stats.bigAirs >= 1, 'stage 7 big-air challenge is attainable');
    if (stage === 9) {
      assert.ok(base.gap >= 3 && base.gap <= 15, `competitive base boss at ${hz} Hz: ${base.gap} m`);
      assert.ok(max.gap >= 3 && max.gap <= 15, `competitive upgraded boss at ${hz} Hz: ${max.gap} m`);
      bossGaps.push(`${hz} Hz base ${base.gap.toFixed(1)} m / max ${max.gap.toFixed(1)} m`);
    }
    const gentle = runCourse(stage, hz, { throttle: 0.6, courseOnly: true });
    assert.equal(gentle.game.winner, 'player', `stage ${stage + 1} terrain/fuel remains viable at 60% throttle/${hz} Hz`);
    // Big jumps remain optional on the clean throttle line but are available
    // as real launch lips, with separate chains across every ravine.
    if (stage >= 2) assert.ok(base.game.track.features.some(f => f.kind === 'kicker' && f.angle >= 22 * Math.PI / 180 && f.angle <= 28 * Math.PI / 180));
  }
  assert.ok(maxFirst < baseFirst * 0.94, 'engine upgrades improve actual stage time');
  const setback = runCourse(9, hz, { recover: true });
  assert.equal(setback.game.winner, 'rival'); assert.ok(setback.leadChanges >= 1, 'a recovery gives the opponent the lead');
}
for (let i = 1; i < floors.length; i++) assert.ok(floors[i] <= floors[i - 1] + 0.2, 'full-throttle fuel pressure rises smoothly');
assert.ok(floors[0] >= 65 && floors[0] <= 75 && floors[9] >= 25 && floors[9] <= 30);
for (let stage = 0; stage < 8; stage++) for (let can = 0; can < make(stage).fuelCans.length; can++) {
  assert.equal(runCourse(stage, 120, { miss: can }).game.winner, 'player', `missing can ${can} on stage ${stage + 1} is survivable`);
}
// Real routes with varied monster placements: every target gets a visible,
// reachable firing line; the shot is not rescued by test teleports.
for (const hz of [120, 60]) for (let stage = 0; stage < 10; stage++) for (const roll of [0, 0.2, 0.8, 0.999]) {
  const course = runCourse(stage, hz, { roll });
  assert.equal(course.game.winner, 'player', `monster placement ${roll}, stage ${stage + 1}, ${hz} Hz`);
}
console.log(`PASS zero/max upgrades and 60%-throttle course viability at 60/120 Hz; fuel floors ${floors.map(n => n.toFixed(0)).join('/')}; missed-can tolerance; 80 varied encounter routes`);
console.log(`PASS competitive boss: ${bossGaps.join('; ')}; recovery lead changes and rival wins`);
console.log(`INFO natural max airtime by stage, base ${baseAirs.map(n => n.toFixed(2)).join('/')} s; upgraded ${upgradedAirs.map(n => n.toFixed(2)).join('/')} s`);

// A controlled lean sequence on the actual launch lip proves the optional
// kicker can land a flip, rather than relying only on a zero-gravity fixture.
// The suspension/engine upgrades offer the extra rotation and airtime needed.
for (const hz of [120, 60]) {
  for (let stage = 2; stage < 10; stage++) {
    const game = new TruckPhysics(stage, { random: () => 0.5, tuning: maxTuning });
    const kicker = game.track.features.find(f => f.kind === 'kicker');
    let time = 0, started = false, landed = false, target = 0;
    while (time < 70 && !game.finished && !game.failed) {
      const state = game.getState(); let lean = 0;
      if (state.weapon.canHit) game.fire();
      if (!started && state.x > kicker.endX - 2 && !state.grounded && state.airtime > 0.04) {
        started = true; target = state.angle + Math.PI * 2;
      }
      if (started && !landed) lean = Math.max(-1, Math.min(1, state.angle - target + game.chassis.getAngularVelocity() * 0.25));
      game.step(1 / hz, { throttle: 1, lean }); time += 1 / hz;
      for (const event of game.drainEvents()) if (event.type === 'landing' && started && event.airtime > 1.3) landed = true;
    }
    assert.equal(game.winner, 'player');
    assert.ok(game.stats.flips >= 1, `real stage ${stage + 1} kicker can land a flip at ${hz} Hz`);
  }
  const margin = runCourse(9, hz, { tuning: { engine: 3, tyres: 2, suspension: 1, tank: 3 } });
  assert.equal(margin.game.winner, 'player'); assert.ok(margin.gap >= 15, 'stage 10 winning-margin challenge is attainable');
}
console.log('PASS actual stage 3–10 kicker flips at 60/120 Hz; stage 5/6/7/10 special challenges attainable');

function poseTruck(vehicle, x, y, angle) {
  const p = vehicle.chassis.getPosition(), ox = p.x, oy = p.y, c = Math.cos(angle), s = Math.sin(angle);
  for (const body of [vehicle.chassis, ...vehicle.wheels]) {
    const q = body.getPosition(), dx = q.x - ox, dy = q.y - oy;
    body.setTransform(V(x + dx * c - dy * s, y + dx * s + dy * c), angle);
    body.setLinearVelocity(V(0, 0)); body.setAngularVelocity(0);
  }
  vehicle.lastAngle = angle;
}
for (const dir of [-1, 1]) {
  const spin = make(); advance(spin, 0.3); spin.drainEvents();
  spin.world.setGravity(V(0, 0)); poseTruck(spin.player, 0, 20, 0);
  spin.player.grounded = false; spin.player.airRotation = 0; spin.player.airtime = 0;
  advance(spin, 1.5, { lean: dir });
  const flipEvents = spin.drainEvents().filter(e => e.type === 'flip');
  assert.equal(flipEvents.length, 1); assert.equal(flipEvents[0].dir, dir === -1 ? 'back' : 'front');
  assert.ok(Math.abs(spin.getState().airRotation) >= Math.PI * 2, 'a base truck completes a full rotation within 1.5 seconds');
  // Bring the fixture above a flat landing without clearing accumulated flight
  // rotation. Only a settled upright touchdown may credit the flip.
  poseTruck(spin.player, 0, 10, dir === -1 ? Math.PI * 2 : -Math.PI * 2);
  spin.world.setGravity(V(0, -14)); advance(spin, 2);
  const landing = spin.drainEvents().find(e => e.type === 'landing');
  assert.ok(landing && landing.upright && landing.perfect && landing.bigAir && landing.flips === 1);
  assert.ok(landing.airtime > 1.6 && Number.isFinite(landing.rotation));
  assert.equal(spin.stats.flips, 1); assert.equal(spin.stats.perfectLandings, 1);
  const stats = { ...spin.stats }; spin.reset(0); assert.deepEqual(spin.stats, stats);
  const snapshot = spin.getState().stats; snapshot.flips = 99; assert.equal(spin.stats.flips, 1);
  spin.restart(); assert.equal(spin.stats.flips, 0); assert.equal(spin.stats.cans, 0);
}
for (const hz of [120, 60]) for (const owner of ['player', 'rival']) {
  const righting = make(owner === 'rival' ? 9 : 0), vehicle = righting[owner];
  poseTruck(vehicle, 0, 1.25, Math.PI);
  let time = 0, upright = false;
  while (time < 2 && !upright) {
    righting.step(1 / hz, { lean: owner === 'player' ? 1 : 0, throttle: 1 }); time += 1 / hz;
    upright = Math.abs(Math.atan2(Math.sin(vehicle.chassis.getAngle()), Math.cos(vehicle.chassis.getAngle()))) < 0.6;
  }
  assert.ok(upright, `${owner} torque-only self-righting within two seconds at ${hz} Hz`);
}
const roof = make(); poseTruck(roof.player, 0, 1.25, Math.PI); advance(roof, 1, { throttle: 1 });
assert.ok(roof.getState().inverted, 'player requires lean to self-right');
advance(roof, 2, { throttle: 1 }); assert.ok(roof.getState().stalledTime >= 2.5);
console.log('PASS pose snaps/interpolation/NaNs/freeze, controlled front/back flips, settled perfect/big-air landings, stat lifecycle, stuck detection and torque-only righting');

// ---- Redline pass (SPEC §15.1) ----
// Baseline digests recorded from the v3 build: with no boost input the pass must be bit-identical.
const V3_DIGEST = [[0,60,714,227.52560523894454,84.4520000000004,5,null,10,2],[0,120,1429,227.64733382154952,84.40216666666484,5,null,10,2],[4,60,1120,362.60061936937734,51.424999999998334,14,null,22,2],[4,120,2253,362.6787168755433,50.73750000000535,13,null,22,2],[9,60,1777,567.6763775257348,25.565833333333075,26,560.4086866585748,40,4],[9,120,3557,567.6707122447596,26.111249999999742,26,558.4832635440711,40,4]];
for (const [stage, hz, steps, x, fuel, cleared, rivalX, bodies, joints] of V3_DIGEST) {
  const game = make(stage); let n = 0;
  while (n < 12000 && !game.finished && !game.failed) { if (game.getState().weapon.canHit) game.fire(); game.step(1 / hz, { throttle: 1 }); n++; game.drainEvents(); }
  assert.equal(n, steps, `v3 digest steps stage ${stage + 1} ${hz} Hz`);
  assert.equal(game.chassis.getPosition().x, x, `v3 digest x stage ${stage + 1} ${hz} Hz`);
  assert.equal(game.fuel, fuel); assert.equal(game.cleared, cleared);
  assert.equal(game.rival ? game.rival.chassis.getPosition().x : null, rivalX, 'rival is bit-identical without player boost');
  assert.equal(game.world.getBodyCount(), bodies, 'Redline systems add no bodies'); assert.equal(game.world.getJointCount(), joints);
  assert.equal(game.getState().boosting, false); assert.equal(game.stats.nitroBurned, 0); assert.equal(game.getState().escalated, false);
}
console.log('PASS Redline is baseline-neutral: v3 digests for stages 1/5/10 at 60/120 Hz match exactly; no new bodies or joints');

const N = TruckPhysics.NITRO, RT = TruckPhysics.RIVAL_TUNING;
assert.ok(Object.isFrozen(N) && Object.isFrozen(N.gain) && N.max === 100 && N.engage > 0 && N.drain > 0);
const burn = make(); advance(burn, 1.2, { throttle: 1 });
assert.equal(burn.getState().nitro, N.start); assert.equal(burn.getState().nitroReady, true);
burn.drainEvents(); burn.step(1 / 120, { throttle: 1, boost: true });
let burnEvents = burn.drainEvents();
assert.ok(burn.getState().boosting && burnEvents.some(e => e.type === 'nitro' && e.phase === 'start' && e.owner === 'player'));
assert.ok(Math.abs(burn.getState().nitro - (N.start - N.drain / 120)) < 1e-9, 'meter drains at the published rate');
const fuelBefore = burn.fuel; burn.step(1 / 120, { throttle: 0, boost: true });
assert.ok(Math.abs(fuelBefore - burn.fuel - burn.stage.fuelDrain / 120) < 1e-9, 'a burn spends fuel as full throttle');
burn.step(1 / 120, { throttle: 1, boost: true, brake: true }); assert.equal(burn.getState().boosting, false, 'brake cancels a burn');
burn.step(1 / 120, { throttle: -1, boost: true }); assert.equal(burn.getState().boosting, false, 'reverse cannot burn');
burnEvents = []; for (let i = 0; i < 240; i++) { burn.step(1 / 120, { throttle: 1, boost: true }); burnEvents.push(...burn.drainEvents().filter(e => e.type === 'nitro')); }
assert.ok(burn.getState().nitro < N.engage && !burn.getState().boosting, 'an empty meter ends the burn');
assert.ok(burnEvents.some(e => e.phase === 'end' && e.empty === true)); assert.ok(burn.stats.nitroBurned > N.start * 0.9);
burn.step(1 / 120, { throttle: 1, boost: true }); assert.equal(burn.getState().boosting, false, 'needs the engage level to relight');
assert.equal(burn.grantNitro(500), N.max); assert.ok(burn.drainEvents().some(e => e.type === 'nitro' && e.phase === 'full'));
const carried = burn.getState().nitro; burn._weaponDirty = true; clearMonster(burn); assert.ok(burn.reset(0)); assert.equal(burn.getState().nitro, carried, 'meter survives recovery');
burn.restart(); assert.equal(burn.getState().nitro, N.start, 'restart restores the starting meter'); assert.equal(burn.stats.nitroBurned, 0);
function boostRun(stage, hz, tuning, boost = true) {
  const game = new TruckPhysics(stage, { random: () => 0.5, tuning }); let time = 0, top = 0, lit = 0;
  while (time < 90 && !game.finished && !game.failed) {
    if (game.getState().weapon.canHit) game.fire();
    game.step(1 / hz, { throttle: 1, boost }); time += 1 / hz; game.drainEvents();
    if (game.player.boosting) lit += 1 / hz; top = Math.max(top, Math.abs(game.chassis.getLinearVelocity().x));
  }
  return { game, time, top, uptime: lit / time };
}
const boostGains = [];
for (const hz of [60, 120]) for (const tuning of [undefined, maxTuning]) for (let stage = 0; stage < 10; stage++) {
  const lit = boostRun(stage, hz, tuning);
  assert.ok(lit.game.finished, `always-boost bot finishes stage ${stage + 1} at ${hz} Hz ${tuning ? 'max' : 'base'} (${lit.game.failed})`);
  if (hz === 120 && !tuning) {
    const plain = boostRun(stage, hz, tuning, false);
    assert.ok(lit.time < plain.time * 0.985, `nitro is faster on stage ${stage + 1}`); assert.ok(lit.uptime > 0.15 && lit.uptime < 0.5, `boost uptime ${lit.uptime}`);
    assert.ok(lit.top > plain.top * 1.1, 'nitro raises top speed'); boostGains.push(Math.round((1 - lit.time / plain.time) * 100));
    assert.equal(lit.game.stats.topSpeed, lit.top); assert.ok(lit.game.stats.nitroEarned > 20);
  }
}
const flat = make(); advance(flat, 0.5); moveTruck(flat.player, 60, flat._heightAt(60) + 1.43, 0); flat.player.nitro = 100;
let flatTop = 0; for (let i = 0; i < 330; i++) { flat.step(1 / 120, { throttle: 1, boost: true }); flatTop = Math.max(flatTop, flat.chassis.getLinearVelocity().x); if (flat.player.nitro < 5) flat.player.nitro = 100; }
assert.ok(flatTop > 34 * 0.72 * 1.2, `sustained nitro top speed ${flatTop}`);
console.log(`PASS nitro engage/drain/fuel/cancel/relight/grant/recovery/restart rules; always-boost bots finish all stages at 60/120 Hz base/max; ${boostGains.join('/')} % faster; sustained top ${flatTop.toFixed(1)} m/s`);

const props = make(2), layout = props.breakables.map(b => [b.x, b.y, b.variant]);
assert.ok(layout.length >= 6 && layout.length <= 40);
assert.deepEqual(make(2, 0.9).breakables.map(b => [b.x, b.y, b.variant]), layout, 'breakables ignore options.random');
for (const prop of props.breakables) {
  assert.ok(prop.variant >= 0 && prop.variant < 8 && prop.x >= props.track.startX + 18 && prop.x <= props.track.finishX - 12);
  assert.ok(Math.abs(props._slopeAt(prop.x)) < 0.25); assert.ok(props.track.checkpoints.every(cp => Math.abs(cp.x - prop.x) >= 8));
  assert.ok(props.track.canXs.every(x => Math.abs(x - prop.x) >= 5)); assert.equal(prop.active, Math.abs(prop.x - props.monster.x) >= 7);
}
const smashEvents = []; let smashTime = 0;
while (smashTime < 60 && !props.finished && !props.failed) { if (props.getState().weapon.canHit) props.fire(); props.step(1 / 120, { throttle: 1 }); smashTime += 1 / 120; smashEvents.push(...props.drainEvents().filter(e => e.type === 'smash')); }
assert.ok(props.finished && smashEvents.length >= 4 && smashEvents.every(e => e.owner === 'player' && e.strength >= 0.2 && Number.isFinite(e.x)));
assert.equal(props.stats.smashes, smashEvents.length); assert.equal(props.breakables.filter(b => b.broken).length, smashEvents.length);
const brokenIds = props.breakables.filter(b => b.broken).map(b => b.id);
props.restart(); assert.ok(props.breakables.every(b => !b.broken), 'restart rebuilds every prop'); assert.equal(props.stats.smashes, 0);
advance(props, 4, { throttle: 1 }); const kept = props.breakables.filter(b => b.broken).length; clearMonster(props); assert.ok(kept > 0 && props.reset(0));
assert.equal(props.breakables.filter(b => b.broken).length, kept, 'recovery keeps smashed props');
assert.ok(brokenIds.length > 0);
console.log(`PASS breakables: deterministic, clear of cans/checkpoints/monster, ${smashEvents.length} smashes on stage 3, restart/recovery lifecycle`);

const duel = make(9), duelEvents = [];
advance(duel, 3, { throttle: 1 }); assert.equal(duel.getState().escalated, false); assert.equal(duel.rival.boosting, false, 'Iron Maw never burns first');
assert.ok(duel.rival.nitro > N.start, 'rival meter charges on its own');
duel.drainEvents(); duel.step(1 / 120, { throttle: 1, boost: true }); duelEvents.push(...duel.drainEvents());
assert.ok(duelEvents.some(e => e.type === 'escalate') && duel.getState().escalated);
for (let i = 0; i < 360; i++) { duel.step(1 / 120, { throttle: 1 }); duelEvents.push(...duel.drainEvents()); }
assert.ok(duelEvents.some(e => e.type === 'nitro' && e.owner === 'rival' && e.phase === 'start'), 'escalated rival lights its own meter');
assert.equal(duelEvents.filter(e => e.type === 'escalate').length, 1);
const margins = [];
for (const hz of [60, 120]) for (const tuning of [undefined, maxTuning]) {
  const race = boostRun(9, hz, tuning), gap = race.game.chassis.getPosition().x - race.game.rival.chassis.getPosition().x;
  assert.ok(race.game.finished && gap > 1 && gap < 70, `boosted clean boss margin ${gap} at ${hz} Hz`); margins.push(gap.toFixed(1));
}
const slip = make(9); advance(slip, 0.6); const slipNitro = slip.player.nitro;
moveTruck(slip.rival, slip.chassis.getPosition().x + 5, slip.chassis.getPosition().y, slip.chassis.getLinearVelocity().x);
slip.step(1 / 120, { throttle: 1 }); assert.equal(slip.getState().slipstream, 1); assert.ok(slip.player.nitro > slipNitro, 'drafting charges the meter');
moveTruck(slip.rival, slip.chassis.getPosition().x + 14, slip.chassis.getPosition().y, 0); slip.step(1 / 120, { throttle: 1 }); assert.equal(slip.getState().slipstream, 0);
const slam = make(9); advance(slam, 0.6, { throttle: 1 });
const slamAt = () => { const pp = slam.chassis.getPosition(); moveTruck(slam.rival, pp.x + 5.2, pp.y, 0); moveTruck(slam.player, pp.x, pp.y, 20); };
slamAt(); slam.player.nitro = 100; slam.drainEvents(); let slamSeen = [];
for (let i = 0; i < 90; i++) { slam.step(1 / 120, { throttle: 1, boost: true }); slamSeen.push(...slam.drainEvents()); }
assert.ok(slamSeen.some(e => e.type === 'slam'), 'ramming with nitro lit slams Iron Maw'); assert.equal(slam.stats.slams, 1);
assert.ok(slamSeen.findIndex(e => e.type === 'slam') > slamSeen.findIndex(e => e.type === 'collision'));
const quiet = make(9); advance(quiet, 0.6, { throttle: 1 });
{ const pp = quiet.chassis.getPosition(); moveTruck(quiet.rival, pp.x + 5.2, pp.y, 0); moveTruck(quiet.player, pp.x, pp.y, 20); }
let quietSeen = []; for (let i = 0; i < 90; i++) { quiet.step(1 / 120, { throttle: 1 }); quietSeen.push(...quiet.drainEvents()); }
assert.ok(quietSeen.some(e => e.type === 'collision') && !quietSeen.some(e => e.type === 'slam') && quiet.rival.stun === 0, 'no slam without nitro');
slamAt(); slam.player.nitro = 100; slamSeen = []; for (let i = 0; i < 90; i++) { slam.step(1 / 120, { throttle: 1, boost: true }); slamSeen.push(...slam.drainEvents()); }
assert.equal(slam.stats.slams, 1, 'slam cooldown');
console.log(`PASS Iron Maw escalation only after the player's first burn; boosted clean margins ${margins.join('/')} m; slipstream, nitro slam, stun and cooldown`);

const wrecked = make(); poseTruck(wrecked.player, 0, 1.25, Math.PI); wrecked.drainEvents(); advance(wrecked, 0.5, { throttle: 1 });
assert.equal(wrecked.drainEvents().filter(e => e.type === 'wreck' && e.kind === 'roof').length, 1);
const fallen = make(); poseTruck(fallen.player, fallen.track.segments[0][fallen.track.segments[0].length - 1].x + 1, -2.5, 0); fallen.drainEvents(); advance(fallen, 0.6);
assert.equal(fallen.drainEvents().filter(e => e.type === 'wreck' && e.kind === 'fall').length, 1);
const coastGame = make(); assert.equal(coastGame.coast(1 / 120), false, 'coast is refused while the run is live');
clearMonster(coastGame); while (!coastGame.finished) coastGame.step(1 / 120, { throttle: 1 });
coastGame.drainEvents(); const frozen = JSON.stringify([coastGame.fuel, coastGame.stats, coastGame.cleared, coastGame.checkpointIndex, coastGame.player.nitro, coastGame.winner]);
const coastX = coastGame.chassis.getPosition().x; coastGame.step(1 / 120, { throttle: 1 }); assert.equal(coastGame.chassis.getPosition().x, coastX, 'step stays frozen after the finish');
for (let i = 0; i < 180; i++) assert.equal(coastGame.coast(1 / 120), true);
assert.ok(coastGame.chassis.getPosition().x > coastX + 2, 'the truck rolls through the finish');
assert.ok(Math.abs(coastGame.chassis.getLinearVelocity().x) < 12, 'and brakes'); assert.ok(coastGame.poseCurr[0] === coastGame.chassis.getPosition().x);
assert.equal(JSON.stringify([coastGame.fuel, coastGame.stats, coastGame.cleared, coastGame.checkpointIndex, coastGame.player.nitro, coastGame.winner]), frozen, 'coasting changes no result');
assert.ok(coastGame.drainEvents().every(e => ['land', 'collision', 'nitro'].includes(e.type)));
const zombieRun = make(); let zombieEvent = null; for (let i = 0; i < 1200 && !zombieEvent; i++) { zombieRun.step(1 / 120, { throttle: 1 }); zombieEvent = zombieRun.drainEvents().find(e => e.type === 'zombie'); }
assert.ok(zombieEvent && zombieEvent.vx > 5 && zombieEvent.boosted === false && zombieRun.zombies.some(z => z.hit && z.punt === zombieEvent.vx));
console.log('PASS wreck events, terminal coast (frozen results, rolling world, frozen step) and zombie punt data');

// Informational CPU timing, never a flaky cross-machine pass/fail threshold.
TruckPhysics.warmUp(60);
const timed = make(9), control = { throttle: 1 };
let stepMs = 0, stateMs = 0;
for (let i = 0; i < 2400; i++) {
  if (timed.getState().weapon.canHit) timed.fire();
  if (timed.finished || timed.failed) timed.restart();
  let start = performance.now(); timed.step(1 / 120, control); stepMs += performance.now() - start;
  start = performance.now(); timed.getState(); stateMs += performance.now() - start;
  timed.drainEvents();
}
console.log(`INFO stage 10 mean step ${(stepMs / 2.4).toFixed(1)} µs; getState ${(stateMs / 2.4).toFixed(1)} µs (2400 warm steps)`);
