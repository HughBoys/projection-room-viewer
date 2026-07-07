/**
 * 2D mapping-inspection overlay (Enter key).
 *
 * Draws the current source frame letterboxed to the master aspect ratio, with a
 * coloured, labelled rectangle for each mapping region — the web equivalent of
 * the Panda3D `render2d` overlay.
 */

import { OVERLAY_COLORS } from "./room.js";

export class MappingOverlay {
  /**
   * @param {HTMLVideoElement} video Source video element to sample frames from.
   * @param {object} settings Parsed settings.json.
   */
  constructor(video, settings) {
    this._video = video;
    this._settings = settings;
    this._visible = false;

    this._canvas = document.createElement("canvas");
    Object.assign(this._canvas.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      zIndex: "5",
      background: "#000",
      display: "none",
    });
    this._ctx = this._canvas.getContext("2d");
    document.body.appendChild(this._canvas);

    window.addEventListener("resize", () => this._resize());
    this._resize();
  }

  /** @returns {boolean} Whether the overlay is currently shown. */
  get visible() {
    return this._visible;
  }

  toggle() {
    this._visible = !this._visible;
    this._canvas.style.display = this._visible ? "block" : "none";
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = Math.floor(window.innerWidth * dpr);
    this._canvas.height = Math.floor(window.innerHeight * dpr);
  }

  /** Renders one overlay frame. No-op while hidden. */
  render() {
    if (!this._visible) {
      return;
    }
    const ctx = this._ctx;
    const cw = this._canvas.width;
    const ch = this._canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);

    const masterW = Number(this._settings.master_video_resolution.width);
    const masterH = Number(this._settings.master_video_resolution.height);

    // Fit the master frame's aspect ratio inside the canvas (letterboxed).
    const winAspect = cw / ch;
    const videoAspect = masterW / masterH;
    let drawW;
    let drawH;
    if (videoAspect >= winAspect) {
      drawW = cw;
      drawH = cw / videoAspect;
    } else {
      drawH = ch;
      drawW = ch * videoAspect;
    }
    const offX = (cw - drawW) / 2;
    const offY = (ch - drawH) / 2;

    if (this._video.readyState >= 2) {
      try {
        ctx.drawImage(this._video, offX, offY, drawW, drawH);
      } catch (_) {
        // Frame not ready yet; skip this pass.
      }
    }

    const mapping = this._settings.mapping || {};
    const dpr = window.devicePixelRatio || 1;
    let i = 0;
    for (const [name, crop] of Object.entries(mapping)) {
      const color = OVERLAY_COLORS[i % OVERLAY_COLORS.length];
      i += 1;

      const x = offX + (Number(crop.top_left_x) / masterW) * drawW;
      const y = offY + (Number(crop.top_left_y) / masterH) * drawH;
      const w = (Number(crop.width_pixels) / masterW) * drawW;
      const h = (Number(crop.height_pixels) / masterH) * drawH;

      ctx.lineWidth = 2.5 * dpr;
      ctx.strokeStyle = color;
      ctx.strokeRect(x, y, w, h);

      const label = name;
      ctx.font = `${16 * dpr}px -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tx = x + w / 2;
      const ty = y + h / 2;
      const metrics = ctx.measureText(label);
      const padX = 8 * dpr;
      const padY = 6 * dpr;
      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
      ctx.fillRect(
        tx - metrics.width / 2 - padX,
        ty - 10 * dpr - padY,
        metrics.width + padX * 2,
        20 * dpr + padY,
      );
      ctx.fillStyle = color;
      ctx.fillText(label, tx, ty);
    }
  }
}
