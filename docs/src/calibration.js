/**
 * Interactive GLB placement editor. The browser attempts to write
 * transform.json through the File System Access API and otherwise downloads a
 * replacement file.
 */

export class CalibrationController {
  constructor(exhibit, onVisibilityChange) {
    this._exhibit = exhibit;
    this._onVisibilityChange = onVisibilityChange || (() => {});
    this._panel = document.getElementById("calibrationPanel");
    this._status = document.getElementById("calibrationStatus");
    this._inputs = Array.from(
      this._panel?.querySelectorAll("[data-offset-axis]") || [],
    );

    this._panel
      ?.querySelectorAll("[data-rotate-axis]")
      .forEach((button) =>
        button.addEventListener("click", () => this._rotate(button)),
      );
    this._inputs.forEach((input) =>
      input.addEventListener("input", () => this._setOffset(input)),
    );
    document
      .getElementById("calibrationSave")
      ?.addEventListener("click", () => this._save());
    document
      .getElementById("calibrationClose")
      ?.addEventListener("click", () => this.hide());
  }

  get visible() {
    return Boolean(this._panel && !this._panel.hidden);
  }

  toggle() {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  show() {
    if (!this._panel) {
      return;
    }
    this._panel.hidden = false;
    this._syncInputs();
    this._setStatus(
      this._exhibit.hasModel
        ? "Adjustments are applied immediately."
        : "Load a GLB model before calibrating.",
    );
    this._onVisibilityChange(true);
  }

  hide() {
    if (!this._panel) {
      return;
    }
    this._panel.hidden = true;
    this._onVisibilityChange(false);
  }

  _rotate(button) {
    if (!this._exhibit.hasModel) {
      this._setStatus("Load a GLB model before calibrating.");
      return;
    }
    const axis = button.dataset.rotateAxis;
    const degrees = Number(button.dataset.degrees);
    this._exhibit.rotateBy(axis, degrees);
    this._setStatus(
      `Rotated ${axis.toUpperCase()} by ${degrees > 0 ? "+" : ""}${degrees}°`,
    );
  }

  _setOffset(input) {
    if (!this._exhibit.hasModel) {
      this._setStatus("Load a GLB model before calibrating.");
      return;
    }
    this._exhibit.setOffset(input.dataset.offsetAxis, Number(input.value));
    this._setStatus("Offset updated.");
  }

  _syncInputs() {
    const position = this._exhibit.getTransform().exhibit.position;
    for (const input of this._inputs) {
      input.value = String(position[input.dataset.offsetAxis]);
      input.disabled = !this._exhibit.hasModel;
    }
  }

  async _save() {
    if (!this._exhibit.hasModel) {
      this._setStatus("Load a GLB model before saving calibration.");
      return;
    }

    const json = `${JSON.stringify(this._exhibit.getTransform(), null, 2)}\n`;
    if ("showSaveFilePicker" in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: "transform.json",
          types: [
            {
              description: "JSON transform",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        this._setStatus(`Saved ${handle.name}.`);
        return;
      } catch (error) {
        console.warn("Direct transform save unavailable; downloading:", error);
      }
    }

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "transform.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    this._setStatus(
      "Could not overwrite the file directly; downloaded transform.json.",
    );
  }

  _setStatus(message) {
    if (this._status) {
      this._status.textContent = message;
    }
  }
}
