/**
 * Application bootstrap and render loop for the web Projection Room Viewer.
 *
 * Fully client-side: reads user-selected videos via the File API, renders the
 * five-wall + floor room with three.js, and maps the stitched frame onto each
 * surface using the same settings.json schema as the Python original.
 */

import * as THREE from "three";
import { buildRoom, EYE_HEIGHT_M } from "./room.js";
import { VideoManager } from "./video.js";
import { FirstPersonControls } from "./controls.js";
import { MappingOverlay } from "./overlay.js";

const canvas = document.getElementById("canvas");
const hud = document.getElementById("hud");
const statusEl = document.getElementById("status");
const startPanel = document.getElementById("start");
const pickBtn = document.getElementById("pickBtn");
const fileInput = document.getElementById("fileInput");

async function loadSettings() {
  try {
    const res = await fetch("./settings.json", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.warn("Falling back to built-in settings:", err);
    return DEFAULT_SETTINGS;
  }
}

// Mirrors the repo's settings.json so the app still works when opened without a
// server (e.g. file://), where fetch() of a local JSON may be blocked.
const DEFAULT_SETTINGS = {
  asset_directory: "./assets",
  master_video_resolution: { width: 1920, height: 1080 },
  mapping: {
    left_wall: { top_left_x: 0, top_left_y: 170, width_pixels: 480, height_pixels: 250, rotation_degrees: 0.0 },
    center_wall: { top_left_x: 480, top_left_y: 170, width_pixels: 480, height_pixels: 250, rotation_degrees: 0.0 },
    right_wall: { top_left_x: 960, top_left_y: 170, width_pixels: 480, height_pixels: 250, rotation_degrees: 0.0 },
    back_wall: { top_left_x: 1440, top_left_y: 170, width_pixels: 480, height_pixels: 250, rotation_degrees: 0.0 },
    floor: { top_left_x: 480, top_left_y: 420, width_pixels: 480, height_pixels: 480, rotation_degrees: 0.0 },
  },
};

async function init() {
  const settings = await loadSettings();

  // --- Renderer / scene / camera ---------------------------------------
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0d12);

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.05,
    100,
  );

  const room = buildRoom(scene, settings);
  const controls = new FirstPersonControls(camera, canvas);

  const video = new VideoManager(updateStatus);
  const overlay = new MappingOverlay(video.videoElement, settings);

  function updateStatus(state) {
    if (!state.total) {
      statusEl.textContent = "No video loaded";
      return;
    }
    const play = state.playing ? "playing" : "paused";
    const mute = state.muted ? " · muted" : " · sound on";
    statusEl.textContent =
      `[${state.index + 1}/${state.total}] ${state.name} (${play}${mute})`;
  }
  updateStatus({ total: 0 });

  // --- File loading (File API; nothing is uploaded) --------------------
  function handleFiles(files) {
    if (!files || files.length === 0) {
      return;
    }
    video.setFiles(files);
    if (video.hasClips) {
      room.setTexture(video.texture);
      startPanel.hidden = true;
      startPanel.style.display = "none";
      hud.hidden = false;
      canvas.style.cursor = "grab";
    }
  }

  pickBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => handleFiles(e.target.files));

  // Drag & drop anywhere.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  });

  // --- Playback / overlay key bindings ---------------------------------
  window.addEventListener("keydown", (e) => {
    switch (e.key) {
      case " ":
        e.preventDefault();
        video.togglePlay();
        break;
      case "ArrowRight":
        video.next();
        break;
      case "ArrowLeft":
        video.previous();
        break;
      case "Enter":
        overlay.toggle();
        break;
      case "m":
      case "M":
        video.toggleMute();
        break;
      default:
        break;
    }
  });

  // --- Resize handling --------------------------------------------------
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Render loop ------------------------------------------------------
  const clock = new THREE.Clock();
  function animate() {
    const dt = clock.getDelta();
    controls.update(dt);
    overlay.render();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
}

init();
