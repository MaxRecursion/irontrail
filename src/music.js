/* IRONTRAIL adaptive score. Persistent synthesizer voices; no network assets. */
(function(global){
  'use strict';
  const MOODS=Object.freeze(['menu','drive','boss','danger','results']);
  const SCALES=[0,3,5,7,10], TEMPOS=[94,98,102,96,106,108,112,100,116,122];
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
  class TruckMusic{
    constructor(context,destination){
      this.context=context;this.destination=destination;this.state={biome:0,intensity:.2,mood:'menu',playing:false};
      this.volume=1;this.active=false;this._stopped=false;this.timer=null;this.nextTime=0;this.step=0;this._drums=new Set();this._gainParams=[];
      this.output=context.createGain();this.output.gain.value=.30;this.output.connect(destination);
      this.bass=this._voice('triangle',270,.065);this.lead=this._voice('triangle',1800,.024);
      this.pads=[this._voice('sine',740,.012),this._voice('sine',740,.012),this._voice('sine',740,.012)];
      this.kick=this._voice('sine',180,.09);this.kick.osc.frequency.value=55;
      this.noise=context.createBuffer(1,Math.floor(context.sampleRate*.22),context.sampleRate);
      const samples=this.noise.getChannelData(0);let seed=137;
      for(let i=0;i<samples.length;i++){seed=(seed*16807)%2147483647;samples[i]=(seed/1073741824-1)*(1-i/samples.length);}
      this.stats={notes:0,drums:0,scheduledUntil:0,voices:6};
    }
    _voice(type,cutoff,level){
      const c=this.context,osc=c.createOscillator(),filter=c.createBiquadFilter(),gain=c.createGain();
      osc.type=type;filter.type='lowpass';filter.frequency.value=cutoff;gain.gain.value=0;
      for(const p of [filter.frequency,filter.Q,gain.gain])try{p.automationRate='k-rate';}catch(_){}
      osc.connect(filter);filter.connect(gain);gain.connect(this.output);osc.start();this._gainParams.push(gain.gain);
      return {osc,filter,gain,level};
    }
    _note(voice,hz,t,duration,amount=1){
      const p=voice.gain.gain;
      voice.osc.frequency.setValueAtTime(hz,t);p.setValueAtTime(.00001,t);
      p.linearRampToValueAtTime(voice.level*amount,t+.012);
      p.exponentialRampToValueAtTime(.00001,t+Math.max(.025,duration));this.stats.notes++;
    }
    _drum(t,kind,amount){
      if(amount<=0)return;const c=this.context,source=c.createBufferSource(),gain=c.createGain();
      source.buffer=this.noise;gain.gain.setValueAtTime(amount,t);gain.gain.exponentialRampToValueAtTime(.00001,t+(kind==='hat'?.045:.16));
      // Noise buffer is already shaped. One buffer-source + gain per drum hit;
      // all melodic parts keep their graph alive and only change parameters.
      source.playbackRate.value=kind==='hat'?2.3:1;source.connect(gain);gain.connect(this.output);source.start(t);source.stop(t+.19);
      this._drums.add(source);source.onended=()=>{this._drums.delete(source);source.disconnect();gain.disconnect();};this.stats.drums++;
    }
    _schedule(t){
      const s=this.state,biome=s.biome,mood=s.mood,intensity=s.intensity;
      const bpm=TEMPOS[biome]+(mood==='boss'?6:0),eighth=30/bpm,n=this.step%16;
      const root=55*Math.pow(2,(biome%5-2)/12),menu=mood==='menu',danger=mood==='danger';
      const energy=menu?.30:.55+intensity*.45,degree=SCALES[[0,0,3,0,2,0,4,3][Math.floor(n/2)%8]];
      if(n%2===0)this._note(this.bass,root*Math.pow(2,degree/12),t,eighth*1.7,energy);
      if(n===0||(!menu&&n===8)){
        this._note(this.kick,55,t,.17,energy);this.kick.osc.frequency.setValueAtTime(105,t);this.kick.osc.frequency.exponentialRampToValueAtTime(40,t+.17);
      }
      if(!menu&&(n===4||n===12))this._drum(t,'snare',.018*energy);
      if(!menu&&(intensity>.36||n%4===2))this._drum(t,'hat',.006+intensity*.006);
      if(n===0){
        const chord=[0,danger?1:3,7];for(let i=0;i<3;i++)this._note(this.pads[i],root*2*Math.pow(2,chord[i]/12),t,eighth*14,menu?.65:.85);
      }
      if((menu&&n===10)||(!menu&&intensity>.45&&n%4===2)||mood==='results'&&n%4===0){
        const melody=SCALES[(Math.floor(this.step/4)+biome)%5];this._note(this.lead,root*8*Math.pow(2,melody/12),t,eighth*1.9,menu?.5:energy);
      }
      this.step++;this.nextTime=t+eighth;this.stats.scheduledUntil=this.nextTime;
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
      if(next.playing!==undefined)old.playing=!!next.playing;
      if(old.playing&&this.volume>0&&this.context.state==='running')this.start();else this.stop();
    }
    setVolume(value){this.volume=clamp(value,0,1);if(this.volume<=0)this.stop();else if(this.state.playing)this.start();}
    start(){
      if(this.active||this.volume<=0||this.context.state!=='running')return;
      this.active=true;this._stopped=false;this.nextTime=this.context.currentTime+.025;this._pump();this.timer=setInterval(()=>this._pump(),25);
    }
    stop(){
      if(this._stopped&&!this.active&&this.timer===null)return;this._stopped=true;
      if(this.timer!==null){clearInterval(this.timer);this.timer=null;}this.active=false;
      const now=this.context.currentTime;
      for(const p of this._gainParams){p.cancelScheduledValues(now);if(this.context.state==='running')p.setValueAtTime(0,now);else p.value=0;}
      for(const source of this._drums)try{source.stop(now);}catch(_){}
    }
    duck(seconds=.18){
      if(this.context.state!=='running')return;const t=this.context.currentTime,p=this.output.gain;
      p.cancelScheduledValues(t);p.setValueAtTime(.13,t);p.linearRampToValueAtTime(.30,t+seconds);
    }
    stinger(won=true){
      if(!this.active||this.volume<=0)return;const t=this.context.currentTime,root=won?220:146.83;
      this._note(this.lead,root,t,.16,1);this._note(this.lead,root*(won?1.5:.75),t+.18,.22,.9);
    }
    // Deterministic test-only scheduling into OfflineAudioContext. It uses the
    // exact production voices/patterns without a timer or running-state bypass.
    scheduleOffline(seconds,state={}){
      Object.assign(this.state,state);if(this.volume<=0||!this.state.playing)return;
      this.step=0;this.nextTime=.025;while(this.nextTime<seconds-.2)this._schedule(this.nextTime);
    }
    dispose(){this.stop();for(const v of [this.bass,this.lead,this.kick,...this.pads]){try{v.osc.stop();}catch(_){}v.osc.disconnect();v.filter.disconnect();v.gain.disconnect();}this.output.disconnect();}
  }
  TruckMusic.MOODS=MOODS;global.TruckMusic=TruckMusic;
})(globalThis);
