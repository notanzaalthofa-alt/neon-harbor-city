// Neon Harbor — the city itself. One seeded build lays out the whole map: a street
// grid painted onto a single ground texture, block buildings with procedural window
// facades, a marina with piers and boats on the south shore, a beach on the east,
// a park and a bank plaza. It also hands back the collision boxes, the road graph
// traffic and the autopilot drive on, and the named places the missions use.
import * as THREE from 'three';
import { WORLD, COLOURS, mulberry32 } from './config.js';

const ROAD_COORDS = [-180, -140, -100, -60, -20, 20, 60, 100, 140, 180];
const BLOCK_COORDS = [-160, -120, -80, -40, 0, 40, 80, 120, 160];

function makeFacadeTexture(base, windowsLit, rng) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 256);
  const cols = 6;
  const rows = 12;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const lit = rng() < windowsLit;
      ctx.fillStyle = lit ? '#ffd76a' : '#2c3e50';
      ctx.fillRect(8 + c * 20, 10 + r * 20, 12, 12);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// The whole street map as one 2048px canvas: grass, beach, water, roads with dashed
// centre lines, sidewalks, crosswalks, a park and a plaza. Canvas x maps to world x
// and canvas y maps to world z, both from -200 to +200.
function makeGroundTexture() {
  const S = 2048;
  const scale = S / 400;
  const X = (wx) => (wx + 200) * scale;
  const Z = (wz) => (wz + 200) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#4a7a45';
  ctx.fillRect(0, 0, S, S);
  // Beach strip on the east edge.
  ctx.fillStyle = '#e0c98f';
  ctx.fillRect(X(184), 0, S - X(184), S);
  // Water on the south shore.
  ctx.fillStyle = '#2a7fa8';
  ctx.fillRect(0, Z(188), S, S - Z(188));
  // Wet sand where the beach meets the water.
  ctx.fillStyle = '#c9b078';
  ctx.fillRect(X(184), Z(188), S - X(184), S - Z(188));

  // Park block: deeper green with paths.
  ctx.fillStyle = '#3d6b38';
  ctx.fillRect(X(-160), Z(-160), 40 * scale, 40 * scale);
  ctx.fillStyle = '#cbb98a';
  ctx.fillRect(X(-142), Z(-160), 4 * scale, 40 * scale);
  ctx.fillRect(X(-160), Z(-142), 40 * scale, 4 * scale);
  // Bank plaza at the centre: pale stone.
  ctx.fillStyle = '#b8b0a0';
  ctx.fillRect(X(-20), Z(-20), 40 * scale, 40 * scale);

  // Sidewalks: pale strips along every road.
  ctx.fillStyle = '#9a938a';
  for (const c of ROAD_COORDS) {
    ctx.fillRect(X(c - 7), 0, 14 * scale, S);
    ctx.fillRect(0, Z(c - 7), S, 14 * scale);
  }
  // Roads: dark asphalt with a dashed yellow centre line.
  ctx.fillStyle = '#2e2e33';
  for (const c of ROAD_COORDS) {
    ctx.fillRect(X(c - 5), 0, 10 * scale, S);
    ctx.fillRect(0, Z(c - 5), S, 10 * scale);
  }
  ctx.fillStyle = '#f5d76e';
  ctx.setLineDash([14, 18]);
  ctx.lineWidth = 1.6 * scale;
  for (const c of ROAD_COORDS) {
    ctx.beginPath();
    ctx.moveTo(X(c), 0);
    ctx.lineTo(X(c), S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, Z(c));
    ctx.lineTo(S, Z(c));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Crosswalks: white stripes where roads meet.
  ctx.fillStyle = '#e8e8e8';
  for (const rx of ROAD_COORDS) {
    for (const rz of ROAD_COORDS) {
      for (let i = -2; i <= 2; i += 1) {
        ctx.fillRect(X(rx - 5 + i * 2), Z(rz - 7), 1.2 * scale, 3 * scale);
        ctx.fillRect(X(rx - 5 + i * 2), Z(rz + 4), 1.2 * scale, 3 * scale);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function buildCity(scene, seed = 1337) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  // Ground: one textured plane for the whole map.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Facade textures: three height classes so windows stay proportional.
  // Seeded like the rest of the city, so the same seed builds the same city.
  const facades = [0, 1, 2].map((i) => {
    const tex = makeFacadeTexture('#cfc8b8', 0.25, rng);
    tex.repeat.set(1, 1 + i);
    return tex;
  });
  const materials = COLOURS.buildingPalette.map((color) => new THREE.MeshLambertMaterial({ color }));

  const colliders = [];
  const addCollider = (x, z, halfW, halfD) => {
    colliders.push({ minX: x - halfW, maxX: x + halfW, minZ: z - halfD, maxZ: z + halfD });
  };

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const placeBuilding = (x, z, w, d, h) => {
    const mat = materials[Math.floor(rng() * materials.length)];
    const texIndex = h > 28 ? 2 : h > 16 ? 1 : 0;
    const mesh = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: mat.color, map: facades[texIndex] }));
    mesh.scale.set(w, h, d);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // A flat roof cap so the top reads as a roof, not stretched facade.
    const roof = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x555550 }));
    roof.scale.set(w * 0.96, 0.6, d * 0.96);
    roof.position.set(x, h + 0.3, z);
    group.add(roof);
    // A rooftop box (AC unit) on taller buildings.
    if (h > 20 && rng() < 0.7) {
      const ac = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x888888 }));
      ac.scale.set(3, 1.6, 2.4);
      ac.position.set(x + w * 0.2, h + 1.4, z);
      group.add(ac);
    }
    addCollider(x, z, w / 2, d / 2);
  };

  // Buildings, one block at a time. The centre block is the bank plaza (one low,
  // wide bank), the park block stays green, the south row is the docks, the east
  // column is the beach: none of those get buildings.
  for (const bx of BLOCK_COORDS) {
    for (const bz of BLOCK_COORDS) {
      if (bx === 0 && bz === 0) {
        placeBuilding(0, 0, 22, 16, 12); // Neon Harbor National Bank
        continue;
      }
      if (bx === -140 && bz === -140) continue; // Harbor Park
      if (bz === 180 - 20) continue; // docks row (blocks at z=160 face the water)
      if (bx === 160) continue; // beach column
      const distCentre = Math.sqrt(bx * bx + bz * bz);
      const downtown = 1 - Math.min(1, distCentre / 260);
      const count = rng() < 0.55 ? 1 : rng() < 0.7 ? 2 : 3;
      for (let i = 0; i < count; i += 1) {
        const w = 9 + rng() * 9;
        const d = 9 + rng() * 9;
        const h = 8 + downtown * 26 + rng() * 10;
        const ox = count === 1 ? 0 : (rng() - 0.5) * 14;
        const oz = count === 1 ? 0 : (rng() - 0.5) * 14;
        placeBuilding(bx + ox, bz + oz, w, d, h);
      }
    }
  }

  // Marina: piers reaching into the water and three bobbing boats.
  const boats = [];
  const pierMat = new THREE.MeshLambertMaterial({ color: 0x8a6f4d });
  for (const px of [-80, 0, 80]) {
    const pier = new THREE.Mesh(boxGeo, pierMat);
    pier.scale.set(6, 1, 26);
    pier.position.set(px, 0.5, 196);
    group.add(pier);
    addCollider(px, 196, 3, 13);
  }
  const boatHull = new THREE.MeshLambertMaterial({ color: 0xe8e8e8 });
  const boatCabin = new THREE.MeshLambertMaterial({ color: 0x2e86c1 });
  for (let i = 0; i < 3; i += 1) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(boxGeo, boatHull);
    hull.scale.set(4, 1.6, 10);
    boat.add(hull);
    const cabin = new THREE.Mesh(boxGeo, boatCabin);
    cabin.scale.set(3, 1.6, 4);
    cabin.position.set(0, 1.5, -1);
    boat.add(cabin);
    boat.position.set(-60 + i * 60, 0.4, 206 + (i % 2) * 8);
    group.add(boat);
    boats.push(boat);
  }
  // Water plane, slightly below the ground, animated by update().
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 24),
    new THREE.MeshLambertMaterial({ color: COLOURS.water, transparent: true, opacity: 0.92 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.35, 200);
  group.add(water);
  // The shore itself blocks walking and driving into the sea.
  addCollider(0, 200, 200, 12);

  // Palms: Harbor Park and the beach strip.
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2e8b57 });
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 6, 6);
  const leafGeo = new THREE.ConeGeometry(2.6, 2.2, 6);
  const placePalm = (x, z) => {
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 3;
    palm.add(trunk);
    const leaves = new THREE.Mesh(leafGeo, leafMat);
    leaves.position.y = 6.8;
    palm.add(leaves);
    palm.position.set(x, 0, z);
    group.add(palm);
  };
  for (let i = 0; i < 10; i += 1) placePalm(-158 + rng() * 36, -158 + rng() * 36);
  for (let i = 0; i < 8; i += 1) placePalm(188 + rng() * 8, -160 + i * 44 + rng() * 10);

  // Street lamps at every other intersection.
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 7, 6);
  const headGeo = new THREE.SphereGeometry(0.5, 8, 6);
  for (const rx of ROAD_COORDS) {
    for (const rz of ROAD_COORDS) {
      if ((rx + rz) % 80 !== 0) continue;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(rx + 6, 3.5, rz + 6);
      group.add(pole);
      const head = new THREE.Mesh(headGeo, new THREE.MeshLambertMaterial({ color: 0xfff2b0 }));
      head.position.set(rx + 6, 7, rz + 6);
      group.add(head);
    }
  }

  // Road graph: intersections are nodes, roads between them are edges. Traffic
  // and the screenshot autopilot drive on it.
  const graph = { nodes: [], edges: new Map() };
  const nodeIndex = new Map();
  for (const rx of ROAD_COORDS) {
    for (const rz of ROAD_COORDS) {
      const id = graph.nodes.length;
      nodeIndex.set(`${rx},${rz}`, id);
      graph.nodes.push({ x: rx, z: rz });
      graph.edges.set(id, []);
    }
  }
  const link = (ax, az, bx, bz) => {
    const a = nodeIndex.get(`${ax},${az}`);
    const b = nodeIndex.get(`${bx},${bz}`);
    graph.edges.get(a).push(b);
    graph.edges.get(b).push(a);
  };
  for (let i = 0; i < ROAD_COORDS.length - 1; i += 1) {
    for (const c of ROAD_COORDS) {
      link(ROAD_COORDS[i], c, ROAD_COORDS[i + 1], c);
      link(c, ROAD_COORDS[i], c, ROAD_COORDS[i + 1]);
    }
  }

  // Named places the missions drive the player between.
  const places = {
    playerStart: { x: 0, z: 176 },
    hideout: { x: -160, z: 160 },
    bankPlaza: { x: 0, z: 0 },
    casino: { x: 160, z: -40 },
    docks: { x: 120, z: 176 },
    marina: { x: 0, z: 184 },
    park: { x: -140, z: -140 },
  };

  return {
    group,
    colliders,
    graph,
    places,
    update(dt, t) {
      for (let i = 0; i < boats.length; i += 1) {
        boats[i].position.y = 0.4 + Math.sin(t * 0.8 + i * 2) * 0.25;
        boats[i].rotation.z = Math.sin(t * 0.6 + i) * 0.02;
      }
      water.position.y = 0.35 + Math.sin(t * 0.5) * 0.08;
    },
  };
}

// Circle (a car, a person) against the building boxes: push the circle out and
// report the hit, so driving into a wall slides instead of stopping dead.
export function collideCircle(colliders, x, z, radius) {
  let hit = false;
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - nx;
    const dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        x = nx + (dx / d) * radius;
        z = nz + (dz / d) * radius;
      } else {
        // Dead centre inside the box: shove out along the shortest axis.
        const left = x - c.minX;
        const right = c.maxX - x;
        const top = z - c.minZ;
        const bottom = c.maxZ - z;
        const m = Math.min(left, right, top, bottom);
        if (m === left) x = c.minX - radius;
        else if (m === right) x = c.maxX + radius;
        else if (m === top) z = c.minZ - radius;
        else z = c.maxZ + radius;
      }
    }
  }
  return { x, z, hit };
}

// The nearest road point to (x, z): traffic snaps to roads, and the autopilot
// uses it to get back on the road after a shortcut.
export function nearestRoadPoint(graph, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const node of graph.nodes) {
    const d = (node.x - x) * (node.x - x) + (node.z - z) * (node.z - z);
    if (d < bestD) {
      bestD = d;
      best = node;
    }
  }
  return best;
}
