/**
 * 2D mapping-inspection ("layout") overlay (Enter key).
 *
 * Draws the current source frame letterboxed to the master aspect ratio, with a
 * coloured, labelled rectangle for each mapping region — the web equivalent of
 * the Panda3D `render2d` overlay.
 *
 * Supports scroll-to-zoom (centred on the cursor), drag-to-pan, and a live
 * readout of the cursor position in master-frame pixels to aid alignment.
 */

import { OVERLAY_COLORS } from "./room.js";

const MAX_ZOOM_FACTOR = 60; // Max scale relative to the fitted (zoom = 1) view.
const ZOOM_WHEEL_RATE = 0.0015; // Sensitivity of wheel delta -> zoom.

export class MappingOverlay {
  /**
   * @param {HTMLVideoElement} video Source video element to sample frames from.
   * @param {object} settings Parsed settings.json.
   */
  constructor(video, settings) {
    this._video = video;
    this._settings = settings;
    this._visible = false;

    this._masterW = Number(settings.master_video_resolution.width);
    this._masterH = Number(settings.master_video_resolution.height);

    // View transform: canvasPx = origin + masterPx * scale (all device px).
    this._scale = 0;
    this._fitScale = 0;
    this._originX = 0;
    this._originY = 0;
    this._initialized = false;

    // Cursor tracking (CSS px) and pan state.
    this._mouseX = 0;
    this._mouseY = 0;
    this._mouseInside = false;
    this._panning = false;
    this._lastPanX = 0;
    this._lastPanY = 0;

    this._canvas = document.createElement("canvas");
    Object.assign(this._canvas.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      zIndex: "5",
      background: "#000",
      cursor: "crosshair",
      display: "none",
    });
    this._ctx = this._canvas.getContext("2d");
    document.body.appendChild(this._canvas);

    // DOM readout panel (crisp, always on top — independent of canvas draw).
    this._panel = document.createElement("div");
    Object.assign(this._panel.style, {
      position: "fixed",
      top: "16px",
      left: "16px",
      zIndex: "6",
      padding: "10px 14px",
      borderRadius: "8px",
      background: "rgba(10, 12, 18, 0.82)",
      border: "1px solid rgba(255,255,255,0.12)",
      color: "#9aa0b4",
      font: "13px ui-monospace, SFMono-Regular, Menlo, monospace",
      lineHeight: "1.55",
      pointerEvents: "none",
      whiteSpace: "pre",
      display: "none",
      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    });
    document.body.appendChild(this._panel);

    window.addEventListener("resize", () => this._resize());
    this._canvas.addEventListener("wheel", this._onWheel, { passive: false });
    this._canvas.addEventListener("mousedown", this._onDown);
    window.addEventListener("mousemove", this._onMove);
    window.addEventListener("mouseup", this._onUp);
    this._canvas.addEventListener("mouseleave", () => {
      this._mouseInside = false;
    });
    this._resize();
  }

  /** @returns {boolean} Whether the overlay is currently shown. */
  get visible() {
    return this._visible;
  }

  toggle() {
    this._visible = !this._visible;
    this._canvas.style.display = this._visible ? "block" : "none";
    this._panel.style.display = this._visible ? "block" : "none";
    if (this._visible) {
      // Re-fit each time the overlay is opened for a predictable start.
      this._fit();
    }
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = Math.floor(window.innerWidth * dpr);
    this._canvas.height = Math.floor(window.innerHeight * dpr);
    if (this._visible) {
      this._fit();
    } else {
      this._initialized = false;
    }
  }

  /** Fits the master frame letterboxed into the canvas at zoom = 1. */
  _fit() {
    const cw = this._canvas.width;
    const ch = this._canvas.height;
    const winAspect = cw / ch;
    const videoAspect = this._masterW / this._masterH;

    let drawW;
    let drawH;
    if (videoAspect >= winAspect) {
      drawW = cw;
      drawH = cw / videoAspect;
    } else {
      drawH = ch;
      drawW = ch * videoAspect;
    }
    this._fitScale = drawW / this._masterW;
    this._scale = this._fitScale;
    this._originX = (cw - drawW) / 2;
    this._originY = (ch - drawH) / 2;
    this._initialized = true;
  }

  /** Converts a CSS-pixel client point to device-pixel canvas coordinates. */
  _toDevice(clientX, clientY) {
    const dpr = window.devicePixelRatio || 1;
    return [clientX * dpr, clientY * dpr];
  }

  _onWheel = (e) => {
    if (!this._visible) {
      return;
    }
    e.preventDefault();
    const [cx, cy] = this._toDevice(e.clientX, e.clientY);

    // Master-frame point currently under the cursor.
    const mx = (cx - this._originX) / this._scale;
    const my = (cy - this._originY) / this._scale;

    const factor = Math.exp(-e.deltaY * ZOOM_WHEEL_RATE);
    const minScale = this._fitScale;
    const maxScale = this._fitScale * MAX_ZOOM_FACTOR;
    const newScale = Math.max(minScale, Math.min(maxScale, this._scale * factor));

    // Keep that master point pinned beneath the cursor.
    this._originX = cx - mx * newScale;
    this._originY = cy - my * newScale;
    this._scale = newScale;
    this._clampPan();
  };

  _onDown = (e) => {
    if (!this._visible || e.button !== 0) {
      return;
    }
    this._panning = true;
    this._lastPanX = e.clientX;
    this._lastPanY = e.clientY;
    this._canvas.style.cursor = "grabbing";
  };

  _onMove = (e) => {
    if (!this._visible) {
      return;
    }
    this._mouseX = e.clientX;
    this._mouseY = e.clientY;
    this._mouseInside = true;

    if (this._panning) {
      const dpr = window.devicePixelRatio || 1;
      this._originX += (e.clientX - this._lastPanX) * dpr;
      this._originY += (e.clientY - this._lastPanY) * dpr;
      this._lastPanX = e.clientX;
      this._lastPanY = e.clientY;
      this._clampPan();
    }
  };

  _onUp = () => {
    if (this._panning) {
      this._panning = false;
      this._canvas.style.cursor = "crosshair";
    }
  };

  /** Keeps at least part of the frame on-screen so it can't be lost. */
  _clampPan() {
    const cw = this._canvas.width;
    const ch = this._canvas.height;
    const frameW = this._masterW * this._scale;
    const frameH = this._masterH * this._scale;
    const margin = Math.min(frameW, frameH) * 0.15;
    this._originX = Math.max(-frameW + margin, Math.min(cw - margin, this._originX));
    this._originY = Math.max(-frameH + margin, Math.min(ch - margin, this._originY));
  }

  /** Renders one overlay frame. No-op while hidden. */
  render() {
    if (!this._visible) {
      return;
    }
    if (!this._initialized) {
      this._fit();
    }

    const ctx = this._ctx;
    const cw = this._canvas.width;
    const ch = this._canvas.height;
    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);

    const frameW = this._masterW * this._scale;
    const frameH = this._masterH * this._scale;
    const ox = this._originX;
    const oy = this._originY;

    if (this._video.readyState >= 2) {
      try {
        ctx.drawImage(this._video, ox, oy, frameW, frameH);
      } catch (_) {
        // Frame not ready yet; skip this pass.
      }
    }

    // Frame border.
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.strokeRect(ox, oy, frameW, frameH);

    const mapping = this._settings.mapping || {};
    let i = 0;
    for (const [name, crop] of Object.entries(mapping)) {
      const color = OVERLAY_COLORS[i % OVERLAY_COLORS.length];
      i += 1;

      const x = ox + Number(crop.top_left_x) * this._scale;
      const y = oy + Number(crop.top_left_y) * this._scale;
      const w = Number(crop.width_pixels) * this._scale;
      const h = Number(crop.height_pixels) * this._scale;

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

    this._drawCursorReadout(ctx, dpr);
  }

  /** Draws crosshair guides on the canvas and updates the DOM readout panel. */
  _drawCursorReadout(ctx, dpr) {
    const cw = this._canvas.width;
    const ch = this._canvas.height;

    let coordLine = "x: \u2014   y: \u2014";
    if (this._mouseInside) {
      const [cx, cy] = this._toDevice(this._mouseX, this._mouseY);
      const mx = (cx - this._originX) / this._scale;
      const my = (cy - this._originY) / this._scale;

      // Crosshair guides across the canvas at the cursor.
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, ch);
      ctx.moveTo(0, cy);
      ctx.lineTo(cw, cy);
      ctx.stroke();
      ctx.setLineDash([]);

      const inside =
        mx >= 0 && mx <= this._masterW && my >= 0 && my <= this._masterH;
      const xStr = Math.round(mx);
      const yStr = Math.round(my);
      coordLine = inside
        ? `x: ${xStr} px   y: ${yStr} px`
        : `x: ${xStr}   y: ${yStr}   (outside frame)`;
    }

    const zoomPct = this._fitScale
      ? Math.round((this._scale / this._fitScale) * 100)
      : 100;

    this._panel.innerHTML =
      `<span style="color:#b6ffcf;font-size:15px;font-weight:600">${coordLine}</span>\n` +
      `zoom: ${zoomPct}%   (${this._masterW} \u00d7 ${this._masterH})\n` +
      `scroll: zoom to cursor \u00b7 drag: pan \u00b7 Enter: close`;
  }
}
