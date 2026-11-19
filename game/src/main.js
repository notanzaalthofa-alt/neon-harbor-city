// Neon Harbor — the game itself. This wires every system together: the city, the
// player on foot and in cars, traffic, pedestrians, police, missions, combat, the
// HUD, the save and the sound. The simulation runs in fixed 1/60 steps, and the
// screenshot scenes drive those same steps with a scripted input, so a screenshot
// is a real frame of the real game, never a staged mock-up.
import * as THREE from 'three';
import { PHYSICS, clamp, dist2D, mulberry32 } from './config.js';
import { Input } from './input.js';
import { AudioBank } from './audio.js';
import { loadSave, storeSave, clearSave } from './save.js';
import { buildCity, collideCircle } from './city.js';
import { makeCarMesh, TrafficCar, PlayerCar, nearestCar } from './vehicles.js';
import { Pedestrian, nearestPed } from './people.js';
import { Wanted, PoliceCar, syncPolice } from './police.js';
import { MissionManager } from './missions.js';
import { Combat } from './combat.js';
import { Hud } from './hud.js';
import { Render } from './render.js';
import { stageShot } from './shots.js';

const STEP = 1 / 60;
const TRAFFIC_COUNT = 14;
const PARKED_COUNT = 4;
const PED_COUNT = 20;

const params = new URLSearchParams(window.location.search);
const SHOT = params.get('shot');
const SEED = Number(params.get('seed') || 1) || 1;

const canvas = document.getElementById('game');
const input = new Input(canvas);
const audio = new AudioBank();
const hud = new Hud();
const render = new Render(canvas);
const scene = render.scene;

const city = buildCity(scene, 1337);
const graph = city.graph;
const places = city.places;

const save = loadSave();
let cash = save.cash;
let screen = 'play'; // title | play | pause | busted | wasted | done
let time = 0;
let saveTimer = 0;
let titleYaw = 0;

// --- The player -------------------------------------------------------------
function makePlayerMesh() {
  const person = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.05, 0.4),
    new THREE.MeshLambertMaterial({ color: 0x2e86c1 }),
  );
  body.position.y = 1.05;
  body.castShadow = true;
  person.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xf1c27d }),
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

const player = {
  mesh: makePlayerMesh(),
  x: places.playerStart.x,
  z: places.playerStart.z,
  heading: Math.PI, // facing north, into the city
  speed: 0,
  health: 100,
  inCar: false,
  walkPhase: 0,
};
scene.add(player.mesh);

// --- Cars, people, police ---------------------------------------------------
let playerCar = new PlayerCar(scene, 0x2980b9, 'sedan');
playerCar.place(places.playerStart.x + 4, places.playerStart.z, Math.PI / 2);
let traffic = [];
let peds = [];
let police = [];
let vanCar = null; // the armored van of mission 5, while it waits at the bank
let passengerPed = null; // the fare of mission 4, while they wait at the casino

const wanted = new Wanted();
const missions = new MissionManager(scene, places);
const combat = new Combat(scene);

function spawnTraffic(seed) {
  const rng = mulberry32(seed);
  traffic = [];
  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    const kind = rng() < 0.12 ? 'taxi' : rng() < 0.12 ? 'sport' : 'sedan';
    traffic.push(new TrafficCar(scene, graph, rng, kind));
  }
  for (let i = 0; i < PARKED_COUNT; i += 1) {
    const car = new TrafficCar(scene, graph, rng, 'sedan');
    car.parked = true;
    car.placeOnEdge();
    traffic.push(car);
  }
}

function spawnPeds(seed) {
  const rng = mulberry32(seed);
  peds = [];
  for (let i = 0; i < PED_COUNT; i += 1) {
    const ped = new Pedestrian(scene, graph, rng);
    ped.placeOnEdge();
    peds.push(ped);
  }
}

function clearDynamic() {
  for (const car of traffic) scene.remove(car.mesh);
  for (const ped of peds) ped.remove(scene);
  for (const cop of police) cop.remove(scene);
  if (vanCar) {
    scene.remove(vanCar.mesh);
    vanCar = null;
  }
  if (passengerPed) {
    passengerPed.remove(scene);
    passengerPed = null;
  }
  traffic = [];
  peds = [];
  police = [];
}

function resetWorld(seed) {
  clearDynamic();
  spawnTraffic(seed);
  spawnPeds(seed + 7);
  wanted.clear();
  player.x = places.playerStart.x;
  player.z = places.playerStart.z;
  player.heading = Math.PI;
  player.speed = 0;
  player.health = 100;
  player.inCar = false;
  player.mesh.visible = true;
  playerCar.place(places.playerStart.x + 4, places.playerStart.z, Math.PI / 2);
  playerCar.health = 100;
  playerCar.stolen = false;
}

// The mission hooks: the mission manager asks the world to put a passenger and a
// van on the street, and to take them away again.
const missionHooks = {
  spawnPassenger(pos) {
    const ped = new Pedestrian(scene, graph, mulberry32(99));
    ped.mesh.position.set(pos.x, 0, pos.z);
    ped.waiting = true;
    ped.setPassenger(true);
    peds.push(ped);
    passengerPed = ped;
    return ped;
  },
  clearPassenger() {
    if (!passengerPed) return;
    passengerPed.remove(scene);
    peds = peds.filter((p) => p !== passengerPed);
    passengerPed = null;
  },
  spawnVan(pos) {
    vanCar = new PlayerCar(scene, 0x3a5a3a, 'van');
    vanCar.place(pos.x, pos.z, Math.PI / 2);
    return vanCar;
  },
  clearVan() {
    if (!vanCar) return;
    scene.remove(vanCar.mesh);
    vanCar = null;
  },
};

// --- Crimes, cash, respawns --------------------------------------------------
function onCrime(stars, reason) {
  const before = wanted.stars;
  wanted.add(stars);
  if (wanted.stars > before) {
    hud.pushMessage(`${reason} — wanted +${stars}`);
    if (wanted.stars > save.bestWanted) save.bestWanted = wanted.stars;
  }
}

function onMessage(text) {
  hud.pushMessage(text);
}

function respawn(kind) {
  const fee = kind === 'busted' ? 150 : 100;
  cash = Math.max(0, cash - fee);
  player.health = 100;
  player.inCar = false;
  player.mesh.visible = true;
  playerCar.health = 100;
  if (kind === 'busted') {
    player.x = places.bankPlaza.x + 8;
    player.z = places.bankPlaza.z + 8;
    wanted.clear();
    syncPolice(scene, police, 0, graph, player.x, player.z, mulberry32(1));
    hud.pushMessage(`Busted. Bail $${fee} — Vera is not impressed.`);
  } else {
    player.x = places.park.x;
    player.z = places.park.z;
    hud.pushMessage(`Wasted. The clinic took $${fee}.`);
  }
  player.heading = Math.PI;
  player.speed = 0;
  playerCar.place(player.x + 4, player.z, Math.PI / 2);
  if (missions.active) missions.start(missions.current, missionHooks);
  storeSave({ ...save, cash });
  screen = 'play';
  hud.showScreen('play');
}

// --- Entering and leaving cars ----------------------------------------------
function tryEnterCar() {
  // The player's own parked car is free; any other car is a theft.
  const own = dist2D(player.x, player.z, playerCar.x, playerCar.z);
  if (own < 4.5 && playerCar.health > 0) {
    player.inCar = true;
    player.mesh.visible = false;
    hud.pushMessage('In your car.');
    return;
  }
  if (vanCar && dist2D(player.x, player.z, vanCar.x, vanCar.z) < 4.5) {
    const color = vanCar.color;
    scene.remove(playerCar.mesh);
    playerCar = vanCar;
    vanCar = null;
    playerCar.stolen = true;
    player.inCar = true;
    player.mesh.visible = false;
    onCrime(2, 'Armored van stolen');
    hud.pushMessage('The van is yours. Run!');
    return;
  }
  const car = nearestCar(traffic, player.x, player.z, 4.5);
  if (car) {
    const color = car.color;
    const kind = car.kind;
    const cx = car.x;
    const cz = car.z;
    const heading = car.mesh.rotation.y;
    scene.remove(car.mesh);
    car.dead = true;
    traffic = traffic.filter((c) => c !== car);
    scene.remove(playerCar.mesh);
    playerCar = new PlayerCar(scene, color, kind);
    playerCar.place(cx, cz, heading);
    playerCar.stolen = true;
    player.inCar = true;
    player.mesh.visible = false;
    onCrime(1, 'Car stolen');
    hud.pushMessage('Car stolen — the city saw that.');
  }
}

function exitCar() {
  player.inCar = false;
  player.x = playerCar.x + Math.sin(playerCar.heading + Math.PI / 2) * 3;
  player.z = playerCar.z + Math.cos(playerCar.heading + Math.PI / 2) * 3;
  const fixed = collideCircle(city.colliders, player.x, player.z, 0.8);
  player.x = fixed.x;
  player.z = fixed.z;
  player.heading = playerCar.heading;
  player.mesh.visible = true;
  playerCar.speed = 0;
}

// --- One fixed simulation step, shared by the live game and the shots --------
function stepWorld(dt, inp, events) {
  time += dt;
  city.update(dt, time);

  for (const car of traffic) car.update(dt, traffic);
  for (const ped of peds) ped.update(dt);

  // A car that brushes a pedestrian at speed scares them off the road.
  for (const ped of peds) {
    if (ped.state !== 'walk') continue;
    for (const car of traffic) {
      if (!car.parked && dist2D(ped.x, ped.z, car.x, car.z) < 2.5) {
        ped.scare(car.x, car.z);
        break;
      }
    }
    if (player.inCar && Math.abs(playerCar.speed) > 12 && dist2D(ped.x, ped.z, playerCar.x, playerCar.z) < 4) {
      ped.scare(playerCar.x, playerCar.z);
    }
  }

  // Police: as many cars as stars, chasing the player, ramming on contact.
  syncPolice(scene, police, wanted.stars, graph, player.x, player.z, mulberry32(5));
  let nearestCop = Infinity;
  for (const cop of police) {
    const touching = cop.update(dt, player.x, player.z, city.colliders, time);
    nearestCop = Math.min(nearestCop, dist2D(cop.x, cop.z, player.x, player.z));
    if (touching && player.inCar) {
      playerCar.health = Math.max(0, playerCar.health - 22 * dt);
      playerCar.speed *= 1 - 1.4 * dt;
      if (Math.random() < dt * 2) audio.crash();
    }
  }
  const busted = wanted.update(dt, nearestCop, !player.inCar);
  if (busted === 'busted') events.push({ type: 'busted' });

  // The player, on foot or behind the wheel.
  if (player.inCar) {
    playerCar.update(dt, inp, city.colliders, traffic, (impact) => {
      audio.crash();
      player.health = Math.max(0, player.health - impact * 0.25);
    });
    player.x = playerCar.x;
    player.z = playerCar.z;
    player.heading = playerCar.heading;
    player.speed = playerCar.speed;
    if (playerCar.health <= 0) {
      events.push({ type: 'wrecked' });
      exitCar();
      playerCar.health = 0;
      hud.pushMessage('Your car is wrecked — steal another one.');
    }
    if (inp.wasPressed('KeyE')) exitCar();
  } else {
    const camYaw = render.camYaw;
    const fx = -Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw);
    const rz = -Math.sin(camYaw);
    const moveX = fx * inp.throttle + rx * inp.steer;
    const moveZ = fz * inp.throttle + rz * inp.steer;
    const moving = Math.hypot(moveX, moveZ) > 0.01;
    const speed = inp.run ? PHYSICS.runSpeed : PHYSICS.walkSpeed;
    if (moving) {
      const len = Math.hypot(moveX, moveZ);
      player.heading = Math.atan2(moveX / len, moveZ / len);
      player.x += (moveX / len) * speed * dt;
      player.z += (moveZ / len) * speed * dt;
      player.walkPhase += dt * (inp.run ? 12 : 8);
    }
    player.speed = moving ? speed : 0;
    const fixed = collideCircle(city.colliders, player.x, player.z, 0.8);
    player.x = clamp(fixed.x, -198, 198);
    player.z = clamp(fixed.z, -198, 198);
    const legL = player.mesh.getObjectByName('legL');
    const legR = player.mesh.getObjectByName('legR');
    const swing = moving ? Math.sin(player.walkPhase) * 0.5 : 0;
    if (legL) legL.rotation.x = swing;
    if (legR) legR.rotation.x = -swing;
    // A car that runs the player down hurts.
    const hitter = nearestCar(traffic, player.x, player.z, 1.6);
    if (hitter && !hitter.parked) {
      player.health = Math.max(0, player.health - 25);
      player.x += Math.sin(player.heading) * 2;
      player.z += Math.cos(player.heading) * 2;
      audio.crash();
      hud.pushMessage('Hit by a car!');
      hitter.speed *= 0.3;
    }
    if (inp.wasPressed('KeyE')) tryEnterCar();
    if (inp.wasPressed('KeyQ')) {
      const armed = combat.toggleWeapon();
      hud.pushMessage(armed ? 'Pistol out. Click to fire.' : 'Pistol away.');
    }
  }

  combat.update(dt, inp, {
    x: player.x,
    z: player.z,
    heading: player.heading,
    camDir: { x: -Math.sin(render.camYaw), z: -Math.cos(render.camYaw) },
    peds,
    police,
    wanted,
    audio,
    onCrime,
    onMessage,
    inCar: player.inCar,
    armed: combat.armed,
  });

  // Missions.
  const missionEvents = missions.update(dt, {
    x: player.x,
    z: player.z,
    inCar: player.inCar,
    carHealth: playerCar.health,
    wanted: wanted.stars,
    carKind: playerCar.kind,
  });
  for (const event of missionEvents) {
    if (event.type === 'intro') hud.pushMessage(event.text);
    else if (event.type === 'objective') hud.pushMessage(event.text);
    else if (event.type === 'failed') {
      audio.busted();
      hud.pushMessage(`Mission failed: ${event.reason}`);
    } else if (event.type === 'complete') {
      cash += event.reward;
      save.missionsDone = [...new Set([...save.missionsDone, event.id])];
      audio.missionDone();
      hud.toast(`${event.name} complete — +$${event.reward}`);
      hud.pushMessage(`${event.name} complete. +$${event.reward}`);
      storeSave({ ...save, cash });
      if (!missions.active) events.push({ type: 'story-done' });
    }
  }

  if (player.health <= 0) events.push({ type: 'wasted' });

  // Sound: the engine follows the car, the siren follows the heat.
  audio.setEngine(player.inCar ? Math.abs(playerCar.speed) / PHYSICS.carMaxSpeed : 0, player.inCar);
  audio.setSiren(wanted.stars > 0 && police.length > 0);

  // Autosave every ten seconds.
  saveTimer += dt;
  if (saveTimer > 10) {
    saveTimer = 0;
    storeSave({ ...save, cash });
  }
}

// --- HUD state, built fresh every frame --------------------------------------
function hudState() {
  const waypoint = missions.waypoint();
  return {
    stars: wanted.stars,
    cash,
    health: player.health,
    speed: player.inCar ? playerCar.speed : 0,
    inCar: player.inCar,
    ammo: combat.ammo,
    armed: combat.armed,
    objective: missions.objectiveText(),
    missionName: missions.active ? `Mission ${missions.current + 1} — ${missions.name}` : 'Free Roam',
    waypointDist: waypoint ? dist2D(player.x, player.z, waypoint.x, waypoint.z) : null,
    playerX: player.x,
    playerZ: player.z,
    heading: player.heading,
    police,
    traffic,
    waypoint,
    screen,
  };
}

// --- Screens ------------------------------------------------------------------
function startGame(fresh) {
  if (fresh) {
    clearSave();
    save.cash = 200;
    save.missionsDone = [];
    save.bestWanted = 0;
    cash = 200;
  }
  resetWorld(1337);
  const startMission = fresh ? 0 : save.missionsDone.length;
  if (startMission >= 5) {
    // The story is done: free roam, no mission to start.
    missions.current = 5;
    missions.started = true;
    hud.pushMessage('Welcome back — the story is done, Neon Harbor is yours.');
  } else {
    const intro = missions.start(startMission, missionHooks);
    for (const event of intro) if (event.text) hud.pushMessage(event.text);
  }
  render.unfreeze();
  screen = 'play';
  hud.showScreen('play');
  hud.pushMessage(fresh ? 'New game — meet Vera at the marina.' : `Welcome back — ${missions.name}.`);
}

function showTitle() {
  screen = 'title';
  resetWorld(1337);
  render.unfreeze();
  const done = save.missionsDone.length;
  hud.setTitleSave(done > 0 ? `Continue — Mission ${done + 1} of 5 ($${cash})` : 'New game — $200 in your pocket');
  hud.setTitleStats(`Best wanted: ${'★'.repeat(save.bestWanted)}${'☆'.repeat(5 - save.bestWanted)} · Games played: ${save.gamesPlayed}`);
  hud.showScreen('title');
  save.gamesPlayed += 1;
  storeSave({ ...save, cash });
}

// --- Input edges that open menus (only the live game, never the shots) --------
window.addEventListener('keydown', (event) => {
  if (SHOT) return;
  if (event.code === 'Enter') {
    audio.ensure();
    if (screen === 'title') startGame(false);
    else if (screen === 'busted' || screen === 'wasted') respawn(screen);
    else if (screen === 'done') {
      screen = 'play';
      hud.showScreen('play');
    }
  }
  if (event.code === 'Backspace' && screen === 'title') startGame(true);
  if ((event.code === 'KeyP' || event.code === 'Escape') && (screen === 'play' || screen === 'pause')) {
    screen = screen === 'play' ? 'pause' : 'play';
    hud.showScreen(screen);
  }
  if (event.code === 'KeyM') audio.setMuted(!audio.muted);
  if (event.code === 'KeyR' && screen === 'play' && missions.active) {
    missions.start(missions.current, missionHooks);
    hud.pushMessage(`Restarted: ${missions.name}.`);
  }
});
canvas.addEventListener('mousedown', () => audio.ensure());

// --- Main loop -----------------------------------------------------------------
let last = performance.now();
let accumulator = 0;

function liveFrame(now) {
  requestAnimationFrame(liveFrame);
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.1);
  if (screen === 'title') {
    // The city lives behind the title: traffic, pedestrians and a slow orbit.
    accumulator += dt;
    while (accumulator >= STEP) {
      accumulator -= STEP;
      const events = [];
      stepWorld(STEP, { throttle: 0, steer: 0, run: false, handbrake: false, wasPressed: () => false, clicked: false, dragging: false, mouseDX: 0, mouseDY: 0 }, events);
    }
    titleYaw += dt * 0.03;
    render.poseCamera(Math.sin(titleYaw) * 150, 95, Math.cos(titleYaw) * 150, 0, 0, 40);
    render.render();
    input.endFrame();
    return;
  }
  if (screen !== 'play') {
    render.render();
    input.endFrame();
    return;
  }
  accumulator += dt;
  let guard = 0;
  while (accumulator >= STEP && guard < 5) {
    accumulator -= STEP;
    guard += 1;
    const events = [];
    stepWorld(STEP, input, events);
    for (const event of events) {
      if (event.type === 'busted') {
        screen = 'busted';
        hud.showScreen('busted');
        audio.busted();
      } else if (event.type === 'wasted') {
        screen = 'wasted';
        hud.showScreen('wasted');
        audio.busted();
      } else if (event.type === 'story-done') {
        screen = 'done';
        hud.showScreen('done');
      }
    }
  }
  render.update(dt, { x: player.x, y: 0, z: player.z }, player.heading, player.speed, player.inCar, input);
  render.render();
  hud.update(hudState());
  input.endFrame();
}

// --- Screenshot mode: stage the scene, render it frozen, report ready --------
if (SHOT) {
  const staged = stageShot(SHOT, {
    scene, render, input, audio, hud, city, graph, places,
    player, traffic, peds, police, wanted, missions, combat,
    get playerCar() { return playerCar; },
    resetWorld, stepWorld, missionHooks,
    startMission: (index) => missions.start(index, missionHooks),
  }, SEED);
  screen = staged.screen;
  hud.showScreen(staged.screen === 'title' ? 'title' : 'play');
  hud.setTitleSave('');
  hud.update({
    ...hudState(),
    objective: staged.objective,
    missionName: staged.missionName,
    stars: staged.stars,
    waypointDist: staged.waypointDist,
    waypoint: staged.waypoint,
  });
  let rendered = false;
  const shotFrame = () => {
    render.render();
    hud.update({
      ...hudState(),
      objective: staged.objective,
      missionName: staged.missionName,
      stars: staged.stars,
      waypointDist: staged.waypointDist,
      waypoint: staged.waypoint,
    });
    if (!rendered) {
      rendered = true;
      window.__shotReady = true;
    }
    requestAnimationFrame(shotFrame);
  };
  requestAnimationFrame(shotFrame);
} else {
  showTitle();
  requestAnimationFrame(liveFrame);
}
