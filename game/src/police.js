// Neon Harbor — the wanted level and the police who answer it. Crimes add stars;
// stars bring police cars, which chase, ram and, on foot, bust the player. Lay low
// and the stars fade one at a time. At five stars the whole city is after you.
import * as THREE from 'three';
import { WANTED, PHYSICS, clamp, dist2D, angleLerp } from './config.js';
import { makeCarMesh } from './vehicles.js';
import { collideCircle } from './city.js';

export class Wanted {
  constructor() {
    this.stars = 0;
    this.quietTime = 0; // seconds with no cop near
    this.bustedTime = 0; // seconds a cop has held the player on foot
  }

  add(n) {
    const before = this.stars;
    this.stars = clamp(this.stars + n, 0, WANTED.maxStars);
    if (this.stars > before) this.quietTime = 0;
    return this.stars;
  }

  clear() {
    this.stars = 0;
    this.quietTime = 0;
    this.bustedTime = 0;
  }

  // dt: frame time. nearestCop: distance to the closest police car (Infinity when
  // none). onFoot: the player is walking. Returns 'busted' when the cops hold the
  // player long enough, else null.
  update(dt, nearestCop, onFoot) {
    if (this.stars === 0) {
      this.bustedTime = 0;
      return null;
    }
    if (nearestCop < 35) this.quietTime = 0;
    else {
      this.quietTime += dt;
      if (this.quietTime >= WANTED.decaySeconds) {
        this.stars -= 1;
        this.quietTime = 0;
      }
    }
    if (onFoot && nearestCop < 3) {
      this.bustedTime += dt;
      if (this.bustedTime >= WANTED.bustedSeconds) {
        this.clear();
        return 'busted';
      }
    } else {
      this.bustedTime = Math.max(0, this.bustedTime - dt * 2);
    }
    return null;
  }
}

export class PoliceCar {
  constructor(scene) {
    this.mesh = makeCarMesh(0x1a1a22, 'police');
    scene.add(this.mesh);
    this.x = 0;
    this.z = 0;
    this.heading = 0;
    this.speed = 0;
    this.flash = 0;
    this.lightRed = this.mesh.getObjectByName('lightRed');
    this.lightBlue = this.mesh.getObjectByName('lightBlue');
  }

  place(x, z, heading) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.sync();
  }

  sync() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
  }

  // Pursuit: steer toward the target, faster than traffic, ramming on contact.
  // Returns true when this car is touching the target (for the ram / bust logic).
  update(dt, targetX, targetZ, colliders, time) {
    const desired = Math.atan2(targetX - this.x, targetZ - this.z);
    this.heading = angleLerp(this.heading, desired, clamp(2.2 * dt, 0, 1));
    this.speed = Math.min(PHYSICS.policeSpeed, this.speed + 18 * dt);
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
    const hit = collideCircle(colliders, this.x, this.z, 2.1);
    this.x = hit.x;
    this.z = hit.z;
    if (hit.hit) this.speed *= 0.6;
    this.x = clamp(this.x, -198, 198);
    this.z = clamp(this.z, -198, 198);
    // The light bar flashes red / blue, alternating twice a second.
    this.flash += dt;
    const phase = Math.floor(this.flash * 4) % 2 === 0;
    if (this.lightRed) this.lightRed.material.emissive.setHex(phase ? 0xff0000 : 0x220000);
    if (this.lightBlue) this.lightBlue.material.emissive.setHex(phase ? 0x000022 : 0x0000ff);
    this.sync();
    return dist2D(this.x, this.z, targetX, targetZ) < 3.4;
  }

  remove(scene) {
    scene.remove(this.mesh);
  }
}

// Keep the number of police cars on the street equal to the wanted level (one per
// star, at most five). Spawns pick road points a block or two from the player so
// the sirens arrive instead of appearing on top of them.
export function syncPolice(scene, police, wantedStars, graph, playerX, playerZ, rng) {
  while (police.length < wantedStars) {
    const car = new PoliceCar(scene);
    let node = graph.nodes[Math.floor(rng() * graph.nodes.length)];
    let tries = 0;
    while (dist2D(node.x, node.z, playerX, playerZ) < 45 && tries < 20) {
      node = graph.nodes[Math.floor(rng() * graph.nodes.length)];
      tries += 1;
    }
    car.place(node.x, node.z, rng() * Math.PI * 2);
    police.push(car);
  }
  while (police.length > wantedStars) {
    const car = police.pop();
    car.remove(scene);
  }
}
