# Adan Notes

## Overview

The project has now been pushed past the earlier replay-map phase into a proper `globe-first Panopticon Earth build`. It behaves much more like a controllable Google-Earth-style intelligence surface than a flat dashboard.

## What Was Rebuilt

- moved the app to `Vite` for a modern front-end workflow
- replaced the old Leaflet map foundation with a `Cesium 3D globe`
- introduced direct globe controls so the user can drag, zoom, rotate, tilt, and fly anywhere on Earth
- rebuilt the interface as a cinematic HUD with left and right control rails plus a bottom replay dock
- added modeled traffic for commercial aviation, military tracks, satellites, maritime movement, incidents, and disruption zones

## Operator Features

- global search with fly-to behavior
- basemap switching
- visual FX modes and live tuning sliders
- play / pause / reset replay transport controls
- clickable event rail and timeline markers
- selectable entities with track / release controls
- persistent saved camera bookmarks

## Why This Direction Is Better

- the globe now feels exploratory instead of static
- the user can inspect any part of Earth instead of staying locked to one theater
- the traffic simulations make the world feel alive even before real feeds are connected
- the architecture is now much closer to the kind of geospatial product the user actually asked for

## Logical Next Steps

- add live data ingestion for aircraft, ships, and weather
- expand the scenario library and saved viewpoints
- add denser visual analytics like heatmaps, route cones, and sensor sweeps
- improve object iconography and cinematic flythrough presets
