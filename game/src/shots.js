// Neon Harbor — the screenshot scenes behind ?shot=start|drive|chase|mission.
// Each one resets the world with the shot's seed, plays the real game forward
// with a scripted input (the same step function the live game runs, so the frame
// is what a short game really looks like), poses the camera, and freezes the
// simulation so the frame holds still for the screenshot.
import { clamp, dist2D } from './config.js';

const STEP = 1 / 60;

class ScriptedInput {
  constructor() {
    this.throttle = 0;
    this.steer = 0;
    this.run = false;
    this.handbrake = false;
    this.pressed = new Set();
    this.clicked = false;
    this.dragging = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  press(code) {
    this.pressed.add(code);
  }

  endFrame() {
    this.pressed.clear();
  }
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Steer the player's car toward a point, slowing for the turn ahead: a sharp
// turn at full speed overshoots the corner into the building across the
// intersection. Never cut the throttle to zero for a big steering error — a
// stopped car cannot turn at all (turn authority is zero at speed zero), so
// the car would sit dead in the road forever. Instead cap the speed: full
// throttle below the target speed, coast above it.
function driveToward(world, input, tx, tz) {
  const car = world.playerCar;
  const err = wrapAngle(Math.atan2(tx - car.x, tz - car.z) - car.heading);
  input.steer = clamp(err * 2.2, -1, 1);
  const targetSpeed = Math.abs(err) > 0.5 ? 12 : 34;
  input.throttle = Math.abs(car.speed) < targetSpeed ? 1 : 0;
}

// Follow a route of road intersections, reversing out if the car gets stuck.
function followRoute(world, input, route, dt, state) {
  const car = world.playerCar;
  const target = route[state.index];
  if (dist2D(car.x, car.z, target.x, target.z) < 10) {
    state.index = Math.min(state.index + 1, route.length - 1);
  }
  if (state.reverseTime > 0) {
    state.reverseTime -= dt;
    input.throttle = -1;
    input.steer = 0; // back straight out of the wall, then re-aim
    return;
  }
  driveToward(world, input, route[state.index].x, route[state.index].z);
  if (Math.abs(car.speed) < 2 && input.throttle > 0) {
    state.stuckTime += dt;
    if (state.stuckTime > 1) {
      state.reverseTime = 1.2;
      state.stuckTime = 0;
    }
  } else {
    state.stuckTime = 0;
  }
}

function runSteps(world, input, seconds, drive) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    if (drive) drive(world, input, STEP);
    const events = [];
    world.stepWorld(STEP, input, events);
    input.endFrame();
  }
  // Staging must never leave the player wrecked or dead in the frame.
  world.player.health = 100;
  world.playerCar.health = 100;
}

function chaseCamera(world) {
  const car = world.playerCar;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  world.render.poseCamera(
    car.x - fx * 13, 5.5, car.z - fz * 13,
    car.x + fx * 8, 1.6, car.z + fz * 8,
  );
}

function hudFor(world) {
  const waypoint = world.missions.waypoint();
  return {
    objective: world.missions.objectiveText(),
    missionName: world.missions.active && world.missions.started ? `Mission ${world.missions.current + 1} — ${world.missions.name}` : 'Free Roam',
    stars: world.wanted.stars,
    waypointDist: waypoint ? dist2D(world.player.x, world.player.z, waypoint.x, waypoint.z) : null,
    waypoint,
  };
}

/**
 * Stage the named scene and return what the HUD should show over it.
 * world: the live game object main.js builds (scene, render, player, playerCar,
 * traffic, peds, police, wanted, missions, combat, resetWorld, stepWorld,
 * startMission, missionHooks, places, graph).
 */
export function stageShot(name, world, seed = 1) {
  const input = new ScriptedInput();
  world.resetWorld(seed);

  if (name === 'drive') {
    // The player is already at the marina, so meeting Vera and getting in the
    // car complete in the first steps, and the frame shows the real objective:
    // driving to the hideout through live traffic.
    world.startMission(0);
    world.playerCar.place(0, 182, Math.PI);
    world.player.inCar = true;
    world.player.mesh.visible = false;
    world.player.x = world.playerCar.x;
    world.player.z = world.playerCar.z;
    world.player.heading = world.playerCar.heading;
    const route = [
      { x: -20, z: 180 }, { x: -20, z: 60 }, { x: 60, z: 60 },
      { x: 60, z: -60 }, { x: 140, z: -60 }, { x: 140, z: 60 },
    ];
    const state = { index: 0, stuckTime: 0, reverseTime: 0 };
    runSteps(world, input, 18, (w, inp, dt) => followRoute(w, inp, route, dt, state));
    chaseCamera(world);
    return { screen: 'play', ...hudFor(world) };
  }

  if (name === 'chase') {
    world.playerCar.place(20, -100, Math.PI);
    world.player.inCar = true;
    world.player.mesh.visible = false;
    world.player.x = world.playerCar.x;
    world.player.z = world.playerCar.z;
    world.player.heading = world.playerCar.heading;
    world.wanted.add(3);
    const route = [
      { x: 20, z: -140 }, { x: 140, z: -140 }, { x: 140, z: 20 },
      { x: 60, z: 20 }, { x: 60, z: 140 }, { x: -60, z: 140 },
    ];
    const state = { index: 0, stuckTime: 0, reverseTime: 0 };
    runSteps(world, input, 10, (w, inp, dt) => followRoute(w, inp, route, dt, state));
    chaseCamera(world);
    return { screen: 'play', ...hudFor(world) };
  }

  if (name === 'mission') {
    world.startMission(1);
    world.player.x = 132;
    world.player.z = -20;
    world.player.heading = Math.PI / 2;
    runSteps(world, input, 4, null);
    const p = world.player;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    // High and far enough back that the player reads at the bottom of the
    // frame instead of being cropped out behind the beacon.
    world.render.poseCamera(p.x - fx * 9, 5, p.z - fz * 9, 140, 1.5, -20);
    return { screen: 'play', ...hudFor(world) };
  }

  // start (and anything else): the title screen over a living city.
  runSteps(world, input, 6, null);
  world.render.poseCamera(60, 85, 185, -20, 0, -40);
  return { screen: 'title', ...hudFor(world) };
}
