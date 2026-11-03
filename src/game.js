/* IRONTRAIL campaign, presentation and game loop. Rebuild with python3 build.py. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('gameCanvas'), ctx = canvas.getContext('2d'), audio = new TruckAudio();
  const stages = TruckPhysics.STAGES;
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const lerp = (a,b,t) => a+(b-a)*t;
  const fract = n => n-Math.floor(n);
  const rand = n => fract(Math.sin(n*127.1+311.7)*43758.5453);
  const fmtTime = seconds => {
    const cs=Math.floor(seconds*100+.00001);
    return `${String(Math.floor(cs/6000)).padStart(2,'0')}:${String(Math.floor(cs/100)%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`;
  };
  const STORAGE_KEY = 'irontrail-campaign-v1';
  let campaign = {unlocked:1,completed:[],best:{},selected:0};
  try {
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(saved&&typeof saved==='object') {
      campaign.unlocked=clamp(Math.floor(Number(saved.unlocked)||1),1,10);
      campaign.completed=Array.isArray(saved.completed)?saved.completed.filter(n=>Number.isInteger(n)&&n>=0&&n<10):[];
      if(saved.best&&typeof saved.best==='object') for(let i=0;i<10;i++) if(Number.isFinite(saved.best[i])&&saved.best[i]>0) campaign.best[i]=saved.best[i];
      campaign.selected=clamp(Math.floor(Number(saved.selected)||0),0,campaign.unlocked-1);
    }
  } catch (_) { /* Private/file mode can deny browser storage. */ }
  let selectedStage = campaign.selected;
  let physics = new TruckPhysics(selectedStage);
  let mode='ready',time=0,bestAir=0,checkpoint=0,recoveries=0;
  let width=0,height=0,scale=40,baseScale=40,groundRatio=.77;
  let camera={x:0,y:0},last=performance.now(),accumulator=0;
  let state=physics.getState(),shake=0,toastUntil=0,particles=[];
  let dustClock=0,flippedTime=0,hudClock=0,offscreenRecoveryClock=0,lowFuelWarned=false;
  let markers=[],resultTimer=null,gunKick=0,muzzleFlash=0,monsterWarned=false,lockAnnounced=false;
  const keys=new Set(),pointers=new Map(),STEP=1/120;
  const saveCampaign=()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(campaign));}catch(_){}};
  function updateBest(){const best=campaign.best[selectedStage];$('bestValue').textContent=best?`${fmtTime(best)} · Stage ${selectedStage+1}`:'Set the first clean time';}
  function renderCampaign(){
    $('stageGrid').replaceChildren();
    stages.forEach((stage,i)=>{
      const locked=i>=campaign.unlocked,complete=campaign.completed.includes(i);
      const button=document.createElement('button');button.type='button';button.dataset.stage=String(i);
      button.className=`stage-card${i===selectedStage?' current':''}${locked?' locked':''}${complete?' complete':''}${stage.boss?' boss':''}`;
      button.disabled=locked;button.setAttribute('aria-label',`Stage ${i+1}: ${stage.name}${locked?', locked':complete?', completed':''}`);
      button.setAttribute('aria-current',i===selectedStage?'step':'false');
      const number=document.createElement('span');number.className='stage-card-number';number.textContent=locked?'⌁':complete?'✓':String(i+1).padStart(2,'0');
      const name=document.createElement('span');name.className='stage-card-name';name.textContent=stage.name;
      const meta=document.createElement('span');meta.className='stage-card-meta';meta.textContent=locked?'CLEAR THE PREVIOUS STAGE':stage.boss?'BOSS RACE · METAL ON METAL':`${stage.length} M · ${complete?'CLEARED':'SURVIVAL RUN'}`;
      button.append(number,name,meta);button.addEventListener('click',()=>loadStage(i,true));$('stageGrid').appendChild(button);
    });
    $('campaignProgress').textContent=`${campaign.completed.length} / 10 CLEARED · ${campaign.unlocked} UNLOCKED`;
  }
  function stageBrief(){
    const stage=stages[selectedStage];
    setOverlay(stage.boss?'FINAL BOSS · IRON MAW':`STAGE ${String(selectedStage+1).padStart(2,'0')} / 10 · ${stage.name.toUpperCase()}`,stage.boss?'METAL.<br>ON METAL.':'FUEL UP.<br>ROLL OUT.',stage.boss?'Beat Iron Maw and stop the track monster. You have one cannon charge: fire on a locked target before you crash.':`${stage.length} metres. One random monster. Save your single cannon charge and fire when the target locks.`,'Start your engine','↑ / W DRIVE · X / J FIRE · ONE CHARGE PER ROUND');
  }
  function syncStageUI(){
    const stage=stages[selectedStage];$('stageNumber').textContent=String(selectedStage+1).padStart(2,'0');$('stageName').textContent=stage.name.toUpperCase();
    $('courseName').textContent=stage.boss?'Iron Maw · final showdown':stage.name;
    $('courseSubtitle').textContent=`STAGE ${selectedStage+1} / 10 · ${stage.length} M · ${stage.boss?'HEAD-TO-HEAD':'ZOMBIE TERRITORY'}`;
    $('lengthValue').textContent=physics.track.length;
    $('bossHud').hidden=!stage.boss;
    $('progressChecks').replaceChildren();markers=physics.track.checkpoints.slice(1).map((cp,i)=>{
      const el=document.createElement('span');el.className='progress-check';el.style.left=`${(cp.x-physics.track.startX)/physics.track.length*100}%`;el.title=`Checkpoint ${i+1}`;$('progressChecks').appendChild(el);return el;
    });
    renderCampaign();updateBest();
  }
  function resize(){
    const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height;const dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    baseScale=clamp(width/28,20,42);scale=baseScale;
    if(mode==='ready')camera={x:state.x+width/scale*.21,y:0};
  }
  new ResizeObserver(resize).observe($('scene'));window.addEventListener('resize',resize);
  function input(){
    const active=name=>[...pointers.values()].includes(name);
    return {throttle:Number(keys.has('ArrowUp')||keys.has('KeyW')||active('gas'))-Number(keys.has('ArrowDown')||keys.has('KeyS')||active('reverse')),
      brake:keys.has('Space')||active('brake'),lean:Number(keys.has('ArrowRight')||keys.has('KeyD')||active('right'))-Number(keys.has('ArrowLeft')||keys.has('KeyA')||active('left'))};
  }
  function clearInput(){keys.clear();pointers.clear();document.querySelectorAll('.pedal').forEach(b=>b.classList.remove('pressed'));}
  function showToast(message,duration=2){$('toast').textContent=message;$('toast').classList.add('show');toastUntil=performance.now()+duration*1000;}
  function setOverlay(kicker,title,copy,button,hint){$('overlayKicker').textContent=kicker;$('overlayTitle').innerHTML=title;$('overlayCopy').textContent=copy;$('playLabel').textContent=button;$('overlayHint').textContent=hint;$('overlay').hidden=false;}
  function syncPauseButton(){
    $('pauseButton').disabled=!['playing','paused'].includes(mode);$('pauseButton').setAttribute('aria-label',mode==='paused'?'Resume game':'Pause game');
    $('pauseButton').innerHTML=mode==='paused'?'<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg>':'<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>';
  }
  function unlockAudio(){audio.unlock().then(ok=>{if(!ok&&!audio.muted&&mode==='playing')showToast('Audio unavailable · the trail is still open',3);});}
  function begin(){
    unlockAudio();if(resultTimer){clearTimeout(resultTimer);resultTimer=null;}
    mode='playing';audio.setPaused(false);$('overlay').hidden=true;$('pauseBackdrop').classList.remove('visible');accumulator=0;last=performance.now();syncPauseButton();
  }
  function playAction(){
    if(mode==='cleared'){loadStage(selectedStage+1,false);return;}
    if(mode==='victory'){loadStage(0,false);return;}
    if(mode==='failed'){restart(false);return;}
    if(mode==='ready'||mode==='paused')begin();
  }
  function loadStage(index,ready=true){
    if(index<0||index>=stages.length||index>=campaign.unlocked)return;
    clearInput();if(resultTimer){clearTimeout(resultTimer);resultTimer=null;}
    // New world discards old zombie bodies and keeps campaign resources separate.
    selectedStage=index;physics=new TruckPhysics(index);campaign.selected=index;saveCampaign();
    resetRunState();mode='ready';audio.setPaused(true);$('pauseBackdrop').classList.remove('visible');syncStageUI();stageBrief();syncPauseButton();updateHUD();
    if(!ready)begin();else{$('playButton').focus({preventScroll:true});document.querySelector('.game-shell').scrollIntoView({behavior:'smooth',block:'start'});}
  }
  function resetRunState(){
    gunKick=0;muzzleFlash=0;monsterWarned=false;lockAnnounced=false;
    state=physics.getState();time=0;bestAir=0;checkpoint=0;recoveries=0;particles=[];shake=0;accumulator=0;flippedTime=0;offscreenRecoveryClock=0;lowFuelWarned=false;
    camera={x:state.x+width/scale*.21,y:0};audio.rpm=820;$('recoverButton').classList.remove('visible');$('toast').classList.remove('show');$('toast').textContent='';toastUntil=0;clearInput();
  }
  function restart(ready=mode==='ready'){physics.restart();resetRunState();if(ready){mode='ready';audio.setPaused(true);stageBrief();$('pauseBackdrop').classList.remove('visible');syncPauseButton();updateHUD();}else begin();}
  function pause(){
    if(mode==='playing'){mode='paused';audio.setPaused(true);clearInput();setOverlay(`STAGE ${selectedStage+1} · FUEL ${Math.ceil(state.fuel)}%`,'PARKED.<br>FOR NOW.','Fuel and the rival freeze while you take a breather.','Back to the trail','P / ESC TO RESUME');$('pauseBackdrop').classList.add('visible');syncPauseButton();}
    else if(mode==='paused')begin();
  }
  async function chooseStage(){if(mode==='playing')pause();if(document.fullscreenElement){try{await document.exitFullscreen();}catch(_){}}$('campaignPanel').scrollIntoView({behavior:'smooth',block:'center'});}
  function recover(){
    if(mode!=='playing')return;
    physics.reset(physics.checkpointIndex);state=physics.getState();recoveries++;camera={x:state.x+width/scale*.21,y:Math.max(0,state.y-2.5)};
    particles=[];flippedTime=0;offscreenRecoveryClock=0;accumulator=0;$('recoverButton').classList.remove('visible');
    if(physics.failed)fail(physics.failed);else showToast('CHECKPOINT RECOVERY · −12% FUEL',2);
  }
  function resultAudio(won){
    audio.result(won);if(resultTimer)clearTimeout(resultTimer);
    // Let the short result cue ring out, then gate the idling engine.
    resultTimer=setTimeout(()=>{if(!['playing','ready'].includes(mode))audio.setPaused(true);resultTimer=null;},210);
  }
  function finish(){
    if(mode!=='playing')return;
    bestAir=Math.max(bestAir,state.airtime);
    const final=selectedStage===9;mode=final?'victory':'cleared';clearInput();resultAudio(true);
    const best=campaign.best[selectedStage],newBest=!best||time<best;
    if(newBest)campaign.best[selectedStage]=time;
    if(!campaign.completed.includes(selectedStage))campaign.completed.push(selectedStage);
    campaign.unlocked=Math.max(campaign.unlocked,Math.min(10,selectedStage+2));saveCampaign();renderCampaign();updateBest();
    setOverlay(final?'ALL TEN STAGES CLEARED':`STAGE ${selectedStage+1} CLEARED${newBest?' · NEW BEST':''}`,final?'KING OF THE<br>WASTELAND.':'TRAIL.<br>SURVIVED.',`${fmtTime(time)} · ${state.cleared} zombies cleared · ${Math.ceil(state.fuel)}% fuel left.${final?' Iron Maw is behind you.':` Stage ${selectedStage+2} is unlocked.`}`,final?'Ride the campaign again':`Continue to stage ${String(selectedStage+2).padStart(2,'0')}`,final?'TEN STAGES. ONE SURVIVOR.':`${stages[Math.min(9,selectedStage+1)].name.toUpperCase()} IS WAITING`);
    $('pauseBackdrop').classList.add('visible');$('recoverButton').classList.remove('visible');syncPauseButton();updateHUD();
  }
  function fireCannon(){
    if(mode!=='playing')return;
    if(physics.fire()){state=physics.getState();updateHUD();}
    else if(state.ammo===0)showToast('CANNON EMPTY · ONE SHOT PER ROUND',1);
  }
  function fail(reason){
    if(mode!=='playing')return;mode='failed';clearInput();resultAudio(false);
    const fuel=reason==='fuel',monster=reason==='monster';
    if(monster)setOverlay('THE MONSTER STOPPED YOUR RUN','MONSTER.<br>TRUCK DOWN.','You hit the track monster alive. Retry for one fresh charge, then fire with X / J or the FIRE button when the target locks.','Retry this stage','ONE CHARGE · ONE MONSTER · MAKE IT COUNT');
    else setOverlay(fuel?'THE TANK RAN DRY':'IRON MAW TOOK THE FLAG',fuel?'EMPTY TANK.<br>TRY AGAIN.':'OUTRUN.<br>OUTMUSCLE.',fuel?'Keep moving and collect the amber fuel cans. A fresh retry restores your tank and the pickups.':'Iron Maw reached the finish first. Use your launch speed and physical bumps to take the lead.','Retry this stage',fuel?'FUEL DRAINS WHILE DRIVING · CANS REFILL +32%':'YOUR RIVAL HAS REAL SUSPENSION. SO DO YOU.');
    $('pauseBackdrop').classList.add('visible');$('recoverButton').classList.remove('visible');syncPauseButton();updateHUD();
  }
  function toggleSound(){
    audio.setMuted(!audio.muted);if(!audio.muted&&mode==='playing')audio.unlock();$('soundButton').setAttribute('aria-label',audio.muted?'Enable sound':'Mute sound');$('soundButton').setAttribute('aria-pressed',String(audio.muted));
    $('soundButton').innerHTML=`<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z${audio.muted?'M17 9l5 6M22 9l-5 6':'M17 8q4 4 0 8M20 5q7 7 0 14'}"/></svg><span class="sound-label">SOUND ${audio.muted?'OFF':'ON'}</span>`;
  }
  async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.querySelector('.game-shell').requestFullscreen)await document.querySelector('.game-shell').requestFullscreen();else showToast('Fullscreen is unavailable in this browser');}catch(_){showToast('Fullscreen is unavailable in this preview');}}
  document.addEventListener('fullscreenchange',()=>{$('fullscreenButton').setAttribute('aria-label',document.fullscreenElement?'Exit fullscreen':'Enter fullscreen');resize();});
  $('playButton').addEventListener('click',playAction);$('pauseButton').addEventListener('click',pause);$('restartButton').addEventListener('click',()=>restart());$('soundButton').addEventListener('click',toggleSound);$('fullscreenButton').addEventListener('click',fullscreen);$('recoverButton').addEventListener('click',recover);$('stagesButton').addEventListener('click',chooseStage);$('mapButton').addEventListener('click',chooseStage);$('fireButton').addEventListener('click',fireCannon);
  const controlCodes=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Space','KeyR','KeyC','KeyP','KeyM','KeyF','KeyX','KeyJ','Escape','Enter']);
  window.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey||!controlCodes.has(e.code))return;
    if(e.target instanceof HTMLButtonElement&&(e.code==='Enter'||(e.code==='Space'&&(mode!=='playing'||e.target.id==='fireButton'))))return;
    e.preventDefault();if(!e.repeat){if(e.code==='KeyM')return toggleSound();if(e.code==='KeyF')return fullscreen();if(e.code==='KeyX'||e.code==='KeyJ')return fireCannon();if(e.code==='KeyR')return restart();if(e.code==='KeyC')return recover();if(e.code==='KeyP'||e.code==='Escape')return pause();if(e.code==='Enter'&&mode!=='playing')return playAction();if((e.code==='ArrowUp'||e.code==='KeyW')&&mode==='ready')begin();}
    if(mode==='playing')keys.add(e.code);
  });
  window.addEventListener('keyup',e=>keys.delete(e.code));
  document.querySelectorAll('.pedal[data-input]').forEach(button=>{
    button.addEventListener('pointerdown',e=>{e.preventDefault();if(mode!=='playing')return;button.setPointerCapture(e.pointerId);pointers.set(e.pointerId,button.dataset.input);button.classList.add('pressed');});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,e=>{pointers.delete(e.pointerId);button.classList.remove('pressed');});button.addEventListener('contextmenu',e=>e.preventDefault());
  });
  window.addEventListener('blur',()=>{clearInput();if(mode==='playing')pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();if(mode==='playing')pause();}});
  function addDust(x,y,count,power=1,color='#d0ce96'){
    for(let i=0;i<count;i++)particles.push({x,y,vx:-2-Math.random()*3*power,vy:.3+Math.random()*2*power,r:.04+Math.random()*.13,life:.45+Math.random()*.55,color});
    if(particles.length>220)particles.splice(0,particles.length-220);
  }
  function tick(dt){
    const controls=input();physics.step(dt,controls);state=physics.getState();time+=dt;
    for(const event of physics.drainEvents()){
      if(event.type==='takeoff')audio.takeoff(event.strength);
      if(event.type==='land'){bestAir=Math.max(bestAir,event.airtime||0);audio.landing(event.strength);shake=Math.max(shake,event.strength*5);for(const wheel of state.wheels)addDust(wheel.x,wheel.y-.63,10,event.strength+.5);}
      if(event.type==='fuel'){audio.pickup();lowFuelWarned=false;showToast(`FUEL CAN · +${Math.round(event.amount??32)}%`,1.1);addDust(event.x,event.y,9,.7,'#e6c57c');}
      if(event.type==='zombie'){audio.zombieHit(event.strength);addDust(event.x,event.y,7,.65,'#99b879');}
      if(event.type==='shot'){audio.gunshot();gunKick=1;muzzleFlash=.085;showToast('CANNON FIRED · CHARGE SPENT',.8);}
      if(event.type==='monsterHit'){audio.monsterHit();shake=Math.max(shake,4);showToast('MONSTER CLEARED · KEEP ROLLING',2);addDust(event.x,event.y,30,2,'#a3ba8a');}
      if(event.type==='monsterCrash'){audio.monsterCrash();shake=11;addDust(state.x,state.y,25,1.7,'#d2b77f');}
      if(event.type==='collision'){audio.collision(event.strength);shake=Math.max(shake,event.strength*7);addDust(event.x||state.x,event.y||state.y,10,event.strength,'#d0b77d');}
    }
    if(state.monster.alive&&state.weapon.distance>0&&state.weapon.distance<70&&!monsterWarned){monsterWarned=true;showToast('MONSTER AHEAD · SAVE YOUR ONE SHOT',1.8);}
    if(state.weapon.canHit&&state.ammo>0&&!lockAnnounced){lockAnnounced=true;showToast('TARGET LOCKED · X / J OR TAP FIRE',1.5);}
    if(physics.checkpointIndex>checkpoint){checkpoint=physics.checkpointIndex;showToast(`CHECKPOINT ${checkpoint} · RECOVERY SAVED`,1.7);}
    if(state.fuel<23&&!lowFuelWarned){showToast('LOW FUEL · FIND AN AMBER CAN',2);lowFuelWarned=true;}
    dustClock+=dt;if(dustClock>.035&&state.grounded&&Math.abs(state.speed)>1){dustClock=0;for(const wheel of state.wheels)addDust(wheel.x,wheel.y-.65,1,Math.min(1.5,Math.abs(state.speed)/12));}
    const angle=Math.abs(Math.atan2(Math.sin(state.angle),Math.cos(state.angle)));
    if(angle>1.7&&Math.abs(state.speed)<2)flippedTime+=dt;else flippedTime=0;
    $('recoverButton').classList.toggle('visible',flippedTime>1.2||state.y<-3);
    if(state.y<-9||state.x<-31)offscreenRecoveryClock+=dt;else offscreenRecoveryClock=0;
    if(physics.failed){fail(physics.failed);return;}
    if(physics.finished){finish();return;}
    if(offscreenRecoveryClock>.45)recover();
  }
  function updateHUD(){
    $('bossHud').hidden=!state.rival||mode!=='playing';
    $('weaponHud').hidden=mode!=='playing';
    $('ammoValue').textContent=`${state.ammo} / 1`;$('fireButton').disabled=mode!=='playing'||state.ammo===0;
    $('fireButton').setAttribute('aria-label',state.ammo?'Fire cannon, one charge available':'Cannon empty');
    $('weaponHud').classList.toggle('locked',state.weapon.canHit&&state.ammo>0);$('weaponHud').classList.toggle('spent',state.ammo===0);$('weaponHud').classList.toggle('warning',state.monster.alive&&state.weapon.distance<70&&!state.weapon.canHit);
    $('weaponStatus').textContent=!state.monster.alive?'MONSTER CLEARED':state.projectile?'SHOT IN FLIGHT':state.ammo===0?'CHARGE SPENT · DANGER':state.weapon.canHit?'TARGET LOCKED · FIRE':'SAVE YOUR ONE SHOT';
    $('monsterDistance').textContent=!state.monster.alive?'PATH OPEN':`${Math.max(0,Math.ceil(state.weapon.distance))} M TO MONSTER`;
    $('timeValue').textContent=fmtTime(time);$('airValue').innerHTML=`${bestAir.toFixed(2)} <small>s</small>`;$('speedValue').textContent=String(Math.round(Math.abs(state.speed)*3.6)).padStart(2,'0');$('gearValue').textContent=mode==='ready'?'N':audio.gear;
    const distance=clamp(state.x-physics.track.startX,0,physics.track.length),won=mode==='cleared'||mode==='victory';
    $('distanceValue').textContent=won?physics.track.length:Math.floor(distance);$('progressFill').style.width=`${won?100:distance/physics.track.length*100}%`;markers.forEach((m,i)=>m.classList.toggle('passed',checkpoint>i));
    $('checkpointLabel').textContent=won?'STAGE CLEAR':checkpoint?`CHECKPOINT ${checkpoint} / ${markers.length}`:'FOLLOW THE FUEL CANS';
    $('fuelValue').textContent=`${Math.ceil(state.fuel)}%`;$('fuelFill').style.width=`${state.fuel}%`;$('fuelHud').classList.toggle('low',state.fuel<23);$('fuelHud').classList.toggle('critical',state.fuel<12);$('fuelMeter').setAttribute('aria-valuenow',String(Math.ceil(state.fuel)));$('zombieValue').textContent=`${state.cleared} / ${state.totalZombies}`;
    if(state.rival){const gap=state.x-state.rival.x;$('bossPosition').textContent=gap>=0?'1 / 2':'2 / 2';$('bossGap').textContent=`${Math.abs(gap).toFixed(0)} M ${gap>=0?'AHEAD':'BEHIND'}`;$('bossProgress').style.width=`${clamp((state.rival.x-physics.track.startX)/physics.track.length*100,0,100)}%`;$('bossProgress').title=`Iron Maw: ${Math.floor(clamp(state.rival.x-physics.track.startX,0,physics.track.length))} / ${physics.track.length} m`;}
    $('driveStatus').textContent=mode==='ready'?'READY TO SURVIVE':mode==='paused'?'ENGINE PAUSED':won?'STAGE CONQUERED':mode==='failed'?'RETRY. RECLAIM THE TRAIL.':state.fuel<23?'LOW FUEL · KEEP MOVING':!state.grounded&&state.airtime>.15?'CATCHING SOME AIR':Math.abs(state.speed)<1?'OPEN THROTTLE. GO.':input().brake?'EASY ON THE BRAKES':'CLEAR A PATH. STAY ALIVE.';
    $('rpmMeter').querySelectorAll('i').forEach((bar,i)=>bar.classList.toggle('active',mode!=='ready'&&i<audio.rpm/5200*10));
  }
  function sx(x) { return (x - camera.x) * scale + width / 2; }
  function sy(y) { return height * groundRatio - (y - camera.y) * scale; }
  function path(points, fill, stroke, lineWidth = 1) {
    ctx.beginPath(); points.forEach((p,i) => i ? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1])); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle=stroke; ctx.lineWidth=lineWidth;ctx.stroke(); }
  }
  function worldPath(points, fill, stroke, lineWidth = 1) { path(points.map(p=>[sx(p.x),sy(p.y)]),fill,stroke,lineWidth); }
  function circle(x,y,r,color) { ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill(); }
  function line(a,b,color,w=1) { ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.strokeStyle=color;ctx.lineWidth=w;ctx.stroke(); }

  function drawBackground() {
    const sky=ctx.createLinearGradient(0,0,0,height);sky.addColorStop(0,'#c4d0b2');sky.addColorStop(.58,'#e5e5b6');sky.addColorStop(1,'#b8c295');ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
    const sunX=width*.76-camera.x*.6, sunY=height*.25+camera.y*scale*.08;
    const glow=ctx.createRadialGradient(sunX,sunY,5,sunX,sunY,170);glow.addColorStop(0,'#f7efbe85');glow.addColorStop(1,'#f7efbe00');ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);circle(sunX,sunY,34,'#f4ecba');
    // Long clouds and three ridgelines move at different parallax rates.
    ctx.fillStyle='#edf0d025';
    for(let i=0;i<6;i++){const x=(i*290-camera.x*2)%(width+400)-120;ctx.beginPath();ctx.ellipse(x,height*.23+i%3*31,110+i%3*25,3,0,0,Math.PI*2);ctx.fill();}
    ridge(.07,height*.58,95,'#a7b79a',241);
    ridge(.16,height*.65,80,'#8eaa8e',188);
    ridge(.3,height*.76,75,'#6d917a',143);
    const low=height*.81+camera.y*scale*.18;
    path([[0,low],[width*.2,low-13],[width*.43,low+12],[width*.72,low-23],[width,low+3],[width,height],[0,height]],'#9daa79');
    // Distant cacti are part of the landscape, not physics obstacles.
    for(let i=-2;i<width/130+2;i++){const n=Math.floor(camera.x*.12/3.5)+i;const x=n*130-camera.x*scale*.12;const y=height*.80+camera.y*scale*.15;cactus(x,y,13+rand(n+70)*19,'#6a8668',.8);}
  }
  function ridge(parallax, horizon, amplitude, color, spacing) {
    const offset=camera.x*scale*parallax, start=Math.floor(offset/spacing)-2, points=[[0,height]];
    for(let n=start;n<(offset+width)/spacing+2;n++) {
      const x=n*spacing-offset, peak=horizon-amplitude*(.4+rand(n+spacing)*.7)+camera.y*scale*parallax;
      points.push([x-spacing*.45,horizon+camera.y*scale*parallax],[x-spacing*.1,peak+12],[x+spacing*.11,peak],[x+spacing*.28,peak+amplitude*.35],[x+spacing*.63,horizon+10]);
    }
    points.push([width,height]);path(points,color);
  }
  function cactus(x,y,size,color,alpha=1) {
    ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=size*.19;
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y-size);ctx.moveTo(x,y-size*.45);ctx.lineTo(x-size*.34,y-size*.45);ctx.lineTo(x-size*.34,y-size*.77);ctx.moveTo(x,y-size*.64);ctx.lineTo(x+size*.3,y-size*.64);ctx.lineTo(x+size*.3,y-size*.91);ctx.stroke();ctx.restore();
  }
  function heightAt(x) { return physics._heightAt(x); }
  function drawDecor() {
    const left=camera.x-width/scale/2-5,right=camera.x+width/scale/2+5;
    for(let n=Math.floor(left/6);n<right/6;n++) {
      const x=n*6+rand(n+91)*3, y=heightAt(x), screenX=sx(x), screenY=sy(y);
      if(rand(n+120)>.43) cactus(screenX,screenY+1,(.65+rand(n+4)*.8)*scale,'#3e6852');
      else {
        const s=scale*(.15+rand(n+87)*.2);path([[screenX-s,screenY],[screenX-s*.6,screenY-s*.65],[screenX+s*.2,screenY-s],[screenX+s,screenY]],'#6e7c51');
      }
      if(n%3===0){const xx=screenX+scale*.9;line([xx,screenY],[xx+4,screenY-11],'#6c875b',1);line([xx,screenY],[xx-6,screenY-8],'#6c875b',1);}
    }
    // Each launch face gets a warning; distance signs follow this stage's course.
    const signs=[];
    for(let distance=50;distance<physics.track.length;distance+=100)signs.push({x:physics.track.startX+distance,label:`${distance} M`});
    for(const segment of physics.track.segments.slice(0,-1))signs.push({x:segment[segment.length-1].x-5,label:'JUMP'});
    for(const sign of signs){
      const x=sign.x;if(x<left||x>right)continue;const y=heightAt(x),px=sx(x),py=sy(y),r=scale*.36;
      line([px,py],[px,py-scale*1.55],'#5e6545',3);
      if(sign.label==='JUMP'){path([[px,py-scale*2.16],[px+r*1.1,py-scale*1.55],[px-r*1.1,py-scale*1.55]],'#e3cf76','#6a7145',1.5);line([px-r*.5,py-scale*1.7],[px+r*.4,py-scale*1.94],'#4f6244',2);}
      else{ctx.fillStyle='#344f3b';ctx.fillRect(px-scale*.52,py-scale*1.95,scale*1.04,scale*.5);ctx.font=`bold ${Math.max(8,scale*.17)}px monospace`;ctx.textAlign='center';ctx.fillStyle='#e5e8bb';ctx.fillText(sign.label,px,py-scale*1.63);}
    }
    for(let i=0;i<physics.track.checkpoints.length;i++) drawFlag(physics.track.checkpoints[i],i);
    drawFinish();
  }
  function drawFlag(cp,index) {
    const px=sx(cp.x),py=sy(cp.y);if(px < -100 || px>width+100)return;
    const passed=index<=checkpoint;line([px,py],[px,py-scale*3.15],'#4f6349',2.5);
    path([[px,py-scale*3.1],[px+scale*.9,py-scale*2.94],[px+scale*.7,py-scale*2.48],[px,py-scale*2.6]],passed?'#d6e87e':'#c5cfaa','#5f764f',1);
    ctx.font=`bold ${scale*.22}px monospace`;ctx.textAlign='center';ctx.fillStyle='#3a593d';ctx.fillText(index===0?'GO':String(index).padStart(2,'0'),px+scale*.36,py-scale*2.77);
  }
  function drawFinish() {
    const x=sx(physics.track.finishX),y=sy(heightAt(physics.track.finishX)),s=scale;
    if(x < -160 || x>width+160)return;
    for(const offset of [-1,1]) {line([x+offset*s*1.4,y],[x+offset*s*1.4,y-s*5],'#3d5946',s*.1);}
    ctx.fillStyle='#233d2d';ctx.fillRect(x-s*1.47,y-s*5.05,s*2.94,s*.8);
    const cell=s*.19;
    for(let i=0;i<15;i++)for(let j=0;j<2;j++){ctx.fillStyle=(i+j)%2?'#d8e5bb':'#456246';ctx.fillRect(x-s*1.42+i*cell,y-s*5+j*cell,cell,cell);}
    ctx.fillStyle='#d8e5bb';ctx.font=`bold ${s*.24}px monospace`;ctx.textAlign='center';ctx.fillText('FINISH',x,y-s*4.39);
  }
  function drawTerrain() {
    for(const segment of physics.track.segments) {
      if(segment[segment.length-1].x < camera.x-width/scale/2-3 || segment[0].x > camera.x+width/scale/2+3)continue;
      const visible=segment.filter(p=>p.x>=camera.x-width/scale/2-3&&p.x<=camera.x+width/scale/2+3);
      if(visible.length<2)continue;
      const bottom=Math.min(-20,camera.y-height/scale);
      worldPath([...visible,{x:visible[visible.length-1].x,y:bottom},{x:visible[0].x,y:bottom}],'#7f8855');
      // Strata under the compacted top surface follow the collision mesh.
      ctx.save();ctx.beginPath();visible.forEach((p,i)=>i?ctx.lineTo(sx(p.x),sy(p.y)):ctx.moveTo(sx(p.x),sy(p.y)));ctx.lineTo(sx(visible[visible.length-1].x),height+50);ctx.lineTo(sx(visible[0].x),height+50);ctx.closePath();ctx.clip();
      for(let band=0;band<4;band++){
        ctx.beginPath();visible.forEach((p,i)=>{const yy=sy(p.y-(.6+band*.73+Math.sin(p.x*.5+band)*.13));i?ctx.lineTo(sx(p.x),yy):ctx.moveTo(sx(p.x),yy);});ctx.strokeStyle=['#a3a86c','#727e4f','#93935e','#6e7a4f'][band];ctx.lineWidth=scale*(band===0?.37:.25);ctx.stroke();
      }
      const start=Math.floor(visible[0].x*4),end=visible[visible.length-1].x*4;
      for(let n=start;n<end;n++){const wx=n/4+rand(n)*.22, wy=heightAt(wx)-.25-rand(n+7)*5;const px=sx(wx),py=sy(wy);ctx.fillStyle=rand(n+28)>.6?'#bdba7b55':'#3b5a3c35';ctx.fillRect(px,py,1+rand(n+3)*3,1.5+rand(n+6)*2);}
      ctx.restore();
      ctx.beginPath();visible.forEach((p,i)=>i?ctx.lineTo(sx(p.x),sy(p.y)):ctx.moveTo(sx(p.x),sy(p.y)));ctx.strokeStyle='#d1ce8b';ctx.lineWidth=5;ctx.lineJoin='round';ctx.stroke();ctx.strokeStyle='#566b3c';ctx.lineWidth=1.2;ctx.stroke();
      // Scattered grass tufts at the actual edge of the dirt.
      for(let n=Math.ceil(visible[0].x*1.7);n<visible[visible.length-1].x*1.7;n++){if(rand(n+123)<.55)continue;const wx=n/1.7;const x=sx(wx),y=sy(heightAt(wx));const h=2+rand(n+444)*4;line([x-2,y],[x-4,y-h],'#5c7544',1.3);line([x,y],[x+1,y-h-2],'#6b8047',1.3);}
    }
  }
  function drawTruck(truck=state,rival=false) {
    const s=scale,x=sx(truck.x),y=sy(truck.y);
    if(x < -180 || x > width+180)return;
    const paint=rival?'#bb644a':'#ccdb78',door=rival?'#a75341':'#bfce67',hood=rival?'#d88a62':'#e2e69d';
    // Elliptical ground shadow is separate from the rigid body's rotation.
    if(truck.y-heightAt(truck.x)<5){ctx.save();ctx.globalAlpha=clamp(.22-(truck.y-heightAt(truck.x)-1)*.035,.04,.23);ctx.fillStyle='#243d2c';ctx.beginPath();ctx.ellipse(x,sy(heightAt(truck.x))+.1*s,s*2.4,s*.17,0,0,Math.PI*2);ctx.fill();ctx.restore();}
    const local=(lx,ly)=>({x:truck.x+Math.cos(truck.angle)*lx-Math.sin(truck.angle)*ly,y:truck.y+Math.sin(truck.angle)*lx+Math.cos(truck.angle)*ly});
    // Visible coilovers join the actual wheel bodies to the moving chassis.
    for(let i=0;i<2;i++){
      const mount=local(i===0?-1.25:1.25,.16),w=truck.wheels[i];const a=[sx(mount.x),sy(mount.y)],b=[sx(w.x),sy(w.y)];
      line(a,b,'#1e3028',s*.14);line(a,b,'#a4ada0',s*.055);
      const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
      ctx.beginPath();ctx.moveTo(...a);for(let j=1;j<9;j++){const t=j/9,offset=j%2?3:-3;ctx.lineTo(a[0]+dx*t+nx*offset,a[1]+dy*t+ny*offset);}ctx.lineTo(...b);ctx.strokeStyle='#d0d881';ctx.lineWidth=1.5;ctx.stroke();
    }
    ctx.save();ctx.translate(x,y);ctx.rotate(-truck.angle);ctx.scale(s,-s);
    const p=(points,fill,stroke,w=.025)=>path(points,fill,stroke,w);
    // Chassis, roll cage and a tough two-tone pickup body.
    p([[-2.1,-.36],[2.1,-.36],[2.1,-.19],[-2.1,-.19]],'#26392e');
    p([[-2.12,-.12],[-2.12,.43],[-1.1,.43],[-.82,1.21],[.57,1.21],[1.14,.47],[1.87,.37],[2.13,.15],[2.13,-.1],[1.84,-.24],[-1.9,-.24]],paint,'#344e38');
    p([[-2.05,.26],[-1.1,.26],[-1.12,.46],[-2.05,.46]],'#71844c');
    p([[-1.03,.47],[-.77,1.13],[.51,1.13],[1.04,.47]],'#2e493d','#45613c');
    p([[-.77,.58],[-.67,1.03],[-.08,1.03],[-.08,.58]],'#9dbda2');
    p([[.03,.58],[.03,1.03],[.43,1.03],[.82,.58]],'#8cab92');
    p([[-.62,.64],[-.53,.97],[-.19,.97]],'#c1d2a8');
    p([[-.87,1.18],[.59,1.18],[.62,1.28],[-.83,1.28]],'#4f653b');
    p([[-1.07,.45],[1.03,.45],[1.05,-.12],[-1.09,-.12]],door);
    line([-.03,.48],[-.03,-.13],'#778c48',.018);line([-.9,.47],[-.9,-.13],'#7f924c',.018);
    p([[1.04,.45],[1.86,.36],[2.06,.18],[1.14,.23]],hood);
    p([[-2.15,.03],[-2.15,-.21],[-1.9,-.21],[-1.9,.02]],'#374b37');
    p([[1.93,.06],[2.21,.06],[2.21,-.17],[1.98,-.17]],'#354d3d');
    p([[1.97,.23],[2.12,.15],[2.12,.04],[1.96,.04]],'#f3edb4');
    p([[-2.13,.23],[-2.02,.23],[-2.02,.05],[-2.13,.05]],'#b5744a');
    p([[-1.94,-.15],[-1.88,.06],[-1.72,.18],[-1.42,.18],[-1.2,.04],[-1.13,-.15]],'#344d36');
    p([[1.08,-.15],[1.16,.05],[1.34,.18],[1.7,.18],[1.92,.04],[1.99,-.15]],'#344d36');
    ctx.save();ctx.scale(1,-1);ctx.fillStyle='#3b5939';ctx.font='900 .32px Arial';ctx.textAlign='center';ctx.fillText(rival?'MAW':'IRON',.46,-.05);ctx.font='bold .12px monospace';ctx.fillText(rival?'WARLORD V8':'TRAILBREAKER',-.45,.02);ctx.restore();
    p([[-.97,.51],[-1.17,.6],[-1.17,.71],[-.94,.7]],'#344a37');
    // Exhaust stack and bumper hardware.
    line([-1.29,.4],[-1.29,1.05],'#59664d',.075);line([-1.29,1.05],[-1.42,1.12],'#59664d',.075);
    if(rival){
      for(let i=0;i<4;i++)p([[-.8+i*.37,1.27],[-.63+i*.37,1.58],[-.48+i*.37,1.27]],'#7d493d');
      for(let i=0;i<3;i++)p([[2.06,-.12+i*.1],[2.37,-.04+i*.1],[2.06,.02+i*.1]],'#6a4537');
    }
    ctx.restore();
    for(const wheel of truck.wheels) drawWheel(wheel,rival);
    if(rival){ctx.fillStyle='#a64f38';ctx.font=`bold ${Math.max(8,scale*.22)}px monospace`;ctx.textAlign='center';ctx.fillText('IRON MAW',x,y-scale*1.82);}

  }
  function drawWheel(wheel,rival=false) {
    const x=sx(wheel.x),y=sy(wheel.y),r=scale*.72;ctx.save();ctx.translate(x,y);ctx.rotate(-wheel.angle);
    circle(0,0,r*1.04,'#263a2d');circle(0,0,r*.91,'#314435');circle(0,0,r*.72,'#1f352c');
    for(let i=0;i<18;i++){ctx.save();ctx.rotate(i*Math.PI/9);ctx.fillStyle=i%2?'#4c5b3e':'#526044';ctx.fillRect(-r*.115,-r*.97,r*.23,r*.23);ctx.restore();}
    circle(0,0,r*.55,rival?'#985d46':'#7e8d68');circle(0,0,r*.43,rival?'#d19a75':'#b0ba8d');
    for(let i=0;i<6;i++){const a=i*Math.PI/3;circle(Math.cos(a)*r*.31,Math.sin(a)*r*.31,r*.075,'#344c36');}
    circle(0,0,r*.15,'#445e3f');circle(0,0,r*.065,'#cdd4a2');ctx.restore();
  }
  function nowForScene(){return time;}
  function drawFuelCans(clock){
    for(const can of physics.fuelCans){
      if(can.collected)continue;const x=sx(can.x),y=sy(can.y)-Math.sin(clock*2.6+can.id)*scale*.09;
      if(x < -45 || x>width+45)continue;
      const glow=ctx.createRadialGradient(x,y,2,x,y,scale*1.1);glow.addColorStop(0,'#f9d97750');glow.addColorStop(1,'#f9d97700');ctx.fillStyle=glow;ctx.fillRect(x-scale*1.1,y-scale*1.1,scale*2.2,scale*2.2);
      ctx.save();ctx.translate(x,y);ctx.rotate(-.08);ctx.scale(scale,scale);
      path([[-.32,-.41],[.14,-.41],[.35,-.2],[.35,.39],[-.32,.39]],'#d9aa54','#795e35',.035);
      path([[-.17,-.45],[-.17,-.61],[.11,-.61],[.11,-.45]],null,'#765a32',.06);
      path([[.17,-.42],[.37,-.32],[.42,-.43],[.23,-.53]],'#5d6641');
      line([-.19,-.2],[.22,.23],'#a4793d',.035);line([.22,-.2],[-.19,.23],'#a4793d',.035);
      path([[.02,-.22],[-.1,.02],[.03,.02],[-.02,.24],[.19,-.06],[.04,-.06]],'#f7e6a2');
      ctx.restore();ctx.fillStyle='#5c6038';ctx.textAlign='center';ctx.font=`bold ${Math.max(8,scale*.17)}px monospace`;ctx.fillText('+32%',x,y-scale*.8);
    }
  }
  function drawZombies(){
    for(const zombie of physics.zombies){
      if(zombie.hit&&zombie.timeSinceHit>2.4)continue;
      const x=sx(zombie.x),y=sy(zombie.y);if(x<-80||x>width+80)continue;
      ctx.save();ctx.translate(x,y);ctx.rotate(-(zombie.angle||0));ctx.scale(scale,-scale);
      if(zombie.hit)ctx.globalAlpha=clamp(1-(zombie.timeSinceHit||0)/2.4,0,1);
      const gait=zombie.hit?.3:Math.sin(time*4+zombie.id)*.12;
      const coat=zombie.id%3===0?'#56695b':zombie.id%3===1?'#7b7455':'#6c7e54';
      // Rigid body is the torso. Draw limbs around its actual transform.
      line([-.11,-.27],[-.14-gait,-.69],'#3a5545',.14);line([.12,-.27],[.16+gait,-.69],'#3a5545',.14);
      line([-.16-gait,-.68],[-.31-gait,-.7],'#263f34',.13);line([.16+gait,-.68],[.33+gait,-.7],'#263f34',.13);
      path([[-.24,.59],[.23,.59],[.27,-.33],[.06,-.28],[-.09,-.39],[-.26,-.29]],coat,'#3d5945',.025);
      line([-.23,.2],[-.43,.04-gait],'#829d69',.13);line([-.43,.04-gait],[-.61,.13-gait],'#91ac77',.11);
      line([.22,.2],[.42,.28+gait],'#829d69',.13);line([.42,.28+gait],[.63,.24+gait],'#91ac77',.11);
      circle(.01,.84,.255,'#94b47c');path([[-.22,.90],[-.18,1.08],[.09,1.13],[.23,.98],[.02,1.03],[-.11,.97]],'#4c6e4d');
      circle(-.075,.87,.05,'#293f33');circle(.105,.87,.05,'#293f33');circle(-.075,.88,.015,'#e8db90');circle(.105,.88,.015,'#e8db90');
      line([-.05,.72],[.11,.71],'#42513b',.045);line([.03,.31],[.03,-.2],'#425b42',.022);
      ctx.restore();
    }
  }
  function drawRivalIndicator(){
    if(!state.rival||mode!=='playing')return;
    const x=sx(state.rival.x);if(x>40&&x<width-40)return;
    const right=x>=width-40,px=right?width-21:21,py=height*.48;
    path(right?[[px,py],[px-10,py-7],[px-10,py+7]]:[[px,py],[px+10,py-7],[px+10,py+7]],'#a8543c');
    ctx.fillStyle='#6d4934';ctx.font='bold 9px monospace';ctx.textAlign=right?'right':'left';ctx.fillText('IRON MAW',right?px-17:px+17,py+3);
  }
  function drawMountedCannon(){
    const weapon=state.weapon,mount=weapon.mount,muzzle=weapon.muzzle;
    if(!mount||!muzzle)return;
    const x=sx(mount.x),y=sy(mount.y),s=scale;
    ctx.save();ctx.translate(x,y);ctx.rotate(-state.angle);ctx.fillStyle='#3c5141';ctx.fillRect(-s*.35,-s*.04,s*.7,s*.2);ctx.restore();
    ctx.save();ctx.translate(x,y);ctx.rotate(-weapon.angle);ctx.scale(s,s);
    const recoil=gunKick*.14;
    circle(0,0,.25,'#455e47');circle(0,0,.15,'#758768');
    path([[-.29-recoil,-.19],[.53-recoil,-.19],[.65-recoil,.16],[-.24-recoil,.16]],'#334c3d','#a6b884',.025);
    path([[.41-recoil,-.105],[1.43-recoil,-.105],[1.43-recoil,.105],[.41-recoil,.105]],'#58705a','#263f34',.025);
    path([[1.19-recoil,-.15],[1.45-recoil,-.15],[1.45-recoil,.15],[1.19-recoil,.15]],'#2b4437');
    line([.8-recoil,-.1],[.8-recoil,.1],'#a9b98b',.06);
    path([[-.05,-.19],[.1,-.32],[.22,-.32],[.22,-.18]],'#2b4437');
    circle(-.12,-.04,.065,state.ammo?'#e0ed89':'#6f7766');
    ctx.restore();
    if(muzzleFlash>0){
      ctx.save();ctx.translate(sx(muzzle.x),sy(muzzle.y));ctx.rotate(-weapon.angle);ctx.globalAlpha=muzzleFlash/.085;
      path([[0,-s*.11],[s*.45,-s*.23],[s*.32,-s*.06],[s*.75,0],[s*.3,s*.09],[s*.45,s*.22],[0,s*.12]],'#f0dd92');
      circle(0,0,s*.14,'#fff0bb');ctx.restore();
    }
  }
  function drawCannonProjectile(){
    const p=state.projectile;if(!p)return;
    const x=sx(p.x),y=sy(p.y),px=sx(p.prevX??p.x),py=sy(p.prevY??p.y);
    ctx.save();ctx.shadowColor='#f4df99';ctx.shadowBlur=10;
    line([px,py],[x,y],'#e6c96c',Math.max(2,scale*.07));circle(x,y,Math.max(2,scale*.08),'#fff0b2');ctx.restore();
  }
  function drawTrackMonster(){
    const m=state.monster;if(!m)return;
    const t=m.timeSinceHit||0;if(!m.alive&&t>1.25)return;
    const x=sx(m.x),y=sy(m.y);if(x<-220||x>width+220)return;
    ctx.save();ctx.translate(x,y);ctx.scale(scale,-scale);
    if(!m.alive){ctx.globalAlpha=clamp(1-t/1.25,0,1);ctx.rotate(-Math.min(1.3,t*1.7));}
    // A hulking silhouette and amber core distinguish this one-shot encounter
    // from the smaller shambling zombies. The physics shape stays 3×4.8 m.
    path([[-1.4,0],[-1.4,.35],[-1.02,.65],[-.55,.58],[-.48,.1]],'#354c42','#233e35',.035);
    path([[.48,.1],[.55,.58],[1.02,.65],[1.4,.35],[1.4,0]],'#354c42','#233e35',.035);
    path([[-1.05,.45],[-.94,1.65],[-.48,1.7],[-.32,.43]],'#526b54');
    path([[.32,.43],[.48,1.7],[.94,1.65],[1.05,.45]],'#526b54');
    path([[-.94,1.4],[-1.22,2.45],[-1.2,3.45],[-.83,3.91],[.83,3.91],[1.2,3.45],[1.22,2.45],[.94,1.4],[.16,1.25]],'#657b5c','#2f4d3b',.05);
    path([[-1.15,3.45],[-1.62,3.02],[-1.75,2.03],[-1.28,1.75],[-.98,2.78]],'#435e49','#2c4938',.035);
    path([[1.15,3.45],[1.62,3.02],[1.75,2.03],[1.28,1.75],[.98,2.78]],'#435e49','#2c4938',.035);
    for(const side of [-1,1])for(let i=0;i<3;i++)path([[side*(1.42+i*.11),2.04],[side*(1.37+i*.11),1.67],[side*(1.52+i*.1),1.8]],'#d2cf9d');
    path([[-.72,3.52],[-.83,4.02],[-.57,4.43],[.57,4.43],[.83,4.02],[.72,3.52],[.14,3.35]],'#79916a','#2f4d3b',.04);
    path([[-.66,4.27],[-.92,4.8],[-.36,4.45]],'#d7cfa0','#586749',.035);
    path([[.36,4.45],[.92,4.8],[.66,4.27]],'#d7cfa0','#586749',.035);
    path([[-.61,4.12],[-.12,4.01],[-.19,3.84],[-.55,3.9]],'#253f35');
    path([[.12,4.01],[.61,4.12],[.55,3.9],[.19,3.84]],'#253f35');
    line([-.49,3.98],[-.24,3.94],'#f1ca78',.075);line([.24,3.94],[.49,3.98],'#f1ca78',.075);
    line([-.31,3.62],[.31,3.62],'#304734',.09);
    for(const side of [-1,1])path([[side*.24,3.68],[side*.17,3.85],[side*.12,3.64]],'#ddd7aa');
    path([[-.95,3.42],[-.3,3.2],[0,3.4],[.3,3.2],[.95,3.42],[.63,2.93],[-.63,2.93]],'#425b48');
    line([-.72,2.3],[.72,2.3],'#879879',.07);line([-.56,1.82],[.56,1.82],'#3f5742',.08);
    const coreY=(m.weakpoint?.y??m.y+2.85)-m.y;
    circle(0,coreY,.4,'#293f35');circle(0,coreY,.29,'#cda960');circle(0,coreY,.14,'#eddda0');
    ctx.restore();
    if(m.alive){
      const target=m.weakpoint||{x:m.x,y:m.y+2.85},tx=sx(target.x),ty=sy(target.y),r=scale*.54;
      ctx.save();ctx.strokeStyle=state.weapon.canHit?'#e4f493':'#e5c687';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(tx,ty,r,0,Math.PI*2);ctx.stroke();
      for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5])line([tx+Math.cos(angle)*r*.78,ty+Math.sin(angle)*r*.78],[tx+Math.cos(angle)*r*1.3,ty+Math.sin(angle)*r*1.3],ctx.strokeStyle,1.5);
      ctx.font=`bold ${Math.max(8,scale*.2)}px monospace`;ctx.textAlign='center';ctx.fillStyle='#3f573d';ctx.fillText('ONE SHOT · MAKE IT COUNT',x,y-scale*5.15);ctx.restore();
    }
  }
  function drawMonsterIndicator(){
    const m=state.monster;if(!m.alive||mode!=='playing')return;
    const x=sx(m.x);if(x<width-25)return;
    const px=width-18,py=height*.55;
    path([[px,py],[px-10,py-7],[px-10,py+7]],'#b27c4a');
    ctx.fillStyle='#6b5835';ctx.font='bold 9px monospace';ctx.textAlign='right';ctx.fillText(`MONSTER · ${Math.ceil(state.weapon.distance)} M`,px-17,py+3);
  }
  function drawParticles(dt) {
    for(let i=particles.length-1;i>=0;i--){const p=particles[i];if(mode==='playing'){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy-=dt*.7;p.life-=dt;p.r+=dt*.12;}if(p.life<=0){particles.splice(i,1);continue;}ctx.globalAlpha=clamp(p.life*.4,0,.35);circle(sx(p.x),sy(p.y),p.r*scale,p.color||'#d0ce96');}ctx.globalAlpha=1;
  }
  function render(dt) {
    const touchLayout = width < 780 || window.matchMedia('(pointer:coarse)').matches;
    groundRatio = lerp(groundRatio, touchLayout && mode !== 'ready' ? .68 : .77, 1 - Math.exp(-dt * 4));
    scale=lerp(scale,baseScale*(1-Math.min(.1,Math.abs(state.speed)/240)),Math.min(1,dt*2));
    const targetX=state.x+width/scale*.21+clamp(state.speed*.12,-1.8,2.5);
    camera.x=lerp(camera.x,targetX,1-Math.exp(-dt*4));camera.y=lerp(camera.y,Math.max(0,state.y-2.9),1-Math.exp(-dt*3));
    ctx.save();if(shake>.05){ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);shake*=Math.exp(-dt*14);}
    drawBackground();drawDecor();drawTerrain();drawFuelCans(nowForScene());drawZombies();drawTrackMonster();if(state.rival)drawTruck(state.rival,true);drawTruck();drawMountedCannon();drawCannonProjectile();drawParticles(dt);drawRivalIndicator();drawMonsterIndicator();ctx.restore();
  }
  function frame(now) {
    const dt=clamp((now-last)/1000,0,.05);last=now;
    if(mode==='playing'){
      accumulator+=dt;let steps=0;
      while(accumulator>=STEP&&steps++<7&&mode==='playing'){tick(STEP);accumulator-=STEP;}
      if(accumulator<0)accumulator=0;
      if(mode==='playing')audio.update({...state,throttle:input().throttle},dt);
    } else accumulator=0;
    gunKick*=Math.exp(-dt*17);muzzleFlash=Math.max(0,muzzleFlash-dt);
    render(dt);hudClock+=dt;if(hudClock>.05){updateHUD();hudClock=0;}
    if(toastUntil&&now>toastUntil){$('toast').classList.remove('show');toastUntil=0;}
    requestAnimationFrame(frame);
  }
  // Read-only diagnostics for QA and future model handoff.
  window.irontrail = { get mode(){return mode;}, get telemetry(){return {...state,time,bestAir,checkpoint,recoveries};}, get physics(){return physics;}, get audio(){return audio;}, get campaign(){return JSON.parse(JSON.stringify(campaign));}, get stage(){return selectedStage+1;} };
  syncStageUI();stageBrief();audio.setPaused(true);resize();updateHUD();requestAnimationFrame(frame);
})();
