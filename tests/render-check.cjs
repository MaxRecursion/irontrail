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
assert.equal(canvases,0,'no hot canvas allocation');assert.equal(gradients,0,'no hot gradient allocation');
console.log(`PASS ${rendered} real-physics frames across10biomes +effects/ghosts/fallbacks; max${maximum}/220drawOps, ${maxFonts}/3fonts, current caches ${(maxBytes/1048576).toFixed(1)}MiB; no hotcanvas/gradients; retry/adaptive cache reuse`);
console.log(records.join(' '));
