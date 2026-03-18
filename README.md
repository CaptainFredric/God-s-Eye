# Panopticon Earth

Panopticon Earth is a globe-first geospatial intelligence experience inspired by Google Earth, replay consoles, and modern command interfaces.

## What Changed

This repository has been reworked from a 2D replay dashboard into a live-focused `Cesium + Vite` application with:

- a fully draggable, zoomable, rotatable `3D Earth`
- layered simulated `commercial flights`, `military traffic`, `satellites`, `maritime routes`, and `incident zones`
- live feed refresh cadence with data assurance/trust indicators
- scene controls for `home`, `tilt`, `spin`, glow tuning, and visual modes
- searchable globe navigation with keyboard result control plus saved camera bookmarks
- operational legend synced to layer on/off state

## Project Structure

- `index.html` — Vite app shell and HUD layout
- `src/main.js` — Cesium viewer setup, replay engine, UI logic, and interactivity
- `src/data/scenario.js` — modeled traffic, orbital, maritime, zone, and event data
- `src/styles/index.css` — globe HUD, glass panels, responsive layout, and FX styling
- `vite.config.js` — Vite + Cesium configuration
- `Alpha Launch.bat` — Windows launcher for local development
- `ADAN_NOTES.md` — handoff summary for the redesign

## Run Locally

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`.

To verify the production build:

```bash
npm run build
npm run preview
```

For post-change interaction validation, use `SMOKE_CHECKLIST.md`.

## GitHub Deployment (Pages)

This repo now includes `.github/workflows/deploy-pages.yml`.

- Push to `main` to auto-build and publish `dist/` to GitHub Pages.
- In GitHub, set **Settings → Pages → Source** to **GitHub Actions**.
- Your hosted URL will be:
	- `https://captainfredric.github.io/God-s-Eye/`

`localhost` itself is not directly reachable from GitHub, but this workflow publishes the same app build from your repo to a public URL.

## Current Capabilities

- direct globe interaction with drag, pan, tilt, and zoom
- scheduled live refresh cycle for integrated feeds
- click selection and entity tracking
- multiple basemaps and visual FX modes
- persistent saved camera views in local storage
- public geocoding search using OpenStreetMap Nominatim
- keyboard navigation for search results (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`)
- trust indicators and operational legend for operator confidence/readability

## Next Extensions

- swap modeled data for live or historical ingest pipelines
- add true sensor heatmaps and denser traffic layers
- expand cinematic camera paths and saved scenario playlists
- integrate real weather, AIS, and ADS-B data where practical
