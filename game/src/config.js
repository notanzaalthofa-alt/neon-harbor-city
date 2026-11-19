// Neon Harbor — shared constants and helpers. Everything the game tunes lives here:
// world size, colours, physics, wanted rules, mission rewards, save key.
export const WORLD = {
  half: 200, // city spans -200..200 on x and z
  roadEvery: 40, // avenues/streets every 40 units
  roadWidth: 10,
  blockSize: 30,
};

export const COLOURS = {
  sky: 0x87bfe8,
  fog: 0xa8c8e0,
  sun: 0xffe3b3,
  ground: 0x3f5a44,
  sidewalk: 0x9a938a,
  road: 0x2e2e33,
  roadLine: 0xf5d76e,
  water: 0x2a7fa8,
  sand: 0xe0c98f,
  buildingPalette: [0xd8c9a3, 0xc98d6b, 0x7fb3b0, 0xe8e0cc, 0xb08968, 0x8fa8bf, 0xd9a441, 0x9b7fb0],
  carPalette: [0xc0392b, 0x2980b9, 0xf1c40f, 0x27ae60, 0x8e44ad, 0xe67e22, 0xecf0f1, 0x1a1a1a, 0x16a085, 0xd35400],
  police: 0x1a1a22,
  policeLight: 0x2244ff,
  playerShirt: 0x2e86c1,
  playerPants: 0x2c3e50,
};

export const PHYSICS = {
  walkSpeed: 6,
  runSpeed: 10,
  carAccel: 14,
  carBrake: 30,
  carMaxSpeed: 34,
  carReverseMax: 10,
  carTurn: 1.9,
  carGrip: 0.94,
  trafficSpeed: 9,
  policeSpeed: 38,
  pedSpeed: 2.2,
};

export const WANTED = {
  maxStars: 5,
  stealCar: 1,
  hitPed: 1,
  shoot: 1,
  killCop: 2,
  decaySeconds: 12, // one star fades after this long with no cop near
  bustedSeconds: 2, // a cop touching the player on foot this long busts them
};

export const MISSIONS = [
  { id: 1, name: 'First Wheels', reward: 150 },
  { id: 2, name: 'Package Run', reward: 300 },
  { id: 3, name: 'Heat', reward: 250 },
  { id: 4, name: 'The Pickup', reward: 350 },
  { id: 5, name: 'The Big One', reward: 800 },
];

export const SAVE_KEY = 'neon-harbor-save-v1';

// Mulberry32: a tiny seeded PRNG so the city, traffic and screenshots are identical
// every load for the same seed. The game's own runs reseed from the clock; the
// screenshot scenes reseed from the shot's seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// A stable string hash, so a mission or district name always seeds the same way.
export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
