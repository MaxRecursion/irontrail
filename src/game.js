/* IRONTRAIL v3 runtime. Fixed-step simulation, interpolation, menus and progression.
 * The small pure helpers export in Node for pacing/ghost regression tests.
 */
(function(global){
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),STEP=1/120,REFRESH=[60,90,120,144,165,240];
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
    shoot(){this.aimUsed=true;this.start('shot');}
    hit(){this.start('impact');}
    update(dt,state,reduced=false){
      const v=this.state;dt=Math.max(0,Math.min(.1,dt));
      if(v.phase==='idle'&&!this.aimUsed&&state.ammo>0&&state.weapon.canHit&&state.weapon.distance<33){this.aimUsed=true;this.start('aim');}
      this.elapsed+=dt;
      if(v.phase==='shot'&&!state.projectile&&this.elapsed>.1)this.start(state.monster.alive?'miss':'impact');
      const duration={aim:1.35,shot:3.2,impact:.64,miss:.38}[v.phase]||1;
      v.progress=Math.min(1,this.elapsed/duration);
      const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
      if(v.phase==='aim'){v.intensity=smooth(this.elapsed/.18)*(1-smooth((this.elapsed-.95)/.4));v.timeScale=1-.55*v.intensity;}
      else if(v.phase==='shot'){v.intensity=1;v.timeScale=1-.78*smooth(this.elapsed/.1);}
      else if(v.phase==='impact'){v.intensity=1-smooth(this.elapsed/.64);v.timeScale=.14+.86*smooth((this.elapsed-.08)/.56);}
      else if(v.phase==='miss'){v.intensity=.5*(1-v.progress);v.timeScale=.4+.6*smooth(v.progress);}
      else{v.intensity=0;v.timeScale=1;}
      if(v.progress>=1&&v.phase!=='idle'){v.phase='idle';v.intensity=0;v.timeScale=1;}
      if(reduced){v.timeScale=1;v.intensity=0;}
      return v;
    }
  }
  if(typeof document==='undefined'){if(typeof module!=='undefined')module.exports={FramePacer,GhostTape,ShotDirector,QUALITY};return;}
  const Rules=global.IronRules,stages=global.TruckPhysics.STAGES,biomes=global.IRON_BIOMES;
  const canvas=document.getElementById('gameCanvas'),app=document.getElementById('app');
  const ui=new global.IronUI(document),audio=new global.TruckAudio(),pacer=new FramePacer(),ghost=new GhostTape();
  let storage;try{storage=global.localStorage;}catch(_){storage=null;}
  const save=Rules.Save.load(storage);let stageIndex=clamp(save.selected|0,0,save.unlocked-1);
  let physics=new global.TruckPhysics(stageIndex,{tuning:save.upgrades}),state=physics.getState(),pose=new Float64Array(physics.poseLength);
  const renderer=new global.IronRenderer(canvas,{biomes}),shotDirector=new ShotDirector();
  let mode='title',screen='title',pausedFrom='playing';const navigation=[];let primePending=false;
  let run=Rules.createRun(stageIndex),runTime=0,recoveries=0,accumulator=0,last=performance.now();
  let countdownLeft=0,countdownNumber=0,hitStop=0,slowLeft=0,flippedTime=0,fallenTime=0;
  let hudClock=0,musicClock=0,lowFuelWarned=false,monsterWarned=false,lockWarned=false,stageResult=null;
  let width=innerWidth,height=innerHeight,touch=false,layout={touch:false,safeTop:88,safeBottom:96};
  let renderScale=1,qualityName='high',lastQuality='',warmReady=false,ignoreBlurUntil=0;
  const keys=new Set(),pointerMap=new Map(),pedal={gas:0,reverse:0,brake:0,left:0,right:0};
  const input={throttle:0,brake:false,lean:0},padPrevious=new Uint8Array(20),padState={gas:0,reverse:0,brake:false,lean:0};
  let padMenuDirection='',padRepeat=0,lastPadTime=0;
  const view={stageIndex,stageName:'',progress:0,time:0,score:0,ghostDelta:null,fuel:100,cleared:0,totalZombies:0,speed:0,gear:1,rpm:820,ammo:1,locked:false,monsterDistance:0,monsterAlive:true,monsterProgress:null,rivalProgress:null,racePosition:1,combo:0,comboLeft:0,comboMax:3,checkpointProgress:[],paused:false,muted:false};
  const frame={state,pose,alpha:1,dt:0,time:0,mode,input,ghost:null,layout,settings:save.settings};
  const musicState={biome:stageIndex,intensity:.2,mood:'menu',playing:true};
  const perf={fps:60,refreshHz:60,renderScale:1,quality:'high',cpuMs:0,drawOps:0,trace:()=>pacer.trace()};
  const NO_PADS=[];let activePad=null;const gamepadProvider=()=>navigator.getGamepads?navigator.getGamepads():NO_PADS;
  const pressed=i=>!!activePad?.buttons[i]?.pressed,value=i=>activePad?.buttons[i]?.value||0,edge=i=>pressed(i)&&!padPrevious[i];
  function primeAudio(){if(audio.context?.state==='running'||primePending)return;primePending=true;audio.prime().finally(()=>{primePending=false;});}
  function persist(){Rules.Save.save(storage,save);}
  function refreshCampaign(){ui.setCampaign(save,stages,biomes,Rules);}
  function clearInput(){keys.clear();pointerMap.clear();for(const key of Object.keys(pedal))pedal[key]=0;for(const button of ui.pedals)button.classList.remove('pressed');input.throttle=0;input.brake=false;input.lean=0;padState.gas=0;padState.reverse=0;padState.brake=false;padState.lean=0;}
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
    else if(name==='results'||name==='failed'){/* finishRun already chose its mode */}
    else {mode=name;audio.setPaused(false);}
    musicClock=1;
  }
  function loadStage(index,{brief=true,bypass=false}={}){
    index=clamp(index|0,0,9);if(!bypass&&index>=save.unlocked)return false;
    ui.clearFeedback();
    stageIndex=index;save.selected=index;persist();physics=new global.TruckPhysics(index,{tuning:save.upgrades});state=physics.getState();pose=new Float64Array(physics.poseLength);
    shotDirector.reset();frame.state=state;frame.pose=pose;physics.getPose(pose);renderer.setStage(physics,index);renderer.snapCamera();
    view.checkpointProgress=physics.track.checkpoints.slice(1).map(p=>(p.x-physics.track.startX)/physics.track.length);
    run=Rules.createRun(index);run.previousStars=save.stars[index]||[false,false,false];runTime=0;recoveries=0;accumulator=0;countdownLeft=0;hitStop=0;slowLeft=0;flippedTime=0;fallenTime=0;stageResult=null;lowFuelWarned=false;monsterWarned=false;lockWarned=false;ghost.reset();
    try{ghost.load(storage?.getItem(`irontrail-ghost-v1-${index}`));}catch(_){ghost.replay=null;}
    ghost.record(0,pose);clearInput();refreshCampaign();musicClock=1;
    if(brief)showBrief();return true;
  }
  function showBrief(){
    const stage=stages[stageIndex];show('brief',{stageIndex,name:stage.name,length:stage.length,par:Rules.PAR_TIMES[stageIndex],challenge:Rules.CHALLENGES[stageIndex].label,best:save.best[stageIndex]||null});
  }
  function countdown(skip=false){
    primeAudio();screen=null;ui.showScreen(null);ui.setRecoverVisible(false);accumulator=0;last=performance.now();
    audio.setPaused(false);clearInput();
    if(skip){mode='playing';countdownLeft=0;ui.hud.setVisible(true);audio.go();}
    else{mode='countdown';countdownLeft=3;countdownNumber=3;ui.hud.setVisible(false);ui.banner('3','countdown',.9);audio.countdown(3);}
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
  function retry(){navigation.length=0;audio.ui('confirm');loadStage(stageIndex,{brief:false,bypass:true});countdown();}
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
    if(mode!=='playing')return;const ok=physics.reset(physics.checkpointIndex);state=physics.getState();
    if(!ok){if(physics.failed)finishRun(false,physics.failed);return;}
    recoveries++;accumulator=0;flippedTime=0;fallenTime=0;physics.getPose(pose);renderer.snapCamera();ui.cue('recover',{value:'−12'});audio.ui('back');ui.setRecoverVisible(false);
  }
  function fire(){if(mode!=='playing')return;if(physics.fire()){state=physics.getState();shotDirector.shoot();ui.cue('shot');}else audio.ui('error');}
  function toggleSound(){audio.setMuted(!audio.muted);view.muted=audio.muted;ui.hud.update(view);audio.ui('confirm');}
  async function fullscreen(){try{ignoreBlurUntil=performance.now()+800;if(document.fullscreenElement)await document.exitFullscreen();else await app.requestFullscreen();}catch(_){ui.toast('Fullscreen is not available here',2,'warn');}}
  function buy(track){const result=Rules.buyUpgrade(save,track);if(result.ok){persist();refreshCampaign();ui.showScreen('garage');audio.ui('buy');ui.cue('upgrade');}else{audio.ui('error');ui.cue('error',{value:result.reason==='max'?'✓':'◆'});}}
  function setting(key,value){
    if(!(key in save.settings))return;
    if(['master','music','sfx'].includes(key))value=clamp(Number(value)||0,0,1);
    else if(['shake','showFps','reducedMotion'].includes(key))value=!!value;
    else if(key==='quality'&&!['auto','high','balanced','performance'].includes(value))return;
    const previousScale=renderScale;save.settings[key]=value;persist();applySettings();
    if(key==='quality'&&renderScale>previousScale)renderer.resize(width,height);
    audio.ui('move');
  }
  ui.on('play',play);ui.on('selectStage',i=>{navigation.length=0;navigation.push('stages');if(loadStage(i))audio.ui('confirm');});ui.on('retry',retry);ui.on('next',next);ui.on('resume',resume);ui.on('pause',pause);ui.on('title',title);ui.on('stages',()=>openScreen('stages'));ui.on('garage',()=>openScreen('garage'));ui.on('settings',()=>openScreen('settings'));ui.on('back',back);ui.on('buy',buy);ui.on('setting',setting);ui.on('fire',fire);ui.on('recover',recover);ui.on('restart',retry);ui.on('sound',toggleSound);ui.on('fullscreen',fullscreen);
  function firstGesture(){primeAudio();}
  window.addEventListener('pointerdown',firstGesture,{capture:true});window.addEventListener('keydown',firstGesture,{capture:true});
  function menuMove(direction){if(ui.navigate){ui.navigate(direction);audio.ui('move');return;}const buttons=Array.from(document.querySelectorAll('button,input,select')).filter(e=>!e.disabled&&e.getClientRects().length);if(!buttons.length)return;let i=buttons.indexOf(document.activeElement);i=(i+(direction==='up'||direction==='left'?-1:1)+buttons.length)%buttons.length;buttons[i].focus();audio.ui('move');}
  function menuActivate(){if(ui.activate){ui.activate();return;}const el=document.activeElement;if(el instanceof HTMLButtonElement&&!el.disabled)el.click();else document.getElementById('playButton')?.click();}
  const CODES=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Space','KeyR','KeyC','KeyP','KeyM','KeyF','KeyX','KeyJ','Escape','Enter']);
  window.addEventListener('keydown',event=>{
    if(event.metaKey||event.ctrlKey||event.altKey||!CODES.has(event.code))return;
    const el=event.target,editing=el instanceof HTMLInputElement||el instanceof HTMLSelectElement;
    if(editing)return;
    if(el instanceof HTMLButtonElement&&(event.code==='Enter'||event.code==='Space'&&(mode!=='playing'||el.id==='fireButton')))return;
    event.preventDefault();
    if(!event.repeat){
      if(event.code==='KeyM')return toggleSound();if(event.code==='KeyF')return fullscreen();
      if(event.code==='Escape')return back();if(event.code==='KeyP')return mode==='paused'?resume():pause();
      if(mode==='playing'){if(event.code==='KeyX'||event.code==='KeyJ')return fire();if(event.code==='KeyC')return recover();if(event.code==='KeyR')return retry();}
      else if(event.code==='Enter')return menuActivate();
      else if(screen&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code))return menuMove(event.code.slice(5).toLowerCase());
    }
    if(mode==='playing')keys.add(event.code);
  });
  window.addEventListener('keyup',event=>keys.delete(event.code));
  for(const button of ui.pedals){
    button.addEventListener('pointerdown',event=>{event.preventDefault();if(mode!=='playing')return;button.setPointerCapture(event.pointerId);pointerMap.set(event.pointerId,button.dataset.input);pedal[button.dataset.input]++;button.classList.add('pressed');});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,event=>{const name=pointerMap.get(event.pointerId);if(name){pedal[name]=Math.max(0,pedal[name]-1);pointerMap.delete(event.pointerId);}button.classList.remove('pressed');});
    button.addEventListener('contextmenu',event=>event.preventDefault());
  }
  function pollPad(dt){
    padState.gas=0;padState.reverse=0;padState.brake=false;padState.lean=0;
    const list=gamepadProvider();let pad=null;for(let i=0;i<list.length;i++)if(list[i]?.connected){pad=list[i];break;}if(!pad){activePad=null;padPrevious.fill(0);return;}activePad=pad;
    if(edge(9)){if(mode==='paused')resume();else pause();}
    if(mode==='playing'){
      padState.gas=value(7);const left=value(6);padState.brake=left>.1&&state.speed>1;padState.reverse=padState.brake?0:left;
      const axis=pad.axes[0]||0;padState.lean=Math.abs(axis)>.18?axis:Number(pressed(15))-Number(pressed(14));
      if(edge(0))fire();if(edge(2))recover();if(edge(3))retry();if(edge(1))pause();
    }else if(screen){
      const x=pad.axes[0]||0,y=pad.axes[1]||0;let direction=pressed(12)||y<-.55?'up':pressed(13)||y>.55?'down':pressed(14)||x<-.55?'left':pressed(15)||x>.55?'right':'';
      padRepeat-=dt;if(direction&&(direction!==padMenuDirection||padRepeat<=0)){menuMove(direction);padRepeat=.23;}padMenuDirection=direction;
      if(edge(0))menuActivate();if(edge(1))back();
    }
    for(let i=0;i<padPrevious.length;i++)padPrevious[i]=pressed(i)?1:0;
  }
  function readInput(){
    const gas=keys.has('ArrowUp')||keys.has('KeyW')||pedal.gas>0?1:padState.gas;
    const reverse=keys.has('ArrowDown')||keys.has('KeyS')||pedal.reverse>0?1:padState.reverse;
    input.throttle=clamp(gas-reverse,-1,1);input.brake=keys.has('Space')||pedal.brake>0||padState.brake;
    input.lean=clamp(Number(keys.has('ArrowRight')||keys.has('KeyD')||pedal.right>0)-Number(keys.has('ArrowLeft')||keys.has('KeyA')||pedal.left>0)+padState.lean,-1,1);
  }
  window.addEventListener('blur',()=>{clearInput();if(performance.now()>ignoreBlurUntil)pause();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();pause();}});
  function physicsEvent(event){
    renderer.onEvent(event,state);
    switch(event.type){
      case 'takeoff':audio.takeoff(event.strength);break;
      case 'land':audio.landing(event.strength);break;
      case 'landing':if(event.perfect){audio.perfect();ui.cue('trick',{value:'★'});}if(event.flips>0)ui.cue('trick',{value:'↻ ×'+event.flips});break;
      case 'flip':audio.flip(event.count);if(!save.settings.reducedMotion)slowLeft=.10;break;
      case 'fuel':audio.pickup();lowFuelWarned=false;break;
      case 'zombie':audio.zombieHit(event.strength);break;
      case 'collision':audio.collision(event.strength);break;
      case 'shot':audio.gunshot();break;
      case 'monsterHit':audio.monsterHit();shotDirector.hit();ui.cue('hit',{value:'+1000'});break;
      case 'monsterCrash':audio.monsterCrash();break;
      case 'checkpoint':audio.checkpoint();ui.cue('checkpoint');break;
    }
    const reward=Rules.onEvent(run,event,{state,time:runTime,recoveries});
    if(reward){renderer.popup(`+${reward.points}`,event.x??state.x,event.y??state.y+1,reward.kind);if(reward.combo>1)audio.combo(reward.combo);}
  }
  function finishRun(won,reason){
    if(mode!=='playing')return;clearInput();ui.setRecoverVisible(false);
    const summary={time:runTime,fuel:state.fuel,won,recoveries,cleared:state.cleared,totalZombies:state.totalZombies,cans:state.stats.cans,totalCans:physics.fuelCans.length,stats:state.stats,rivalGap:state.rival?state.x-state.rival.x:0,previousStars:save.stars[stageIndex]||[false,false,false]};
    const result=Rules.finish(run,summary),record=Rules.Save.recordResult(save,stageIndex,result,summary);persist();refreshCampaign();
    if(won&&record.newBest&&ghost.count>1){try{storage?.setItem(`irontrail-ghost-v1-${stageIndex}`,ghost.serialize());}catch(_){}}
    mode=won?(stageIndex===9?'victory':'cleared'):'failed';audio.result(won);if(won){renderer.celebrate(stageIndex===9?'victory':'clear');audio.celebrate();}
    stageResult={stageIndex,name:stages[stageIndex].name,time:runTime,par:Rules.PAR_TIMES[stageIndex],score:result.score,stars:result.stars,breakdown:result.breakdown,scrap:result.scrap,newBest:record.newBest,newScoreBest:record.newScoreBest,challenge:result.challenge,nextAvailable:won&&stageIndex<9,reason,tip:reason==='monster'?'One charge. Wait for the green LOCKED signal, then press X / J or FIRE.':reason==='fuel'?'Keep moving, collect amber fuel cans and save recovery for when you need it.':'Iron Maw took the flag. Keep your momentum and land with the wheels underneath you.'};
    show(won?'results':'failed',stageResult);musicClock=1;
    if(won)for(let i=0;i<3;i++)if(result.stars[i])setTimeout(()=>{if(screen==='results')audio.star(i);},180+i*220);
  }
  function tick(){
    physics.step(STEP,input);state=physics.getState();runTime+=STEP;Rules.tick(run,STEP);
    for(const event of physics.drainEvents())physicsEvent(event);
    ghost.record(runTime,physics.poseCurr);
    if(state.fuel<22&&!lowFuelWarned){lowFuelWarned=true;audio.lowFuel();ui.cue('fuel');}
    if(state.monster.alive&&state.weapon.distance<70&&!monsterWarned){monsterWarned=true;ui.cue('target',{value:'1'});}
    if(state.weapon.canHit&&state.ammo>0&&!lockWarned){lockWarned=true;ui.cue('target',{value:'X / J'});}
    const angle=Math.abs(Math.atan2(Math.sin(state.angle),Math.cos(state.angle)));
    flippedTime=angle>1.7&&Math.abs(state.speed)<2?flippedTime+STEP:0;fallenTime=state.y<-9?fallenTime+STEP:0;
    const needRecover=state.inverted||flippedTime>1.2||state.y<-3||state.stalledTime>2.5;ui.setRecoverVisible(needRecover);
    if(physics.failed){finishRun(false,physics.failed);return;}if(physics.finished){finishRun(true);return;}
    if(fallenTime>.45||state.x<-31)recover();
  }
  function updateHud(ghostFrame){
    const track=physics.track;view.stageIndex=stageIndex;view.stageName=stages[stageIndex].name;view.progress=clamp((state.x-track.startX)/track.length,0,1);
    view.distance=clamp(state.x-track.startX,0,track.length);view.length=track.length;
    view.shootingPhase=shotDirector.state.phase;view.time=runTime;view.score=stageResult?stageResult.score:run.score;view.ghostDelta=ghostFrame?(ghostFrame.pose[0]-state.x)/Math.max(8,Math.abs(state.speed)):null;
    view.fuel=state.fuel;view.cleared=state.cleared;view.totalZombies=state.totalZombies;view.speed=state.speed;view.gear=audio.gear;view.rpm=audio.rpm;view.ammo=state.ammo;view.locked=state.weapon.canHit;view.monsterDistance=state.weapon.distance;view.monsterAlive=state.monster.alive;
    view.monsterProgress=state.monster.alive?clamp((state.monster.x-track.startX)/track.length,0,1):null;view.rivalProgress=state.rival?clamp((state.rival.x-track.startX)/track.length,0,1):null;view.racePosition=state.racePosition;view.combo=run.combo;view.comboLeft=run.comboLeft;view.comboMax=run.comboMax;view.paused=mode==='paused';view.muted=audio.muted;ui.hud.update(view);
  }
  function updateMusic(){musicState.biome=stageIndex;musicState.intensity=mode==='playing'?clamp(Math.abs(state.speed)/30+(run.combo>2?.18:0),0,1):.18;musicState.mood=mode==='playing'?(state.fuel<20?'danger':stages[stageIndex].boss?'boss':'drive'):screen==='results'?'results':'menu';musicState.playing=mode!=='paused'&&!document.hidden;audio.setMusicState(musicState);}
  function animation(now){
    const begin=performance.now(),dt=clamp((now-last)/1000,0,.1);last=now;pollPad(dt);readInput();let steps=0;
    if(mode==='countdown'){
      countdownLeft-=dt;const n=Math.ceil(countdownLeft);
      if(n>0&&n!==countdownNumber){countdownNumber=n;ui.banner(String(n),'countdown',.9);audio.countdown(n);}
      if(countdownLeft<=0){mode='playing';accumulator=0;ui.hud.setVisible(true);ui.banner('GO!','go',.7);audio.go();}
    }
    if(mode==='playing'){
      const oldPhase=shotDirector.state.phase,encounter=shotDirector.update(dt,state,save.settings.reducedMotion);if(encounter.phase==='miss'&&oldPhase!=='miss')ui.cue('miss');
      let simulationDt=dt*encounter.timeScale;if(hitStop>0){hitStop=Math.max(0,hitStop-dt);simulationDt=0;}else if(slowLeft>0){slowLeft=Math.max(0,slowLeft-dt);simulationDt*=.75;}
      accumulator+=simulationDt;while(accumulator>=STEP&&steps<8&&mode==='playing'){tick();accumulator-=STEP;steps++;}if(accumulator<0)accumulator=0;if(steps>=8&&accumulator>=STEP)accumulator%=STEP;
      if(mode==='playing'){input.timeScale=shotDirector.state.timeScale;audio.update(state,dt,input);}
    }else accumulator=0;
    const alpha=mode==='playing'?clamp(accumulator/STEP,0,1):1;physics.interpolatePose(alpha,pose);
    const ghostFrame=mode==='playing'?ghost.at(runTime):null;
    frame.state=state;frame.pose=pose;frame.alpha=alpha;frame.dt=mode==='paused'?0:dt;frame.worldDt=mode==='playing'?dt*shotDirector.state.timeScale:0;frame.encounter=shotDirector.state;frame.time=runTime;frame.mode=mode;frame.ghost=ghostFrame;renderer.render(frame);
    hudClock+=dt;if(hudClock>=1/30){hudClock%=1/30;updateHud(ghostFrame);}
    musicClock+=dt;if(musicClock>=.1){musicClock%=.1;updateMusic();}
    if(ui.tick)ui.tick(dt);
    const cpu=performance.now()-begin;const change=pacer.sample(dt,cpu,mode==='playing');if(change&&save.settings.quality==='auto')applyQuality();
    perf.fps=pacer.fps;perf.refreshHz=pacer.refreshHz;perf.renderScale=renderScale;perf.quality=qualityName;perf.cpuMs=pacer.cpuMs;perf.drawOps=renderer.stats.drawOps;
    if(save.settings.showFps&&hudClock<dt)ui.setFps(perf);else if(!save.settings.showFps)ui.setFps(null);
    pacer.push(now,pose[0],alpha,steps,cpu);requestAnimationFrame(animation);
  }
  const qa=Object.freeze({start(index=0){loadStage(index,{brief:false,bypass:true});countdown(true);return true;},get warm(){return warmReady;}});
  global.irontrail=Object.freeze({get mode(){return mode;},get telemetry(){return {...state,time:runTime,bestAir:state.stats.maxAir,checkpoint:physics.checkpointIndex,recoveries,score:run.score};},get encounter(){return {...shotDirector.state};},get physics(){return physics;},get audio(){return audio;},get campaign(){return Rules.Save.migrate(save);},get stage(){return stageIndex+1;},get perf(){return perf;},qa});
  refreshCampaign();applySettings();resize();renderer.setStage(physics,stageIndex);physics.getPose(pose);view.checkpointProgress=physics.track.checkpoints.slice(1).map(p=>(p.x-physics.track.startX)/physics.track.length);show('title');updateHud(null);requestAnimationFrame(animation);
  const warm=()=>{global.TruckPhysics.warmUp(65);warmReady=true;};if(global.requestIdleCallback)requestIdleCallback(warm,{timeout:350});else setTimeout(warm,30);
})(globalThis);
