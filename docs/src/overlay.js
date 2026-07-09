/**
 * 2D mapping-inspection ("layout") overlay (Enter key).
 *
 * Draws the current master frame letterboxed to its aspect ratio, with a
 * coloured, labelled rectangle for each mapping region — the web equivalent of
 * the Panda3D `render2d` overlay.
 *
 * Features:
 *   - Scroll-to-zoom (centred on the cursor) and drag-to-pan.
 *   - A live readout of the cursor position in master-frame pixels.
 *   - A PNG "decal" editor: upload images and move / scale / rotate / fade them
 *     directly on the master frame. Decals are baked into the master frame by
 *     the MediaManager, so they map into the 3D room over the top of the video.
 */

import { OVERLAY_COLORS } from "./room.js";

const MAX_ZOOM_FACTOR = 60;
const ZOOM_WHEEL_RATE = 0.0015;
const HANDLE_HIT_PX = 11; // Device-px radius for grabbing a handle.
const MIN_DECAL_SCALE = 0.01;

export class MappingOverlay {
  /**
   * @param {import("./video.js").MediaManager} media Media manager (source +
   *   decal store).
   * @param {object} settings Parsed settings.json.
   */
  constructor(media, settings) {
    this._media = media;
    this._settings = settings;
    this._visible = false;

    this._masterW = Number(settings.master_video_resolution.width);
    this._masterH = Number(settings.master_video_resolution.height);

    // View transform: canvasPx = origin + masterPx * scale (device px).
    this._scale = 0;
    this._fitScale = 0;
    this._originX = 0;
    this._originY = 0;
    this._initialized = false;

    // Pointer state.
    this._mouseX = 0;
    this._mouseY = 0;
    this._mouseInside = false;
    this._mode = "none"; // none | pan | move | scale | rotate
    this._lastPanX = 0;
    this._lastPanY = 0;
    this._selected = null;
    this._drag = null;

    this._buildDom();

    window.addEventListener("resize", () => this._resize());
    this._canvas.addEventListener("wheel", this._onWheel, { passive: false });
    this._canvas.addEventListener("mousedown", this._onDown);
    window.addEventListener("mousemove", this._onMove);
    window.addEventListener("mouseup", this._onUp);
    window.addEventListener("keydown", this._onKey);
    this._canvas.addEventListener("mouseleave", () => {
      this._mouseInside = false;
    });
    this._resize();
  }

  _buildDom() {
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

    // Readout panel (top-left).
    this._panel = document.createElement("div");
    Object.assign(this._panel.style, {
      position: "fixed",
      top: "16px",
      left: "16px",
      zIndex: "7",
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

    // Decal toolbar (top-right).
    this._buildToolbar();
  }

  _buildToolbar() {
    const bar = document.createElement("div");
    Object.assign(bar.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: "7",
      width: "230px",
      padding: "14px",
      borderRadius: "10px",
      background: "rgba(14, 16, 24, 0.92)",
      border: "1px solid rgba(255,255,255,0.12)",
      color: "#e8e8ee",
      font: "13px -apple-system, Segoe UI, Roboto, sans-serif",
      display: "none",
      boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
    });

    bar.innerHTML = `
      <div style="font-weight:650;margin-bottom:10px">Decals (PNG overlays)</div>
      <button id="addDecalBtn" style="width:100%;padding:9px;border:none;border-radius:8px;
        background:linear-gradient(180deg,#5b7cfa,#4661e6);color:#fff;font-weight:600;
        cursor:pointer">Add PNG…</button>
      <input id="decalInput" type="file" accept="image/png,image/*" multiple hidden />
      <div id="decalControls" style="display:none;margin-top:14px">
        <div id="decalName" style="font-size:12px;color:#9aa0b4;margin-bottom:10px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
        <label style="display:block;font-size:12px;color:#a9adbd">Scale
          <span id="scaleVal" style="float:right;color:#b6ffcf"></span></label>
        <input id="scaleRange" type="range" min="1" max="400" step="1" style="width:100%"/>
        <label style="display:block;font-size:12px;color:#a9adbd;margin-top:8px">Rotation
          <span id="rotVal" style="float:right;color:#b6ffcf"></span></label>
        <input id="rotRange" type="range" min="-180" max="180" step="1" style="width:100%"/>
        <label style="display:block;font-size:12px;color:#a9adbd;margin-top:8px">Opacity
          <span id="alphaVal" style="float:right;color:#b6ffcf"></span></label>
        <input id="alphaRange" type="range" min="0" max="100" step="1" style="width:100%"/>
        <button id="deleteDecalBtn" style="width:100%;margin-top:12px;padding:8px;border:none;
          border-radius:8px;background:#5a2230;color:#ffd5dd;font-weight:600;cursor:pointer">
          Delete decal</button>
      </div>
      <div style="font-size:11px;color:#6f7488;margin-top:12px;line-height:1.5">
        Click a decal to select · drag to move · corner handles scale · top handle
        rotates · Delete key removes.
      </div>`;
    document.body.appendChild(bar);
    this._toolbar = bar;

    this._decalInput = bar.querySelector("#decalInput");
    this._decalControls = bar.querySelector("#decalControls");
    this._decalName = bar.querySelector("#decalName");
    this._scaleRange = bar.querySelector("#scaleRange");
    this._rotRange = bar.querySelector("#rotRange");
    this._alphaRange = bar.querySelector("#alphaRange");
    this._scaleVal = bar.querySelector("#scaleVal");
    this._rotVal = bar.querySelector("#rotVal");
    this._alphaVal = bar.querySelector("#alphaVal");

    bar.querySelector("#addDecalBtn").addEventListener("click", () =>
      this._decalInput.click(),
    );
    this._decalInput.addEventListener("change", (e) => {
      for (const file of e.target.files) {
        this._media.addDecal(file, (decal) => this._select(decal));
      }
      this._decalInput.value = "";
    });
    bar.querySelector("#deleteDecalBtn").addEventListener("click", () => {
      if (this._selected) {
        this._media.removeDecal(this._selected);
        this._select(null);
      }
    });

    this._scaleRange.addEventListener("input", () => {
      if (this._selected) {
        this._selected.scale = Number(this._scaleRange.value) / 100;
        this._media.markDecalsDirty();
        this._syncControls();
      }
    });
    this._rotRange.addEventListener("input", () => {
      if (this._selected) {
        this._selected.rotation = Number(this._rotRange.value);
        this._media.markDecalsDirty();
        this._syncControls();
      }
    });
    this._alphaRange.addEventListener("input", () => {
      if (this._selected) {
        this._selected.alpha = Number(this._alphaRange.value) / 100;
        this._media.markDecalsDirty();
        this._syncControls();
      }
    });
  }

  get visible() {
    return this._visible;
  }

  toggle() {
    this._visible = !this._visible;
    const disp = this._visible ? "block" : "none";
    this._canvas.style.display = disp;
    this._panel.style.display = disp;
    this._toolbar.style.display = disp;
    if (this._visible) {
      this._fit();
    }
  }

  // -- View transform -----------------------------------------------------

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

  _toDevice(clientX, clientY) {
    const dpr = window.devicePixelRatio || 1;
    return [clientX * dpr, clientY * dpr];
  }

  _deviceToMaster(dx, dy) {
    return [(dx - this._originX) / this._scale, (dy - this._originY) / this._scale];
  }

  _masterToDevice(mx, my) {
    return [this._originX + mx * this._scale, this._originY + my * this._scale];
  }

  // -- Decal geometry helpers --------------------------------------------

  /** Returns decal corner points and rotate-handle point, in master coords. */
  _decalGeom(d) {
    const hw = (d.baseW * d.scale) / 2;
    const hh = (d.baseH * d.scale) / 2;
    const rot = (d.rotation * Math.PI) / 180;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const toMaster = (lx, ly) => [
      d.x + lx * cos - ly * sin,
      d.y + lx * sin + ly * cos,
    ];
    const corners = [
      toMaster(-hw, -hh),
      toMaster(hw, -hh),
      toMaster(hw, hh),
      toMaster(-hw, hh),
    ];
    const dpr = window.devicePixelRatio || 1;
    const handleDist = hh + (26 * dpr) / this._scale;
    const rotHandle = toMaster(0, -handleDist);
    return { corners, rotHandle };
  }

  /** True if master point (mx,my) is inside decal d. */
  _hitDecal(d, mx, my) {
    const rot = (-d.rotation * Math.PI) / 180;
    const dx = mx - d.x;
    const dy = my - d.y;
    const lx = dx * Math.cos(rot) - dy * Math.sin(rot);
    const ly = dx * Math.sin(rot) + dy * Math.cos(rot);
    const hw = (d.baseW * d.scale) / 2;
    const hh = (d.baseH * d.scale) / 2;
    return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
  }

  _select(decal) {
    this._selected = decal;
    this._syncControls();
  }

  _syncControls() {
    const d = this._selected;
    if (!d) {
      this._decalControls.style.display = "none";
      return;
    }
    this._decalControls.style.display = "block";
    this._decalName.textContent = d.name;
    this._scaleRange.value = String(Math.round(d.scale * 100));
    this._rotRange.value = String(Math.round(d.rotation));
    this._alphaRange.value = String(Math.round(d.alpha * 100));
    this._scaleVal.textContent = `${Math.round(d.scale * 100)}%`;
    this._rotVal.textContent = `${Math.round(d.rotation)}°`;
    this._alphaVal.textContent = `${Math.round(d.alpha * 100)}%`;
  }

  // -- Pointer handling ---------------------------------------------------

  _onWheel = (e) => {
    if (!this._visible) {
      return;
    }
    e.preventDefault();
    const [cx, cy] = this._toDevice(e.clientX, e.clientY);
    const [mx, my] = this._deviceToMaster(cx, cy);
    const factor = Math.exp(-e.deltaY * ZOOM_WHEEL_RATE);
    const minScale = this._fitScale;
    const maxScale = this._fitScale * MAX_ZOOM_FACTOR;
    const newScale = Math.max(minScale, Math.min(maxScale, this._scale * factor));
    this._originX = cx - mx * newScale;
    this._originY = cy - my * newScale;
    this._scale = newScale;
    this._clampPan();
  };

  _onDown = (e) => {
    if (!this._visible || e.button !== 0) {
      return;
    }
    const [cx, cy] = this._toDevice(e.clientX, e.clientY);
    const [mx, my] = this._deviceToMaster(cx, cy);

    // 1) Handles of the currently selected decal.
    if (this._selected) {
      const { corners, rotHandle } = this._decalGeom(this._selected);
      const [rhx, rhy] = this._masterToDevice(rotHandle[0], rotHandle[1]);
      if (Math.hypot(cx - rhx, cy - rhy) <= HANDLE_HIT_PX * (window.devicePixelRatio || 1)) {
        this._mode = "rotate";
        this._drag = {
          startAngle: Math.atan2(my - this._selected.y, mx - this._selected.x),
          startRotation: this._selected.rotation,
        };
        return;
      }
      for (const [ckx, cky] of corners) {
        const [dxp, dyp] = this._masterToDevice(ckx, cky);
        if (Math.hypot(cx - dxp, cy - dyp) <= HANDLE_HIT_PX * (window.devicePixelRatio || 1)) {
          this._mode = "scale";
          const dist = Math.hypot(mx - this._selected.x, my - this._selected.y);
          this._drag = { startDist: dist || 1, startScale: this._selected.scale };
          return;
        }
      }
    }

    // 2) Select / move a decal (topmost first).
    for (let i = this._media.decals.length - 1; i >= 0; i -= 1) {
      const d = this._media.decals[i];
      if (this._hitDecal(d, mx, my)) {
        this._select(d);
        this._mode = "move";
        this._drag = { offX: mx - d.x, offY: my - d.y };
        return;
      }
    }

    // 3) Empty space: deselect and pan.
    this._select(null);
    this._mode = "pan";
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

    const [cx, cy] = this._toDevice(e.clientX, e.clientY);
    const [mx, my] = this._deviceToMaster(cx, cy);
    const d = this._selected;

    if (this._mode === "move" && d) {
      d.x = mx - this._drag.offX;
      d.y = my - this._drag.offY;
      this._media.markDecalsDirty();
    } else if (this._mode === "scale" && d) {
      const dist = Math.hypot(mx - d.x, my - d.y);
      d.scale = Math.max(MIN_DECAL_SCALE, (this._drag.startScale * dist) / this._drag.startDist);
      this._media.markDecalsDirty();
      this._syncControls();
    } else if (this._mode === "rotate" && d) {
      const ang = Math.atan2(my - d.y, mx - d.x);
      d.rotation = this._drag.startRotation + ((ang - this._drag.startAngle) * 180) / Math.PI;
      this._media.markDecalsDirty();
      this._syncControls();
    } else if (this._mode === "pan") {
      const dpr = window.devicePixelRatio || 1;
      this._originX += (e.clientX - this._lastPanX) * dpr;
      this._originY += (e.clientY - this._lastPanY) * dpr;
      this._lastPanX = e.clientX;
      this._lastPanY = e.clientY;
      this._clampPan();
    }
  };

  _onUp = () => {
    if (this._mode === "pan") {
      this._canvas.style.cursor = "crosshair";
    }
    this._mode = "none";
    this._drag = null;
  };

  _onKey = (e) => {
    if (!this._visible || !this._selected) {
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this._media.removeDecal(this._selected);
      this._select(null);
    }
  };

  _clampPan() {
    const cw = this._canvas.width;
    const ch = this._canvas.height;
    const frameW = this._masterW * this._scale;
    const frameH = this._masterH * this._scale;
    const margin = Math.min(frameW, frameH) * 0.15;
    this._originX = Math.max(-frameW + margin, Math.min(cw - margin, this._originX));
    this._originY = Math.max(-frameH + margin, Math.min(ch - margin, this._originY));
  }

  // -- Rendering ----------------------------------------------------------

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

    // Base frame (already includes decals when compositing).
    if (this._media.displayReady) {
      try {
        ctx.drawImage(this._media.displaySource, ox, oy, frameW, frameH);
      } catch (_) {}
    }

    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.strokeRect(ox, oy, frameW, frameH);

    this._drawMappingBoxes(ctx, dpr, ox, oy);
    this._drawSelection(ctx, dpr);
    this._drawCursorReadout(ctx, dpr);
  }

  _drawMappingBoxes(ctx, dpr, ox, oy) {
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

      ctx.font = `${16 * dpr}px -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tx = x + w / 2;
      const ty = y + h / 2;
      const metrics = ctx.measureText(name);
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
      ctx.fillText(name, tx, ty);
    }
  }

  _drawSelection(ctx, dpr) {
    const d = this._selected;
    if (!d || this._media.decals.indexOf(d) === -1) {
      return;
    }
    const { corners, rotHandle } = this._decalGeom(d);
    const dev = corners.map(([mx, my]) => this._masterToDevice(mx, my));

    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = "#5b9dff";
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(dev[0][0], dev[0][1]);
    for (let i = 1; i < dev.length; i += 1) {
      ctx.lineTo(dev[i][0], dev[i][1]);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Rotate-handle stem + knob.
    const [rhx, rhy] = this._masterToDevice(rotHandle[0], rotHandle[1]);
    const topMid = [(dev[0][0] + dev[1][0]) / 2, (dev[0][1] + dev[1][1]) / 2];
    ctx.beginPath();
    ctx.moveTo(topMid[0], topMid[1]);
    ctx.lineTo(rhx, rhy);
    ctx.stroke();
    this._knob(ctx, dpr, rhx, rhy, "#ffd54d");

    // Corner scale handles.
    for (const [dx, dy] of dev) {
      this._knob(ctx, dpr, dx, dy, "#5b9dff");
    }
  }

  _knob(ctx, dpr, x, y, color) {
    ctx.beginPath();
    ctx.arc(x, y, 6 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.stroke();
  }

  _drawCursorReadout(ctx, dpr) {
    const cw = this._canvas.width;
    const ch = this._canvas.height;
    let coordLine = "x: \u2014   y: \u2014";
    if (this._mouseInside) {
      const [cx, cy] = this._toDevice(this._mouseX, this._mouseY);
      const [mx, my] = this._deviceToMaster(cx, cy);

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
      `scroll: zoom \u00b7 drag: pan \u00b7 Enter: close`;
  }
}
