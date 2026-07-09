/**
 * Local media pipeline: HTML5 File API -> texture, entirely client-side.
 *
 * Supports video (mp4/mov/webm/…), static images (png/jpeg/webp/…) and animated
 * GIFs as the stitched "master frame" that is UV-mapped onto the room walls.
 * A layer of user-supplied PNG "decals" can be composited on top of that frame;
 * because they are baked into the same master frame, they map into the 3D room
 * exactly like the base content.
 *
 * Two rendering paths keep things efficient:
 *   - Direct path (no decals): a THREE.VideoTexture for video, or a plain
 *     THREE.Texture for a static image — no per-frame CPU work.
 *   - Composite path (decals present, or animated GIF): the base frame plus all
 *     decals are drawn into an offscreen master-resolution canvas each frame and
 *     uploaded via a THREE.CanvasTexture.
 * Whenever the active texture object changes, `onTextureChange` is invoked so
 * the caller can rebind it to the room surfaces.
 */

import * as THREE from "three";

// Playback-speed limits (percent). Browsers reliably support ~6%–1600%.
const MIN_SPEED_PERCENT = 6;
const MAX_SPEED_PERCENT = 400;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogg|ogv)$/i;

let decalIdCounter = 0;

export class MediaManager {
  /**
   * @param {(state: object) => void} onChange Status callback.
   * @param {(texture: THREE.Texture) => void} onTextureChange Called whenever
   *   the active texture object changes (rebind it to the geometry).
   */
  constructor(onChange, onTextureChange) {
    this._onChange = onChange || (() => {});
    this._onTextureChange = onTextureChange || (() => {});

    /** @type {{ url: string, name: string, kind: string, animated: boolean }[]} */
    this._clips = [];
    this._index = 0;
    this._playing = false;
    this._speedPercent = 100;

    /** @type {{ current: object|null }} */
    this._current = null;

    // --- Base media elements -------------------------------------------
    this._video = document.createElement("video");
    this._video.muted = true;
    this._video.loop = true;
    this._video.playsInline = true;
    this._video.preload = "auto";
    this._video.crossOrigin = "anonymous";

    this._img = new Image();
    this._img.crossOrigin = "anonymous";
    this._imgReady = false;

    // --- Master compositing canvas -------------------------------------
    this._masterCanvas = document.createElement("canvas");
    this._masterCanvas.width = 1920;
    this._masterCanvas.height = 1080;
    this._mctx = this._masterCanvas.getContext("2d");

    // --- Decals ---------------------------------------------------------
    /** @type {object[]} */
    this._decals = [];
    this._decalsDirty = true;
    this._lastComposedTime = -1;

    // --- Textures -------------------------------------------------------
    this._videoTexture = this._configureTexture(new THREE.VideoTexture(this._video));
    this._canvasTexture = this._configureTexture(new THREE.CanvasTexture(this._masterCanvas));
    this._imageTexture = null;
    this._activeTexture = null;

    // --- Video FPS tracking --------------------------------------------
    this._videoFps = 0;
    this._video.addEventListener("pause", () => (this._videoFps = 0));
    this._video.addEventListener("ended", () => (this._videoFps = 0));
    this._startFrameRateTracking();

    this._refreshActiveTexture();
  }

  _configureTexture(texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }

  /** Sets the master canvas resolution (from settings) for crisp compositing. */
  setMasterResolution(width, height) {
    this._masterCanvas.width = Math.max(1, Math.floor(width));
    this._masterCanvas.height = Math.max(1, Math.floor(height));
    this._decalsDirty = true;
  }

  // -- Accessors ----------------------------------------------------------

  /** @returns {THREE.Texture} The currently active texture. */
  get texture() {
    return this._activeTexture;
  }

  /** @returns {HTMLVideoElement} The backing video element. */
  get videoElement() {
    return this._video;
  }

  /** @returns {HTMLCanvasElement} The offscreen master compositing canvas. */
  get masterCanvas() {
    return this._masterCanvas;
  }

  /** @returns {boolean} Whether any base clips are loaded. */
  get hasClips() {
    return this._clips.length > 0;
  }

  /** @returns {object[]} The live decal list (topmost drawn last). */
  get decals() {
    return this._decals;
  }

  /** @returns {number} Effective video frame rate (fps); 0 when not playing. */
  get videoFps() {
    return this._videoFps;
  }

  /** @returns {number} Current playback speed as a percentage. */
  get speedPercent() {
    return this._speedPercent;
  }

  /**
   * The element the layout overlay should draw to represent the current frame.
   * @returns {HTMLVideoElement|HTMLImageElement|HTMLCanvasElement}
   */
  get displaySource() {
    if (this._activeTexture === this._canvasTexture) {
      return this._masterCanvas;
    }
    if (this._current && this._current.kind === "video") {
      return this._video;
    }
    if (this._current && this._current.kind === "image") {
      return this._img;
    }
    return this._masterCanvas;
  }

  /** @returns {boolean} Whether displaySource currently has a drawable frame. */
  get displayReady() {
    const src = this.displaySource;
    if (src === this._video) {
      return this._video.readyState >= 2;
    }
    if (src === this._img) {
      return this._imgReady;
    }
    return true;
  }

  // -- Base clip management ----------------------------------------------

  /**
   * Registers user-selected files (video or image), revoking old URLs and
   * loading the first.
   *
   * @param {FileList | File[]} files Files chosen via the File API.
   */
  setFiles(files) {
    const accepted = Array.from(files).filter(
      (f) =>
        f.type.startsWith("video/") ||
        f.type.startsWith("image/") ||
        VIDEO_EXT.test(f.name) ||
        IMAGE_EXT.test(f.name),
    );
    if (accepted.length === 0) {
      return;
    }
    this._revokeAll();
    this._clips = accepted.map((file) => {
      const isImage = file.type.startsWith("image/") || IMAGE_EXT.test(file.name);
      const animated = file.type === "image/gif" || /\.gif$/i.test(file.name);
      return {
        url: URL.createObjectURL(file),
        name: file.name,
        kind: isImage ? "image" : "video",
        animated,
      };
    });
    this._index = 0;
    this._load(0);
  }

  _load(index) {
    if (this._clips.length === 0) {
      return;
    }
    const count = this._clips.length;
    this._index = ((index % count) + count) % count;
    const clip = this._clips[this._index];
    this._current = clip;

    if (clip.kind === "video") {
      this._video.src = clip.url;
      this._applySpeed();
      const start = this._video.play();
      if (start && typeof start.catch === "function") {
        start.catch(() => {});
      }
      this._playing = true;
    } else {
      // Image or GIF.
      this._video.pause();
      this._imgReady = false;
      this._img = new Image();
      this._img.crossOrigin = "anonymous";
      this._img.onload = () => {
        this._imgReady = true;
        this._rebuildImageTexture();
        this._decalsDirty = true;
        this._refreshActiveTexture();
        this._emit();
      };
      this._img.src = clip.url;
      this._playing = clip.animated; // GIFs are "playing"; static images aren't.
    }

    this._decalsDirty = true;
    this._refreshActiveTexture();
    this._emit();
  }

  _rebuildImageTexture() {
    if (this._imageTexture) {
      this._imageTexture.dispose();
    }
    this._imageTexture = this._configureTexture(new THREE.Texture(this._img));
    this._imageTexture.needsUpdate = true;
  }

  next() {
    if (this.hasClips) {
      this._load(this._index + 1);
    }
  }

  previous() {
    if (this.hasClips) {
      this._load(this._index - 1);
    }
  }

  togglePlay() {
    if (!this._current) {
      return;
    }
    if (this._current.kind !== "video") {
      return; // Nothing to pause for a still image.
    }
    if (this._video.paused) {
      this._video.play();
      this._playing = true;
    } else {
      this._video.pause();
      this._playing = false;
    }
    this._emit();
  }

  toggleMute() {
    this._video.muted = !this._video.muted;
    this._emit();
  }

  changeSpeed(deltaPercent) {
    const next = Math.round(this._speedPercent + deltaPercent);
    this._speedPercent = Math.max(MIN_SPEED_PERCENT, Math.min(MAX_SPEED_PERCENT, next));
    this._applySpeed();
    this._emit();
  }

  _applySpeed() {
    const rate = this._speedPercent / 100;
    this._video.defaultPlaybackRate = rate;
    this._video.playbackRate = rate;
  }

  // -- Decals -------------------------------------------------------------

  /**
   * Loads a PNG (or any image) file as a decal centred on the master frame.
   *
   * @param {File} file Image file to add.
   * @param {(decal: object) => void} [onReady] Invoked once the image loads.
   */
  addDecal(file, onReady) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const targetW = this._masterCanvas.width / 3;
      const scale = img.naturalWidth > 0 ? targetW / img.naturalWidth : 1;
      const decal = {
        id: ++decalIdCounter,
        name: file.name,
        img,
        url,
        baseW: img.naturalWidth,
        baseH: img.naturalHeight,
        x: this._masterCanvas.width / 2,
        y: this._masterCanvas.height / 2,
        scale,
        rotation: 0,
        alpha: 1,
      };
      this._decals.push(decal);
      this._decalsDirty = true;
      this._refreshActiveTexture();
      if (onReady) {
        onReady(decal);
      }
    };
    img.src = url;
  }

  removeDecal(decal) {
    const i = this._decals.indexOf(decal);
    if (i >= 0) {
      this._decals.splice(i, 1);
      if (decal.url) {
        URL.revokeObjectURL(decal.url);
      }
      this._decalsDirty = true;
      this._refreshActiveTexture();
    }
  }

  markDecalsDirty() {
    this._decalsDirty = true;
  }

  // -- Per-frame update ---------------------------------------------------

  /** Recomposites the master canvas when needed. Call once per animation frame. */
  update() {
    if (this._activeTexture !== this._canvasTexture) {
      return; // Direct path: nothing to composite.
    }
    let need = this._decalsDirty;
    if (this._current && this._current.kind === "video") {
      if (this._video.currentTime !== this._lastComposedTime) {
        this._lastComposedTime = this._video.currentTime;
        need = true;
      }
    } else if (this._current && this._current.animated) {
      need = true; // Animated GIF: redraw every frame.
    }
    if (need) {
      this._composite();
      this._decalsDirty = false;
    }
  }

  _composite() {
    const ctx = this._mctx;
    const W = this._masterCanvas.width;
    const H = this._masterCanvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    // Base frame fills the whole master frame.
    if (this._current && this._current.kind === "video") {
      if (this._video.readyState >= 2) {
        try {
          ctx.drawImage(this._video, 0, 0, W, H);
        } catch (_) {}
      }
    } else if (this._current && this._current.kind === "image") {
      if (this._imgReady) {
        try {
          ctx.drawImage(this._img, 0, 0, W, H);
        } catch (_) {}
      }
    }

    // Decals composited on top, in master-frame pixel space.
    for (const d of this._decals) {
      const dw = d.baseW * d.scale;
      const dh = d.baseH * d.scale;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, d.alpha));
      ctx.translate(d.x, d.y);
      ctx.rotate((d.rotation * Math.PI) / 180);
      try {
        ctx.drawImage(d.img, -dw / 2, -dh / 2, dw, dh);
      } catch (_) {}
      ctx.restore();
    }

    this._canvasTexture.needsUpdate = true;
  }

  _refreshActiveTexture() {
    let desired;
    const usesComposite =
      this._decals.length > 0 ||
      (this._current && this._current.animated) ||
      !this._current;

    if (usesComposite) {
      desired = this._canvasTexture;
    } else if (this._current.kind === "video") {
      desired = this._videoTexture;
    } else {
      desired = this._imageTexture || this._canvasTexture;
    }

    if (desired === this._canvasTexture) {
      this._decalsDirty = true;
    }
    if (desired !== this._activeTexture) {
      this._activeTexture = desired;
      this._onTextureChange(desired);
    }
  }

  // -- FPS ----------------------------------------------------------------

  _startFrameRateTracking() {
    if (typeof this._video.requestVideoFrameCallback !== "function") {
      return;
    }
    let windowStart = 0;
    let frames = 0;
    const onFrame = (now) => {
      frames += 1;
      if (!windowStart) {
        windowStart = now;
      }
      const elapsed = now - windowStart;
      if (elapsed >= 500) {
        this._videoFps = (frames * 1000) / elapsed;
        frames = 0;
        windowStart = now;
      }
      this._video.requestVideoFrameCallback(onFrame);
    };
    this._video.requestVideoFrameCallback(onFrame);
  }

  // -- Misc ---------------------------------------------------------------

  _emit() {
    const clip = this._clips[this._index];
    this._onChange({
      name: clip ? clip.name : "",
      index: this._index,
      total: this._clips.length,
      playing: this._playing,
      muted: this._video.muted,
      speedPercent: this._speedPercent,
      kind: clip ? clip.kind : "",
    });
  }

  _revokeAll() {
    for (const clip of this._clips) {
      URL.revokeObjectURL(clip.url);
    }
    this._clips = [];
  }
}
