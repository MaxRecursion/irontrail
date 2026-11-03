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
