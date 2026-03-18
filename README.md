# Worldline 4D

Modern crisis-replay foundation for viewing flights, satellites, jamming, maritime traffic, closures, and cascading events across time.

## What This Build Is

This version is the foundation of a `3D / 4D worldview-style` application:

- `4D playback timeline` for scrubbing through a full situation sequence
- `sensor-layer fusion` across commercial flights, military flights, satellites, maritime traffic, closures, and jamming
- `area-of-interest correlation` for seeing what assets are overhead when events occur
- `modern ops UI` designed for large displays and split-screen laptop monitoring

The current build uses a modeled replay dataset to prove out the product direction and interaction patterns.

## Files

- `index.html` — application shell
- `styles.css` — modern multi-pane interface and responsive layout
- `app.js` — replay engine, timeline logic, layers, and UI rendering
- `server.js` — lightweight static server
- `ADAN_NOTES.md` — project handoff summary

## Run Locally

If you have Node.js installed:

```bash
npm run check
npm start
```

If you want a dependency-free preview on macOS with Ruby:

```bash
ruby -run -e httpd . -p 4173
```

Then open `http://localhost:4173`.

## Product Direction

The next logical evolution would be:

- replacing the 2D theater map with a dedicated 3D globe engine
- swapping the modeled replay dataset for real feeds and ingestion pipelines
- adding scenario libraries, saved viewpoints, and narrative chapters
- introducing more advanced AOI analytics and asset correlation tooling
