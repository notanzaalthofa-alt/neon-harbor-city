// Neon Harbor — keyboard and mouse input. One object owns every key and button the
// game reads, with edge detection (pressedThisFrame) so a tap of E or F fires once.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed since the last endFrame
    this.mouseDown = false;
    this.mousePressed = false; // a click since the last endFrame
    this.mouseDX = 0; // accumulated pointer movement for the camera orbit
    this.mouseDY = 0;
    this.dragging = false;
    this.canvas = canvas;

    window.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      this.keys.add(event.code);
      this.pressed.add(event.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        event.preventDefault();
      }
    });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.dragging = false;
    });

    canvas.addEventListener('mousedown', (event) => {
      this.mouseDown = true;
      this.mousePressed = true;
      this.dragging = true;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    });
    window.addEventListener('mouseup', () => {
      this.mouseDown = false;
      this.dragging = false;
    });
    window.addEventListener('mousemove', (event) => {
      if (!this.dragging) return;
      this.mouseDX += event.clientX - (this.lastX ?? event.clientX);
      this.mouseDY += event.clientY - (this.lastY ?? event.clientY);
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  down(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  get clicked() {
    return this.mousePressed;
  }

  // Driving / walking axes, -1..1. W/S (or arrows) is forward/back, A/D is left/right.
  get throttle() {
    let value = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) value += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) value -= 1;
    return value;
  }

  get steer() {
    let value = 0;
    if (this.down('KeyA') || this.down('ArrowLeft')) value -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) value += 1;
    return value;
  }

  get run() {
    return this.down('ShiftLeft') || this.down('ShiftRight');
  }

  get handbrake() {
    return this.down('Space');
  }

  // Called at the end of every frame: edges live for exactly one frame.
  endFrame() {
    this.pressed.clear();
    this.mousePressed = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
