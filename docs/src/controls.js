/**
 * First-person controls: left-drag mouse-look + WASD walking, clamped to the
 * room bounds. Ports the camera behaviour from the Panda3D viewer.
 */

import * as THREE from "three";
import { EYE_HEIGHT_M, ROOM_WIDTH_M, ROOM_DEPTH_M } from "./room.js";

const MOVE_SPEED_MPS = 3.0;
const LOOK_SENSITIVITY = 0.0026; // Radians per pixel of drag.
const PITCH_LIMIT = THREE.MathUtils.degToRad(89.0);
const WALL_MARGIN_M = 0.15;

const HALF_W = ROOM_WIDTH_M / 2.0;
const HALF_D = ROOM_DEPTH_M / 2.0;

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
    if (e.button !== 0) {
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
    if (!this._dragging) {
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
      this._keys[key] = e.type === "keydown";
    }
  };

  _applyRotation() {
    this._camera.rotation.set(this._pitch, this._yaw, 0, "YXZ");
  }

  /**
   * Advances camera position from WASD input.
   *
   * @param {number} dt Elapsed seconds since the previous frame.
   */
  update(dt) {
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
    const limitX = HALF_W - WALL_MARGIN_M;
    const limitZ = HALF_D - WALL_MARGIN_M;
    pos.x = Math.max(-limitX, Math.min(limitX, pos.x + motion.x));
    pos.z = Math.max(-limitZ, Math.min(limitZ, pos.z + motion.z));
    pos.y = EYE_HEIGHT_M;
  }
}
