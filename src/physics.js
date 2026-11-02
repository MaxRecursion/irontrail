/* IRONTRAIL physics: Planck.js 1.5.0. Metres, seconds, radians; Y points up.
 * The renderer must read body transforms; it never moves the vehicle itself.
 */
(function (global) {
  'use strict';
  const P = global.planck;
  if (!P) throw new Error('Planck.js must load before TruckPhysics.');
  const V = P.Vec2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  class TruckPhysics {
    constructor() {
      this.track = this._makeTrack();
      this.world = new P.World({ gravity: V(0, -14), allowSleep: true });
      this.ground = this.world.createBody();
      this.ground.setUserData({ type: 'ground' });
      for (const vertices of this.track.segments) {
        this.ground.createFixture(new P.Chain(vertices.map(p => V(p.x, p.y))), {
          friction: 0.95, restitution: 0.015
        });
      }
      this.ground.createFixture(new P.Edge(V(-35, -4), V(-35, 12)), { friction: 0.6 });
      this.events = [];
      this.wheels = [];
      this.joints = [];
      this.reset();
    }

    _makeTrack() {
      // Smooth dunes, followed by a straight launch face at the end of each span.
      // Each gap is its own chain so no invisible collision surface spans it.
      const layouts = [
        [[-35, 0], [18, 0], [33, 1.2], [46, 3.5], [57, 3.5], [72, 0.2], [81, 0.2], [94, 3.6, 'ramp']],
        [[98, 2], [114, 0], [128, 0], [144, 3], [160, 5.2], [174, 5.2], [194, 1], [208, 1], [220, 4, 'ramp']],
        [[224, 2.7], [241, 0], [260, 0], [277, 3], [291, 2], [308, 0], [320, 0], [334, 3.8, 'ramp']],
        [[338, 2.2], [355, 0], [371, 1.8], [389, 0], [406, 0], [440, 0], [465, 0]]
      ];
      const segments = layouts.map(nodes => {
        const out = [{ x: nodes[0][0], y: nodes[0][1] }];
        for (let n = 1; n < nodes.length; n++) {
          const a = nodes[n - 1], b = nodes[n];
          const count = Math.ceil((b[0] - a[0]) / 0.7);
          for (let i = 1; i <= count; i++) {
            const t = i / count;
            const eased = b[2] === 'ramp' ? t : (1 - Math.cos(Math.PI * t)) / 2;
            out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * eased });
          }
        }
        return out;
      });
      return {
        segments,
        checkpoints: [{ x: 6, y: 0 }, { x: 119, y: 0 }, { x: 250, y: 0 }, { x: 357, y: 0.07 }],
        startX: 7.5,
        finishX: 447.5,
        length: 440
      };
    }

    _heightAt(x) {
      for (const segment of this.track.segments) {
        if (x < segment[0].x || x > segment[segment.length - 1].x) continue;
        for (let i = 1; i < segment.length; i++) {
          const a = segment[i - 1], b = segment[i];
          if (x <= b.x) return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
        }
      }
      return 0;
    }

    reset(checkpointIndex = 0) {
      for (const wheel of this.wheels) this.world.destroyBody(wheel);
      if (this.chassis) this.world.destroyBody(this.chassis);
      this.wheels = [];
      this.joints = [];
      this.checkpointIndex = clamp(Math.floor(checkpointIndex), 0, this.track.checkpoints.length - 1);
      const cp = this.track.checkpoints[this.checkpointIndex];
      const spawn = V(cp.x + 1.5, this._heightAt(cp.x + 1.5) + 1.43);
      this.chassis = this.world.createDynamicBody({
        position: spawn, linearDamping: 0.045, angularDamping: 0.65, bullet: true
      });
      this.chassis.setUserData({ type: 'chassis' });
      const filter = { filterGroupIndex: -1, friction: 0.5, restitution: 0.03 };
      this.chassis.createFixture(new P.Polygon([
        V(-2.1, -0.32), V(2.1, -0.32), V(2.1, 0.23), V(1.7, 0.45), V(-1.8, 0.45), V(-2.1, 0.25)
      ]), { ...filter, density: 3.5 });
      this.chassis.createFixture(new P.Polygon([
        V(-1.0, 0.4), V(1.12, 0.4), V(0.55, 1.22), V(-0.76, 1.22)
      ]), { ...filter, density: 0.65 });
      for (const offset of [-1.57, 1.57]) {
        const wheel = this.world.createDynamicBody({ position: V(spawn.x + offset, spawn.y - 0.65), bullet: true });
        wheel.setUserData({ type: 'wheel' });
        wheel.createFixture(new P.Circle(0.72), { ...filter, density: 1.7, friction: 1.55, restitution: 0.025 });
        this.wheels.push(wheel);
        this.joints.push(this.world.createJoint(new P.WheelJoint({
          enableMotor: false, motorSpeed: 0, maxMotorTorque: 48,
          frequencyHz: 4.4, dampingRatio: 0.85
        }, this.chassis, wheel, wheel.getPosition(), V(0, 1))));
      }
      this.finished = false;
      this.grounded = false;
      this.airtime = 0;
      this._everGrounded = false;
      this._takeoffSent = false;
      this._elapsed = 0;
      this.events.length = 0;
    }

    _touchingGround() {
      for (const wheel of this.wheels) {
        for (let edge = wheel.getContactList(); edge; edge = edge.next) {
          if (edge.other === this.ground && edge.contact.isTouching()) return true;
        }
      }
      return false;
    }

    step(dt, input = {}) {
      dt = clamp(Number(dt) || 0, 0, 1 / 30);
      if (!dt) return;
      const throttle = clamp(Number(input.throttle) || 0, -1, 1);
      const lean = clamp(Number(input.lean) || 0, -1, 1);
      const vel = this.chassis.getLinearVelocity();
      const vyBefore = vel.y;
      for (const joint of this.joints) {
        joint.enableMotor(!!input.brake || Math.abs(throttle) > 0.01);
        joint.setMotorSpeed(input.brake ? 0 : throttle * (throttle >= 0 ? -34 : -13));
        joint.setMaxMotorTorque(input.brake ? 125 : (this.grounded ? 48 : 7) * Math.abs(throttle));
      }
      const mass = this.chassis.getMass();
      if (this.grounded) {
        // A modest physical anti-roll/steering assist removes runaway wheelies.
        // It follows the local slope and never changes position or angle directly.
        const x = this.chassis.getPosition().x;
        const slope = Math.atan2(this._heightAt(x + 1) - this._heightAt(x - 1), 2);
        const error = wrap(this.chassis.getAngle() - slope);
        this.chassis.applyTorque(clamp(-error * mass * 12 - this.chassis.getAngularVelocity() * mass * 1.8, -mass * 12, mass * 12), true);
      } else {
        // Positive lean follows the screen's right arrow: rotate nose down.
        this.chassis.applyTorque(-lean * mass * 8, true);
      }
      this.world.step(dt, 8, 3);
      this._elapsed += dt;
      const wasGrounded = this.grounded;
      const flightTime = this.airtime;
      this.grounded = this._touchingGround();
      if (this.grounded) {
        if (!wasGrounded && this._everGrounded && flightTime > 0.16) {
          this.events.push({ type: 'land', strength: clamp(Math.abs(vyBefore) / 13, 0.1, 1), airtime: flightTime });
        }
        this.airtime = 0;
        this._everGrounded = true;
        this._takeoffSent = false;
      } else {
        this.airtime += dt;
        if (this._everGrounded && this.airtime > 0.09 && !this._takeoffSent) {
          this._takeoffSent = true;
          this.events.push({ type: 'takeoff', strength: clamp(Math.hypot(vel.x, vyBefore) / 26, 0.2, 1) });
        }
      }
      const p = this.chassis.getPosition();
      for (let i = this.checkpointIndex + 1; i < this.track.checkpoints.length; i++) {
        if (p.x >= this.track.checkpoints[i].x && p.y > -3) this.checkpointIndex = i;
      }
      if (p.x >= this.track.finishX && p.y > -3) this.finished = true;
    }

    getState() {
      const p = this.chassis.getPosition(), v = this.chassis.getLinearVelocity();
      return {
        x: p.x, y: p.y, angle: this.chassis.getAngle(), vx: v.x, vy: v.y,
        speed: v.x,
        wheelSpeed: this.wheels.reduce((sum, wheel) => sum + Math.abs(wheel.getAngularVelocity()), 0) / this.wheels.length,
        grounded: this.grounded, airtime: this.airtime,
        wheels: this.wheels.map(wheel => {
          const w = wheel.getPosition();
          return { x: w.x, y: w.y, angle: wheel.getAngle() };
        }),
        anchors: this.joints.map(joint => {
          const a = joint.getAnchorA();
          return { x: a.x, y: a.y };
        })
      };
    }

    drainEvents() {
      return this.events.splice(0);
    }
  }
  global.TruckPhysics = TruckPhysics;
})(globalThis);
