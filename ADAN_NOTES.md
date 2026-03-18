# Adan Notes

## Overview

This project has been reset into a new product direction: a modern `4D crisis replay` foundation rather than a generic command dashboard. The goal is to visualize evolving situations over time with layered air, orbital, maritime, and disruption data in one replay interface.

## Current Foundation

- New product identity: `Worldline 4D`
- New layout focused on a central replay theater with left and right intelligence rails
- Bottom timeline dock for scrubbing, play / pause, reset, and playback speed control
- Layer system for commercial flights, military flights, satellites, jamming, maritime traffic, closures, and incidents
- Area-of-interest correlation model showing when overhead assets align with important events
- Scenario brief, event queue, active event detail, impact cascade, and tracked asset summaries

## Visualization Direction

- Built as a replay engine instead of a static status board
- Designed to make ordering, escalation, and cascading effects obvious
- Structured so a future 3D globe can replace the current 2D map without changing the overall product concept
- Tailored for large-screen use and split-screen laptop monitoring

## Data Model Direction

The current build uses a modeled scenario dataset to prove the workflow:

- chapter-based event sequence
- commercial and military air traffic
- commercial and defense satellite passes
- GPS disruption zones
- maritime traffic through a chokepoint
- closure polygons and secondary impact zones

## What This Enables Next

- real ingestion pipelines for live or historical replay datasets
- multiple named scenarios and theaters
- saved viewpoints and analyst notes
- true 3D globe playback
- richer AOI analytics and cross-layer correlation
