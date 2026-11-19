// Neon Harbor — combat. Fists and a pistol, both simple and readable: F throws a
// punch at whatever is in front of the player, clicking fires a hitscan shot toward
// the camera's aim with a tracer line. Hurting people is a crime, so every hit
// raises the wanted level, and ammo comes from green crates around the city.
import * as THREE from 'three';
import { dist2D, clamp } from './config.js';
import { nearestPed } from './people.js';

const AMMO_SPOTS = [
  { x: -60, z: -20 },
  { x: 60, z: 60 },
  { x: -120, z: 100 },
  { x: 140, z: -100 },
];

export class Combat {
  constructor(scene) {
    this.scene = scene;
    this.armed = false; // pistol out (Q toggles)
    this.ammo = 12;
    this.maxAmmo = 24;
    this.punchCooldown = 0;
    this.shootCooldown = 0;
    this.tracers = [];
    this.crates = [];
    const crateGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    for (const spot of AMMO_SPOTS) {
      const crate = new THREE.Mesh(
        crateGeo,
        new THREE.MeshLambertMaterial({ color: 0x27ae60, emissive: 0x0a330f }),
      );
      crate.position.set(spot.x, 0.45, spot.z);
      crate.castShadow = true;
      scene.add(crate);
      this.crates.push({ mesh: crate, x: spot.x, z: spot.z, taken: false, timer: 0 });
    }
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 });
  }

  toggleWeapon() {
    this.armed = !this.armed;
    return this.armed;
  }

  // ctx: {x, z, heading, camDir {x,z}, peds, police, wanted, audio, onCrime, inCar}
  // Returns nothing; effects (sounds, wanted) go through the callbacks.
  update(dt, input, ctx) {
    this.punchCooldown = Math.max(0, this.punchCooldown - dt);
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    // Ammo crates: walk over one to refill, then it respawns after a minute.
    for (const crate of this.crates) {
      if (crate.taken) {
        crate.timer -= dt;
        if (crate.timer <= 0) {
          crate.taken = false;
          crate.mesh.visible = true;
        }
        continue;
      }
      if (dist2D(ctx.x, ctx.z, crate.x, crate.z) < 2) {
        crate.taken = true;
        crate.timer = 60;
        crate.mesh.visible = false;
        this.ammo = this.maxAmmo;
        ctx.audio.pickup();
        ctx.onMessage('Ammo restocked.');
      }
    }
    // Punch: F, short range, a cone in front of the player.
    if (input.wasPressed('KeyF') && this.punchCooldown <= 0 && !ctx.inCar) {
      this.punchCooldown = 0.45;
      ctx.audio.punch();
      const fx = Math.sin(ctx.heading);
      const fz = Math.cos(ctx.heading);
      for (const ped of ctx.peds) {
        if (ped.state === 'down') continue;
        const dx = ped.x - ctx.x;
        const dz = ped.z - ctx.z;
        const d = Math.hypot(dx, dz);
        if (d < 2.4 && (dx * fx + dz * fz) / (d || 1) > 0.3) {
          ped.knockDown(ctx.x, ctx.z);
          ctx.onCrime(1, 'Assault');
          for (const other of ctx.peds) {
            if (other !== ped && dist2D(other.x, other.z, ped.x, ped.z) < 12) other.scare(ped.x, ped.z);
          }
          break;
        }
      }
    }
    // Pistol: click, only when the pistol is out and the player is on foot.
    if (ctx.armed !== false && this.armed && input.clicked && this.shootCooldown <= 0 && !ctx.inCar) {
      if (this.ammo <= 0) {
        ctx.audio.blip(180, 0.08, 'square', 0.1);
        ctx.onMessage('Out of ammo — find a green crate.');
        this.shootCooldown = 0.3;
        return;
      }
      this.ammo -= 1;
      this.shootCooldown = 0.28;
      ctx.audio.gunshot();
      ctx.onCrime(1, 'Shots fired');
      const ox = ctx.x;
      const oz = ctx.z;
      const dx = ctx.camDir.x;
      const dz = ctx.camDir.z;
      const range = 45;
      // The first pedestrian or police car near the aim line takes the hit.
      let hitPed = null;
      let hitD = range;
      for (const ped of ctx.peds) {
        if (ped.state === 'down') continue;
        const px = ped.x - ox;
        const pz = ped.z - oz;
        const along = px * dx + pz * dz;
        if (along < 1 || along > range) continue;
        const across = Math.abs(px * dz - pz * dx);
        if (across < 1.6 && along < hitD) {
          hitD = along;
          hitPed = ped;
        }
      }
      let hitCop = null;
      for (const cop of ctx.police) {
        const px = cop.x - ox;
        const pz = cop.z - oz;
        const along = px * dx + pz * dz;
        if (along < 1 || along > range) continue;
        const across = Math.abs(px * dz - pz * dx);
        if (across < 2.2 && along < hitD) {
          hitD = along;
          hitCop = cop;
          hitPed = null;
        }
      }
      const endX = ox + dx * hitD;
      const endZ = oz + dz * hitD;
      this.spawnTracer(ox, 1.5, oz, endX, 1.2, endZ);
      if (hitPed) {
        hitPed.knockDown(ox, oz);
        ctx.onCrime(1, 'Pedestrian down');
      } else if (hitCop) {
        hitCop.speed *= 0.4;
        ctx.onCrime(2, 'Officer hit');
      }
      for (const ped of ctx.peds) {
        if (ped.state !== 'down' && dist2D(ped.x, ped.z, ox, oz) < 16) ped.scare(ox, oz);
      }
    }
    // Fade and drop spent tracers.
    for (let i = this.tracers.length - 1; i >= 0; i -= 1) {
      const tracer = this.tracers[i];
      tracer.life -= dt;
      tracer.line.material.opacity = clamp(tracer.life / 0.12, 0, 1) * 0.9;
      if (tracer.life <= 0) {
        this.scene.remove(tracer.line);
        this.tracers.splice(i, 1);
      }
    }
  }

  spawnTracer(x1, y1, z1, x2, y2, z2) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x1, y1, z1),
      new THREE.Vector3(x2, y2, z2),
    ]);
    const line = new THREE.Line(geo, this.tracerMat.clone());
    this.scene.add(line);
    this.tracers.push({ line, life: 0.12 });
  }
}
