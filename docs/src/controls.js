/**
 * First-person controls: left-drag mouse-look + unrestricted WASD walking.
 * Room and exhibit meshes are visual only and do not create collisions.
 */

import * as THREE from "three";
import { EYE_HEIGHT_M } from "./room.js";

const MOVE_SPEED_MPS = 3.0;
const LOOK_SENSITIVITY = 0.0026; // Radians per pixel of drag.
const PITCH_LIMIT = THREE.MathUtils.degToRad(89.0);

export class FirstPersonControls {
  /**
   * @param {THREE.PerspectiveCamera} camera Camera to drive.
   * @param {HTMLElement} domElement Element that receives pointer events.
   */
  constructor(camera, domElement) {
    this._camera = camera;
    this._dom = domElement;

    this._yaw = 0.0; // Facing -Z (the centre wall) at yaw = 0.
    this._pitch = 0.0;
    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;
    this._enabled = true;

    this._keys = { w: false, a: false, s: false, d: false };

    this._reset();
    this._bind();
  }

  _reset() {
    this._camera.position.set(0, EYE_HEIGHT_M, 0);
    this._applyRotation();
  }

  _bind() {
    this._dom.addEventListener("mousedown", this._onDown);
    window.addEventListener("mouseup", this._onUp);
    window.addEventListener("mousemove", this._onMove);
    window.addEventListener("keydown", this._onKey);
    window.addEventListener("keyup", this._onKey);
  }

  _onDown = (e) => {
    if (!this._enabled || e.button !== 0) {
      return;
    }
    this._dragging = true;
    this._lastX = e.clientX;
    this._lastY = e.clientY;
    this._dom.style.cursor = "grabbing";
  };

  _onUp = () => {
    this._dragging = false;
    this._dom.style.cursor = "grab";
  };

  _onMove = (e) => {
    if (!this._enabled || !this._dragging) {
      return;
    }
    const dx = e.clientX - this._lastX;
    const dy = e.clientY - this._lastY;
    this._lastX = e.clientX;
    this._lastY = e.clientY;

    this._yaw += dx * LOOK_SENSITIVITY;
    this._pitch += dy * LOOK_SENSITIVITY;
    this._pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this._pitch));
    this._applyRotation();
  };

  _onKey = (e) => {
    const key = e.key.toLowerCase();
    if (key in this._keys) {
      this._keys[key] = this._enabled && e.type === "keydown";
    }
  };

  _applyRotation() {
    this._camera.rotation.set(this._pitch, this._yaw, 0, "YXZ");
  }

  setEnabled(enabled) {
    this._enabled = Boolean(enabled);
    if (!this._enabled) {
      this._dragging = false;
      for (const key of Object.keys(this._keys)) {
        this._keys[key] = false;
      }
      this._dom.style.cursor = "default";
    } else {
      this._dom.style.cursor = "grab";
    }
  }

  /**
   * Advances camera position from WASD input.
   *
   * @param {number} dt Elapsed seconds since the previous frame.
   */
  update(dt) {
    if (!this._enabled) {
      return;
    }
    const forwardInput =
      (this._keys.w ? 1 : 0) - (this._keys.s ? 1 : 0);
    const strafeInput = (this._keys.d ? 1 : 0) - (this._keys.a ? 1 : 0);
    if (forwardInput === 0 && strafeInput === 0) {
      return;
    }

    // Horizontal forward / right derived from yaw only (ignore pitch).
    const sin = Math.sin(this._yaw);
    const cos = Math.cos(this._yaw);
    const forward = new THREE.Vector3(-sin, 0, -cos);
    const right = new THREE.Vector3(cos, 0, -sin);

    const motion = new THREE.Vector3()
      .addScaledVector(forward, forwardInput)
      .addScaledVector(right, strafeInput);
    if (motion.lengthSq() > 0) {
      motion.normalize();
    }
    motion.multiplyScalar(MOVE_SPEED_MPS * dt);

    const pos = this._camera.position;
    pos.x += motion.x;
    pos.z += motion.z;
    pos.y = EYE_HEIGHT_M;
  }
}
