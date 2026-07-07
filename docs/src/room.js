/**
 * Room geometry and pixel-crop -> UV mapping for the projection viewer.
 *
 * This is a direct port of the Panda3D `_WALL_CORNERS` layout and
 * `_crop_to_uv` logic from `main.py`. Coordinates are authored in the original
 * Panda3D world space (X = width, Y = depth, Z = height, Z-up) and converted to
 * three.js Y-up space with `(x, y, z) -> (x, z, -y)`, which preserves
 * handedness so the viewer faces the centre wall by looking down -Z.
 */

import * as THREE from "three";

// --- Fixed room geometry (metres). Centre of the floor is the world origin. -
export const ROOM_WIDTH_M = 5.0;
export const ROOM_DEPTH_M = 5.0;
export const ROOM_HEIGHT_M = 2.5;
export const EYE_HEIGHT_M = 1.75;

const HALF_W = ROOM_WIDTH_M / 2.0;
const HALF_D = ROOM_DEPTH_M / 2.0;
const TOP = ROOM_HEIGHT_M;

// Distinct, high-contrast colours for the mapping-inspection overlay.
export const OVERLAY_COLORS = [
  "#ff5959",
  "#66ff73",
  "#59d9ff",
  "#fff266",
  "#ff8cff",
  "#ffb24d",
];

/**
 * Corners for every quad in bottom-left, bottom-right, top-right, top-left
 * order, matching the mapped content's upright orientation. Given in Panda3D
 * world space (x = width, y = depth, z = height); converted to three.js below.
 */
const WALL_CORNERS = {
  left_wall: [
    [-HALF_W, -HALF_D, 0.0],
    [-HALF_W, HALF_D, 0.0],
    [-HALF_W, HALF_D, TOP],
    [-HALF_W, -HALF_D, TOP],
  ],
  center_wall: [
    [-HALF_W, HALF_D, 0.0],
    [HALF_W, HALF_D, 0.0],
    [HALF_W, HALF_D, TOP],
    [-HALF_W, HALF_D, TOP],
  ],
  right_wall: [
    [HALF_W, HALF_D, 0.0],
    [HALF_W, -HALF_D, 0.0],
    [HALF_W, -HALF_D, TOP],
    [HALF_W, HALF_D, TOP],
  ],
  back_wall: [
    [HALF_W, -HALF_D, 0.0],
    [-HALF_W, -HALF_D, 0.0],
    [-HALF_W, -HALF_D, TOP],
    [HALF_W, -HALF_D, TOP],
  ],
  floor: [
    [-HALF_W, -HALF_D, 0.0],
    [HALF_W, -HALF_D, 0.0],
    [HALF_W, HALF_D, 0.0],
    [-HALF_W, HALF_D, 0.0],
  ],
};

/** Converts a Panda3D (x, y, z) Z-up corner into three.js Y-up space. */
function toThree([x, y, z]) {
  return [x, z, -y];
}

/**
 * Converts a pixel crop region into rotated UV corners.
 *
 * Pixel coordinates use a top-left origin; three.js texture coordinates use a
 * bottom-left origin (with VideoTexture's default flipY), so the vertical axis
 * is flipped. `rotation_degrees` rotates the sampled content about its centre.
 *
 * @param {object} crop Mapping entry with top_left_x/y, width/height_pixels.
 * @param {number} masterW Master frame width in pixels.
 * @param {number} masterH Master frame height in pixels.
 * @returns {number[][]} Four [u, v] pairs in BL, BR, TR, TL order.
 */
export function cropToUv(crop, masterW, masterH) {
  const x0 = Number(crop.top_left_x);
  const y0 = Number(crop.top_left_y);
  const w = Number(crop.width_pixels);
  const h = Number(crop.height_pixels);
  const rotation = ((Number(crop.rotation_degrees) || 0) * Math.PI) / 180.0;

  const uLeft = x0 / masterW;
  const uRight = (x0 + w) / masterW;
  const vTop = 1.0 - y0 / masterH;
  const vBottom = 1.0 - (y0 + h) / masterH;

  const base = [
    [uLeft, vBottom],
    [uRight, vBottom],
    [uRight, vTop],
    [uLeft, vTop],
  ];
  if (rotation === 0.0) {
    return base;
  }

  const uc = (uLeft + uRight) / 2.0;
  const vc = (vTop + vBottom) / 2.0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return base.map(([u, v]) => {
    const du = u - uc;
    const dv = v - vc;
    return [uc + du * cos - dv * sin, vc + du * sin + dv * cos];
  });
}

/**
 * Builds every wall/floor quad from the settings mapping and adds them to the
 * scene.
 *
 * @param {THREE.Scene} scene Scene to attach the meshes to.
 * @param {object} settings Parsed settings.json.
 * @returns {{ meshes: THREE.Mesh[], setTexture: (t: THREE.Texture|null) => void,
 *   masterWidth: number, masterHeight: number }}
 */
export function buildRoom(scene, settings) {
  const masterWidth = Number(settings.master_video_resolution.width);
  const masterHeight = Number(settings.master_video_resolution.height);
  const mapping = settings.mapping || {};

  const meshes = [];
  for (const [name, corners] of Object.entries(WALL_CORNERS)) {
    const crop = mapping[name];
    if (!crop) {
      // Skip surfaces without a mapping entry rather than break.
      continue;
    }
    const uvs = cropToUv(crop, masterWidth, masterHeight);
    const mesh = makeQuad(name, corners, uvs);
    scene.add(mesh);
    meshes.push(mesh);
  }

  /** Applies (or clears) the shared video texture on every surface. */
  function setTexture(texture) {
    for (const mesh of meshes) {
      mesh.material.map = texture;
      mesh.material.color.set(texture ? 0xffffff : 0x1f2030);
      mesh.material.needsUpdate = true;
    }
  }

  return { meshes, setTexture, masterWidth, masterHeight };
}

/**
 * Creates a textured, double-sided, unlit quad from four corners and four UV
 * pairs (BL, BR, TR, TL), triangulated as (0,1,2) + (0,2,3) to match main.py.
 */
function makeQuad(name, corners, uvs) {
  const geometry = new THREE.BufferGeometry();

  const positions = new Float32Array(4 * 3);
  const uv = new Float32Array(4 * 2);
  corners.forEach((corner, i) => {
    const [x, y, z] = toThree(corner);
    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    uv[i * 2 + 0] = uvs[i][0];
    uv[i * 2 + 1] = uvs[i][1];
  });

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color: 0x1f2030,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}
