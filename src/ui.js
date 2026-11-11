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
 * Pictogram pass: the HUD and menus speak in icons, colour and motion; words stay in aria labels.
 * HUD extras: par (seconds; drains the clock star's ring), goal (bool: challenge currently met), goalId.
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
  // Pictogram maps: the player cannot read yet, so every message is an icon, a colour or a motion. Words stay in aria labels.
  const AWARDS=Object.freeze({perfect:'cue-star',flip:'cue-trick',air:'cue-air',smash:'ic-crate',chain:'ic-zombie',slam:'cue-burst',nitro:'cue-bolt',giant:'ic-giant',checkpoint:'ic-flag',wreck:'cue-error',start:'cue-bolt'});
  const SIGNS=Object.freeze({finish:'ic-flag',boss:'ic-trophy',fuel:'ic-can',giant:'ic-giant',rival:'ic-rival',ignite:'cue-bolt'});
  const GOALS=Object.freeze({'all-zombies':['ic-zombie',''],'all-cans':['ic-can',''],'clean-run':['ic-norecover',''],'no-recovery':['ic-norecover',''],'fuel-60':['ic-can','60%'],'fuel-35':['ic-can','35%'],'land-a-flip':['cue-trick',''],'two-perfect':['cue-star','×2'],'big-air':['cue-air','1.6s'],'boss-gap':['ic-rival','15m']});
  const ROWS=Object.freeze({'Zombies & combos':'ic-zombie','Landed flips':'cue-trick','Perfect landings':'cue-star','Big air':'cue-air','Monster stopped':'ic-giant','Fuel cans':'ic-can','Checkpoints':'cue-checkpoint','Rival impacts':'ic-rival','Roadside smashes':'ic-crate','Nitro slams':'cue-burst','Stage finish':'ic-flag','Fuel bonus':'ic-can','Pace bonus':'ic-clock','Nitro burn':'cue-bolt'});
  const STATS=Object.freeze({topSpeed:'ic-gauge',maxAir:'cue-air',chain:'ic-zombie',smashes:'ic-crate',slams:'cue-burst',nitro:'cue-bolt'});
  // A tiny picture of each route, drawn from its biome palette, so tracks are recognised by sight rather than by name.
  const RIDGES=Object.freeze({spires:'M0 60L12 34 18 52 30 22 40 50 52 30 62 54 76 26 88 52 100 36 112 56 126 28 138 52 150 34 160 50V90H0Z',mesa:'M0 58H14L18 40H52L56 56H84L88 34H128L132 54H160V90H0Z',peaks:'M0 62L26 30 46 54 70 24 96 56 120 32 144 56 160 44V90H0Z',dunes:'M0 60Q30 40 60 56T120 52T160 50V90H0Z',ruins:'M0 60H10V44H22V36H30V50H52V40H60V58H96V38H104V30H112V46H124V58H160V90H0Z',industrial:'M0 60H12V30H20V60H40V46H70V60H90V24H98V60H120V42H150V60H160V90H0Z'});
  const scene=(biome,id)=>{
    const b=biome||{},sky=b.sky||['#2b2530','#4a3a48','#7a5a62'],r=b.ridges||[],far=r[0]||{style:'peaks',color:'#5d5964'},near=r[2]||r[1]||{style:'dunes',color:'#3a3840'},g=b.ground||{},sun=b.sun||{kind:'sun',color:'#ffe6a4',x:.75,y:.25};
    const sx=Math.round((sun.x??.75)*160),sy=Math.round((sun.y??.25)*90)+6;
    return `<svg class="scene" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="sky-${id}" x2="0" y2="1"><stop stop-color="${esc(sky[0])}"/><stop offset=".6" stop-color="${esc(sky[1])}"/><stop offset="1" stop-color="${esc(sky[2]||sky[1])}"/></linearGradient></defs><g stroke="none"><rect width="160" height="90" fill="url(#sky-${id})"/><circle cx="${sx}" cy="${sy}" r="9" fill="${esc(sun.color||'#ffe6a4')}"/>${sun.kind==='moon'?`<circle cx="${sx+4}" cy="${sy-3}" r="8" fill="${esc(sky[0])}"/>`:''}<path d="${RIDGES[far.style]||RIDGES.peaks}" fill="${esc(far.color)}"/><path d="${RIDGES[near.style]||RIDGES.dunes}" fill="${esc(near.color)}" transform="translate(160 14) scale(-1 1)"/><path d="M0 76Q40 68 80 74T160 72V90H0Z" fill="${esc(g.body||'#2a2730')}"/></g><path d="M0 76Q40 68 80 74T160 72" fill="none" stroke="${esc(g.top||'#6b6670')}" stroke-width="3"/></svg>`;
  };
  const use=(id,cls='')=>`<svg${cls?` class="${cls}"`:''} viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"/></svg>`;
  const cap=text=>`<kbd class="keycap">${text}</kbd>`;
  const TROPHY='<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M19 8h26v17c0 12-7 18-13 18s-13-6-13-18V8Z" fill="#f5cb65" stroke="#fff0b5" stroke-width="2"/><path d="M19 13H8v9c0 10 10 13 15 12M45 13h11v9c0 10-10 13-15 12M32 43v11M20 57h24" fill="none" stroke="#f5cb65" stroke-width="5" stroke-linecap="round"/><path d="m32 17 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill="#a52a39"/></svg>';
  const CUES=Object.freeze({drive:'Hold to drive',tilt:'Tilt to level the truck',target:'Target locked',shot:'Shot fired',hit:'Monster cleared',miss:'Shot missed',fuel:'Fuel',checkpoint:'Checkpoint',recover:'Recovered',trick:'Trick',success:'Success',error:'Unavailable',upgrade:'Upgrade installed'});
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
      this.events=new Map();this.values=Object.create(null);this.nodes=Object.create(null);this.screen=null;this.data={};this._touch=false;this._inputMode='keyboard';
      this.save=global.IronRules?.Save.defaults()||{unlocked:1,completed:[],best:{},stars:{},scrap:0,upgrades:{},settings:{}};
      this.stages=[];this.biomes=[];this.rulesInfo={};this._metrics={safeTop:148,safeBottom:115};this._primary={name:'play',args:[]};
      for(const element of this.app.querySelectorAll('[id]'))this.nodes[element.id]=element;
      this._controlKeys={fire:this.nodes.fireButton.querySelector('.keycap'),recover:this.nodes.recoverButton.querySelector('.keycap')};
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
    _bar(id,value){const n=Math.round(clamp(value,0,1)*1000)/1000,key=`bar:${id}`;if(this.values[key]!==n){this.values[key]=n;if(this.nodes[id])this.nodes[id].style.transform=`scaleX(${n})`;}}
    _marker(id,value){this._hidden(id,value===null||value===undefined||!Number.isFinite(Number(value)));if(value==null)return;const n=Math.round(clamp(value,0,1)*1000)/10,key=`marker:${id}`;if(this.values[key]!==n){this.values[key]=n;this.nodes[id].style.transform=`translateX(${n}%)`;}}
    _rot(id,degrees){const n=Math.round(degrees/2)*2,key=`rot:${id}`;if(this.values[key]!==n){this.values[key]=n;if(this.nodes[id])this.nodes[id].style.transform=`rotate(${n}deg)`;}}
    _updateHUD(v){
      if(v.stageIndex!==undefined)this._text('hudStageNumber',`Stage ${Number(v.stageIndex)+1} of 10`);
      if(v.stageName!==undefined)this._text('hudStageName',v.stageName);
      if(v.progress!==undefined){this._bar('hudProgressFill',v.progress);this._marker('hudTruckMarker',v.progress);}
      if(v.distance!==undefined||v.length!==undefined)this._text('hudDistance',`${Math.floor(Math.max(0,Number(v.distance)||0)/10)*10} of ${Math.floor(Number(v.length)||0)} metres`);
      if(v.time!==undefined){
        this._text('hudTime',timeText(Math.floor(Number(v.time)||0)));
        // The clock star wears its par time as a ring that drains; once it is empty the star goes grey.
        if(v.par!==undefined){const par=Number(v.par)||0,elapsed=Math.max(0,Number(v.time)||0),left=par>0?clamp(1-elapsed/par,0,1):0,within=par>0&&elapsed<=par,step=Math.round((1-left)*100);if(this.values.ring!==step){this.values.ring=step;if(this.nodes.hudClockRing)this.nodes.hudClockRing.style.strokeDashoffset=step;}this._class('hudClock','lost',!within);this._class('hudClock','hurry',within&&left<.25);this._attr('hudClock','aria-label',`Beat the clock: finish in ${par} seconds. ${Math.floor(elapsed)} seconds elapsed. ${within?'Within par.':'Par exceeded.'}`);}
      }
      if(v.goal!==undefined)this._class('hudGoal','on',v.goal);
      if(v.goalId!==undefined&&v.goalId!==this._goalId){this._goalId=v.goalId;const goal=GOALS[v.goalId]||GOALS['all-zombies'];this._attr('hudGoalGlyph','href','#'+goal[0]);this._text('hudGoalTarget',goal[1]);const mark=v.goalId==='fuel-60'?60:v.goalId==='fuel-35'?35:0;this._hidden('fuelGoalMark',!mark);if(mark&&this.nodes.fuelGoalMark)this.nodes.fuelGoalMark.style.left=mark+'%';this._goalLabel=(this.rulesInfo.CHALLENGES||global.IronRules?.CHALLENGES||[]).find(rule=>rule.id===v.goalId)?.label||'Complete the stage objective';}
      // The challenge star fills its ring as the goal gets closer, the mirror of the draining clock ring.
      if(v.goalProgress!==undefined){const step=100-Math.round(clamp(v.goalProgress,0,1)*100);if(this.values.goalRing!==step){this.values.goalRing=step;if(this.nodes.hudGoalRing)this.nodes.hudGoalRing.style.strokeDashoffset=step;}}
      if(v.goal!==undefined||v.goalId!==undefined)this._attr('hudGoal','aria-label',`${this._goalLabel||'Stage challenge'}. ${this.values['class:hudGoal:on']?'Currently met.':'Not yet met.'}`);
      if(v.score!==undefined)this._text('hudScore',scoreText(v.score));
      if(v.ghostDelta!==undefined){const active=v.ghostDelta!==null&&Number.isFinite(Number(v.ghostDelta));this._hidden('hudGhost',!active);if(active){if(v.ghostDelta>.08)this._ghostBehind=true;else if(v.ghostDelta<-.08)this._ghostBehind=false;this._class('hudGhost','behind',!!this._ghostBehind);this._text('hudGhostText',this._ghostBehind?'Behind your ghost':'Ahead of your ghost');}}
      if(v.fuel!==undefined){const fuel=clamp(v.fuel,0,100);this._text('fuelValue',`${Math.ceil(fuel)}%`);this._bar('fuelFill',fuel/100);this._attr('fuelMeter','aria-valuenow',Math.ceil(fuel));this._class('fuelHud','mid',fuel<50&&fuel>=23);this._class('fuelHud','low',fuel<23);this._class('fuelHud','critical',fuel<12);}
      if(v.cleared!==undefined||v.totalZombies!==undefined){this._text('zombieValue',`${v.cleared||0} / ${v.totalZombies||0}`);this._bar('zombieFill',v.totalZombies?(v.cleared||0)/v.totalZombies:0);}
      if(v.speed!==undefined){const kmh=Math.abs(v.speed)*3.6;this._text('speedValue',String(Math.round(kmh)).padStart(2,'0'));this._rot('speedNeedle',-90+clamp(kmh/130,0,1)*180);}
      if(v.gear!==undefined)this._text('gearValue',v.gear);
      if(v.ammo!==undefined){this._text('ammoValue',`${v.ammo} / 1`);const disabled=!v.ammo;const key='disabled:fire';if(this.values[key]!==disabled){this.values[key]=disabled;this.nodes.fireButton.disabled=disabled;}this._class('weaponHud','spent',!v.ammo);this._attr('ammoPip','aria-label',v.ammo?'One charge ready':'No charges');this._attr('fireButton','aria-label',v.ammo?'Fire cannon, one charge available':'Cannon empty');}
      if(v.locked!==undefined)this._class('weaponHud','locked',v.locked);
      if(v.shootingPhase!==undefined)this._attr('weaponHud','data-phase',v.shootingPhase);
      if(v.monsterAlive!==undefined)this._class('weaponHud','cleared',!v.monsterAlive);
      if(v.monsterAlive!==undefined||v.ammo!==undefined||v.locked!==undefined){const alive=v.monsterAlive!==false;this._text('weaponStatus',!alive?'MONSTER CLEARED':v.ammo===0?'CHARGE SPENT':v.locked?'TARGET LOCKED · FIRE':'SAVE YOUR ONE SHOT');}
      if(v.monsterDistance!==undefined||v.monsterAlive!==undefined){this._text('monsterDistance',v.monsterAlive===false?'✓':`${Math.ceil(Math.max(0,Number(v.monsterDistance)||0))} m`);this._monsterAlive=v.monsterAlive!==false;this._monsterDistance=Number(v.monsterDistance);this._bar('monsterNear',this._monsterAlive?clamp(1-(Number(v.monsterDistance)||0)/150,0,1):0);}
      if(v.monsterDistance!==undefined||v.monsterAlive!==undefined||v.locked!==undefined)this._class('weaponHud','warning',this._monsterAlive!==false&&this._monsterDistance<70&&!this.values['class:weaponHud:locked']);
      if(v.monsterProgress!==undefined)this._marker('hudMonsterMarker',v.monsterAlive===false?null:v.monsterProgress);
      if(v.rivalProgress!==undefined)this._marker('hudRivalMarker',v.rivalProgress);
      if(v.status!==undefined)this._text('hudStageStatus',v.status);else if(v.racePosition!==undefined)this._text('hudStageStatus',v.rivalProgress==null?'':`Position ${v.racePosition} of 2`);
      if(v.combo!==undefined){this._hidden('hudCombo',v.combo<2);this._text('hudComboValue',`×${v.combo||1}`);}
      if(v.comboLeft!==undefined)this._bar('hudComboFill',v.comboLeft/(v.comboMax||3));
      if(v.checkpointProgress){const signature=v.checkpointProgress.join(',');if(this.values.checkpoints!==signature){this.values.checkpoints=signature;this.nodes.hudCheckpointTicks.replaceChildren();for(const progress of v.checkpointProgress){const tick=this.document.createElement('i');tick.className='hud-checkpoint';tick.style.left=`${clamp(progress,0,1)*100}%`;this.nodes.hudCheckpointTicks.appendChild(tick);}}}
      if(v.nitro!==undefined){const nitro=clamp(v.nitro,0,100);this._bar('nitroFill',nitro/100);this._class('nitroHud','full',nitro>=99.5);this._class('nitroHud','empty',nitro<8);this._attr('nitroHud','aria-valuenow',Math.round(nitro));}
      if(v.boosting!==undefined)this._class('nitroHud','burning',v.boosting);
      if(v.nitroReady!==undefined)this._class('nitroHud','ready',v.nitroReady);
      if(v.nitroHint!==undefined)this._text('nitroHint',v.nitroHint);
      if(v.gap!==undefined){const active=v.gap!==null&&Number.isFinite(Number(v.gap));this._hidden('hudGap',!active);if(active){const gap=Math.round(Number(v.gap));this._text('hudGapText',`${Math.abs(gap)} metres ${gap>=0?'ahead of':'behind'} Iron Maw`);this._class('hudGap','behind',gap<0);}}
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
    _button(label,event,iconId,extra=''){return `<button type="button" class="menu-button" data-ui="${esc(event)}" aria-label="${esc(label)}" title="${esc(label)}" ${extra}>${use(iconId||'ic-play')}</button>`;}
    _stageName(i){return this.stages[i]?.name||`Stage ${i+1}`;}
    _controlKey(action){const pad=this._inputMode==='gamepad',keys=pad?{drive:'RT',balance:'LS',nitro:'RB',fire:'A',recover:'X'}:{drive:'↑',balance:'← →',nitro:'Z',fire:'X',recover:'C'};return this._inputMode==='touch'?use('ic-touch','touch-hint'):cap(keys[action]);}
    _onboarding(){
      const mode=this._inputMode,labels=mode==='touch'?['Hold the play pedal to drive','Hold the curved arrow pedals to balance','Hold the lightning pedal for nitro','Wait for the green crosshair, then tap the target button','Tap the recovery arrow for 12 fuel']:mode==='gamepad'?['Hold RT to drive','Move the left stick to balance','Hold RB for nitro','Wait for the green crosshair, then press A to fire','Press X to recover for 12 fuel']:['Drive with Up or W','Balance with Left and Right','Hold Z or N for nitro','Wait for the green crosshair, then fire with X or J','Recover with C for 12 fuel'];
      return `<div class="onboarding" aria-label="Controls" data-input-mode="${mode}">${[['drive',mode==='touch'?'ic-play':'ic-truck'],['balance','cue-trick'],['nitro','cue-bolt'],['fire','cue-target'],['recover','cue-recover']].map(([action,glyph],n)=>`<span role="img" data-control="${action}" aria-label="${labels[n]}">${this._controlKey(action)}${use(glyph,action==='drive'||action==='nitro'?'fill':'')}</span>`).join('')}</div>`;
    }
    showScreen(name,data={}){
      this.screen=name;this.data=data||{};
      if(name===null){this.nodes.screenLayer.hidden=true;this.nodes.screenLayer.setAttribute('aria-hidden','true');this.nodes.gameCanvas.focus({preventScroll:true});return;}
      this.hud.setVisible(false);this.setRecoverVisible(false);this.nodes.screenLayer.hidden=false;this.nodes.screenLayer.removeAttribute('aria-hidden');
      const d=this.data,i=clamp(d.stageIndex??this.save.selected??0,0,9),stage=this.stages[i]||{};
      this.nodes.menuPanel.className=`menu-panel screen-${name}`;this.nodes.screenLayer.className=`screen-layer screen-${name}`;
      this.nodes.menuCrumb.textContent='';
      const challengeId=(this.rulesInfo.CHALLENGES||global.IronRules?.CHALLENGES||[])[i]?.id,goal=GOALS[challengeId]||GOALS['all-zombies'],level=challengeId==='fuel-60'?60:challengeId==='fuel-35'?35:0,goalPic=level?`${use('ic-can')}<i class="mini-bar" style="--mark:${level}%"><i style="width:${level}%"></i><b>★</b></i>`:challengeId==='two-perfect'?use('cue-star','fill')+use('cue-star','fill'):challengeId==='boss-gap'?use('ic-rival','behind')+use('cue-shot','gap')+use('ic-truck','fill'):use(goal[0]);
      let html='',primary='Continue',primaryIcon='ic-play',primaryWord='',action='back',args=[],secondary='';
      if(name==='title'){
        html=`${HERO_WEB}<div class="ojas-title-copy"><p class="menu-eyebrow hero-dedication">Made for Ojas Kulkarni, with love.</p><h1 id="screenHeading" class="attract-title ojas-title">OJAS’S<span>MONSTER<br>RALLY.</span></h1></div><div class="hero-showcase">${heroTruck()}</div>`;
        primary=this.save.completed?.length?'Let’s race again, Ojas!':'Let’s race, Ojas!';primaryWord='GO';action='play';secondary=this._button('Tracks','stages','ic-grid')+this._button('Garage','garage','ic-wrench')+this._button('Settings','settings','ic-gear');
      }else if(name==='dedication'){
        html=`<div class="dedication-card"><div class="dedication-emblem">${HERO_SPIDER}</div><p class="menu-eyebrow">A GAME MADE JUST FOR YOU</p><h1 id="screenHeading" class="menu-title">For Ojas Kulkarni.</h1><p class="dedication-message">Big dreams. Brave heart.<br>Monster adventures.</p><p class="dedication-love">Keep exploring, little hero.<br>Made for you, with love. <span aria-hidden="true">♥</span></p><div class="dedication-truck">${heroTruck()}</div></div>`;
        primary='Let’s go, Ojas!';primaryWord='GO';action='back';secondary='';
      }else if(name==='stages'){
        const earned=Object.values(this.save.stars||{}).reduce((sum,v)=>sum+(Array.isArray(v)?v.filter(Boolean).length:0),0);
        html=`<h1 id="screenHeading" class="sr-only">Choose a track. ${this.save.completed?.length||0} of 10 routes cleared.</h1><div class="campaign-summary"><span class="sum-chip" role="img" aria-label="${earned} of 30 stars">${use('cue-star')}<b>${earned}</b></span><span class="sum-chip scrap" role="img" aria-label="${scoreText(this.save.scrap)} scrap">◆ <b>${scoreText(this.save.scrap)}</b></span></div><div class="stage-grid">`;
        for(let n=0;n<10;n++){
          const locked=n>=(this.save.unlocked||1),stars=this.save.stars?.[n]||[false,false,false],biome=this.biomes[n]||{};
          html+=`<button type="button" class="stage-card${locked?' locked':''}${n===(this.save.selected||0)?' current':''}" style="--card-accent:${esc(biome.accent||'#ff5a68')}" data-ui="selectStage" data-stage="${n}" aria-label="Stage ${n+1}: ${esc(this._stageName(n))}${locked?', locked':''}${this.save.best?.[n]?', best time '+timeText(this.save.best[n]):''}" ${locked?'disabled':''}>${scene(biome,'s'+n)}${locked?use('ic-lock','stage-pic'):n===9?use('ic-rival','stage-pic'):''}<b class="stage-num">${n+1}</b><span class="stage-stars" aria-label="${stars.filter(Boolean).length} of 3 stars">${this._stars(stars)}</span><span class="stage-name">${esc(this._stageName(n))}</span></button>`;
        }
        html+='</div>';primary='Continue selected route';action='selectStage';args=[this.save.selected||0];secondary=this._button('Garage','garage','ic-wrench')+this._button('Title','title','ic-home');
      }else if(name==='garage'){
        html=`<h1 id="screenHeading" class="sr-only">Build your super truck. Upgrades apply to your next run.</h1><div class="campaign-summary"><span class="sum-chip scrap" role="img" aria-label="${scoreText(this.save.scrap)} scrap available">◆ <b>${scoreText(this.save.scrap)}</b></span></div><div class="garage-grid">`;
        for(const track of ['engine','tyres','suspension','tank']){
          const info=global.IronRules.upgradeInfo(track,this.save.upgrades?.[track]||0,this.rulesInfo.upgrades||this.rulesInfo.UPGRADES);
          const max=info.level>=3,canBuy=!max&&this.save.scrap>=info.cost;
          html+=`<article class="upgrade-card" title="${esc(info.label)}: ${esc(info.description)}"><div class="upgrade-icon">${icon(info.icon)}</div><h2 class="sr-only">${esc(info.label)}. ${esc(info.description)} Now ${esc(info.current)}.${max?'':` Next ${esc(info.next)}.`}</h2><div class="upgrade-levels" role="img" aria-label="Level ${info.level} of 3">${[0,1,2].map(n=>`<i${n<info.level?' class="filled"':''}></i>`).join('')}</div><button class="buy-button" data-ui="buy" data-track="${track}" ${canBuy?'':'disabled'} aria-label="${max?`${esc(info.label)} fully upgraded`:`Upgrade ${esc(info.label)} for ${info.cost} scrap`}">${max?use('cue-hit'):`${use('cue-upgrade')}<span>◆ ${info.cost}</span>`}</button></article>`;
        }
        html+='</div>';primary='Back to the rally';primaryIcon='cue-hit';action='back';secondary=this._button('Stage select','stages','ic-grid')+this._button('Settings','settings','ic-gear');
      }else if(name==='settings'){
        const settings=this.save.settings||{};
        html=`<h1 id="screenHeading" class="menu-title settings-title">${use('ic-gear')}Settings</h1><div class="settings-grid">`;
        const ranges=[['master','Master volume','Volume','ic-speaker',.9],['music','Music volume','Music','ic-note',.55],['sfx','Engine & effects','Effects','cue-burst',.9]];
        for(const [key,label,word,glyph,def]of ranges){const value=Math.round(clamp(settings[key]??def,0,1)*100);html+=`<div class="setting-item" title="${label}"><label for="setting-${key}">${use(glyph,'set-ic')}<span class="set-word">${word}</span><output id="setting-value-${key}">${value}%</output></label><input id="setting-${key}" type="range" min="0" max="100" step="1" value="${value}" data-setting="${key}" aria-label="${label}"></div>`;}
        html+=`<div class="setting-item" title="Auto adjusts resolution and effects to keep motion smooth."><label for="setting-quality">${use('ic-spark','set-ic')}<span class="set-word">Graphics</span><select id="setting-quality" data-setting="quality" aria-label="Graphics quality">${[['auto','Auto'],['high','High'],['balanced','Balanced'],['performance','Fast']].map(([value,label])=>`<option value="${value}" ${settings.quality===value?'selected':''}>${label}</option>`).join('')}</select></label></div>`;
        for(const [key,label,word,glyph,help]of [['shake','Camera shake','Shake','ic-shake','Physical impacts with a little extra punch.'],['showFps','Performance display','FPS','ic-gauge','Show FPS, CPU time and rendering detail.'],['reducedMotion','Reduced motion','Calm','ic-calm','Quiet menu animation and camera effects.'],['haptics','Controller vibration','Rumble','ic-rumble','Rumble on landings, hits and nitro.'],['autoNitro','Auto nitro','Auto','cue-bolt','Burns a healthy nitro meter for you on the ground.']])html+=`<div class="setting-item" title="${label}. ${help}"><label for="setting-${key}">${use(glyph,'set-ic')}<span class="set-word">${word}</span><input id="setting-${key}" type="checkbox" data-setting="${key}" aria-label="${label}" ${(settings[key]??(key==='haptics'))?'checked':''}></label></div>`;
        html+='<div class="setting-item sound-check"><button type="button" class="secondary-button sound-test" data-ui="testSound" aria-label="Test sound"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM17 8q4 4 0 8M20 5q7 7 0 14"/></svg></button><div class="sound-test-feedback"><div id="soundTestMeter" class="sound-meter" role="meter" aria-label="Audio output level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="soundTestLevel"></i></div><output id="soundTestStatus" role="status">Tap to enable sound</output></div></div>';
        html+='</div>';primary='Save & return';primaryIcon='cue-hit';action='back';secondary=this._button('Stage select','stages','ic-grid')+this._button('Title','title','ic-home');
      }else if(name==='brief'){
        const par=d.par??this._par(i),challenge=typeof d.challenge==='string'?d.challenge:d.challenge?.label||this._challenge(i),best=d.best??this.save.best?.[i],have=this.save.stars?.[i]||[false,false,false],accent=this.biomes[i]?.accent||'#ff5a68';
        const goals=[[use('ic-flag'),'Finish the stage'],[`${use('ic-clock')}<b>${Math.round(par)}</b>`,`Beat the clock: ${timeText(par)} or faster`],[goalPic,`Challenge: ${challenge}`]];
        html=`<div class="brief-kid" style="--card-accent:${esc(accent)}"><div class="brief-hero">${scene(this.biomes[i],'b'+i)}<div class="brief-top"><div class="brief-badge" aria-hidden="true">${i+1}${i===9?use('ic-rival'):''}</div><h1 id="screenHeading" class="brief-name"><span class="sr-only">Stage ${i+1} of 10${i===9?', final boss':''}: </span>${esc(d.name||stage.name||this._stageName(i))}<span class="sr-only">. ${esc(d.description||stage.subtitle||'')} ${d.length||stage.length||0} metres. ${best?'Best time '+timeText(best)+'.':''}</span></h1></div></div><div class="goal-row">${goals.map((g,k)=>`<div class="goal-card${have[k]?' earned':''}" role="img" aria-label="${esc(g[1])}${have[k]?' (earned)':''}"><span class="big-star" aria-hidden="true">★</span><span class="goal-pic">${g[0]}</span></div>`).join('')}</div>${this._onboarding()}</div>`;
        primary=i===9?'Challenge Iron Maw':'Start this run';primaryWord='GO';action='play';secondary=this._button('Stage select','stages','ic-grid')+this._button('Garage','garage','ic-wrench');
      }else if(name==='pause'){
        html=`<div class="pause-kid"><h1 id="screenHeading" class="sr-only">Paused. ${esc(d.stageName||this._stageName(this.save.selected||0))}, ${timeText(d.time||0)}, fuel ${Math.ceil(d.fuel??100)}%.</h1><div class="pause-pic">${use('ic-pause')}</div></div>`;
        primary='Back to the trail';action='resume';secondary=this._button('Retry stage','retry','cue-recover')+this._button('Settings','settings','ic-gear')+this._button('Stage select','stages','ic-grid');
      }else if(name==='results'){
        const stars=d.stars||[true,false,false],par=d.par??this._par(i),challenge=typeof d.challenge==='string'?d.challenge:d.challenge?.label||this._challenge(i);
        const pics=[use('ic-flag'),`${d.newBest?use('ic-crown','crown'):''}${use('ic-clock')}<b>${Number(d.time||0).toFixed(1)}</b>`,goalPic],says=['Finished',`Your time ${timeText(d.time||0)}, par ${timeText(par)}${d.newBest?', new best time':''}`,challenge];
        html=`<div class="result-kid"><div class="hero-trophy" aria-label="Ojas’s trophy">${TROPHY}</div><h1 id="screenHeading" class="sr-only">${i===9?'Ojas, king of the trail!':'Super driving, Ojas!'} ${esc(d.name||this._stageName(i))} cleared.</h1><div class="result-stars" aria-label="${stars.filter(Boolean).length} of 3 stars">${stars.map((on,k)=>`<span class="rstar${on?' earned':''}" style="--star-delay:${k*180}ms" role="img" aria-label="${esc(says[k])}: ${on?'star earned':'no star'}"><span class="big-star" aria-hidden="true">★</span><span class="rstar-pic">${use(on?'cue-hit':'cue-miss',on?'rmark yes':'rmark no')}${pics[k]}</span></span>`).join('')}</div><div class="result-line"><div class="result-big-score" aria-label="Total score${d.newScoreBest?', new best score':''}">${d.newScoreBest?use('ic-crown','crown'):''}<span data-count="${Math.max(0,Math.floor(Number(d.score)||0))}">${scoreText(d.score)}</span></div><span class="sum-chip scrap" role="img" aria-label="Scrap earned ${scoreText(d.scrap)}">◆ <b>+${scoreText(d.scrap)}</b></span></div>${Array.isArray(d.awards)&&d.awards.length?`<div class="result-awards">${d.awards.slice(0,6).map(a=>`<span class="result-award" title="${esc(a.label)}">${use(STATS[a.id]||'cue-star')}<span class="sr-only">${esc(a.label)}</span><b>${esc(String(a.value).replace(/\s*(KM\/H|S)$/,''))}</b></span>`).join('')}</div>`:''}<details class="score-breakdown"><summary aria-label="Score details">${use('ic-more')}</summary><div class="breakdown-rows">${(d.breakdown||[]).map(row=>`<span class="breakdown-row" title="${esc(row.label)}">${use(ROWS[row.label]||'cue-star')}<span class="sr-only">${esc(row.label)}</span><b data-count="${Math.max(0,Math.floor(Number(row.value)||0))}">${scoreText(row.value)}</b></span>`).join('')}</div></details></div>`;
        const next=d.nextAvailable!==false&&i<9;primary=next?`Continue to stage ${String(i+2).padStart(2,'0')}`:'Back to the stages';primaryIcon=next?'ic-next':'ic-grid';action=next?'next':'stages';secondary=this._button('Run it again','retry','cue-recover')+this._button('Garage','garage','ic-wrench')+this._button('Stage select','stages','ic-grid');
      }else if(name==='failed'){
        const reason=d.reason||'fuel',fire=this._inputMode==='touch'?'tap the target button':this._inputMode==='gamepad'?'press A':'press X or J',tips={fuel:'Collect the amber cans.',monster:`Wait for the green crosshair, then ${fire} to fire.`,rival:'Keep your speed through the jumps.'};
        const pict={fuel:['ic-can','ic-can','','<b class="fp-plus" aria-hidden="true">+</b>'],monster:['ic-giant','cue-target','',this._controlKey('fire')],rival:['ic-rival','cue-bolt',' fill',this._controlKey('nitro')]}[reason]||['ic-can','ic-can','',''];
        html=`<div class="fail-kid"><h1 id="screenHeading" class="sr-only">${reason==='fuel'?'Out of fuel.':reason==='monster'?'Monster ahead.':'Iron Maw wins.'} ${esc(d.stageName||this._stageName(this.save.selected||0))}. ${esc(tips[reason]||tips.fuel)}</h1><div class="fail-pict fail-${esc(reason)}" aria-hidden="true"><span class="fp fp-bad">${use(pict[0])}</span>${use('cue-shot','fp-arrow')}<span class="fp fp-tip${pict[2]}">${use(pict[1])}${pict[3]}</span></div><span class="sum-chip scrap" role="img" aria-label="Scrap earned ${scoreText(d.scrap)}">◆ <b>+${scoreText(d.scrap)}</b></span></div>`;
        primary='Try again, Ojas!';primaryIcon='cue-recover';action='retry';secondary=this._button('Garage','garage','ic-wrench')+this._button('Stage select','stages','ic-grid')+this._button('Title','title','ic-home');
      }else{this.showScreen('title');return;}
      this.nodes.menuBody.innerHTML=html;this.nodes.secondaryActions.innerHTML=secondary;
      const play=this.nodes.playButton;play.innerHTML=`${use(primaryIcon)}${primaryWord?`<b>${esc(primaryWord)}</b>`:''}`;play.className=`primary-button${primaryIcon.startsWith('cue-')?' line':''}`;play.setAttribute('aria-label',primary);play.title=primary;this._primary={name:action,args};
      this.nodes.menuHint.textContent='';
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
    _focusable(){return Array.from(this.nodes.screenLayer.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')).filter(node=>!node.hidden&&node.getClientRects().length);}
    _key(event){
      if(this.screen===null)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.back();return;}
      if(event.key==='Tab'){const nodes=this._focusable(),i=nodes.indexOf(this.document.activeElement);if(!nodes.length)return;const next=event.shiftKey?(i<=0?nodes.length-1:i-1):(i+1)%nodes.length;event.preventDefault();event.stopPropagation();nodes[next].focus();return;}
      if(event.target.tagName==='SUMMARY'&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopPropagation();event.target.click();return;}
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
    activate(){if(this.screen===null)return false;const active=this.document.activeElement;if(active&&this.nodes.screenLayer.contains(active)&&!active.disabled){if(active.tagName==='BUTTON'||active.tagName==='SUMMARY')active.click();else if(active.tagName==='INPUT'){if(active.type==='checkbox'){active.checked=!active.checked;active.dispatchEvent(new global.Event('change',{bubbles:true}));}return true;}else if(active.tagName==='SELECT'){active.selectedIndex=(active.selectedIndex+1)%active.options.length;active.dispatchEvent(new global.Event('change',{bubbles:true}));return true;}}else this.nodes.playButton.click();return true;}
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
      if(this._toastTimer)global.clearTimeout(this._toastTimer);if(this._bannerTimer)global.clearTimeout(this._bannerTimer);if(this._cueTimer)global.clearTimeout(this._cueTimer);this._toastTimer=null;this._bannerTimer=null;this._cueTimer=null;this._hidden('hudCue',true);this._text('cueValue','');this._text('cueLabel','');this.nodes.hudCue.className='hud-cue';this._text('hudToast','');this._text('bannerText','');this.nodes.hudToast.className='hud-toast';this.nodes.hudBanner.className='hud-banner';
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
    // banner(text,style,seconds,sign): 'countdown'/'go' show start lights, a sign name shows its pictogram; the words stay for screen readers.
    banner(text,style='trick',seconds=1.6,sign=''){
      if(this._bannerTimer)global.clearTimeout(this._bannerTimer);this._text('bannerText',text);
      const lights=style==='countdown'?` lights lights-${Math.max(1,Math.min(3,Number(text)||1))}`:style==='go'?' lights lights-go':'',glyph=SIGNS[sign];
      if(glyph)this._attr('bannerGlyph','href','#'+glyph);
      this.nodes.hudBanner.className=`hud-banner visible${style==='big'?' big':''}${lights}${glyph?` pict pict-${sign}`:''}`;
      this._bannerTimer=global.setTimeout(()=>{this.nodes.hudBanner.className='hud-banner';this._bannerTimer=null;},Math.max(.1,seconds)*1000);
    }
    // setNudge('gas',on): a wordless reminder that makes the matching control bounce until it is used.
    setNudge(name,on){const bool=!!on,key='nudge:'+name;if(this.values[key]!==bool){this.values[key]=bool;this.app.classList.toggle('nudge-'+name,bool);}}
    setRecoverVisible(value){this._hidden('recoverButton',!value);}
    setFps(stats){
      this._hidden('fpsPanel',!stats);if(!stats)return;
      this._text('fpsPanel',`${Math.round(stats.fps||0)} FPS · ${Math.round(stats.refreshHz||0)} HZ\nCPU ${Number(stats.cpuMs||0).toFixed(2)} MS · ${stats.drawOps||0} DRAWS\n${stats.quality||''} · ${Number(stats.renderScale||1).toFixed(2)}×`);
    }
    setInputMode(mode){const next=mode==='gamepad'||mode==='touch'?mode:'keyboard';if(this._inputMode===next)return;this._inputMode=next;this.app.classList.toggle('input-gamepad',next==='gamepad');this.app.classList.toggle('input-touch',next==='touch');const pad=next==='gamepad';if(this._controlKeys.fire)this._controlKeys.fire.textContent=pad?'A':'X';if(this._controlKeys.recover)this._controlKeys.recover.textContent=pad?'X':'C';this._text('nitroHint',next==='touch'?'':pad?'RB':'Z');if(this.screen==='brief'||this.screen==='failed')this.showScreen(this.screen,this.data);}
    setTouchMode(value){this._touch=!!value;this.app.classList.toggle('touch-mode',this._touch);if(this._inputMode!=='gamepad')this.setInputMode(this._touch?'touch':'keyboard');this._measure();}
    _measure(){const short=(global.innerHeight||800)<=520;this._metrics={safeTop:this._touch?(short?140:180):148,safeBottom:this._touch?(short?170:275):115};}
    metrics(){return this._metrics;}
  }
  global.IronUI=IronUI;
})(globalThis);
