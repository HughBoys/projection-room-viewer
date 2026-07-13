https://hughboys.github.io/projection-room-viewer/

# Projection Room Viewer — Web version

A fully client-side, browser-based port of the Panda3D projection-mapping
viewer. Walk through a five-wall + floor 3D room and see how a stitched video or
image maps onto each surface. Built with [three.js](https://threejs.org/) and
the HTML5 File API.

**Your media never leaves your machine.** Files are read directly in the browser
via object URLs and rendered locally with WebGL — nothing is uploaded to any
server. This makes it safe to host as a static site (e.g. GitHub Pages) while
keeping all media local to each user.

## Supported inputs

- **Video:** `.mp4`, `.mov`, `.webm`, `.m4v`, `.ogv`
- **Image:** `.png`, `.jpg`/`.jpeg`, `.webp`, `.avif`, `.bmp`
- **Animated:** `.gif` (plays back automatically)

All are treated as the stitched master frame and wrapped onto the walls using
the same `settings.json` mapping.

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
| `M` | Mute / unmute audio |

Select one or more files from the start panel (or drag & drop anywhere).

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
├── index.html      # UI, styles, three.js import map
├── settings.json   # room mapping (same schema as the Python version)
├── src/
│   ├── main.js      # bootstrap + render loop
│   ├── room.js      # geometry + pixel-crop → UV mapping
│   ├── controls.js  # WASD + drag-look, wall clamping
│   ├── video.js     # File API → <video> → VideoTexture
│   └── overlay.js   # 2D mapping-inspection overlay
└── README.md
```

