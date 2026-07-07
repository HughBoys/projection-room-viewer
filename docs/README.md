# Projection Room Viewer — Web version

A fully client-side, browser-based port of the Panda3D projection-mapping
viewer. Walk through a five-wall + floor 3D room and see how a stitched `.mp4`
maps onto each surface. Built with [three.js](https://threejs.org/) and the
HTML5 File API.

**Your video never leaves your machine.** Files are read directly in the browser
via object URLs and rendered locally with WebGL — nothing is uploaded to any
server. This makes it safe to host as a static site (e.g. GitHub Pages) while
keeping all media local to each user.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Walk through the room |
| Drag left mouse | Look around (yaw + pitch) |
| `Space` | Play / pause |
| `←` / `→` | Previous / next video |
| `Enter` | Toggle the 2D mapping-inspection overlay |
| `M` | Mute / unmute audio |

Select one or more videos from the start panel (or drag & drop anywhere).

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
