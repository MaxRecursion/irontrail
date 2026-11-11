/* Endless Boss is a separate survival mode; no campaign stages or finish rules are replaced. */
const assert = require('node:assert/strict');
global.planck = require('../vendor/planck.min.js');
require('../src/physics.js');
const V = planck.Vec2, C = TruckPhysics.ENDLESS;
const make = tuning => new TruckPhysics(9, { endless: true, tuning });
function move(game, x, y, angle = 0) {
  const p = game.chassis.getPosition(), dx = x-p.x, dy = y-p.y;
  for (const body of [game.chassis, ...game.wheels]) {
    const old = body.getPosition(); body.setTransform(V(old.x+dx, old.y+dy), angle);
    body.setLinearVelocity(V(0, 0)); body.setAngularVelocity(0);
  }
  game._capturePose(); game.posePrev.set(game.poseCurr);
}
function fixtureCount(body) { let n=0; for(let f=body.getFixtureList();f;f=f.getNext())n++; return n; }
const g = make(), track = g.track;
assert.equal(TruckPhysics.STAGES.length, 10);
assert.equal(g.stage.name, 'Endless Boss'); assert.equal(g.stage.endless, true);
assert.equal(g.getState().endless, true); assert.equal(g.getState().distance, 0);
assert.equal(g.rival, null); assert.equal(g.monster.alive, false); assert.equal(g.ammo, 0);
assert.equal(g.fire(), false); assert.equal(g.reset(0), false); assert.equal(g.fuel, 100);
assert.equal(g.world.getBodyCount(), 4); assert.equal(g.world.getJointCount(), 2);
const before = JSON.stringify([g.getState(), [...g.posePrev], [...g.poseCurr], g._elapsed, g.terrainVersion]);
g.step(0, { throttle: 1, boost: true });
assert.equal(JSON.stringify([g.getState(), [...g.posePrev], [...g.poseCurr], g._elapsed, g.terrainVersion]), before, 'zero dt/paused caller leaves world and generation frozen');
const idle=make(), economical=make({tank:3}), driven=make();
for(let i=0;i<120;i++){idle.step(1/120,{});economical.step(1/120,{});driven.step(1/120,{throttle:1});}
assert.ok(Math.abs(idle.fuel-(100-C.fuelDrain*.35))<1e-7,'idle consumes fuel');
assert.ok(Math.abs(driven.fuel-(100-C.fuelDrain))<1e-7,'full throttle consumes full published rate');
assert.ok(Math.abs(economical.fuel-(100-C.fuelDrain*.35*.79))<1e-7,'tank upgrades preserve fuel economy');
for(let i=0;i<120*50&&!idle.failed;i++)idle.step(1/120,{});
assert.equal(idle.failed,'fuel');assert.equal(idle.fuel,0,'idling eventually runs dry');
const pickup=make(),can=pickup.fuelCans[0];pickup.fuel=20;move(pickup,can.x,can.y);pickup.step(1/120,{});
assert.ok(pickup.fuel>51.9&&pickup.fuel<=52);assert.equal(pickup.stats.cans,1);assert.equal(can.collected,true);
const after=pickup.fuel;pickup.step(1/120,{});assert.ok(pickup.fuel<after);assert.equal(pickup.stats.cans,1,'cans collect once');
const capped=make(),capCan=capped.fuelCans[0];capped.fuel=99;move(capped,capCan.x,capCan.y);capped.step(1/120,{});assert.equal(capped.fuel,100,'pickup caps at100');
const missed=make();for(const can of missed.fuelCans)can.collected=true;for(let i=0;i<120*20&&!missed.failed;i++)missed.step(1/120,{throttle:1});assert.equal(missed.failed,'fuel','missing the cans ends the run');
console.log('PASS endless setup: separate mode, ten campaign stages, no cannon/rival/recovery, pause freeze; idle/driving fuel drain, tank economy, pickups/cap/conservation and fuel elimination');

// Real unassisted driving crosses the original finale many times before terrain eventually overturns the truck.
const results = [];
for(const hz of [60,120])for(const level of [0,3]) {
  const game = make({engine:level,tyres:level,suspension:level,tank:level});
  let maxSegments=0, levels=0;
  for(let n=0;n<hz*200&&!game.failed;n++) {
    game.step(1/hz,{throttle:1});
    for(const event of game.drainEvents()) if(event.type==='difficulty')levels++;
    maxSegments=Math.max(maxSegments,game.track.segments.length);
    assert.equal(game.winner,null); assert.equal(game.finished,false);
    assert.ok(game.fuel>=0&&game.fuel<=100);
  }
  assert.ok(game.distance>2000, `real ${hz}Hz level${level} driving reaches ${game.distance.toFixed(0)}m`);
  assert.ok(game.difficulty>=9&&levels>=8); assert.ok(maxSegments<=9);
  assert.ok(game.stats.cans>20,'reachable streamed supplies sustain long real driving');
  assert.ok(!game.failed||['fall','overturn','fuel'].includes(game.failed));
  results.push(`${hz}Hz/L${level}=${game.distance.toFixed(0)}m`);
}
console.log('PASS real endless driving beyond stage10: '+results.join(', '));

// Streaming retains immutable live segment identities and bounds every world/cache input over 120 km.
g.fuel=37;let previous = g.track.segments.slice(), changes=0;
for(let x=96;x<=120000;x+=96) {
  const version = g.terrainVersion; g._extendEndlessTrack(x);
  assert.equal(g.track,track,'track identity stays stable for renderer');
  assert.equal(g.track.startX,7.5);
  assert.ok(g.track.finishX>=x+C.ahead&&g.track.finishX<x+C.ahead+C.chunkLength+1);
  assert.ok(g.track.segments.length<=9&&g.track.features.length<=9);
  assert.ok(g._endlessFixtures.size<=9&&fixtureCount(g.ground)<=10);
  assert.equal(g.world.getBodyCount(),4); assert.equal(g.world.getJointCount(),2);
  assert.equal(g.zombies.length+g.breakables.length,0);
  assert.ok(g.fuelCans.length<=9&&g.track.canXs.length<=9);assert.equal(g.fuel,37,'streaming terrain never refills the tank');
  for(const can of g.fuelCans)assert.ok(Math.abs(can.y-g._heightAt(can.x)-1.3)<1e-9,'streamed fuel follows reachable terrain');
  assert.ok(g.track.segments[0].at(-1).x>=x-C.behind);
  if(g.terrainVersion!==version){changes++;assert.ok(previous.some(s=>g.track.segments.includes(s)),'nearby streaming reuses still-live chain arrays');}
  previous=g.track.segments.slice();
}
assert.ok(changes>1000);
const farAmplitude=g.track.features[0].height;
assert.ok(farAmplitude>15,'terrain amplitude keeps growing with travelled coordinate');
const version=g.terrainVersion;g._extendEndlessTrack(1e9);
assert.ok(g.terrainVersion>version&&g.track.segments.length<=9&&g.fuelCans.length<=9&&fixtureCount(g.ground)<=10,'large fixture jumps also keep construction bounded');assert.equal(g.fuel,37);
assert.ok(g.track.features[0].height>farAmplitude);
assert.ok(g.track.segments.every(s=>s.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))));
console.log('PASS rolling terrain: 120km, stable track/immutable retained segments, bounded fixtures/features/entities, growing difficulty; billion-metre fixture jump bounded');

// A normal jump is allowed; crossing either overturn threshold, in the air or grounded, ends immediately.
const jumping=make(); move(jumping,50,jumping._heightAt(50)+4);jumping.chassis.setLinearVelocity(V(4,-3));jumping.step(1/120,{throttle:1});assert.equal(jumping.failed,null);
for(const angle of [-C.overturnAngle-.01,C.overturnAngle+.01]) {
  const game=make();move(game,25,6,angle);game.step(1/120,{});
  assert.equal(game.failed,'overturn'); assert.equal(game.finished,false); assert.equal(game.winner,null);
  assert.equal(game.drainEvents().filter(e=>e.type==='wreck').length,1);
  const terminal=JSON.stringify([game.getState(),[...game.poseCurr],game._elapsed,game.terrainVersion]);
  for(let i=0;i<120;i++)game.step(1/120,{throttle:1,lean:1,boost:true});
  assert.equal(game.coast(1/120),false); assert.equal(game.reset(),false);assert.equal(game.fire(),false);
  assert.equal(JSON.stringify([game.getState(),[...game.poseCurr],game._elapsed,game.terrainVersion]),terminal,'terminal mode cannot be recovered or coasted out of');
}
const fallen=make();move(fallen,25,fallen._heightAt(25)-C.fallDepth-.01);fallen.step(1/120,{throttle:1});assert.equal(fallen.failed,'fall');
const belowThreshold=make();move(belowThreshold,25,6,C.overturnAngle-.02);belowThreshold.step(1e-6,{});assert.equal(belowThreshold.failed,null,'near-vertical recoverable angle does not prematurely end the run');
fallen.restart();assert.equal(fallen.failed,null);assert.equal(fallen.distance,0);assert.equal(fallen.difficulty,1);assert.equal(fallen.track.segments.length,6);assert.equal(fallen.getState().ammo,0);assert.equal(fallen.fuel,100);
console.log('PASS normal jumps, immediate left/right overturn and fall elimination, terminal freeze, no self-right/recovery, clean fresh restart');
