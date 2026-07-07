/**
 * Local video pipeline: HTML5 File API -> <video> -> THREE.VideoTexture.
 *
 * Videos are read entirely in the browser via object URLs; nothing is uploaded
 * to a server. This mirrors the asset-list / play-pause / next-previous
 * behaviour of the Panda3D viewer, but sourced from user-selected files.
 */

import * as THREE from "three";

// Playback-speed limits (percent). Browsers reliably support ~6%–1600%.
const MIN_SPEED_PERCENT = 6;
const MAX_SPEED_PERCENT = 400;

export class VideoManager {
  /**
   * @param {(state: {name: string, index: number, total: number,
   *   playing: boolean, muted: boolean}) => void} onChange Status callback.
   */
  constructor(onChange) {
    this._onChange = onChange || (() => {});

    /** @type {{ url: string, name: string }[]} */
    this._clips = [];
    this._index = 0;
    this._playing = false;
    this._speedPercent = 100; // 100% = normal playback speed.

    this._video = document.createElement("video");
    this._video.muted = true; // Required for programmatic autoplay.
    this._video.loop = true;
    this._video.playsInline = true;
    this._video.preload = "auto";
    this._video.crossOrigin = "anonymous";

    this._texture = new THREE.VideoTexture(this._video);
    this._texture.colorSpace = THREE.SRGBColorSpace;
    this._texture.minFilter = THREE.LinearFilter;
    this._texture.magFilter = THREE.LinearFilter;
    this._texture.generateMipmaps = false;
    this._texture.wrapS = THREE.ClampToEdgeWrapping;
    this._texture.wrapT = THREE.ClampToEdgeWrapping;

    // Effective playback frame rate of the video itself (presented frames per
    // real second), which scales with playback speed. 0 while paused/stopped.
    this._videoFps = 0;
    this._video.addEventListener("pause", () => {
      this._videoFps = 0;
    });
    this._video.addEventListener("ended", () => {
      this._videoFps = 0;
    });
    this._startFrameRateTracking();
  }

  /**
   * Measures the video's real presented-frame rate via
   * requestVideoFrameCallback. Each callback corresponds to one displayed video
   * frame, so counting them over wall-clock time yields the effective FPS —
   * which rises and falls with the playback speed.
   */
  _startFrameRateTracking() {
    if (typeof this._video.requestVideoFrameCallback !== "function") {
      return; // Unsupported browser; FPS stays 0 (readout shows "--").
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

  /** @returns {number} Effective video frame rate (fps); 0 when not playing. */
  get videoFps() {
    return this._videoFps;
  }

  /** @returns {THREE.VideoTexture} The shared, auto-updating texture. */
  get texture() {
    return this._texture;
  }

  /** @returns {HTMLVideoElement} The backing (offscreen) video element. */
  get videoElement() {
    return this._video;
  }

  /** @returns {boolean} Whether any clips have been loaded. */
  get hasClips() {
    return this._clips.length > 0;
  }

  /**
   * Registers a list of user-selected files, revoking any previous URLs, and
   * begins playback of the first clip.
   *
   * @param {FileList | File[]} files Files chosen via the File API.
   */
  setFiles(files) {
    const videos = Array.from(files).filter(
      (f) => f.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(f.name)
    );
    if (videos.length === 0) {
      return;
    }
    this._revokeAll();
    this._clips = videos.map((file) => ({
      url: URL.createObjectURL(file),
      name: file.name,
    }));
    this._index = 0;
    this._load(0);
  }

  /** Loads the clip at `index` (wrapped) and starts playing it. */
  _load(index) {
    if (this._clips.length === 0) {
      return;
    }
    const count = this._clips.length;
    this._index = ((index % count) + count) % count;
    this._video.src = this._clips[this._index].url;
    this._applySpeed(); // Loading media can reset the rate; re-assert it.
    const start = this._video.play();
    if (start && typeof start.catch === "function") {
      start.catch(() => {
        // Autoplay may be blocked until a gesture; state stays consistent.
      });
    }
    this._playing = true;
    this._emit();
  }

  /** Toggles play/pause on the active clip. */
  togglePlay() {
    if (!this.hasClips) {
      return;
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

  /** Advances to the next clip. */
  next() {
    if (this.hasClips) {
      this._load(this._index + 1);
    }
  }

  /** Returns to the previous clip. */
  previous() {
    if (this.hasClips) {
      this._load(this._index - 1);
    }
  }

  /** Toggles audio mute (video starts muted for autoplay). */
  toggleMute() {
    this._video.muted = !this._video.muted;
    this._emit();
  }

  /**
   * Adjusts playback speed by a whole-percent delta (100% = normal), clamped
   * to a browser-supported range.
   *
   * @param {number} deltaPercent Signed change in percent (e.g. +1 or -1).
   */
  changeSpeed(deltaPercent) {
    const next = Math.round(this._speedPercent + deltaPercent);
    this._speedPercent = Math.max(MIN_SPEED_PERCENT, Math.min(MAX_SPEED_PERCENT, next));
    this._applySpeed();
    this._emit();
  }

  /** @returns {number} Current playback speed as a percentage. */
  get speedPercent() {
    return this._speedPercent;
  }

  _applySpeed() {
    const rate = this._speedPercent / 100;
    this._video.defaultPlaybackRate = rate;
    this._video.playbackRate = rate;
  }

  _emit() {
    const clip = this._clips[this._index];
    this._onChange({
      name: clip ? clip.name : "",
      index: this._index,
      total: this._clips.length,
      playing: this._playing,
      muted: this._video.muted,
      speedPercent: this._speedPercent,
    });
  }

  _revokeAll() {
    for (const clip of this._clips) {
      URL.revokeObjectURL(clip.url);
    }
    this._clips = [];
  }
}
