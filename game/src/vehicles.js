// Neon Harbor — cars. Every vehicle is boxes and cylinders with a paint colour, a
// cabin and four wheels, so the whole fleet is built from the same parts. Traffic
// drives the road graph, the player's car runs arcade physics, and any car can be
// stolen: walk up to one and press E.
import * as THREE from 'three';
import { PHYSICS, COLOURS, clamp, dist2D } from './config.js';
import { collideCircle } from './city.js';

const bodyGeo = new THREE.BoxGeometry(2, 0.7, 4.4);
const cabinGeo = new THREE.BoxGeometry(1.7, 0.6, 2.2);
const vanGeo = new THREE.BoxGeometry(2, 1.9, 4.6);
const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
const lightGeo = new THREE.BoxGeometry(0.35, 0.18, 0.1);
const barGeo = new THREE.BoxGeometry(1.2, 0.22, 0.5);

function paint(color) {
  return new THREE.MeshLambertMaterial({ color });
}

export function makeCarMesh(color, kind = 'sedan') {
  const car = new THREE.Group();
  const bodyMat = paint(color);
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1a2a3a });
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  if (kind === 'van') {
    const body = new THREE.Mesh(vanGeo, bodyMat);
    body.position.y = 1.15;
    body.castShadow = true;
    car.add(body);
    const cab = new THREE.Mesh(cabinGeo, glassMat);
    cab.position.set(0, 1.9, 1.2);
    car.add(cab);
  } else {
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.55;
    body.castShadow = true;
    car.add(body);
    const cabin = new THREE.Mesh(cabinGeo, glassMat);
    cabin.position.set(0, 1.15, -0.2);
    cabin.castShadow = true;
    car.add(cabin);
  }
  const wheelPositions = [
    [-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45],
  ];
  for (const [wx, wz] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, tyreMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.38, wz);
    car.add(wheel);
  }
  const headMat = new THREE.MeshLambertMaterial({ color: 0xfff6c0, emissive: 0x555533 });
  for (const hx of [-0.6, 0.6]) {
    const head = new THREE.Mesh(lightGeo, headMat);
    head.position.set(hx, 0.6, 2.21);
    car.add(head);
  }
  const tailMat = new THREE.MeshLambertMaterial({ color: 0xcc2222, emissive: 0x330000 });
  for (const tx of [-0.6, 0.6]) {
    const tail = new THREE.Mesh(lightGeo, tailMat);
    tail.position.set(tx, 0.6, -2.21);
    car.add(tail);
  }
  if (kind === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.4), new THREE.MeshLambertMaterial({ color: 0xf1c40f, emissive: 0x442200 }));
    sign.position.set(0, 1.6, -0.2);
    car.add(sign);
  }
  if (kind === 'police') {
    const bar = new THREE.Mesh(barGeo, new THREE.MeshLambertMaterial({ color: 0x222222 }));
    bar.position.set(0, 1.55, -0.2);
    car.add(bar);
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0xaa0000 }));
    red.position.set(-0.35, 1.7, -0.2);
    red.name = 'lightRed';
    car.add(red);
    const blue = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshLambertMaterial({ color: 0x2244ff, emissive: 0x0000aa }));
    blue.position.set(0.35, 1.7, -0.2);
    blue.name = 'lightBlue';
    car.add(blue);
  }
  if (kind === 'sport') {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.4), bodyMat);
    spoiler.position.set(0, 1.05, -2.1);
    car.add(spoiler);
  }
  car.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return car;
}

// One traffic car: it owns a mesh and drives one road edge at a time, turning at
// intersections and slowing for the car ahead, always on the right-hand side.
export class TrafficCar {
  constructor(scene, graph, rng, kind = 'sedan') {
    this.graph = graph;
    this.kind = kind;
    this.rng = rng; // kept so the next-edge choice stays seeded, like the city
    this.color = COLOURS.carPalette[Math.floor(rng() * COLOURS.carPalette.length)];
    if (kind === 'taxi') this.color = 0xf1c40f;
    this.mesh = makeCarMesh(this.color, kind);
    scene.add(this.mesh);
    const nodeIds = graph.nodes.map((_, i) => i);
    this.from = nodeIds[Math.floor(rng() * nodeIds.length)];
    const neighbours = graph.edges.get(this.from);
    this.to = neighbours[Math.floor(rng() * neighbours.length)];
    this.t = rng();
    this.speed = 6 + rng() * 5;
    this.cruise = this.speed;
    this.parked = false;
    this.dead = false;
  }

  get x() { return this.mesh.position.x; }
  get z() { return this.mesh.position.z; }

  // Position on the edge, offset to the right-hand lane.
  placeOnEdge() {
    const a = this.graph.nodes[this.from];
    const b = this.graph.nodes[this.to];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len; // right-hand normal
    const nz = dx / len;
    this.mesh.position.x = a.x + dx * this.t + nx * 2.4;
    this.mesh.position.z = a.z + dz * this.t + nz * 2.4;
    this.mesh.rotation.y = Math.atan2(dx, dz);
  }

  update(dt, cars) {
    if (this.parked || this.dead) return;
    // Slow for a car ahead on the same edge.
    let ahead = Infinity;
    for (const other of cars) {
      if (other === this || other.parked || other.dead) continue;
      if (other.from === this.from && other.to === this.to && other.t > this.t) {
        ahead = Math.min(ahead, (other.t - this.t) * 40);
      }
    }
    const target = ahead < 9 ? 0 : this.cruise;
    this.speed += clamp(target - this.speed, -14 * dt, 8 * dt);
    this.t += (this.speed * dt) / 40;
    if (this.t >= 1) {
      const neighbours = this.graph.edges.get(this.to);
      const choices = neighbours.filter((n) => n !== this.from);
      this.from = this.to;
      this.to = choices.length ? choices[Math.floor(this.rng() * choices.length)] : neighbours[0];
      this.t = 0;
    }
    this.placeOnEdge();
  }
}

// The car the player drives: arcade physics, building collisions, car-to-car
// shoves. Heading 0 faces +z (south); forward is (sin h, cos h).
export class PlayerCar {
  constructor(scene, color, kind = 'sedan') {
    this.kind = kind;
    this.color = color;
    this.mesh = makeCarMesh(color, kind);
    scene.add(this.mesh);
    this.x = 0;
    this.z = 0;
    this.heading = 0;
    this.speed = 0;
    this.health = 100;
    this.stolen = false;
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

  update(dt, input, colliders, others, onCrash) {
    const throttle = input.throttle;
    const steer = input.steer;
    if (throttle > 0) this.speed += PHYSICS.carAccel * dt;
    else if (throttle < 0) {
      this.speed += this.speed > 0.5 ? -PHYSICS.carBrake * dt : -PHYSICS.carAccel * 0.6 * dt;
    } else {
      this.speed -= this.speed * 0.9 * dt;
    }
    if (input.handbrake) {
      this.speed -= this.speed * 2.4 * dt;
    }
    this.speed = clamp(this.speed, -PHYSICS.carReverseMax, PHYSICS.carMaxSpeed);
    const turnAuthority = clamp(Math.abs(this.speed) / 8, 0, 1) * Math.sign(this.speed || 1);
    this.heading += steer * PHYSICS.carTurn * turnAuthority * dt * (input.handbrake ? 1.7 : 1);
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    this.x += fx * this.speed * dt;
    this.z += fz * this.speed * dt;
    const before = { x: this.x, z: this.z };
    const hit = collideCircle(colliders, this.x, this.z, 2.1);
    this.x = hit.x;
    this.z = hit.z;
    if (hit.hit && Math.abs(this.speed) > 6) {
      this.speed *= 0.45;
      this.health = Math.max(0, this.health - Math.abs(this.speed) * 0.4);
      if (onCrash) onCrash(Math.abs(this.speed));
    }
    // Shove other cars instead of passing through them.
    for (const other of others) {
      if (other.dead || other.parked) continue;
      const d = dist2D(this.x, this.z, other.x, other.z);
      if (d < 4 && d > 0.01) {
        const push = (4 - d) / 2;
        const nx = (this.x - other.x) / d;
        const nz = (this.z - other.z) / d;
        this.x += nx * push;
        this.z += nz * push;
        this.speed *= 0.85;
        if (Math.abs(this.speed) > 10 && onCrash) onCrash(Math.abs(this.speed) * 0.6);
      }
    }
    this.x = clamp(this.x, -198, 198);
    this.z = clamp(this.z, -198, 198);
    void before;
    this.sync();
  }
}

export function nearestCar(cars, x, z, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of cars) {
    if (car.dead) continue;
    const d = dist2D(x, z, car.x, car.z);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}
