/**
 * input.js — input abstraction layer
 *
 * Maps raw input events (keyboard, mouse) to named game actions.
 * VR controller bindings can be added here without touching game logic.
 *
 * Usage:
 *   const input = new InputManager(canvas);
 *   input.init();
 *
 *   // in game loop:
 *   if (input.isPressed(ACTIONS.MOVE_FORWARD)) { ... }
 *   if (input.justPressed(ACTIONS.LIGHT_ATTACK)) { ... }
 *   input.endFrame(); // call at end of each frame to clear justPressed state
 *
 * Mouse look:
 *   input.mouseDelta.x / .y  — accumulated mouse movement since last endFrame()
 *   Canvas must have pointer lock; call input.requestPointerLock().
 *
 * See CLAUDE.md §WebXR preparation for why this layer exists.
 */

export const ACTIONS = Object.freeze({
  MOVE_FORWARD: 'moveForward',
  MOVE_BACKWARD: 'moveBackward',
  MOVE_LEFT: 'moveLeft',
  MOVE_RIGHT: 'moveRight',
  LIGHT_ATTACK: 'lightAttack',
  HEAVY_ATTACK: 'heavyAttack',
  ROLL: 'roll',
});

// Default keyboard bindings: code → action
const DEFAULT_KEY_BINDINGS = {
  KeyW: ACTIONS.MOVE_FORWARD,
  KeyS: ACTIONS.MOVE_BACKWARD,
  KeyA: ACTIONS.MOVE_LEFT,
  KeyD: ACTIONS.MOVE_RIGHT,
  ArrowUp: ACTIONS.MOVE_FORWARD,
  ArrowDown: ACTIONS.MOVE_BACKWARD,
  ArrowLeft: ACTIONS.MOVE_LEFT,
  ArrowRight: ACTIONS.MOVE_RIGHT,
  Space: ACTIONS.ROLL,
};

// Mouse button → action (0 = left, 2 = right)
const DEFAULT_MOUSE_BINDINGS = {
  0: ACTIONS.LIGHT_ATTACK,
  2: ACTIONS.HEAVY_ATTACK,
};

export class InputManager {
  constructor(canvas) {
    this._canvas = canvas;
    this._keyBindings = { ...DEFAULT_KEY_BINDINGS };
    this._mouseBindings = { ...DEFAULT_MOUSE_BINDINGS };

    this._held = new Set();    // actions currently held down
    this._justDown = new Set(); // actions pressed this frame
    this._justUp = new Set();   // actions released this frame

    this.mouseDelta = { x: 0, y: 0 }; // accumulated this frame
    this.isPointerLocked = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
  }

  init() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this._canvas.addEventListener('mousedown', this._onMouseDown);
    this._canvas.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    // Prevent right-click context menu on canvas
    this._canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this._canvas.removeEventListener('mousedown', this._onMouseDown);
    this._canvas.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
  }

  requestPointerLock() {
    this._canvas.requestPointerLock();
  }

  exitPointerLock() {
    document.exitPointerLock();
  }

  /** Is the action currently held down? */
  isPressed(action) {
    return this._held.has(action);
  }

  /** Was the action pressed for the first time this frame? */
  justPressed(action) {
    return this._justDown.has(action);
  }

  /** Was the action released this frame? */
  justReleased(action) {
    return this._justUp.has(action);
  }

  /**
   * Call at the end of every frame to clear per-frame state.
   * Must be called after all game logic has read input for the frame.
   */
  endFrame() {
    this._justDown.clear();
    this._justUp.clear();
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
  }

  // ── Private handlers ────────────────────────────────────────────────────────

  _onKeyDown(e) {
    if (e.repeat) return;
    const action = this._keyBindings[e.code];
    if (action) {
      e.preventDefault();
      if (!this._held.has(action)) {
        this._held.add(action);
        this._justDown.add(action);
      }
    }
  }

  _onKeyUp(e) {
    const action = this._keyBindings[e.code];
    if (action && this._held.has(action)) {
      this._held.delete(action);
      this._justUp.add(action);
    }
  }

  _onMouseDown(e) {
    // Only capture clicks on the canvas; request pointer lock on first click
    if (!this.isPointerLocked) {
      this.requestPointerLock();
      return;
    }
    const action = this._mouseBindings[e.button];
    if (action && !this._held.has(action)) {
      this._held.add(action);
      this._justDown.add(action);
    }
  }

  _onMouseUp(e) {
    const action = this._mouseBindings[e.button];
    if (action && this._held.has(action)) {
      this._held.delete(action);
      this._justUp.add(action);
    }
  }

  _onMouseMove(e) {
    if (!this.isPointerLocked) return;
    this.mouseDelta.x += e.movementX;
    this.mouseDelta.y += e.movementY;
  }

  _onPointerLockChange() {
    this.isPointerLocked = document.pointerLockElement === this._canvas;
  }
}
