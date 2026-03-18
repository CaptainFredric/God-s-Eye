import * as Cesium from "cesium";
import "./styles/index.css";
import { BASEMAPS, DEFAULT_BOOKMARKS, FX_MODES, LAYERS, SCENARIO, STORAGE_KEYS } from "./data/scenario.js";

const replayStart = Cesium.JulianDate.fromDate(new Date(Date.UTC(2026, 2, 17, 0, 0, 0)));
const replayStop = Cesium.JulianDate.addMinutes(replayStart, SCENARIO.durationMinutes, new Cesium.JulianDate());

const state = {
  selectedEntity: null,
  trackedEntity: null,
  spinning: false,
  tiltMode: false,
  searchAbortController: null,
  basemapId: loadJson(STORAGE_KEYS.basemap, BASEMAPS[0].id),
  fxMode: loadJson(STORAGE_KEYS.fxMode, FX_MODES[0].id),
  bookmarks: loadJson(STORAGE_KEYS.bookmarks, DEFAULT_BOOKMARKS),
  layers: loadJson(STORAGE_KEYS.layers, Object.fromEntries(LAYERS.map(layer => [layer.id, layer.enabled]))),
  replaySpeed: 8,
  fxIntensity: 58,
  fxGlow: 30
};

const elements = {};
const dynamic = {
  trails: [],
  zones: [],
  incidents: [],
  traffic: []
};

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
viewer.clock.shouldAnimate = false;
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
registerEvents();
updateScene(viewer.clock.currentTime);
startHudClock();
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
    hudUtc: document.getElementById("hud-utc"),
    hudLocal: document.getElementById("hud-local"),
    hudFps: document.getElementById("hud-fps"),
    hudCamera: document.getElementById("hud-camera"),
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
    { label: "Flights", value: `${SCENARIO.flights.commercial.length + SCENARIO.flights.military.length}`, foot: "Global traffic" },
    { label: "Satellites", value: `${SCENARIO.satellites.length}`, foot: "Orbital tracks" },
    { label: "Ships", value: `${SCENARIO.maritime.length}`, foot: "Maritime routes" },
    { label: "Events", value: `${SCENARIO.events.length}`, foot: "Replay chapters" }
  ];
  elements.metricCluster.innerHTML = metrics.map(metric => `
    <article class="metric-card">
      <span class="metric-label">${metric.label}</span>
      <strong class="metric-value">${metric.value}</strong>
      <span class="metric-foot">${metric.foot}</span>
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
  createTrafficEntities(SCENARIO.flights.commercial, "commercial", Cesium.Color.fromCssColorString("#7ee0ff"), 55 * 60);
  createTrafficEntities(SCENARIO.flights.military, "military", Cesium.Color.fromCssColorString("#ffbe5c"), 80 * 60);
  createTrafficEntities(SCENARIO.satellites, "satellites", Cesium.Color.fromCssColorString("#af9dff"), 120 * 60, 8);
  createTrafficEntities(SCENARIO.maritime, "maritime", Cesium.Color.fromCssColorString("#60f7bf"), 120 * 60, 7);
  createZones();
  createIncidents();
  renderEventRail();
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
      label: {
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
        altitude: item.altitude ?? 0
      }
    });
    dynamic.traffic.push(entity);
  });
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
    dynamic.incidents.push({ entity, incident });
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
    if (state.spinning && !state.trackedEntity) {
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
    if (Cesium.defined(picked) && picked.id) {
      state.selectedEntity = picked.id;
      updateSelectedEntityCard(picked.id);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  window.addEventListener("resize", () => viewer.resize());
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
  updateFps();
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
  dynamic.traffic.forEach(entity => {
    const layerId = entity.properties.layerId.getValue();
    entity.show = !!state.layers[layerId];
  });
}

function updateSelectedEntityCard(entity) {
  if (!entity) {
    elements.entityInfo.classList.add("empty");
    elements.entityInfo.innerHTML = "Select a flight, satellite, ship, event, or zone on the globe.";
    updateTrackButtons();
    return;
  }
  elements.entityInfo.classList.remove("empty");
  const props = entity.properties;
  const label = props?.label?.getValue?.() ?? entity.id;
  const description = props?.description?.getValue?.() ?? "";
  const type = props?.entityType?.getValue?.() ?? "unknown";
  const position = entity.position?.getValue?.(viewer.clock.currentTime);
  let locationMeta = "Static overlay";
  if (position) {
    const cartographic = Cesium.Cartographic.fromCartesian(position);
    locationMeta = `${Cesium.Math.toDegrees(cartographic.latitude).toFixed(2)}°, ${Cesium.Math.toDegrees(cartographic.longitude).toFixed(2)}°`;
  }
  elements.entityInfo.innerHTML = `
    <strong>${label}</strong>
    <div>${description}</div>
    <div class="entity-meta">
      <span>${type.toUpperCase()}</span>
      <span>${locationMeta}</span>
    </div>
  `;
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

let frameSamples = [];
function updateFps() {
  const now = performance.now();
  frameSamples.push(now);
  frameSamples = frameSamples.filter(sample => now - sample < 1000);
  elements.hudFps.textContent = `${frameSamples.length} FPS`;
}
