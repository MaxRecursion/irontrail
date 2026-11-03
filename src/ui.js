/* IRONTRAIL v3 DOM owner. Classic script; no physics dependency.
 *
 * HUD contract (all optional; speed is signed m/s, progress values are 0..1):
 * {stageIndex,stageName,progress,distance,length,time,score,ghostDelta,fuel,
 *  cleared,totalZombies,speed,gear,rpm,ammo,locked,monsterDistance,monsterAlive,
 *  monsterProgress,rivalProgress,racePosition,combo,comboLeft,comboMax,
 *  checkpointProgress:[0..1],paused,muted,status}
 *
 * Screen data:
 * title/stages/garage/settings read setCampaign(save,stages,biomes,rulesInfo).
 * brief:{stageIndex,name,length,par,challenge,best,description}
 * pause:{stageName,time,fuel}
 * results:{stageIndex,name,time,par,score,stars:[bool3],breakdown:[{label,value}],
 *          scrap,newBest,newScoreBest,challenge,nextAvailable}
 * failed:{reason,stageName,time,score,scrap,tip}
 * showScreen(null) hides menus. Menu events are emitted; UI never starts physics.
 * clearFeedback() cancels transient toast/banner feedback on screen/run transitions.
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
  const icon = kind => {
    const paths={engine:'M4 8h3V5h8v3h4v9h-3v3H7v-3H4zM9 3h5M2 11v4M22 10v7M10 10l-2 4h4l-2 4',tyre:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v3M12 14v3M7 12h3M14 12h3M8.5 8.5l2 2M13.5 13.5l2 2M8.5 15.5l2-2M13.5 10.5l2-2',suspension:'M5 3l4 3-3 3 7 3-3 3 7 3-2 3M14 3l5 3-3 3 3 3-5 3 3 3-3 3',fuel:'M5 21V4h9v17M4 21h12M5 9h9M16 5l3 3v9c0 2 3 2 3 0v-5l-3-3'};
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[kind]||paths.engine}"/></svg>`;
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
      if(v.stageIndex!==undefined)this._text('hudStageNumber',`STAGE ${String(Number(v.stageIndex)+1).padStart(2,'0')} / 10`);
      if(v.stageName!==undefined)this._text('hudStageName',v.stageName);
      if(v.progress!==undefined)this._bar('hudProgressFill',v.progress);
      if(v.distance!==undefined||v.length!==undefined)this._text('hudDistance',`${Math.floor(Math.max(0,Number(v.distance)||0))} / ${Math.floor(Number(v.length)||0)} M`);
      if(v.time!==undefined)this._text('hudTime',timeText(v.time));
      if(v.score!==undefined)this._text('hudScore',scoreText(v.score));
      if(v.ghostDelta!==undefined){const active=v.ghostDelta!==null&&Number.isFinite(Number(v.ghostDelta));this._hidden('hudGhost',!active);if(active){this._text('hudGhost',`${v.ghostDelta<=0?'−':'+'}${Math.abs(v.ghostDelta).toFixed(2)}s · GHOST`);this._class('hudGhost','ahead',v.ghostDelta<=0);this._class('hudGhost','behind',v.ghostDelta>0);}}
      if(v.fuel!==undefined){const fuel=clamp(v.fuel,0,100);this._text('fuelValue',`${Math.ceil(fuel)}%`);this._bar('fuelFill',fuel/100);this._attr('fuelMeter','aria-valuenow',Math.ceil(fuel));this._class('fuelHud','low',fuel<23);this._class('fuelHud','critical',fuel<12);}
      if(v.cleared!==undefined||v.totalZombies!==undefined)this._text('zombieValue',`${v.cleared||0} / ${v.totalZombies||0}`);
      if(v.speed!==undefined)this._text('speedValue',String(Math.round(Math.abs(v.speed)*3.6)).padStart(2,'0'));
      if(v.gear!==undefined)this._text('gearValue',v.gear);
      if(v.rpm!==undefined)this._bar('hudRpmFill',v.rpm/5200);
      if(v.ammo!==undefined){this._text('ammoValue',`${v.ammo} / 1`);const disabled=!v.ammo;const key='disabled:fire';if(this.values[key]!==disabled){this.values[key]=disabled;this.nodes.fireButton.disabled=disabled;}this._class('weaponHud','spent',!v.ammo);this._attr('fireButton','aria-label',v.ammo?'Fire cannon, one charge available':'Cannon empty');}
      if(v.locked!==undefined)this._class('weaponHud','locked',v.locked);
      if(v.monsterAlive!==undefined||v.ammo!==undefined||v.locked!==undefined){const alive=v.monsterAlive!==false;this._text('weaponStatus',!alive?'MONSTER CLEARED':v.ammo===0?'CHARGE SPENT':v.locked?'TARGET LOCKED · FIRE':'SAVE YOUR ONE SHOT');}
      if(v.monsterDistance!==undefined||v.monsterAlive!==undefined){this._text('monsterDistance',v.monsterAlive===false?'PATH OPEN':`${Math.ceil(Math.max(0,Number(v.monsterDistance)||0))} M TO GIANT`);this._monsterAlive=v.monsterAlive!==false;this._monsterDistance=Number(v.monsterDistance);}
      if(v.monsterDistance!==undefined||v.monsterAlive!==undefined||v.locked!==undefined)this._class('weaponHud','warning',this._monsterAlive!==false&&this._monsterDistance<70&&!this.values['class:weaponHud:locked']);
      if(v.monsterProgress!==undefined)this._marker('hudMonsterMarker',v.monsterAlive===false?null:v.monsterProgress);
      if(v.rivalProgress!==undefined)this._marker('hudRivalMarker',v.rivalProgress);
      if(v.status!==undefined)this._text('hudStageStatus',v.status);else if(v.racePosition!==undefined)this._text('hudStageStatus',v.rivalProgress==null?'ONE SHOT. ONE GIANT.':`RACE ${v.racePosition} / 2`);
      if(v.combo!==undefined){this._hidden('hudCombo',v.combo<2);this._text('hudComboValue',`×${v.combo||1}`);}
      if(v.comboLeft!==undefined)this._bar('hudComboFill',v.comboLeft/(v.comboMax||3));
      if(v.checkpointProgress){const signature=v.checkpointProgress.join(',');if(this.values.checkpoints!==signature){this.values.checkpoints=signature;this.nodes.hudCheckpointTicks.replaceChildren();for(const progress of v.checkpointProgress){const tick=this.document.createElement('i');tick.className='hud-checkpoint';tick.style.left=`${clamp(progress,0,1)*100}%`;this.nodes.hudCheckpointTicks.appendChild(tick);}}}
      if(v.paused!==undefined){this._attr('pauseButton','aria-label',v.paused?'Resume game':'Pause game');this._class('pauseButton','active',v.paused);}
      if(v.muted!==undefined){this._attr('soundButton','aria-label',v.muted?'Enable sound':'Mute sound');this._attr('soundButton','aria-pressed',v.muted);}
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
      this.nodes.menuCrumb.textContent=name==='title'?'DEADLAND RALLY · V3':`${name.toUpperCase()} / IRONTRAIL`;
      let html='',primary='Continue',action='back',args=[],secondary='';
      if(name==='title'){
        html=`<p class="menu-eyebrow">TEN STAGES. ONE WAY OUT.</p><h1 id="screenHeading" class="attract-title">DEADLAND<br><span>RALLY.</span></h1><p class="title-copy">Big tyres. Wild ground. One cannon charge.<br>Make your mark on the road nobody came back from.</p><div class="title-badges"><span>REAL SUSPENSION</span><span>ONE SHOT</span><span>NO EASY ROAD</span></div><div class="title-tag">${this.save.completed?.length||0} / 10 CLEARED &nbsp; · &nbsp; ${esc(this._stageName(this.save.selected||0)).toUpperCase()}</div>`;
        primary=this.save.completed?.length?'Continue the rally':'Start your engine';action='play';secondary=this._button('Stage select','stages')+this._button('Garage','garage')+this._button('Settings','settings');
      }else if(name==='stages'){
        html=`<p class="menu-eyebrow">THE ROAD OUT</p><h1 id="screenHeading" class="menu-title">Choose your line.</h1><p class="menu-copy">Clear each route to unlock the next. Three stars reward pace, survival and a little nerve.</p><div class="campaign-summary"><span>${this.save.completed?.length||0} / 10 ROUTES CLEARED</span><span>${Object.values(this.save.stars||{}).reduce((sum,v)=>sum+(Array.isArray(v)?v.filter(Boolean).length:0),0)} / 30 STARS</span><span class="scrap-chip">◆ ${scoreText(this.save.scrap)} SCRAP</span></div><div class="stage-grid">`;
        for(let n=0;n<10;n++){
          const locked=n>=(this.save.unlocked||1),stars=this.save.stars?.[n]||[false,false,false],biome=this.biomes[n]||{};
          html+=`<button type="button" class="stage-card${locked?' locked':''}${n===(this.save.selected||0)?' current':''}" style="--card-accent:${esc(biome.accent||'#b9bd75')}" data-ui="selectStage" data-stage="${n}" aria-label="Stage ${n+1}: ${esc(this._stageName(n))}${locked?', locked':''}" ${locked?'disabled':''}><span class="stage-card-top"><b>${String(n+1).padStart(2,'0')}</b><span class="stage-lock">${locked?'LOCKED':n===9?'BOSS RACE':'SURVIVAL'}</span></span><span class="stage-name">${esc(this._stageName(n))}</span><span class="stage-meta">${this.stages[n]?.length||0} M · ${esc(biome.timeOfDay||'DEADLANDS').toUpperCase()}</span><span class="stage-stars" aria-label="${stars.filter(Boolean).length} of 3 stars">${this._stars(stars)}</span><span class="stage-best">${this.save.best?.[n]?timeText(this.save.best[n]):locked?'CLEAR THE PREVIOUS ROUTE':'SET THE FIRST TIME'}</span></button>`;
        }
        html+='</div>';primary='Continue selected route';action='selectStage';args=[this.save.selected||0];secondary=this._button('Garage','garage')+this._button('Title','title');
      }else if(name==='garage'){
        html=`<p class="menu-eyebrow">TRAILBREAKER WORKSHOP</p><h1 id="screenHeading" class="menu-title">Build a better escape.</h1><p class="menu-copy">Earn scrap on the road. Make it yours. Your cannon still has one charge, cans restore 32, and recovery costs 12 fuel.</p><div class="campaign-summary"><span class="scrap-chip">◆ ${scoreText(this.save.scrap)} SCRAP AVAILABLE</span><span>UPGRADES APPLY TO YOUR NEXT RUN</span></div><div class="garage-grid">`;
        for(const track of ['engine','tyres','suspension','tank']){
          const info=global.IronRules.upgradeInfo(track,this.save.upgrades?.[track]||0,this.rulesInfo.upgrades||this.rulesInfo.UPGRADES);
          const max=info.level>=3,canBuy=!max&&this.save.scrap>=info.cost;
          html+=`<article class="upgrade-card"><div class="upgrade-icon">${icon(info.icon)}</div><h2 class="upgrade-title">${esc(info.label)}</h2><p class="upgrade-subtitle">${esc(info.subtitle)}</p><div class="upgrade-levels" aria-label="Level ${info.level} of 3">${[0,1,2].map(n=>`<i${n<info.level?' class="filled"':''}></i>`).join('')}</div><p class="upgrade-current">NOW · ${esc(info.current)}</p><p class="upgrade-next">${max?'MAXED OUT':`NEXT · ${esc(info.next)}`}</p><p class="upgrade-description">${esc(info.description)}</p><button class="buy-button" data-ui="buy" data-track="${track}" ${canBuy?'':'disabled'} aria-label="${max?`${esc(info.label)} fully upgraded`:`Upgrade ${esc(info.label)} for ${info.cost} scrap`}">${max?'FULLY UPGRADED':`UPGRADE <small>◆ ${info.cost}</small>`}</button></article>`;
        }
        html+='</div>';primary='Back to the rally';action='back';secondary=this._button('Stage select','stages')+this._button('Settings','settings');
      }else if(name==='settings'){
        const settings=this.save.settings||{};
        html='<p class="menu-eyebrow">TUNE YOUR EXPERIENCE</p><h1 id="screenHeading" class="menu-title">Make yourself at home.</h1><p class="menu-copy">Your preferences save automatically. Music is fully synthesized; the engine stays the loudest voice.</p><div class="settings-grid">';
        const ranges=[['master','Master volume',.9],['music','Music volume',.55],['sfx','Engine & effects',.9]];
        for(const [key,label,def]of ranges){const value=Math.round(clamp(settings[key]??def,0,1)*100);html+=`<div class="setting-item"><label for="setting-${key}">${label}<output id="setting-value-${key}">${value}%</output></label><input id="setting-${key}" type="range" min="0" max="100" step="1" value="${value}" data-setting="${key}" aria-label="${label}"></div>`;}
        html+=`<div class="setting-item"><label for="setting-quality">Graphics quality<select id="setting-quality" data-setting="quality" aria-label="Graphics quality">${[['auto','Auto · adaptive'],['high','High'],['balanced','Balanced'],['performance','Performance']].map(([value,label])=>`<option value="${value}" ${settings.quality===value?'selected':''}>${label}</option>`).join('')}</select></label><small>Auto adjusts resolution and effects to keep motion smooth.</small></div>`;
        for(const [key,label,help]of [['shake','Camera shake','Physical impacts with a little extra punch.'],['showFps','Performance display','Show FPS, CPU time and rendering detail.'],['reducedMotion','Reduced motion','Quiet menu animation and camera effects.']])html+=`<div class="setting-item"><label for="setting-${key}">${label}<input id="setting-${key}" type="checkbox" data-setting="${key}" ${settings[key]?'checked':''}></label><small>${help}</small></div>`;
        html+='</div>';primary='Save & return';action='back';secondary=this._button('Stage select','stages')+this._button('Title','title');
      }else if(name==='brief'){
        const par=d.par??this._par(i),challenge=typeof d.challenge==='string'?d.challenge:d.challenge?.label||this._challenge(i),best=d.best??this.save.best?.[i];
        html=`<div class="brief-layout"><div><p class="brief-kicker">STAGE ${String(i+1).padStart(2,'0')} / 10 ${i===9?'· FINAL BOSS':''}</p><h1 id="screenHeading" class="brief-name">${esc(d.name||stage.name||this._stageName(i))}</h1><p class="brief-description">${esc(d.description||stage.subtitle||'Find a line through the deadlands. Keep your fuel up and stop the giant before it stops you.')}</p><div class="brief-facts"><span>DISTANCE<strong>${d.length||stage.length||0}<small> M</small></strong></span><span>PAR TIME<strong>${timeText(par)}</strong></span><span>BEST<strong>${best?timeText(best):'—'}</strong></span></div><div class="onboarding"><span>↑ / W · DRIVE</span><span>← → · BALANCE</span><span>X / J · FIRE ON LOCK</span><span>C · RECOVER −12 FUEL</span></div></div><div class="brief-objectives"><div class="objective"><span class="star">★</span><div>Survive the route<small>One giant. One cannon charge. Reach the finish.</small></div></div><div class="objective"><span class="star">★</span><div>Beat the par time<small>${timeText(par)} OR FASTER</small></div></div><div class="objective"><span class="star">★</span><div>${esc(challenge)}<small>YOUR EXTRA CHALLENGE</small></div></div></div></div>`;
        primary=i===9?'Challenge Iron Maw':'Start this run';action='play';secondary=this._button('Stage select','stages')+this._button('Garage','garage');
      }else if(name==='pause'){
        html=`<div class="pause-layout"><div><p class="menu-eyebrow">${esc(d.stageName||this._stageName(this.save.selected||0))}</p><h1 id="screenHeading" class="pause-heading">PARKED.<br>FOR NOW.</h1><p class="menu-copy">The road, fuel and rival wait for you. Catch your breath.</p></div><div class="pause-data"><span>RUN TIME<strong>${timeText(d.time||0)}</strong></span><span>FUEL<strong>${Math.ceil(d.fuel??100)}%</strong></span></div></div>`;
        primary='Back to the trail';action='resume';secondary=this._button('Retry stage','retry')+this._button('Settings','settings')+this._button('Stage select','stages');
      }else if(name==='results'){
        const stars=d.stars||[true,false,false],par=d.par??this._par(i),challenge=typeof d.challenge==='string'?d.challenge:d.challenge?.label||this._challenge(i);
        html=`<div class="result-layout"><div><p class="menu-eyebrow">${i===9?'DEADLAND CAMPAIGN COMPLETE':`STAGE ${String(i+1).padStart(2,'0')} CLEARED`} · ${esc(d.name||this._stageName(i))}</p><h1 id="screenHeading" class="menu-title">${i===9?'You own the wasteland.':'That’s how you leave a mark.'}</h1><div class="result-stars" aria-label="${stars.filter(Boolean).length} of 3 stars">${this._stars(stars,true)}</div><div class="result-summary">YOUR TIME <b>${timeText(d.time||0)}</b><br>PAR TIME ${timeText(par)}<br>${esc(challenge)} ${stars[2]?'✓':'· TRY ANOTHER RUN'}</div><div class="result-badges">${d.newBest?'<span class="result-badge">NEW BEST TIME</span>':''}${d.newScoreBest?'<span class="result-badge">NEW BEST SCORE</span>':''}</div><div class="result-big-score">${scoreText(d.score)}<small>TOTAL SCORE</small></div></div><div><div class="score-breakdown">${(d.breakdown||[]).map(row=>`<div class="breakdown-row"><span>${esc(row.label)}</span><b>${scoreText(row.value)}</b></div>`).join('')||'<div class="breakdown-row"><span>Run complete</span><b>0</b></div>'}<div class="scrap-earned"><span>SCRAP EARNED</span><strong>+${scoreText(d.scrap)}</strong></div></div></div></div>`;
        primary=d.nextAvailable!==false&&i<9?`Continue to stage ${String(i+2).padStart(2,'0')}`:'Back to the stages';action=d.nextAvailable!==false&&i<9?'next':'stages';secondary=this._button('Run it again','retry')+this._button('Garage','garage')+this._button('Stage select','stages');
      }else if(name==='failed'){
        const reason=d.reason||'fuel',tips={fuel:'Keep rolling and collect amber cans. Idle still burns fuel; checkpoint recovery costs 12.',monster:'Wait for TARGET LOCKED, then fire once with X / J or FIRE. A fresh retry restores your only charge.',rival:'Iron Maw took the flag. Carry speed through the run-ups, trade paint, and keep the landing upright.'};
        html=`<div class="failure-icon" aria-hidden="true">${reason==='fuel'?'▱':reason==='monster'?'◆':'⚑'}</div><p class="menu-eyebrow">${esc(d.stageName||this._stageName(this.save.selected||0))}</p><h1 id="screenHeading" class="menu-title">${reason==='fuel'?'Empty tank. Unfinished business.':reason==='monster'?'The giant stopped this run.':'Iron Maw got there first.'}</h1><p class="menu-copy">The road still has your name on it. Your earned scrap stays with you.</p><div class="failure-tip">${esc(d.tip||tips[reason]||tips.fuel)}</div><div class="result-summary">RUN TIME ${timeText(d.time||0)} &nbsp; · &nbsp; SCORE ${scoreText(d.score)} &nbsp; · &nbsp; +${scoreText(d.scrap)} SCRAP</div>`;
        primary='One more run';action='retry';secondary=this._button('Garage','garage')+this._button('Stage select','stages')+this._button('Title','title');
      }else{this.showScreen('title');return;}
      this.nodes.menuBody.innerHTML=html;this.nodes.secondaryActions.innerHTML=secondary;
      this.nodes.playButton.innerHTML=`${esc(primary)} <span aria-hidden="true">→</span>`;this._primary={name:action,args};
      this.nodes.menuHint.textContent=name==='title'?'ARROWS / WASD DRIVE · X / J FIRE · C RECOVER · GAMEPAD READY':name==='garage'?'UPGRADES NEVER ADD AMMO OR CHANGE CAN VALUE / RECOVERY COST':'ARROWS TO NAVIGATE · ENTER TO CHOOSE · ESC TO GO BACK';
      this.nodes.menuPanel.scrollTop=0;this.nodes.playButton.focus({preventScroll:true});
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
    clearFeedback(){
      if(this._toastTimer)global.clearTimeout(this._toastTimer);if(this._bannerTimer)global.clearTimeout(this._bannerTimer);this._toastTimer=null;this._bannerTimer=null;this._text('hudToast','');this._text('hudBanner','');this.nodes.hudToast.className='hud-toast';this.nodes.hudBanner.className='hud-banner';
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
