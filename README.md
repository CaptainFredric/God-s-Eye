# Panopticon Earth

Panopticon Earth is a globe-first geospatial intelligence experience inspired by Google Earth, replay consoles, and modern command interfaces.

## What Changed

This repository has been fully reworked from a 2D replay dashboard into a `Cesium + Vite` application with:

- a fully draggable, zoomable, rotatable `3D Earth`
- layered simulated `commercial flights`, `military traffic`, `satellites`, `maritime routes`, and `incident zones`
- timeline-driven replay with click-to-jump event chapters
- scene controls for `home`, `tilt`, `spin`, glow tuning, and visual modes
- searchable globe navigation plus saved camera bookmarks

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

## Current Capabilities

- direct globe interaction with drag, pan, tilt, and zoom
- replay timeline controlling all simulated entities
- click selection and entity tracking
- multiple basemaps and visual FX modes
- persistent saved camera views in local storage
- public geocoding search using OpenStreetMap Nominatim

## Next Extensions

- swap modeled data for live or historical ingest pipelines
- add true sensor heatmaps and denser traffic layers
- expand cinematic camera paths and saved scenario playlists
- integrate real weather, AIS, and ADS-B data where practical
