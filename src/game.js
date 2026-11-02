/* IRONTRAIL presentation and game loop. Edit sources, then run python3 build.py. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('gameCanvas'), ctx = canvas.getContext('2d');
  const physics = new TruckPhysics(), audio = new TruckAudio();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const fract = n => n - Math.floor(n);
  const rand = n => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
  const fmtTime = seconds => {
    const cs = Math.floor(seconds * 100 + 0.00001);
    return `${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
  };
  let mode = 'ready', time = 0, bestAir = 0, checkpoint = 0, recoveries = 0;
  let bestTime = null, width = 0, height = 0, scale = 40, baseScale = 40;
  let groundRatio = .77;
  let camera = { x: 0, y: 0 }, last = performance.now(), accumulator = 0;
  let state = physics.getState(), shake = 0, toastUntil = 0, particles = [];
  let dustClock = 0, flippedTime = 0, hudClock = 0, offscreenRecoveryClock = 0;
  const keys = new Set(), pointers = new Map();
  const STEP = 1 / 120;
  try { const stored = Number(localStorage.getItem('irontrail-best-v2')); if (stored > 0 && Number.isFinite(stored)) bestTime = stored; } catch (_) { /* Private/file mode can deny storage. */ }
  function updateBest() { $('bestValue').textContent = bestTime ? `${fmtTime(bestTime)} · Redstone run` : 'Your story starts here'; }
  updateBest();
  $('lengthValue').textContent = physics.track.length;
  const markers = physics.track.checkpoints.slice(1).map((cp, i) => {
    const el = document.createElement('span'); el.className = 'progress-check';
    el.style.left = `${(cp.x - physics.track.startX) / physics.track.length * 100}%`; el.title = `Checkpoint ${i + 1}`;
    $('progressChecks').appendChild(el); return el;
  });

  function resize() {
    const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseScale = clamp(width / 28, 20, 42);
    scale = baseScale;
    if (mode === 'ready') camera = { x: state.x + width / scale * .21, y: 0 };
  }
  new ResizeObserver(resize).observe($('scene'));
  window.addEventListener('resize', resize);

  function input() {
    const active = name => [...pointers.values()].includes(name);
    const gas = keys.has('ArrowUp') || keys.has('KeyW') || active('gas');
    const reverse = keys.has('ArrowDown') || keys.has('KeyS') || active('reverse');
    return { throttle: Number(gas) - Number(reverse), brake: keys.has('Space') || active('brake'),
      lean: Number(keys.has('ArrowRight') || keys.has('KeyD') || active('right')) - Number(keys.has('ArrowLeft') || keys.has('KeyA') || active('left')) };
  }
  function clearInput() { keys.clear(); pointers.clear(); document.querySelectorAll('.pedal').forEach(b => b.classList.remove('pressed')); }
  function showToast(message, duration = 2) { $('toast').textContent = message; $('toast').classList.add('show'); toastUntil = performance.now() + duration * 1000; }
  function setOverlay(kicker, title, copy, button, hint) {
    $('overlayKicker').textContent = kicker; $('overlayTitle').innerHTML = title;
    $('overlayCopy').textContent = copy; $('playLabel').textContent = button;
    $('overlayHint').textContent = hint; $('overlay').hidden = false;
  }
  function syncPauseButton() {
    $('pauseButton').disabled = mode === 'ready' || mode === 'finished';
    $('pauseButton').setAttribute('aria-label', mode === 'paused' ? 'Resume game' : 'Pause game');
    $('pauseButton').innerHTML = mode === 'paused' ? '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>';
  }
  function begin() {
    // Invoke unlock before any await, inside the actual input gesture.
    audio.unlock().then(ok => { if (!ok && !audio.muted) showToast('Audio unavailable · the trail is still open', 3); });
    if (mode === 'finished') restart(false);
    mode = 'playing'; audio.setPaused(false); $('overlay').hidden = true;
    $('pauseBackdrop').classList.remove('visible'); accumulator = 0; last = performance.now();
    syncPauseButton();
  }
  function pause() {
    if (mode === 'playing') {
      mode = 'paused'; audio.setPaused(true); clearInput();
      setOverlay('TAKE A BREATHER', 'PARKED.<br>FOR NOW.', 'The trail will be right here when you are ready.', 'Back to the trail', 'P / ESC TO RESUME');
      $('pauseBackdrop').classList.add('visible'); syncPauseButton();
    } else if (mode === 'paused') begin();
  }
  function restart(ready = false) {
    const wasReady = mode === 'ready'; physics.reset(); state = physics.getState();
    time = 0; bestAir = 0; checkpoint = 0; recoveries = 0; particles = []; shake = 0;
    accumulator = 0; flippedTime = 0; offscreenRecoveryClock = 0; clearInput();
    camera = { x: state.x + width / scale * .21, y: 0 }; audio.rpm = 820;
    $('recoverButton').classList.remove('visible'); $('toast').classList.remove('show');
    if (ready || wasReady) { mode = 'ready'; audio.setPaused(true); }
    else { audio.unlock(); mode = 'playing'; audio.setPaused(false); $('overlay').hidden = true; $('pauseBackdrop').classList.remove('visible'); }
    syncPauseButton(); updateHUD();
  }
  function recover() {
    if (mode !== 'playing') return;
    physics.reset(physics.checkpointIndex); state = physics.getState(); recoveries++;
    camera = { x: state.x + width / scale * .21, y: Math.max(0, state.y - 2.5) };
    particles = []; flippedTime = 0; offscreenRecoveryClock = 0; accumulator = 0;
    $('recoverButton').classList.remove('visible'); showToast('BACK ON TRACK · checkpoint recovered');
  }
  function finish() {
    mode = 'finished'; clearInput(); audio.setPaused(true);
    const newBest = bestTime === null || time < bestTime;
    if (newBest) { bestTime = time; try { localStorage.setItem('irontrail-best-v2', String(time)); } catch (_) {} updateBest(); }
    setOverlay(newBest ? 'A NEW PERSONAL BEST' : 'REDSTONE RUN · COMPLETE', 'TRAIL.<br>CONQUERED.', `${fmtTime(time)} on the clock. ${bestAir.toFixed(2)}s of best air. ${recoveries ? `${recoveries} checkpoint ${recoveries === 1 ? 'recovery' : 'recoveries'}.` : 'One clean ride.'}`, 'Take another run', 'THE DIRT IS ALWAYS CALLING.');
    $('pauseBackdrop').classList.add('visible'); $('recoverButton').classList.remove('visible'); syncPauseButton(); updateHUD();
  }
  function toggleSound() {
    audio.setMuted(!audio.muted);
    if (!audio.muted && mode === 'playing') audio.unlock();
    $('soundButton').setAttribute('aria-label', audio.muted ? 'Enable sound' : 'Mute sound');
    $('soundButton').setAttribute('aria-pressed', String(audio.muted));
    $('soundButton').innerHTML = `<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z${audio.muted ? 'M17 9l5 6M22 9l-5 6' : 'M17 8q4 4 0 8M20 5q7 7 0 14'}"/></svg><span class="sound-label">SOUND ${audio.muted ? 'OFF' : 'ON'}</span>`;
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if ($('gameShell')?.requestFullscreen) await $('gameShell').requestFullscreen();
      else if (document.querySelector('.game-shell').requestFullscreen) await document.querySelector('.game-shell').requestFullscreen();
      else showToast('Fullscreen is unavailable in this browser');
    } catch (_) { showToast('Fullscreen is unavailable in this preview'); }
  }
  document.addEventListener('fullscreenchange', () => {
    $('fullscreenButton').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'); resize();
  });
  $('playButton').addEventListener('click', begin); $('pauseButton').addEventListener('click', pause);
  $('restartButton').addEventListener('click', () => { if (mode === 'playing' || mode === 'paused' || mode === 'finished') audio.unlock(); restart(); });
  $('soundButton').addEventListener('click', toggleSound); $('fullscreenButton').addEventListener('click', fullscreen);
  $('recoverButton').addEventListener('click', recover);
  const controlCodes = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Space','KeyR','KeyC','KeyP','KeyM','KeyF','Escape','Enter']);
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || !controlCodes.has(e.code)) return;
    // Keep focused button activation native; global Space only brakes in play.
    if (e.target instanceof HTMLButtonElement && (e.code === 'Enter' || (e.code === 'Space' && mode !== 'playing'))) return;
    e.preventDefault();
    if (!e.repeat) {
      if (e.code === 'KeyM') return toggleSound();
      if (e.code === 'KeyF') return fullscreen();
      if (e.code === 'KeyR') { restart(); return; }
      if (e.code === 'KeyC') { recover(); return; }
      if (e.code === 'KeyP' || e.code === 'Escape') { pause(); return; }
      if (e.code === 'Enter' && mode !== 'playing') { begin(); return; }
      if ((e.code === 'ArrowUp' || e.code === 'KeyW') && mode === 'ready') begin();
    }
    if (mode === 'playing') keys.add(e.code);
  });
  window.addEventListener('keyup', e => { keys.delete(e.code); });
  document.querySelectorAll('.pedal').forEach(button => {
    button.addEventListener('pointerdown', e => {
      e.preventDefault(); if (mode !== 'playing') return;
      button.setPointerCapture(e.pointerId); pointers.set(e.pointerId, button.dataset.input); button.classList.add('pressed');
    });
    for (const event of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(event, e => { pointers.delete(e.pointerId); button.classList.remove('pressed'); });
    button.addEventListener('contextmenu', e => e.preventDefault());
  });
  window.addEventListener('blur', () => { clearInput(); if (mode === 'playing') pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); if (mode === 'playing') pause(); } });

  function addDust(x, y, count, power = 1) {
    for (let i = 0; i < count; i++) particles.push({ x, y, vx: -2 - Math.random() * 3 * power, vy: .3 + Math.random() * 2 * power,
      r: .04 + Math.random() * .13, life: .45 + Math.random() * .55, maxLife: 1, type: 'dust' });
    if (particles.length > 220) particles.splice(0, particles.length - 220);
  }
  function tick(dt) {
    const controls = input(); physics.step(dt, controls); state = physics.getState(); time += dt;
    for (const event of physics.drainEvents()) {
      if (event.type === 'takeoff') { audio.takeoff(event.strength); }
      if (event.type === 'land') {
        bestAir = Math.max(bestAir, event.airtime || 0);
        audio.landing(event.strength); shake = Math.max(shake, event.strength * 5);
        for (const wheel of state.wheels) addDust(wheel.x, wheel.y - .63, 13, event.strength + .5);
        if (event.airtime > .65) showToast(`NICE AIR · ${event.airtime.toFixed(2)} SECONDS`, 1.5);
      }
    }
    if (physics.checkpointIndex > checkpoint) { checkpoint = physics.checkpointIndex; showToast(`CHECKPOINT ${checkpoint} · KEEP IT ROLLING`, 2); }
    dustClock += dt;
    if (dustClock > .035 && state.grounded && Math.abs(state.speed) > 1) {
      dustClock = 0; for (const wheel of state.wheels) addDust(wheel.x, wheel.y - .65, 1, Math.min(1.5, Math.abs(state.speed) / 12));
    }
    const angle = Math.abs(Math.atan2(Math.sin(state.angle), Math.cos(state.angle)));
    if (angle > 1.7 && Math.abs(state.speed) < 2) flippedTime += dt; else flippedTime = 0;
    $('recoverButton').classList.toggle('visible', flippedTime > 1.2 || state.y < -3);
    if (state.y < -9 || state.x < -31) offscreenRecoveryClock += dt; else offscreenRecoveryClock = 0;
    if (offscreenRecoveryClock > .45) recover();
    if (physics.finished) finish();
  }
  function updateHUD() {
    $('timeValue').textContent = fmtTime(time); $('airValue').innerHTML = `${bestAir.toFixed(2)} <small>s</small>`;
    $('speedValue').textContent = String(Math.round(Math.abs(state.speed) * 3.6)).padStart(2, '0');
    $('gearValue').textContent = mode === 'ready' ? 'N' : audio.gear;
    const distance = clamp(state.x - physics.track.startX, 0, physics.track.length);
    const progress = distance / physics.track.length * 100;
    $('distanceValue').textContent = Math.floor(distance);
    if (mode === 'finished') $('distanceValue').textContent = physics.track.length;
    $('progressFill').style.width = `${mode === 'finished' ? 100 : progress}%`;
    markers.forEach((m, i) => m.classList.toggle('passed', checkpoint > i));
    $('checkpointLabel').textContent = mode === 'finished' ? 'TRAIL COMPLETE' : checkpoint ? `CHECKPOINT ${checkpoint} / ${markers.length}` : 'FIND YOUR LINE';
    $('driveStatus').textContent = mode === 'ready' ? 'READY TO ROLL' : mode === 'paused' ? 'ENGINE PAUSED' : mode === 'finished' ? 'TRAIL CONQUERED' : !state.grounded && state.airtime > .15 ? 'CATCHING SOME AIR' : Math.abs(state.speed) < 1 ? 'OPEN THROTTLE. GO.' : input().brake ? 'EASY ON THE BRAKES' : 'LEAVE A LITTLE DUST';
    $('rpmMeter').querySelectorAll('i').forEach((bar, i) => bar.classList.toggle('active', mode !== 'ready' && i < (audio.rpm / 5200 * 10)));
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
    // Trail distance signs and ramp warnings.
    for(const x of [55,86,165,212,283,326,402]) {
      if(x<left||x>right)continue;const y=heightAt(x);const px=sx(x),py=sy(y);
      line([px,py],[px,py-1.55*scale],'#5e6545',3);
      const isRamp=[86,212,326].includes(x);const s=scale*.34;
      if(isRamp){path([[px,py-scale*2.16],[px+s*1.1,py-scale*1.55],[px-s*1.1,py-scale*1.55]],'#e3cf76','#6a7145',1.5);line([px-s*.5,py-scale*1.7],[px+s*.4,py-scale*1.94],'#4f6244',2);}
      else{ctx.fillStyle='#344f3b';ctx.fillRect(px-scale*.52,py-scale*1.95,scale*1.04,scale*.5);ctx.font=`bold ${Math.max(8,scale*.17)}px monospace`;ctx.textAlign='center';ctx.fillStyle='#e5e8bb';ctx.fillText(`${x} M`,px,py-scale*1.63);}
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
    const x=sx(physics.track.finishX),y=sy(0),s=scale;
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
  function drawTruck() {
    const s=scale,x=sx(state.x),y=sy(state.y);
    // Elliptical ground shadow is separate from the rigid body's rotation.
    if(state.y-heightAt(state.x)<5){ctx.save();ctx.globalAlpha=clamp(.22-(state.y-heightAt(state.x)-1)*.035,.04,.23);ctx.fillStyle='#243d2c';ctx.beginPath();ctx.ellipse(x,sy(heightAt(state.x))+.1*s,s*2.4,s*.17,0,0,Math.PI*2);ctx.fill();ctx.restore();}
    const local=(lx,ly)=>({x:state.x+Math.cos(state.angle)*lx-Math.sin(state.angle)*ly,y:state.y+Math.sin(state.angle)*lx+Math.cos(state.angle)*ly});
    // Visible coilovers join the actual wheel bodies to the moving chassis.
    for(let i=0;i<2;i++){
      const mount=local(i===0?-1.25:1.25,.16),w=state.wheels[i];const a=[sx(mount.x),sy(mount.y)],b=[sx(w.x),sy(w.y)];
      line(a,b,'#1e3028',s*.14);line(a,b,'#a4ada0',s*.055);
      const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
      ctx.beginPath();ctx.moveTo(...a);for(let j=1;j<9;j++){const t=j/9,offset=j%2?3:-3;ctx.lineTo(a[0]+dx*t+nx*offset,a[1]+dy*t+ny*offset);}ctx.lineTo(...b);ctx.strokeStyle='#d0d881';ctx.lineWidth=1.5;ctx.stroke();
    }
    ctx.save();ctx.translate(x,y);ctx.rotate(-state.angle);ctx.scale(s,-s);
    const p=(points,fill,stroke,w=.025)=>path(points,fill,stroke,w);
    // Chassis, roll cage and a tough two-tone pickup body.
    p([[-2.1,-.36],[2.1,-.36],[2.1,-.19],[-2.1,-.19]],'#26392e');
    p([[-2.12,-.12],[-2.12,.43],[-1.1,.43],[-.82,1.21],[.57,1.21],[1.14,.47],[1.87,.37],[2.13,.15],[2.13,-.1],[1.84,-.24],[-1.9,-.24]],'#ccdb78','#344e38');
    p([[-2.05,.26],[-1.1,.26],[-1.12,.46],[-2.05,.46]],'#71844c');
    p([[-1.03,.47],[-.77,1.13],[.51,1.13],[1.04,.47]],'#2e493d','#45613c');
    p([[-.77,.58],[-.67,1.03],[-.08,1.03],[-.08,.58]],'#9dbda2');
    p([[.03,.58],[.03,1.03],[.43,1.03],[.82,.58]],'#8cab92');
    p([[-.62,.64],[-.53,.97],[-.19,.97]],'#c1d2a8');
    p([[-.87,1.18],[.59,1.18],[.62,1.28],[-.83,1.28]],'#4f653b');
    p([[-1.07,.45],[1.03,.45],[1.05,-.12],[-1.09,-.12]],'#bfce67');
    line([-.03,.48],[-.03,-.13],'#778c48',.018);line([-.9,.47],[-.9,-.13],'#7f924c',.018);
    p([[1.04,.45],[1.86,.36],[2.06,.18],[1.14,.23]],'#e2e69d');
    p([[-2.15,.03],[-2.15,-.21],[-1.9,-.21],[-1.9,.02]],'#374b37');
    p([[1.93,.06],[2.21,.06],[2.21,-.17],[1.98,-.17]],'#354d3d');
    p([[1.97,.23],[2.12,.15],[2.12,.04],[1.96,.04]],'#f3edb4');
    p([[-2.13,.23],[-2.02,.23],[-2.02,.05],[-2.13,.05]],'#b5744a');
    p([[-1.94,-.15],[-1.88,.06],[-1.72,.18],[-1.42,.18],[-1.2,.04],[-1.13,-.15]],'#344d36');
    p([[1.08,-.15],[1.16,.05],[1.34,.18],[1.7,.18],[1.92,.04],[1.99,-.15]],'#344d36');
    ctx.save();ctx.scale(1,-1);ctx.fillStyle='#3b5939';ctx.font='900 .32px Arial';ctx.textAlign='center';ctx.fillText('IRON',.46,-.05);ctx.font='bold .12px monospace';ctx.fillText('TRAILBREAKER',-.45,.02);ctx.restore();
    p([[-.97,.51],[-1.17,.6],[-1.17,.71],[-.94,.7]],'#344a37');
    // Exhaust stack and bumper hardware.
    line([-1.29,.4],[-1.29,1.05],'#59664d',.075);line([-1.29,1.05],[-1.42,1.12],'#59664d',.075);
    ctx.restore();
    for(const wheel of state.wheels) drawWheel(wheel);
  }
  function drawWheel(wheel) {
    const x=sx(wheel.x),y=sy(wheel.y),r=scale*.72;ctx.save();ctx.translate(x,y);ctx.rotate(-wheel.angle);
    circle(0,0,r*1.04,'#263a2d');circle(0,0,r*.91,'#314435');circle(0,0,r*.72,'#1f352c');
    for(let i=0;i<18;i++){ctx.save();ctx.rotate(i*Math.PI/9);ctx.fillStyle=i%2?'#4c5b3e':'#526044';ctx.fillRect(-r*.115,-r*.97,r*.23,r*.23);ctx.restore();}
    circle(0,0,r*.55,'#7e8d68');circle(0,0,r*.43,'#b0ba8d');
    for(let i=0;i<6;i++){const a=i*Math.PI/3;circle(Math.cos(a)*r*.31,Math.sin(a)*r*.31,r*.075,'#344c36');}
    circle(0,0,r*.15,'#445e3f');circle(0,0,r*.065,'#cdd4a2');ctx.restore();
  }
  function drawParticles(dt) {
    for(let i=particles.length-1;i>=0;i--){const p=particles[i];if(mode==='playing'){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy-=dt*.7;p.life-=dt;p.r+=dt*.12;}if(p.life<=0){particles.splice(i,1);continue;}ctx.globalAlpha=clamp(p.life*.4,0,.35);circle(sx(p.x),sy(p.y),p.r*scale,'#d0ce96');}ctx.globalAlpha=1;
  }
  function render(dt) {
    const touchLayout = width < 780 || window.matchMedia('(pointer:coarse)').matches;
    groundRatio = lerp(groundRatio, touchLayout && mode !== 'ready' ? .68 : .77, 1 - Math.exp(-dt * 4));
    scale=lerp(scale,baseScale*(1-Math.min(.1,Math.abs(state.speed)/240)),Math.min(1,dt*2));
    const targetX=state.x+width/scale*.21+clamp(state.speed*.12,-1.8,2.5);
    camera.x=lerp(camera.x,targetX,1-Math.exp(-dt*4));camera.y=lerp(camera.y,Math.max(0,state.y-2.9),1-Math.exp(-dt*3));
    ctx.save();if(shake>.05){ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);shake*=Math.exp(-dt*14);}
    drawBackground();drawDecor();drawTerrain();drawTruck();drawParticles(dt);ctx.restore();
  }
  function frame(now) {
    const dt=clamp((now-last)/1000,0,.05);last=now;
    if(mode==='playing'){
      accumulator+=dt;let steps=0;
      while(accumulator>=STEP&&steps++<7&&mode==='playing'){tick(STEP);accumulator-=STEP;}
      if(accumulator<0)accumulator=0;
      if(mode==='playing')audio.update({...state,throttle:input().throttle},dt);
    } else accumulator=0;
    render(dt);hudClock+=dt;if(hudClock>.05){updateHUD();hudClock=0;}
    if(toastUntil&&now>toastUntil){$('toast').classList.remove('show');toastUntil=0;}
    requestAnimationFrame(frame);
  }
  // Small read-only diagnostics object for QA and future model handoff.
  window.irontrail = { get mode(){return mode;}, get telemetry(){return {...state,time,bestAir,checkpoint,recoveries};}, get physics(){return physics;}, get audio(){return audio;} };
  audio.setPaused(true);resize();updateHUD();requestAnimationFrame(frame);
})();
