/**
 * Application bootstrap and render loop for the web Projection Room Viewer.
 *
 * Fully client-side: reads user-selected videos via the File API, renders the
 * five-wall + floor room with three.js, and maps the stitched frame onto each
 * surface using the same settings.json schema as the Python original.
 */

import * as THREE from "three";
import { buildRoom } from "./room.js";
import { MediaManager } from "./video.js";
import { FirstPersonControls } from "./controls.js";
import { MappingOverlay } from "./overlay.js";
import { CalibrationController } from "./calibration.js";
import {
  ExhibitManager,
  loadDefaultTransform,
} from "./exhibit.js";

const canvas = document.getElementById("canvas");
const hud = document.getElementById("hud");
const statusEl = document.getElementById("status");
const exhibitStatusEl = document.getElementById("exhibitStatus");
const startPanel = document.getElementById("start");
const pickBtn = document.getElementById("pickBtn");
const fileInput = document.getElementById("fileInput");
const meters = document.getElementById("meters");
const speedMeter = document.getElementById("speedMeter");
const fpsMeter = document.getElementById("fpsMeter");
const transport = document.getElementById("transport");
const transportToggle = document.getElementById("transportToggle");
const playPauseBtn = document.getElementById("playPauseBtn");
const stopBtn = document.getElementById("stopBtn");
const playhead = document.getElementById("playhead");
const timeReadout = document.getElementById("timeReadout");

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
  master_video_resolution: { width: 3840, height: 1440 },
  mapping: {
    left_wall: { top_left_x: 0, top_left_y: 0, width_pixels: 960, height_pixels: 480, rotation_degrees: 0.0 },
    center_wall: { top_left_x: 960, top_left_y: 0, width_pixels: 960, height_pixels: 480, rotation_degrees: 0.0 },
    right_wall: { top_left_x: 1920, top_left_y: 0, width_pixels: 960, height_pixels: 480, rotation_degrees: 0.0 },
    back_wall: { top_left_x: 2880, top_left_y: 0, width_pixels: 960, height_pixels: 480, rotation_degrees: 0.0 },
    floor: { top_left_x: 960, top_left_y: 480, width_pixels: 960, height_pixels: 960, rotation_degrees: 0.0 },
  },
};

async function init() {
  const [settings, defaultExhibitTransform] = await Promise.all([
    loadSettings(),
    loadDefaultTransform(),
  ]);

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
  scene.add(new THREE.AmbientLight(0xffffff, 2.0));

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.05,
    100,
  );

  const room = buildRoom(scene, settings);
  const controls = new FirstPersonControls(camera, canvas);
  const exhibit = new ExhibitManager(scene, updateExhibitStatus);
  const calibration = new CalibrationController(exhibit, (visible) =>
    controls.setEnabled(!visible),
  );

  const media = new MediaManager(updateStatus, (texture) =>
    room.setTexture(texture),
  );
  media.setMasterResolution(room.masterWidth, room.masterHeight);
  const overlay = new MappingOverlay(media, settings);
  let scrubbing = false;

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return "00:00";
    }
    const whole = Math.floor(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    const mm = String(minutes).padStart(hours > 0 ? 2 : 1, "0");
    const ss = String(secs).padStart(2, "0");
    return hours > 0
      ? `${hours}:${mm}:${ss}`
      : `${String(minutes).padStart(2, "0")}:${ss}`;
  }

  function updateTransport() {
    if (!playhead || !playPauseBtn || !stopBtn || !timeReadout) {
      return;
    }
    const enabled = media.isVideo && media.duration > 0;
    playhead.disabled = !enabled;
    playPauseBtn.disabled = !enabled;
    stopBtn.disabled = !enabled;

    const duration = enabled ? media.duration : 0;
    const current = enabled ? media.currentTime : 0;
    playhead.max = String(duration);
    if (!scrubbing) {
      playhead.value = String(current);
    }
    playPauseBtn.textContent = media.isPlaying ? "❚❚" : "▶";
    playPauseBtn.setAttribute(
      "aria-label",
      media.isPlaying ? "Pause" : "Play",
    );
    const shownTime = scrubbing ? Number(playhead.value) : current;
    timeReadout.textContent =
      `${formatTime(shownTime)} / ${formatTime(duration)}`;
  }

  function updateStatus(state) {
    if (speedMeter && typeof state.speedPercent === "number") {
      speedMeter.textContent = `${state.speedPercent}%`;
    }
    if (!statusEl) {
      return;
    }
    if (!state.total) {
      statusEl.textContent = "No media loaded";
      return;
    }
    if (state.kind === "image") {
      statusEl.textContent =
        `[${state.index + 1}/${state.total}] ${state.name} (image)`;
      return;
    }
    const play = state.playing ? "playing" : "paused";
    const mute = state.muted ? " · muted" : " · sound on";
    statusEl.textContent =
      `[${state.index + 1}/${state.total}] ${state.name} (${play}${mute})`;
  }
  updateStatus({ total: 0 });

  // --- File loading (File API; nothing is uploaded) --------------------
  function showViewer() {
    if (startPanel) {
      startPanel.hidden = true;
      startPanel.style.display = "none";
    }
    if (hud) {
      hud.hidden = false;
    }
    if (meters) {
      meters.hidden = false;
    }
    if (transport) {
      transport.hidden = false;
    }
    if (transportToggle) {
      transportToggle.hidden = false;
    }
    canvas.style.cursor = "grab";
  }

  function updateExhibitStatus(state) {
    if (!exhibitStatusEl) {
      return;
    }
    if (state.state === "loading") {
      exhibitStatusEl.textContent = `Loading exhibit: ${state.name}…`;
    } else if (state.state === "ready") {
      exhibitStatusEl.textContent = `Exhibit: ${state.name}`;
    } else if (state.state === "error") {
      exhibitStatusEl.textContent =
        `Could not load ${state.name}: ${state.message}`;
    }
  }

  async function handleFiles(files) {
    if (!files || files.length === 0) {
      return;
    }

    const selected = Array.from(files);
    const glbFile = selected.find(
      (file) =>
        file.type === "model/gltf-binary" || /\.glb$/i.test(file.name),
    );

    media.setFiles(selected);
    if (media.hasClips) {
      showViewer();
    }

    if (glbFile) {
      showViewer();
      try {
        await exhibit.load(glbFile, defaultExhibitTransform);
      } catch (error) {
        console.error("Unable to load exhibit GLB:", error);
      }
    }
  }

  pickBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => handleFiles(e.target.files));

  if (playPauseBtn) {
    playPauseBtn.addEventListener("click", () => media.togglePlay());
  }
  if (stopBtn) {
    stopBtn.addEventListener("click", () => media.stop());
  }
  if (transport && transportToggle) {
    transportToggle.addEventListener("click", () => {
      const collapsed = transport.classList.toggle("transport-collapsed");
      transportToggle.classList.toggle("controls-collapsed", collapsed);
      if (hud) {
        hud.classList.toggle("ui-collapsed", collapsed);
      }
      if (meters) {
        meters.classList.toggle("ui-collapsed", collapsed);
      }
      transportToggle.textContent = collapsed ? "▲" : "▼";
      transportToggle.setAttribute("aria-expanded", String(!collapsed));
      transportToggle.setAttribute(
        "aria-label",
        collapsed ? "Show video controls" : "Hide video controls",
      );
      transportToggle.title = collapsed
        ? "Show video controls"
        : "Hide video controls";
    });
  }
  if (playhead) {
    playhead.addEventListener("pointerdown", () => {
      scrubbing = true;
    });
    playhead.addEventListener("input", () => {
      scrubbing = true;
      media.seek(Number(playhead.value));
      updateTransport();
    });
    const finishScrub = () => {
      if (scrubbing) {
        media.seek(Number(playhead.value));
        scrubbing = false;
      }
    };
    playhead.addEventListener("change", finishScrub);
    playhead.addEventListener("pointerup", finishScrub);
    playhead.addEventListener("pointercancel", finishScrub);
  }

  // Drag & drop anywhere.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  });

  // --- Playback / overlay key bindings ---------------------------------
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof Element) {
      if (e.target.closest("#transport")) {
        return;
      }
      if (
        e.target.closest("#calibrationPanel") &&
        e.key.toLowerCase() !== "c"
      ) {
        return;
      }
    }
    switch (e.key) {
      case " ":
        e.preventDefault();
        media.togglePlay();
        break;
      case "ArrowRight":
        media.next();
        break;
      case "ArrowLeft":
        media.previous();
        break;
      case "ArrowUp":
        e.preventDefault();
        media.changeSpeed(+1);
        break;
      case "ArrowDown":
        e.preventDefault();
        media.changeSpeed(-1);
        break;
      case "Enter":
        overlay.toggle();
        break;
      case "m":
      case "M":
        media.toggleMute();
        break;
      case "c":
      case "C":
        if (!e.repeat) {
          calibration.toggle();
        }
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
  let fpsAccum = 0;
  function animate() {
    const dt = clock.getDelta();
    controls.update(dt);
    media.update();
    overlay.render();
    renderer.render(scene, camera);
    updateTransport();

    // Show the video's effective playback frame rate (refreshed ~4x/second).
    fpsAccum += dt;
    if (fpsAccum >= 0.25) {
      fpsAccum = 0;
      if (fpsMeter) {
        const vf = media.videoFps;
        fpsMeter.textContent = vf > 0 ? `${Math.round(vf)} FPS` : "-- FPS";
      }
    }

    requestAnimationFrame(animate);
  }
  animate();
}

init();
