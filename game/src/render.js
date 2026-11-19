// Neon Harbor — the renderer. One three.js scene: a warm afternoon sun with a
// shadow camera that follows the player, a hemisphere sky light, distance fog,
// and a third-person camera that sits behind the player or the car and swings
// around with the mouse. Shots can freeze the camera on a posed frame.
import * as THREE from 'three';
import { clamp, angleLerp } from './config.js';

export class Render {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87bfe8);
    this.scene.fog = new THREE.Fog(0xa8c8e0, 140, 420);

    const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.85);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xffe3b3, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
    this.camYaw = Math.PI; // camera sits behind the player (heading 0 faces +z)
    this.camPitch = 0.34;
    this.camDist = 10;
    this.frozen = false;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Put the camera exactly here, looking there — used by the screenshot scenes.
  poseCamera(x, y, z, lx, ly, lz) {
    this.camera.position.set(x, y, z);
    this.camera.lookAt(lx, ly, lz);
    this.frozen = true;
  }

  unfreeze() {
    this.frozen = false;
  }

  // Follow the target (player or car): the camera eases behind the heading and
  // the mouse drag orbits it. dt is frame time; speed stretches the distance.
  update(dt, target, heading, speed, inCar, input) {
    if (this.frozen) return;
    if (input.dragging) {
      this.camYaw -= input.mouseDX * 0.005;
      this.camPitch = clamp(this.camPitch + input.mouseDY * 0.004, 0.1, 1.05);
    } else {
      this.camYaw = angleLerp(this.camYaw, heading + Math.PI, 1 - Math.exp(-2.2 * dt));
    }
    const wantDist = (inCar ? 13 : 9) + Math.abs(speed) * 0.12;
    this.camDist += (wantDist - this.camDist) * (1 - Math.exp(-3 * dt));
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const ox = -Math.sin(this.camYaw);
    const oz = -Math.cos(this.camYaw);
    const desired = new THREE.Vector3(
      target.x + ox * this.camDist * Math.cos(this.camPitch),
      target.y + 2 + Math.sin(this.camPitch) * this.camDist,
      target.z + oz * this.camDist * Math.cos(this.camPitch),
    );
    // Never let the camera sink under the street.
    desired.y = Math.max(desired.y, 2.2);
    const k = 1 - Math.exp(-10 * dt);
    this.camera.position.lerp(desired, k);
    this.camera.lookAt(target.x + fx * 4, target.y + 1.6, target.z + fz * 4);
    // The sun and its shadow box follow the player so shadows stay crisp.
    this.sun.position.set(target.x + 120, 180, target.z + 60);
    this.sun.target.position.set(target.x, 0, target.z);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
