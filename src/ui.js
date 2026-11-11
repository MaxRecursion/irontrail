/* IRONTRAIL v3 DOM owner. Classic script; no physics dependency.
 *
 * HUD contract (all optional; speed is signed m/s, progress values are 0..1):
 * {stageIndex,stageName,progress,distance,length,time,score,ghostDelta,fuel,
 *  cleared,totalZombies,speed,gear,rpm,ammo,locked,monsterDistance,monsterAlive,
 *  monsterProgress,rivalProgress,racePosition,combo,comboLeft,comboMax,
 *  checkpointProgress:[0..1],paused,muted,status,shootingPhase,
 *  nitro(0..100),boosting,nitroReady,nitroHint,slipstream,gap(m ahead of Iron Maw|null)}
 * award(kind,{label,value}) shows a kinetic slab (three pooled nodes); tick(dt) expires slabs and
 * drives the results count-up, emitting 'sfx' ('tick'|'stamp').
 *
 * Screen data:
 * title/stages/garage/settings read setCampaign(save,stages,biomes,rulesInfo).
 * brief:{stageIndex,name,length,par,challenge,best,description}
 * pause:{stageName,time,fuel}
 * results:{stageIndex,name,time,par,score,stars:[bool3],breakdown:[{label,value}],
 *          scrap,newBest,newScoreBest,challenge,nextAvailable}
 * failed:{reason,stageName,time,score,scrap,tip}
 * showScreen(null) hides menus. Menu events are emitted; UI never starts physics.
 * cue(kind,{value,seconds}) shows a persistent SVG badge with optional numeric value.
 * clearFeedback() cancels transient cue/toast/banner feedback on screen/run transitions.
 * on(name,fn) returns an unsubscribe. navigate(direction),activate(),back() support
 * gamepads. setCampaign updates source data; call showScreen again to refresh a menu.
 * metrics() is cached and reserves recover top-center, independently of all controls.
 */
(function (global) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clamp = (n,a,b) => Math.max(a,Math.min(b,Number.isFinite(Number(n))?Number(n):a));
  const timeText = value => {
    const n=Math.floor(Math.max(0,Number(value)||0)*100+1e-6);
    return `${String(Math.floor(n/6000)).padStart(2,'0')}:${String(Math.floor(n/100)%60).padStart(2,'0')}.${String(n%100).padStart(2,'0')}`;
  };
  const scoreText = value => Math.max(0,Math.floor(Number(value)||0)).toLocaleString('en-US');
  const AWARDS=Object.freeze({perfect:'cue-star',flip:'cue-trick',air:'cue-air',smash:'cue-burst',chain:'cue-burst',slam:'cue-burst',nitro:'cue-bolt',giant:'cue-target',checkpoint:'cue-checkpoint',wreck:'cue-error',start:'cue-bolt'});
  const CUES=Object.freeze({target:'Target locked',shot:'Shot fired',hit:'Monster cleared',miss:'Shot missed',fuel:'Fuel',checkpoint:'Checkpoint',recover:'Recovered',trick:'Trick',success:'Success',error:'Unavailable',upgrade:'Upgrade installed'});
  const icon = kind => {
    const paths={target:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 1v6M12 17v6M1 12h6M17 12h6',checkpoint:'M5 22V3m0 1h14l-3 4 3 4H5',engine:'M4 8h3V5h8v3h4v9h-3v3H7v-3H4zM9 3h5M2 11v4M22 10v7M10 10l-2 4h4l-2 4',tyre:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v3M12 14v3M7 12h3M14 12h3M8.5 8.5l2 2M13.5 13.5l2 2M8.5 15.5l2-2M13.5 10.5l2-2',suspension:'M5 3l4 3-3 3 7 3-3 3 7 3-2 3M14 3l5 3-3 3 3 3-5 3 3 3-3 3',fuel:'M5 21V4h9v17M4 21h12M5 9h9M16 5l3 3v9c0 2 3 2 3 0v-5l-3-3'};
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[kind]||paths.engine}"/></svg>`;
  };
  const HERO_SPIDER='<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="24" cy="28" rx="5" ry="9"/><circle cx="24" cy="17" r="4"/><path fill="none" d="M20 22L13 16L10 6M28 22L35 16L38 6M19 26L9 23L4 15M29 26L39 23L44 15M19 30L9 33L4 42M29 30L39 33L44 42M21 34L16 41L16 46M27 34L32 41L32 46"/></g></svg>';
  const HERO_WEB='<svg class="hero-web" viewBox="0 0 400 320" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1"><path d="M400 0L0 0M400 0L0 85M400 0L0 190M400 0L180 320M400 0L310 320M400 0L400 320M280 0Q270 13 284 25Q278 43 301 47Q306 65 331 63Q350 78 371 67Q390 73 400 62M190 0Q176 31 196 43Q190 80 226 82Q236 115 276 110Q312 135 349 115Q380 126 400 109M95 0Q74 49 98 64Q90 124 145 126Q169 176 230 169Q280 205 337 172Q370 193 400 162M0 0Q-14 60 10 86Q0 170 68 174Q100 235 184 232Q252 279 323 235Q370 266 400 220"/></g></svg>';
  const heroTruck=()=>{
    const wheel=(x)=>`<g transform="translate(${x} 260)"><g class="hero-wheel"><circle r="71" fill="#0b0c11" stroke="#3d3b42" stroke-width="8"/>${Array.from({length:12},(_,i)=>`<rect x="-8" y="-72" width="16" height="13" rx="3" fill="#424049" transform="rotate(${i*30})"/>`).join('')}<circle r="46" fill="#c82436" stroke="#ff6872" stroke-width="4"/><circle r="31" fill="#171922" stroke="#e6dbd6" stroke-width="3"/>${Array.from({length:6},(_,i)=>`<circle cx="${Math.cos(i*Math.PI/3)*22}" cy="${Math.sin(i*Math.PI/3)*22}" r="4" fill="#e8e0d9"/>`).join('')}<circle r="10" fill="#f2e7dd"/></g></g>`;
    return `<svg class="hero-truck-art" viewBox="0 0 640 360" role="img" aria-label="OJAS-01, Ojas’s red and black monster truck with a spider emblem and white web details"><defs><linearGradient id="hero-paint" x2="0.2" y2="1"><stop stop-color="#ff5964"/><stop offset="1" stop-color="#bb1830"/></linearGradient></defs><ellipse cx="320" cy="326" rx="249" ry="17" fill="#000" opacity=".32"/><g fill="none" stroke="#fa6975" stroke-width="2" opacity=".4"><path d="M22 198h92M7 218h72M44 237h54"/></g><g class="hero-truck-body"><path d="M92 227L101 164L215 162L245 86L363 86L419 161L527 176L558 208L548 245L103 245Z" fill="url(#hero-paint)" stroke="#10121a" stroke-width="9" stroke-linejoin="round"/><path d="M222 160L251 99H353L400 160Z" fill="#141822" stroke="#10121a" stroke-width="6"/><path d="M245 148L262 111H291V148ZM309 110H346L375 148H309Z" fill="#f3e8df"/><path d="M94 201H547L553 219H91Z" fill="#14161e"/><path d="M229 89H367" stroke="#10121a" stroke-width="13" stroke-linecap="round"/><path d="M105 163H208V191H104M425 168L523 180L539 193H424Z" fill="#191b23"/><g fill="none" stroke="#f9d8da" stroke-width="1.6" opacity=".8"><path d="M112 168L202 191M112 168L163 191M112 168L114 191M112 168L201 168M134 168Q130 174 134 175Q128 179 129 181Q125 185 124 191M159 168Q154 178 161 181Q151 185 153 191M188 168Q179 184 188 188"/></g><path d="M87 228H564" stroke="#e3d9d4" stroke-width="5"/><path d="M100 247Q98 181 170 181Q242 181 242 247M391 247Q392 181 465 181Q537 181 538 247" fill="#171921" stroke="#10121a" stroke-width="6"/><g transform="translate(271 170) scale(.5)" fill="#fff0e8" stroke="#fff0e8" stroke-width="2.6"><ellipse cx="0" cy="0" rx="7" ry="11"/><circle cy="-15" r="5"/><path fill="none" d="M-6-5L-19-15L-23-27M6-5L19-15L23-27M-7 0L-23-5L-30-15M7 0L23-5L30-15M-7 5L-23 12L-30 26M7 5L23 12L30 26M-5 10L-14 23V32M5 10L14 23V32"/></g><text x="317" y="195" fill="#fff0e7" font-family="Arial, sans-serif" font-size="25" font-weight="900" letter-spacing="1">OJAS</text><text x="317" y="218" fill="#ffe0dc" font-family="monospace" font-size="10" letter-spacing="3">SUPER DRIVER</text><path d="M539 189L551 199V212H539Z" fill="#fff2dc"/><path d="M82 225H114V245H80ZM536 225H571V245H540Z" fill="#2b2d36" stroke="#10121a" stroke-width="5"/><path d="M445 154V124H462V157" fill="#282a32" stroke="#10121a" stroke-width="5"/>${wheel(170)}${wheel(465)}</g></svg>`;
  };
  class IronUI {
    constructor(doc) {
      this.document=doc;this.app=doc.getElementById('app');if(!this.app)throw new Error('IronUI needs the real shell #app.');
      this.events=new Map();this.values=Object.create(null);this.nodes=Object.create(null);this.screen=null;this.data={};this._touch=false;
      this.save=global.IronRules?.Save.defaults()||{unlocked:1,completed:[],best:{},stars:{},scrap:0,upgrades:{},settings:{}};
      this.stages=[];this.biomes=[];this.rulesInfo={};this._metrics={safeTop:148,safeBottom:115};this._primary={name:'play',args:[]};
      for(const element of this.app.querySelectorAll('[id]'))this.nodes[element.id]=element;
      this.pedals=Array.from(this.app.querySelectorAll('[data-input]'));
      this.hud={setVisible:value=>this._hidden('gameHud',!value),update:view=>this._updateHUD(view||{})};
      const bindings={pauseButton:'pause',restartButton:'restart',soundButton:'sound',fullscreenButton:'fullscreen',fireButton:'fire',recoverButton:'recover'};
      for(const id of Object.keys(bindings))this.nodes[id].addEventListener('click',()=>this.emit(bindings[id]));
      this.nodes.playButton.addEventListener('click',()=>this.emit(this._primary.name,...this._primary.args));
      this.nodes.screenLayer.addEventListener('click',event=>{
        const button=event.target.closest('[data-ui]');if(!button||button.disabled)return;
        const name=button.dataset.ui;
        if(name==='selectStage')this.emit(name,Number(button.dataset.stage));
        else if(name==='buy')this.emit(name,button.dataset.track);
        else this.emit(name);
      });
      this.nodes.screenLayer.addEventListener('input',event=>this._setting(event));
      this.nodes.screenLayer.addEventListener('change',event=>{if(event.target.type!=='range')this._setting(event);});
      this.nodes.screenLayer.addEventListener('keydown',event=>this._key(event));
      this._resize=()=>this._measure();global.addEventListener?.('resize',this._resize);this._measure();
      this.showScreen('title');
    }
    on(name,fn){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(fn);return()=>this.events.get(name)?.delete(fn);}
    emit(name,...args){const listeners=this.events.get(name);if(listeners)for(const fn of listeners)fn(...args);}
    _text(id,value){const text=String(value??'');const key=`text:${id}`;if(this.values[key]!==text){this.values[key]=text;if(this.nodes[id])this.nodes[id].textContent=text;}}
    _hidden(id,hidden){const value=!!hidden,key=`hidden:${id}`;if(this.values[key]!==value){this.values[key]=value;if(this.nodes[id])this.nodes[id].hidden=value;}}
    _class(id,name,value){const bool=!!value,key=`class:${id}:${name}`;if(this.values[key]!==bool){this.values[key]=bool;this.nodes[id]?.classList.toggle(name,bool);}}
    _attr(id,name,value){const text=String(value),key=`attr:${id}:${name}`;if(this.values[key]!==text){this.values[key]=text;this.nodes[id]?.setAttribute(name,text);}}
    _bar(id,value){const n=Math.round(clamp(value,0,1)*1000)/1000,key=`bar:${id}`;if(this.values[key]!==n){this.values[key]=n;this.nodes[id].style.transform=`scaleX(${n})`;}}
    _marker(id,value){this._hidden(id,value===null||value===undefined||!Number.isFinite(Number(value)));if(value==null)return;const n=Math.round(clamp(value,0,1)*1000)/10,key=`marker:${id}`;if(this.values[key]!==n){this.values[key]=n;this.nodes[id].style.transform=`translateX(${n}%)`;}}
    _updateHUD(v){
      if(v.stageIndex!==undefined)this._text('hudStageNumber',`${String(Number(v.stageIndex)+1).padStart(2,'0')} / 10`);
      if(v.stageName!==undefined)this._text('hudStageName',v.stageName);
      if(v.progress!==undefined)this._bar('hudProgressFill',v.progress);
      if(v.distance!==undefined||v.length!==undefined)this._text('hudDistance',`${Math.floor(Math.max(0,Number(v.distance)||0))} / ${Math.floor(Number(v.length)||0)} M`);
      if(v.time!==undefined)this._text('hudTime',timeText(v.time));
      if(v.score!==undefined)this._text('hudScore',scoreText(v.score));
      if(v.ghostDelta!==undefined){const active=v.ghostDelta!==null&&Number.isFinite(Number(v.ghostDelta));this._hidden('hudGhost',!active);if(active){this._text('hudGhost',`${v.ghostDelta<=0?'−':'+'}${Math.abs(v.ghostDelta).toFixed(2)}s`);this._class('hudGhost','ahead',v.ghostDelta<=0);this._class('hudGhost','behind',v.ghostDelta>0);}}
      if(v.fuel!==undefined){const fuel=clamp(v.fuel,0,100);this._text('fuelValue',`${Math.ceil(fuel)}%`);this._bar('fuelFill',fuel/100);this._attr('fuelMeter','aria-valuenow',Math.ceil(fuel));this._class('fuelHud','low',fuel<23);this._class('fuelHud','critical',fuel<12);}
      if(v.cleared!==undefined||v.totalZombies!==undefined)this._text('zombieValue',`${v.cleared||0} / ${v.totalZombies||0}`);
      if(v.speed!==undefined)this._text('speedValue',String(Math.round(Math.abs(v.speed)*3.6)).padStart(2,'0'));
      if(v.gear!==undefined)this._text('gearValue',v.gear);
      if(v.rpm!==undefined)this._bar('hudRpmFill',v.rpm/5200);
      if(v.ammo!==undefined){this._text('ammoValue',`${v.ammo} / 1`);const disabled=!v.ammo;const key='disabled:fire';if(this.values[key]!==disabled){this.values[key]=disabled;this.nodes.fireButton.disabled=disabled;}this._class('weaponHud','spent',!v.ammo);this._attr('ammoPip','aria-label',v.ammo?'One charge ready':'No charges');this._attr('fireButton','aria-label',v.ammo?'Fire cannon, one charge available':'Cannon empty');}
      if(v.locked!==undefined)this._class('weaponHud','locked',v.locked);
      if(v.shootingPhase!==undefined)this._attr('weaponHud','data-phase',v.shootingPhase);
      if(v.monsterAlive!==undefined)this._class('weaponHud','cleared',!v.monsterAlive);
      if(v.monsterAlive!==undefined||v.ammo!==undefined||v.locked!==undefined){const alive=v.monsterAlive!==false;this._text('weaponStatus',!alive?'MONSTER CLEARED':v.ammo===0?'CHARGE SPENT':v.locked?'TARGET LOCKED · FIRE':'SAVE YOUR ONE SHOT');}
      if(v.monsterDistance!==undefined||v.monsterAlive!==undefined){this._text('monsterDistance',v.monsterAlive===false?'✓':`${Math.ceil(Math.max(0,Number(v.monsterDistance)||0))} m`);this._monsterAlive=v.monsterAlive!==false;this._monsterDistance=Number(v.monsterDistance);}
      if(v.monsterDistance!==undefined||v.monsterAlive!==undefined||v.locked!==undefined)this._class('weaponHud','warning',this._monsterAlive!==false&&this._monsterDistance<70&&!this.values['class:weaponHud:locked']);
      if(v.monsterProgress!==undefined)this._marker('hudMonsterMarker',v.monsterAlive===false?null:v.monsterProgress);
      if(v.rivalProgress!==undefined)this._marker('hudRivalMarker',v.rivalProgress);
      if(v.status!==undefined)this._text('hudStageStatus',v.status);else if(v.racePosition!==undefined)this._text('hudStageStatus',v.rivalProgress==null?'':`⚑ ${v.racePosition} / 2`);
      if(v.combo!==undefined){this._hidden('hudCombo',v.combo<2);this._text('hudComboValue',`×${v.combo||1}`);}
      if(v.comboLeft!==undefined)this._bar('hudComboFill',v.comboLeft/(v.comboMax||3));
      if(v.checkpointProgress){const signature=v.checkpointProgress.join(',');if(this.values.checkpoints!==signature){this.values.checkpoints=signature;this.nodes.hudCheckpointTicks.replaceChildren();for(const progress of v.checkpointProgress){const tick=this.document.createElement('i');tick.className='hud-checkpoint';tick.style.left=`${clamp(progress,0,1)*100}%`;this.nodes.hudCheckpointTicks.appendChild(tick);}}}
      if(v.nitro!==undefined){const nitro=clamp(v.nitro,0,100);this._bar('nitroFill',nitro/100);this._class('nitroHud','full',nitro>=99.5);this._class('nitroHud','empty',nitro<8);this._attr('nitroHud','aria-valuenow',Math.round(nitro));}
      if(v.boosting!==undefined)this._class('nitroHud','burning',v.boosting);
      if(v.nitroReady!==undefined)this._class('nitroHud','ready',v.nitroReady);
      if(v.nitroHint!==undefined)this._text('nitroHint',v.nitroHint);
      if(v.gap!==undefined){const active=v.gap!==null&&Number.isFinite(Number(v.gap));this._hidden('hudGap',!active);if(active){const gap=Math.round(Number(v.gap));this._text('hudGap',`${gap>=0?'+':'−'}${Math.abs(gap)} M`);this._class('hudGap','behind',gap<0);}}
      if(v.paused!==undefined){this._attr('pauseButton','aria-label',v.paused?'Resume game':'Pause game');this._class('pauseButton','active',v.paused);}
      if(v.muted!==undefined){this._attr('soundButton','aria-label',v.muted?'Enable sound':'Mute sound');this._attr('soundButton','aria-pressed',v.muted);}
    }
    setAudioStatus(status){
      if(this.screen!=='settings')return;
      const output=this.document.getElementById('soundTestStatus'),bar=this.document.getElementById('soundTestLevel'),meter=this.document.getElementById('soundTestMeter');
      const silent=status.muted||status.master===0||(status.music===0&&status.sfx===0);
      const label=status.error&&status.context!=='running'?'Tap to enable sound':silent?'Volume off':status.context!=='running'?'Tap to enable sound':'Sound on';
      if(output&&output.textContent!==label)output.textContent=label;
      const level=Math.round(clamp(status.rms*30,0,1)*100);
      if(bar)bar.style.transform=`scaleX(${level/100})`;
      if(meter)meter.setAttribute('aria-valuenow',level);
    }
    setCampaign(save,stages,biomes,rulesInfo){this.save=save||this.save;this.stages=stages||this.stages;this.biomes=biomes||this.biomes;this.rulesInfo=rulesInfo||this.rulesInfo;this.app.classList.toggle('reduced-motion',!!this.save.settings?.reducedMotion);}
    _par(i){return (this.rulesInfo.PAR_TIMES||this.rulesInfo.parTimes||global.IronRules?.PAR_TIMES||[])[i]||0;}
    _challenge(i){return (this.rulesInfo.CHALLENGES||this.rulesInfo.challenges||global.IronRules?.CHALLENGES||[])[i]?.label||'Complete the stage objective';}
    _stars(stars,animated=false){const values=Array.isArray(stars)?stars:[false,false,false];return values.map((v,i)=>`<span${v?' class="earned"':''}${animated?` style="--star-delay:${i*180}ms"`:''}>★</span>`).join('');}
    _button(label,event,extra=''){return `<button type="button" class="menu-button" data-ui="${esc(event)}" ${extra}>${esc(label)}</button>`;}
    _stageName(i){return this.stages[i]?.name||`Stage ${i+1}`;}
    showScreen(name,data={}){
      this.screen=name;this.data=data||{};
      if(name===null){this.nodes.screenLayer.hidden=true;this.nodes.screenLayer.setAttribute('aria-hidden','true');this.nodes.gameCanvas.focus({preventScroll:true});return;}
      this.hud.setVisible(false);this.setRecoverVisible(false);this.nodes.screenLayer.hidden=false;this.nodes.screenLayer.removeAttribute('aria-hidden');
      const d=this.data,i=clamp(d.stageIndex??this.save.selected??0,0,9),stage=this.stages[i]||{};
      this.nodes.menuPanel.className=`menu-panel screen-${name}`;this.nodes.screenLayer.className=`screen-layer screen-${name}`;
      this.nodes.menuCrumb.textContent=name==='title'?'BUILT FOR OJAS':`${name.toUpperCase()} / IRONTRAIL`;
      let html='',primary='Continue',action='back',args=[],secondary='';
      if(name==='title'){
        html=`${HERO_WEB}<div class="ojas-title-copy"><p class="menu-eyebrow hero-dedication">Made for Ojas Kulkarni, with love.</p><h1 id="screenHeading" class="attract-title ojas-title">OJAS’S<span>MONSTER<br>RALLY.</span></h1><p class="title-copy">Little hero. Monster wheels.</p><div class="title-tag"><span class="hero-spider-mini">${HERO_SPIDER}</span> RED. BLACK. READY TO ROLL.</div></div><div class="hero-showcase">${heroTruck()}<div class="hero-truck-label"><b>OJAS-01</b><span>YOUR SUPER TRUCK</span></div></div>`;
        primary=this.save.completed?.length?'Let’s race again, Ojas!':'Let’s race, Ojas!';action='play';secondary=this._button('Tracks','stages')+this._button('Garage','garage')+this._button('Settings','settings');
      }else if(name==='dedication'){
        html=`<div class="dedication-card"><div class="dedication-emblem">${HERO_SPIDER}</div><p class="menu-eyebrow">A GAME MADE JUST FOR YOU</p><h1 id="screenHeading" class="menu-title">For Ojas Kulkarni.</h1><p class="dedication-message">Big dreams. Brave heart.<br>Monster adventures.</p><p class="dedication-love">Keep exploring, little hero.<br>Made for you, with love. <span aria-hidden="true">♥</span></p><div class="dedication-truck">${heroTruck()}</div></div>`;
        primary='Let’s go, Ojas!';action='back';secondary='';
      }else if(name==='stages'){
        html=`<p class="menu-eyebrow">THE ROAD OUT</p><h1 id="screenHeading" class="menu-title">Choose your line.</h1><p class="menu-copy">Ten routes. Thirty stars.</p><div class="campaign-summary"><span>${this.save.completed?.length||0} / 10 ROUTES CLEARED</span><span>${Object.values(this.save.stars||{}).reduce((sum,v)=>sum+(Array.isArray(v)?v.filter(Boolean).length:0),0)} / 30 STARS</span><span class="scrap-chip">◆ ${scoreText(this.save.scrap)} SCRAP</span></div><div class="stage-grid">`;
        for(let n=0;n<10;n++){
          const locked=n>=(this.save.unlocked||1),stars=this.save.stars?.[n]||[false,false,false],biome=this.biomes[n]||{};
          html+=`<button type="button" class="stage-card${locked?' locked':''}${n===(this.save.selected||0)?' current':''}" style="--card-accent:${esc(biome.accent||'#b9bd75')}" data-ui="selectStage" data-stage="${n}" aria-label="Stage ${n+1}: ${esc(this._stageName(n))}${locked?', locked':''}" ${locked?'disabled':''}><span class="stage-card-top"><b>${String(n+1).padStart(2,'0')}</b><span class="stage-lock">${locked?'LOCKED':n===9?'BOSS RACE':'SURVIVAL'}</span></span><span class="stage-name">${esc(this._stageName(n))}</span><span class="stage-meta">${this.stages[n]?.length||0} M · ${esc(biome.timeOfDay||'DEADLANDS').toUpperCase()}</span><span class="stage-stars" aria-label="${stars.filter(Boolean).length} of 3 stars">${this._stars(stars)}</span><span class="stage-best">${this.save.best?.[n]?timeText(this.save.best[n]):locked?'CLEAR THE PREVIOUS ROUTE':'SET THE FIRST TIME'}</span></button>`;
        }
        html+='</div>';primary='Continue selected route';action='selectStage';args=[this.save.selected||0];secondary=this._button('Garage','garage')+this._button('Title','title');
      }else if(name==='garage'){
        html=`<p class="menu-eyebrow">OJAS-01 WORKSHOP</p><h1 id="screenHeading" class="menu-title">Build your super truck.</h1><p class="menu-copy">Earn scrap. Upgrade your ride.</p><div class="campaign-summary"><span class="scrap-chip">◆ ${scoreText(this.save.scrap)} SCRAP AVAILABLE</span><span>UPGRADES APPLY TO YOUR NEXT RUN</span></div><div class="garage-grid">`;
        for(const track of ['engine','tyres','suspension','tank']){
          const info=global.IronRules.upgradeInfo(track,this.save.upgrades?.[track]||0,this.rulesInfo.upgrades||this.rulesInfo.UPGRADES);
          const max=info.level>=3,canBuy=!max&&this.save.scrap>=info.cost;
          html+=`<article class="upgrade-card"><div class="upgrade-icon">${icon(info.icon)}</div><h2 class="upgrade-title">${esc(info.label)}</h2><p class="upgrade-subtitle">${esc(info.subtitle)}</p><div class="upgrade-levels" aria-label="Level ${info.level} of 3">${[0,1,2].map(n=>`<i${n<info.level?' class="filled"':''}></i>`).join('')}</div><p class="upgrade-current">NOW · ${esc(info.current)}</p><p class="upgrade-next">${max?'MAXED OUT':`NEXT · ${esc(info.next)}`}</p><p class="upgrade-description">${esc(info.description)}</p><button class="buy-button" data-ui="buy" data-track="${track}" ${canBuy?'':'disabled'} aria-label="${max?`${esc(info.label)} fully upgraded`:`Upgrade ${esc(info.label)} for ${info.cost} scrap`}">${max?'FULLY UPGRADED':`UPGRADE <small>◆ ${info.cost}</small>`}</button></article>`;
        }
        html+='</div>';primary='Back to the rally';action='back';secondary=this._button('Stage select','stages')+this._button('Settings','settings');
      }else if(name==='settings'){
        const settings=this.save.settings||{};
        html='<p class="menu-eyebrow">TUNE YOUR EXPERIENCE</p><h1 id="screenHeading" class="menu-title">Make yourself at home.</h1><p class="menu-copy">Saved automatically.</p><div class="settings-grid">';
        const ranges=[['master','Master volume',.9],['music','Music volume',.55],['sfx','Engine & effects',.9]];
        for(const [key,label,def]of ranges){const value=Math.round(clamp(settings[key]??def,0,1)*100);html+=`<div class="setting-item"><label for="setting-${key}">${label}<output id="setting-value-${key}">${value}%</output></label><input id="setting-${key}" type="range" min="0" max="100" step="1" value="${value}" data-setting="${key}" aria-label="${label}"></div>`;}
        html+=`<div class="setting-item"><label for="setting-quality">Graphics quality<select id="setting-quality" data-setting="quality" aria-label="Graphics quality">${[['auto','Auto · adaptive'],['high','High'],['balanced','Balanced'],['performance','Performance']].map(([value,label])=>`<option value="${value}" ${settings.quality===value?'selected':''}>${label}</option>`).join('')}</select></label><small>Auto adjusts resolution and effects to keep motion smooth.</small></div>`;
        for(const [key,label,help]of [['shake','Camera shake','Physical impacts with a little extra punch.'],['showFps','Performance display','Show FPS, CPU time and rendering detail.'],['reducedMotion','Reduced motion','Quiet menu animation and camera effects.'],['haptics','Controller vibration','Rumble on landings, hits and nitro.'],['autoNitro','Auto nitro','Burns a healthy nitro meter for you on the ground.']])html+=`<div class="setting-item"><label for="setting-${key}">${label}<input id="setting-${key}" type="checkbox" data-setting="${key}" ${(settings[key]??(key==='haptics'))?'checked':''}></label><small>${help}</small></div>`;
        html+='<div class="setting-item sound-check"><button type="button" class="secondary-button sound-test" data-ui="testSound" aria-label="Test sound"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM17 8q4 4 0 8M20 5q7 7 0 14"/></svg>Test sound</button><div class="sound-test-feedback"><div id="soundTestMeter" class="sound-meter" role="meter" aria-label="Audio output level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="soundTestLevel"></i></div><output id="soundTestStatus" role="status">Tap to enable sound</output></div></div>';
        html+='</div>';primary='Save & return';action='back';secondary=this._button('Stage select','stages')+this._button('Title','title');
      }else if(name==='brief'){
        const par=d.par??this._par(i),challenge=typeof d.challenge==='string'?d.challenge:d.challenge?.label||this._challenge(i),best=d.best??this.save.best?.[i];
        html=`<div class="brief-layout"><div><p class="brief-kicker">STAGE ${String(i+1).padStart(2,'0')} / 10 ${i===9?'· FINAL BOSS':''}</p><h1 id="screenHeading" class="brief-name">${esc(d.name||stage.name||this._stageName(i))}</h1><p class="brief-description">${esc(d.description||stage.subtitle||'Find your line.')}</p><div class="brief-facts"><span>DISTANCE<strong>${d.length||stage.length||0}<small> M</small></strong></span><span>PAR TIME<strong>${timeText(par)}</strong></span><span>BEST<strong>${best?timeText(best):'—'}</strong></span></div><div class="onboarding"><span aria-label="Throttle with Up or W">↑ W</span><span aria-label="Balance with Left and Right">↶ ↷</span><span class="onboarding-nitro" aria-label="Hold Z or N to burn nitro"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#cue-bolt"/></svg> Z / N</span><span class="onboarding-shot" aria-label="Wait for the crosshair to lock, then fire with X or J"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 1v5m0 12v5M1 12h5m12 0h5"/></svg> X / J</span><span aria-label="Recover with C for 12 fuel">↻ C · −12</span></div></div><div class="brief-objectives"><div class="objective"><span class="star">★</span><div>Finish<small>One shot. One giant.</small></div></div><div class="objective"><span class="star">★</span><div>Beat the clock<small>${timeText(par)} OR FASTER</small></div></div><div class="objective"><span class="star">★</span><div>${esc(challenge)}<small>CHALLENGE</small></div></div></div></div>`;
        primary=i===9?'Challenge Iron Maw':'Start this run';action='play';secondary=this._button('Stage select','stages')+this._button('Garage','garage');
      }else if(name==='pause'){
        html=`<div class="pause-layout"><div><p class="menu-eyebrow">${esc(d.stageName||this._stageName(this.save.selected||0))}</p><h1 id="screenHeading" class="pause-heading">PARKED.<br>FOR NOW.</h1><p class="menu-copy">Take a breath.</p></div><div class="pause-data"><span>RUN TIME<strong>${timeText(d.time||0)}</strong></span><span>FUEL<strong>${Math.ceil(d.fuel??100)}%</strong></span></div></div>`;
        primary='Back to the trail';action='resume';secondary=this._button('Retry stage','retry')+this._button('Settings','settings')+this._button('Stage select','stages');
      }else if(name==='results'){
        const stars=d.stars||[true,false,false],par=d.par??this._par(i),challenge=typeof d.challenge==='string'?d.challenge:d.challenge?.label||this._challenge(i);
        html=`<div class="result-layout"><div><div class="hero-trophy" aria-label="Ojas’s trophy"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M19 8h26v17c0 12-7 18-13 18s-13-6-13-18V8Z" fill="#f5cb65" stroke="#fff0b5" stroke-width="2"/><path d="M19 13H8v9c0 10 10 13 15 12M45 13h11v9c0 10-10 13-15 12M32 43v11M20 57h24" fill="none" stroke="#f5cb65" stroke-width="5" stroke-linecap="round"/><path d="m32 17 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill="#a52a39"/></svg></div><p class="menu-eyebrow">${i===9?'OJAS’S MONSTER RALLY COMPLETE':`STAGE ${String(i+1).padStart(2,'0')} CLEARED`} · ${esc(d.name||this._stageName(i))}</p><h1 id="screenHeading" class="menu-title">${i===9?'Ojas, king of the trail!':'Super driving, Ojas!'}</h1><div class="result-stars" aria-label="${stars.filter(Boolean).length} of 3 stars">${this._stars(stars,true)}</div><div class="result-summary">YOUR TIME <b>${timeText(d.time||0)}</b><br>PAR TIME ${timeText(par)}<br>${esc(challenge)} ${stars[2]?'✓':'· —'}</div><div class="result-badges">${d.newBest?'<span class="result-badge">BEST TIME</span>':''}${d.newScoreBest?'<span class="result-badge">BEST SCORE</span>':''}</div><div class="result-big-score"><span data-count="${Math.max(0,Math.floor(Number(d.score)||0))}">${scoreText(d.score)}</span><small>TOTAL SCORE</small></div>${Array.isArray(d.awards)&&d.awards.length?`<div class="result-awards">${d.awards.slice(0,6).map(a=>`<span class="result-award">${esc(a.label)}<b>${esc(a.value)}</b></span>`).join('')}</div>`:''}</div><div><div class="score-breakdown">${(d.breakdown||[]).map(row=>`<div class="breakdown-row"><span>${esc(row.label)}</span><b data-count="${Math.max(0,Math.floor(Number(row.value)||0))}">${scoreText(row.value)}</b></div>`).join('')||'<div class="breakdown-row"><span>Run complete</span><b>0</b></div>'}<div class="scrap-earned"><span>SCRAP EARNED</span><strong>+${scoreText(d.scrap)}</strong></div></div></div></div>`;
        primary=d.nextAvailable!==false&&i<9?`Continue to stage ${String(i+2).padStart(2,'0')}`:'Back to the stages';action=d.nextAvailable!==false&&i<9?'next':'stages';secondary=this._button('Run it again','retry')+this._button('Garage','garage')+this._button('Stage select','stages');
      }else if(name==='failed'){
        const reason=d.reason||'fuel',tips={fuel:'Collect the amber cans.',monster:'Wait for the green crosshair. X / J to fire.',rival:'Keep your speed through the jumps.'};
        const failureIcon=reason==='fuel'?'fuel':reason==='monster'?'target':'checkpoint';
        html=`<div class="failure-icon">${icon(failureIcon)}</div><p class="menu-eyebrow">${esc(d.stageName||this._stageName(this.save.selected||0))}</p><h1 id="screenHeading" class="menu-title">${reason==='fuel'?'Out of fuel.':reason==='monster'?'Monster ahead.':'Iron Maw wins.'}</h1><div class="failure-tip">${esc(tips[reason]||tips.fuel)}</div><div class="result-summary">${timeText(d.time||0)} &nbsp; · &nbsp; ${scoreText(d.score)} &nbsp; · &nbsp; ◆ +${scoreText(d.scrap)}</div>`;
        primary='Try again, Ojas!';action='retry';secondary=this._button('Garage','garage')+this._button('Stage select','stages')+this._button('Title','title');
      }else{this.showScreen('title');return;}
      this.nodes.menuBody.innerHTML=html;this.nodes.secondaryActions.innerHTML=secondary;
      this.nodes.playButton.innerHTML=`${esc(primary)} <span aria-hidden="true">→</span>`;this._primary={name:action,args};
      this.nodes.menuHint.textContent=name==='title'?'↑ / WASD · Z / N NITRO · X / J · GAMEPAD':name==='garage'?'◆ SCRAP → UPGRADES':'↑ ↓ · ENTER · ESC';
      this.nodes.menuPanel.scrollTop=0;this.nodes.playButton.focus({preventScroll:true});
      this._count=null;
      if(name==='results'&&!this.save.settings?.reducedMotion){
        // Score rows roll up from zero; tick(dt) owns the clock so a hidden tab never races ahead.
        const nodes=Array.from(this.nodes.menuBody.querySelectorAll('[data-count]'));
        if(nodes.length){this._count={nodes,targets:nodes.map(node=>Number(node.dataset.count)||0),time:0,duration:1.15,tickClock:0};for(const node of nodes)node.textContent='0';}
      }
    }
    _setting(event){
      const target=event.target,key=target.dataset.setting;if(!key)return;
      const value=target.type==='checkbox'?target.checked:target.type==='range'?clamp(Number(target.value)/100,0,1):target.value;
      if(target.type==='range'){const output=this.document.getElementById(`setting-value-${key}`);if(output)output.textContent=`${Math.round(value*100)}%`;}
      this.emit('setting',key,value);
    }
    _focusable(){return Array.from(this.nodes.screenLayer.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')).filter(node=>!node.hidden&&node.getClientRects().length);}
    _key(event){
      if(this.screen===null)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.back();return;}
      if(event.key==='Tab'){const nodes=this._focusable(),i=nodes.indexOf(this.document.activeElement);if(!nodes.length)return;const next=event.shiftKey?(i<=0?nodes.length-1:i-1):(i+1)%nodes.length;event.preventDefault();event.stopPropagation();nodes[next].focus();return;}
      if(event.key==='Enter'){event.stopPropagation();return;}
      if(event.target.tagName==='INPUT'||event.target.tagName==='SELECT')return;
      const directions={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'};
      if(directions[event.key]){event.preventDefault();event.stopPropagation();this.navigate(directions[event.key]);}
    }
    navigate(direction){
      if(this.screen===null)return false;const nodes=this._focusable();if(!nodes.length)return false;
      const active=this.document.activeElement,delta=direction==='left'||direction==='up'?-1:1;
      if((direction==='left'||direction==='right')&&active?.tagName==='INPUT'&&active.type==='range'){const lo=Number(active.min)||0,hi=Number(active.max)||100;active.value=clamp(Number(active.value)+delta*(hi-lo)*.05,lo,hi);active.dispatchEvent(new global.Event('input',{bubbles:true}));return true;}
      if((direction==='left'||direction==='right')&&active?.tagName==='SELECT'){active.selectedIndex=(active.selectedIndex+delta+active.options.length)%active.options.length;active.dispatchEvent(new global.Event('change',{bubbles:true}));return true;}
      const i=nodes.indexOf(active);
      const n=i<0?0:(i+delta+nodes.length)%nodes.length;nodes[n].focus({preventScroll:true});nodes[n].scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});return true;
    }
    activate(){if(this.screen===null)return false;const active=this.document.activeElement;if(active&&this.nodes.screenLayer.contains(active)&&!active.disabled){if(active.tagName==='BUTTON')active.click();else if(active.tagName==='INPUT'){if(active.type==='checkbox'){active.checked=!active.checked;active.dispatchEvent(new global.Event('change',{bubbles:true}));}return true;}else if(active.tagName==='SELECT'){active.selectedIndex=(active.selectedIndex+1)%active.options.length;active.dispatchEvent(new global.Event('change',{bubbles:true}));return true;}}else this.nodes.playButton.click();return true;}
    back(){this.emit('back');return true;}
    award(kind,{label='',value=''}={}){
      const pool=this._awards||(this._awards=Array.from(this.nodes.hudAwards?.children||[]).map(node=>({node,use:node.querySelector('use'),label:node.querySelector('.award-label'),value:node.querySelector('.award-value'),left:0})));
      if(!pool.length)return;
      let slot=pool[0];for(const candidate of pool)if(candidate.left<slot.left)slot=candidate;
      const key=AWARDS[kind]?kind:'perfect';this._awardFlip=!this._awardFlip;this._awardOrder=(this._awardOrder||0)-1;
      slot.use.setAttribute('href','#'+AWARDS[key]);slot.label.textContent=String(label??'');slot.value.textContent=String(value??'');
      slot.node.style.order=this._awardOrder;slot.node.className=`award-slab award-${key} show ${this._awardFlip?'a':'b'}`;slot.left=1.45;
    }
    tick(dt){
      dt=clamp(dt,0,.25);
      if(this._awards)for(const slot of this._awards)if(slot.left>0){slot.left-=dt;if(slot.left<=0){slot.left=0;slot.node.className='award-slab';}}
      const count=this._count;if(!count||this.screen!=='results')return;
      count.time+=dt;const k=Math.min(1,count.time/count.duration),eased=1-(1-k)*(1-k);
      for(let i=0;i<count.nodes.length;i++){const text=scoreText(count.targets[i]*eased);if(count.nodes[i].textContent!==text)count.nodes[i].textContent=text;}
      count.tickClock-=dt;if(k<1&&count.tickClock<=0){count.tickClock=.05;this.emit('sfx','tick');}
      if(k>=1){this._count=null;this.emit('sfx','stamp');}
    }
    clearFeedback(){
      if(this._awards)for(const slot of this._awards){slot.left=0;slot.node.className='award-slab';}
      if(this._toastTimer)global.clearTimeout(this._toastTimer);if(this._bannerTimer)global.clearTimeout(this._bannerTimer);if(this._cueTimer)global.clearTimeout(this._cueTimer);this._toastTimer=null;this._bannerTimer=null;this._cueTimer=null;this._hidden('hudCue',true);this._text('cueValue','');this._text('cueLabel','');this.nodes.hudCue.className='hud-cue';this._text('hudToast','');this._text('hudBanner','');this.nodes.hudToast.className='hud-toast';this.nodes.hudBanner.className='hud-banner';
    }
    cue(kind,{value,seconds=1.05}={}){
      const key=CUES[kind]?kind:'error',label=CUES[key];
      if(this._cueTimer)global.clearTimeout(this._cueTimer);
      this._cueReplay=!this._cueReplay;this.nodes.hudCue.className=`hud-cue cue-${key} visible replay-${this._cueReplay?'a':'b'}`;
      this._attr('cueGlyph','href',`#cue-${key}`);this._text('cueValue',value===undefined?'':value);this._text('cueLabel',label);this._attr('hudCue','aria-label',value===undefined?label:`${label} ${value}`);this._hidden('hudCue',false);
      this._cueTimer=global.setTimeout(()=>{this._hidden('hudCue',true);this.nodes.hudCue.className='hud-cue';this._cueTimer=null;},clamp(seconds,.12,6)*1000);
    }
    toast(text,seconds=2,style=''){
      if(this._toastTimer)global.clearTimeout(this._toastTimer);this._text('hudToast',text);this.nodes.hudToast.className=`hud-toast visible${style==='warn'?' warn':''}`;
      this._toastTimer=global.setTimeout(()=>{this.nodes.hudToast.className='hud-toast';this._toastTimer=null;},Math.max(.1,seconds)*1000);
    }
    banner(text,style='trick',seconds=1.6){
      if(this._bannerTimer)global.clearTimeout(this._bannerTimer);this._text('hudBanner',text);this.nodes.hudBanner.className=`hud-banner visible${style==='big'?' big':''}`;
      this._bannerTimer=global.setTimeout(()=>{this.nodes.hudBanner.className='hud-banner';this._bannerTimer=null;},Math.max(.1,seconds)*1000);
    }
    setRecoverVisible(value){this._hidden('recoverButton',!value);}
    setFps(stats){
      this._hidden('fpsPanel',!stats);if(!stats)return;
      this._text('fpsPanel',`${Math.round(stats.fps||0)} FPS · ${Math.round(stats.refreshHz||0)} HZ\nCPU ${Number(stats.cpuMs||0).toFixed(2)} MS · ${stats.drawOps||0} DRAWS\n${stats.quality||''} · ${Number(stats.renderScale||1).toFixed(2)}×`);
    }
    setTouchMode(value){this._touch=!!value;this.app.classList.toggle('touch-mode',this._touch);this._measure();}
    _measure(){const short=(global.innerHeight||800)<=520;this._metrics={safeTop:this._touch?(short?140:180):148,safeBottom:this._touch?(short?170:275):115};}
    metrics(){return this._metrics;}
  }
  global.IronUI=IronUI;
})(globalThis);
