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
  const NAMES = ['Redstone Outbreak', 'Dry Creek', 'Hollow Ridge', 'Graveyard Pass', 'Deadwood Dunes', 'Rust Canyon', 'Bone Valley', 'Ashen Heights', 'Last Refuge', 'Iron Maw Showdown'];
  const SUBTITLES = ['First contact in the desert', 'Follow the empty riverbed', 'Keep your wheels under you', 'The dead own this road', 'A little less room to breathe', 'Rust, dust and bigger jumps', 'No easy way through', 'High ground. Low reserves.', 'One last road to safety', 'Beat Iron Maw to the line'];
  const LENGTHS = [220, 250, 285, 320, 355, 390, 425, 465, 510, 560];
  const STAGES = Object.freeze(NAMES.map((name, i) => Object.freeze({
    id: i + 1, name, subtitle: SUBTITLES[i], length: LENGTHS[i], difficulty: i + 1,
    boss: i === 9, fuelDrain: 2.6 + i * 0.52, fuelInterval: 51 + i * 3,
    zombieCount: 5 + i * 3, gapWidth: 2.2 + i * 0.38
  })));

  class TruckPhysics {
    static get STAGES() { return STAGES; }

    constructor(stageIndex = 0) {
      this.stageIndex = clamp(Math.floor(Number(stageIndex) || 0), 0, STAGES.length - 1);
      this.stage = STAGES[this.stageIndex];
      this.track = this._makeTrack();
      this.restart();
    }

    _makeTrack() {
      const d = this.stage.difficulty, startX = 7.5, finishX = startX + this.stage.length;
      const count = 2 + Math.floor((d - 1) / 2), span = (this.stage.length - 22) / count;
      const layouts = [], checkpoints = [{ x: startX - 1.5, y: 0 }];
      let start = -35;
      for (let i = 0; i < count; i++) {
        const base = startX + 15 + i * span;
        const end = startX + 15 + (i + 1) * span - this.stage.gapWidth;
        const amp = 1.45 + d * 0.22 + (i % 2) * 0.45;
        const rampHeight = this.stage.boss ? 4.5 : 1.85 + d * 0.14;
        const nodes = [[start, 0], [base + span * 0.05, 0], [base + span * 0.29, amp],
          [base + span * 0.42, amp], [base + span * 0.64, 0], [end - 12.5, 0], [end, rampHeight, 'ramp']];
        // On short spans keep nodes strictly ordered while retaining gentle slopes.
        const ordered = nodes.filter((n, nIndex) => nIndex === 0 || n[0] > nodes[nIndex - 1][0] + 0.2);
        layouts.push(ordered);
        start = end + this.stage.gapWidth;
        if (i < count - 1) checkpoints.push({ x: start + 2.2, y: 0 });
      }
      // Landing apron and flat run-in leave room for a clean finish.
      layouts.push([[start, 0], [finishX + 25, 0]]);
      const segments = layouts.map(nodes => {
        const out = [{ x: nodes[0][0], y: nodes[0][1] }];
        for (let n = 1; n < nodes.length; n++) {
          const a = nodes[n - 1], b = nodes[n], samples = Math.ceil((b[0] - a[0]) / 0.65);
          for (let j = 1; j <= samples; j++) {
            const t = j / samples, f = b[2] === 'ramp' ? t : (1 - Math.cos(Math.PI * t)) / 2;
            out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * f });
          }
        }
        return out;
      });
      return { segments, checkpoints, startX, finishX, length: this.stage.length };
    }

    _segmentAt(x) {
      return this.track.segments.find(s => x >= s[0].x && x <= s[s.length - 1].x);
    }

    _heightAt(x) {
      const segment = this._segmentAt(x);
      if (!segment) return 0;
      for (let i = 1; i < segment.length; i++) {
        const a = segment[i - 1], b = segment[i];
        if (x <= b.x) return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
      }
      return segment[segment.length - 1].y;
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
      this.fuel = 100; this.failed = null; this.winner = null; this.finished = false; this.cleared = 0;
      this.checkpointIndex = 0;
      this._spawnPlayer(0);
      this.rival = this.stage.boss ? this._createTruck(this.track.startX - 6, 'rival') : null;
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
        this.zombies.push(zombie);
      }
      this.fuelCans = [];
      for (let x = this.track.startX + 35, i = 0; x < this.track.finishX - 12; x += this.stage.fuelInterval, i++) {
        const safeX = this._safeEntityX(x, 10);
        this.fuelCans.push({ id: i, x: safeX, y: this._heightAt(safeX) + 1.3, collected: false });
      }
      this.world.on('begin-contact', contact => {
        const a = contact.getFixtureA().getBody().getUserData(), b = contact.getFixtureB().getBody().getUserData();
        if (a?.type === 'zombie' && b?.type === 'vehicle' && a.entity.alive) this._pendingHits.add(a.entity);
        if (b?.type === 'zombie' && a?.type === 'vehicle' && b.entity.alive) this._pendingHits.add(b.entity);
      });
      this.world.on('post-solve', (contact, impulse) => {
        const a = contact.getFixtureA().getBody().getUserData(), b = contact.getFixtureB().getBody().getUserData();
        if (a?.type === 'vehicle' && b?.type === 'vehicle' && a.owner !== b.owner) {
          this._pendingCollision = Math.max(this._pendingCollision, impulse.normalImpulses.reduce((sum, n) => sum + n, 0));
        }
      });
      return this;
    }

    _createTruck(x, owner) {
      const spawn = V(x, this._heightAt(x) + 1.43), rival = owner === 'rival';
      const chassis = this.world.createDynamicBody({ position: spawn, linearDamping: 0.045, angularDamping: 0.65, bullet: true });
      const filter = { filterGroupIndex: rival ? -2 : -1, filterCategoryBits: rival ? 4 : 2,
        filterMaskBits: 1 | 2 | 4 | 8, friction: 0.5, restitution: 0.045 };
      chassis.setUserData({ type: 'vehicle', owner, part: 'chassis' });
      chassis.createFixture(new P.Polygon([V(-2.1, -0.32), V(2.1, -0.32), V(2.1, 0.23), V(1.7, 0.45), V(-1.8, 0.45), V(-2.1, 0.25)]), { ...filter, density: 3.5 });
      chassis.createFixture(new P.Polygon([V(-1, 0.4), V(1.12, 0.4), V(0.55, 1.22), V(-0.76, 1.22)]), { ...filter, density: 0.65 });
      const wheels = [], joints = [];
      for (const offset of [-1.57, 1.57]) {
        const wheel = this.world.createDynamicBody({ position: V(spawn.x + offset, spawn.y - 0.65), bullet: true });
        wheel.setUserData({ type: 'vehicle', owner, part: 'wheel' });
        wheel.createFixture(new P.Circle(0.72), { ...filter, density: 1.7, friction: 1.55, restitution: 0.035 });
        wheels.push(wheel);
        joints.push(this.world.createJoint(new P.WheelJoint({ enableMotor: false, motorSpeed: 0, maxMotorTorque: 48,
          frequencyHz: 4.4, dampingRatio: 0.85 }, chassis, wheel, wheel.getPosition(), V(0, 1))));
      }
      return { chassis, wheels, joints, grounded: false, airtime: 0, everGrounded: false, takeoffSent: false, owner };
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
    }

    reset(checkpointIndex = 0) {
      if (this.failed || this.winner) return false;
      this.fuel = Math.max(0, this.fuel - 12);
      if (this.fuel <= 0) { this._failFuel(); return false; }
      this._spawnPlayer(checkpointIndex);
      return true;
    }

    _touchingGround(vehicle) {
      for (const wheel of vehicle.wheels) for (let edge = wheel.getContactList(); edge; edge = edge.next) {
        if (edge.other === this.ground && edge.contact.isTouching()) return true;
      }
      return false;
    }

    _drive(vehicle, throttle, brake, lean, maxSpeed = 34) {
      const mass = vehicle.chassis.getMass();
      for (const joint of vehicle.joints) {
        joint.enableMotor(brake || Math.abs(throttle) > 0.01);
        joint.setMotorSpeed(brake ? 0 : throttle * (throttle >= 0 ? -maxSpeed : -13));
        joint.setMaxMotorTorque(brake ? 125 : (vehicle.grounded ? 48 : 7) * Math.abs(throttle));
      }
      if (vehicle.grounded) {
        const error = wrap(vehicle.chassis.getAngle() - this._slopeAt(vehicle.chassis.getPosition().x));
        vehicle.chassis.applyTorque(clamp(-error * mass * 12 - vehicle.chassis.getAngularVelocity() * mass * 1.8, -mass * 12, mass * 12), true);
      } else vehicle.chassis.applyTorque(-lean * mass * 8, true);
    }

    _updateFlight(vehicle, dt, vyBefore, emit) {
      const before = vehicle.grounded, flightTime = vehicle.airtime;
      vehicle.grounded = this._touchingGround(vehicle);
      if (vehicle.grounded) {
        if (emit && !before && vehicle.everGrounded && flightTime > 0.16) this.events.push({
          type: 'land', strength: clamp(Math.abs(vyBefore) / 13, 0.1, 1), airtime: flightTime
        });
        vehicle.airtime = 0; vehicle.everGrounded = true; vehicle.takeoffSent = false;
      } else {
        vehicle.airtime += dt;
        if (emit && vehicle.everGrounded && vehicle.airtime > 0.09 && !vehicle.takeoffSent) {
          vehicle.takeoffSent = true;
          this.events.push({ type: 'takeoff', strength: clamp(Math.hypot(vehicle.chassis.getLinearVelocity().x, vyBefore) / 26, 0.2, 1) });
        }
      }
    }

    _failFuel() {
      if (this.failed) return;
      this.fuel = 0; this.failed = 'fuel'; this.events.push({ type: 'empty' });
    }

    step(dt, input = {}) {
      dt = clamp(Number(dt) || 0, 0, 1 / 30);
      if (!dt || this.failed || this.winner) return;
      const throttle = clamp(Number(input.throttle) || 0, -1, 1), lean = clamp(Number(input.lean) || 0, -1, 1);
      const beforeX = this.chassis.getPosition().x, vyBefore = this.chassis.getLinearVelocity().y;
      this._drive(this.player, throttle, !!input.brake, lean);
      let rivalBeforeX = 0, rivalVy = 0;
      if (this.rival) {
        rivalBeforeX = this.rival.chassis.getPosition().x; rivalVy = this.rival.chassis.getLinearVelocity().y;
        const angle = wrap(this.rival.chassis.getAngle());
        const balance = clamp(angle * 0.6 + this.rival.chassis.getAngularVelocity() * 0.2, -1, 1);
        // The rival starts just behind: a clean drive can hold the lead. Slower
        // gearing gives room to recover from contact, while a missed jump lets
        // Iron Maw pass. Neither vehicle gets position/velocity corrections.
        this._drive(this.rival, 1, false, balance, 31.3);
      }
      for (const zombie of this.zombies) {
        if (!zombie.alive) continue;
        const body = zombie.body;
        body.applyTorque(-wrap(body.getAngle()) * 1.8 - body.getAngularVelocity() * 0.14, true);
        const velocity = body.getLinearVelocity();
        body.applyForceToCenter(V((Math.sin(this._elapsed * 1.2 + zombie.phase) * 0.22 - velocity.x) * 0.15, 0), true);
      }
      this.world.step(dt, 8, 3);
      this._elapsed += dt;
      this._updateFlight(this.player, dt, vyBefore, true);
      this.grounded = this.player.grounded; this.airtime = this.player.airtime;
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
        this._lastCollisionTime = this._elapsed;
      }
      this._pendingCollision = 0;
      this.fuel = Math.max(0, this.fuel - this.stage.fuelDrain * (0.35 + Math.abs(throttle) * 0.65) * dt);
      const p = this.chassis.getPosition();
      for (const can of this.fuelCans) if (!can.collected && Math.hypot(p.x - can.x, p.y - can.y) < 3.9) {
        can.collected = true; const amount = Math.min(32, 100 - this.fuel); this.fuel += amount;
        this.events.push({ type: 'fuel', x: can.x, y: can.y, amount });
      }
      for (let i = this.checkpointIndex + 1; i < this.track.checkpoints.length; i++) if (p.x >= this.track.checkpoints[i].x && p.y > -3) this.checkpointIndex = i;
      if (this.fuel <= 0) { this._failFuel(); return; }
      const playerCrossed = p.x >= this.track.finishX && p.y > -3;
      const rivalPos = this.rival?.chassis.getPosition();
      const rivalCrossed = !!rivalPos && rivalPos.x >= this.track.finishX && rivalPos.y > -3;
      if (playerCrossed || rivalCrossed) {
        const playerFraction = playerCrossed ? (this.track.finishX - beforeX) / Math.max(0.001, p.x - beforeX) : Infinity;
        const rivalFraction = rivalCrossed ? (this.track.finishX - rivalBeforeX) / Math.max(0.001, rivalPos.x - rivalBeforeX) : Infinity;
        this.winner = playerFraction <= rivalFraction ? 'player' : 'rival';
        this.finished = this.winner === 'player';
        if (!this.finished) this.failed = 'rival';
      }
    }

    _snapshot(vehicle) {
      const p = vehicle.chassis.getPosition(), v = vehicle.chassis.getLinearVelocity();
      return { x: p.x, y: p.y, angle: vehicle.chassis.getAngle(), vx: v.x, vy: v.y, speed: v.x,
        wheelSpeed: vehicle.wheels.reduce((sum, wheel) => sum + Math.abs(wheel.getAngularVelocity()), 0) / 2,
        grounded: vehicle.grounded, airtime: vehicle.airtime,
        wheels: vehicle.wheels.map(wheel => ({ x: wheel.getPosition().x, y: wheel.getPosition().y, angle: wheel.getAngle() })),
        anchors: vehicle.joints.map(joint => ({ x: joint.getAnchorA().x, y: joint.getAnchorA().y })) };
    }

    getState() {
      const rival = this.rival ? this._snapshot(this.rival) : null, player = this._snapshot(this.player);
      return { ...player, fuel: this.fuel, cleared: this.cleared, totalZombies: this.zombies.length,
        rival, racePosition: rival && rival.x > player.x ? 2 : 1 };
    }

    drainEvents() { return this.events.splice(0); }
  }
  global.TruckPhysics = TruckPhysics;
})(globalThis);
