/* Structural Canvas audit with real Planck worlds. Browser timing is separate. */
'use strict';
const assert=require('node:assert/strict');
let tracking=false,canvases=0,gradients=0,ops=0,fonts=new Set(),main;
const finiteArgs=args=>{for(const value of args)if(typeof value==='number')assert.ok(Number.isFinite(value),'finite Canvas coordinate');};
class MockPath {
  moveTo(...a){finiteArgs(a);}lineTo(...a){finiteArgs(a);}rect(...a){finiteArgs(a);}closePath(){}
}
class MockContext {
  constructor(canvas){this.canvas=canvas;this._font='10px sans-serif';}
  set font(value){this._font=value;if(tracking&&this.canvas===main)fonts.add(value);}
  get font(){return this._font;}
  createLinearGradient(...a){finiteArgs(a);if(tracking)gradients++;return {addColorStop(){}};}
  createRadialGradient(...a){finiteArgs(a);if(tracking)gradients++;return {addColorStop(){}};}
}
for(const name of ['setTransform','scale','translate','rotate','moveTo','lineTo','arc','ellipse','save','restore','beginPath','closePath'])MockContext.prototype[name]=function(...a){finiteArgs(a);};
for(const name of ['fill','stroke','fillRect','strokeRect','drawImage','fillText','strokeText'])MockContext.prototype[name]=function(...a){finiteArgs(a);if(tracking&&this.canvas===main)ops++;};
Object.defineProperty(MockContext.prototype,'shadowBlur',{set(v){if(tracking)assert.equal(v,0,'no playing-frame shadow blur');}});
class MockCanvas {
  constructor(w,h){this.width=w;this.height=h;this.context=new MockContext(this);if(tracking)canvases++;}
  getContext(){return this.context;}
}
global.OffscreenCanvas=MockCanvas;global.Path2D=MockPath;
global.planck=require('../vendor/planck.min.js');require('../src/physics.js');require('../src/biomes.js');require('../src/render.js');
main=new MockCanvas(1600,1000);const renderer=new IronRenderer(main,{biomes:IRON_BIOMES});
renderer.setQuality({renderScale:2,particleScale:1,detail:'high'});renderer.resize(1600,1000);
assert.ok(Object.isFrozen(IRON_BIOMES)&&IRON_BIOMES.every(b=>Object.isFrozen(b.ridges)&&Object.isFrozen(b.ground)));
assert.equal(new Set(IRON_BIOMES.map(b=>b.key)).size,10);
let maximum=0,maxFonts=0,maxBytes=0,rendered=0;
const records=[];
for(let stage=0;stage<10;stage++){
  const physics=new TruckPhysics(stage,{random:()=>.5}),pose=new Float64Array(physics.poseLength);
  renderer.setStage(physics,stage);const stats=renderer.stats,camera=renderer.camera,banks=renderer._banks;
  assert.equal(banks.length,3,'only current biome has three zoom banks');
  const bytes=stats.spriteBytes;maxBytes=Math.max(maxBytes,bytes);assert.ok(bytes<70*1048576,'current biome caches bounded below70MiB');
  const frame={state:physics.getState(),pose,dt:1/120,time:0,mode:'playing',input:{throttle:1},layout:{touch:false,safeTop:88,safeBottom:96},settings:{shake:true,reducedMotion:false}};
  let stageMax=0;
  for(let i=0;i<140;i++){
    if(frame.state.weapon.canHit)physics.fire();physics.step(1/60,{throttle:1});frame.state=physics.getState();
    physics.interpolatePose((i%7)/7,pose);frame.time+=1/60;
    for(const event of physics.drainEvents())renderer.onEvent(event,frame.state);
    if(i===20||i===80){renderer.onEvent({type:'monsterHit',x:frame.state.x,y:frame.state.y+1},frame.state);renderer.celebrate('victory');for(let n=0;n<12;n++)renderer.popup('PERFECT +500',frame.state.x+n*.1,frame.state.y+2,n%2?'big':'trick');}
    if(i>100){frame.ghost={pose,alpha:.35};}
    tracking=true;ops=0;fonts.clear();renderer.render(frame);tracking=false;rendered++;
    assert.equal(renderer.stats,stats,'stable stats object');assert.equal(renderer.camera,camera,'stable camera object');
    assert.equal(stats.drawOps,ops,'reported draw operations match actual calls');
    assert.ok(ops<=220,`stage${stage+1} draw budget ${ops}`);assert.ok(fonts.size<=3,'at most3 font strings');
    assert.ok(Number.isFinite(camera.x)&&Number.isFinite(camera.y)&&Number.isFinite(camera.scale));
    assert.equal(renderer._banks,banks,'no bank replacement during play');
    const point=new Float64Array(2);assert.equal(renderer.worldToScreen(pose[0],pose[1],point),point);assert.ok(point.every(Number.isFinite));
    maximum=Math.max(maximum,ops);stageMax=Math.max(stageMax,ops);maxFonts=Math.max(maxFonts,fonts.size);
  }
  renderer.setStage(new TruckPhysics(stage,{random:()=>.8}),stage);assert.equal(renderer._banks,banks,'full retry reuses biome textures');
  renderer.setQuality({renderScale:1.2,particleScale:.3,detail:'low'});assert.equal(renderer._banks,banks,'adaptive resolution reuses high-resolution texture banks');
  tracking=true;ops=0;fonts.clear();renderer.render({});tracking=false;assert.equal(renderer.stats.drawOps,ops,'missing optional frame fields remain supported');
  renderer.setQuality({renderScale:2,particleScale:1,detail:'high'});
  records.push(`stage${stage+1}=${stageMax}`);
}
// A hard impact must visibly displace the camera, and both motion controls
// must remove that displacement even while trauma is at its maximum.
const impactPhysics=new TruckPhysics(0,{random:()=>.5}),impactPose=new Float64Array(impactPhysics.poseLength);impactPhysics.getPose(impactPose);renderer.setStage(impactPhysics,0);
const impactFrame={state:impactPhysics.getState(),pose:impactPose,dt:0,mode:'playing',input:{},layout:{},settings:{shake:true,reducedMotion:false}};
renderer._clock=.2;renderer._trauma=0;renderer.render(impactFrame);const origin=[renderer._ox,renderer._oy];
renderer._trauma=1;renderer.render(impactFrame);const displacement=Math.hypot(renderer._ox-origin[0],renderer._oy-origin[1]);assert.ok(displacement>1&&displacement<20,'Hard impacts have bounded visible shake');
impactFrame.settings.shake=false;renderer.render(impactFrame);assert.deepEqual([renderer._ox,renderer._oy],origin,'Camera Shake off suppresses impact motion');
impactFrame.settings.shake=true;impactFrame.settings.reducedMotion=true;renderer.render(impactFrame);assert.deepEqual([renderer._ox,renderer._oy],origin,'Reduced Motion suppresses impact motion');
console.log('PASS stronger bounded impact shake; Camera Shake off and Reduced Motion remove displacement');
// Redline worst case (SPEC §15.2): both trucks burning, slipstream, letterbox, push-in, smashes, slam, wreck,
// popups and a ghost on stage 10 must stay inside the same draw and font budget, with no hot allocations.
{
  const physics=new TruckPhysics(9,{random:()=>.5}),pose=new Float64Array(physics.poseLength);renderer.setStage(physics,9);
  assert.ok(renderer._breakables.length>=8&&renderer._breakKinds.length===8,'breakables are laid out from physics');
  assert.ok(renderer._props.every(p=>renderer._breakables.every(b=>Math.abs(b.x-p.x)>=2.5)),'decorative props keep clear of breakables');
  const frame={state:physics.getState(),pose,dt:1/60,time:0,mode:'playing',input:{throttle:1,boost:true},layout:{touch:false,safeTop:88,safeBottom:96},settings:{shake:true,reducedMotion:false},cinema:{kind:'finish',bars:1,zoom:1,progress:.5}};
  let worst=0,smashes=0,burning=0;
  for(let i=0;i<420;i++){
    if(frame.state.weapon.canHit)physics.fire();physics.player.nitro=100;if(physics.rival)physics.rival.nitro=100;
    physics.step(1/60,{throttle:1,boost:true});frame.state=physics.getState();frame.state.slipstream=1;physics.interpolatePose(.5,pose);frame.time+=1/60;
    for(const event of physics.drainEvents()){if(event.type==='smash')smashes++;renderer.onEvent(event,frame.state);}
    if(frame.state.boosting&&frame.state.rival&&frame.state.rival.boosting)burning++;
    if(i%60===30){renderer.onEvent({type:'slam',x:frame.state.x,y:frame.state.y,strength:1},frame.state);renderer.onEvent({type:'wreck',kind:'roof',x:frame.state.x,y:frame.state.y,strength:1},frame.state);renderer.onEvent({type:'smash',id:0,variant:1,owner:'player',x:frame.state.x+2,y:frame.state.y,strength:1,vx:30},frame.state);for(let n=0;n<10;n++)renderer.popup('+25',frame.state.x+n*.2,frame.state.y+2,n%2?'nitro':'score');}
    if(i>200)frame.ghost={pose,alpha:.35};
    tracking=true;ops=0;fonts.clear();renderer.render(frame);tracking=false;
    assert.equal(renderer.stats.drawOps,ops);assert.ok(ops<=220,`Redline worst-case draw budget ${ops}`);assert.ok(fonts.size<=3);worst=Math.max(worst,ops);
  }
  assert.ok(smashes>0&&burning>60,'the scenario really smashes props and burns both meters');
  assert.ok(renderer._boost>.9&&renderer._rivalBoost>.5&&renderer._bars>.9&&renderer._cineZoom>.5,'nitro, letterbox and push-in are active');
  const count=settings=>{frame.settings=settings;frame.dt=0;tracking=true;ops=0;renderer.render(frame);tracking=false;return ops;};
  const full=count({shake:true,reducedMotion:false}),calm=count({shake:true,reducedMotion:true});
  assert.ok(calm<=full-7,`Reduced Motion removes streaks, foreground, vignette, afterimages and bars (${full} -> ${calm})`);
  renderer.kick(20,20);frame.settings={shake:false,reducedMotion:false};frame.dt=1/60;renderer.render(frame);assert.equal(renderer._kickX,0,'Camera Shake off removes kicks');
  renderer.kick(20,20);frame.settings={shake:true,reducedMotion:true};renderer.render(frame);assert.equal(renderer._kickX,0,'Reduced Motion removes kicks');assert.ok(renderer._bars<.9,'and releases the letterbox');
  renderer.flash('#fff',.1);const flashed=renderer._lastFlash;renderer.flash('#fff',.1);assert.equal(renderer._lastFlash,flashed,'flashes are rate limited');
  for(const type of ['nitro','escalate','smash','slam','wreck','unknown'])renderer.onEvent({type},{});
  console.log(`PASS Redline worst case: both trucks burning + slipstream + letterbox + smashes/slam/wreck/popups/ghost; max${worst}/220drawOps; reduced motion ${full}->${calm} ops; kicks and flashes gated`);
}
assert.equal(canvases,0,'no hot canvas allocation');assert.equal(gradients,0,'no hot gradient allocation');
console.log(`PASS ${rendered} real-physics frames across10biomes +effects/ghosts/fallbacks; max${maximum}/220drawOps, ${maxFonts}/3fonts, current caches ${(maxBytes/1048576).toFixed(1)}MiB; no hotcanvas/gradients; retry/adaptive cache reuse`);
console.log(records.join(' '));
