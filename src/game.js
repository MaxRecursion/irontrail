/* IRONTRAIL v3 runtime. Fixed-step simulation, interpolation, menus and progression.
 * Redline (v4) adds nitro input, impact/finish direction, coasting outros, haptics and reward wiring.
 * The small pure helpers export in Node for pacing/ghost/director regression tests.
 */
(function(global){
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),STEP=1/120,REFRESH=[60,90,120,144,165,240];
  const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
  const QUALITY=Object.freeze([
    {factor:1,particleScale:1,detail:'high'},{factor:.85,particleScale:1,detail:'high'},
    {factor:.72,particleScale:1,detail:'high'},{factor:.6,particleScale:1,detail:'high'},
    {factor:.6,particleScale:.65,detail:'high'},{factor:.6,particleScale:.4,detail:'medium'},
    {factor:.6,particleScale:.25,detail:'low'}
  ]);
  class FramePacer{
    constructor(){this.level=0;this.refreshHz=60;this.fps=60;this.cpuMs=0;this.windowTime=0;this.windowFrames=0;this.missed=0;this.headroom=0;this.age=0;this.fast=1/60;this.traceBuffer=new Float64Array(600*5);this.traceCount=0;this.traceCursor=0;}
    resetRefresh(){this.refreshHz=60;this.fast=1/60;this.windowTime=0;this.windowFrames=0;this.missed=0;this.headroom=0;}
    sample(dt,cpuMs,playing){
      if(dt<=0)return false;this.fps+=(1/dt-this.fps)*.06;this.cpuMs+=(cpuMs-this.cpuMs)*.07;
      if(dt>.0035&&dt<.04){this.fast=Math.min(this.fast*1.0003,dt);const estimate=1/this.fast;let best=60,diff=1000;for(const hz of REFRESH){const d=Math.abs(hz-estimate);if(d<diff){diff=d;best=hz;}}this.refreshHz=Math.max(this.refreshHz,best);}
      if(!playing){this.windowTime=0;this.windowFrames=0;this.missed=0;this.age=0;return false;}
      this.age+=dt;if(this.age<1)return false;
      this.windowTime+=dt;this.windowFrames++;if(dt>1/this.refreshHz*1.35)this.missed++;
      if(this.windowTime<2)return false;
      const ratio=this.missed/Math.max(1,this.windowFrames),elapsed=this.windowTime;
      this.windowTime=0;this.windowFrames=0;this.missed=0;
      if(ratio>.10){this.headroom=0;if(this.level<QUALITY.length-1){this.level++;return true;}}
      else if(ratio<.035&&this.cpuMs<1000/this.refreshHz*.55){this.headroom+=elapsed;if(this.headroom>=8&&this.level>0){this.level--;this.headroom=0;return true;}}
      else this.headroom=0;return false;
    }
    push(t,x,alpha,steps,cpu){const i=this.traceCursor*5,b=this.traceBuffer;b[i]=t;b[i+1]=x;b[i+2]=alpha;b[i+3]=steps;b[i+4]=cpu;this.traceCursor=(this.traceCursor+1)%600;this.traceCount=Math.min(600,this.traceCount+1);}
    trace(){const rows=[];for(let n=0;n<this.traceCount;n++){const i=((this.traceCursor-this.traceCount+n+600)%600)*5;rows.push(Array.from(this.traceBuffer.subarray(i,i+5)));}return rows;}
  }
  class GhostTape{
    constructor(){this.data=new Float64Array(9*4096);this.count=0;this.next=0;this.replay=null;this.pose=new Float64Array(9);this.frame={pose:this.pose,alpha:.35};}
    reset(){this.count=0;this.next=0;}
    record(time,pose){if(time+1e-8<this.next||this.count>=4096)return;for(let j=0;j<9;j++)this.data[this.count*9+j]=pose[j];this.count++;this.next+=.05;}
    serialize(){return JSON.stringify({version:1,hz:20,data:Array.from(this.data.subarray(0,this.count*9),(v,i)=>Math.round(v*(i%3===2?10000:1000)))});}
    load(raw){this.replay=null;try{const v=typeof raw==='string'?JSON.parse(raw):raw;if(!v||v.version!==1||v.hz!==20||!Array.isArray(v.data)||v.data.length<18||v.data.length%9||v.data.length>4096*9||!v.data.every(Number.isFinite))return false;this.replay=Float64Array.from(v.data,(x,i)=>x/(i%3===2?10000:1000));return true;}catch(_){return false;}}
    at(time){const b=this.replay;if(!b)return null;const index=Math.floor(time*20),n=b.length/9;if(index>=n-1)return null;const f=time*20-index,a=index*9,c=a+9;for(let j=0;j<9;j++){let d=b[c+j]-b[a+j];if(j%3===2)d=Math.atan2(Math.sin(d),Math.cos(d));this.pose[j]=b[a+j]+d*f;}return this.frame;}
  }
  // Real-time presentation envelope; the entire physics world shares its scale.
  class ShotDirector {
    constructor(){this.state={phase:'idle',intensity:0,timeScale:1,progress:0};this.reset();}
    reset(){this.elapsed=0;this.aimUsed=false;Object.assign(this.state,{phase:'idle',intensity:0,timeScale:1,progress:0});}
    start(phase){this.elapsed=0;this.state.phase=phase;this.state.progress=0;}
    shoot(){this.entryScale=this.state.timeScale;this.aimUsed=true;this.start('shot');}
    hit(){this.start('impact');}
    update(dt,state,reduced=false){
      const v=this.state;dt=Math.max(0,Math.min(.1,dt));
      if(v.phase==='idle'&&!this.aimUsed&&state.ammo>0&&state.weapon.canHit&&state.weapon.distance<33){this.aimUsed=true;this.start('aim');}
      this.elapsed+=dt;
      if(v.phase==='shot'&&!state.projectile&&this.elapsed>.1)this.start(state.monster.alive?'miss':'impact');
      const duration={aim:1.35,shot:3.2,impact:.64,miss:.38}[v.phase]||1;
      v.progress=Math.min(1,this.elapsed/duration);
      if(v.phase==='aim'){v.intensity=smooth(this.elapsed/.18)*(1-smooth((this.elapsed-.95)/.4));v.timeScale=1-.55*v.intensity;}
      else if(v.phase==='shot'){v.intensity=1;v.timeScale=this.entryScale-(this.entryScale-.22)*smooth(this.elapsed/.1);}
      else if(v.phase==='impact'){v.intensity=1-smooth(this.elapsed/.64);v.timeScale=.14+.86*smooth((this.elapsed-.08)/.56);}
      else if(v.phase==='miss'){v.intensity=.5*(1-v.progress);v.timeScale=.4+.6*smooth(v.progress);}
      else{v.intensity=0;v.timeScale=1;}
      if(v.progress>=1&&v.phase!=='idle'){v.phase='idle';v.intensity=0;v.timeScale=1;}
      if(reduced){v.timeScale=1;v.intensity=0;}
      return v;
    }
  }
  // Slams, wrecks and run endings. `scale` is the slowest world speed, `bars`/`zoom` frame the
  // moment. Sticky kinds keep their final framing until the runtime swaps to a results screen.
  const IMPACTS=Object.freeze({
    slam:Object.freeze({priority:2,duration:.62,attack:.03,release:.24,scale:.16,recover:1,bars:.35,zoom:.55,sticky:false}),
    wreck:Object.freeze({priority:1,duration:.85,attack:.05,release:.42,scale:.3,recover:1,bars:.6,zoom:.5,sticky:false}),
    finish:Object.freeze({priority:3,duration:1.45,attack:.07,release:0,scale:.3,recover:.62,bars:1,zoom:.75,sticky:true}),
    fail:Object.freeze({priority:3,duration:1.3,attack:.05,release:0,scale:.26,recover:.55,bars:1,zoom:.65,sticky:true}),
    stall:Object.freeze({priority:3,duration:1.4,attack:.3,release:0,scale:1,recover:1,bars:1,zoom:.45,sticky:true})
  });
  class ImpactDirector{
    constructor(){this.state={kind:'idle',timeScale:1,bars:0,zoom:0,progress:0};this.reset();}
    reset(){this.elapsed=0;this.strength=1;Object.assign(this.state,{kind:'idle',timeScale:1,bars:0,zoom:0,progress:0});}
    get done(){return !IMPACTS[this.state.kind]||this.state.progress>=1;}
    trigger(kind,strength=1){
      const next=IMPACTS[kind],current=IMPACTS[this.state.kind];if(!next)return false;
      if(current&&current.priority>next.priority)return false;
      this.elapsed=0;this.strength=clamp(Number(strength)||0,.3,1);this.state.kind=kind;this.state.progress=0;return true;
    }
    update(dt,reduced=false){
      const v=this.state,e=IMPACTS[v.kind];dt=clamp(Number(dt)||0,0,.1);
      if(!e){v.timeScale=1;v.bars=0;v.zoom=0;v.progress=0;return v;}
      this.elapsed+=dt;const t=this.elapsed;v.progress=Math.min(1,t/e.duration);
      let k=smooth(t/e.attack);
      if(e.sticky)v.timeScale=e.scale+(e.recover-e.scale)*smooth((t-e.attack)/Math.max(.001,e.duration-e.attack));
      else{k=Math.min(k,1-smooth((t-e.release)/Math.max(.001,e.duration-e.release)));v.timeScale=1-(1-e.scale)*k*this.strength;}
      v.bars=e.bars*k;v.zoom=e.zoom*k*(e.sticky?1:this.strength);
      if(v.progress>=1&&!e.sticky){v.kind='idle';v.timeScale=1;v.bars=0;v.zoom=0;v.progress=0;}
      if(reduced){v.timeScale=1;v.bars=0;v.zoom=0;}
      return v;
    }
  }
  if(typeof document==='undefined'){if(typeof module!=='undefined')module.exports={FramePacer,GhostTape,ShotDirector,ImpactDirector,IMPACTS,QUALITY};return;}
  const Rules=global.IronRules,stages=global.TruckPhysics.STAGES,biomes=global.IRON_BIOMES;
  const canvas=document.getElementById('gameCanvas'),app=document.getElementById('app');
  const ui=new global.IronUI(document),audio=new global.TruckAudio(),pacer=new FramePacer(),ghost=new GhostTape();
  let storage;try{storage=global.localStorage;}catch(_){storage=null;}
  const save=Rules.Save.load(storage);let stageIndex=clamp(save.selected|0,0,save.unlocked-1);
  let physics=new global.TruckPhysics(stageIndex,{tuning:save.upgrades}),state=physics.getState(),pose=new Float64Array(physics.poseLength);
  const renderer=new global.IronRenderer(canvas,{biomes}),shotDirector=new ShotDirector(),impactDirector=new ImpactDirector();
  let mode='title',screen='title',pausedFrom='playing';const navigation=[];
  let run=Rules.createRun(stageIndex),runTime=0,recoveries=0,accumulator=0,last=performance.now();
  let countdownLeft=0,countdownNumber=0,countdownStep=.62,hitStop=0,slowLeft=0,flippedTime=0,fallenTime=0;
  let hudClock=0,musicClock=0,lowFuelWarned=false,monsterWarned=false,lockWarned=false,stageResult=null,outro=null;
  let width=innerWidth,height=innerHeight,touch=false,layout={touch:false,safeTop:88,safeBottom:96};
  let renderScale=1,qualityName='high',lastQuality='',warmReady=false,ignoreBlurUntil=0;
  const keys=new Set(),pointerMap=new Map(),pedal={gas:0,reverse:0,brake:0,left:0,right:0,nitro:0};
  const input={throttle:0,brake:false,lean:0,boost:false,timeScale:1},coastInput={throttle:0,brake:false,lean:0,boost:false,timeScale:1};
  const padPrevious=new Uint8Array(20),padState={gas:0,reverse:0,brake:false,lean:0,boost:false};
  let padMenuDirection='',padRepeat=0;
  // Redline feel state: auto-nitro latch, rocket start window, chain awards, haptics and pass-by cues.
  let autoBoost=false,everBoosted=false,nitroTip=false,gasHeld=false,lastGasEdge=-1e9,goTime=-1e9,rocketDone=true;
  let chainMultiplier=1,boostRumble=0,musicBoost=0,worldDt=0,whooshXs=[],whooshIndex=0;
  const liveGoal={won:true,time:0,fuel:100,recoveries:0,cleared:0,totalZombies:0,cans:0,totalCans:0,stats:null,rivalGap:0};
  const view={par:0,goal:false,goalId:'',stageIndex,stageName:'',progress:0,time:0,score:0,ghostDelta:null,fuel:100,cleared:0,totalZombies:0,speed:0,gear:1,rpm:820,ammo:1,locked:false,monsterDistance:0,monsterAlive:true,monsterProgress:null,rivalProgress:null,racePosition:1,combo:0,comboLeft:0,comboMax:3,checkpointProgress:[],paused:false,muted:false,nitro:0,boosting:false,nitroReady:false,nitroHint:'',slipstream:0,gap:null};
  const cinema={kind:'idle',bars:0,zoom:0,progress:0};
  const frame={state,pose,alpha:1,dt:0,time:0,mode,input,ghost:null,layout,settings:save.settings,cinema};
  const musicState={biome:stageIndex,intensity:.2,mood:'menu',playing:true,timeScale:1,boost:0,tension:0};
  const perf={fps:60,refreshHz:60,renderScale:1,quality:'high',cpuMs:0,drawOps:0,trace:()=>pacer.trace()};
  const NO_PADS=[];let activePad=null;const gamepadProvider=()=>navigator.getGamepads?navigator.getGamepads():NO_PADS;
  const pressed=i=>!!activePad?.buttons[i]?.pressed,value=i=>activePad?.buttons[i]?.value||0,edge=i=>pressed(i)&&!padPrevious[i];
  const TIPS={monster:'One charge. Wait for the green LOCKED signal, then press X / J or FIRE.',fuel:'Keep moving, collect amber fuel cans and save recovery for when you need it.',rival:'Iron Maw took the flag. Keep your momentum and land with the wheels underneath you.'};
  function primeAudio(){return audio.context?.state==='running'?Promise.resolve(true):audio.prime();}
  function persist(){Rules.Save.save(storage,save);}
  function refreshCampaign(){ui.setCampaign(save,stages,biomes,Rules);}
  function clearInput(){keys.clear();pointerMap.clear();for(const key of Object.keys(pedal))pedal[key]=0;for(const button of ui.pedals)button.classList.remove('pressed');input.throttle=0;input.brake=false;input.lean=0;input.boost=false;padState.gas=0;padState.reverse=0;padState.brake=false;padState.lean=0;padState.boost=false;autoBoost=false;gasHeld=false;}
  const nitroHint=()=>activePad?'RB':touch?'':'Z';
  let droveOnce=false,gasTipAt=1.6;const nudge=on=>{if(ui.setNudge)ui.setNudge('gas',on);};
  // Kid-proofing: a stray pinch, ctrl-scroll or two-finger drag must never zoom the page away from the HUD.
  for(const type of ['gesturestart','gesturechange','gestureend'])document.addEventListener(type,event=>event.preventDefault(),{passive:false});
  window.addEventListener('wheel',event=>{if(event.ctrlKey||event.metaKey)event.preventDefault();},{passive:false});
  document.addEventListener('touchmove',event=>{if(event.touches&&event.touches.length>1)event.preventDefault();},{passive:false});
  const award=(kind,data)=>{if(ui.award)ui.award(kind,data);};
  const stop=seconds=>{if(!save.settings.reducedMotion)hitStop=Math.max(hitStop,seconds);};
  // Dual-rumble on a connected pad; a short buzz for the heaviest hits on touch devices.
  function rumble(strong,weak,ms){
    if(save.settings.haptics===false||mode!=='playing')return;
    try{
      const actuator=activePad&&activePad.vibrationActuator;
      if(actuator&&actuator.playEffect){const done=actuator.playEffect('dual-rumble',{startDelay:0,duration:Math.round(ms),weakMagnitude:clamp(weak,0,1),strongMagnitude:clamp(strong,0,1)});if(done&&done.catch)done.catch(()=>{});}
      else if(touch&&strong>=.7&&navigator.vibrate)navigator.vibrate(Math.min(70,Math.round(ms*.4)));
    }catch(_){}
  }
  function buildWhoosh(){
    const track=physics.track,xs=[];
    for(let d=50;d<track.length;d+=100)xs.push(track.startX+d);
    for(let i=0;i<track.segments.length-1;i++){const s=track.segments[i];xs.push(s[s.length-1].x-5);}
    for(let i=1;i<track.checkpoints.length;i++)xs.push(track.checkpoints[i].x);
    whooshXs=xs.sort((a,b)=>a-b);whooshIndex=0;
  }
  function seekWhoosh(){whooshIndex=0;while(whooshIndex<whooshXs.length&&whooshXs[whooshIndex]<=state.x)whooshIndex++;}
  function applyQuality(force=false){
    const setting=save.settings.quality;let q=QUALITY[pacer.level];
    if(setting==='high')q=QUALITY[0];else if(setting==='balanced')q={factor:.85,particleScale:.7,detail:'medium'};else if(setting==='performance')q={factor:.6,particleScale:.35,detail:'low'};
    const next=Math.min(devicePixelRatio||1,2)*q.factor,particles=save.settings.reducedMotion?q.particleScale*.55:q.particleScale,key=`${next}:${particles}:${q.detail}`;
    if(force||key!==lastQuality){lastQuality=key;renderScale=next;qualityName=q.detail;renderer.setQuality({renderScale:next,particleScale:particles,detail:q.detail});}
  }
  function resize(){
    width=app.clientWidth||innerWidth;height=app.clientHeight||innerHeight;
    touch=matchMedia('(pointer:coarse)').matches||width<780;
    ui.setTouchMode(touch);const m=ui.metrics();layout.touch=touch;layout.safeTop=m.safeTop;layout.safeBottom=m.safeBottom;
    applyQuality();renderer.resize(width,height);pacer.resetRefresh();
  }
  new ResizeObserver(resize).observe(app);window.addEventListener('resize',resize);
  const pointerMedia=matchMedia('(pointer:coarse)');if(pointerMedia.addEventListener)pointerMedia.addEventListener('change',resize);
  function applySettings(){audio.setVolumes({master:save.settings.master,music:save.settings.music,sfx:save.settings.sfx});applyQuality();frame.settings=save.settings;refreshCampaign();}
  function show(name,data={}){
    screen=name;ui.clearFeedback();ui.showScreen(name,data);ui.hud.setVisible(false);ui.setRecoverVisible(false);clearInput();
    if(name==='pause'){mode='paused';audio.setPaused(true);}
    else if(name==='results'||name==='failed'){/* endOutro already chose its mode */}
    else {mode=name;audio.setPaused(false);}
    musicClock=1;
  }
  function loadStage(index,{brief=true,bypass=false}={}){
    index=clamp(index|0,0,9);if(!bypass&&index>=save.unlocked)return false;
    ui.clearFeedback();
    stageIndex=index;save.selected=index;persist();physics=new global.TruckPhysics(index,{tuning:save.upgrades});state=physics.getState();pose=new Float64Array(physics.poseLength);
    shotDirector.reset();impactDirector.reset();outro=null;frame.state=state;frame.pose=pose;physics.getPose(pose);renderer.setStage(physics,index);renderer.snapCamera();
    view.checkpointProgress=physics.track.checkpoints.slice(1).map(p=>(p.x-physics.track.startX)/physics.track.length);
    run=Rules.createRun(index);run.previousStars=save.stars[index]||[false,false,false];runTime=0;recoveries=0;accumulator=0;countdownLeft=0;hitStop=0;slowLeft=0;flippedTime=0;fallenTime=0;stageResult=null;lowFuelWarned=false;monsterWarned=false;lockWarned=false;ghost.reset();
    nitroTip=false;everBoosted=false;droveOnce=false;gasTipAt=1.6;nudge(false);chainMultiplier=1;boostRumble=0;rocketDone=true;buildWhoosh();
    try{ghost.load(storage?.getItem(`irontrail-ghost-v1-${index}`));}catch(_){ghost.replay=null;}
    ghost.record(0,pose);clearInput();refreshCampaign();musicClock=1;
    if(brief)showBrief();return true;
  }
  function showBrief(){
    const stage=stages[stageIndex];show('brief',{stageIndex,name:stage.name,length:stage.length,par:Rules.PAR_TIMES[stageIndex],challenge:Rules.CHALLENGES[stageIndex].label,best:save.best[stageIndex]||null});
  }
  // A retry counts down faster than a first start: back in the action in about a second.
  function countdown(skip=false,quick=false){
    primeAudio();screen=null;ui.showScreen(null);ui.setRecoverVisible(false);accumulator=0;last=performance.now();
    audio.setPaused(false);clearInput();rocketDone=true;
    if(skip){mode='playing';countdownLeft=0;ui.hud.setVisible(true);audio.go();}
    else{mode='countdown';countdownStep=quick?.4:.62;countdownLeft=3*countdownStep;countdownNumber=3;ui.hud.setVisible(false);ui.banner('3','countdown',countdownStep*1.3);audio.countdown(3);}
    musicClock=1;
  }
  function play(){
    primeAudio();audio.ui('confirm');if(screen==='title'){navigation.length=0;navigation.push('title');loadStage(stageIndex,{brief:true});return;}
    if(screen==='brief'){
      if(Object.keys(save.upgrades).some(key=>physics.tuning[key]!==save.upgrades[key]))loadStage(stageIndex,{brief:false,bypass:true});
      countdown();return;
    }
    if(screen==='pause'){resume();return;}
    if(screen==='results'){if(stageIndex<9)next();else retry();return;}
    if(screen==='failed')retry();
  }
  function retry(){navigation.length=0;audio.ui('confirm');loadStage(stageIndex,{brief:false,bypass:true});countdown(false,true);}
  function next(){if(stageIndex<9){navigation.length=0;navigation.push('stages');loadStage(stageIndex+1,{brief:true});audio.ui('confirm');}}
  function pause(){if(mode!=='playing'&&mode!=='countdown')return;pausedFrom=mode;show('pause',{stageName:stages[stageIndex].name,time:runTime,fuel:state.fuel});}
  function resume(){if(mode!=='paused')return;ui.showScreen(null);screen=null;mode=pausedFrom;clearInput();accumulator=0;last=performance.now();audio.setPaused(false);ui.hud.setVisible(mode==='playing');musicClock=1;}
  function title(){navigation.length=0;show('title');renderer.snapCamera();refreshCampaign();}
  function openScreen(name){if(mode==='playing'||mode==='countdown')pause();if(screen!==name)navigation.push(screen||'title');show(name);refreshCampaign();}
  function back(){
    audio.ui('back');if(mode==='playing'||mode==='countdown'){pause();return;}if(screen==='pause'){resume();return;}
    const target=navigation.pop()||'title';
    if(target==='pause'){show('pause',{stageName:stages[stageIndex].name,time:runTime,fuel:state.fuel});return;}
    if(target==='results'&&stageResult){mode=stageIndex===9?'victory':'cleared';show('results',stageResult);return;}
    if(target==='failed'&&stageResult){mode='failed';show('failed',stageResult);return;}
    if(target==='brief'){showBrief();return;}if(['stages','garage','settings'].includes(target)){show(target);refreshCampaign();return;}title();
  }
  function recover(){
    if(mode!=='playing'||outro)return;const ok=physics.reset(physics.checkpointIndex);state=physics.getState();
    if(!ok){if(physics.failed)beginOutro(false,physics.failed);return;}
    recoveries++;accumulator=0;flippedTime=0;fallenTime=0;hitStop=0;impactDirector.reset();autoBoost=false;physics.getPose(pose);renderer.snapCamera();seekWhoosh();ui.cue('recover');audio.ui('back');ui.setRecoverVisible(false);
  }
  function fire(){if(mode!=='playing'||outro)return;if(physics.fire()){state=physics.getState();shotDirector.shoot();ui.clearFeedback();ui.cue('shot');}else audio.ui('error');}
  function toggleSound(){
    if(audio.muted||audio.context?.state!=='running'){audio.setMuted(false);primeAudio().then(ok=>{if(ok)audio.ui('confirm');});}
    else audio.setMuted(true);
    view.muted=audio.muted;ui.hud.update(view);
  }
  async function testSound(){
    audio.setMuted(false);view.muted=false;ui.hud.update(view);
    if(await primeAudio()){audio.enableMeter();audio.testSound();}
    updateAudioStatus();
  }
  const audioDebug=new URLSearchParams(location.search).has('audioDebug');
  let audioReadout=null,audioStatusClock=0,audioPeak=0;
  if(audioDebug){audioReadout=document.createElement('pre');audioReadout.id='audioDiagnostics';audioReadout.setAttribute('aria-label','Live audio diagnostics');app.appendChild(audioReadout);}
  function updateAudioStatus(){
    if(screen!=='settings'&&!audioDebug)return;
    audio.enableMeter();const status=audio.status();audioPeak=Math.max(audioPeak,status.peak);
    ui.setAudioStatus(status);
    if(audioReadout)audioReadout.textContent=JSON.stringify({mode, ...status,peakMax:audioPeak},null,2);
  }
  async function fullscreen(){try{ignoreBlurUntil=performance.now()+800;if(document.fullscreenElement)await document.exitFullscreen();else await app.requestFullscreen();}catch(_){ui.toast('Fullscreen is not available here',2,'warn');}}
  function buy(track){const result=Rules.buyUpgrade(save,track);if(result.ok){persist();refreshCampaign();ui.showScreen('garage');audio.ui('buy');ui.cue('upgrade');}else{audio.ui('error');ui.cue('error',{value:result.reason==='max'?'✓':'◆'});}}
  function setting(key,value){
    if(!(key in save.settings))return;
    if(['master','music','sfx'].includes(key))value=clamp(Number(value)||0,0,1);
    else if(['shake','showFps','reducedMotion','haptics','autoNitro'].includes(key))value=!!value;
    else if(key==='quality'&&!['auto','high','balanced','performance'].includes(value))return;
    const previousScale=renderScale;save.settings[key]=value;persist();applySettings();
    if(key==='quality'&&renderScale>previousScale)renderer.resize(width,height);
    audio.ui('move');
  }
  ui.on('play',play);ui.on('selectStage',i=>{navigation.length=0;navigation.push('stages');if(loadStage(i))audio.ui('confirm');});ui.on('retry',retry);ui.on('next',next);ui.on('resume',resume);ui.on('pause',pause);ui.on('title',title);ui.on('stages',()=>openScreen('stages'));ui.on('garage',()=>openScreen('garage'));ui.on('settings',()=>openScreen('settings'));ui.on('dedication',()=>openScreen('dedication'));ui.on('back',back);ui.on('buy',buy);ui.on('setting',setting);ui.on('fire',fire);ui.on('recover',recover);ui.on('restart',retry);ui.on('sound',toggleSound);ui.on('testSound',testSound);ui.on('fullscreen',fullscreen);
  ui.on('sfx',kind=>{if(kind==='tick')audio.scoreTick();else if(kind==='stamp')audio.ui('buy');});
  function firstGesture(){primeAudio();}
  for(const type of ['pointerdown','touchend','click','keydown'])window.addEventListener(type,firstGesture,{capture:true,passive:true});
  function menuMove(direction){if(ui.navigate){ui.navigate(direction);audio.ui('move');return;}const buttons=Array.from(document.querySelectorAll('button,input,select')).filter(e=>!e.disabled&&e.getClientRects().length);if(!buttons.length)return;let i=buttons.indexOf(document.activeElement);i=(i+(direction==='up'||direction==='left'?-1:1)+buttons.length)%buttons.length;buttons[i].focus();audio.ui('move');}
  function menuActivate(){if(ui.activate){ui.activate();return;}const el=document.activeElement;if(el instanceof HTMLButtonElement&&!el.disabled)el.click();else document.getElementById('playButton')?.click();}
  const CODES=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Space','KeyR','KeyC','KeyP','KeyM','KeyF','KeyX','KeyJ','KeyZ','KeyN','ShiftLeft','ShiftRight','Escape','Enter']);
  window.addEventListener('keydown',event=>{
    if(event.metaKey||event.ctrlKey||event.altKey||!CODES.has(event.code))return;
    const el=event.target,editing=el instanceof HTMLInputElement||el instanceof HTMLSelectElement;
    if(editing)return;
    if(el instanceof HTMLButtonElement&&(event.code==='Enter'||event.code==='Space'&&(mode!=='playing'||el.id==='fireButton')))return;
    event.preventDefault();
    if(!event.repeat){
      if(event.code==='KeyM')return toggleSound();if(event.code==='KeyF')return fullscreen();
      if(event.code==='Escape')return back();if(event.code==='KeyP')return mode==='paused'?resume():pause();
      if(mode==='playing'){
        if(outro){if(event.code==='Enter')skipOutro();else if(event.code==='KeyR')retry();return;}
        if(event.code==='KeyX'||event.code==='KeyJ')return fire();if(event.code==='KeyC')return recover();if(event.code==='KeyR')return retry();
      }
      else if(event.code==='Enter')return menuActivate();
      else if(screen&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code))return menuMove(event.code.slice(5).toLowerCase());
    }
    // Keys pressed during the countdown are already down when GO lands.
    if(mode==='playing'||mode==='countdown')keys.add(event.code);
  });
  window.addEventListener('keyup',event=>keys.delete(event.code));
  canvas.addEventListener('pointerdown',()=>{if(outro)skipOutro();});
  for(const button of ui.pedals){
    button.addEventListener('pointerdown',event=>{event.preventDefault();if(mode!=='playing'&&mode!=='countdown')return;const name=button.dataset.input;if(!(name in pedal))return;button.setPointerCapture(event.pointerId);pointerMap.set(event.pointerId,name);pedal[name]++;button.classList.add('pressed');});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,event=>{const name=pointerMap.get(event.pointerId);if(name){pedal[name]=Math.max(0,pedal[name]-1);pointerMap.delete(event.pointerId);}button.classList.remove('pressed');});
    button.addEventListener('contextmenu',event=>event.preventDefault());
  }
  function pollPad(dt){
    padState.gas=0;padState.reverse=0;padState.brake=false;padState.lean=0;padState.boost=false;
    const list=gamepadProvider();let pad=null;for(let i=0;i<list.length;i++)if(list[i]?.connected){pad=list[i];break;}if(!pad){activePad=null;padPrevious.fill(0);return;}activePad=pad;
    if(edge(9)){if(mode==='paused')resume();else pause();}
    if(mode==='playing'||mode==='countdown'){
      padState.gas=value(7);const left=value(6);padState.brake=left>.1&&state.speed>1;padState.reverse=padState.brake?0:left;
      const axis=pad.axes[0]||0;padState.lean=Math.abs(axis)>.18?axis:Number(pressed(15))-Number(pressed(14));
      padState.boost=pressed(5)||pressed(4);
      if(mode==='playing'){
        if(edge(0)){if(outro)skipOutro();else fire();}
        if(edge(2))recover();if(edge(3))retry();if(edge(1))pause();
      }
    }else if(screen){
      const x=pad.axes[0]||0,y=pad.axes[1]||0;let direction=pressed(12)||y<-.55?'up':pressed(13)||y>.55?'down':pressed(14)||x<-.55?'left':pressed(15)||x>.55?'right':'';
      padRepeat-=dt;if(direction&&(direction!==padMenuDirection||padRepeat<=0)){menuMove(direction);padRepeat=.23;}padMenuDirection=direction;
      if(edge(0))menuActivate();if(edge(1))back();
    }
    for(let i=0;i<padPrevious.length;i++)padPrevious[i]=pressed(i)?1:0;
  }
  function readInput(now){
    const gas=keys.has('ArrowUp')||keys.has('KeyW')||pedal.gas>0?1:padState.gas;
    const reverse=keys.has('ArrowDown')||keys.has('KeyS')||pedal.reverse>0?1:padState.reverse;
    input.throttle=clamp(gas-reverse,-1,1);input.brake=keys.has('Space')||pedal.brake>0||padState.brake;
    input.lean=clamp(Number(keys.has('ArrowRight')||keys.has('KeyD')||pedal.right>0)-Number(keys.has('ArrowLeft')||keys.has('KeyA')||pedal.left>0)+padState.lean,-1,1);
    const held=keys.has('KeyZ')||keys.has('KeyN')||keys.has('ShiftLeft')||keys.has('ShiftRight')||pedal.nitro>0||padState.boost;
    // Auto nitro (setting): light a healthy meter on the ground and ride it until it is spent.
    if(save.settings.autoNitro&&mode==='playing'&&!outro){
      if(!autoBoost&&state.nitro>=60&&state.grounded&&!state.inverted&&input.throttle>.5&&Math.abs(state.speed)>6)autoBoost=true;
      else if(autoBoost&&(!(state.nitro>1)||input.throttle<=.5))autoBoost=false;
    }else autoBoost=false;
    input.boost=held||autoBoost;
    const down=input.throttle>.5;if(down&&!gasHeld)lastGasEdge=now;gasHeld=down;
  }
  window.addEventListener('blur',()=>{clearInput();if(performance.now()>ignoreBlurUntil)pause();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();pause();}});
  // Throttle pressed within a quarter second of GO: a small nitro head start.
  function rocketStart(){
    rocketDone=true;if(typeof physics.grantNitro!=='function')return;physics.grantNitro(20);state=physics.getState();
    award('start',{label:'Rocket start'});audio.perfect();renderer.popup(0,state.x,state.y+2.4,'nitro');rumble(.6,.8,170);
  }
  function physicsEvent(event){
    renderer.onEvent(event,state);audio.setScene(state,event);
    const s=clamp(Number(event.strength)||0,0,1),mine=event.owner!=='rival';
    switch(event.type){
      case 'takeoff':audio.takeoff(event.strength);break;
      case 'land':audio.landing(event.strength);rumble(.25+s*.65,.2+s*.4,70+s*130);if(s>.8)stop(.02);break;
      case 'landing':
        if(event.perfect){audio.perfect();if(ui.award)ui.award('perfect',{label:'Perfect landing'});else ui.cue('trick',{value:'★'});}
        if(event.flips>0){if(ui.award)ui.award('flip',{label:event.dir==='front'?'Front flip':'Back flip',value:event.flips>1?'×'+event.flips:''});else ui.cue('trick',{value:'↻ ×'+event.flips});}
        if(event.bigAir&&event.upright)award('air',{label:'Big air'});
        break;
      case 'flip':audio.flip(event.count);if(!save.settings.reducedMotion)slowLeft=.10;rumble(.3,.6,90);break;
      case 'fuel':audio.pickup();lowFuelWarned=false;break;
      case 'zombie':audio.zombieHit(event.strength);if(s>.55)stop(.026);rumble(.2+s*.4,.5,60);break;
      case 'smash':if(audio.smash)audio.smash(Math.max(.2,s),event.variant|0);if(mine)rumble(.15+s*.25,.45,45);break;
      case 'collision':audio.collision(event.strength);rumble(.3+s*.7,.6,150);break;
      case 'slam':
        if(audio.slam)audio.slam(Math.max(.6,s));else audio.collision(1);
        if(audio.music&&audio.music.hit)audio.music.hit('slam');
        impactDirector.trigger('slam',Math.max(.6,s));stop(.07);rumble(1,1,340);award('slam',{label:'Nitro slam'});break;
      case 'wreck':
        if(audio.wreck)audio.wreck(Math.max(.4,s),event.kind);
        impactDirector.trigger('wreck',Math.max(.5,s));rumble(.9,.7,280);award('wreck',{label:event.kind==='fall'?'Over the edge':'Wrecked'});break;
      case 'nitro':
        if(audio.nitro)audio.nitro(event.phase,{owner:event.owner||'player',empty:!!event.empty});
        if(mine){if(event.phase==='start'){everBoosted=true;boostRumble=.11;rumble(.45,.9,200);}else if(event.phase==='full')award('nitro',{label:'Nitro full'});}
        break;
      case 'escalate':if(audio.escalate)audio.escalate();ui.banner('Iron Maw ignites!','big',1.5,'ignite');rumble(.5,.9,260);break;
      case 'shot':audio.gunshot();rumble(1,.8,170);break;
      case 'monsterHit':audio.monsterHit();shotDirector.hit();ui.cue('hit');award('giant',{label:'Giant down'});rumble(1,1,380);break;
      case 'monsterCrash':audio.monsterCrash();rumble(1,1,420);break;
      case 'checkpoint':audio.checkpoint();ui.cue('checkpoint');break;
      case 'empty':if(audio.stall)audio.stall();break;
    }
    audio.setScene();
    const reward=Rules.onEvent(run,event,{state,time:runTime,recoveries});
    if(reward){
      if(event.type!=='monsterHit')renderer.popup(reward.points,event.x??state.x,event.y??state.y+1,reward.kind);
      if(reward.combo>1)audio.combo(reward.combo);
      if(event.type==='zombie'||event.type==='smash'){
        const multiplier=Math.min(5,1+Math.floor((Math.max(1,reward.combo)-1)/3));
        if(multiplier>chainMultiplier)award('chain',{label:'Chain',value:'×'+multiplier});
        chainMultiplier=multiplier;
      }
    }
  }
  // Presentation only: the run is already decided while the world coasts.
  function outroEvent(event){
    renderer.onEvent(event,state);audio.setScene(state,event);
    if(event.type==='land')audio.landing(event.strength);else if(event.type==='collision')audio.collision(event.strength);else if(event.type==='takeoff')audio.takeoff(event.strength);
    audio.setScene();
  }
  // The result is computed and saved the instant the run ends; the world then coasts under a
  // finish/fail envelope before the screen appears. Reduced motion goes straight to the screen.
  function beginOutro(won,reason){
    if(mode!=='playing'||outro)return;clearInput();ui.setRecoverVisible(false);hitStop=0;slowLeft=0;
    const summary={time:runTime,fuel:state.fuel,won,recoveries,cleared:state.cleared,totalZombies:state.totalZombies,cans:state.stats.cans,totalCans:physics.fuelCans.length,stats:state.stats,maxCombo:run.maxCombo,rivalGap:state.rival?state.x-state.rival.x:0,previousStars:save.stars[stageIndex]||[false,false,false]};
    const result=Rules.finish(run,summary),record=Rules.Save.recordResult(save,stageIndex,result,summary);persist();refreshCampaign();
    if(won&&record.newBest&&ghost.count>1){try{storage?.setItem(`irontrail-ghost-v1-${stageIndex}`,ghost.serialize());}catch(_){}}
    stageResult={stageIndex,name:stages[stageIndex].name,time:runTime,par:Rules.PAR_TIMES[stageIndex],score:result.score,stars:result.stars,breakdown:result.breakdown,awards:result.awards||[],scrap:result.scrap,newBest:record.newBest,newScoreBest:record.newScoreBest,challenge:result.challenge,nextAvailable:won&&stageIndex<9,reason,tip:TIPS[reason]||TIPS.rival};
    const kind=won?'finish':reason==='fuel'?'stall':'fail',instant=save.settings.reducedMotion||typeof physics.coast!=='function';
    outro={won,elapsed:0,duration:instant?0:IMPACTS[kind].duration};
    impactDirector.reset();impactDirector.trigger(kind,1);
    if(won){
      renderer.celebrate(stageIndex===9?'victory':'clear');if(audio.finishLine)audio.finishLine(true);audio.celebrate();if(audio.music&&audio.music.hit)audio.music.hit('finish');
      if(!instant)ui.banner(stageIndex===9?'Iron Maw beaten!':'Finish!','big',1.3,stageIndex===9?'boss':'finish');rumble(.8,1,420);
    }else{
      if(reason==='rival'&&audio.finishLine)audio.finishLine(false);
      if(!instant)ui.banner(reason==='fuel'?'Out of fuel':reason==='monster'?'Wrecked!':'Iron Maw wins','big',1.3,reason==='fuel'?'fuel':reason==='monster'?'giant':'rival');rumble(1,.6,360);
    }
    if(instant)endOutro();
  }
  function endOutro(){
    if(!outro)return;const won=outro.won;outro=null;impactDirector.reset();
    mode=won?(stageIndex===9?'victory':'cleared'):'failed';audio.result(won);
    show(won?'results':'failed',stageResult);musicClock=1;
    if(won)for(let i=0;i<3;i++)if(stageResult.stars[i])setTimeout(()=>{if(screen==='results')audio.star(i);},180+i*220);
  }
  function skipOutro(){if(outro&&outro.elapsed>.35)outro.elapsed=outro.duration;}
  function tick(){
    physics.step(STEP,input);state=physics.getState();runTime+=STEP;Rules.tick(run,STEP);
    for(const event of physics.drainEvents())physicsEvent(event);
    ghost.record(runTime,physics.poseCurr);
    if(state.fuel<22&&!lowFuelWarned){lowFuelWarned=true;audio.lowFuel();ui.cue('fuel');}
    if(state.monster.alive&&state.weapon.distance<70&&!monsterWarned){monsterWarned=true;ui.cue('target');}
    if(state.weapon.canHit&&state.ammo>0&&!lockWarned){lockWarned=true;ui.cue('target',{value:touch||activePad?undefined:'X'});}
    while(whooshIndex<whooshXs.length&&state.x>=whooshXs[whooshIndex]){whooshIndex++;if(audio.whoosh&&Math.abs(state.speed)>15)audio.whoosh(clamp((Math.abs(state.speed)-12)/18,.2,1));}
    if(run.combo===0)chainMultiplier=1;
    // A driver who cannot read gets a picture prompt (and a bouncing pedal) until the truck first moves under power.
    if(!droveOnce){if(input.throttle>.5){droveOnce=true;nudge(false);}else if(runTime>=gasTipAt){gasTipAt=runTime+4.5;nudge(true);ui.cue('drive',{value:touch?undefined:activePad?'RT':'↑',seconds:2.6});}}
    if(!nitroTip&&!everBoosted&&state.nitro>=60&&runTime>1.5){nitroTip=true;award('nitro',{label:'Nitro ready',value:nitroHint()});}
    const angle=Math.abs(Math.atan2(Math.sin(state.angle),Math.cos(state.angle)));
    flippedTime=angle>1.7&&Math.abs(state.speed)<2?flippedTime+STEP:0;fallenTime=state.y<-9?fallenTime+STEP:0;
    const needRecover=state.inverted||flippedTime>1.2||state.y<-3||state.stalledTime>2.5;ui.setRecoverVisible(needRecover);
    if(physics.failed){beginOutro(false,physics.failed);return;}if(physics.finished){beginOutro(true);return;}
    if(fallenTime>.45||state.x<-31)recover();
  }
  function updateHud(ghostFrame){
    ui.setInputMode?.(activePad?'gamepad':touch?'touch':'keyboard');
    const track=physics.track;view.stageIndex=stageIndex;view.stageName=stages[stageIndex].name;view.progress=clamp((state.x-track.startX)/track.length,0,1);
    view.distance=clamp(state.x-track.startX,0,track.length);view.length=track.length;
    view.shootingPhase=shotDirector.state.phase;view.time=runTime;view.score=stageResult?stageResult.score:run.score;view.ghostDelta=ghostFrame?(ghostFrame.pose[0]-state.x)/Math.max(8,Math.abs(state.speed)):null;
    view.fuel=state.fuel;view.cleared=state.cleared;view.totalZombies=state.totalZombies;view.speed=state.speed;view.gear=audio.gear;view.rpm=audio.rpm;view.ammo=state.ammo;view.locked=state.weapon.canHit;view.monsterDistance=state.weapon.distance;view.monsterAlive=state.monster.alive;
    view.monsterProgress=state.monster.alive?clamp((state.monster.x-track.startX)/track.length,0,1):null;view.rivalProgress=state.rival?clamp((state.rival.x-track.startX)/track.length,0,1):null;view.racePosition=state.racePosition;view.combo=run.combo;view.comboLeft=run.comboLeft;view.comboMax=run.comboMax;view.paused=mode==='paused';view.muted=audio.muted;
    view.nitro=Number(state.nitro)||0;view.boosting=!!state.boosting;view.nitroReady=!!state.nitroReady;view.nitroHint=nitroHint();view.slipstream=Number(state.slipstream)||0;view.gap=state.rival?state.x-state.rival.x:null;
    // Live star goals: the clock star drains against par and the challenge star lights while its rule holds.
    const challenge=Rules.CHALLENGES&&Rules.CHALLENGES[stageIndex];view.par=(Rules.PAR_TIMES||[])[stageIndex]||0;
    if(challenge){liveGoal.time=runTime;liveGoal.fuel=state.fuel;liveGoal.recoveries=recoveries;liveGoal.cleared=state.cleared;liveGoal.totalZombies=state.totalZombies;liveGoal.cans=state.stats.cans;liveGoal.totalCans=physics.fuelCans.length;liveGoal.stats=state.stats;liveGoal.rivalGap=state.rival?state.x-state.rival.x:0;view.goal=!!challenge.check(liveGoal);view.goalId=challenge.id;}
    ui.hud.update(view);
  }
  function updateMusic(){
    const playing=mode==='playing',gap=state.rival?Math.abs(state.x-state.rival.x):99,progress=clamp((state.x-physics.track.startX)/physics.track.length,0,1);
    musicBoost+=((playing&&state.boosting?1:0)-musicBoost)*.4;
    musicState.timeScale=playing?Math.min(shotDirector.state.timeScale,impactDirector.state.timeScale):1;musicState.biome=stageIndex;
    musicState.intensity=playing?clamp(Math.abs(state.speed)/30+(run.combo>2?.18:0)+musicBoost*.2,0,1):.18;
    musicState.boost=playing?musicBoost:0;
    musicState.tension=playing?clamp((state.rival?clamp(1-gap/14,0,1)*(.4+.6*progress):0)+(state.fuel<25?(25-state.fuel)/25*.6:0),0,1):0;
    musicState.mood=playing?(state.fuel<20?'danger':stages[stageIndex].boss?'boss':'drive'):screen==='results'?'results':'menu';musicState.playing=mode!=='paused'&&!document.hidden;audio.setMusicState(musicState);
  }
  function animation(now){
    const begin=performance.now(),dt=clamp((now-last)/1000,0,.1),reduced=save.settings.reducedMotion;last=now;pollPad(dt);readInput(now);let steps=0;worldDt=0;
    if(mode==='countdown'){
      countdownLeft-=dt;const n=Math.ceil(countdownLeft/countdownStep);
      if(n>0&&n!==countdownNumber){countdownNumber=n;ui.banner(String(n),'countdown',countdownStep*1.3);audio.countdown(n);}
      if(countdownLeft<=0){mode='playing';accumulator=0;goTime=now;rocketDone=false;ui.hud.setVisible(true);ui.banner('GO!','go',.7);audio.go();}
    }
    if(mode==='playing'&&outro){
      const scale=impactDirector.update(dt,reduced).timeScale;outro.elapsed+=dt;worldDt=dt*scale;accumulator+=worldDt;
      while(accumulator>=STEP&&steps<8){if(!physics.coast(STEP)){accumulator=0;break;}state=physics.getState();for(const event of physics.drainEvents())outroEvent(event);accumulator-=STEP;steps++;}
      if(steps>=8&&accumulator>=STEP)accumulator%=STEP;
      coastInput.timeScale=scale;audio.update(state,dt,coastInput);
      if(outro.elapsed>=outro.duration)endOutro();
    }else if(mode==='playing'){
      const oldPhase=shotDirector.state.phase,encounter=shotDirector.update(dt,state,reduced),impact=impactDirector.update(dt,reduced);if(encounter.phase==='miss'&&oldPhase!=='miss')ui.cue('miss');
      const scale=Math.min(encounter.timeScale,impact.timeScale);
      let simulationDt=dt*scale;if(hitStop>0){hitStop=Math.max(0,hitStop-dt);simulationDt=0;}else if(slowLeft>0){slowLeft=Math.max(0,slowLeft-dt);simulationDt*=.75;}
      if(!rocketDone){if(now-goTime>250)rocketDone=true;else if(gasHeld&&lastGasEdge>=goTime-250)rocketStart();}
      worldDt=simulationDt;accumulator+=simulationDt;while(accumulator>=STEP&&steps<8&&mode==='playing'&&!outro){tick();accumulator-=STEP;steps++;}if(accumulator<0)accumulator=0;if(steps>=8&&accumulator>=STEP)accumulator%=STEP;
      if(mode==='playing'){
        input.timeScale=scale;audio.update(state,dt,outro?coastInput:input);
        if(state.boosting&&!outro){boostRumble-=dt;if(boostRumble<=0){boostRumble=.11;rumble(.16,.5,130);}}
      }
    }else accumulator=0;
    const playing=mode==='playing',alpha=playing?clamp(accumulator/STEP,0,1):1;physics.interpolatePose(alpha,pose);
    const ghostFrame=playing&&!outro?ghost.at(runTime):null,shot=shotDirector.state,impact=impactDirector.state;
    cinema.kind=playing?impact.kind:'idle';cinema.zoom=playing?impact.zoom:0;cinema.progress=playing?impact.progress:0;
    cinema.bars=playing&&!reduced?Math.max(impact.bars,shot.phase==='shot'||shot.phase==='impact'?shot.intensity*.85:shot.phase==='aim'?shot.intensity*.3:0):0;
    frame.state=state;frame.pose=pose;frame.alpha=alpha;frame.dt=mode==='paused'?0:dt;frame.worldDt=playing?worldDt:0;frame.encounter=shot;frame.time=runTime;frame.mode=mode;frame.ghost=ghostFrame;renderer.render(frame);
    hudClock+=dt;if(hudClock>=1/30){hudClock%=1/30;updateHud(ghostFrame);}
    musicClock+=dt;if(musicClock>=.1){musicClock%=.1;updateMusic();}
    audioStatusClock+=dt;if(audioStatusClock>=.1){audioStatusClock%=.1;updateAudioStatus();}
    if(ui.tick)ui.tick(dt);
    const cpu=performance.now()-begin;const change=pacer.sample(dt,cpu,mode==='playing');if(change&&save.settings.quality==='auto')applyQuality();
    perf.fps=pacer.fps;perf.refreshHz=pacer.refreshHz;perf.renderScale=renderScale;perf.quality=qualityName;perf.cpuMs=pacer.cpuMs;perf.drawOps=renderer.stats.drawOps;
    if(save.settings.showFps&&hudClock<dt)ui.setFps(perf);else if(!save.settings.showFps)ui.setFps(null);
    pacer.push(now,pose[0],alpha,steps,cpu);requestAnimationFrame(animation);
  }
  const qa=Object.freeze({start(index=0){loadStage(index,{brief:false,bypass:true});countdown(true);return true;},get warm(){return warmReady;}});
  global.irontrail=Object.freeze({get mode(){return mode;},get telemetry(){return {...state,time:runTime,bestAir:state.stats.maxAir,checkpoint:physics.checkpointIndex,recoveries,score:run.score};},get encounter(){return {...shotDirector.state};},get cinema(){return {...impactDirector.state};},get outro(){return !!outro;},get physics(){return physics;},get audio(){return audio;},get campaign(){return Rules.Save.migrate(save);},get stage(){return stageIndex+1;},get perf(){return perf;},qa});
  refreshCampaign();applySettings();resize();renderer.setStage(physics,stageIndex);physics.getPose(pose);buildWhoosh();view.checkpointProgress=physics.track.checkpoints.slice(1).map(p=>(p.x-physics.track.startX)/physics.track.length);show('title');updateHud(null);requestAnimationFrame(animation);
  const warm=()=>{global.TruckPhysics.warmUp(65);warmReady=true;};if(global.requestIdleCallback)requestIdleCallback(warm,{timeout:350});else setTimeout(warm,30);
})(globalThis);
