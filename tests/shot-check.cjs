const assert=require('node:assert/strict');const {ShotDirector}=require('../src/game.js');
const state={ammo:1,weapon:{canHit:true,distance:25},projectile:null,monster:{alive:true}};const d=new ShotDirector();
assert.equal(d.update(.1,state).phase,'aim');assert.ok(d.update(.1,state).timeScale<1);
for(let i=0;i<20;i++)d.update(.1,state);assert.equal(d.state.phase,'idle');assert.equal(d.update(.1,state).phase,'idle');
state.ammo=0;state.projectile={};d.shoot();for(let i=0;i<5;i++)d.update(.1,state);assert.ok(d.state.timeScale<.25);d.hit();state.monster.alive=false;state.projectile=null;assert.equal(d.update(.1,state).phase,'impact');for(let i=0;i<10;i++)d.update(.1,state);assert.equal(d.state.timeScale,1);
d.reset();state.monster.alive=true;d.shoot();for(let i=0;i<3;i++)d.update(.1,state);assert.equal(d.state.phase,'miss');for(let i=0;i<10;i++)d.update(.1,state);assert.equal(d.state.phase,'idle');d.shoot();assert.equal(d.update(.1,state,true).timeScale,1);d.reset();assert.equal(d.state.phase,'idle');assert.equal(d.aimUsed,false);console.log('PASS bounded aim/flight/impact/miss, one aim window, reduced motion and retry reset');

// Redline ImpactDirector: bounded envelopes for slams, wrecks and run endings.
{
  const {ImpactDirector,IMPACTS}=require('../src/game.js');const i=new ImpactDirector();
  assert.deepEqual({...i.update(.1)},{kind:'idle',timeScale:1,bars:0,zoom:0,progress:0});assert.equal(i.trigger('nope'),false);
  assert.equal(i.trigger('slam',1),true);let low=1;for(let n=0;n<40;n++){const v=i.update(1/60);low=Math.min(low,v.timeScale);assert.ok(v.timeScale>=IMPACTS.slam.scale-1e-9&&v.timeScale<=1&&v.bars>=0&&v.bars<=1&&v.zoom>=0&&v.zoom<=1);}
  assert.ok(low<.3,'a slam really slows the world');assert.equal(i.state.kind,'idle');assert.equal(i.state.timeScale,1);
  i.trigger('wreck',1);assert.equal(i.trigger('slam',1),true,'a slam outranks a wreck');assert.equal(i.trigger('wreck',1),false,'a wreck cannot interrupt a slam');
  assert.equal(i.trigger('finish'),true);assert.equal(i.trigger('slam'),false,'nothing interrupts a run ending');
  assert.ok(i.update(.01).timeScale<.4,'the finish starts in slow motion');for(let n=0;n<200;n++)i.update(1/60);
  assert.equal(i.state.kind,'finish','sticky endings hold their framing');assert.ok(i.done&&i.state.bars===1&&Math.abs(i.state.timeScale-IMPACTS.finish.recover)<1e-9);
  i.reset();assert.equal(i.state.kind,'idle');i.trigger('stall');assert.equal(i.update(.5).timeScale,1,'running dry never slows time');
  i.reset();i.trigger('fail');const calm=i.update(.2,true);assert.deepEqual([calm.timeScale,calm.bars,calm.zoom],[1,0,0],'reduced motion pins the envelope');
  assert.ok(Object.values(IMPACTS).every(e=>e.duration<=1.5&&e.scale>0),'outros stay short');
  console.log('PASS impact director: slam/wreck release, priorities, sticky finish/fail/stall framing, reduced motion and bounds');
}
