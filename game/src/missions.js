// Neon Harbor — the story. Five missions from Vera Kade, the fixer Jax owes money
// to, each a small state machine with an objective, a waypoint beacon and a cash
// reward. The manager owns its own markers (packages, the passenger, the van) and
// reports events; main.js turns those into HUD text, sounds and cash.
import * as THREE from 'three';
import { MISSIONS, dist2D } from './config.js';

const STORY = {
  1: 'Vera Kade owns your debt and your evenings. "First job, Jax. Meet me at the marina, get wheels, bring them to the hideout. Don\'t make it complicated."',
  2: '"Three packages, three corners of the city, then the docks. Two minutes thirty. The harbour master counts slow, so don\'t be late."',
  3: '"The crew needs to know you can handle heat. Get the cops looking for you — two stars, minimum — then vanish. No jail, no headlines."',
  4: '"A friend of mine needs a quiet ride to Harbor Park. Pick them up at the casino. One scratch on the paint and the fare is half."',
  5: '"The big one. An armored van parks at the bank plaza at noon. Take it, bring it to the hideout, and bring the heat with you. Then we\'re even."',
};

// Package drops sit on intersections, never inside a building, so they are
// always reachable on foot or by car.
const PACKAGE_SPOTS = [
  { x: 140, z: -20, name: 'Casino corner' },
  { x: -140, z: -140, name: 'Harbor Park' },
  { x: 140, z: 140, name: 'South docks' },
];

function makeBeacon(color) {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 1.4, 14, 10, 1, true),
    new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  );
  beam.position.y = 7;
  group.add(beam);
  const diamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.9),
    new THREE.MeshLambertMaterial({ color, emissive: 0x442200 }),
  );
  diamond.position.y = 3.2;
  diamond.name = 'diamond';
  group.add(diamond);
  return group;
}

function makePackage() {
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0xf1c40f, emissive: 0x664400 }),
  );
  box.position.y = 1;
  box.castShadow = true;
  return box;
}

export class MissionManager {
  constructor(scene, places) {
    this.scene = scene;
    this.places = places;
    this.current = 0; // index into MISSIONS; 5 means the story is done
    this.step = 0;
    this.timer = 0;
    this.beacon = null;
    this.beaconTarget = null;
    this.packages = [];
    this.packagesGot = 0;
    this.passenger = null; // the Pedestrian object, set by the hooks
    this.van = null; // the PlayerCar object for the armored van
    this.hooks = null;
    this.started = false;
  }

  get active() {
    return this.current < MISSIONS.length;
  }

  get name() {
    return this.active ? MISSIONS[this.current].name : 'Free Roam';
  }

  start(index, hooks) {
    this.current = index;
    this.step = 0;
    this.timer = 0;
    this.packagesGot = 0;
    this.hooks = hooks;
    this.started = true;
    this.clearMarkers();
    const events = [{ type: 'intro', text: STORY[this.current] || '' }];
    this.setupStep();
    return events;
  }

  clearMarkers() {
    if (this.beacon) {
      this.scene.remove(this.beacon);
      this.beacon = null;
    }
    for (const p of this.packages) this.scene.remove(p.mesh);
    this.packages = [];
    if (this.hooks) {
      this.hooks.clearPassenger();
      this.hooks.clearVan();
    }
    this.passenger = null;
    this.van = null;
  }

  setBeacon(x, z, color = 0xf1c40f) {
    if (this.beacon) this.scene.remove(this.beacon);
    this.beacon = makeBeacon(color);
    this.beacon.position.set(x, 0, z);
    this.scene.add(this.beacon);
    this.beaconTarget = { x, z };
  }

  setupStep() {
    const p = this.places;
    if (!this.active) return;
    if (this.current === 0) {
      if (this.step === 0) this.setBeacon(p.marina.x, p.marina.z);
      else if (this.step === 1) this.setBeacon(p.playerStart.x, p.playerStart.z, 0x2ecc71);
      else this.setBeacon(p.hideout.x, p.hideout.z);
    } else if (this.current === 1) {
      if (this.step === 0) {
        for (const spot of PACKAGE_SPOTS) {
          const mesh = makePackage();
          mesh.position.set(spot.x, 1, spot.z);
          this.scene.add(mesh);
          this.packages.push({ ...spot, mesh, got: false });
        }
        this.setBeacon(PACKAGE_SPOTS[0].x, PACKAGE_SPOTS[0].z);
        this.timer = 150;
      } else {
        this.setBeacon(p.docks.x, p.docks.z);
      }
    } else if (this.current === 2) {
      // Heat is about the wanted level, not a place: no beacon this mission.
      if (this.beacon) {
        this.scene.remove(this.beacon);
        this.beacon = null;
        this.beaconTarget = null;
      }
    } else if (this.current === 3) {
      if (this.step === 0) {
        this.passenger = this.hooks.spawnPassenger({ x: p.casino.x + 6, z: p.casino.z });
        this.setBeacon(p.casino.x, p.casino.z);
      } else {
        this.setBeacon(p.park.x, p.park.z);
      }
    } else if (this.current === 4) {
      if (this.step === 0) {
        this.van = this.hooks.spawnVan({ x: 16, z: 0 });
        this.setBeacon(16, 0, 0xe74c3c);
      } else {
        this.setBeacon(p.hideout.x, p.hideout.z, 0xe74c3c);
      }
    }
  }

  objectiveText() {
    if (!this.started) return 'Free Roam — explore Neon Harbor.';
    if (!this.active) return 'Story complete — Neon Harbor is yours. Free roam.';
    const stepText = [
      ['Meet Vera at the marina', 'Get in a car', 'Drive to the hideout'],
      [`Collect the packages (${this.packagesGot}/3) — ${Math.max(0, Math.ceil(this.timer))}s left`, 'Deliver to the docks'],
      ['Raise heat to 2 stars', 'Lose the cops — wanted back to 0'],
      ['Pick up the passenger at the casino', 'Drive them to Harbor Park'],
      ['Steal the armored van at the bank plaza', 'Reach the hideout with 3 stars'],
    ];
    return `${this.name}: ${stepText[this.current][this.step]}`;
  }

  waypoint() {
    return this.beaconTarget;
  }

  // s: the player's live state {x, z, inCar, carHealth, wanted, carKind}.
  // Returns events for this frame: objective / complete / failed / intro.
  update(dt, s) {
    const events = [];
    if (!this.active || !this.started) return events;
    if (this.beacon) {
      const diamond = this.beacon.getObjectByName('diamond');
      if (diamond) diamond.rotation.y += dt * 2;
    }
    const reach = (target, radius = 4) => dist2D(s.x, s.z, target.x, target.z) < radius;
    const advance = (text) => {
      this.step += 1;
      this.setupStep();
      events.push({ type: 'objective', text });
    };
    const complete = () => {
      const reward = MISSIONS[this.current].reward;
      events.push({ type: 'complete', id: this.current, reward, name: MISSIONS[this.current].name });
      this.clearMarkers();
      this.current += 1;
      this.step = 0;
      if (this.active) {
        events.push({ type: 'intro', text: STORY[this.current] });
        this.setupStep();
      }
    };

    if (this.current === 0) {
      if (this.step === 0 && reach(this.places.marina)) advance('Vera nods. "Now get wheels."');
      else if (this.step === 1 && s.inCar) advance('Good. Hideout, south-west corner.');
      else if (this.step === 2 && s.inCar && reach(this.places.hideout)) complete();
    } else if (this.current === 1) {
      this.timer -= dt;
      if (this.timer <= 0) {
        events.push({ type: 'failed', reason: 'Out of time — the packages went cold.' });
        this.start(this.current, this.hooks);
        return events;
      }
      if (this.step === 0) {
        for (const pkg of this.packages) {
          if (!pkg.got && dist2D(s.x, s.z, pkg.x, pkg.z) < 3) {
            pkg.got = true;
            this.packagesGot += 1;
            this.scene.remove(pkg.mesh);
            events.push({ type: 'objective', text: `Package ${this.packagesGot}/3 secured.` });
            const next = this.packages.find((q) => !q.got);
            if (next) this.setBeacon(next.x, next.z);
          }
        }
        if (this.packagesGot >= 3) {
          this.step = 1;
          this.setupStep();
          events.push({ type: 'objective', text: 'All three. Now the docks, fast.' });
        }
      } else if (reach(this.places.docks)) {
        complete();
      }
    } else if (this.current === 2) {
      if (this.step === 0 && s.wanted >= 2) advance('Two stars. Now disappear.');
      else if (this.step === 1 && s.wanted === 0) complete();
    } else if (this.current === 3) {
      if (this.step === 0) {
        const px = this.passenger ? this.passenger.x : this.places.casino.x;
        const pz = this.passenger ? this.passenger.z : this.places.casino.z;
        if (dist2D(s.x, s.z, px, pz) < 3.5) {
          this.hooks.clearPassenger();
          this.passenger = null;
          advance('"Harbor Park, please. And easy on the corners."');
        }
      } else if (s.inCar && reach(this.places.park)) {
        if (s.carHealth >= 40) complete();
        else {
          events.push({ type: 'failed', reason: 'The car arrived in pieces — the fare walked.' });
          this.start(this.current, this.hooks);
        }
      }
    } else if (this.current === 4) {
      if (this.step === 0 && s.inCar && s.carKind === 'van') advance('The van is yours. Now run — and bring the heat.');
      else if (this.step === 1 && s.inCar && s.carKind === 'van' && s.wanted >= 3 && reach(this.places.hideout)) complete();
    }
    return events;
  }
}
