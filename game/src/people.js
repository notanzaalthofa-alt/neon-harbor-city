// Neon Harbor — pedestrians. They stroll the sidewalks along the road graph, turn
// at intersections, and run when something scary happens: a punch, a gunshot, or a
// car bearing down on them. One of them can be flagged as a mission passenger,
// waiting under a floating marker until the player picks them up.
import * as THREE from 'three';
import { PHYSICS, clamp, dist2D } from './config.js';

const SHIRTS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xecf0f1, 0x34495e];
const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];

function makePersonMesh(shirt, skin) {
  const person = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.05, 0.4),
    new THREE.MeshLambertMaterial({ color: shirt }),
  );
  body.position.y = 1.05;
  body.castShadow = true;
  person.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 10, 8),
    new THREE.MeshLambertMaterial({ color: skin }),
  );
  head.position.y = 1.85;
  head.castShadow = true;
  person.add(head);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
  const legGeo = new THREE.BoxGeometry(0.24, 0.55, 0.28);
  const left = new THREE.Mesh(legGeo, legMat);
  left.position.set(-0.18, 0.28, 0);
  left.name = 'legL';
  person.add(left);
  const right = new THREE.Mesh(legGeo, legMat);
  right.position.set(0.18, 0.28, 0);
  right.name = 'legR';
  person.add(right);
  return person;
}

export class Pedestrian {
  constructor(scene, graph, rng) {
    this.graph = graph;
    this.mesh = makePersonMesh(
      SHIRTS[Math.floor(rng() * SHIRTS.length)],
      SKINS[Math.floor(rng() * SKINS.length)],
    );
    scene.add(this.mesh);
    const nodeIds = graph.nodes.map((_, i) => i);
    this.from = nodeIds[Math.floor(rng() * nodeIds.length)];
    const neighbours = graph.edges.get(this.from);
    this.to = neighbours[Math.floor(rng() * neighbours.length)];
    this.t = rng();
    this.side = rng() < 0.5 ? 1 : -1; // which sidewalk
    this.speed = PHYSICS.pedSpeed * (0.7 + rng() * 0.6);
    this.state = 'walk'; // walk | flee | down
    this.stateTime = 0;
    this.fleeX = 0;
    this.fleeZ = 0;
    this.walkPhase = rng() * 10;
    this.isPassenger = false;
    this.marker = null;
  }

  get x() { return this.mesh.position.x; }
  get z() { return this.mesh.position.z; }

  placeOnEdge() {
    const a = this.graph.nodes[this.from];
    const b = this.graph.nodes[this.to];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    this.mesh.position.x = a.x + dx * this.t + nx * 7.4 * this.side;
    this.mesh.position.z = a.z + dz * this.t + nz * 7.4 * this.side;
    this.mesh.rotation.y = Math.atan2(dx, dz);
  }

  // A scare: run away from (x, z) for a few seconds.
  scare(x, z) {
    if (this.state === 'down') return;
    this.state = 'flee';
    this.stateTime = 0;
    this.fleeX = x;
    this.fleeZ = z;
  }

  // Knocked down by a car or a punch: flat on the ground, then up and fleeing.
  knockDown(x, z) {
    this.state = 'down';
    this.stateTime = 0;
    this.fleeX = x;
    this.fleeZ = z;
    this.mesh.rotation.x = Math.PI / 2;
  }

  update(dt) {
    this.stateTime += dt;
    if (this.state === 'down') {
      if (this.stateTime > 2.5) {
        this.state = 'flee';
        this.stateTime = 0;
        this.mesh.rotation.x = 0;
      }
      return;
    }
    if (this.waiting) {
      // A mission passenger waits where they stand (their marker floats above).
      const marker = this.marker;
      if (marker) marker.rotation.y += dt * 1.5;
      return;
    }
    if (this.state === 'flee') {
      const dx = this.x - this.fleeX;
      const dz = this.z - this.fleeZ;
      const d = Math.hypot(dx, dz) || 1;
      const speed = PHYSICS.pedSpeed * 2.6;
      this.mesh.position.x = clamp(this.mesh.position.x + (dx / d) * speed * dt, -198, 198);
      this.mesh.position.z = clamp(this.mesh.position.z + (dz / d) * speed * dt, -198, 198);
      this.mesh.rotation.y = Math.atan2(dx, dz);
      this.walkPhase += dt * 12;
      if (this.stateTime > 5) {
        this.state = 'walk';
        // Rejoin the nearest road edge.
        let best = null;
        let bestD = Infinity;
        for (const node of this.graph.nodes) {
          const dd = (node.x - this.x) ** 2 + (node.z - this.z) ** 2;
          if (dd < bestD) {
            bestD = dd;
            best = node;
          }
        }
        const neighbours = this.graph.edges.get(this.graph.nodes.indexOf(best));
        this.from = this.graph.nodes.indexOf(best);
        this.to = neighbours[Math.floor(Math.random() * neighbours.length)];
        this.t = 0;
      }
    } else {
      this.t += (this.speed * dt) / 40;
      if (this.t >= 1) {
        const neighbours = this.graph.edges.get(this.to);
        const choices = neighbours.filter((n) => n !== this.from);
        this.from = this.to;
        this.to = choices.length ? choices[Math.floor(Math.random() * choices.length)] : neighbours[0];
        this.t = 0;
        if (Math.random() < 0.3) this.side = -this.side;
      }
      this.placeOnEdge();
      this.walkPhase += dt * 7;
    }
    // A simple walk cycle: legs swing opposite each other.
    const swing = Math.sin(this.walkPhase) * 0.5;
    const legL = this.mesh.getObjectByName('legL');
    const legR = this.mesh.getObjectByName('legR');
    if (legL) legL.rotation.x = swing;
    if (legR) legR.rotation.x = -swing;
  }

  // A floating diamond above this pedestrian, used for the mission passenger.
  setPassenger(active) {
    this.isPassenger = active;
    if (active && !this.marker) {
      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.6),
        new THREE.MeshLambertMaterial({ color: 0xf1c40f, emissive: 0x664400 }),
      );
      marker.position.y = 2.8;
      this.mesh.add(marker);
      this.marker = marker;
    } else if (!active && this.marker) {
      this.mesh.remove(this.marker);
      this.marker = null;
    }
  }

  remove(scene) {
    scene.remove(this.mesh);
  }
}

export function nearestPed(peds, x, z, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const ped of peds) {
    if (ped.state === 'down') continue;
    const d = dist2D(x, z, ped.x, ped.z);
    if (d < bestD) {
      bestD = d;
      best = ped;
    }
  }
  return best;
}
