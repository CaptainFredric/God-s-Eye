# God's Eye Command Center

Cyber-styled static operations dashboard with:

- live or simulated air-traffic telemetry
- orbital satellite tracking
- interactive Leaflet map layers
- CCTV feed launcher with fullscreen viewer
- verified public camera wall using live snapshots with auto-refresh and source links
- responsive sidebar and mobile drawer support

## Files

- `index.html` — app shell
- `styles.css` — layout and visual system
- `app.js` — map, telemetry, satellites, UI, CCTV logic
- `server.js` — tiny local static server
- `ADAN_NOTES.md` — handoff notes describing deviations from the original concept

## Run locally

If you have Node.js installed:

```bash
npm run check
npm start
```

Then open `http://localhost:4173`.

If you want a dependency-free preview on macOS with Ruby:

```bash
ruby -run -e httpd . -p 4173
```

Then open `http://localhost:4173`.

## Notes

- The app starts with simulated aircraft immediately so the dashboard never loads empty.
- It then attempts live OpenSky aircraft data through several routes and falls back gracefully if those requests fail or time out.
- If the live feed is unavailable, the demo telemetry remains active so the UI, trails, focus controls, and counters still work.
- Satellite motion uses a lightweight client-side orbit model driven by TLE-derived parameters for ambient visualization.
- Camera feeds now favor verified public live snapshots instead of brittle YouTube embeds, and the viewer can refresh frames or auto-cycle sources.
- The dashboard now saves key preferences like map mode, region, enabled layers, and camera-wall settings between reloads.