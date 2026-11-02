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
    this._noise = null;
    this._ratios = [24, 18, 14, 11, 9];
  }

  static clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  }

  // Must be called by a pointer/key gesture; repeated calls reuse the same graph.
  async unlock() {
    try {
      if (!this.context) {
        const AudioContextType = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextType) return false;
        this.context = new AudioContextType();
        this._buildGraph();
      }
      if (this.context.state === 'suspended') await this.context.resume();
      this._gate();
      return this.context.state === 'running';
    } catch (error) {
      // Driving remains available when the browser/OS cannot start audio.
      console.warn('Truck audio could not start:', error.message);
      return false;
    }
  }

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

    const exhaust = ctx.createBiquadFilter();
    exhaust.type = 'lowpass';
    exhaust.frequency.value = 540;
    exhaust.Q.value = 0.7;
    const saturator = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i * 2 / (curve.length - 1)) - 1;
      curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
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
    exhaust.connect(this.master);
    this.exhaustFilter = exhaust;

    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    this.sub.frequency.value = this.rpm / 60;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0.035;
    this.sub.connect(this.subGain);
    this.subGain.connect(this.master);

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
    this.intakeGain.connect(this.master);

    this._noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const noiseData = this._noise.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
    this.gravel = this._noiseLayer('bandpass', 1100, 0.6);
    this.wind = this._noiseLayer('lowpass', 650, 0.35);
    this.exhaustNoise = this._noiseLayer('lowpass', 240, 0.6);
    this.engine.start();
    this.sub.start();
    this.intake.start();
    this._ready = true;
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
    gain.connect(this.master);
    source.start(0, Math.random());
    return { source, filter, gain };
  }

  _set(param, value, smoothing = 0.055) {
    if (!this.context || !param || !Number.isFinite(value)) return;
    param.setTargetAtTime(value, this.context.currentTime, smoothing);
  }

  _gate() {
    if (!this._ready) return;
    this._set(this.master.gain, this.muted || this.paused ? 0 : 0.54, 0.035);
  }

  setMuted(muted) {
    this.muted = !!muted;
    this._gate();
  }

  setPaused(paused) {
    this.paused = !!paused;
    this._gate();
  }

  update(state = {}, dt = 1 / 60) {
    dt = TruckAudio.clamp(dt, 0, 0.1);
    const speed = TruckAudio.clamp(state.speed, -70, 70);
    const absSpeed = Math.abs(speed);
    const wheelSpeed = TruckAudio.clamp(state.wheelSpeed, 0, 130);
    const throttle = Math.abs(TruckAudio.clamp(state.throttle, -1, 1));
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
    const rev = (this.rpm - 780) / 4420;
    this._set(this.engine.frequency, this.rpm / 120, 0.045);
    this._set(this.sub.frequency, this.rpm / 60, 0.06);
    this._set(this.intake.frequency, this.rpm / 30, 0.055);
    this._set(this.engineGain.gain, 0.115 + throttle * 0.065 + rev * 0.014);
    this._set(this.subGain.gain, 0.028 + throttle * 0.021);
    this._set(this.exhaustFilter.frequency, 400 + rev * 850 + throttle * 700);
    this._set(this.intakeGain.gain, throttle * (0.009 + rev * 0.016));
    this._set(this.exhaustNoise.gain.gain, 0.012 + throttle * 0.022);
    this._set(this.exhaustNoise.filter.frequency, 180 + rev * 400);
    // Wheel slip is an approximation: tire radius is ~0.75 m in the game.
    const slip = Math.min(1, Math.abs(wheelSpeed * 0.75 - absSpeed) / 12);
    const roadAmount = grounded ? Math.min(1, absSpeed / 22) : 0;
    this._set(this.gravel.gain.gain, roadAmount * (0.018 + slip * 0.035), 0.08);
    this._set(this.gravel.filter.frequency, 750 + absSpeed * 35);
    const air = !grounded ? Math.min(1, TruckAudio.clamp(state.airtime, 0, 5) / 0.5) : 0;
    this._set(this.wind.gain.gain, Math.min(0.055, absSpeed * 0.0011) * (0.22 + air * 0.78), 0.16);
    this._set(this.wind.filter.frequency, 380 + absSpeed * 24, 0.18);
  }

  _canPlay() {
    return this._ready && !this.paused && !this.muted && this.context.state === 'running';
  }

  _noiseBurst(strength, frequency, duration, delay = 0, type = 'lowpass') {
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
    gain.connect(this.master);
    source.start(now, Math.random());
    source.stop(now + duration + 0.03);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  _thump(strength, fromHz, toHz, duration, delay = 0) {
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
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  takeoff(strength = 0.5) {
    if (!this._canPlay()) return;
    const now = this.context.currentTime;
    if (now - this._lastTakeoff < 0.35) return;
    this._lastTakeoff = now;
    const s = TruckAudio.clamp(strength, 0, 1);
    // A short hydraulic release and tire scrabble; the wind layer supplies air.
    this._noiseBurst(0.018 + s * 0.026, 850, 0.13, 0, 'bandpass');
    this._thump(0.016 + s * 0.02, 125, 76, 0.11);
  }

  landing(strength = 0.5) {
    if (!this._canPlay()) return;
    const now = this.context.currentTime;
    if (now - this._lastLanding < 0.2) return;
    this._lastLanding = now;
    const s = TruckAudio.clamp(strength, 0, 1);
    // Rubber impact, displaced dirt and a small second-axle/chassis response.
    this._thump(0.07 + s * 0.18, 92 + s * 20, 32, 0.17 + s * 0.1);
    this._noiseBurst(0.035 + s * 0.11, 600 + s * 1500, 0.16 + s * 0.18);
    this._thump(s * 0.034, 340, 165, 0.085, 0.028);
    this._noiseBurst(s * 0.035, 1150, 0.1, 0.055, 'bandpass');
  }
}
window.TruckAudio = TruckAudio;
