/**
 * Loads a user-selected GLB exhibit into the projection-room scene.
 *
 * The model's own meshes, textures, and materials are left intact. Placement
 * is controlled by transform.json in three.js' Y-up coordinate system.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const DEFAULT_EXHIBIT_TRANSFORM = Object.freeze({
  schema_version: 1,
  coordinate_system: "three.js_y_up",
  units: "meters",
  exhibit: {
    position: { x: 0, y: 0, z: 0 },
    rotation: {
      order: "YXZ",
      x_degrees: 0,
      y_degrees: 0,
      z_degrees: 0,
    },
    scale: { x: 1, y: 1, z: 1 },
  },
});

function finiteNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function canonicalTransform(config) {
  const source = config && typeof config === "object" ? config : {};
  const exhibit =
    source.exhibit && typeof source.exhibit === "object"
      ? source.exhibit
      : source;
  const position = exhibit.position || {};
  const rotation = exhibit.rotation || {};
  const scale = exhibit.scale || {};
  const uniformScale =
    typeof scale === "number" ? finiteNumber(scale, 1) : null;

  if (
    source.coordinate_system &&
    source.coordinate_system !== "three.js_y_up"
  ) {
    console.warn(
      `Exhibit transform uses "${source.coordinate_system}"; expected "three.js_y_up".`,
    );
  }

  const order = ["XYZ", "YZX", "ZXY", "XZY", "YXZ", "ZYX"].includes(
    rotation.order,
  )
    ? rotation.order
    : "YXZ";

  return {
    schema_version: 1,
    coordinate_system: "three.js_y_up",
    units: "meters",
    exhibit: {
      position: {
        x: finiteNumber(position.x, 0),
        y: finiteNumber(position.y, 0),
        z: finiteNumber(position.z, 0),
      },
      rotation: {
        order,
        x_degrees: finiteNumber(rotation.x_degrees ?? rotation.x, 0),
        y_degrees: finiteNumber(rotation.y_degrees ?? rotation.y, 0),
        z_degrees: finiteNumber(rotation.z_degrees ?? rotation.z, 0),
      },
      scale: {
        x:
          uniformScale ??
          finiteNumber(scale.x, finiteNumber(exhibit.scale, 1)),
        y:
          uniformScale ??
          finiteNumber(scale.y, finiteNumber(exhibit.scale, 1)),
        z:
          uniformScale ??
          finiteNumber(scale.z, finiteNumber(exhibit.scale, 1)),
      },
    },
  };
}

function normalizedTransform(config) {
  const canonical = canonicalTransform(config).exhibit;
  return {
    position: canonical.position,
    rotation: {
      order: canonical.rotation.order,
      x: THREE.MathUtils.degToRad(canonical.rotation.x_degrees),
      y: THREE.MathUtils.degToRad(canonical.rotation.y_degrees),
      z: THREE.MathUtils.degToRad(canonical.rotation.z_degrees),
    },
    scale: canonical.scale,
  };
}

function disposeMaterial(material) {
  for (const value of Object.values(material)) {
    if (value && value.isTexture) {
      value.dispose();
    }
  }
  material.dispose();
}

function disposeObject(root) {
  root.traverse((child) => {
    if (!child.isMesh) {
      return;
    }
    if (child.geometry) {
      child.geometry.dispose();
    }
    if (Array.isArray(child.material)) {
      child.material.forEach(disposeMaterial);
    } else if (child.material) {
      disposeMaterial(child.material);
    }
  });
}

export async function loadDefaultTransform() {
  try {
    const response = await fetch("./transform.json", {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.warn("Using the built-in exhibit transform:", error);
    return DEFAULT_EXHIBIT_TRANSFORM;
  }
}

export class ExhibitManager {
  constructor(scene, onStatus) {
    this._scene = scene;
    this._onStatus = onStatus || (() => {});
    this._loader = new GLTFLoader();
    this._root = null;
    this._objectUrl = null;
    this._loadToken = 0;
    this._transform = canonicalTransform(DEFAULT_EXHIBIT_TRANSFORM);
  }

  get hasModel() {
    return Boolean(this._root);
  }

  getTransform() {
    return JSON.parse(JSON.stringify(this._transform));
  }

  setTransform(transform) {
    this._transform = canonicalTransform(transform);
    if (!this._root) {
      return;
    }

    const placement = normalizedTransform(this._transform);
    this._root.position.set(
      placement.position.x,
      placement.position.y,
      placement.position.z,
    );
    this._root.rotation.set(
      placement.rotation.x,
      placement.rotation.y,
      placement.rotation.z,
      placement.rotation.order,
    );
    this._root.scale.set(
      placement.scale.x,
      placement.scale.y,
      placement.scale.z,
    );
  }

  rotateBy(axis, degrees) {
    if (!["x", "y", "z"].includes(axis)) {
      return;
    }
    const transform = this.getTransform();
    const key = `${axis}_degrees`;
    transform.exhibit.rotation[key] += finiteNumber(degrees, 0);
    this.setTransform(transform);
  }

  setOffset(axis, value) {
    if (!["x", "y", "z"].includes(axis)) {
      return;
    }
    const transform = this.getTransform();
    transform.exhibit.position[axis] = finiteNumber(
      value,
      transform.exhibit.position[axis],
    );
    this.setTransform(transform);
  }

  async load(file, transform = DEFAULT_EXHIBIT_TRANSFORM) {
    if (!file) {
      return false;
    }

    const token = ++this._loadToken;
    this._onStatus({ state: "loading", name: file.name });
    const objectUrl = URL.createObjectURL(file);

    try {
      const gltf = await this._loader.loadAsync(objectUrl);
      if (token !== this._loadToken) {
        disposeObject(gltf.scene);
        URL.revokeObjectURL(objectUrl);
        return false;
      }

      this.clear();
      this._objectUrl = objectUrl;
      this._root = gltf.scene;
      this._root.name = `Exhibit: ${file.name}`;
      this.setTransform(transform);
      this._scene.add(this._root);
      this._onStatus({ state: "ready", name: file.name });
      return true;
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      this._onStatus({
        state: "error",
        name: file.name,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  clear() {
    if (this._root) {
      this._scene.remove(this._root);
      disposeObject(this._root);
      this._root = null;
    }
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
  }
}
