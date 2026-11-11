/* "Deadland Run" — original eight-bar synth-rock theme for IRONTRAIL.
 * Persistent melodic voices, filtered drum buffers and a bounded lookahead clock.
 * Entirely synthesized; no downloads, samples or external music dependencies.
 */
(function(global){
  'use strict';
  const MOODS=Object.freeze(['menu','drive','boss','danger','results']);
  const TEMPOS=[116,118,119,117,120,121,122,120,124,126];
  const HOOK=Object.freeze([12,-1,12,15,19,-1,17,15,12,-1,10,12,7,-1,10,7,8,-1,12,15,17,-1,15,12,10,-1,7,10,12,-1,10,7]);
  const ANSWER=Object.freeze([12,15,19,-1,22,19,17,15,12,-1,15,17,19,-1,15,12,8,12,15,-1,17,15,12,10,7,10,12,15,12,-1,12,-1]);
  const ROOTS=[0,8,3,10],THIRDS=[3,4,4,4],BASS=[0,-1,0,7,0,-1,12,7,0,-1,0,7,12,7,0,-1];
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0)),LEVEL=.68;
  class TruckMusic{
    constructor(context,destination){
      this.context=context;this.destination=destination;this.state={biome:0,intensity:.2,mood:'menu',playing:false,timeScale:1,boost:0,tension:0};
      this.volume=1;this.active=false;this._stopped=false;this.timer=null;this.nextTime=0;this.step=0;this._drums=new Set();this._gainParams=[];this._color=-1;this._duckUntil=0;this._duckDepth=1;
      this.output=context.createGain();this.output.gain.value=LEVEL;
      this.tone=context.createBiquadFilter();this.tone.type='lowpass';this.tone.frequency.value=6800;this.tone.Q.value=.5;
      this.output.connect(this.tone);this.tone.connect(destination);
      this.bass=this._voice('sawtooth',420,.18);this.lead=this._voice('triangle',2800,.11);
      this.leadTop=this._voice('square',1900,.025);this.arp=this._voice('triangle',2400,.032);
      this.pads=[this._voice('triangle',850,.018),this._voice('sine',1050,.022),this._voice('sine',1300,.018)];
      this.kick=this._voice('sine',200,.22);this.snareBody=this._voice('triangle',650,.07);
      this.noise=context.createBuffer(1,Math.floor(context.sampleRate*.25),context.sampleRate);
      const samples=this.noise.getChannelData(0);let seed=137;
      for(let i=0;i<samples.length;i++){seed=(seed*16807)%2147483647;samples[i]=(seed/1073741824-1)*(1-i/samples.length);}
      this.stats={notes:0,drums:0,scheduledUntil:0,voices:9};
    }
    _voice(type,cutoff,level){
      const c=this.context,osc=c.createOscillator(),filter=c.createBiquadFilter(),gain=c.createGain();
      osc.type=type;filter.type='lowpass';filter.frequency.value=cutoff;gain.gain.value=0;
      for(const p of [filter.frequency,filter.Q,gain.gain])try{p.automationRate='k-rate';}catch(_){}
      osc.connect(filter);filter.connect(gain);gain.connect(this.output);osc.start();this._gainParams.push(gain.gain);
      return{osc,filter,gain,level};
    }
    _note(voice,hz,t,duration,amount=1){
      const p=voice.gain.gain;voice.osc.frequency.setValueAtTime(hz,t);p.setValueAtTime(.00001,t);
      p.linearRampToValueAtTime(voice.level*amount,t+.006);p.exponentialRampToValueAtTime(.00001,t+Math.max(.02,duration));this.stats.notes++;
    }
    _drum(t,kind,amount){
      if(amount<=0||(!this._offline&&this._drums.size>=32))return;
      const c=this.context,source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();
      const hat=kind==='hat'||kind==='open',duration=kind==='open'?.16:hat?.045:.17;
      source.buffer=this.noise;source.playbackRate.value=hat?1.5:1;
      filter.type=hat?'highpass':'bandpass';filter.frequency.value=hat?6500:1800;filter.Q.value=hat?.5:.7;
      gain.gain.setValueAtTime(.00001,t);gain.gain.linearRampToValueAtTime(amount,t+.002);gain.gain.exponentialRampToValueAtTime(.00001,t+duration);
      source.connect(filter);filter.connect(gain);gain.connect(this.output);source.start(t);source.stop(t+duration+.02);
      this._drums.add(source);source.onended=()=>{this._drums.delete(source);source.disconnect();filter.disconnect();gain.disconnect();};this.stats.drums++;
    }
    _schedule(t){
      const s=this.state,mood=s.mood,menu=mood==='menu',boss=mood==='boss',danger=mood==='danger';
      const bpm=menu?104:TEMPOS[s.biome]+(boss?6:0),sixteenth=15/bpm*(1+(1-s.timeScale)*.25),n=this.step%16,bar=Math.floor(this.step/16)%8,chord=bar%4;
      const root=55*Math.pow(2,((s.biome%3)-1)/12),chordRoot=root*Math.pow(2,ROOTS[chord]/12),boost=menu?0:s.boost||0,tension=menu?0:s.tension||0,energy=menu?.46:.72+s.intensity*.28+boost*.1;
      const groove=menu?[0,8].includes(n):n===0||n===8||n===6||boss&&n===10;
      if(groove){this._note(this.kick,55,t,.17,energy*(menu?.7:1));this.kick.osc.frequency.setValueAtTime(140,t);this.kick.osc.frequency.exponentialRampToValueAtTime(42,t+.17);}
      if(!menu&&(n===4||n===12)){
        this._drum(t,'snare',.12*energy);this._note(this.snareBody,185,t,.11,energy);
      }
      if(n%2===0&&(!menu||n%4===2))this._drum(t,n===14&&!menu?'open':'hat',(n%4===0?.026:.018)*energy);
      if(!menu&&(boss||s.intensity>.75)&&n%4===3)this._drum(t,'hat',.012*energy);
      if(!menu&&bar===7&&n>=14)this._drum(t,'snare',n===14?.07:.1);
      // Nitro drives a sixteenth pulse; tension adds an urgent off-beat kick.
      if(boost>.25&&n%2===1)this._drum(t,'hat',.02*energy*boost);
      if(tension>.45&&(n===3||n===11)){this._note(this.kick,55,t,.12,energy*tension*.7);this.kick.osc.frequency.setValueAtTime(120,t);this.kick.osc.frequency.exponentialRampToValueAtTime(44,t+.12);}
      const bass=BASS[n];if(bass>=0&&(!menu||n%4===0))this._note(this.bass,chordRoot*Math.pow(2,bass/12),t,sixteenth*(n%4===0?1.65:.78),energy);
      if(n===0){for(let i=0;i<3;i++){const semitone=[0,THIRDS[chord],7][i];this._note(this.pads[i],chordRoot*4*Math.pow(2,semitone/12),t,sixteenth*14,menu?.65:danger?.7:1);}}
      if(n%2===0){
        const hook=(bar<4?HOOK:ANSWER)[Math.floor(this.step/2)%32];
        if(hook>=0){const hz=root*4*Math.pow(2,hook/12),amount=energy*(menu?.75:1);this._note(this.lead,hz,t,sixteenth*1.65,amount);if(!menu)this._note(this.leadTop,boost>.5?hz:hz/2,t,sixteenth*1.45,amount*(1+boost*.4));}
      }
      if(!menu&&n%2===1){const degrees=[0,7,12,THIRDS[chord]+12],note=degrees[Math.floor(n/2)%4];this._note(this.arp,chordRoot*4*Math.pow(2,note/12),t,sixteenth*.7,energy*(danger?.5:.8));}
      this.step++;this.nextTime=t+sixteenth;this.stats.scheduledUntil=this.nextTime;
    }
    _pump(){
      if(!this.active||this.context.state!=='running'||this.volume<=0)return;
      const now=this.context.currentTime;if(this.nextTime<now-.2)this.nextTime=now+.025;
      while(this.nextTime<now+.12)this._schedule(this.nextTime);
    }
    setState(next={}){
      const old=this.state;
      if(next.biome!==undefined)old.biome=clamp(Math.floor(next.biome),0,9);
      if(next.intensity!==undefined)old.intensity=clamp(next.intensity,0,1);
      if(MOODS.includes(next.mood))old.mood=next.mood;
      if(next.timeScale!==undefined)old.timeScale=clamp(next.timeScale,.1,1);
      if(next.playing!==undefined)old.playing=!!next.playing;
      if(next.boost!==undefined)old.boost=clamp(next.boost,0,1);if(next.tension!==undefined)old.tension=clamp(next.tension,0,1);
      if(this.context.state==='running'&&Math.abs(this._color-old.timeScale)>.015){this._color=old.timeScale;this.tone.frequency.setTargetAtTime(850+5950*Math.sqrt(old.timeScale),this.context.currentTime,.09);}
      if(old.playing&&this.volume>0&&this.context.state==='running')this.start();else this.stop();
    }
    setVolume(value){
      const next=clamp(value,0,1);if(next===this.volume)return;this.volume=next;
      if(this.context.state==='running'){const t=this.context.currentTime;this.output.gain.cancelScheduledValues(t);this.output.gain.setTargetAtTime(LEVEL*next,t,.04);}else this.output.gain.value=LEVEL*next;
      if(next<=0)this.stop();else if(this.state.playing)this.start();
    }
    start(){
      if(this.active||this.volume<=0||this.context.state!=='running')return;
      this.active=true;this._stopped=false;this.nextTime=this.context.currentTime+.025;this._color=-1;this._pump();this.timer=setInterval(()=>this._pump(),25);
    }
    stop(){
      if(this._stopped&&!this.active&&this.timer===null)return;this._stopped=true;
      if(this.timer!==null){clearInterval(this.timer);this.timer=null;}this.active=false;
      const now=this.context.currentTime;
      for(const p of this._gainParams){p.cancelScheduledValues(now);if(this.context.state==='running')p.setValueAtTime(0,now);else p.value=0;}
      for(const source of this._drums)try{source.stop(now);}catch(_){}
    }
    duck(seconds=.24,depth=.3){
      if(this.context.state!=='running'||this.volume<=0)return;const t=this.context.currentTime,p=this.output.gain;
      this._duckDepth=t<this._duckUntil?Math.min(this._duckDepth,depth):depth;this._duckUntil=Math.max(this._duckUntil,t+seconds);
      if(p.cancelAndHoldAtTime)p.cancelAndHoldAtTime(t);else{const value=p.value;p.cancelScheduledValues(t);p.setValueAtTime(value,t);}
      p.linearRampToValueAtTime(LEVEL*this.volume*this._duckDepth,t+.006);p.setValueAtTime(LEVEL*this.volume*this._duckDepth,t+.04);p.linearRampToValueAtTime(LEVEL*this.volume,this._duckUntil);
    }
    // Short stingers on the lead voice for the biggest moments.
    hit(kind='slam'){
      if(!this.active||this.volume<=0||this.context.state!=='running')return;const t=this.context.currentTime+.01;
      if(kind==='finish'){this._note(this.lead,523.25,t,.12,.9);this._note(this.lead,659.25,t+.1,.12,.9);this._note(this.lead,783.99,t+.2,.34,.95);}
      else{this._note(this.lead,146.83,t,.2,.9);this._note(this.lead,110,t+.12,.3,.9);}
    }
    stinger(won=true){
      if(!this.active||this.volume<=0)return;const t=this.context.currentTime,root=won?440:293.66;
      this._note(this.lead,root,t,.16,.8);this._note(this.lead,root*(won?1.5:.75),t+.18,.28,.8);
    }
    // Test-only full-score rendering; live scheduling retains its 32-source cap.
    scheduleOffline(seconds,state={}){
      Object.assign(this.state,state);if(this.volume<=0||!this.state.playing)return;
      this._offline=true;this.step=0;this.nextTime=.025;while(this.nextTime<seconds-.2)this._schedule(this.nextTime);this._offline=false;
    }
    dispose(){this.stop();for(const v of [this.bass,this.lead,this.leadTop,this.arp,this.kick,this.snareBody,...this.pads]){try{v.osc.stop();}catch(_){}v.osc.disconnect();v.filter.disconnect();v.gain.disconnect();}this.output.disconnect();this.tone.disconnect();}
  }
  TruckMusic.MOODS=MOODS;TruckMusic.THEME='Deadland Run';global.TruckMusic=TruckMusic;
})(globalThis);
