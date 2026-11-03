/*
 * TruckAudio — self-contained, procedural V8 and terrain audio.
 * This is a physical-sounding approximation, not a recording of a real engine.
 * One 720-degree combustion cycle has eight weighted firing pulses; pitch follows
 * drivetrain RPM, while filters/gain approximate exhaust load and intake noise.
 */
class TruckAudio {
  constructor() {
    this.context = null;
    this.muted = false;
    this.paused = false;
    this.rpm = 820;
    this.gear = 1;
    this._gearIndex = 0;
    this._shiftClock = 0;
    this._shiftDip = 0;
    this._ready = false;
    this._lastTakeoff = -10;
    this._lastLanding = -10;
    this._lastPickup = -10;
    this._lastZombieHit = -10;
    this._lastCollision = -10;
    this._lastResult = -10;
    this._lastGunshot = -10;
    this._lastMonsterHit = -10;
    this._lastMonsterCrash = -10;
    this._voices = new Set();
    this._noise = null;
    this._ratios = [24, 18, 14, 11, 9];
    this.volumes={master:.9,music:.55,sfx:.9};this._targets=new Map();this._cueTimes=Object.create(null);
    this._eventPan=0;this._slow=false;this._automationClock=0;this._lastThrottle=0;this._lastCompression=0;this._lastBackfire=-10;
    this._musicState={biome:0,intensity:.2,mood:'menu',playing:false};this.music=null;this._driveBus=true;
  }

  static clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  }

  // Must be called by a pointer/key gesture; repeated calls reuse the same graph.
  async unlock() {
    try {
      if (!this.context) {
        const AudioContextType = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextType) return false;
        this.context = new AudioContextType();
        this._buildGraph();
      }
      if (this.context.state === 'suspended') await this.context.resume();
      this._gate();this._flushTargets();this.setMusicState(this._musicState);
      return this.context.state === 'running';
    } catch (error) {
      // Driving remains available when the browser/OS cannot start audio.
      console.warn('Truck audio could not start:', error.message);
      return false;
    }
  }

  prime(){return this.unlock();}

  _buildGraph() {
    const ctx = this.context;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -13;
    limiter.knee.value = 12;
    limiter.ratio.value = 5;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.16;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);

    this.engineBus=ctx.createGain();this.sfxBus=ctx.createGain();this.musicBus=ctx.createGain();
    this.engineBus.gain.value=this.volumes.sfx;this.sfxBus.gain.value=this.volumes.sfx;this.musicBus.gain.value=this.volumes.music;
    this.engineFocus=ctx.createGain();this.engineFocus.gain.value=1;this._focusUntil=0;
    this.engineBus.connect(this.engineFocus);this.engineFocus.connect(this.master);this.sfxBus.connect(this.master);this.musicBus.connect(this.master);
    for(const bus of [this.engineBus,this.sfxBus,this.musicBus])try{bus.gain.automationRate='k-rate';}catch(_){}
    const exhaust = ctx.createBiquadFilter();
    exhaust.type = 'lowpass';
    exhaust.frequency.value = 540;
    exhaust.Q.value = 0.7;
    const saturator = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i * 2 / (curve.length - 1)) - 1;
      curve[i] = Math.tanh(x * 2.5) / Math.tanh(2.5);
    }
    saturator.curve = curve;
    saturator.oversample = '2x';
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.12;
    this.engine = ctx.createOscillator();
    this.engine.setPeriodicWave(this._combustionWave());
    this.engine.frequency.value = this.rpm / 120;
    this.engine.connect(this.engineGain);
    this.engineGain.connect(saturator);
    saturator.connect(exhaust);
    exhaust.connect(this.engineBus);
    this.exhaustFilter = exhaust;

    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    this.sub.frequency.value = this.rpm / 60;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0.035;
    this.sub.connect(this.subGain);
    this.subGain.connect(this.engineBus);

    // A restrained intake rasp gives throttle a different texture from coasting.
    this.intake = ctx.createOscillator();
    this.intake.type = 'sawtooth';
    this.intake.frequency.value = this.rpm / 30;
    const intakeFilter = ctx.createBiquadFilter();
    intakeFilter.type = 'bandpass';
    intakeFilter.frequency.value = 900;
    intakeFilter.Q.value = 0.45;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    this.intake.connect(intakeFilter);
    intakeFilter.connect(this.intakeGain);
    this.intakeGain.connect(this.engineBus);

    this._noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const noiseData = this._noise.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
    this.gravel = this._noiseLayer('bandpass', 1100, 0.6);
    this.wind = this._noiseLayer('lowpass', 650, 0.35);
    this.skid=this._noiseLayer('bandpass',2200,.5);this.creak=this._noiseLayer('bandpass',360,1.1);
    this.exhaustNoise = this._noiseLayer('lowpass', 240, 0.6);
    this.engine.start();
    this.sub.start();
    this.intake.start();
    this._ready = true;
    for(const param of [this.engineGain.gain,this.subGain.gain,this.intakeGain.gain,this.exhaustFilter.frequency,this.exhaustFilter.Q])try{param.automationRate='k-rate';}catch(_){}
    if(globalThis.TruckMusic)this.music=new globalThis.TruckMusic(ctx,this.musicBus);
    if(ctx.addEventListener)ctx.addEventListener('statechange',()=>{if(ctx.state==='running'){this._gate();this._flushTargets();if(this.music)this.music.setState(this._musicState);}else if(this.music)this.music.stop();});
  }

  _combustionWave() {
    const ctx = this.context;
    const harmonics = 96;
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    const weights = [1, 0.76, 0.91, 0.82, 0.97, 0.73, 0.88, 0.8];
    // Fourier coefficients of a short exponential exhaust impulse train. Small
    // alternating pulse differences keep the result from becoming a pure buzz.
    for (let h = 1; h <= harmonics; h++) {
      const rolloff = 1 / Math.sqrt(1 + (h / 15) ** 2);
      const phaseLag = Math.atan(h / 15);
      for (let pulse = 0; pulse < 8; pulse++) {
        const phase = h * (pulse / 8) * Math.PI * 2 + phaseLag;
        real[h] += Math.cos(phase) * weights[pulse] * rolloff;
        imag[h] -= Math.sin(phase) * weights[pulse] * rolloff;
      }
    }
    return ctx.createPeriodicWave(real, imag);
  }

  _noiseLayer(type, frequency, q) {
    const ctx = this.context;
    const source = ctx.createBufferSource();
    source.buffer = this._noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.engineBus);
    try{gain.gain.automationRate='k-rate';filter.frequency.automationRate='k-rate';filter.Q.automationRate='k-rate';}catch(_){}
    source.start(0, Math.random());
    return { source, filter, gain };
  }

  _set(param,value,smoothing=.055){
    if(!this.context||!param||!Number.isFinite(value))return;
    let target=this._targets.get(param);
    if(target&&Math.abs(target.value-value)<Math.max(.00008,Math.abs(value)*.0008)&&!target.dirty)return;
    if(!target){target={value,smoothing,dirty:true};this._targets.set(param,target);}else{target.value=value;target.smoothing=smoothing;target.dirty=true;}
    // A suspended clock must never receive a growing automation queue.
    if(this.context.state!=='running')return;
    param.setTargetAtTime(value,this.context.currentTime,smoothing);target.dirty=false;
  }
  _flushTargets(){if(!this.context||this.context.state!=='running')return;for(const [param,target]of this._targets){param.cancelScheduledValues(this.context.currentTime);param.setTargetAtTime(target.value,this.context.currentTime,target.smoothing);target.dirty=false;}}
  setVolumes(values={}){
    for(const key of ['master','music','sfx'])if(values[key]!==undefined)this.volumes[key]=TruckAudio.clamp(Number(values[key]),0,1);
    if(this._ready&&this.context.state!=='running'){this.engineBus.gain.value=this._driveBus?this.volumes.sfx:0;this.sfxBus.gain.value=this.volumes.sfx;this.musicBus.gain.value=this.volumes.music;}
    if(this._ready){this._set(this.engineBus.gain,this._driveBus?this.volumes.sfx:0,.05);this._set(this.sfxBus.gain,this.volumes.sfx,.03);this._set(this.musicBus.gain,this.volumes.music,.08);this._gate();}
    if(this.music)this.music.setVolume(this.volumes.master>0&&this.volumes.music>0&&!this.muted&&!this.paused?1:0);
  }
  setMusicState(state={}){
    Object.assign(this._musicState,state);this._driveBus=['drive','boss','danger'].includes(this._musicState.mood);
    if(this._ready)this._set(this.engineBus.gain,this._driveBus?this.volumes.sfx:0,.10);
    if(this.music){this.music.setVolume(this.volumes.master>0&&this.volumes.music>0&&!this.muted&&!this.paused?1:0);this.music.setState({...this._musicState,playing:this._musicState.playing&&!this.paused&&!this.muted&&this.volumes.master>0});}
  }
  _gate() {
    if (!this._ready) return;
    const ctx = this.context;
    const silent = this.muted || this.paused;
    const param = this.master.gain;
    if(ctx.state!=='running'){
      param.cancelScheduledValues(ctx.currentTime);param.value=silent?0:.54*this.volumes.master;
      if(silent){if(this.music)this.music.stop();for(const voice of this._voices)try{voice.stop(ctx.currentTime+.018);}catch(_){}}return;
    }
    // Reach actual zero, rather than leaving an exponential tail. Stop pending
    // event voices too, so resuming cannot replay a result or delayed impact.
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(ctx.currentTime);
    else {
      const current = param.value;
      param.cancelScheduledValues(ctx.currentTime);
      param.setValueAtTime(current, ctx.currentTime);
    }
    param.linearRampToValueAtTime(silent ? 0 : 0.54*this.volumes.master, ctx.currentTime + (silent ? 0.018 : 0.04));
    if (silent) {
      if(this.music)this.music.stop();
      for (const voice of this._voices) {
        try { voice.stop(ctx.currentTime + 0.018); } catch (_) { /* Already ended. */ }
      }
    }
  }

  setMuted(muted) {
    this.muted = !!muted;
    this._gate();if(!this.muted&&this.music)this.setMusicState(this._musicState);
  }

  setPaused(paused) {
    this.paused = !!paused;
    this._gate();if(!this.paused&&this.music)this.setMusicState(this._musicState);
  }

  update(state = {}, dt = 1 / 60, input) {
    dt = TruckAudio.clamp(dt, 0, 0.1);
    const speed = TruckAudio.clamp(state.speed, -70, 70);
    const absSpeed = Math.abs(speed);
    const wheelSpeed = TruckAudio.clamp(state.wheelSpeed, 0, 130);
    const throttle = Math.abs(TruckAudio.clamp(input?input.throttle:state.throttle, -1, 1));
    const grounded = !!state.grounded;
    this._shiftClock = Math.max(0, this._shiftClock - dt);
    this._shiftDip = Math.max(0, this._shiftDip - dt);
    if (grounded && this._shiftClock <= 0) {
      const boundaries = [8, 14, 21, 29];
      if (this._gearIndex < 4 && absSpeed > boundaries[this._gearIndex]) {
        this._gearIndex++;
        this._shiftClock = 0.65;
        this._shiftDip = 0.15;
      } else if (this._gearIndex > 0 && absSpeed < boundaries[this._gearIndex - 1] - 2) {
        this._gearIndex--;
        this._shiftClock = 0.5;
      }
    }
    if (absSpeed < 1) this._gearIndex = 0;
    this.gear = speed < -0.5 ? 'R' : this._gearIndex + 1;
    let targetRPM = 820 + wheelSpeed * this._ratios[this._gearIndex] * 9.5493;
    targetRPM += throttle * 380;
    if (!grounded) targetRPM = Math.max(targetRPM, 950 + throttle * 3500);
    if (this._shiftDip > 0) targetRPM *= 0.76;
    targetRPM = TruckAudio.clamp(targetRPM, 780, 5200);
    this.rpm += (targetRPM - this.rpm) * (1 - Math.exp(-dt / (targetRPM > this.rpm ? 0.17 : 0.27)));
    if (!this._ready) return;
    this._automationClock+=dt;if(this._automationClock<1/60)return;this._automationClock%=1/60;
    const rev = (this.rpm - 780) / 4420;
    const scale=TruckAudio.clamp(input?.timeScale??1,0,1);
    this.slowMotion(scale);
    const pitch=.58+.42*Math.sqrt(scale);
    this._set(this.engine.frequency, pitch*this.rpm / 120, 0.045);
    this._set(this.sub.frequency, pitch*this.rpm / 60, 0.06);
    this._set(this.intake.frequency, pitch*this.rpm / 30, 0.055);
    this._set(this.engineGain.gain, 0.115 + throttle * 0.065 + rev * 0.014);
    this._set(this.subGain.gain, 0.028 + throttle * 0.021);
    this._set(this.exhaustFilter.frequency, 400 + rev * 850 + throttle * 700);
    this._set(this.intakeGain.gain, .005 + throttle * (.012 + rev * .018));
    this._set(this.exhaustNoise.gain.gain, 0.012 + throttle * 0.022);
    this._set(this.exhaustNoise.filter.frequency, 180 + rev * 400);
    // Wheel slip is an approximation: tire radius is ~0.75 m in the game.
    const slip = Number.isFinite(state.slip)?state.slip:Math.min(1, Math.abs(wheelSpeed * .72 - absSpeed) / 12);
    const roadAmount = grounded ? Math.min(1, absSpeed / 22) : 0;
    this._set(this.gravel.gain.gain, roadAmount * (0.018 + slip * 0.035), 0.08);
    this._set(this.gravel.filter.frequency, 750 + absSpeed * 35);
    const air = !grounded ? Math.min(1, TruckAudio.clamp(state.airtime, 0, 5) / .38) : 0;
    const rush=Math.hypot(absSpeed,TruckAudio.clamp(state.vy,-35,35)*1.2);
    this._set(this.wind.gain.gain, Math.min(.085,rush*.002)*(0.12+air*.88), .12);
    this._set(this.wind.filter.frequency, (500+Math.min(2600,rush*60))*(.65+.35*Math.sqrt(scale)), .14);
    this._set(this.skid.gain.gain,grounded?Math.min(.055,slip*.06+(input?.brake?absSpeed*.001:0)):0,.07);
    const compression=state.suspension?Math.abs(state.suspension[0])+Math.abs(state.suspension[1]):0;
    this._set(this.creak.gain.gain,grounded?Math.min(.025,Math.abs(compression-this._lastCompression)*.18):0,.05);this._lastCompression=compression;
    if(this.context.state==='running'&&this._lastThrottle>.7&&throttle<.1&&this.rpm>2600&&this.context.currentTime-this._lastBackfire>.8&&this._canPlay()){
      this._lastBackfire=this.context.currentTime;this._thump(.055,100,42,.07);this._noiseBurst(.04,900,.055);
    }this._lastThrottle=throttle;
  }

  _canPlay() {
    return this._ready && !this.paused && !this.muted && this.context.state === 'running' && this.volumes.master>0 && this.volumes.sfx>0;
  }

  _trackVoice(source, nodes) {
    this._voices.add(source);
    source.onended = () => {
      this._voices.delete(source);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
  }

  _noiseBurst(strength, frequency, duration, delay = 0, type = 'lowpass') {
    if (!(strength > 0)||this._voices.size>=96) return;
    const ctx = this.context;
    const now = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this._noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 0.65;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(strength, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    const nodes=[filter,gain];this._routeSfx(gain,nodes);
    source.start(now, Math.random());
    source.stop(now + duration + 0.03);
    this._trackVoice(source, nodes);
  }

  _thump(strength, fromHz, toHz, duration, delay = 0) {
    if (!(strength > 0)||this._voices.size>=96) return;
    const ctx = this.context;
    const now = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(fromHz, now);
    oscillator.frequency.exponentialRampToValueAtTime(toHz, now + duration);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(strength, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    const nodes=[gain];this._routeSfx(gain,nodes);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    this._trackVoice(oscillator, nodes);
  }

  // One position per physics callback; all layers share the same stereo image.
  setScene(state={},event={}) {
    this._eventPan=Number.isFinite(event.x)&&Number.isFinite(state.x)?TruckAudio.clamp((event.x-state.x)/22,-.75,.75):0;
  }
  _routeSfx(node,nodes) {
    if(this.context.createStereoPanner&&Math.abs(this._eventPan)>.01){
      const pan=this.context.createStereoPanner();pan.pan.value=this._eventPan;node.connect(pan);pan.connect(this.sfxBus);nodes.push(pan);
    }else node.connect(this.sfxBus);
  }
  _noiseSweep(strength,fromHz,toHz,duration,delay=0) {
    if(!(strength>0)||this._voices.size>=96)return;
    const ctx=this.context,now=ctx.currentTime+delay,source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    source.buffer=this._noise;filter.type='bandpass';filter.Q.value=.65;
    filter.frequency.setValueAtTime(fromHz,now);filter.frequency.exponentialRampToValueAtTime(toHz,now+duration);
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(strength,now+duration*.18);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
    source.connect(filter);filter.connect(gain);const nodes=[filter,gain];this._routeSfx(gain,nodes);
    source.start(now,Math.random());source.stop(now+duration+.025);this._trackVoice(source,nodes);
  }
  _focus(seconds=.3,depth=.5) {
    if(this.context.state!=='running')return;
    const t=this.context.currentTime,p=this.engineFocus.gain;this._focusUntil=Math.max(this._focusUntil,t+seconds);
    if(p.cancelAndHoldAtTime)p.cancelAndHoldAtTime(t);else{const value=p.value;p.cancelScheduledValues(t);p.setValueAtTime(value,t);}
    p.linearRampToValueAtTime(depth,t+.008);p.linearRampToValueAtTime(1,this._focusUntil);
  }
  _metal(strength,frequency=490,duration=.15,delay=0) {
    // Inharmonic body modes distinguish a steel chassis from the tyre thud.
    for(let i=0;i<3;i++)this._thump(strength*[1,.45,.24][i],frequency*[1,1.37,2.07][i],frequency*[.88,1.3,1.96][i],duration/(1+i*.45),delay+i*.003);
  }
  slowMotion(scale=1) {
    const was=this._slow;if(scale<.6)this._slow=true;else if(scale>.9)this._slow=false;
    if(was===this._slow||!this._cue('slow',.35))return;
    this._noiseSweep(.035,this._slow?2100:380,this._slow?220:1700,this._slow?.4:.22);
    if(this._slow)this._thump(.035,75,34,.35);
  }

  takeoff(strength = 0.5) {
    if (!this._canPlay()) return;
    const now = this.context.currentTime;
    if (now - this._lastTakeoff < 0.35) return;
    this._lastTakeoff = now;
    const s = TruckAudio.clamp(strength, 0, 1);
    // Tyres release grit, suspension unloads, then a rising air sweep opens up.
    this._noiseBurst(.025+s*.035,1100,.14,0,'bandpass');
    this._thump(.025+s*.025,155,70,.13);
    this._metal(s*.009,310,.11,.012);
    this._noiseSweep(.018+s*.03,450,2400,.32,.035);
  }

  landing(strength = 0.5, options={}) {
    if (!this._canPlay()) return;
    const now = this.context.currentTime;
    if (now - this._lastLanding < 0.2) return;
    this._lastLanding = now;if(options.perfect)this.perfect();
    const s = TruckAudio.clamp(strength, 0, 1);
    if(this.music&&s>.3)this.music.duck(.18+s*.18,.6-s*.2);
    // Front tyre/body slam, compressed air, second axle, then scattered gravel.
    this._thump(.075+s*.2,110+s*18,30,.2+s*.13);
    this._noiseBurst(.04+s*.13,700+s*1800,.18+s*.19);
    this._metal(s*.032,290,.15,.018);
    this._thump(s*.065,86,38,.14,.045);
    this._noiseSweep(s*.045,1700,380,.24,.065);
    this._noiseBurst(s*.022,3200,.07,.12,'highpass');
  }

  pickup() {
    if (!this._canPlay()) return;
    const now = this.context.currentTime;
    if (now - this._lastPickup < 0.12) return;
    this._lastPickup = now;
    // A can-cap clink followed by two quiet confirmation tones.
    this._thump(0.028, 470, 230, 0.055);
    this._noiseBurst(0.02, 1400, 0.065, 0, 'bandpass');
    this._thump(0.019, 520, 520, 0.085, 0.025);
    this._thump(0.018, 690, 690, 0.08, 0.09);
  }

  zombieHit(strength = 0.5) {
    if (!this._canPlay()) return;
    const s = TruckAudio.clamp(strength, 0, 1);
    const now = this.context.currentTime;
    if (!s || now - this._lastZombieHit < 0.07) return;
    this._lastZombieHit = now;
    // A soft, low cartoon bump and dry dust; no vocal/gory effect.
    this._thump(0.035 + s * 0.075, 125, 52, 0.11 + s * 0.055);
    this._noiseBurst(0.009 + s * 0.025, 470, 0.1);
  }

  collision(strength = 0.5) {
    if (!this._canPlay()) return;
    const s = TruckAudio.clamp(strength, 0, 1),now=this.context.currentTime;
    if (!s || now - this._lastCollision < 0.09) return;
    this._lastCollision = now;if(this.music)this.music.duck(.18+s*.2,.5);
    this._thump(.045+s*.17,105,34,.17+s*.09);
    this._noiseBurst(.025+s*.105,1600,.09+s*.14,0,'bandpass');
    this._metal(s*.055,460,.22);
    this._noiseSweep(s*.028,2800,600,.19,.045);
    this._thump(s*.028,73,33,.16,.075);
  }

  gunshot() {
    if (!this._canPlay()) return;
    const now = this.context.currentTime;
    if (now - this._lastGunshot < 0.15) return;
    this._lastGunshot = now;this._focus(.6,.35);if(this.music)this.music.duck(.65,.2);
    // Sharp muzzle crack, chesty blast, barrel ring, bolt, outdoor reflections.
    this._noiseBurst(.2,1800,.055,0,'highpass');
    this._noiseBurst(.095,1200,.18);
    this._thump(.25,136,33,.27);
    this._metal(.028,720,.13,.012);
    this._thump(.045,440,160,.07,.045);
    this._noiseBurst(.035,2400,.065,.085,'bandpass');
    this._noiseBurst(.028,850,.18,.115);
    this._noiseBurst(.013,650,.22,.23);
  }

  _monsterGrowl(strength, duration, delay = 0) {
    if (!(strength > 0)||this._voices.size>=96) return;
    const ctx = this.context, now = ctx.currentTime + delay;
    const source = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.type = 'sawtooth';
    source.frequency.setValueAtTime(115, now);
    source.frequency.exponentialRampToValueAtTime(45, now + duration);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(310, now);
    filter.frequency.exponentialRampToValueAtTime(145, now + duration);
    filter.Q.value = 0.85;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(strength, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter); filter.connect(gain);const nodes=[filter,gain];this._routeSfx(gain,nodes);
    source.start(now); source.stop(now + duration + 0.025);
    this._trackVoice(source, nodes);
  }

  monsterHit() {
    if (!this._canPlay()) return;
    const now = this.context.currentTime;
    if (now - this._lastMonsterHit < 0.12) return;
    this._lastMonsterHit = now;
    this._focus(.35,.55);if(this.music)this.music.duck(.4,.35);
    this._thump(.19,155,38,.29);
    this._noiseBurst(.105,2300,.18,0,'bandpass');
    this._noiseBurst(.04,3700,.11,.045,'highpass');
    this._monsterGrowl(.085,.34,.018);
    this._noiseSweep(.04,1400,300,.35,.09);
    this._thump(.05,74,32,.2,.14);
  }

  monsterCrash() {
    if (!this._canPlay()) return;
    const now = this.context.currentTime;
    if (now - this._lastMonsterCrash < 0.22) return;
    this._lastMonsterCrash = now;if(this.music)this.music.duck(.5,.25);
    this._thump(.25,103,27,.32);
    this._thump(.085,72,30,.21,.055);
    this._noiseBurst(.15,1450,.23);
    this._metal(.07,390,.27,.018);
    this._noiseSweep(.06,2400,410,.33,.065);
    this._monsterGrowl(.085,.28,.025);
  }

  result(won = true) {
    if (!this._canPlay()) return;
    const now = this.context.currentTime;
    if (now - this._lastResult < 0.4) return;
    this._lastResult = now;if(this.music)this.music.stinger(won);
    // Compact cues fit the game's 200 ms result-to-pause transition. They use
    // the same master gate as driving sounds and never bypass pause or mute.
    if (won) {
      this._thump(0.028, 220, 220, 0.12);
      this._thump(0.023, 277.18, 277.18, 0.11, 0.035);
      this._thump(0.025, 329.63, 329.63, 0.1, 0.075);
    } else {
      this._thump(0.035, 146.83, 110, 0.12);
      this._thump(0.024, 98, 73.42, 0.1, 0.065);
      this._noiseBurst(0.012, 320, 0.11, 0.025);
    }
  }
  _cue(name,cooldown=.12){if(!this._canPlay())return false;const now=this.context.currentTime;if(now-(this._cueTimes[name]??-10)<cooldown)return false;this._cueTimes[name]=now;return true;}
  flip(count=1){if(!this._cue('flip',.2))return;this._thump(.035,330+count*70,490+count*80,.14);this._noiseBurst(.012,2200,.10,0,'bandpass');}
  perfect(){if(!this._cue('perfect',.25))return;this._thump(.035,660,660,.14);this._thump(.025,880,880,.12,.04);}
  combo(n=2){if(!this._cue('combo',.18))return;const f=300+Math.min(8,n)*70;this._thump(.025,f,f*1.25,.11);}
  scoreTick(){if(this._cue('tick',.07))this._thump(.03,1100,950,.035);}
  star(index=0){if(!this._cue('star'+index,.25))return;const f=[523.25,659.25,783.99][Math.max(0,Math.min(2,index))];this._thump(.04,f,f,.16);this._thump(.02,f*2,f*2,.12,.04);}
  checkpoint(){if(!this._cue('checkpoint',.4))return;this._thump(.028,440,440,.10);this._thump(.03,660,660,.12,.06);}
  lowFuel(){if(!this._cue('fuelwarn',3))return;this._thump(.035,220,220,.13);this._thump(.025,220,220,.10,.18);}
  countdown(n=3){if(this._cue('count'+n,.4))this._thump(.04,310,310,.12);}
  go(){if(!this._cue('go',.5))return;this._thump(.05,620,930,.19);this._noiseBurst(.025,1400,.15);}
  ui(kind='move'){if(!this._cue('ui'+kind,.06))return;const f={move:500,confirm:740,back:360,buy:880,error:170}[kind]||500;this._thump(kind==='buy'?.035:.03,f,kind==='error'?110:f,.055);if(kind==='buy')this._thump(.025,1174,1174,.12,.05);}
  celebrate(){if(!this._cue('celebrate',.6))return;for(let i=0;i<3;i++)this._thump(.035,[440,554.37,659.25][i],[440,554.37,659.25][i],.19,i*.07);}

}
globalThis.TruckAudio = TruckAudio;
