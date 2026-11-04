/* IRONTRAIL campaign physics. Planck.js 1.5.0; metres, seconds, radians, Y up.
 * Entity contact callbacks only enqueue work. All body changes happen unlocked.
 */
(function (global) {
  'use strict';
  const P = global.planck;
  if (!P) throw new Error('Planck.js must load before TruckPhysics.');
  const V = P.Vec2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const NAMES = ['Ojas Speedway', 'Dry Creek', 'Hollow Ridge', 'Graveyard Pass', 'Deadwood Dunes', 'Rust Canyon', 'Bone Valley', 'Ashen Heights', 'Last Refuge', 'Iron Maw Showdown'];
  const SUBTITLES = ['Your first super-truck adventure', 'Follow the empty riverbed', 'Keep your wheels under you', 'The dead own this road', 'A little less room to breathe', 'Rust, dust and bigger jumps', 'No easy way through', 'High ground. Low reserves.', 'One last road to safety', 'Beat Iron Maw to the line'];
  const LENGTHS = [220, 250, 285, 320, 355, 390, 425, 465, 510, 560];
  const FUEL_RATES = [5.98, 6.75, 7.90, 8.00, 8.25, 8.30, 8.95, 8.98, 9.25, 9.35];
  const POSE = Object.freeze({ PLAYER: 0, PLAYER_WHEEL_REAR: 1, PLAYER_WHEEL_FRONT: 2, RIVAL: 3,
    RIVAL_WHEEL_REAR: 4, RIVAL_WHEEL_FRONT: 5, PROJECTILE: 6, ZOMBIES: 7, STRIDE: 3 });
  const upgrade = values => Object.freeze(values);
  const UPGRADES = Object.freeze({
    engine: Object.freeze({ torque: upgrade([1, 1.1, 1.2, 1.3]), speed: upgrade([1, 1.04, 1.08, 1.12]) }),
    tyres: Object.freeze({ grip: upgrade([1, 1.08, 1.16, 1.24]) }),
    suspension: Object.freeze({ frequencyHz: upgrade([4.4, 4.6, 4.8, 5]), dampingRatio: upgrade([0.85, 0.86, 0.87, 0.88]), airControl: upgrade([1, 1.15, 1.3, 1.45]) }),
    tank: Object.freeze({ drain: upgrade([1, 0.93, 0.86, 0.79]) })
  });
  const RIVAL_TUNING = Object.freeze({ motorSpeed: 34.3, engineSpeedPerLevel: 0.035, engineTorquePerLevel: 0.06,
    startGap: 6, rampLift: 0.9 });
  const STAGES = Object.freeze(NAMES.map((name, i) => Object.freeze({
    id: i + 1, name, subtitle: SUBTITLES[i], length: LENGTHS[i], difficulty: i + 1,
    boss: i === 9, fuelDrain: FUEL_RATES[i], fuelInterval: 78 + i * 2,
    zombieCount: 5 + i * 3, gapWidth: 2.2 + i * 0.38
  })));

  class TruckPhysics {
    static get STAGES() { return STAGES; }
    static get POSE() { return POSE; }
    static get UPGRADES() { return UPGRADES; }
    static get RIVAL_TUNING() { return RIVAL_TUNING; }

    static warmUp(milliseconds = 60) {
      const now = () => typeof performance === 'object' ? performance.now() : Date.now();
      const started = now(), game = new TruckPhysics(0, { random: () => 0.5 });
      let steps = 0;
      while (now() - started < Math.max(0, Number(milliseconds) || 0)) {
        if (game.getState().weapon.canHit) game.fire();
        game.step(1 / 120, { throttle: 1 }); steps++;
        if (game.failed || game.finished) game.restart();
      }
      return { steps, milliseconds: now() - started };
    }

    constructor(stageIndex = 0, options = {}) {
      this.stageIndex = clamp(Math.floor(Number(stageIndex) || 0), 0, STAGES.length - 1);
      this.stage = STAGES[this.stageIndex];
      this.random = typeof options.random === 'function' ? options.random : Math.random;
      const tuning = options.tuning || {};
      this.tuning = Object.freeze({ engine: clamp(Math.floor(Number(tuning.engine) || 0), 0, 3),
        tyres: clamp(Math.floor(Number(tuning.tyres) || 0), 0, 3),
        suspension: clamp(Math.floor(Number(tuning.suspension) || 0), 0, 3), tank: clamp(Math.floor(Number(tuning.tank) || 0), 0, 3) });
      this._force = V(0, 0); this._rayFrom = V(0, 0); this._rayTo = V(0, 0);
      this._aimMuzzle = V(0, 0); this._bulletTo = V(0, 0);
      this._rayResult = { type: '', fixture: null, x: 0, y: 0, fraction: 1 };
      this._rayCallback = (fixture, point, normal, fraction) => {
        const type = fixture.getBody().getUserData()?.type;
        if (type !== 'ground' && type !== 'monster') return -1;
        if (!this._rayFound || fraction < this._rayResult.fraction) {
          const result = this._rayResult; result.type = type; result.fixture = fixture;
          result.x = point.x; result.y = point.y; result.fraction = fraction; this._rayFound = true;
        }
        return fraction;
      };
      this.track = this._makeTrack();
      this._segmentStarts = new Float64Array(this.track.segments.length);
      for (let i = 0; i < this.track.segments.length; i++) {
        const segment = this.track.segments[i]; this._segmentStarts[i] = segment[0].x;
        segment.xs = new Float64Array(segment.length);
        for (let j = 0; j < segment.length; j++) segment.xs[j] = segment[j].x;
      }
      this.restart();
    }

    _makeTrack() {
      const d = this.stage.difficulty, startX = 7.5, finishX = startX + this.stage.length;
      const count = 2 + Math.floor((d - 1) / 2), span = (this.stage.length - 25) / count;
      const layouts = [], features = [], canXs = [], checkpoints = [{ x: startX - 1.5, y: 0 }];
      const grammar = ['rollers', 'hill', 'table', 'climb', 'drop'];
      let start = -35;
      for (let i = 0; i < count; i++) {
        const base = startX + 12 + i * span;
        const end = startX + 12 + (i + 1) * span - this.stage.gapWidth;
        const previousKicker = d >= 3 && i === 1;
        const kind = previousKicker ? 'run-up' : grammar[(this.stageIndex * 2 + i) % grammar.length];
        const amp = 1.1 + d * 0.17, nodes = [[start, 0], [base + 10, 0]];
        const add = (x, y, mode) => nodes.push([base + x, y, mode]);
        if (kind === 'rollers') {
          for (let r = 0; r < 3; r++) { add(15 + r * 9, 0.65 + d * 0.045); add(19.5 + r * 9, 0); }
        } else if (kind === 'hill') { add(23, amp); add(30, amp); add(44, 0); }
        else if (kind === 'table') { add(21, amp + 0.6); add(33, amp + 0.6); add(44, 0); }
        else if (kind === 'climb') { add(24, Math.min(3.8, amp + 1.3)); add(31, Math.min(3.8, amp + 1.3)); add(45, 0); }
        else if (kind === 'drop') { add(22, amp + 0.5); add(31, amp + 0.5); add(38, 0, 'linear'); add(45, 0); }
        else { add(42, 0); }
        const bigKicker = d >= 3 && i === 0;
        const rampAngle = (bigKicker ? 24 + (d - 3) * 0.35 : 14 + d * 0.45) * Math.PI / 180;
        const rampHeight = bigKicker ? 4 : 2.0 + d * 0.08;
        const rampStart = end - rampHeight / Math.tan(rampAngle);
        nodes.push([rampStart, 0], [end, rampHeight, 'linear']);
        layouts.push(nodes);
        features.push({ kind, startX: base + 10, endX: base + 45, height: amp },
          { kind: bigKicker ? 'kicker' : 'ramp', startX: rampStart, endX: end, angle: rampAngle, height: rampHeight });
        canXs.push(base + 53);
        start = end + this.stage.gapWidth;
        if (i < count - 1) checkpoints.push({ x: start + 4.2, y: 0 });
      }
      // Landing apron and flat run-in leave room for a clean finish.
      layouts.push([[start, 0], [finishX + 25, 0]]);
      // Early supply pairs cap the tank before a deliberate final reserve leg.
      // This gives a readable declining fuel curve without starving slower input.
      if (d >= 5) {
        canXs.pop();
        canXs.push(features[1].endX - 3);
      }
      if (d === 8) canXs[1] += 18;
      if (d === 6) { canXs[1] += 15; canXs[2] += 7; }
      if (d === 9) { canXs.splice(4, 1); canXs.push(170, 366); }
      if (d === 10) canXs.push(features[5].endX - 3);
      canXs.sort((a, b) => a - b);
      const segments = layouts.map(nodes => {
        const out = [{ x: nodes[0][0], y: nodes[0][1] }];
        for (let n = 1; n < nodes.length; n++) {
          const a = nodes[n - 1], b = nodes[n], samples = Math.ceil((b[0] - a[0]) / 0.65);
          for (let j = 1; j <= samples; j++) {
            const t = j / samples, f = b[2] === 'linear' ? t : (1 - Math.cos(Math.PI * t)) / 2;
            out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * f });
          }
        }
        return out;
      });
      return { segments, checkpoints, startX, finishX, length: this.stage.length, features, canXs };
    }

    _segmentAt(x) {
      let lo = 0, hi = this._segmentStarts.length - 1;
      while (lo <= hi) { const mid = (lo + hi) >>> 1; if (this._segmentStarts[mid] <= x) lo = mid + 1; else hi = mid - 1; }
      if (hi < 0) return undefined;
      const segment = this.track.segments[hi];
      return x <= segment[segment.length - 1].x ? segment : undefined;
    }

    _heightAt(x) {
      const segment = this._segmentAt(x);
      if (!segment) return 0;
      let lo = 1, hi = segment.length - 1;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (segment.xs[mid] < x) lo = mid + 1; else hi = mid; }
      const a = segment[lo - 1], b = segment[lo];
      return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
    }

    _slopeAt(x) {
      const segment = this._segmentAt(x);
      if (!segment) return 0;
      // Clamp both samples to this chain; a gap must not look like a cliff slope.
      const lo = Math.max(segment[0].x, x - 1), hi = Math.min(segment[segment.length - 1].x, x + 1);
      return Math.atan2(this._heightAt(hi) - this._heightAt(lo), Math.max(0.01, hi - lo));
    }

    _safeEntityX(x, margin = 7) {
      const segment = this._segmentAt(x);
      if (!segment) {
        const next = this.track.segments.find(s => s[0].x > x);
        return next ? next[0].x + margin : x;
      }
      return clamp(x, segment[0].x + margin, segment[segment.length - 1].x - margin);
    }

    _createMonster() {
      const candidates = [];
      for (let x = this.track.startX + 65; x <= this.track.finishX - 38; x += 1) {
        const segment = this._segmentAt(x);
        if (!segment || x - segment[0].x < 12 || segment[segment.length - 1].x - x < 12) continue;
        if (this.track.checkpoints.some(cp => Math.abs(cp.x - x) < 14)) continue;
        if (Math.abs(this._heightAt(x + 2) - this._heightAt(x - 2)) / 4 > 0.055) continue;
        candidates.push(x);
      }
      // Every authored stage has several flat valleys/plateaus in this range.
      if (!candidates.length) throw new Error('The stage needs a safe monster spawn zone.');
      const sample = Number(this.random()), roll = Number.isFinite(sample) ? clamp(sample, 0, 0.999999999) : 0.5;
      const x = candidates[Math.floor(roll * candidates.length)], y = this._heightAt(x);
      const monster = { x, y, width: 3, height: 4.8, weakpoint: { x, y: y + 2.85 }, alive: true, hit: false, timeSinceHit: 0 };
      monster.body = this.world.createBody({ position: V(x, y + monster.height / 2) });
      monster.body.setUserData({ type: 'monster', entity: monster });
      monster.body.createFixture(new P.Box(monster.width / 2, monster.height / 2), {
        friction: 0.8, restitution: 0.05, filterCategoryBits: 16, filterMaskBits: 2
      });
      return monster;
    }

    _rayHit(from, to) {
      this._rayFrom.set(from.x, from.y); this._rayTo.set(to.x, to.y); this._rayFound = false;
      this.world.rayCast(this._rayFrom, this._rayTo, this._rayCallback);
      return this._rayFound ? this._rayResult : null;
    }

    _weaponState() {
      if (!this._weaponDirty && this._weaponCache) return this._weaponCache;
      this._weaponDirty = false;
      const result = this._weaponCache || (this._weaponCache = { mount: {}, muzzle: {}, target: {}, angle: 0, range: 45, canHit: false, distance: 0 });
      const p = this.chassis.getPosition(), bodyAngle = this.chassis.getAngle();
      const c = Math.cos(bodyAngle), s = Math.sin(bodyAngle), mount = result.mount;
      mount.x = p.x + c * 0.2 - s * 1.4; mount.y = p.y + s * 0.2 + c * 1.4;
      const target = this.monster.weakpoint, dx = target.x - mount.x, dy = target.y - mount.y;
      const aimAngle = Math.atan2(dy, dx), aimDistance = Math.hypot(dx, dy) - 1.45;
      const aimedMuzzle = this._aimMuzzle; aimedMuzzle.set(mount.x + Math.cos(aimAngle) * 1.45, mount.y + Math.sin(aimAngle) * 1.45);
      const inRange = this.monster.alive && dx > 0 && aimDistance <= 45;
      const sight = inRange ? this._rayHit(aimedMuzzle, target) : null;
      const clear = inRange && sight?.type === 'monster';
      const angle = clear ? aimAngle : this.chassis.getAngle();
      const muzzle = result.muzzle; muzzle.x = mount.x + Math.cos(angle) * 1.45; muzzle.y = mount.y + Math.sin(angle) * 1.45;
      result.mount.x = mount.x; result.mount.y = mount.y; result.muzzle.x = muzzle.x; result.muzzle.y = muzzle.y;
      result.target.x = target.x; result.target.y = target.y; result.angle = angle;
      result.canHit = !!(clear && this.ammo > 0 && !this.failed && !this.winner); result.distance = Math.max(0, aimDistance);
      return result;
    }

    fire() {
      if (this.failed || this.winner || this.ammo <= 0) return false;
      const weapon = this._weaponState();
      this.ammo = 0;
      this._weaponDirty = true;
      this.projectile = { x: weapon.muzzle.x, y: weapon.muzzle.y, prevX: weapon.muzzle.x, prevY: weapon.muzzle.y,
        angle: weapon.angle, speed: 75, remaining: weapon.range, life: weapon.range / 75 };
      this.events.push({ type: 'shot', x: weapon.muzzle.x, y: weapon.muzzle.y, angle: weapon.angle });
      return true;
    }

    _advanceProjectile(dt) {
      if (!this.projectile) return;
      const bullet = this.projectile, distance = Math.min(bullet.remaining, bullet.speed * dt);
      const next = this._bulletTo; next.set(bullet.x + Math.cos(bullet.angle) * distance, bullet.y + Math.sin(bullet.angle) * distance);
      const hit = this._rayHit(bullet, next);
      bullet.prevX = bullet.x; bullet.prevY = bullet.y;
      bullet.x = hit ? hit.x : next.x; bullet.y = hit ? hit.y : next.y;
      bullet.remaining -= distance; bullet.life = Math.max(0, bullet.remaining / bullet.speed);
      if (hit?.type === 'monster' && this.monster.alive) {
        this.monster.alive = false; this.monster.hit = true; this.monster.timeSinceHit = 0;
        this.monster.body.setActive(false);
        this.events.push({ type: 'monsterHit', x: this.monster.x, y: this.monster.weakpoint.y, strength: 1 });
      }
      if (hit || bullet.remaining <= 0.000001) this.projectile = null;
    }

    _failMonster() {
      if (this.failed || this.winner) return;
      this.failed = 'monster'; this.finished = false;
      this._weaponDirty = true;
      this.events.push({ type: 'monsterCrash', x: this.monster.x, y: this.monster.y + 2.4, strength: 1 });
    }

    restart() {
      this.world = new P.World({ gravity: V(0, -14), allowSleep: true });
      this.ground = this.world.createBody();
      this.ground.setUserData({ type: 'ground' });
      for (const vertices of this.track.segments) this.ground.createFixture(new P.Chain(vertices.map(p => V(p.x, p.y))), {
        friction: 0.95, restitution: 0.015, filterCategoryBits: 1
      });
      this.ground.createFixture(new P.Edge(V(-35, -4), V(-35, 12)), { friction: 0.6 });
      this.events = []; this._pendingHits = new Set(); this._pendingCollision = 0;
      this._lastCollisionTime = -100; this._elapsed = 0;
      this._weaponDirty = true; this._state = null;
      this._pendingMonsterCrash = false; this.ammo = 1; this.projectile = null;
      this.fuel = 100; this.failed = null; this.winner = null; this.finished = false; this.cleared = 0;
      this.stats = { flips: 0, perfectLandings: 0, bigAirs: 0, maxAir: 0, airTotal: 0, cans: 0, rivalImpacts: 0 };
      this.checkpointIndex = 0;
      this._spawnPlayer(0);
      this.rival = this.stage.boss ? this._createTruck(this.track.startX - RIVAL_TUNING.startGap, 'rival') : null;
      this.zombies = [];
      for (let i = 0; i < this.stage.zombieCount; i++) {
        const rawX = this.track.startX + 25 + i * (this.stage.length - 45) / this.stage.zombieCount;
        const x = this._safeEntityX(rawX, 7), y = this._heightAt(x) + 0.7;
        const body = this.world.createDynamicBody({ position: V(x, y), angularDamping: 2, linearDamping: 0.2 });
        const zombie = { id: i, x, y, angle: 0, alive: true, hit: false, timeSinceHit: 0, phase: i * 1.7, body };
        body.setUserData({ type: 'zombie', entity: zombie });
        const filter = { density: 0.16, friction: 0.5, restitution: 0.05, filterCategoryBits: 8, filterMaskBits: 1 | 2 | 4 };
        body.createFixture(new P.Box(0.2, 0.65), filter);
        body.createFixture(new P.Circle(V(0, 0.84), 0.25), filter);
        if (Math.abs(x - this.track.startX) > 45) body.setAwake(false);
        this.zombies.push(zombie);
      }
      this.fuelCans = [];
      for (let i = 0; i < this.track.canXs.length; i++) {
        const x = this.track.canXs[i];
        this.fuelCans.push({ id: i, x, y: this._heightAt(x) + 1.3, collected: false });
      }
      if (this.stage.boss) {
        const x = this.track.startX + 35;
        this.fuelCans.unshift({ id: -1, x, y: this._heightAt(x) + 1.3, collected: false });
      }
      this.monster = this._createMonster();
      this.world.on('begin-contact', contact => {
        const a = contact.getFixtureA().getBody().getUserData(), b = contact.getFixtureB().getBody().getUserData();
        if (a?.type === 'zombie' && b?.type === 'vehicle' && a.entity.alive) this._pendingHits.add(a.entity);
        if (b?.type === 'zombie' && a?.type === 'vehicle' && b.entity.alive) this._pendingHits.add(b.entity);
        if ((a?.type === 'monster' && b?.type === 'vehicle' && b.owner === 'player') ||
            (b?.type === 'monster' && a?.type === 'vehicle' && a.owner === 'player')) this._pendingMonsterCrash = true;
      });
      this.world.on('post-solve', (contact, impulse) => {
        const a = contact.getFixtureA().getBody().getUserData(), b = contact.getFixtureB().getBody().getUserData();
        if (a?.type === 'vehicle' && b?.type === 'vehicle' && a.owner !== b.owner) {
          this._pendingCollision = Math.max(this._pendingCollision, impulse.normalImpulses.reduce((sum, n) => sum + n, 0));
        }
      });
      this.poseLength = POSE.STRIDE * (POSE.ZOMBIES + this.zombies.length);
      this.posePrev = new Float64Array(this.poseLength); this.poseCurr = new Float64Array(this.poseLength);
      this._capturePose(); this.posePrev.set(this.poseCurr);
      return this;
    }

    _createTruck(x, owner) {
      const spawn = V(x, this._heightAt(x) + 1.43), rival = owner === 'rival';
      const chassis = this.world.createDynamicBody({ position: spawn, linearDamping: 0.045, angularDamping: 0.65, bullet: true });
      const filter = { filterGroupIndex: rival ? -2 : -1, filterCategoryBits: rival ? 4 : 2,
        filterMaskBits: 1 | 2 | 4 | 8 | (rival ? 0 : 16), friction: 0.5, restitution: 0.045 };
      chassis.setUserData({ type: 'vehicle', owner, part: 'chassis' });
      chassis.createFixture(new P.Polygon([V(-2.1, -0.32), V(2.1, -0.32), V(2.1, 0.23), V(1.7, 0.45), V(-1.8, 0.45), V(-2.1, 0.25)]), { ...filter, density: 3.5 });
      chassis.createFixture(new P.Polygon([V(-1, 0.4), V(1.12, 0.4), V(0.55, 1.22), V(-0.76, 1.22)]), { ...filter, density: 0.65 });
      const wheels = [], joints = [];
      const frequency = rival ? 4.4 : UPGRADES.suspension.frequencyHz[this.tuning.suspension];
      const damping = rival ? 0.85 : UPGRADES.suspension.dampingRatio[this.tuning.suspension];
      const grip = rival ? 1.55 : 1.55 * UPGRADES.tyres.grip[this.tuning.tyres];
      for (const offset of [-1.57, 1.57]) {
        const wheel = this.world.createDynamicBody({ position: V(spawn.x + offset, spawn.y - 0.65), bullet: true });
        wheel.setUserData({ type: 'vehicle', owner, part: 'wheel' });
        wheel.createFixture(new P.Circle(0.72), { ...filter, density: 1.7, friction: grip, restitution: 0.035 });
        wheels.push(wheel);
        joints.push(this.world.createJoint(new P.WheelJoint({ enableMotor: false, motorSpeed: 0, maxMotorTorque: 48,
          frequencyHz: frequency, dampingRatio: damping }, chassis, wheel, wheel.getPosition(), V(0, 1))));
      }
      return { chassis, wheels, joints, grounded: false, airtime: 0, everGrounded: false, takeoffSent: false, owner,
        wheelContact: [false, false], chassisContact: false, inverted: false, stalledTime: 0,
        airRotation: 0, lastAngle: 0, flipCount: 0, landing: null, righting: false };
    }

    _spawnPlayer(checkpointIndex) {
      if (this.player) {
        // A restart creates a new world; only delete bodies belonging to this one.
        if (this.player.chassis.getWorld() === this.world) {
          for (const wheel of this.player.wheels) this.world.destroyBody(wheel);
          this.world.destroyBody(this.player.chassis);
        }
      }
      this.checkpointIndex = clamp(Math.floor(Number(checkpointIndex) || 0), 0, this.track.checkpoints.length - 1);
      const cp = this.track.checkpoints[this.checkpointIndex];
      this.player = this._createTruck(cp.x + 1.5, 'player');
      this.chassis = this.player.chassis; this.wheels = this.player.wheels; this.joints = this.player.joints;
      this.grounded = false; this.airtime = 0;
      this.airRotation = 0; this._weaponDirty = true;
    }

    reset(checkpointIndex = 0) {
      if (this.failed || this.winner) return false;
      this.fuel = Math.max(0, this.fuel - 12);
      if (this.fuel <= 0) { this._failFuel(); return false; }
      let safeIndex = clamp(Math.floor(Number(checkpointIndex) || 0), 0, this.track.checkpoints.length - 1);
      while (safeIndex > 0 && this.monster.alive && this.track.checkpoints[safeIndex].x + 13.5 >= this.monster.x) safeIndex--;
      this._spawnPlayer(safeIndex);
      this._capturePose(); this.posePrev.set(this.poseCurr);
      return true;
    }

    _captureBody(slot, body) {
      if (!body) return;
      const index = slot * 3, p = body.getPosition();
      this.poseCurr[index] = p.x; this.poseCurr[index + 1] = p.y; this.poseCurr[index + 2] = body.getAngle();
    }

    _capturePose() {
      this.poseCurr.fill(NaN);
      this._captureBody(POSE.PLAYER, this.chassis);
      this._captureBody(POSE.PLAYER_WHEEL_REAR, this.wheels[0]); this._captureBody(POSE.PLAYER_WHEEL_FRONT, this.wheels[1]);
      if (this.rival) {
        this._captureBody(POSE.RIVAL, this.rival.chassis);
        this._captureBody(POSE.RIVAL_WHEEL_REAR, this.rival.wheels[0]); this._captureBody(POSE.RIVAL_WHEEL_FRONT, this.rival.wheels[1]);
      }
      if (this.projectile) {
        const index = POSE.PROJECTILE * 3; this.poseCurr[index] = this.projectile.x;
        this.poseCurr[index + 1] = this.projectile.y; this.poseCurr[index + 2] = this.projectile.angle;
      }
      for (let i = 0; i < this.zombies.length; i++) this._captureBody(POSE.ZOMBIES + i, this.zombies[i].body);
    }

    getPose(out) { if (!out) out = new Float64Array(this.poseLength); out.set(this.poseCurr); return out; }

    interpolatePose(alpha, out) {
      if (!out) out = new Float64Array(this.poseLength);
      alpha = clamp(Number(alpha) || 0, 0, 1);
      for (let i = 0; i < this.poseLength; i += 3) {
        for (let j = 0; j < 3; j++) {
          const prev = this.posePrev[i + j], curr = this.poseCurr[i + j];
          out[i + j] = !Number.isFinite(prev) || !Number.isFinite(curr) ? curr : prev + (j === 2 ? wrap(curr - prev) : curr - prev) * alpha;
        }
      }
      return out;
    }

    _touchingGround(vehicle) {
      for (let i = 0; i < 2; i++) {
        vehicle.wheelContact[i] = false;
        for (let edge = vehicle.wheels[i].getContactList(); edge; edge = edge.next) {
          if (edge.other === this.ground && edge.contact.isTouching()) { vehicle.wheelContact[i] = true; break; }
        }
      }
      vehicle.chassisContact = false;
      for (let edge = vehicle.chassis.getContactList(); edge; edge = edge.next) {
        if (edge.other === this.ground && edge.contact.isTouching()) { vehicle.chassisContact = true; break; }
      }
      const touching = vehicle.wheelContact[0] || vehicle.wheelContact[1] || vehicle.chassisContact;
      vehicle.inverted = touching && Math.abs(wrap(vehicle.chassis.getAngle())) > 1.75;
      return touching;
    }

    _drive(vehicle, throttle, brake, lean, maxSpeed = 34) {
      const mass = vehicle.chassis.getMass(), isPlayer = vehicle.owner === 'player';
      const torqueScale = isPlayer ? UPGRADES.engine.torque[this.tuning.engine] : 1 + RIVAL_TUNING.engineTorquePerLevel * this.tuning.engine;
      if (isPlayer) maxSpeed *= UPGRADES.engine.speed[this.tuning.engine];
      for (const joint of vehicle.joints) {
        joint.enableMotor(brake || Math.abs(throttle) > 0.01);
        joint.setMotorSpeed(brake ? 0 : throttle * (throttle >= 0 ? -maxSpeed : -13));
        joint.setMaxMotorTorque(brake ? 125 : (vehicle.grounded ? 48 : 7) * torqueScale * Math.abs(throttle));
      }
      if (vehicle.grounded) {
        const wantsRighting = !isPlayer || Math.abs(lean) > 0.05;
        if (wantsRighting && (vehicle.righting || vehicle.inverted && Math.abs(vehicle.chassis.getLinearVelocity().x) < 2.5)) {
          vehicle.righting = Math.abs(wrap(vehicle.chassis.getAngle())) > 0.35;
          if (vehicle.righting) {
            // Keep rolling past the roof/side contact transition. Wheel motors
            // would otherwise oppose this torque and leave the rival on its side.
            for (const joint of vehicle.joints) joint.enableMotor(false);
            const error = wrap(vehicle.chassis.getAngle() - this._slopeAt(vehicle.chassis.getPosition().x));
            const target = -Math.sign(error || 1) * 5.0;
            vehicle.chassis.applyTorque(clamp((target - vehicle.chassis.getAngularVelocity()) * vehicle.chassis.getInertia() / 0.14, -mass * 30, mass * 30), true);
          }
          return;
        }
        vehicle.righting = false;
        if (vehicle.inverted) return;
        const error = wrap(vehicle.chassis.getAngle() - this._slopeAt(vehicle.chassis.getPosition().x));
        vehicle.chassis.applyTorque(clamp(-error * mass * 12 - vehicle.chassis.getAngularVelocity() * mass * 1.8, -mass * 12, mass * 12), true);
      } else if (isPlayer && Math.abs(lean) > 0.05) {
        const omega = vehicle.chassis.getAngularVelocity(), inertia = vehicle.chassis.getInertia();
        const control = UPGRADES.suspension.airControl[this.tuning.suspension];
        const target = -lean * 6.5 * control;
        // Compensate angular drag while steering; no torque at all when released.
        const torque = (target - omega) * inertia / 0.22 + omega * inertia * 0.65;
        vehicle.chassis.applyTorque(clamp(torque, -mass * 22, mass * 22), true);
      } else if (!isPlayer) vehicle.chassis.applyTorque(-lean * mass * 8, true);
    }

    _updateFlight(vehicle, dt, vyBefore, emit) {
      const before = vehicle.grounded, flightTime = vehicle.airtime;
      vehicle.grounded = this._touchingGround(vehicle);
      const angle = vehicle.chassis.getAngle(), p = vehicle.chassis.getPosition();
      if (vehicle.grounded) {
        if (emit && !before && vehicle.everGrounded && flightTime > 0.16 && !vehicle.inverted) {
          const rotation = vehicle.airRotation, dir = rotation >= 0 ? 'back' : 'front';
          const flips = Math.floor((Math.abs(rotation) + 0.45) / (Math.PI * 2));
          this.events.push({ type: 'land', strength: clamp(Math.abs(vyBefore) / 13, 0.1, 1), airtime: flightTime, rotation, flips, dir });
          this.stats.maxAir = Math.max(this.stats.maxAir, flightTime); this.stats.airTotal += flightTime;
          if (flightTime >= 0.45) vehicle.landing = { airtime: flightTime, rotation, flips, dir, started: this._elapsed,
            mask: (vehicle.wheelContact[0] ? 1 : 0) | (vehicle.wheelContact[1] ? 2 : 0), bothAt: Infinity };
        }
        vehicle.airtime = 0; vehicle.everGrounded = true; vehicle.takeoffSent = false;
      } else {
        if (before) { vehicle.airRotation = 0; vehicle.flipCount = 0; }
        vehicle.airRotation += wrap(angle - vehicle.lastAngle);
        vehicle.airtime += dt;
        if (emit && vehicle.everGrounded && vehicle.airtime > 0.09 && !vehicle.takeoffSent) {
          vehicle.takeoffSent = true;
          this.events.push({ type: 'takeoff', strength: clamp(Math.hypot(vehicle.chassis.getLinearVelocity().x, vyBefore) / 26, 0.2, 1) });
        }
        const flips = Math.floor((Math.abs(vehicle.airRotation) + 0.45) / (Math.PI * 2));
        while (emit && flips > vehicle.flipCount) {
          vehicle.flipCount++; this.events.push({ type: 'flip', dir: vehicle.airRotation >= 0 ? 'back' : 'front', count: vehicle.flipCount, x: p.x, y: p.y });
        }
      }
      vehicle.lastAngle = angle;
      if (emit && vehicle.landing) {
        const landing = vehicle.landing;
        landing.mask |= (vehicle.wheelContact[0] ? 1 : 0) | (vehicle.wheelContact[1] ? 2 : 0);
        if (landing.mask === 3 && !Number.isFinite(landing.bothAt)) landing.bothAt = this._elapsed - landing.started;
        if ((vehicle.wheelContact[0] && vehicle.wheelContact[1]) || this._elapsed - landing.started >= 0.15) {
          const error = Math.abs(wrap(angle - this._slopeAt(p.x))), upright = error < 0.6;
          const perfect = upright && landing.bothAt <= 0.12 && error < 0.26, bigAir = landing.airtime >= 1.6;
          const flips = upright ? landing.flips : 0;
          this.events.push({ type: 'landing', airtime: landing.airtime, rotation: landing.rotation, flips, dir: landing.dir,
            upright, perfect, bigAir, x: p.x, y: p.y });
          this.stats.flips += flips; if (perfect) this.stats.perfectLandings++; if (bigAir) this.stats.bigAirs++;
          vehicle.landing = null;
        }
      }
    }

    _failFuel() {
      if (this.failed) return;
      this.fuel = 0; this.failed = 'fuel'; this.events.push({ type: 'empty' });
    }

    step(dt, input = {}) {
      this.posePrev.set(this.poseCurr);
      dt = clamp(Number(dt) || 0, 0, 1 / 30);
      if (!dt || this.failed || this.winner) return;
      this._weaponDirty = true;
      if (input.fire) this.fire();
      this._advanceProjectile(dt);
      if (this.monster.hit) this.monster.timeSinceHit += dt;
      const throttle = clamp(Number(input.throttle) || 0, -1, 1), lean = clamp(Number(input.lean) || 0, -1, 1);
      const beforeX = this.chassis.getPosition().x, vyBefore = this.chassis.getLinearVelocity().y;
      this._drive(this.player, throttle, !!input.brake, lean);
      let rivalBeforeX = 0, rivalVy = 0;
      if (this.rival) {
        rivalBeforeX = this.rival.chassis.getPosition().x; rivalVy = this.rival.chassis.getLinearVelocity().y;
        const angle = wrap(this.rival.chassis.getAngle()), rv = this.rival.chassis.getLinearVelocity();
        const landingSlope = this._slopeAt(rivalBeforeX + Math.max(4, rv.x * 0.5));
        const balance = clamp((angle - landingSlope) * 0.8 + this.rival.chassis.getAngularVelocity() * 0.26, -1, 1);
        let rivalThrottle = 1;
        for (let f = 0; f < this.track.features.length; f++) {
          const feature = this.track.features[f];
          if ((feature.kind === 'ramp' || feature.kind === 'kicker') && rivalBeforeX > feature.endX - 4 && rivalBeforeX < feature.endX - 0.1) rivalThrottle = RIVAL_TUNING.rampLift;
        }
        this._drive(this.rival, rivalThrottle, false, balance, RIVAL_TUNING.motorSpeed * (1 + RIVAL_TUNING.engineSpeedPerLevel * this.tuning.engine));
      }
      for (const zombie of this.zombies) {
        if (!zombie.alive || Math.abs(zombie.x - beforeX) > 45) continue;
        const body = zombie.body;
        body.applyTorque(-wrap(body.getAngle()) * 1.8 - body.getAngularVelocity() * 0.14, true);
        const velocity = body.getLinearVelocity();
        this._force.set((Math.sin(this._elapsed * 1.2 + zombie.phase) * 0.22 - velocity.x) * 0.15, 0);
        body.applyForceToCenter(this._force, true);
      }
      this.world.step(dt, 8, 3);
      this._elapsed += dt;
      // A physical touch is lethal. The crossing gate additionally rejects
      // jumping over a living monster or teleporting beyond it via a checkpoint.
      if (this.monster.alive && (this._pendingMonsterCrash || this.chassis.getPosition().x >= this.monster.x - this.monster.width / 2)) {
        this._failMonster(); this._capturePose(); return;
      }
      this._updateFlight(this.player, dt, vyBefore, true);
      this.grounded = this.player.grounded; this.airtime = this.player.airtime; this.airRotation = this.player.airRotation;
      if (Math.abs(throttle) > 0.05 && this.grounded && Math.abs(this.chassis.getLinearVelocity().x) < 0.6) this.player.stalledTime += dt;
      else this.player.stalledTime = 0;
      if (this.rival) this._updateFlight(this.rival, dt, rivalVy, false);
      for (const zombie of this._pendingHits) {
        if (!zombie.alive) continue;
        zombie.alive = false; zombie.hit = true; zombie.timeSinceHit = 0; this.cleared++;
        zombie.body.setAngularDamping(0.35);
        // The first solid contact supplies the actual impact. Fallen characters
        // then collide with terrain only, so a body cannot wedge an axle shut.
        for (let fixture = zombie.body.getFixtureList(); fixture; fixture = fixture.getNext()) {
          fixture.setFilterData({ categoryBits: 8, maskBits: 1, groupIndex: 0 });
        }
        zombie.body.applyLinearImpulse(V(0.12, 0.2), zombie.body.getWorldCenter(), true);
        zombie.body.applyAngularImpulse(-0.16, true);
        this.events.push({ type: 'zombie', x: zombie.body.getPosition().x, y: zombie.body.getPosition().y, strength: clamp(Math.abs(this.chassis.getLinearVelocity().x) / 25, 0.2, 1) });
      }
      this._pendingHits.clear();
      for (const zombie of this.zombies) {
        const pos = zombie.body.getPosition(); zombie.x = pos.x; zombie.y = pos.y; zombie.angle = zombie.body.getAngle();
        if (zombie.hit) zombie.timeSinceHit += dt;
      }
      if (this._pendingCollision > 0.8 && this._elapsed - this._lastCollisionTime > 0.32) {
        const rp = this.rival.chassis.getPosition(), pp = this.chassis.getPosition();
        this.events.push({ type: 'collision', x: (rp.x + pp.x) / 2, y: (rp.y + pp.y) / 2, strength: clamp(this._pendingCollision / 45, 0.08, 1) });
        this.stats.rivalImpacts++;
        this._lastCollisionTime = this._elapsed;
      }
      this._pendingCollision = 0;
      this.fuel = Math.max(0, this.fuel - this.stage.fuelDrain * UPGRADES.tank.drain[this.tuning.tank] * (0.35 + Math.abs(throttle) * 0.65) * dt);
      const p = this.chassis.getPosition();
      for (const can of this.fuelCans) if (!can.collected && Math.hypot(p.x - can.x, p.y - can.y) < 3.9) {
        can.collected = true; const amount = Math.min(32, 100 - this.fuel); this.fuel += amount;
        this.stats.cans++;
        this.events.push({ type: 'fuel', x: can.x, y: can.y, amount });
      }
      for (let i = this.checkpointIndex + 1; i < this.track.checkpoints.length; i++) {
        const cp = this.track.checkpoints[i];
        if (p.x >= cp.x && p.y > -3 && (!this.monster.alive || cp.x + 13.5 < this.monster.x)) {
          this.checkpointIndex = i; this.events.push({ type: 'checkpoint', index: i, x: cp.x, y: cp.y });
        }
      }
      if (this.fuel <= 0) { this._failFuel(); this._capturePose(); return; }
      const playerCrossed = p.x >= this.track.finishX && p.y > -3 && !this.monster.alive;
      const rivalPos = this.rival?.chassis.getPosition();
      const rivalCrossed = !!rivalPos && rivalPos.x >= this.track.finishX && rivalPos.y > -3;
      if (playerCrossed || rivalCrossed) {
        const playerFraction = playerCrossed ? (this.track.finishX - beforeX) / Math.max(0.001, p.x - beforeX) : Infinity;
        const rivalFraction = rivalCrossed ? (this.track.finishX - rivalBeforeX) / Math.max(0.001, rivalPos.x - rivalBeforeX) : Infinity;
        this.winner = playerFraction <= rivalFraction ? 'player' : 'rival';
        this.finished = this.winner === 'player';
        if (!this.finished) this.failed = 'rival';
      }
      this._capturePose();
    }

    _snapshot(vehicle, out) {
      if (!out) out = { wheels: [{}, {}], anchors: [{}, {}], wheelContact: [false, false], suspension: [0, 0] };
      const p = vehicle.chassis.getPosition(), v = vehicle.chassis.getLinearVelocity();
      out.x = p.x; out.y = p.y; out.angle = vehicle.chassis.getAngle(); out.vx = v.x; out.vy = v.y; out.speed = v.x;
      out.wheelSpeed = (Math.abs(vehicle.wheels[0].getAngularVelocity()) + Math.abs(vehicle.wheels[1].getAngularVelocity())) / 2;
      out.grounded = vehicle.grounded; out.airtime = vehicle.airtime; out.airRotation = vehicle.airRotation;
      out.inverted = vehicle.inverted; out.stalledTime = vehicle.stalledTime;
      for (let i = 0; i < 2; i++) {
        const w = vehicle.wheels[i], pos = w.getPosition(), local = vehicle.joints[i].getLocalAnchorA();
        out.wheels[i].x = pos.x; out.wheels[i].y = pos.y; out.wheels[i].angle = w.getAngle();
        out.anchors[i].x = p.x + Math.cos(out.angle) * local.x - Math.sin(out.angle) * local.y;
        out.anchors[i].y = p.y + Math.sin(out.angle) * local.x + Math.cos(out.angle) * local.y;
        out.wheelContact[i] = vehicle.wheelContact[i]; out.suspension[i] = vehicle.joints[i].getJointTranslation();
      }
      const surface = out.wheelSpeed * 0.72, speed = Math.abs(v.x);
      out.slip = vehicle.grounded ? clamp(Math.abs(surface - speed) / Math.max(2, surface, speed), 0, 1) : 0;
      return out;
    }

    getState() {
      const state = this._snapshot(this.player, this._state); this._state = state;
      state.rival = this.rival ? this._snapshot(this.rival, state.rival) : null;
      state.fuel = this.fuel; state.cleared = this.cleared; state.totalZombies = this.zombies.length;
      state.racePosition = state.rival && state.rival.x > state.x ? 2 : 1; state.ammo = this.ammo;
      const m = this.monster, monster = state.monster || (state.monster = { weakpoint: {} });
      monster.x = m.x; monster.y = m.y; monster.width = m.width; monster.height = m.height;
      monster.weakpoint.x = m.weakpoint.x; monster.weakpoint.y = m.weakpoint.y;
      monster.alive = m.alive; monster.hit = m.hit; monster.timeSinceHit = m.timeSinceHit;
      state.projectile = this.projectile; state.weapon = this._weaponState();
      state.tuning = this.tuning; state.stats = { ...this.stats }; state.checkpointIndex = this.checkpointIndex; state.poseLength = this.poseLength;
      return state;
    }

    drainEvents() { return this.events.splice(0); }
  }
  global.TruckPhysics = TruckPhysics;
})(globalThis);
