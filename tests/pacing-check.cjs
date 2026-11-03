/* Pure pacing/ghost and real Planck interpolation checks. No browser required. */
'use strict';
const assert = require('node:assert/strict');
const {FramePacer, GhostTape, QUALITY} = require('../src/game.js');
const near = (a,b,t=1e-8) => assert.ok(Math.abs(a-b)<=t, `${a} ≈ ${b}`);
const feed = (p, seconds, dt, cpu=1, playing=true) => {
  let changes=0;
  for(let t=0;t<seconds;t+=dt) if(p.sample(dt,cpu,playing)) changes++;
  return changes;
};

for(const hz of [60,90,120,144,165,240]) {
  const p=new FramePacer();
  feed(p,4,1/hz,.4);
  assert.equal(p.refreshHz,hz,`detect ${hz} Hz`);
  assert.equal(p.level,0,`steady ${hz} Hz keeps high quality`);
}
const p=new FramePacer();
feed(p,2,1/120,.5);
assert.equal(p.refreshHz,120);
assert.equal(feed(p,.9,1/60,6),0,'a brief hitch window cannot drop quality');
feed(p,1.2,1/60,6);
assert.equal(p.level,1,'sustained missed vsync lowers one resolution step');
feed(p,2.1,1/60,6);
assert.equal(p.level,2);
p.resetRefresh(); // Start a fresh observation window after the workload changes.
feed(p,4.1,1/120,.3);
assert.equal(p.level,2,'recovery has hysteresis');
feed(p,4.1,1/120,.3);
assert.equal(p.level,1,'eight seconds of headroom restore one quality step');
feed(p,30,1/30,9);
assert.equal(p.level,QUALITY.length-1,'quality is bounded at the lowest tier');
feed(p,100,1/120,.2,false);
assert.equal(p.level,QUALITY.length-1,'menu time cannot restore gameplay quality');
p.resetRefresh(); assert.equal(p.refreshHz,60); assert.equal(p.level,QUALITY.length-1);
for(let i=0;i<750;i++)p.push(i,i/2,.4,2,.6);
const trace=p.trace(); assert.equal(trace.length,600); assert.equal(trace[0][0],150); assert.equal(trace[599][0],749);
trace[0][0]=-1;assert.equal(p.trace()[0][0],150,'diagnostic snapshots do not mutate the trace');
assert.ok(QUALITY.every((q,i)=>i===0||q.factor<=QUALITY[i-1].factor),'resolution falls before effects');

const ghost=new GhostTape(),pose=new Float64Array(9);
for(let i=0;i<=120;i++) {for(let j=0;j<9;j++)pose[j]=i/120*10+j/10;ghost.record(i/120,pose);}
assert.equal(ghost.count,21,'ghost samples 20 Hz independently of physics rate');
const copy=new GhostTape();assert.equal(copy.load(ghost.serialize()),true);
const replay=copy.at(.475);near(replay.pose[0],4.75,.0011);near(replay.pose[8],5.55,.00011);
const stable=copy.at(.5);assert.equal(stable,replay,'replay frame and pose are reused');
assert.equal(copy.at(1),null,'ghost stops at the final recorded sample');
const wrap=new GhostTape();
assert.ok(wrap.load({version:1,hz:20,data:[0,0,31300,0,0,31300,0,0,31300,1000,1000,-31300,1000,1000,-31300,1000,1000,-31300]}));
near(wrap.at(.025).pose[2],Math.PI,1e-8);
for(const bad of [null,'{',{}, {version:2,hz:20,data:new Array(18).fill(0)}, {version:1,hz:60,data:new Array(18).fill(0)}, {version:1,hz:20,data:[0]}, {version:1,hz:20,data:new Array(19).fill(0)}, {version:1,hz:20,data:new Array(18).fill(NaN)}, {version:1,hz:20,data:new Array(9*4097).fill(0)}])assert.equal(copy.load(bad),false);
assert.equal(copy.at(0),null,'bad saves discard old replay safely');
ghost.reset();assert.equal(ghost.count,0);assert.equal(ghost.next,0);
for(let i=0;i<4200;i++)ghost.record(i*.05,pose);
assert.equal(ghost.count,4096,'recording storage is capped');

global.planck=require('../vendor/planck.min.js');require('../src/physics.js');
const physics=new TruckPhysics(0,{random:()=>.5}),out=new Float64Array(physics.poseLength);
assert.equal(physics.getPose(out),out);assert.equal(physics.interpolatePose(.5,out),out);
physics.posePrev[0]=2;physics.poseCurr[0]=6;physics.posePrev[1]=3;physics.poseCurr[1]=5;
physics.posePrev[2]=3.13;physics.poseCurr[2]=-3.13;
physics.interpolatePose(.5,out);near(out[0],4);near(out[1],4);near(out[2],Math.PI);
physics.interpolatePose(-1,out);near(out[0],2);physics.interpolatePose(2,out);near(out[0],6);
physics.posePrev[18]=NaN;physics.poseCurr[18]=12;physics.interpolatePose(.25,out);assert.equal(out[18],12,'new projectile snaps from absent pose');
physics.poseCurr[18]=NaN;physics.interpolatePose(.25,out);assert.ok(Number.isNaN(out[18]),'removed projectile remains absent');

// A constant-speed body sampled with irregular display periods stays at constant
// on-screen speed with the same previous/current interpolation used by the loop.
const step=1/120,speed=17.4,periods=[1/144,1/90,1/165,1/120,1/240,1/60];
let accumulator=0,clock=0,current=0,previous=0,oldX=null,oldTime=0,maxError=0,rawError=0;
for(let i=0;i<900;i++){
  const dt=periods[i%periods.length];clock+=dt;accumulator+=dt;
  while(accumulator>=step){previous=current;current+=speed*step;accumulator-=step;}
  const x=previous+(current-previous)*accumulator/step;
  if(oldX!==null&&i>2)maxError=Math.max(maxError,Math.abs((x-oldX)/(clock-oldTime)-speed));
  if(i>2)rawError=Math.max(rawError,Math.abs(current-speed*(clock-step)));
  oldX=x;oldTime=clock;
}
assert.ok(maxError<1e-8,`interpolated speed error ${maxError}`);
assert.ok(rawError>.05,'the test has enough irregular phase to expose un-interpolated jitter');
console.log('PASS refresh detection, adaptive hysteresis/tier bounds, trace ring, 20 Hz quantized ghost/corrupt saves, real Planck pose reuse/wrap/spawn, irregular-refresh interpolation');
