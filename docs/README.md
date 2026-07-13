# Projection Room Viewer — Web version

A fully client-side, browser-based port of the Panda3D projection-mapping
viewer. Walk through a five-wall + floor 3D room and see how a stitched video or
image maps onto each surface. A local GLB model can be shown around the room as
the rest of the exhibit. Built with [three.js](https://threejs.org/) and the
HTML5 File API.

**Your media never leaves your machine.** Files are read directly in the browser
via object URLs and rendered locally with WebGL — nothing is uploaded to any
server. This makes it safe to host as a static site (e.g. GitHub Pages) while
keeping all media local to each user.

## Supported inputs

- **Video:** `.mp4`, `.mov`, `.webm`, `.m4v`, `.ogv`
- **Image:** `.png`, `.jpg`/`.jpeg`, `.webp`, `.avif`, `.bmp`
- **Animated:** `.gif` (plays back automatically)
- **Exhibit:** `.glb`

Videos and images are treated as the stitched master frame and wrapped onto the
walls using the same `settings.json` mapping.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Walk through the room |
| Drag left mouse | Look around (yaw + pitch) |
| `Space` | Play / pause (video) |
| Bottom playhead | Scrub or jump to a point in the video |
| Bottom ■ button | Stop and return to the first frame |
| `←` / `→` | Previous / next media file |
| `↑` / `↓` | Playback speed −/+ 1% |
| `Enter` | Toggle the layout overlay + decal editor |
| `C` | Toggle GLB calibration mode |
| `M` | Mute / unmute audio |

Select one or more files from the start panel (or drag & drop anywhere).

## GLB exhibit and transform

Choose a `.glb` alongside the projection media, or drag it onto the viewer
later. The model is rendered with its original glTF materials and textures
under global ambient lighting. Movement is unrestricted and neither the
projection room nor the exhibit adds collision geometry, so all walls can be
walked through for now.

The viewer always loads placement from the bundled
`docs/transform.json`. Edit that file to fit the exhibit model around the
projection room:

```json
{
  "schema_version": 1,
  "coordinate_system": "three.js_y_up",
  "units": "meters",
  "exhibit": {
    "position": { "x": 0, "y": 0, "z": 0 },
    "rotation": {
      "order": "YXZ",
      "x_degrees": 0,
      "y_degrees": 0,
      "z_degrees": 0
    },
    "scale": { "x": 1, "y": 1, "z": 1 }
  }
}
```

Positions and scale use metres. The room floor is `y = 0`, its centre is
`(0, 0, 0)`, and rotations are in degrees.

### Calibration mode (`C`)

After loading a GLB, press `C` to open calibration mode. The panel can rotate
the model by ±90° on each axis and change its X/Y/Z offset in metres. Changes
are visible immediately.

**Save calibration** opens the browser's file-save picker when direct file
writing is supported. Select the bundled `docs/transform.json` to overwrite it.
If direct writing is unsupported or permission is denied, the viewer downloads
a replacement file named `transform.json`; copy it into `docs/` before the next
run or deployment.

## Layout overlay & PNG decals (`Enter`)

Press `Enter` to open the layout view over the master frame:

- **Scroll** to zoom toward the cursor; **drag** empty space to pan.
- A top-left readout shows the cursor position in master-frame pixels.
- **Add PNG…** (top-right) uploads overlay images ("decals"). Each decal can be
  **dragged** to move, **corner-handle dragged** to scale, **top-handle dragged**
  to rotate, and adjusted with **Scale / Rotation / Opacity** sliders. `Delete`
  removes the selected decal.
- Decals are baked into the master frame, so they map onto the walls and appear
  over the top of the video in 3D.

## Run locally

Because the app loads ES modules and fetches `settings.json`, serve it over HTTP
rather than opening `index.html` directly:

```bash
cd docs
python3 -m http.server 8000
# then open http://localhost:8000
```

(If opened via `file://`, the app falls back to built-in default settings.)

## Deploy on GitHub Pages

1. Commit this `docs/` folder to your repository's default branch.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source = Deploy from a branch**,
   **Branch = main**, **Folder = /docs**, then save.
4. Your viewer will be published at
   `https://<user>.github.io/<repo>/`.

No build step is required — three.js is loaded from a CDN via an ES module
import map in `index.html`.

## Mapping configuration

`settings.json` uses the same schema as the Python app: a master frame
resolution plus per-surface pixel crops (`top_left_x/y`, `width_pixels`,
`height_pixels`, `rotation_degrees`). Edit it to change how the source video is
sliced onto `left_wall`, `center_wall`, `right_wall`, `back_wall`, and `floor`.

## File layout

```text
docs/
├── index.html                 # UI, styles, three.js import map
├── settings.json              # room mapping
├── transform.json             # GLB placement relative to the room
├── src/
│   ├── main.js                 # bootstrap + render loop
│   ├── exhibit.js              # GLB loading, transform, cleanup
│   ├── calibration.js          # model calibration UI + transform saving
│   ├── room.js                 # geometry + pixel-crop → UV mapping
│   ├── controls.js             # unrestricted WASD + drag-look
│   ├── video.js                # File API → <video> → VideoTexture
│   └── overlay.js              # 2D mapping-inspection overlay
└── README.md
```
