// Neon Harbor — the HUD and the menus. Everything the player reads is plain DOM
// over the 3D canvas: wanted stars, cash, health, speed, the mission objective,
// a message feed, and a 2D minimap drawn on a small canvas. The title, pause,
// busted and story-complete screens are DOM panels too.
import { clamp } from './config.js';

const ROAD_COORDS = [-180, -140, -100, -60, -20, 20, 60, 100, 140, 180];

export class Hud {
  constructor() {
    this.el = {};
    for (const id of [
      'hud', 'stars', 'cash', 'health-fill', 'health-num', 'speed', 'objective',
      'objective-dist', 'messages', 'crosshair', 'ammo', 'minimap', 'screen-title',
      'screen-pause', 'screen-busted', 'screen-wasted', 'screen-done', 'title-save',
      'title-stats', 'toast', 'mission-name',
    ]) {
      this.el[id] = document.getElementById(id);
    }
    this.mapCtx = this.el.minimap ? this.el.minimap.getContext('2d') : null;
    this.messageTimers = [];
  }

  showScreen(name) {
    const map = {
      title: 'screen-title',
      pause: 'screen-pause',
      busted: 'screen-busted',
      wasted: 'screen-wasted',
      done: 'screen-done',
    };
    for (const [key, id] of Object.entries(map)) {
      if (this.el[id]) this.el[id].style.display = key === name ? 'flex' : 'none';
    }
    if (this.el.hud) this.el.hud.style.display = name === 'play' ? 'block' : 'none';
    if (this.el.crosshair) this.el.crosshair.style.display = 'none';
  }

  setTitleSave(text) {
    if (this.el['title-save']) this.el['title-save'].textContent = text;
  }

  setTitleStats(text) {
    if (this.el['title-stats']) this.el['title-stats'].textContent = text;
  }

  pushMessage(text) {
    if (!this.el.messages) return;
    const line = document.createElement('div');
    line.className = 'msg';
    line.textContent = text;
    this.el.messages.appendChild(line);
    while (this.el.messages.children.length > 4) {
      this.el.messages.removeChild(this.el.messages.firstChild);
    }
    const timer = setTimeout(() => {
      if (line.parentNode) line.parentNode.removeChild(line);
    }, 6000);
    this.messageTimers.push(timer);
  }

  toast(text) {
    if (!this.el.toast) return;
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.el.toast.style.opacity = '0';
    }, 3200);
  }

  // s: {stars, cash, health, speed, inCar, ammo, armed, objective, missionName,
  // waypointDist, playerX, playerZ, heading, police, traffic, waypoint, screen}
  update(s) {
    if (this.el.stars) {
      this.el.stars.textContent = '★'.repeat(s.stars) + '☆'.repeat(5 - s.stars);
      this.el.stars.style.color = s.stars >= 3 ? '#ff4444' : s.stars > 0 ? '#ffcc00' : '#888888';
    }
    if (this.el.cash) this.el.cash.textContent = `$${s.cash.toLocaleString('en-US')}`;
    if (this.el['health-fill']) this.el['health-fill'].style.width = `${clamp(s.health, 0, 100)}%`;
    if (this.el['health-num']) this.el['health-num'].textContent = `${Math.round(s.health)}`;
    if (this.el.speed) this.el.speed.textContent = s.inCar ? `${Math.round(Math.abs(s.speed) * 3.6)} km/h` : '';
    if (this.el.objective) this.el.objective.textContent = s.objective;
    if (this.el['mission-name']) this.el['mission-name'].textContent = s.missionName;
    if (this.el['objective-dist']) {
      this.el['objective-dist'].textContent = s.waypointDist === null ? '' : `${Math.round(s.waypointDist)}m`;
    }
    if (this.el.ammo) {
      this.el.ammo.textContent = s.armed ? `Pistol ${s.ammo}` : 'Fists (Q: pistol)';
      this.el.ammo.style.display = s.inCar ? 'none' : 'block';
    }
    if (this.el.crosshair) {
      this.el.crosshair.style.display = s.armed && !s.inCar && s.screen === 'play' ? 'block' : 'none';
    }
    this.drawMinimap(s);
  }

  drawMinimap(s) {
    const ctx = this.mapCtx;
    if (!ctx) return;
    const size = 180;
    const scale = size / 400;
    const X = (wx) => (wx + 200) * scale;
    const Z = (wz) => (wz + 200) * scale;
    ctx.fillStyle = '#1d2b1a';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#2a7fa8';
    ctx.fillRect(0, Z(188), size, size - Z(188));
    ctx.fillStyle = '#e0c98f';
    ctx.fillRect(X(184), 0, size - X(184), size);
    ctx.strokeStyle = '#555550';
    ctx.lineWidth = 3;
    for (const c of ROAD_COORDS) {
      ctx.beginPath();
      ctx.moveTo(X(c), 0);
      ctx.lineTo(X(c), size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, Z(c));
      ctx.lineTo(size, Z(c));
      ctx.stroke();
    }
    // Traffic as pale dots.
    ctx.fillStyle = '#dddddd';
    for (const car of s.traffic || []) {
      ctx.fillRect(X(car.x) - 1, Z(car.z) - 1, 2, 2);
    }
    // The mission waypoint: a pulsing yellow diamond.
    if (s.waypoint) {
      const pulse = 4 + Math.sin(Date.now() / 300) * 1.5;
      ctx.fillStyle = '#f1c40f';
      const wx = X(s.waypoint.x);
      const wz = Z(s.waypoint.z);
      ctx.beginPath();
      ctx.moveTo(wx, wz - pulse);
      ctx.lineTo(wx + pulse, wz);
      ctx.lineTo(wx, wz + pulse);
      ctx.lineTo(wx - pulse, wz);
      ctx.closePath();
      ctx.fill();
    }
    // Police as red dots.
    ctx.fillStyle = '#ff3333';
    for (const cop of s.police || []) {
      ctx.beginPath();
      ctx.arc(X(cop.x), Z(cop.z), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // The player: a white arrow pointing where they face.
    const px = X(s.playerX);
    const pz = Z(s.playerZ);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(Math.atan2(Math.sin(s.heading), Math.cos(s.heading)) + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // North is up: a small N.
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('N', 4, 12);
  }
}
