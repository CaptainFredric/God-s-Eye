import { BASEMAPS, DEFAULT_BOOKMARKS, FX_MODES, LAYERS, SCENARIO, STORAGE_KEYS } from "./data/scenario.js";
import { fetchLiveFeeds, getConfiguredAisEndpoint } from "./services/live-feeds.js";

const Cesium = await loadCesium();

function normalizeCesiumModule(module) {
  if (module?.Viewer) {
    return module;
  }
  if (module?.default?.Viewer) {
    return module.default;
  }
  return module?.default ?? module;
}

async function loadCesium() {
  if (globalThis.Cesium?.Viewer) {
    return globalThis.Cesium;
  }
  return normalizeCesiumModule(await import("cesium"));
}

const replayStart = Cesium.JulianDate.fromDate(new Date(Date.UTC(2026, 2, 17, 0, 0, 0)));
const replayStop = Cesium.JulianDate.addMinutes(replayStart, SCENARIO.durationMinutes, new Cesium.JulianDate());

const state = {
  selectedEntity: null,
  trackedEntity: null,
  hoveredEntity: null,
  spinning: true,
  spinPausedUntil: 0,
  activeDrawer: null,
  intelSheetOpen: false,
  tiltMode: false,
  searchAbortController: null,
  basemapId: loadJson(STORAGE_KEYS.basemap, BASEMAPS[0].id),
  fxMode: loadJson(STORAGE_KEYS.fxMode, FX_MODES[0].id),
  bookmarks: loadJson(STORAGE_KEYS.bookmarks, DEFAULT_BOOKMARKS),
  layers: loadJson(STORAGE_KEYS.layers, Object.fromEntries(LAYERS.map(layer => [layer.id, layer.enabled]))),
  replaySpeed: 8,
  fxIntensity: 58,
  fxGlow: 30,
  liveFeeds: {
    adsb: { status: "idle", source: "OpenSky ADS-B", message: "Awaiting refresh", records: [], updatedAt: null },
    ais: { status: getConfiguredAisEndpoint() ? "idle" : "config-required", source: "AIS Adapter", message: getConfiguredAisEndpoint() ? "Awaiting refresh" : "Configure a CORS-safe AIS endpoint", records: [], updatedAt: null }
  }
};

const elements = {};
const dynamic = {
  trails: [],
  zones: [],
  incidents: [],
  traffic: [],
  rings: [],
  radars: [],
  liveTraffic: []
};

let frameSamples = [];

const viewer = new Cesium.Viewer("cesiumContainer", {
  animation: false,
  timeline: false,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  requestRenderMode: false,
  shouldAnimate: false,
  terrain: undefined
});

const postStages = {
  blackAndWhite: Cesium.PostProcessStageLibrary.createBlackAndWhiteStage(),
  brightness: Cesium.PostProcessStageLibrary.createBrightnessStage()
};
const bloomStage = viewer.scene.postProcessStages.bloom;
viewer.scene.postProcessStages.add(postStages.blackAndWhite);
viewer.scene.postProcessStages.add(postStages.brightness);
viewer.scene.postProcessStages.fxaa.enabled = true;
if (bloomStage) {
  bloomStage.enabled = true;
  bloomStage.uniforms.glowOnly = false;
}
viewer.scene.globe.enableLighting = true;
viewer.scene.skyAtmosphere.show = true;
viewer.scene.globe.depthTestAgainstTerrain = false;
viewer.clock.startTime = replayStart.clone();
viewer.clock.stopTime = replayStop.clone();
viewer.clock.currentTime = replayStart.clone();
viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
viewer.clock.multiplier = 60 * state.replaySpeed;
viewer.clock.shouldAnimate = true;
viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.6);

const homeView = Cesium.Cartesian3.fromDegrees(
  SCENARIO.initialView.lng,
  SCENARIO.initialView.lat,
  SCENARIO.initialView.height
);
viewer.camera.setView({
  destination: homeView,
  orientation: {
    heading: SCENARIO.initialView.heading,
    pitch: SCENARIO.initialView.pitch,
    roll: SCENARIO.initialView.roll
  }
});

cacheElements();
applyFxMode(state.fxMode);
applyFxIntensity();
applyGlow();
renderMetricCluster();
renderBasemapButtons();
renderLayerToggles();
renderBookmarks();
renderFxButtons();
renderTimelineMarkers();
installBasemap(state.basemapId);
seedScene();
renderFeedStatus();
registerEvents();
elements.btnSpin.classList.toggle("active", state.spinning);
updateScene(viewer.clock.currentTime);
startHudClock();
refreshLiveFeeds();
window.setInterval(refreshLiveFeeds, 90000);
viewer.scene.requestRender();

function cacheElements() {
  Object.assign(elements, {
    metricCluster: document.getElementById("metric-cluster"),
    basemapButtons: document.getElementById("basemap-buttons"),
    layerToggles: document.getElementById("layer-toggles"),
    bookmarkList: document.getElementById("bookmark-list"),
    saveBookmark: document.getElementById("save-bookmark"),
    clearBookmarks: document.getElementById("clear-bookmarks"),
    fxModeButtons: document.getElementById("fx-mode-buttons"),
    fxIntensity: document.getElementById("fx-intensity"),
    fxIntensityValue: document.getElementById("fx-intensity-value"),
    fxGlow: document.getElementById("fx-glow"),
    fxGlowValue: document.getElementById("fx-glow-value"),
    replaySpeed: document.getElementById("replay-speed"),
    replaySpeedValue: document.getElementById("replay-speed-value"),
    entityInfo: document.getElementById("entity-info"),
    trackSelected: document.getElementById("track-selected"),
    releaseTrack: document.getElementById("release-track"),
    eventRail: document.getElementById("event-rail"),
    summaryStage: document.getElementById("summary-stage"),
    summaryTime: document.getElementById("summary-time"),
    summaryCopy: document.getElementById("summary-copy"),
    summaryTags: document.getElementById("summary-tags"),
    playToggle: document.getElementById("play-toggle"),
    pauseToggle: document.getElementById("pause-toggle"),
    resetToggle: document.getElementById("reset-toggle"),
    timelineSlider: document.getElementById("timeline-slider"),
    timelineMarkers: document.getElementById("timeline-markers"),
    searchInput: document.getElementById("search-input"),
    searchButton: document.getElementById("search-btn"),
    searchResults: document.getElementById("search-results"),
    hoverTooltip: document.getElementById("hover-tooltip"),
    mobileDrawers: document.getElementById("mobile-drawers"),
    mobileBackdrop: document.getElementById("mobile-backdrop"),
    btnMobileLayers: document.getElementById("btn-mobile-layers"),
    btnMobileControls: document.getElementById("btn-mobile-controls"),
    btnMobileIntel: document.getElementById("btn-mobile-intel"),
    feedStatus: document.getElementById("feed-status"),
    refreshFeeds: document.getElementById("refresh-feeds"),
    intelSheet: document.getElementById("intel-sheet"),
    closeIntelSheet: document.getElementById("close-intel-sheet"),
    intelSheetKicker: document.getElementById("intel-sheet-kicker"),
    intelSheetTitle: document.getElementById("intel-sheet-title"),
    intelSheetOverview: document.getElementById("intel-sheet-overview"),
    intelSheetTelemetry: document.getElementById("intel-sheet-telemetry"),
    intelSheetAssessment: document.getElementById("intel-sheet-assessment"),
    intelSheetTimeline: document.getElementById("intel-sheet-timeline"),
    hudUtc: document.getElementById("hud-utc"),
    hudLocal: document.getElementById("hud-local"),
    hudFps: document.getElementById("hud-fps"),
    hudCamera: document.getElementById("hud-camera"),
    hudStatusText: document.getElementById("hud-status-text"),
    btnHome: document.getElementById("btn-home"),
    btnTilt: document.getElementById("btn-tilt"),
    btnSpin: document.getElementById("btn-spin")
  });

  elements.fxIntensity.value = String(state.fxIntensity);
  elements.fxGlow.value = String(state.fxGlow);
  elements.replaySpeed.value = String(state.replaySpeed);
  elements.timelineSlider.max = String(SCENARIO.durationMinutes);
}

function loadJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}

function minuteToTime(minute) {
  return Cesium.JulianDate.addMinutes(replayStart, minute, new Cesium.JulianDate());
}

function currentMinute(currentTime = viewer.clock.currentTime) {
  return clamp(Cesium.JulianDate.secondsDifference(currentTime, replayStart) / 60, 0, SCENARIO.durationMinutes);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatMinute(minute) {
  const whole = Math.round(minute);
  const hours = String(Math.floor(whole / 60)).padStart(2, "0");
  const minutes = String(whole % 60).padStart(2, "0");
  return `T+${hours}:${minutes}Z`;
}

function installBasemap(basemapId) {
  state.basemapId = basemapId;
  saveJson(STORAGE_KEYS.basemap, basemapId);
  viewer.imageryLayers.removeAll();
  const basemap = BASEMAPS.find(item => item.id === basemapId) || BASEMAPS[0];
  const provider = basemap.type === "osm"
    ? new Cesium.OpenStreetMapImageryProvider({ url: basemap.url })
    : new Cesium.UrlTemplateImageryProvider({ url: basemap.url, credit: basemap.credit });
  viewer.imageryLayers.addImageryProvider(provider);
  renderBasemapButtons();
}

function renderMetricCluster() {
  const metrics = [
    { key: "tracks", label: "Tracks", value: "0", foot: "Visible traffic" },
    { key: "alerts", label: "Alerts", value: "0", foot: "Active disruptions" },
    { key: "orbits", label: "Orbit", value: "0", foot: "Overhead passes" },
    { key: "tempo", label: "Tempo", value: `${state.replaySpeed}×`, foot: "Replay speed" }
  ];
  elements.metricCluster.innerHTML = metrics.map(metric => `
    <article class="metric-card" data-metric="${metric.key}">
      <span class="metric-label">${metric.label}</span>
      <strong class="metric-value">${metric.value}</strong>
      <span class="metric-foot">${metric.foot}</span>
    </article>
  `).join("");
}

function updateMetricCard(key, value, foot) {
  const card = elements.metricCluster.querySelector(`[data-metric="${key}"]`);
  if (!card) {
    return;
  }
  const valueElement = card.querySelector(".metric-value");
  const footElement = card.querySelector(".metric-foot");
  if (valueElement) {
    valueElement.textContent = String(value);
  }
  if (footElement) {
    footElement.textContent = foot;
  }
}

function renderFeedStatus() {
  if (!elements.feedStatus) {
    return;
  }
  const feeds = [state.liveFeeds.adsb, state.liveFeeds.ais];
  elements.feedStatus.innerHTML = feeds.map(feed => `
    <article class="feed-card ${feed.status}">
      <div class="feed-card-head">
        <strong>${feed.source}</strong>
        <span>${feed.status.toUpperCase()}</span>
      </div>
      <p>${feed.message}</p>
      <small>${feed.updatedAt ? new Date(feed.updatedAt).toLocaleTimeString([], { hour12: false }) : "Not yet refreshed"}</small>
    </article>
  `).join("");
}

function renderBasemapButtons() {
  elements.basemapButtons.innerHTML = "";
  BASEMAPS.forEach(basemap => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `basemap-btn${state.basemapId === basemap.id ? " active" : ""}`;
    button.textContent = basemap.label;
    button.addEventListener("click", () => installBasemap(basemap.id));
    elements.basemapButtons.appendChild(button);
  });
}

function renderLayerToggles() {
  elements.layerToggles.innerHTML = "";
  LAYERS.forEach(layer => {
    const active = !!state.layers[layer.id];
    const row = document.createElement("button");
    row.type = "button";
    row.className = `layer-toggle${active ? " active" : ""}`;
    row.innerHTML = `
      <span class="layer-copy">
        <span class="layer-name">${layer.label}</span>
        <span class="layer-description">${layer.description}</span>
      </span>
      <span class="layer-switch">${active ? "ON" : "OFF"}</span>
    `;
    row.addEventListener("click", () => {
      state.layers[layer.id] = !state.layers[layer.id];
      saveJson(STORAGE_KEYS.layers, state.layers);
      renderLayerToggles();
      refreshEntityVisibility();
      updateScene(viewer.clock.currentTime);
    });
    elements.layerToggles.appendChild(row);
  });
}

function renderBookmarks() {
  elements.bookmarkList.innerHTML = "";
  state.bookmarks.forEach(bookmark => {
    const row = document.createElement("div");
    row.className = "bookmark-item";
    row.innerHTML = `<button type="button">${bookmark.label}</button><button type="button" data-remove="${bookmark.id}">✕</button>`;
    row.firstElementChild.addEventListener("click", () => flyToBookmark(bookmark));
    row.lastElementChild.addEventListener("click", () => removeBookmark(bookmark.id));
    elements.bookmarkList.appendChild(row);
  });
}

function renderFxButtons() {
  elements.fxModeButtons.innerHTML = "";
  FX_MODES.forEach(mode => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `fx-btn${state.fxMode === mode.id ? " active" : ""}`;
    button.textContent = mode.label;
    button.addEventListener("click", () => {
      state.fxMode = mode.id;
      saveJson(STORAGE_KEYS.fxMode, state.fxMode);
      applyFxMode(mode.id);
      renderFxButtons();
    });
    elements.fxModeButtons.appendChild(button);
  });
}

function renderTimelineMarkers() {
  elements.timelineMarkers.innerHTML = "";
  SCENARIO.events.forEach(event => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "timeline-marker";
    marker.style.left = `${(event.minute / SCENARIO.durationMinutes) * 100}%`;
    marker.title = `${formatMinute(event.minute)} · ${event.title}`;
    marker.addEventListener("click", () => jumpToMinute(event.minute));
    elements.timelineMarkers.appendChild(marker);
  });
}

function seedScene() {
  const commercialTraffic = [...SCENARIO.flights.commercial, ...generateTrafficVariants(SCENARIO.flights.commercial, "COM", 1, 0.9, 0.5)];
  const militaryTraffic = [...SCENARIO.flights.military, ...generateTrafficVariants(SCENARIO.flights.military, "MIL", 1, 0.45, 0.28)];
  const maritimeTraffic = [...SCENARIO.maritime, ...generateTrafficVariants(SCENARIO.maritime, "SEA", 1, 0.35, 0.22)];
  createTrafficEntities(commercialTraffic, "commercial", Cesium.Color.fromCssColorString("#7ee0ff"), 55 * 60);
  createTrafficEntities(militaryTraffic, "military", Cesium.Color.fromCssColorString("#ffbe5c"), 80 * 60);
  createTrafficEntities(SCENARIO.satellites, "satellites", Cesium.Color.fromCssColorString("#af9dff"), 120 * 60, 8);
  createTrafficEntities(maritimeTraffic, "maritime", Cesium.Color.fromCssColorString("#60f7bf"), 120 * 60, 7);
  createZones();
  createIncidents();
  renderEventRail();
}

function generateTrafficVariants(items, prefix, variantCount, lngDrift, latDrift) {
  return items.flatMap((item, itemIndex) => Array.from({ length: variantCount }, (_, variantIndex) => {
    const driftFactor = itemIndex + variantIndex + 1;
    return {
      ...item,
      id: `${item.id}-${prefix.toLowerCase()}-${variantIndex + 1}`,
      label: `${prefix}-${String(driftFactor).padStart(2, "0")}`,
      description: `${item.description} Auxiliary model track used for density and continuity.`,
      showLabel: false,
      positions: item.positions.map((point, pointIndex) => ({
        ...point,
        lng: point.lng + Math.sin((pointIndex + 1) * 0.8 + driftFactor) * lngDrift,
        lat: point.lat + Math.cos((pointIndex + 1) * 0.6 + driftFactor) * latDrift,
        minute: clamp(point.minute + variantIndex, 0, SCENARIO.durationMinutes)
      }))
    };
  }));
}

function createTrafficEntities(items, layerId, color, trailTime, pixelSize = 9) {
  items.forEach(item => {
    const position = new Cesium.SampledPositionProperty();
    item.positions.forEach(point => {
      position.addSample(
        minuteToTime(point.minute),
        Cesium.Cartesian3.fromDegrees(point.lng, point.lat, point.altitude ?? item.altitude ?? 0)
      );
    });
    position.setInterpolationOptions({
      interpolationDegree: 2,
      interpolationAlgorithm: Cesium.LagrangePolynomialApproximation
    });

    const entity = viewer.entities.add({
      id: item.id,
      position,
      point: {
        pixelSize,
        color,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      path: {
        show: true,
        width: layerId === "satellites" ? 1.6 : 2.3,
        material: color.withAlpha(layerId === "satellites" ? 0.5 : 0.8),
        trailTime,
        leadTime: 0,
        resolution: 120
      },
      label: item.showLabel === false ? undefined : {
        text: item.label,
        font: '12px "Share Tech Mono"',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(5,12,23,0.75)"),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        pixelOffset: new Cesium.Cartesian2(12, -10),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 0.85,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 18000000)
      },
      properties: {
        layerId,
        label: item.label,
        description: item.description,
        entityType: layerId,
        altitude: item.altitude ?? 0,
        synthetic: item.showLabel === false
      }
    });
    entity._basePixelSize = pixelSize;
    entity._pulseSeed = Math.random() * Math.PI * 2;
    entity._layerColor = color;
    dynamic.traffic.push(entity);
    if (layerId === "military") {
      createRadarSweep(entity, color);
    }
  });
}

function destinationPoint(latDeg, lngDeg, distanceMeters, bearingDeg) {
  const angularDistance = distanceMeters / 6378137;
  const bearing = Cesium.Math.toRadians(bearingDeg);
  const lat = Cesium.Math.toRadians(latDeg);
  const lng = Cesium.Math.toRadians(lngDeg);
  const targetLat = Math.asin(
    Math.sin(lat) * Math.cos(angularDistance) +
    Math.cos(lat) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const targetLng = lng + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat),
    Math.cos(angularDistance) - Math.sin(lat) * Math.sin(targetLat)
  );
  return {
    lat: Cesium.Math.toDegrees(targetLat),
    lng: Cesium.Math.toDegrees(targetLng)
  };
}

function headingBetweenPositions(current, next) {
  if (!current || !next) {
    return 0;
  }
  const currentCartographic = Cesium.Cartographic.fromCartesian(current);
  const nextCartographic = Cesium.Cartographic.fromCartesian(next);
  const dLon = nextCartographic.longitude - currentCartographic.longitude;
  const y = Math.sin(dLon) * Math.cos(nextCartographic.latitude);
  const x =
    Math.cos(currentCartographic.latitude) * Math.sin(nextCartographic.latitude) -
    Math.sin(currentCartographic.latitude) * Math.cos(nextCartographic.latitude) * Math.cos(dLon);
  return (Cesium.Math.toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function createRadarSweep(entity, color) {
  const radarColor = color.brighten(0.2, new Cesium.Color());
  const radarEntity = viewer.entities.add({
    id: `${entity.id}-radar`,
    polygon: {
      hierarchy: new Cesium.CallbackProperty(() => {
        const currentPosition = entity.position?.getValue?.(viewer.clock.currentTime);
        const aheadTime = Cesium.JulianDate.addSeconds(viewer.clock.currentTime, 45, new Cesium.JulianDate());
        const futurePosition = entity.position?.getValue?.(aheadTime);
        if (!currentPosition) {
          return undefined;
        }
        const currentCartographic = Cesium.Cartographic.fromCartesian(currentPosition);
        const centerLat = Cesium.Math.toDegrees(currentCartographic.latitude);
        const centerLng = Cesium.Math.toDegrees(currentCartographic.longitude);
        const baseHeading = headingBetweenPositions(currentPosition, futurePosition);
        const sweepHeading = baseHeading + Math.sin(currentMinute() * 0.9 + entity._pulseSeed) * 62;
        const halfAngle = 18;
        const rangeMeters = 260000;
        const sectorPoints = [centerLng, centerLat];
        for (let step = 0; step <= 12; step += 1) {
          const bearing = sweepHeading - halfAngle + (step / 12) * halfAngle * 2;
          const point = destinationPoint(centerLat, centerLng, rangeMeters, bearing);
          sectorPoints.push(point.lng, point.lat);
        }
        return new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(sectorPoints));
      }, false),
      material: radarColor.withAlpha(0.14),
      outline: true,
      outlineColor: radarColor.withAlpha(0.42),
      perPositionHeight: false,
      height: 0
    },
    properties: {
      layerId: "military",
      label: `${entity.properties.label.getValue(viewer.clock.currentTime)} Radar Sweep`,
      description: "Ground-projected radar search cone linked to military track heading.",
      entityType: "radar"
    }
  });
  radarEntity._pulseSeed = entity._pulseSeed;
  dynamic.radars.push({ entity: radarEntity, parent: entity });
}

function createZones() {
  SCENARIO.zones.forEach(zone => {
    let entity;
    const color = Cesium.Color.fromCssColorString(zone.color);
    if (zone.kind === "rectangle") {
      entity = viewer.entities.add({
        id: zone.id,
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(
            zone.coordinates.west,
            zone.coordinates.south,
            zone.coordinates.east,
            zone.coordinates.north
          ),
          material: color.withAlpha(zone.fill),
          outline: true,
          outlineColor: color.withAlpha(0.75),
          height: 0
        },
        properties: {
          layerId: "zones",
          label: zone.label,
          description: `${zone.label} active window`,
          entityType: "zone",
          start: zone.start,
          end: zone.end
        }
      });
    } else {
      entity = viewer.entities.add({
        id: zone.id,
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(zone.coordinates.flat()),
          material: color.withAlpha(zone.fill),
          outline: true,
          outlineColor: color.withAlpha(0.8),
          perPositionHeight: false
        },
        properties: {
          layerId: "zones",
          label: zone.label,
          description: `${zone.label} active window`,
          entityType: "zone",
          start: zone.start,
          end: zone.end
        }
      });
    }
    entity._zoneColor = color;
    entity._baseFill = zone.fill;
    entity._pulseSeed = Math.random() * Math.PI * 2;
    dynamic.zones.push({ entity, zone });
  });
}

function createIncidents() {
  SCENARIO.incidents.forEach(incident => {
    const entity = viewer.entities.add({
      id: incident.id,
      position: Cesium.Cartesian3.fromDegrees(incident.location.lng, incident.location.lat, 1500),
      billboard: {
        image: createMarkerSvg("#ff6d8d", incident.label.slice(0, 1)),
        scale: 0.9,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: incident.label,
        font: '12px "Share Tech Mono"',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(5,12,23,0.75)"),
        pixelOffset: new Cesium.Cartesian2(0, -42),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      properties: {
        layerId: "incidents",
        label: incident.label,
        description: incident.description,
        entityType: "incident",
        start: incident.start,
        end: incident.end
      }
    });
    entity._pulseSeed = Math.random() * Math.PI * 2;
    dynamic.incidents.push({ entity, incident });

    const ring = viewer.entities.add({
      id: `${incident.id}-ring`,
      position: Cesium.Cartesian3.fromDegrees(incident.location.lng, incident.location.lat, 0),
      ellipse: {
        semiMajorAxis: 180000,
        semiMinorAxis: 180000,
        material: Cesium.Color.fromCssColorString("#ff6d8d").withAlpha(0.09),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#ff6d8d").withAlpha(0.4),
        height: 0
      }
    });
    ring._pulseSeed = Math.random() * Math.PI * 2;
    dynamic.rings.push({ entity: ring, incident });
  });
}

function createMarkerSvg(color, text) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="54" height="64" viewBox="0 0 54 64"><defs><filter id="g"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g filter="url(#g)"><path d="M27 2c12.7 0 23 10.3 23 23 0 16.7-23 37-23 37S4 41.7 4 25C4 12.3 14.3 2 27 2z" fill="${color}" fill-opacity="0.92" stroke="#ffffff" stroke-opacity="0.4"/><text x="27" y="31" text-anchor="middle" font-size="18" font-family="Share Tech Mono, monospace" fill="#04111f">${text}</text></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function refreshEntityVisibility() {
  dynamic.traffic.forEach(entity => {
    const layerId = entity.properties.layerId.getValue();
    entity.show = !!state.layers[layerId];
  });
  dynamic.radars.forEach(({ entity }) => {
    entity.show = !!state.layers.military;
  });
  dynamic.liveTraffic.forEach(entity => {
    const layerId = entity.properties.layerId.getValue(viewer.clock.currentTime);
    entity.show = !!state.layers[layerId];
  });
}

function pausePassiveSpin(duration = 5000) {
  state.spinPausedUntil = performance.now() + duration;
}

function focusCameraOnCartesian(cartesian, duration = 1.6) {
  if (!cartesian) {
    return;
  }
  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  const targetHeight = clamp(viewer.camera.positionCartographic.height * 0.55, 900000, 5500000);
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, targetHeight),
    orientation: {
      heading: viewer.camera.heading,
      pitch: Cesium.Math.toRadians(-52),
      roll: 0
    },
    duration
  });
}

function clickedCartesian(position, picked) {
  if (picked?.id?.position) {
    return picked.id.position.getValue(viewer.clock.currentTime);
  }
  return viewer.scene.pickPositionSupported
    ? viewer.scene.pickPosition(position)
    : viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
}

function getEntityInfo(entity) {
  if (!entity) {
    return null;
  }
  const props = entity.properties;
  const label = props?.label?.getValue?.(viewer.clock.currentTime) ?? entity.id;
  const description = props?.description?.getValue?.(viewer.clock.currentTime) ?? "";
  const type = props?.entityType?.getValue?.(viewer.clock.currentTime) ?? "unknown";
  const position = entity.position?.getValue?.(viewer.clock.currentTime);
  let locationMeta = "Static overlay";
  if (position) {
    const cartographic = Cesium.Cartographic.fromCartesian(position);
    locationMeta = `${Cesium.Math.toDegrees(cartographic.latitude).toFixed(2)}°, ${Cesium.Math.toDegrees(cartographic.longitude).toFixed(2)}°`;
  }
  const altitude = props?.altitude?.getValue?.(viewer.clock.currentTime) ?? 0;
  const synthetic = !!props?.synthetic?.getValue?.(viewer.clock.currentTime);
  return { label, description, type, locationMeta, altitude, synthetic };
}

function hideHoverTooltip() {
  elements.hoverTooltip.classList.add("hidden");
}

function showHoverTooltip(entity, screenPosition) {
  const info = getEntityInfo(entity);
  if (!info) {
    hideHoverTooltip();
    return;
  }
  elements.hoverTooltip.innerHTML = `
    <strong>${info.label}</strong>
    <span>${info.type.toUpperCase()}</span>
    <p>${info.description || info.locationMeta}</p>
  `;
  elements.hoverTooltip.style.left = `${screenPosition.x + 18}px`;
  elements.hoverTooltip.style.top = `${screenPosition.y + 18}px`;
  elements.hoverTooltip.classList.remove("hidden");
}

function updateLiveMetrics(minute) {
  const visibleTraffic = dynamic.traffic.filter(entity => entity.show).length + dynamic.liveTraffic.filter(entity => entity.show).length;
  const activeAlerts = dynamic.incidents.filter(({ entity }) => entity.show).length + dynamic.zones.filter(({ entity }) => entity.show).length;
  const visibleOrbits = dynamic.traffic.filter(entity => entity.show && entity.properties.layerId.getValue(viewer.clock.currentTime) === "satellites").length;
  const currentEvent = latestEvent(minute);
  updateMetricCard("tracks", visibleTraffic, `${Math.max(1, Math.round(visibleTraffic * 0.35))} sectors hot`);
  updateMetricCard("alerts", activeAlerts, activeAlerts ? "Disruptions active" : "Monitoring nominal");
  updateMetricCard("orbits", visibleOrbits, `${currentEvent.tags[0]?.toUpperCase() ?? "GLOBAL"} watch`);
  updateMetricCard("tempo", `${state.replaySpeed}×`, viewer.clock.shouldAnimate ? "Realtime replay" : "Paused review");
  if (elements.hudStatusText) {
    elements.hudStatusText.textContent = currentEvent.title.toUpperCase();
  }
}

function renderIntelTimeline(entity) {
  const info = getEntityInfo(entity);
  const activeEvent = latestEvent(currentMinute());
  return [
    { kicker: "Current", copy: `${info.label} aligned with ${activeEvent.title}` },
    { kicker: "Previous", copy: `${formatMinute(Math.max(0, currentMinute() - 8))} · Last verified position update` },
    { kicker: "Next", copy: `${formatMinute(Math.min(SCENARIO.durationMinutes, currentMinute() + 12))} · Continue watchlist monitoring` }
  ];
}

function openIntelSheet(entity) {
  const info = getEntityInfo(entity);
  if (!info || !elements.intelSheet) {
    return;
  }
  state.intelSheetOpen = true;
  document.body.classList.add("intel-sheet-open");
  elements.intelSheet.classList.remove("hidden");
  elements.intelSheet.setAttribute("aria-hidden", "false");
  elements.intelSheetKicker.textContent = `${info.type.toUpperCase()} DETAILS`;
  elements.intelSheetTitle.textContent = info.label;
  elements.intelSheetOverview.textContent = info.description || "Track selected for further review.";
  elements.intelSheetTelemetry.innerHTML = `
    <div>${info.locationMeta}</div>
    <div>Altitude: ${Math.round(info.altitude).toLocaleString()} m</div>
    <div>Status: ${viewer.clock.shouldAnimate ? "Replay running" : "Replay paused"}</div>
    <div>Class: ${info.synthetic ? "Auxiliary model track" : "Primary track"}</div>
  `;
  elements.intelSheetAssessment.innerHTML = `
    <div>${info.type === "military" || info.type === "radar" ? "Military-linked track with active radar coverage." : "Traffic track contributing to current route density."}</div>
    <div>Active event: ${latestEvent(currentMinute()).title}</div>
    <div>Feed context: ${info.type.startsWith("live-") ? "Live feed adapter" : "Scenario replay model"}</div>
  `;
  elements.intelSheetTimeline.innerHTML = renderIntelTimeline(entity).map(item => `
    <div class="intel-timeline-item">
      <strong>${item.kicker}</strong>
      <span>${item.copy}</span>
    </div>
  `).join("");
}

function closeIntelSheet() {
  state.intelSheetOpen = false;
  document.body.classList.remove("intel-sheet-open");
  if (!elements.intelSheet) {
    return;
  }
  elements.intelSheet.classList.add("hidden");
  elements.intelSheet.setAttribute("aria-hidden", "true");
}

function setMobileDrawer(drawer) {
  state.activeDrawer = state.activeDrawer === drawer ? null : drawer;
  document.body.classList.toggle("mobile-drawer-open", !!state.activeDrawer);
  document.body.classList.toggle("mobile-layers-open", state.activeDrawer === "layers");
  document.body.classList.toggle("mobile-controls-open", state.activeDrawer === "controls");
  elements.mobileBackdrop.classList.toggle("hidden", !state.activeDrawer);
}

function clearLiveTraffic() {
  dynamic.liveTraffic.forEach(entity => viewer.entities.remove(entity));
  dynamic.liveTraffic.length = 0;
}

function addLiveTrafficEntities(records, layerId, color, entityType) {
  records.forEach(record => {
    const entity = viewer.entities.add({
      id: record.id,
      position: Cesium.Cartesian3.fromDegrees(record.lng, record.lat, record.altitude ?? 0),
      point: {
        pixelSize: layerId === "maritime" ? 7 : 8,
        color,
        outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: record.label,
        font: '11px "Share Tech Mono"',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(4,10,18,0.68)"),
        pixelOffset: new Cesium.Cartesian2(10, -8),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 0.76,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12000000)
      },
      properties: {
        layerId,
        label: record.label,
        description: `${record.source} live feed`,
        entityType,
        altitude: record.altitude ?? 0,
        synthetic: false
      }
    });
    entity._basePixelSize = layerId === "maritime" ? 7 : 8;
    entity._pulseSeed = Math.random() * Math.PI * 2;
    dynamic.liveTraffic.push(entity);
  });
}

async function refreshLiveFeeds() {
  state.liveFeeds = await fetchLiveFeeds();
  renderFeedStatus();
  clearLiveTraffic();
  if (state.liveFeeds.adsb.status === "live") {
    addLiveTrafficEntities(state.liveFeeds.adsb.records, "commercial", Cesium.Color.fromCssColorString("#90f4ff"), "live-adsb");
  }
  if (state.liveFeeds.ais.status === "live") {
    addLiveTrafficEntities(state.liveFeeds.ais.records, "maritime", Cesium.Color.fromCssColorString("#7bffcb"), "live-ais");
  }
  refreshEntityVisibility();
  updateScene(viewer.clock.currentTime);
}

function updateAmbientEffects() {
  const phase = performance.now() / 700;
  dynamic.traffic.forEach(entity => {
    if (!entity.show || !entity.point) {
      return;
    }
    const layerId = entity.properties.layerId.getValue(viewer.clock.currentTime);
    const pulseRange = layerId === "military" ? 1.8 : layerId === "commercial" ? 0.9 : layerId === "satellites" ? 0.6 : 0.7;
    entity.point.pixelSize = entity._basePixelSize + Math.max(0, Math.sin(phase + entity._pulseSeed)) * pulseRange;
  });

  dynamic.liveTraffic.forEach(entity => {
    if (!entity.show || !entity.point) {
      return;
    }
    entity.point.pixelSize = entity._basePixelSize + Math.max(0, Math.sin(phase * 1.15 + entity._pulseSeed)) * 1.6;
  });

  dynamic.incidents.forEach(({ entity }) => {
    if (!entity.show || !entity.billboard) {
      return;
    }
    entity.billboard.scale = 0.9 + (Math.sin(phase * 1.6 + entity._pulseSeed) + 1) * 0.08;
  });

  dynamic.zones.forEach(({ entity }) => {
    if (!entity.show) {
      return;
    }
    const alpha = entity._baseFill + (Math.sin(phase + entity._pulseSeed) + 1) * 0.02;
    if (entity.rectangle) {
      entity.rectangle.material = entity._zoneColor.withAlpha(alpha);
    }
    if (entity.polygon) {
      entity.polygon.material = entity._zoneColor.withAlpha(alpha);
    }
  });

  dynamic.rings.forEach(({ entity }) => {
    if (!entity.show || !entity.ellipse) {
      return;
    }
    const pulse = (Math.sin(phase + entity._pulseSeed) + 1) / 2;
    entity.ellipse.semiMajorAxis = 160000 + pulse * 90000;
    entity.ellipse.semiMinorAxis = 160000 + pulse * 90000;
    entity.ellipse.material = Cesium.Color.fromCssColorString("#ff6d8d").withAlpha(0.05 + pulse * 0.08);
  });
}

function renderEventRail() {
  elements.eventRail.innerHTML = "";
  SCENARIO.events.forEach(event => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "event-item";
    button.dataset.eventId = event.id;
    button.innerHTML = `
      <span class="event-minute">${formatMinute(event.minute)}</span>
      <span class="event-title">${event.title}</span>
      <span class="event-summary">${event.summary}</span>
    `;
    button.addEventListener("click", () => {
      jumpToMinute(event.minute);
      viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(event.location.lng, event.location.lat, 2600000) });
    });
    elements.eventRail.appendChild(button);
  });
}

function registerEvents() {
  elements.playToggle.addEventListener("click", () => {
    viewer.clock.shouldAnimate = true;
  });
  elements.pauseToggle.addEventListener("click", () => {
    viewer.clock.shouldAnimate = false;
  });
  elements.resetToggle.addEventListener("click", () => {
    viewer.clock.shouldAnimate = false;
    jumpToMinute(0);
    viewer.camera.flyTo({ destination: homeView, duration: 1.2 });
  });
  elements.timelineSlider.addEventListener("input", event => {
    viewer.clock.shouldAnimate = false;
    jumpToMinute(Number(event.target.value));
  });
  elements.replaySpeed.addEventListener("input", event => {
    state.replaySpeed = Number(event.target.value);
    viewer.clock.multiplier = 60 * state.replaySpeed;
    elements.replaySpeedValue.textContent = `${state.replaySpeed}×`;
  });
  elements.fxIntensity.addEventListener("input", event => {
    state.fxIntensity = Number(event.target.value);
    applyFxIntensity();
  });
  elements.fxGlow.addEventListener("input", event => {
    state.fxGlow = Number(event.target.value);
    applyGlow();
  });
  elements.saveBookmark.addEventListener("click", saveCurrentBookmark);
  elements.clearBookmarks.addEventListener("click", () => {
    state.bookmarks = [];
    saveJson(STORAGE_KEYS.bookmarks, state.bookmarks);
    renderBookmarks();
  });
  elements.refreshFeeds.addEventListener("click", () => {
    refreshLiveFeeds();
  });
  elements.closeIntelSheet.addEventListener("click", closeIntelSheet);
  elements.mobileBackdrop.addEventListener("click", () => {
    setMobileDrawer(null);
    closeIntelSheet();
  });
  elements.btnMobileLayers.addEventListener("click", () => setMobileDrawer("layers"));
  elements.btnMobileControls.addEventListener("click", () => setMobileDrawer("controls"));
  elements.btnMobileIntel.addEventListener("click", () => {
    if (!state.selectedEntity) {
      return;
    }
    openIntelSheet(state.selectedEntity);
  });
  elements.trackSelected.addEventListener("click", () => {
    if (state.selectedEntity) {
      viewer.trackedEntity = state.selectedEntity;
      state.trackedEntity = state.selectedEntity;
      updateTrackButtons();
    }
  });
  elements.releaseTrack.addEventListener("click", () => {
    viewer.trackedEntity = undefined;
    state.trackedEntity = null;
    updateTrackButtons();
  });
  elements.searchButton.addEventListener("click", () => runSearch(elements.searchInput.value));
  elements.searchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      runSearch(elements.searchInput.value);
    }
  });
  elements.btnHome.addEventListener("click", () => {
    viewer.camera.flyTo({ destination: homeView, duration: 1.6 });
  });
  elements.btnTilt.addEventListener("click", () => {
    state.tiltMode = !state.tiltMode;
    elements.btnTilt.classList.toggle("active", state.tiltMode);
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: {
        heading: viewer.camera.heading,
        pitch: state.tiltMode ? Cesium.Math.toRadians(-38) : Cesium.Math.toRadians(-90),
        roll: 0
      },
      duration: 0.8
    });
  });
  elements.btnSpin.addEventListener("click", () => {
    state.spinning = !state.spinning;
    elements.btnSpin.classList.toggle("active", state.spinning);
  });

  viewer.clock.onTick.addEventListener(clock => {
    if (state.spinning && performance.now() >= state.spinPausedUntil && !state.trackedEntity) {
      viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, Cesium.Math.toRadians(0.06));
    }
    updateScene(clock.currentTime);
  });

  viewer.scene.postRender.addEventListener(() => {
    const camera = viewer.camera;
    const cartographic = Cesium.Cartographic.fromCartesian(camera.positionWC);
    if (cartographic) {
      elements.hudCamera.textContent = `ALT ${(cartographic.height / 1000).toFixed(0)} km · HEADING ${Cesium.Math.toDegrees(camera.heading).toFixed(0)}°`;
    }
  });

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(click => {
    const picked = viewer.scene.pick(click.position);
    pausePassiveSpin(5500);
    const cartesian = clickedCartesian(click.position, picked);
    focusCameraOnCartesian(cartesian);
    if (Cesium.defined(picked) && picked.id) {
      state.selectedEntity = picked.id;
      updateSelectedEntityCard(picked.id);
      showHoverTooltip(picked.id, click.position);
      openIntelSheet(picked.id);
      setMobileDrawer(null);
    } else {
      state.selectedEntity = null;
      updateSelectedEntityCard(null);
      hideHoverTooltip();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction(() => {
    pausePassiveSpin(6500);
  }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

  handler.setInputAction(() => {
    pausePassiveSpin(6500);
  }, Cesium.ScreenSpaceEventType.WHEEL);

  handler.setInputAction(movement => {
    const picked = viewer.scene.pick(movement.endPosition);
    if (Cesium.defined(picked) && picked.id) {
      state.hoveredEntity = picked.id;
      showHoverTooltip(picked.id, movement.endPosition);
    } else {
      state.hoveredEntity = null;
      hideHoverTooltip();
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  window.addEventListener("resize", () => {
    viewer.resize();
    if (window.innerWidth > 980) {
      setMobileDrawer(null);
    }
  });
}

function updateScene(currentTime) {
  const minute = currentMinute(currentTime);
  elements.timelineSlider.value = String(Math.round(minute));
  elements.summaryTime.textContent = formatMinute(minute);
  const activeEvent = latestEvent(minute);
  elements.summaryStage.textContent = activeEvent.title;
  elements.summaryCopy.textContent = activeEvent.summary;
  renderSummaryTags(activeEvent.tags);
  updateTimelineMarkers(minute);
  updateEventRail(minute);
  updateZones(minute);
  updateIncidents(minute);
  updateLiveMetrics(minute);
  updateFps();
  updateAmbientEffects();
  updateSelectedEntityCard(state.selectedEntity);
}

function latestEvent(minute) {
  return SCENARIO.events.reduce((current, event) => (event.minute <= minute ? event : current), SCENARIO.events[0]);
}

function renderSummaryTags(tags = []) {
  const activeLayers = LAYERS.filter(layer => state.layers[layer.id]).map(layer => layer.label);
  const allTags = [...tags, ...activeLayers.slice(0, 3)];
  elements.summaryTags.innerHTML = allTags.map(tag => `<span class="summary-tag">${tag}</span>`).join("");
}

function updateTimelineMarkers(minute) {
  const markers = [...elements.timelineMarkers.children];
  markers.forEach((marker, index) => {
    marker.classList.toggle("active", SCENARIO.events[index].minute <= minute);
  });
}

function updateEventRail(minute) {
  [...elements.eventRail.children].forEach((item, index) => {
    item.classList.toggle("active", latestEvent(minute).id === SCENARIO.events[index].id);
  });
}

function updateZones(minute) {
  dynamic.zones.forEach(({ entity, zone }) => {
    entity.show = !!state.layers.zones && minute >= zone.start && minute <= zone.end;
  });
}

function updateIncidents(minute) {
  dynamic.incidents.forEach(({ entity, incident }) => {
    entity.show = !!state.layers.incidents && minute >= incident.start && minute <= incident.end;
  });
  dynamic.rings.forEach(({ entity, incident }) => {
    entity.show = !!state.layers.incidents && minute >= incident.start && minute <= incident.end;
  });
  dynamic.traffic.forEach(entity => {
    const layerId = entity.properties.layerId.getValue();
    entity.show = !!state.layers[layerId];
  });
}

function updateSelectedEntityCard(entity) {
  if (!entity) {
    elements.entityInfo.classList.add("empty");
    elements.entityInfo.innerHTML = "Select a track, satellite, ship, event, or zone on the globe.";
    updateTrackButtons();
    return;
  }
  elements.entityInfo.classList.remove("empty");
  const { label, description, type, locationMeta, altitude, synthetic } = getEntityInfo(entity);
  elements.entityInfo.innerHTML = `
    <strong>${label}</strong>
    <div>${description}</div>
    <div class="entity-meta">
      <span>${type.toUpperCase()}</span>
      <span>${locationMeta}</span>
    </div>
    <div class="entity-stats">
      <span>ALT ${Math.round(altitude).toLocaleString()} m</span>
      <span>${synthetic ? "AUX MODEL" : "PRIMARY TRACK"}</span>
      <span>${viewer.clock.shouldAnimate ? "REPLAY RUNNING" : "REPLAY PAUSED"}</span>
    </div>
  `;
  elements.entityInfo.onclick = () => openIntelSheet(entity);
  updateTrackButtons();
}

function updateTrackButtons() {
  const canTrack = !!state.selectedEntity && !!state.selectedEntity.position;
  elements.trackSelected.disabled = !canTrack;
  elements.releaseTrack.disabled = !state.trackedEntity;
}

function saveCurrentBookmark() {
  const cartographic = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
  const next = {
    id: `bookmark-${Date.now()}`,
    label: `View ${state.bookmarks.length + 1}`,
    destination: {
      lng: Cesium.Math.toDegrees(cartographic.longitude),
      lat: Cesium.Math.toDegrees(cartographic.latitude),
      height: cartographic.height,
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
      roll: viewer.camera.roll
    }
  };
  state.bookmarks = [...state.bookmarks, next].slice(-8);
  saveJson(STORAGE_KEYS.bookmarks, state.bookmarks);
  renderBookmarks();
}

function removeBookmark(bookmarkId) {
  state.bookmarks = state.bookmarks.filter(bookmark => bookmark.id !== bookmarkId);
  saveJson(STORAGE_KEYS.bookmarks, state.bookmarks);
  renderBookmarks();
}

function flyToBookmark(bookmark) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(bookmark.destination.lng, bookmark.destination.lat, bookmark.destination.height),
    orientation: {
      heading: bookmark.destination.heading,
      pitch: bookmark.destination.pitch,
      roll: bookmark.destination.roll
    },
    duration: 1.2
  });
}

function applyFxMode(mode) {
  document.body.dataset.fxMode = mode;
  postStages.blackAndWhite.enabled = mode === "nightvision" || mode === "thermal";
  postStages.blackAndWhite.uniforms.gradations = mode === "thermal" ? 8 : 14;
  postStages.brightness.enabled = mode !== "normal";
  postStages.brightness.uniforms.brightness = mode === "nightvision" ? 0.08 : mode === "thermal" ? 0.15 : mode === "crt" ? 0.05 : 0;
}

function applyFxIntensity() {
  elements.fxIntensityValue.textContent = String(state.fxIntensity);
  document.documentElement.style.setProperty("--fx-intensity", String(state.fxIntensity / 100));
}

function applyGlow() {
  elements.fxGlowValue.textContent = String(state.fxGlow);
  if (!bloomStage) {
    return;
  }
  bloomStage.uniforms.glowOnly = false;
  bloomStage.uniforms.contrast = 128 - state.fxGlow * 0.4;
  bloomStage.uniforms.brightness = -0.15 + state.fxGlow / 300;
  bloomStage.uniforms.delta = 1 + state.fxGlow / 60;
  bloomStage.uniforms.sigma = 2 + state.fxGlow / 24;
  bloomStage.uniforms.stepSize = 3 + state.fxGlow / 35;
}

function jumpToMinute(minute) {
  viewer.clock.currentTime = minuteToTime(clamp(minute, 0, SCENARIO.durationMinutes));
  updateScene(viewer.clock.currentTime);
  viewer.scene.requestRender();
}

async function runSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    elements.searchResults.classList.add("hidden");
    return;
  }
  if (state.searchAbortController) {
    state.searchAbortController.abort();
  }
  state.searchAbortController = new AbortController();
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(trimmed)}`, {
      signal: state.searchAbortController.signal,
      headers: {
        Accept: "application/json"
      }
    });
    const results = await response.json();
    renderSearchResults(results);
  } catch {
    elements.searchResults.classList.add("hidden");
  }
}

function renderSearchResults(results) {
  if (!results.length) {
    elements.searchResults.classList.add("hidden");
    return;
  }
  elements.searchResults.innerHTML = "";
  results.forEach(result => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    button.innerHTML = `<strong>${result.display_name.split(",")[0]}</strong><span>${result.display_name}</span>`;
    button.addEventListener("click", () => {
      elements.searchResults.classList.add("hidden");
      elements.searchInput.value = result.display_name;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(Number(result.lon), Number(result.lat), 1800000),
        duration: 1.6
      });
    });
    elements.searchResults.appendChild(button);
  });
  elements.searchResults.classList.remove("hidden");
}

function startHudClock() {
  window.setInterval(() => {
    const now = new Date();
    elements.hudUtc.textContent = `UTC ${now.toUTCString().slice(17, 25)}`;
    elements.hudLocal.textContent = `LOCAL ${now.toLocaleTimeString([], { hour12: false })}`;
  }, 250);
}

function updateFps() {
  const now = performance.now();
  frameSamples.push(now);
  frameSamples = frameSamples.filter(sample => now - sample < 1000);
  elements.hudFps.textContent = `${frameSamples.length} FPS`;
}
