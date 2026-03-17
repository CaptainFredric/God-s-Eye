# Adan Notes

## Overview

`God's Eye` is a polished tactical dashboard built around global aircraft telemetry, satellite tracking, and a resilient camera wall. The current build focuses on feeling active at all times, even when external live sources are inconsistent.

## Delivered Changes

- Split the project into `index.html`, `styles.css`, and `app.js` for maintainability.
- Reworked the visual system into a cohesive cyber / command-center interface.
- Added immediate simulated telemetry so the application never opens into an empty or broken-looking state.
- Added saved dashboard preferences so important UI choices persist across reloads.
- Added stronger OpenSky fetch fallback behavior across multiple routes.
- Improved aircraft motion so contacts keep moving between live refreshes.
- Added visible flight trails for better motion readability.
- Corrected satellite orbit calculations for more believable altitude and movement.
- Improved responsive behavior for medium and smaller screen sizes.
- Added dedicated split-screen laptop refinements so panels stay readable in tighter desktop widths.

## Camera Wall Functions

- Replaced fragile video-first camera slots with verified public live snapshots.
- Added a camera overlay with `REFRESH FRAME`, `NEXT FEED`, `AUTO CYCLE`, and `OPEN SOURCE` controls.
- Added a faster looped snapshot refresh so feeds feel closer to live video.
- Added periodic thumbnail refreshes so the feed strip stays visually active.
- Added a `Sensor Matrix` panel showing feed class, selected sensor, cadence, scan mode, and frame age.
- Added an `Ops Feed Log` panel to record patrol shifts, camera locks, manual refreshes, and failures.
- Added a `Mosaic` camera wall mode that shows multiple feeds at once for a more mission-control style layout.
- Added persistence for selected camera-wall behavior such as mosaic mode, patrol mode readiness, and the chosen camera source.
- Added a clear sidebar legend to explain aircraft colors, satellite markers, trails, and live camera indicators.
- Added an about / purpose section so the dashboard explains what it is for at a glance.

## Interface and Visual Features

- Added tactical grid and radar sweep overlays on top of the map.
- Added upgraded mission cards and more readable telemetry panels.
- Added richer camera metadata in the sidebar and feed thumbnails.
- Added smoother snapshot frame transitions to make refreshes feel less abrupt.

## Stability Notes

The dashboard is designed to remain visually alive even when third-party services fail. Public snapshot sources may still change over time, but the current setup is more durable because it prefers image-based live sources and always provides a direct source link.

## Suggested Next Ideas

- Add camera categories such as `traffic`, `aviation`, `science`, and `city`.
- Add a larger intelligence drawer for selected aircraft.
- Add sorting and filters for aircraft speed, altitude, and region.
- Add a timeline or playback strip for recent camera-frame events.