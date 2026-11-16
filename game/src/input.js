// input.js — keyboard and mouse state for the human player. Event listeners write,
// the simulation reads, and the sim never touches the DOM itself. Mouse movement is
// accumulated into deltas that the player controller drains once per step, so look
// speed depends on the mouse, not on how often the browser fires events.

export class Input {
  constructor(dom) {
    this.keys = new Set();      // codes currently held
    this.pressed = new Set();   // codes that went down since the last consumePressed()
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.firing = false;        // left mouse held
    this.mouseDownRight = false;
    this.locked = false;        // pointer lock engaged on the canvas

    dom.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    dom.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.mouseDownRight = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.mouseDownRight = false;
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      // Keys the game owns outright: the page must never scroll or tab away mid-round.
      if (['Space', 'Tab', 'KeyB'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // Losing focus mid-firefight must not leave a key or the trigger stuck down.
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.firing = false;
      this.mouseDownRight = false;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      if (!this.locked) this.firing = false;
    });
  }

  /** Is this key code held right now? */
  down(code) { return this.keys.has(code); }

  /** Drain the look deltas accumulated since the last call. */
  takeLook() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  /** Drain the set of keys pressed since the last call (edge-triggered actions). */
  consumePressed() {
    const p = this.pressed;
    this.pressed = new Set();
    return p;
  }
}
