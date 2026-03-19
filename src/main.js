import { BASEMAPS, DEFAULT_BOOKMARKS, FX_MODES, LAYERS, SCENARIO, STORAGE_KEYS } from "./data/scenario.js";
import { fetchLiveFeeds, fetchAisFeed, getConfiguredAisEndpoint, setConfiguredAisEndpoint } from "./services/live-feeds.js";
import { NEWS_CATEGORIES, fetchNewsCategory, fetchAllNewsCategories, invalidateNewsCache } from "./services/news-feeds.js";

const Cesium = await loadCesium();

function normalizeCesiumModule(module) {
  if (module?.Viewer) return module;
  if (module?.default?.Viewer) return module.default;
  return module?.default ?? module;
}

async function loadCesium() {
  if (globalThis.Cesium?.Viewer) return globalThis.Cesium;
  return normalizeCesiumModule(await import("cesium"));
}

const UI_STORAGE_KEYS = {
  declutter: "panopticon-earth-declutter",
  compact:   "panopticon-earth-compact"
};

const state = {
  selectedEntity:        null,
  trackedEntity:         null,
  hoveredEntity:         null,
  spinning:              true,
  spinPausedUntil:       0,
  activeDrawer:          null,
  intelSheetOpen:        false,
  declutter:             loadJson(UI_STORAGE_KEYS.declutter, false),
  compact:               loadJson(UI_STORAGE_KEYS.compact, false),
  tiltMode:              false,
  regionFocus:           null,
  searchAbortController: null,
  searchDebounceTimer:   null,
  searchCursorIndex:     -1,
  searchFlatResults:     [],
  alertNarrativeIndexes: Object.create(null),
  incidentNarrativeIndexes: Object.create(null),
  narrativeTimer:        null,
  newsOpen:              false,
  newsCategory:          "war",
  newsArticles:          [],
  newsTickerPool:        [],
  newsTickerIndex:       0,
  newsLastFetched:       null,
  newsRefreshTimer:      null,
  newsTickerTimer:       null,
  newsTickerPaused:      false,
  newsCategoryTimer:     null,
  newsPanelHovering:     false,
  newsCategoryPaused:    false,
  locationHudVisible:    false,
  locationLastGeocode:   0,
  locationLastLng:       null,
  locationLastLat:       null,
  locationGeocodeTimer:  null,
  basemapId:             loadJson(STORAGE_KEYS.basemap, BASEMAPS[0].id),
  fxMode:                loadJson(STORAGE_KEYS.fxMode, FX_MODES[0].id),
  bookmarks:             loadJson(STORAGE_KEYS.bookmarks, DEFAULT_BOOKMARKS),
  layers:                loadJson(STORAGE_KEYS.layers, Object.fromEntries(LAYERS.map(l => [l.id, l.enabled]))),
  refreshIntervalSec:    90,
  fxIntensity:           58,
  fxGlow:                30,
  refreshTimer:          null,
  nextRefreshAt:         null,
  liveFeeds: {
    adsb: { status: "idle", source: "OpenSky ADS-B",  message: "Awaiting refresh", records: [], updatedAt: null },
    ais:  {
      status:  getConfiguredAisEndpoint() ? "idle" : "config-required",
      source:  "AIS Adapter",
      message: getConfiguredAisEndpoint() ? "Awaiting refresh" : "Configure a CORS-safe AIS endpoint",
      records: [], updatedAt: null
    }
  }
};

const elements = {};
const dynamic = {
  trails:      [],
  zones:       [],
  incidents:   [],
  traffic:     [],
  rings:       [],
  radars:      [],
  liveTraffic: []
};

let frameSamples = [];

const viewer = new Cesium.Viewer("cesiumContainer", {
  animation:            false,
  timeline:             false,
  baseLayerPicker:      false,
  geocoder:             false,
  homeButton:           false,
  sceneModePicker:      false,
  navigationHelpButton: false,
  fullscreenButton:     false,
  infoBox:              false,
  selectionIndicator:   false,
  requestRenderMode:    false,
  shouldAnimate:        false,
  terrain:              undefined
});

const postStages = {
  blackAndWhite: Cesium.PostProcessStageLibrary.createBlackAndWhiteStage(),
  brightness:    Cesium.PostProcessStageLibrary.createBrightnessStage()
};
const bloomStage = viewer.scene.postProcessStages.bloom;
viewer.scene.postProcessStages.add(postStages.blackAndWhite);
viewer.scene.postProcessStages.add(postStages.brightness);
viewer.scene.postProcessStages.fxaa.enabled = true;
if (bloomStage) {
  bloomStage.enabled = true;
  bloomStage.uniforms.glowOnly = false;
}
viewer.scene.globe.enableLighting          = true;
viewer.scene.skyAtmosphere.show            = true;
viewer.scene.globe.depthTestAgainstTerrain = false;
viewer.clock.shouldAnimate                 = false;
viewer.resolutionScale                     = Math.min(window.devicePixelRatio || 1, 1.6);

const homeView = Cesium.Cartesian3.fromDegrees(
  SCENARIO.initialView.lng,
  SCENARIO.initialView.lat,
  SCENARIO.initialView.height
);
viewer.camera.setView({
  destination: homeView,
  orientation: {
    heading: SCENARIO.initialView.heading,
    pitch:   SCENARIO.initialView.pitch,
    roll:    SCENARIO.initialView.roll
  }
});

cacheElements();
startBootIntro();
initializeNarrativeState();
applyFxMode(state.fxMode);
applyFxIntensity();
applyGlow();
applyDeclutterMode();
applyDensityMode();
renderMetricCluster();
renderBasemapButtons();
renderLayerToggles();
renderLegend();
renderBookmarks();
renderFxButtons();
installBasemap(state.basemapId);
seedScene();
renderFeedStatus();
renderTrustIndicators();
registerEvents();
elements.btnSpin.classList.toggle("active", state.spinning);
startHudClock();
startWallClock();
renderEventRail();
startNarrativeTicker();
scheduleRefresh();
refreshLiveFeeds();
initNewsPanel();
startLocationHud();
initDraggablePanels();
initPingCanvas();
initCinematicUi();
viewer.scene.requestRender();

function initializeNarrativeState() {
  SCENARIO.alerts.forEach(alert => {
    state.alertNarrativeIndexes[alert.id] = 0;
  });
  SCENARIO.incidents.forEach(incident => {
    state.incidentNarrativeIndexes[incident.id] = 0;
  });
}

function getRotatingNarrative(item, indexMap, textKey) {
  const updates = Array.isArray(item?.updates) ? item.updates : [];
  const fallback = {
    title: item?.title,
    [textKey]: item?.[textKey],
    sourceLabel: item?.sourceLabel,
    sourceUrl: item?.sourceUrl,
    publishedAt: "Live rolling brief"
  };
  if (!updates.length) return fallback;
  const index = indexMap[item.id] ?? 0;
  const active = updates[index] ?? updates[0];
  return {
    title: active.title ?? fallback.title,
    [textKey]: active[textKey] ?? fallback[textKey],
    sourceLabel: active.sourceLabel ?? fallback.sourceLabel,
    sourceUrl: active.sourceUrl ?? fallback.sourceUrl,
    publishedAt: active.publishedAt ?? fallback.publishedAt
  };
}

function getActiveAlertNarrative(alert) {
  return getRotatingNarrative(alert, state.alertNarrativeIndexes, "summary");
}

function getActiveIncidentNarrative(incident) {
  return getRotatingNarrative(incident, state.incidentNarrativeIndexes, "description");
}

function findScenarioIncidentById(incidentId) {
  return SCENARIO.incidents.find(incident => incident.id === incidentId) ?? null;
}

function tickNarratives() {
  SCENARIO.alerts.forEach(alert => {
    const updateCount = Array.isArray(alert.updates) ? alert.updates.length : 0;
    if (!updateCount) return;
    state.alertNarrativeIndexes[alert.id] = ((state.alertNarrativeIndexes[alert.id] ?? 0) + 1) % updateCount;
  });

  SCENARIO.incidents.forEach(incident => {
    const updateCount = Array.isArray(incident.updates) ? incident.updates.length : 0;
    if (!updateCount) return;
    state.incidentNarrativeIndexes[incident.id] = ((state.incidentNarrativeIndexes[incident.id] ?? 0) + 1) % updateCount;
  });

  renderEventRail(true);

  const selectedType = state.selectedEntity?.properties?.entityType?.getValue?.(viewer.clock.currentTime);
  if (selectedType === "incident") {
    updateSelectedEntityCard(state.selectedEntity);
    if (state.intelSheetOpen) openIntelSheet(state.selectedEntity);
  }
}

function startNarrativeTicker() {
  if (state.narrativeTimer) window.clearInterval(state.narrativeTimer);
  state.narrativeTimer = window.setInterval(() => {
    tickNarratives();
  }, 12000);
}

function cacheElements() {
  Object.assign(elements, {
    metricCluster:       document.getElementById("metric-cluster"),
    basemapButtons:      document.getElementById("basemap-buttons"),
    layerToggles:        document.getElementById("layer-toggles"),
    bookmarkList:        document.getElementById("bookmark-list"),
    saveBookmark:        document.getElementById("save-bookmark"),
    clearBookmarks:      document.getElementById("clear-bookmarks"),
    fxModeButtons:       document.getElementById("fx-mode-buttons"),
    fxIntensity:         document.getElementById("fx-intensity"),
    fxIntensityValue:    document.getElementById("fx-intensity-value"),
    fxGlow:              document.getElementById("fx-glow"),
    fxGlowValue:         document.getElementById("fx-glow-value"),
    refreshInterval:     document.getElementById("refresh-interval"),
    refreshIntervalVal:  document.getElementById("refresh-interval-value"),
    entityInfo:          document.getElementById("entity-info"),
    trackSelected:       document.getElementById("track-selected"),
    releaseTrack:        document.getElementById("release-track"),
    eventRail:           document.getElementById("event-rail"),
    summaryStage:        document.getElementById("summary-stage"),
    summaryTime:         document.getElementById("summary-time"),
    summaryCopy:         document.getElementById("summary-copy"),
    summaryTags:         document.getElementById("summary-tags"),
    hudStatusMode:       document.getElementById("hud-status-mode"),
    hudTrackCount:       document.getElementById("hud-track-count"),
    hudAlertCount:       document.getElementById("hud-alert-count"),
    liveRegionLabel:     document.getElementById("live-region-label"),
    liveLastRefresh:     document.getElementById("live-last-refresh"),
    liveNextRefresh:     document.getElementById("live-next-refresh"),
    refreshNow:          document.getElementById("refresh-now"),
    btnFullscreen:       document.getElementById("btn-fullscreen"),
    searchInput:         document.getElementById("search-input"),
    searchButton:        document.getElementById("search-btn"),
    searchResults:       document.getElementById("search-results"),
    searchMeta:          document.getElementById("search-meta"),
    legendItems:         document.getElementById("legend-items"),
    legendUpdated:       document.getElementById("legend-updated"),
    trustIndicators:     document.getElementById("trust-indicators"),
    trustSummary:        document.getElementById("trust-summary"),
    hoverTooltip:        document.getElementById("hover-tooltip"),
    mobileDrawers:       document.getElementById("mobile-drawers"),
    mobileBackdrop:      document.getElementById("mobile-backdrop"),
    btnMobileLayers:     document.getElementById("btn-mobile-layers"),
    btnMobileControls:   document.getElementById("btn-mobile-controls"),
    btnMobileIntel:      document.getElementById("btn-mobile-intel"),
    feedStatus:          document.getElementById("feed-status"),
    refreshFeeds:        document.getElementById("refresh-feeds"),
    aisEndpoint:         document.getElementById("ais-endpoint"),
    saveAisEndpoint:     document.getElementById("save-ais-endpoint"),
    clearAisEndpoint:    document.getElementById("clear-ais-endpoint"),
    testAisEndpoint:     document.getElementById("test-ais-endpoint"),
    feedHint:            document.getElementById("feed-hint"),
    intelSheet:          document.getElementById("intel-sheet"),
    closeIntelSheet:     document.getElementById("close-intel-sheet"),
    intelSheetKicker:    document.getElementById("intel-sheet-kicker"),
    intelSheetTitle:     document.getElementById("intel-sheet-title"),
    intelSheetOverview:  document.getElementById("intel-sheet-overview"),
    intelSheetTelemetry: document.getElementById("intel-sheet-telemetry"),
    intelSheetAssessment:document.getElementById("intel-sheet-assessment"),
    intelSheetTimeline:  document.getElementById("intel-sheet-timeline"),
    hudUtc:              document.getElementById("hud-utc"),
    hudLocal:            document.getElementById("hud-local"),
    hudFps:              document.getElementById("hud-fps"),
    hudCamera:           document.getElementById("hud-camera"),
    hudStatusText:       document.getElementById("hud-status-text"),
    btnDeclutter:        document.getElementById("btn-declutter"),
    btnDensity:          document.getElementById("btn-density"),
    btnHome:             document.getElementById("btn-home"),
    btnTilt:             document.getElementById("btn-tilt"),
    btnSpin:             document.getElementById("btn-spin"),
    locationHud:         document.getElementById("location-hud"),
    locLabel:            document.getElementById("loc-label"),
    locDetail:           document.getElementById("loc-detail"),
    locCoords:           document.getElementById("loc-coords"),
    locMeta:             document.getElementById("loc-meta"),
    bootOverlay:         document.getElementById("boot-overlay"),
    bootProgressFill:    document.getElementById("boot-progress-fill"),
    bootStatus:          document.getElementById("boot-status"),
    consoleFrame:        document.querySelector(".console-frame"),
    pingCanvas:          document.getElementById("ping-canvas"),
    clickLocPopup:       document.getElementById("click-location-popup"),
    clpClose:            document.getElementById("clp-close"),
    clpFlag:             document.getElementById("clp-flag"),
    clpCountry:          document.getElementById("clp-country"),
    clpRegion:           document.getElementById("clp-region"),
    clpCoordsPopup:      document.getElementById("clp-coords-popup"),
    clpLoading:          document.getElementById("clp-loading"),
    clickConflictBox:    document.getElementById("click-conflict-box"),
    ccbClose:            document.getElementById("ccb-close"),
    ccbTitle:            document.getElementById("ccb-title"),
    ccbList:             document.getElementById("ccb-list"),
    liveNewsHeadline:    document.getElementById("live-news-headline"),
    newsBriefing:        document.getElementById("news-briefing"),
    newsCards:           document.getElementById("news-cards"),
    newsCatNav:          document.getElementById("news-cat-nav"),
    newsUpdated:         document.getElementById("news-updated"),
    newsRefreshBtn:      document.getElementById("news-refresh"),
    newsCloseBtn:        document.getElementById("news-close"),
    newsToggleBtn:       document.getElementById("btn-news-toggle"),
    newsBadge:           document.getElementById("news-badge")
  });

  if (elements.fxIntensity)    elements.fxIntensity.value   = String(state.fxIntensity);
  if (elements.fxGlow)         elements.fxGlow.value        = String(state.fxGlow);
  if (elements.refreshInterval) elements.refreshInterval.value = String(state.refreshIntervalSec);
  if (elements.aisEndpoint)    elements.aisEndpoint.value   = getConfiguredAisEndpoint();
}

function loadJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveJson(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function nowJulian() {
  return Cesium.JulianDate.fromDate(new Date());
}

function startWallClock() {
  window.setInterval(() => {
    viewer.clock.currentTime = nowJulian();
    updateHudFrame();
    updateAmbientEffects();
    updateSelectedEntityCard(state.selectedEntity);
    updateLiveMetrics();
    updateZones();
    updateIncidents();
    if (state.spinning && performance.now() >= state.spinPausedUntil && !state.trackedEntity) {
      viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, Cesium.Math.toRadians(0.012));
    }
    viewer.scene.requestRender();
  }, 200);
}

function scheduleRefresh() {
  if (state.refreshTimer) window.clearInterval(state.refreshTimer);
  state.nextRefreshAt = Date.now() + state.refreshIntervalSec * 1000;
  updateRefreshCountdown();
  renderTrustIndicators();
  state.refreshTimer = window.setInterval(() => {
    state.nextRefreshAt = Date.now() + state.refreshIntervalSec * 1000;
    refreshLiveFeeds();
  }, state.refreshIntervalSec * 1000);
}

function renderMetricCluster() {
  const metrics = [
    { key: "tracks", label: "Tracks",  value: "\u2014", foot: "Live traffic" },
    { key: "alerts", label: "Alerts",  value: "\u2014", foot: "Active zones" },
    { key: "orbits", label: "Orbit",   value: "\u2014", foot: "Overhead passes" },
    { key: "feeds",  label: "Feeds",   value: "\u2014", foot: "Data sources live" }
  ];
  elements.metricCluster.innerHTML = metrics.map(m => `
    <article class="metric-card" data-metric="${m.key}">
      <span class="metric-label">${m.label}</span>
      <strong class="metric-value">${m.value}</strong>
      <span class="metric-foot">${m.foot}</span>
    </article>
  `).join("");
}

function updateMetricCard(key, value, foot) {
  const card = elements.metricCluster.querySelector(`[data-metric="${key}"]`);
  if (!card) return;
  const v = card.querySelector(".metric-value");
  const f = card.querySelector(".metric-foot");
  if (v) v.textContent = String(value);
  if (f) f.textContent = foot;
}

function renderFeedStatus() {
  if (!elements.feedStatus) return;
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

function renderTrustIndicators() {
  if (!elements.trustIndicators) return;

  const adsbStatus = state.liveFeeds.adsb.status === "live" ? "live" : state.liveFeeds.adsb.status === "error" ? "error" : "pending";
  const aisStatus = state.liveFeeds.ais.status === "live"
    ? "live"
    : state.liveFeeds.ais.status === "config-required"
      ? "config"
      : state.liveFeeds.ais.status === "error"
        ? "error"
        : "pending";
  const refreshStatus = state.nextRefreshAt ? "active" : "pending";

  const indicators = [
    { label: "ADS-B",     value: state.liveFeeds.adsb.status.toUpperCase(), status: adsbStatus },
    { label: "AIS",       value: state.liveFeeds.ais.status.toUpperCase(),  status: aisStatus },
    { label: "UTC Sync",  value: "LOCKED", status: "verified" },
    { label: "Refresh",   value: `${state.refreshIntervalSec}s`, status: refreshStatus }
  ];

  elements.trustIndicators.innerHTML = indicators.map(indicator =>
    `<span class="trust-pill ${indicator.status}">${indicator.label} · ${indicator.value}</span>`
  ).join("");

  if (!elements.trustSummary) return;
  const liveCount = [state.liveFeeds.adsb, state.liveFeeds.ais].filter(feed => feed.status === "live").length;
  const confidence = liveCount === 2 ? "High" : liveCount === 1 ? "Moderate" : "Limited";
  elements.trustSummary.textContent = `Source confidence: ${confidence}. Geospatial index and UTC sync are active.`;
}

function renderLegend() {
  if (!elements.legendItems) return;
  elements.legendItems.innerHTML = LAYERS.map(layer => {
    const active = !!state.layers[layer.id];
    return `
      <div class="legend-item ${active ? "" : "inactive"}">
        <span class="legend-swatch" style="background:${layer.color}"></span>
        <span>${layer.label}</span>
        <span class="legend-state">${active ? "ON" : "OFF"}</span>
      </div>
    `;
  }).join("");

  if (elements.legendUpdated) {
    elements.legendUpdated.textContent = `Layer key · ${new Date().toUTCString().slice(17, 25)} UTC`;
  }
}

function applyDeclutterMode() {
  document.body.classList.toggle("declutter-ui", state.declutter);
  if (elements.btnDeclutter) {
    elements.btnDeclutter.classList.toggle("active", state.declutter);
    elements.btnDeclutter.textContent = state.declutter ? "FOCUS ON" : "FOCUS";
  }
  saveJson(UI_STORAGE_KEYS.declutter, state.declutter);
}

function applyDensityMode() {
  document.body.classList.toggle("compact-ui", state.compact);
  if (elements.btnDensity) {
    elements.btnDensity.classList.toggle("active", state.compact);
    elements.btnDensity.textContent = state.compact ? "COMPACT ON" : "COMPACT";
  }
  saveJson(UI_STORAGE_KEYS.compact, state.compact);
}

function renderBasemapButtons() {
  elements.basemapButtons.innerHTML = "";
  BASEMAPS.forEach(basemap => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `basemap-btn${state.basemapId === basemap.id ? " active" : ""}`;
    btn.textContent = basemap.label;
    btn.addEventListener("click", () => installBasemap(basemap.id));
    elements.basemapButtons.appendChild(btn);
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
      renderLegend();
      refreshEntityVisibility();
    });
    elements.layerToggles.appendChild(row);
  });
}

function renderBookmarks() {
  elements.bookmarkList.innerHTML = "";
  state.bookmarks.forEach(bookmark => {
    const row = document.createElement("div");
    row.className = "bookmark-item";
    row.innerHTML = `<button type="button">${bookmark.label}</button><button type="button" data-remove="${bookmark.id}">\u2715</button>`;
    row.firstElementChild.addEventListener("click", () => flyToBookmark(bookmark));
    row.lastElementChild.addEventListener("click",  () => removeBookmark(bookmark.id));
    elements.bookmarkList.appendChild(row);
  });
}

function renderFxButtons() {
  elements.fxModeButtons.innerHTML = "";
  FX_MODES.forEach(mode => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `fx-btn${state.fxMode === mode.id ? " active" : ""}`;
    btn.textContent = mode.label;
    btn.addEventListener("click", () => {
      state.fxMode = mode.id;
      saveJson(STORAGE_KEYS.fxMode, state.fxMode);
      applyFxMode(mode.id);
      renderFxButtons();
    });
    elements.fxModeButtons.appendChild(btn);
  });
}

function renderEventRail(animate = false) {
  const existing = new Map(
    Array.from(elements.eventRail.querySelectorAll(".event-item")).map(button => [button.dataset.alertId, button])
  );

  SCENARIO.alerts.forEach(alert => {
    let btn = existing.get(alert.id);
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "event-item";
      btn.dataset.alertId = alert.id;
      btn.addEventListener("click", () => {
        const activeNarrative = getActiveAlertNarrative(alert);
        const activeTitle = activeNarrative.title ?? alert.title;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(alert.location.lng, alert.location.lat, 2600000),
          duration: 1.8,
          complete: () => applyRegionalContext(activeTitle, alert.location.lng, alert.location.lat)
        });
      });
      elements.eventRail.appendChild(btn);
    }

    const narrative = getActiveAlertNarrative(alert);
    const sourceText = narrative.publishedAt ? escapeHtml(narrative.publishedAt) : "Live rolling brief";
    const sourceLabel = narrative.sourceLabel ? escapeHtml(narrative.sourceLabel) : "Operational source";
    const sourceLink = narrative.sourceUrl
      ? `<a class="event-source-link" href="${escapeHtml(narrative.sourceUrl)}" target="_blank" rel="noopener noreferrer">${sourceLabel} ↗</a>`
      : `<span class="event-source-label">${sourceLabel}</span>`;

    btn.innerHTML = `
      <span class="event-minute">${escapeHtml(alert.region)}</span>
      <span class="event-title">${escapeHtml(narrative.title ?? alert.title)}</span>
      <span class="event-summary">${escapeHtml(narrative.summary ?? alert.summary)}</span>
      <span class="event-source-row">
        <span class="event-source-time">${sourceText}</span>
        ${sourceLink}
      </span>
    `;

    btn.querySelectorAll(".event-source-link").forEach(link => {
      link.addEventListener("click", event => event.stopPropagation());
    });

    if (animate) {
      btn.classList.remove("updating");
      void btn.offsetWidth;
      btn.classList.add("updating");
    }
  });
}

function minuteToRealJulian(offsetMinutes) {
  return Cesium.JulianDate.addMinutes(nowJulian(), offsetMinutes - SCENARIO.durationMinutes / 2, new Cesium.JulianDate());
}

function seedScene() {
  const commercial = [...SCENARIO.flights.commercial, ...generateVariants(SCENARIO.flights.commercial, "COM", 1, 0.9, 0.5)];
  const military   = [...SCENARIO.flights.military,   ...generateVariants(SCENARIO.flights.military,   "MIL", 1, 0.45, 0.28)];
  const maritime   = [...SCENARIO.maritime,            ...generateVariants(SCENARIO.maritime,           "SEA", 1, 0.35, 0.22)];
  createTrafficEntities(commercial,          "commercial", Cesium.Color.fromCssColorString("#7ee0ff"), 3600 * 8);
  createTrafficEntities(military,            "military",   Cesium.Color.fromCssColorString("#ffbe5c"), 3600 * 12, 9);
  createTrafficEntities(SCENARIO.satellites, "satellites", Cesium.Color.fromCssColorString("#af9dff"), 3600 * 24, 8);
  createTrafficEntities(maritime,            "maritime",   Cesium.Color.fromCssColorString("#60f7bf"), 3600 * 24, 7);
  createZones();
  createIncidents();
}

function generateVariants(items, prefix, count, lngDrift, latDrift) {
  return items.flatMap((item, i) => Array.from({ length: count }, (_, v) => {
    const d = i + v + 1;
    return {
      ...item,
      id:          `${item.id}-${prefix.toLowerCase()}-${v + 1}`,
      label:       `${prefix}-${String(d).padStart(2, "0")}`,
      description: `${item.description} Auxiliary model track.`,
      showLabel:   false,
      positions:   item.positions.map((pt, pi) => ({
        ...pt,
        lng:    pt.lng + Math.sin((pi + 1) * 0.8 + d) * lngDrift,
        lat:    pt.lat + Math.cos((pi + 1) * 0.6 + d) * latDrift,
        minute: clamp(pt.minute + v, 0, SCENARIO.durationMinutes)
      }))
    };
  }));
}

function createTrafficEntities(items, layerId, color, trailTime, pixelSize = 9) {
  items.forEach(item => {
    const position = new Cesium.SampledPositionProperty();
    item.positions.forEach(pt => {
      position.addSample(
        minuteToRealJulian(pt.minute),
        Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat, pt.altitude ?? item.altitude ?? 0)
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
        outlineColor: color.brighten(0.4, new Cesium.Color()).withAlpha(0.85),
        outlineWidth: layerId === "military" ? 3 : layerId === "satellites" ? 2.5 : 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.6, 1.5e7, 0.8),
        translucencyByDistance: new Cesium.NearFarScalar(5.0e5, 1.0, 2.0e7, 0.5)
      },
      path: {
        show:       true,
        width:      layerId === "satellites" ? 1.6 : 2.3,
        material:   color.withAlpha(layerId === "satellites" ? 0.5 : 0.8),
        trailTime,
        leadTime:   0,
        resolution: 120
      },
      label: item.showLabel === false ? undefined : {
        text: item.label,
        font: '12px "Share Tech Mono"',
        fillColor:        Cesium.Color.WHITE,
        showBackground:   true,
        backgroundColor:  Cesium.Color.fromCssColorString("rgba(5,12,23,0.75)"),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        pixelOffset:      new Cesium.Cartesian2(12, -10),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 0.85,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 18000000)
      },
      properties: {
        layerId,
        label:       item.label,
        description: item.description,
        entityType:  layerId,
        altitude:    item.altitude ?? 0,
        synthetic:   item.showLabel === false
      }
    });
    entity._basePixelSize = pixelSize;
    entity._pulseSeed     = Math.random() * Math.PI * 2;
    entity._layerColor    = color;
    dynamic.traffic.push(entity);
    if (layerId === "military") createRadarSweep(entity, color);
  });
}

function destinationPoint(latDeg, lngDeg, distanceMeters, bearingDeg) {
  const d   = distanceMeters / 6378137;
  const brg = Cesium.Math.toRadians(bearingDeg);
  const lat = Cesium.Math.toRadians(latDeg);
  const lng = Cesium.Math.toRadians(lngDeg);
  const tLat = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(brg));
  const tLng = lng + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(tLat));
  return { lat: Cesium.Math.toDegrees(tLat), lng: Cesium.Math.toDegrees(tLng) };
}

function headingBetweenPositions(a, b) {
  if (!a || !b) return 0;
  const ac = Cesium.Cartographic.fromCartesian(a);
  const bc = Cesium.Cartographic.fromCartesian(b);
  const dL = bc.longitude - ac.longitude;
  const y  = Math.sin(dL) * Math.cos(bc.latitude);
  const x  = Math.cos(ac.latitude) * Math.sin(bc.latitude) - Math.sin(ac.latitude) * Math.cos(bc.latitude) * Math.cos(dL);
  return (Cesium.Math.toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function createRadarSweep(entity, color) {
  const rc = color.brighten(0.2, new Cesium.Color());
  const radarEntity = viewer.entities.add({
    id: `${entity.id}-radar`,
    polygon: {
      hierarchy: new Cesium.CallbackProperty(() => {
        const now  = viewer.clock.currentTime;
        const cur  = entity.position?.getValue?.(now);
        const fwd  = entity.position?.getValue?.(Cesium.JulianDate.addSeconds(now, 45, new Cesium.JulianDate()));
        if (!cur) return undefined;
        const cg   = Cesium.Cartographic.fromCartesian(cur);
        const cLat = Cesium.Math.toDegrees(cg.latitude);
        const cLng = Cesium.Math.toDegrees(cg.longitude);
        const baseH = headingBetweenPositions(cur, fwd);
        const sweep = baseH + Math.sin(performance.now() / 700 + entity._pulseSeed) * 62;
        const half  = 18;
        const range = 260000;
        const pts   = [cLng, cLat];
        for (let s = 0; s <= 12; s++) {
          const brg = sweep - half + (s / 12) * half * 2;
          const pt  = destinationPoint(cLat, cLng, range, brg);
          pts.push(pt.lng, pt.lat);
        }
        return new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(pts));
      }, false),
      material:          rc.withAlpha(0.14),
      outline:           true,
      outlineColor:      rc.withAlpha(0.42),
      perPositionHeight: false,
      height:            0
    },
    properties: {
      layerId:     "military",
      label:       `${entity.properties.label.getValue(viewer.clock.currentTime)} Radar Sweep`,
      description: "Ground-projected radar search cone.",
      entityType:  "radar"
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
            zone.coordinates.west, zone.coordinates.south,
            zone.coordinates.east, zone.coordinates.north
          ),
          material:     color.withAlpha(zone.fill),
          outline:      true,
          outlineColor: color.withAlpha(0.75),
          height:       0
        },
        properties: { layerId: "zones", label: zone.label, description: zone.label, entityType: "zone" }
      });
    } else {
      entity = viewer.entities.add({
        id: zone.id,
        polygon: {
          hierarchy:    Cesium.Cartesian3.fromDegreesArray(zone.coordinates.flat()),
          material:     color.withAlpha(zone.fill),
          outline:      true,
          outlineColor: color.withAlpha(0.8),
          perPositionHeight: false
        },
        properties: { layerId: "zones", label: zone.label, description: zone.label, entityType: "zone" }
      });
    }
    entity._zoneColor = color;
    entity._baseFill  = zone.fill;
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
        image:          createMarkerSvg("#ff6d8d", incident.label.slice(0, 1)),
        scale:          1.0,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.4, 8.0e6, 0.6),
        translucencyByDistance: new Cesium.NearFarScalar(1.5e5, 1.0, 2.0e7, 0.3)
      },
      label: {
        text:           incident.label,
        font:           '12px "Share Tech Mono"',
        fillColor:      Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(5,12,23,0.75)"),
        pixelOffset:    new Cesium.Cartesian2(0, -42),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      properties: { layerId: "incidents", label: incident.label, description: incident.description, entityType: "incident" }
    });
    entity._pulseSeed = Math.random() * Math.PI * 2;
    dynamic.incidents.push({ entity, incident });

    const ring = viewer.entities.add({
      id: `${incident.id}-ring`,
      position: Cesium.Cartesian3.fromDegrees(incident.location.lng, incident.location.lat, 0),
      ellipse: {
        semiMajorAxis: 180000,
        semiMinorAxis: 180000,
        material:     Cesium.Color.fromCssColorString("#ff6d8d").withAlpha(0.09),
        outline:      true,
        outlineColor: Cesium.Color.fromCssColorString("#ff6d8d").withAlpha(0.4),
        height:       0
      }
    });
    ring._pulseSeed = Math.random() * Math.PI * 2;
    dynamic.rings.push({ entity: ring, incident });
  });
}

function createMarkerSvg(color, text) {
  const uid = `m${Math.random().toString(36).slice(2, 7)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="88" viewBox="0 0 72 88">
  <defs>
    <filter id="glow-${uid}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="3.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="shadow-${uid}" x="-30%" y="-10%" width="160%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="${color}" flood-opacity="0.45"/>
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.6)" flood-opacity="1"/>
    </filter>
    <radialGradient id="body-${uid}" cx="38%" cy="30%" r="60%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.45"/>
      <stop offset="45%" stop-color="${color}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.75"/>
    </radialGradient>
    <radialGradient id="shine-${uid}" cx="35%" cy="25%" r="45%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- Drop shadow ellipse -->
  <ellipse cx="36" cy="84" rx="14" ry="4" fill="rgba(0,0,0,0.35)" filter="url(#shadow-${uid})"/>
  <!-- Pin body with 3D gradient -->
  <g filter="url(#glow-${uid})">
    <path d="M36 3C21.6 3 10 14.6 10 29c0 20 26 56 26 56s26-36 26-56C62 14.6 50.4 3 36 3z"
      fill="url(#body-${uid})" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>
    <!-- Shine highlight -->
    <path d="M36 3C21.6 3 10 14.6 10 29c0 20 26 56 26 56s26-36 26-56C62 14.6 50.4 3 36 3z"
      fill="url(#shine-${uid})"/>
    <!-- Outline ring inside pin -->
    <circle cx="36" cy="29" r="15" fill="rgba(0,0,0,0.25)" stroke="rgba(255,255,255,0.3)" stroke-width="1.2"/>
    <!-- Icon letter -->
    <text x="36" y="35" text-anchor="middle" font-size="16" font-weight="700"
      font-family="Share Tech Mono, monospace" fill="#ffffff"
      style="text-shadow: 0 1px 3px rgba(0,0,0,0.8)">${text}</text>
  </g>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function refreshEntityVisibility() {
  dynamic.traffic.forEach(entity => {
    entity.show = !!state.layers[entity.properties.layerId.getValue()];
  });
  dynamic.radars.forEach(({ entity }) => {
    entity.show = !!state.layers.military;
  });
  dynamic.liveTraffic.forEach(entity => {
    entity.show = !!state.layers[entity.properties.layerId.getValue(viewer.clock.currentTime)];
  });
}

function updateZones() {
  dynamic.zones.forEach(({ entity }) => { entity.show = !!state.layers.zones; });
}

function updateIncidents() {
  dynamic.incidents.forEach(({ entity }) => { entity.show = !!state.layers.incidents; });
  dynamic.rings.forEach(({ entity })     => { entity.show = !!state.layers.incidents; });
}

function updateLiveMetrics() {
  const visibleTraffic = dynamic.traffic.filter(e => e.show).length + dynamic.liveTraffic.filter(e => e.show).length;
  const activeAlerts   = dynamic.incidents.filter(({ entity }) => entity.show).length + dynamic.zones.filter(({ entity }) => entity.show).length;
  const visibleOrbits  = dynamic.traffic.filter(e => e.show && e.properties.layerId.getValue(viewer.clock.currentTime) === "satellites").length;
  const liveFeeds      = [state.liveFeeds.adsb, state.liveFeeds.ais].filter(f => f.status === "live").length;

  updateMetricCard("tracks", visibleTraffic, `${Math.max(1, Math.round(visibleTraffic * 0.35))} sectors monitored`);
  updateMetricCard("alerts", activeAlerts,   activeAlerts ? "Active disruptions" : "No disruptions");
  updateMetricCard("orbits", visibleOrbits,  "Overhead coverage");
  updateMetricCard("feeds",  liveFeeds,      liveFeeds === 2 ? "All sources live" : liveFeeds === 1 ? "Partial live" : "Feeds loading");

  if (elements.hudTrackCount) elements.hudTrackCount.textContent = `${visibleTraffic} tracks`;
  if (elements.hudAlertCount) elements.hudAlertCount.textContent = `${activeAlerts} alerts`;
  if (elements.hudStatusText) elements.hudStatusText.textContent = "LIVE";
  if (elements.liveRegionLabel) elements.liveRegionLabel.textContent = "Global Surveillance Active";
  if (elements.hudStatusMode) elements.hudStatusMode.textContent = "LIVE FEED";

  if (elements.summaryStage) elements.summaryStage.textContent = "LIVE";
  if (elements.summaryCopy) {
    const adsbMsg = state.liveFeeds.adsb.status === "live"
      ? `${state.liveFeeds.adsb.records.length} aircraft` : "ADS-B pending";
    const aisMsg  = state.liveFeeds.ais.status === "live"
      ? `${state.liveFeeds.ais.records.length} vessels` : "AIS unconfigured";
    elements.summaryCopy.textContent = `${adsbMsg} \u00b7 ${aisMsg} \u00b7 ${visibleOrbits} orbital tracks monitored.`;
  }

  if (state.regionFocus && Date.now() - state.regionFocus.timestamp < 120000) {
    if (elements.liveRegionLabel) {
      elements.liveRegionLabel.textContent = `${state.regionFocus.label.toUpperCase()} · ${state.regionFocus.tracks} tracks · ${state.regionFocus.alerts} alerts`;
    }
    if (elements.hudStatusMode) {
      elements.hudStatusMode.textContent = "REGION FOCUS";
    }
    if (elements.summaryCopy) {
      elements.summaryCopy.textContent = state.regionFocus.summary;
    }
  }

  if (elements.summaryTags) renderSummaryTags();
}

function renderSummaryTags() {
  const active = LAYERS.filter(l => state.layers[l.id]).map(l => l.label);
  elements.summaryTags.innerHTML = active.slice(0, 5).map(t => `<span class="summary-tag">${t}</span>`).join("");
}

function updateHudFrame() {
  updateFps();
}

function updateAmbientEffects() {
  const phase = performance.now() / 700;
  dynamic.traffic.forEach(entity => {
    if (!entity.show || !entity.point) return;
    const layerId    = entity.properties.layerId.getValue(viewer.clock.currentTime);
    const pulseRange = layerId === "military" ? 1.8 : layerId === "commercial" ? 0.9 : layerId === "satellites" ? 0.6 : 0.7;
    entity.point.pixelSize = entity._basePixelSize + Math.max(0, Math.sin(phase + entity._pulseSeed)) * pulseRange;
  });
  dynamic.liveTraffic.forEach(entity => {
    if (!entity.show || !entity.point) return;
    entity.point.pixelSize = entity._basePixelSize + Math.max(0, Math.sin(phase * 1.15 + entity._pulseSeed)) * 1.6;
  });
  dynamic.incidents.forEach(({ entity }) => {
    if (!entity.show || !entity.billboard) return;
    entity.billboard.scale = 0.9 + (Math.sin(phase * 1.6 + entity._pulseSeed) + 1) * 0.08;
  });
  dynamic.zones.forEach(({ entity }) => {
    if (!entity.show) return;
    const alpha = entity._baseFill + (Math.sin(phase + entity._pulseSeed) + 1) * 0.02;
    if (entity.rectangle) entity.rectangle.material = entity._zoneColor.withAlpha(alpha);
    if (entity.polygon)   entity.polygon.material   = entity._zoneColor.withAlpha(alpha);
  });
  dynamic.rings.forEach(({ entity }) => {
    if (!entity.show || !entity.ellipse) return;
    const pulse = (Math.sin(phase + entity._pulseSeed) + 1) / 2;
    entity.ellipse.semiMajorAxis = 160000 + pulse * 90000;
    entity.ellipse.semiMinorAxis = 160000 + pulse * 90000;
    entity.ellipse.material = Cesium.Color.fromCssColorString("#ff6d8d").withAlpha(0.05 + pulse * 0.08);
  });
}

function openIntelSheet(entity) {
  const info = getEntityInfo(entity);
  if (!info || !elements.intelSheet) return;
  const incident = info.type === "incident" ? findScenarioIncidentById(info.entityId) : null;
  const incidentNarrative = incident ? getActiveIncidentNarrative(incident) : null;
  const effectiveDescription = incidentNarrative?.description ?? info.description;
  const intelSourceLine = incidentNarrative?.sourceUrl
    ? `<div><a class="intel-source-link" href="${escapeHtml(incidentNarrative.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(incidentNarrative.sourceLabel || "Source article")} ↗</a></div>`
    : incidentNarrative?.sourceLabel
      ? `<div>${escapeHtml(incidentNarrative.sourceLabel)}</div>`
      : "";
  state.intelSheetOpen = true;
  document.body.classList.add("intel-sheet-open");
  elements.intelSheet.classList.remove("hidden");
  elements.intelSheet.setAttribute("aria-hidden", "false");
  elements.intelSheetKicker.textContent   = `${info.type.toUpperCase()} \u2014 LIVE TRACK`;
  elements.intelSheetTitle.textContent    = info.label;
  elements.intelSheetOverview.textContent = effectiveDescription || "Track selected for review.";
  const now = new Date();
  elements.intelSheetTelemetry.innerHTML = `
    <div>${info.locationMeta}</div>
    <div>Altitude: ${Math.round(info.altitude).toLocaleString()} m</div>
    <div>Status: LIVE MONITORING</div>
    <div>Class: ${info.synthetic ? "Auxiliary model track" : "Primary track"}</div>
  `;
  elements.intelSheetAssessment.innerHTML = `
    <div>${info.type === "military" || info.type === "radar"
      ? "Military-linked track with active radar coverage."
      : "Traffic track contributing to current route density."}</div>
    <div>Feed: ${info.type.startsWith("live-") ? "Live feed adapter" : "Static backdrop overlay"}</div>
    <div>Last updated: ${now.toUTCString().slice(17, 25)} UTC</div>
    ${intelSourceLine}
  `;
  elements.intelSheetTimeline.innerHTML = [
    { kicker: "Now",  copy: `${info.label} under active surveillance` },
    { kicker: "Feed", copy: info.type.startsWith("live-") ? "Real-time ADS-B / AIS data" : "Static backdrop model track" },
    { kicker: "Next", copy: "Continue monitoring \u2014 auto-refresh active" }
  ].map(item => `
    <div class="intel-timeline-item">
      <strong>${item.kicker}</strong>
      <span>${item.copy}</span>
    </div>
  `).join("");
}

function closeIntelSheet() {
  state.intelSheetOpen = false;
  document.body.classList.remove("intel-sheet-open");
  if (!elements.intelSheet) return;
  elements.intelSheet.classList.add("hidden");
  elements.intelSheet.setAttribute("aria-hidden", "true");
}

async function testAisEndpoint() {
  if (!elements.feedHint) return;
  elements.feedHint.textContent = "Testing AIS endpoint\u2026";
  const result = await fetchAisFeed();
  elements.feedHint.textContent = result.status === "live"
    ? `AIS OK: ${result.records?.length ?? 0} vessel tracks.`
    : `AIS test: ${result.message}`;
}

function setMobileDrawer(drawer) {
  state.activeDrawer = state.activeDrawer === drawer ? null : drawer;
  document.body.classList.toggle("mobile-drawer-open",    !!state.activeDrawer);
  document.body.classList.toggle("mobile-layers-open",   state.activeDrawer === "layers");
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
        pixelSize:    layerId === "maritime" ? 7 : 8,
        color,
        outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text:           record.label,
        font:           '11px "Share Tech Mono"',
        fillColor:      Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(4,10,18,0.68)"),
        pixelOffset:    new Cesium.Cartesian2(10, -8),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 0.76,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12000000)
      },
      properties: {
        layerId,
        label:       record.label,
        description: `${record.source} live feed`,
        entityType,
        altitude:    record.altitude ?? 0,
        synthetic:   false
      }
    });
    entity._basePixelSize = layerId === "maritime" ? 7 : 8;
    entity._pulseSeed     = Math.random() * Math.PI * 2;
    dynamic.liveTraffic.push(entity);
  });
}

async function refreshLiveFeeds() {
  if (elements.liveLastRefresh) elements.liveLastRefresh.textContent = "Refreshing feeds\u2026";
  state.liveFeeds = await fetchLiveFeeds();
  renderFeedStatus();
  renderTrustIndicators();
  clearLiveTraffic();
  if (state.liveFeeds.adsb.status === "live") {
    addLiveTrafficEntities(state.liveFeeds.adsb.records, "commercial", Cesium.Color.fromCssColorString("#90f4ff"), "live-adsb");
  }
  if (state.liveFeeds.ais.status === "live") {
    addLiveTrafficEntities(state.liveFeeds.ais.records, "maritime", Cesium.Color.fromCssColorString("#7bffcb"), "live-ais");
  }
  refreshEntityVisibility();
  const now = new Date().toLocaleTimeString([], { hour12: false });
  if (elements.liveLastRefresh) elements.liveLastRefresh.textContent = `Last refresh: ${now} UTC`;
  if (elements.hudStatusMode)   elements.hudStatusMode.textContent   = "LIVE FEED";
  state.nextRefreshAt = Date.now() + state.refreshIntervalSec * 1000;
  updateRefreshCountdown();
  renderLegend();
}

function pausePassiveSpin(duration = 5000) {
  state.spinPausedUntil = performance.now() + duration;
}

function focusCameraOnCartesian(cartesian, duration = 1.6) {
  if (!cartesian) return;
  const currentHeight = viewer.camera.positionCartographic.height;
  const desiredPitch  = clamp(viewer.camera.pitch, Cesium.Math.toRadians(-82), Cesium.Math.toRadians(-48));
  const desiredRange  = clamp(currentHeight * 0.82, 850000, 4800000);
  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(cartesian, 1), {
    duration,
    offset: new Cesium.HeadingPitchRange(viewer.camera.heading, desiredPitch, desiredRange)
  });
}

function clickedCartesian(position, picked) {
  if (picked?.id?.position) return picked.id.position.getValue(viewer.clock.currentTime);
  const precise = viewer.scene.pickPositionSupported ? viewer.scene.pickPosition(position) : null;
  return precise ?? viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
}

const DECRYPT_CHARS = "█▓▒░<>/\\|_+-=*#0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function animateDecryptText(element, targetText, duration = 520) {
  if (!element) return;
  const finalText = String(targetText ?? "");
  if (!finalText) {
    element.textContent = "";
    element.classList.remove("is-decrypting");
    return;
  }
  const startedAt = performance.now();
  element.classList.add("is-decrypting");

  function frame(now) {
    const progress = Math.min((now - startedAt) / duration, 1);
    const revealCount = Math.floor(finalText.length * progress);
    let scrambled = "";
    for (let index = 0; index < finalText.length; index += 1) {
      const currentChar = finalText[index];
      if (currentChar === " ") {
        scrambled += " ";
        continue;
      }
      if (index < revealCount) {
        scrambled += currentChar;
        continue;
      }
      scrambled += DECRYPT_CHARS[Math.floor(Math.random() * DECRYPT_CHARS.length)];
    }
    element.textContent = scrambled;
    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      element.textContent = finalText;
      element.classList.remove("is-decrypting");
    }
  }

  requestAnimationFrame(frame);
}

function computeGeoDistanceKm(latA, lngA, latB, lngB) {
  const toRadians = value => value * Math.PI / 180;
  const dLat = toRadians(latB - latA);
  const dLng = toRadians(lngB - lngA);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(dLng / 2) ** 2;
  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function findNearbyConflictIntel(lat, lng) {
  const alerts = SCENARIO.alerts.map(alert => ({
    kind: "alert",
    title: alert.title,
    summary: getActiveAlertNarrative(alert).summary ?? alert.summary,
    sourceLabel: getActiveAlertNarrative(alert).sourceLabel ?? alert.sourceLabel,
    sourceUrl: getActiveAlertNarrative(alert).sourceUrl ?? alert.sourceUrl,
    distanceKm: computeGeoDistanceKm(lat, lng, alert.location.lat, alert.location.lng),
    severity: 3,
    tags: alert.tags ?? []
  }));
  const incidents = SCENARIO.incidents.map(incident => ({
    kind: "incident",
    title: incident.label,
    summary: getActiveIncidentNarrative(incident).description ?? incident.description,
    sourceLabel: getActiveIncidentNarrative(incident).sourceLabel ?? incident.sourceLabel,
    sourceUrl: getActiveIncidentNarrative(incident).sourceUrl ?? incident.sourceUrl,
    distanceKm: computeGeoDistanceKm(lat, lng, incident.location.lat, incident.location.lng),
    severity: 4,
    tags: incident.tags ?? []
  }));
  const combined = [...alerts, ...incidents].sort((left, right) => {
    if (left.distanceKm !== right.distanceKm) return left.distanceKm - right.distanceKm;
    return right.severity - left.severity;
  });
  const closeMatches = combined.filter(item => item.distanceKm <= 1800).slice(0, 4);
  if (closeMatches.length) return closeMatches;
  return combined.filter(item => item.distanceKm <= 3200).slice(0, 3);
}

function formatDistanceLabel(distanceKm) {
  return distanceKm >= 1000 ? `${(distanceKm / 1000).toFixed(1)} Mm` : `${Math.round(distanceKm)} km`;
}

function renderConflictIntel(screenX, screenY, lat, lng, geoContext = {}) {
  const box = elements.clickConflictBox;
  if (!box || !elements.ccbList || !elements.ccbTitle) return;
  const nearby = findNearbyConflictIntel(lat, lng);
  const areaLabel = [geoContext.city, geoContext.state, geoContext.country].filter(Boolean)[0] || "Selected Area";

  const popupWidth = 276;
  const boxWidth = 320;
  const gap = 12;
  let left = screenX + 18 + popupWidth + gap;
  let top = clamp(screenY - 84, 16, window.innerHeight - 250);
  if (left + boxWidth > window.innerWidth - 16) {
    left = screenX - boxWidth - popupWidth - 24;
  }
  if (left < 16) {
    left = clamp(screenX - boxWidth / 2, 16, window.innerWidth - boxWidth - 16);
    top = clamp(screenY + 96, 16, window.innerHeight - 250);
  }

  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.classList.remove("hidden");
  animateDecryptText(elements.ccbTitle, `${areaLabel.toUpperCase()} // CONFLICT RELEVANCE`, 620);

  if (!nearby.length) {
    elements.ccbList.innerHTML = `
      <article class="conflict-card quiet">
        <strong data-decrypt="No active conflict markers nearby">No active conflict markers nearby</strong>
        <p data-decrypt="No tracked alert or incident nodes are within the local relevance band.">No tracked alert or incident nodes are within the local relevance band.</p>
      </article>
    `;
  } else {
    elements.ccbList.innerHTML = nearby.map(item => `
      <article class="conflict-card ${item.kind}">
        <div class="conflict-card-head">
          <span class="conflict-kind">${item.kind.toUpperCase()}</span>
          <span class="conflict-distance">${formatDistanceLabel(item.distanceKm)}</span>
        </div>
        <strong data-decrypt="${escapeHtml(item.title)}">${escapeHtml(item.title)}</strong>
        <p data-decrypt="${escapeHtml(item.summary)}">${escapeHtml(item.summary)}</p>
        <div class="conflict-card-foot">
          <span>${escapeHtml(item.sourceLabel || "Live monitor")}</span>
        </div>
      </article>
    `).join("");
  }

  elements.ccbList.querySelectorAll("[data-decrypt]").forEach((node, index) => {
    window.setTimeout(() => animateDecryptText(node, node.getAttribute("data-decrypt") || node.textContent, 480), index * 80);
  });
}

function getEntityInfo(entity) {
  if (!entity) return null;
  const props       = entity.properties;
  const label       = props?.label?.getValue?.(viewer.clock.currentTime)       ?? entity.id;
  const description = props?.description?.getValue?.(viewer.clock.currentTime) ?? "";
  const type        = props?.entityType?.getValue?.(viewer.clock.currentTime)  ?? "unknown";
  const position    = entity.position?.getValue?.(viewer.clock.currentTime);
  let locationMeta  = "Static overlay";
  if (position) {
    const cg = Cesium.Cartographic.fromCartesian(position);
    locationMeta = `${Cesium.Math.toDegrees(cg.latitude).toFixed(2)}\u00b0, ${Cesium.Math.toDegrees(cg.longitude).toFixed(2)}\u00b0`;
  }
  const altitude  = props?.altitude?.getValue?.(viewer.clock.currentTime) ?? 0;
  const synthetic = !!props?.synthetic?.getValue?.(viewer.clock.currentTime);
  return { label, description, type, locationMeta, altitude, synthetic, entityId: entity.id };
}

function hideHoverTooltip() { elements.hoverTooltip.classList.add("hidden"); }

function showHoverTooltip(entity, screenPosition) {
  const info = getEntityInfo(entity);
  if (!info) { hideHoverTooltip(); return; }
  elements.hoverTooltip.innerHTML = `
    <strong>${info.label}</strong>
    <span>${info.type.toUpperCase()}</span>
    <p>${info.description || info.locationMeta}</p>
  `;
  elements.hoverTooltip.style.left = `${screenPosition.x + 18}px`;
  elements.hoverTooltip.style.top  = `${screenPosition.y + 18}px`;
  elements.hoverTooltip.classList.remove("hidden");
}

function updateSelectedEntityCard(entity) {
  if (!entity) {
    elements.entityInfo.classList.add("empty");
    elements.entityInfo.innerHTML = "Select a track, satellite, ship, event, or zone on the globe.";
    updateTrackButtons();
    return;
  }
  elements.entityInfo.classList.remove("empty");
  const { label, description, type, locationMeta, altitude, synthetic, entityId } = getEntityInfo(entity);
  const incident = type === "incident" ? findScenarioIncidentById(entityId) : null;
  const incidentNarrative = incident ? getActiveIncidentNarrative(incident) : null;
  const effectiveDescription = incidentNarrative?.description ?? description;
  const sourceMarkup = incidentNarrative?.sourceUrl
    ? `<a class="entity-source-link" href="${escapeHtml(incidentNarrative.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(incidentNarrative.sourceLabel || "Source article")} ↗</a>`
    : incidentNarrative?.sourceLabel
      ? `<span class="entity-source-text">${escapeHtml(incidentNarrative.sourceLabel)}</span>`
      : "";
  elements.entityInfo.innerHTML = `
    <strong>${label}</strong>
    <div>${effectiveDescription}</div>
    ${sourceMarkup}
    <div class="entity-meta">
      <span>${type.toUpperCase()}</span>
      <span>${locationMeta}</span>
    </div>
    <div class="entity-stats">
      <span>ALT ${Math.round(altitude).toLocaleString()} m</span>
      <span>${synthetic ? "AUX MODEL" : "PRIMARY TRACK"}</span>
      <span>LIVE</span>
    </div>
  `;
  elements.entityInfo.onclick = () => openIntelSheet(entity);
  updateTrackButtons();
}

function updateTrackButtons() {
  const canTrack = !!state.selectedEntity && !!state.selectedEntity.position;
  elements.trackSelected.disabled = !canTrack;
  elements.releaseTrack.disabled  = !state.trackedEntity;
}

function saveCurrentBookmark() {
  const cg = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
  const next = {
    id:    `bookmark-${Date.now()}`,
    label: `View ${state.bookmarks.length + 1}`,
    destination: {
      lng:     Cesium.Math.toDegrees(cg.longitude),
      lat:     Cesium.Math.toDegrees(cg.latitude),
      height:  cg.height,
      heading: viewer.camera.heading,
      pitch:   viewer.camera.pitch,
      roll:    viewer.camera.roll
    }
  };
  state.bookmarks = [...state.bookmarks, next].slice(-8);
  saveJson(STORAGE_KEYS.bookmarks, state.bookmarks);
  renderBookmarks();
}

function removeBookmark(id) {
  state.bookmarks = state.bookmarks.filter(b => b.id !== id);
  saveJson(STORAGE_KEYS.bookmarks, state.bookmarks);
  renderBookmarks();
}

function flyToBookmark(bookmark) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      bookmark.destination.lng, bookmark.destination.lat, bookmark.destination.height
    ),
    orientation: {
      heading: bookmark.destination.heading,
      pitch:   bookmark.destination.pitch,
      roll:    bookmark.destination.roll
    },
    duration: 1.2
  });
}

function installBasemap(basemapId) {
  state.basemapId = basemapId;
  saveJson(STORAGE_KEYS.basemap, basemapId);
  viewer.imageryLayers.removeAll();
  const bm = BASEMAPS.find(b => b.id === basemapId) || BASEMAPS[0];
  const provider = bm.type === "osm"
    ? new Cesium.OpenStreetMapImageryProvider({ url: bm.url })
    : new Cesium.UrlTemplateImageryProvider({ url: bm.url, credit: bm.credit });
  viewer.imageryLayers.addImageryProvider(provider);
  renderBasemapButtons();
}

function applyFxMode(mode) {
  document.body.dataset.fxMode = mode;
  postStages.blackAndWhite.enabled             = mode === "nightvision" || mode === "thermal";
  postStages.blackAndWhite.uniforms.gradations = mode === "thermal" ? 8 : 14;
  postStages.brightness.enabled                = mode !== "normal";
  postStages.brightness.uniforms.brightness    = mode === "nightvision" ? 0.08 : mode === "thermal" ? 0.15 : mode === "crt" ? 0.05 : 0;
}

function applyFxIntensity() {
  if (elements.fxIntensityValue) elements.fxIntensityValue.textContent = String(state.fxIntensity);
  document.documentElement.style.setProperty("--fx-intensity", String(state.fxIntensity / 100));
}

function applyGlow() {
  if (elements.fxGlowValue) elements.fxGlowValue.textContent = String(state.fxGlow);
  if (!bloomStage) return;
  bloomStage.uniforms.glowOnly   = false;
  bloomStage.uniforms.contrast   = 128 - state.fxGlow * 0.4;
  bloomStage.uniforms.brightness = -0.15 + state.fxGlow / 300;
  bloomStage.uniforms.delta      = 1 + state.fxGlow / 60;
  bloomStage.uniforms.sigma      = 2 + state.fxGlow / 24;
  bloomStage.uniforms.stepSize   = 3 + state.fxGlow / 35;
}

function startHudClock() {
  window.setInterval(() => {
    const now = new Date();
    if (elements.hudUtc)      elements.hudUtc.textContent      = `UTC ${now.toUTCString().slice(17, 25)}`;
    if (elements.hudLocal)    elements.hudLocal.textContent    = `LOCAL ${now.toLocaleTimeString([], { hour12: false })}`;
    if (elements.summaryTime) elements.summaryTime.textContent = `${now.toUTCString().slice(17, 25)} UTC`;
    updateRefreshCountdown();
  }, 250);
}

function updateRefreshCountdown() {
  if (!elements.liveNextRefresh) return;
  if (!state.nextRefreshAt) {
    elements.liveNextRefresh.textContent = "Next refresh pending";
    return;
  }
  const remainingMs = state.nextRefreshAt - Date.now();
  if (remainingMs <= 0) {
    elements.liveNextRefresh.textContent = "Refreshing now…";
    return;
  }
  const remainingSec = Math.max(1, Math.ceil(remainingMs / 1000));
  elements.liveNextRefresh.textContent = `Next refresh in ${remainingSec}s`;
}

function updateFps() {
  const now = performance.now();
  frameSamples.push(now);
  frameSamples = frameSamples.filter(s => now - s < 1000);
  if (elements.hudFps) elements.hudFps.textContent = `${frameSamples.length} FPS`;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

// ─────────────────────────────────────────────────────────────────────────────
// BOOT INTRO CINEMATIC
// ─────────────────────────────────────────────────────────────────────────────
const BOOT_STEPS = [
  { pct:  8, msg: "Initializing sensor array…" },
  { pct: 20, msg: "Establishing satellite uplink…" },
  { pct: 35, msg: "Loading geopolitical overlays…" },
  { pct: 48, msg: "Calibrating ADS-B receivers…" },
  { pct: 62, msg: "Syncing orbital telemetry…" },
  { pct: 76, msg: "Decrypting live intelligence feeds…" },
  { pct: 90, msg: "Rendering tactical globe…" },
  { pct:100, msg: "● GOD'S EYE ONLINE" },
];

function startBootIntro() {
  const overlay    = elements.bootOverlay;
  const fillEl     = elements.bootProgressFill;
  const statusEl   = elements.bootStatus;
  if (!overlay || !fillEl || !statusEl) {
    if (overlay) overlay.style.display = "none";
    return;
  }

  overlay.classList.remove("boot-fading");
  overlay.style.display = "";

  let stepIdx = 0;
  const STEP_DELAY = 310;
  const bootTimeout = setTimeout(() => { finishBoot(); }, 15000);

  function runStep() {
    if (stepIdx >= BOOT_STEPS.length) {
      clearTimeout(bootTimeout);
      finishBoot();
      return;
    }
    const { pct, msg } = BOOT_STEPS[stepIdx++];
    if (fillEl)   fillEl.style.width = `${pct}%`;
    if (statusEl) statusEl.textContent = msg;
    setTimeout(runStep, STEP_DELAY);
  }

  setTimeout(runStep, 420);
}

function finishBoot() {
  const overlay = elements.bootOverlay;
  if (!overlay) return;

  const shutterTop    = overlay.querySelector(".boot-shutter-top");
  const shutterBottom = overlay.querySelector(".boot-shutter-bottom");
  if (shutterTop)    shutterTop.classList.add("open");
  if (shutterBottom) shutterBottom.classList.add("open");

  viewer.camera.flyTo({
    destination: homeView,
    orientation: {
      heading: SCENARIO.initialView.heading,
      pitch:   SCENARIO.initialView.pitch,
      roll:    SCENARIO.initialView.roll
    },
    duration: 1.4,
    complete: () => {
      startGlobeSpinDown();
    }
  });

  setTimeout(() => {
    overlay.classList.add("boot-fading");
    overlay.style.pointerEvents = "none";
    document.body.classList.add("boot-complete");
    pulseConsoleFrame("boot");
    setTimeout(() => {
      overlay.style.display = "none";
      overlay.remove();
    }, 900);
  }, 750);
}

let _consolePulseTimer = null;

function pulseConsoleFrame(mode = "click") {
  const frame = elements.consoleFrame;
  if (!frame) return;
  frame.classList.remove("console-frame-pulse", "console-frame-boot-pulse", "console-frame-scan-burst");
  void frame.offsetWidth;
  frame.classList.add(mode === "boot" ? "console-frame-boot-pulse" : "console-frame-pulse");
  frame.classList.add("console-frame-scan-burst");
  if (_consolePulseTimer) window.clearTimeout(_consolePulseTimer);
  _consolePulseTimer = window.setTimeout(() => {
    frame.classList.remove("console-frame-pulse", "console-frame-boot-pulse", "console-frame-scan-burst");
  }, mode === "boot" ? 1800 : 900);
}

function initCinematicUi() {
  document.body.classList.add("ui-booting");

  const zoneBindings = [
    [document.getElementById("panel-layers"), "left"],
    [document.getElementById("map-legend"), "left"],
    [document.getElementById("panel-right"), "right"],
    [document.getElementById("floating-summary"), "center"],
    [document.getElementById("hud-top"), "top"],
    [document.getElementById("hud-bottom"), "bottom"],
    [document.getElementById("news-briefing"), "right"]
  ];

  zoneBindings.forEach(([node, zone]) => {
    if (!(node instanceof HTMLElement)) return;
    node.addEventListener("mouseenter", () => {
      document.body.dataset.consoleFocus = zone;
    });
    node.addEventListener("mouseleave", () => {
      if (document.body.dataset.consoleFocus === zone) delete document.body.dataset.consoleFocus;
    });
  });

  document.querySelectorAll(".hud-action, .panel-btn, .transport-btn, .news-btn, .search-btn").forEach(node => {
    if (!(node instanceof HTMLElement)) return;
    node.addEventListener("mouseenter", () => pulseConsoleFrame("hover"));
  });
}

function startGlobeSpinDown() {
  if (!viewer) return;
  const scene  = viewer.scene;
  const camera = viewer.camera;

  // Spin rate: radians/second.  ~0.6 rad/s = noticeable fast spin
  let spinRate   = 0.55;
  const TARGET   = 0.0;        // end at rest (autoRotate handles slow spin after)
  const DURATION = 3200;       // ms to decelerate
  const start    = performance.now();

  function tick() {
    const now     = performance.now();
    const elapsed = now - start;
    const t       = Math.min(elapsed / DURATION, 1);
    // Ease-out cubic
    const ease    = 1 - Math.pow(1 - t, 3);
    spinRate      = 0.55 * (1 - ease);

    camera.rotate(Cesium.Cartesian3.UNIT_Z, spinRate * 0.016);

    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAGGABLE PANELS
// ─────────────────────────────────────────────────────────────────────────────
function initDraggablePanels() {
  const panels = document.querySelectorAll(".draggable-panel");

  // Build a restore strip (hidden by default)
  let restoreStrip = document.getElementById("panel-restore-strip");
  if (!restoreStrip) {
    restoreStrip = document.createElement("div");
    restoreStrip.id = "panel-restore-strip";
    restoreStrip.className = "panel-restore-strip";
    document.body.appendChild(restoreStrip);
  }

  function refreshRestoreStrip() {
    restoreStrip.innerHTML = "";
    document.querySelectorAll(".draggable-panel.panel-hidden").forEach(panel => {
      const bar   = panel.querySelector(".panel-drag-bar");
      const label = bar?.querySelector(".drag-label")?.textContent ?? panel.id;
      const btn   = document.createElement("button");
      btn.className = "panel-restore-btn";
      btn.textContent = `⊕ ${label}`;
      btn.title = `Restore ${label} panel`;
      btn.addEventListener("click", () => {
        panel.classList.remove("panel-hidden");
        // Reset any drag transform back to CSS default
        panel.style.left = "";
        panel.style.top  = "";
        panel.style.right = "";
        panel.style.bottom = "";
        refreshRestoreStrip();
      });
      restoreStrip.appendChild(btn);
    });
  }

  // Close buttons
  document.querySelectorAll(".panel-close-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const targetId = btn.dataset.closePanel;
      const panel    = targetId ? document.getElementById(targetId) : btn.closest(".draggable-panel");
      if (!panel) return;
      panel.classList.add("panel-hidden");
      refreshRestoreStrip();
    });
  });

  // Drag behaviour (desktop only)
  panels.forEach(panel => {
    const bar = panel.querySelector(".panel-drag-bar");
    if (!bar) return;

    let startX = 0, startY = 0, origLeft = 0, origTop = 0;

    bar.addEventListener("mousedown", e => {
      if (e.button !== 0) return;
      e.preventDefault();

      const rect = panel.getBoundingClientRect();
      startX  = e.clientX;
      startY  = e.clientY;
      origLeft = rect.left;
      origTop  = rect.top;

      // Switch to absolute top/left positioning
      panel.style.position = "fixed";
      panel.style.left     = `${origLeft}px`;
      panel.style.top      = `${origTop}px`;
      panel.style.right    = "auto";
      panel.style.bottom   = "auto";
      panel.style.transform = "none";
      panel.classList.add("is-dragging");

      function onMove(me) {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        panel.style.left = `${clamp(origLeft + dx, 0, window.innerWidth  - 60)}px`;
        panel.style.top  = `${clamp(origTop  + dy, 0, window.innerHeight - 40)}px`;
      }

      function onUp() {
        panel.classList.remove("is-dragging");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup",   onUp);
    });

    // Touch drag support
    bar.addEventListener("touchstart", e => {
      const touch  = e.touches[0];
      const rect   = panel.getBoundingClientRect();
      startX  = touch.clientX;
      startY  = touch.clientY;
      origLeft = rect.left;
      origTop  = rect.top;
      panel.style.position  = "fixed";
      panel.style.left      = `${origLeft}px`;
      panel.style.top       = `${origTop}px`;
      panel.style.right     = "auto";
      panel.style.bottom    = "auto";
      panel.style.transform = "none";

      function onTouchMove(te) {
        const t  = te.touches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        panel.style.left = `${clamp(origLeft + dx, 0, window.innerWidth  - 60)}px`;
        panel.style.top  = `${clamp(origTop  + dy, 0, window.innerHeight - 40)}px`;
      }
      function onTouchEnd() {
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend",  onTouchEnd);
      }
      document.addEventListener("touchmove", onTouchMove, { passive: true });
      document.addEventListener("touchend",  onTouchEnd);
    }, { passive: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PING CANVAS
// ─────────────────────────────────────────────────────────────────────────────
let _pingAnimId = null;
const _pings = [];

function initPingCanvas() {
  const canvas = elements.pingCanvas;
  if (!canvas) return;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  window.addEventListener("resize", () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  });
  // Don't auto-start animation — wait for first ping
}

function spawnPing(x, y, color = "rgba(126,224,255,") {
  _pings.push({ x, y, r: 0, maxR: 80, alpha: 1.0, color, born: performance.now() });
  if (!_pingAnimId) {
    _pingAnimId = requestAnimationFrame(animatePings);
  }
}

function animatePings() {
  const canvas = elements.pingCanvas;
  if (!canvas) {
    _pingAnimId = null;
    return;
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const now = performance.now();
  for (let i = _pings.length - 1; i >= 0; i--) {
    const p = _pings[i];
    const age = (now - p.born) / 900; // 0→1 over 900ms
    if (age >= 1) {
      _pings.splice(i, 1);
      continue;
    }
    const ease  = 1 - Math.pow(1 - age, 2);
    const r     = ease * p.maxR;
    const alpha = (1 - age) * 0.75;

    // Outer ring
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `${p.color}${alpha})`;
    ctx.lineWidth   = 2.5 * (1 - age);
    ctx.stroke();

    // Inner dot (only first 30%)
    if (age < 0.3) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 * (1 - age / 0.3), 0, Math.PI * 2);
      ctx.fillStyle = `${p.color}${(0.3 - age / 0.3 * 0.3)}`;
      ctx.fill();
    }
  }

  if (_pings.length > 0) {
    _pingAnimId = requestAnimationFrame(animatePings);
  } else {
    _pingAnimId = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLICK-LOCATION POPUP
// ─────────────────────────────────────────────────────────────────────────────
let _clpGeoTimer     = null;
let _clpGeoCancelFn  = null;

function showClickLocationPopup(screenX, screenY, lat, lng) {
  const popup = elements.clickLocPopup;
  if (!popup) return;

  // Position — keep within viewport
  const PAD  = 16;
  const W    = 276;
  const H    = 196;
  let px = screenX + 18;
  let py = screenY - H / 2;
  if (px + W > window.innerWidth  - PAD) px = screenX - W - 18;
  if (py < PAD)                          py = PAD;
  if (py + H > window.innerHeight - PAD) py = window.innerHeight - H - PAD;

  popup.style.left = `${px}px`;
  popup.style.top  = `${py}px`;

  // Reset state
  if (elements.clpFlag)         elements.clpFlag.textContent    = "";
  if (elements.clpCountry)      elements.clpCountry.textContent = "██████████";
  if (elements.clpRegion)       elements.clpRegion.textContent  = "▒▒▒▒▒▒▒▒▒▒▒▒";
  if (elements.clpCoordsPopup)  elements.clpCoordsPopup.textContent =
    `${lat >= 0 ? "N" : "S"}${Math.abs(lat).toFixed(4)}°  ` +
    `${lng >= 0 ? "E" : "W"}${Math.abs(lng).toFixed(4)}°`;
  elements.clpLoading?.classList.remove("hidden");
  popup.classList.remove("hidden");

  renderConflictIntel(screenX, screenY, lat, lng);

  // Cancel any previous in-flight geocode
  if (_clpGeoTimer) clearTimeout(_clpGeoTimer);
  if (_clpGeoCancelFn) _clpGeoCancelFn();

  let cancelled = false;
  _clpGeoCancelFn = () => { cancelled = true; };

  _clpGeoTimer = setTimeout(async () => {
    try {
      const url  = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}&format=json`;
      const resp = await fetch(url, {
        headers: { "Accept-Language": "en-US,en", "User-Agent": "GodsEye/1.0 intelligence-dashboard" }
      });
      if (cancelled || !resp.ok) return;
      const data = await resp.json();
      if (cancelled) return;
      const addr    = data.address || {};
      const country = addr.country  || "Open Ocean";
      const state_  = addr.state    || addr.county || "";
      const city    = addr.city     || addr.town   || addr.village || addr.municipality || "";
      const code    = (addr.country_code || "").toUpperCase();
      const flag    = code.length === 2
        ? String.fromCodePoint(...[...code].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)))
        : "";

      if (elements.clpFlag)    elements.clpFlag.textContent    = flag;
      animateDecryptText(elements.clpCountry, country, 540);
      animateDecryptText(elements.clpRegion, [city, state_].filter(Boolean).join(", ") || "Area match pending", 640);
      renderConflictIntel(screenX, screenY, lat, lng, { country, state: state_, city });
    } catch { /* ignore */ } finally {
      if (!cancelled) elements.clpLoading?.classList.add("hidden");
    }
  }, 120);
}

function hideClickLocationPopup() {
  elements.clickLocPopup?.classList.add("hidden");
  elements.clickConflictBox?.classList.add("hidden");
  if (_clpGeoTimer)   clearTimeout(_clpGeoTimer);
  if (_clpGeoCancelFn) _clpGeoCancelFn();
  _clpGeoCancelFn = null;
}

// Reverse-geocode the camera's center position via Nominatim and display it.
// Throttled to one request per 3 seconds; cached while camera hasn't moved.

let _locGeocodeTimer = null;
let _locLastLat      = null;
let _locLastLng      = null;
let _locInFlight     = false;

function startLocationHud() {
  if (!viewer) return;
  viewer.scene.postRender.addEventListener(onScenePostRender);
}

function onScenePostRender() {
  const hud = elements.locationHud;
  if (!hud) return;

  const carto = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
  const altKm = carto.height / 1000;

  if (altKm > 4500) {
    if (!hud.classList.contains("hidden")) hud.classList.add("hidden");
    return;
  }

  // Show HUD
  hud.classList.remove("hidden");

  const lat = Cesium.Math.toDegrees(carto.latitude);
  const lng = Cesium.Math.toDegrees(carto.longitude);

  // Update coords + meta immediately (local, no network)
  const locCoords = elements.locCoords;
  const locMeta   = elements.locMeta;
  if (locCoords) {
    locCoords.textContent =
      `${lat >= 0 ? "N" : "S"}${Math.abs(lat).toFixed(4)}°  ` +
      `${lng >= 0 ? "E" : "W"}${Math.abs(lng).toFixed(4)}°`;
  }
  if (locMeta) {
    locMeta.textContent = `ALT ${altKm.toFixed(0)} km  ·  ZOOM ${altKm < 300 ? "HIGH" : altKm < 1500 ? "MED" : "LOW"}`;
  }

  // Debounce geocode: only fire if we moved > ~0.12° or 3s passed
  const moved = _locLastLat === null ||
    Math.abs(lat - _locLastLat) > 0.12 ||
    Math.abs(lng - _locLastLng) > 0.12;

  if (moved) {
    clearTimeout(_locGeocodeTimer);
    _locGeocodeTimer = setTimeout(() => reverseGeocode(lat, lng), 800);
  }
}

async function reverseGeocode(lat, lng) {
  if (_locInFlight) return;
  _locInFlight  = true;
  _locLastLat   = lat;
  _locLastLng   = lng;

  const label  = elements.locLabel;
  const detail = elements.locDetail;

  try {
    const url  = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}&format=json`;
    const resp = await fetch(url, {
      headers: { "Accept-Language": "en-US,en", "User-Agent": "GodsEye/1.0 intelligence-dashboard" }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const addr = data.address || {};

    const country = addr.country  || "";
    const state   = addr.state    || addr.county || "";
    const city    = addr.city     || addr.town   || addr.village || addr.municipality || "";
    const code    = (addr.country_code || "").toUpperCase();

    // Country flag emoji
    const flag = code.length === 2
      ? String.fromCodePoint(...[...code].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)))
      : "";

    if (label)  label.textContent  = `${flag}  ${country || "Open Ocean"}`.trim();
    if (detail) detail.textContent = [city, state].filter(Boolean).join(", ") || "";
  } catch {
    if (label)  label.textContent  = "Scanning…";
    if (detail) detail.textContent = "";
  } finally {
    _locInFlight = false;
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeSearchTerm(value) {
  return String(value ?? "").trim().toLowerCase();
}

function computeSearchScore(query, text) {
  if (!query || !text) return 0;
  const normalizedText = normalizeSearchTerm(text);
  if (!normalizedText.includes(query)) return 0;
  if (normalizedText === query) return 100;
  if (normalizedText.startsWith(query)) return 70;
  return 35;
}

function getEntityLngLat(entity) {
  const position = entity?.position?.getValue?.(viewer.clock.currentTime);
  if (!position) return null;
  const cg = Cesium.Cartographic.fromCartesian(position);
  return {
    lng: Cesium.Math.toDegrees(cg.longitude),
    lat: Cesium.Math.toDegrees(cg.latitude)
  };
}

function getZoneCenter(zone) {
  if (!zone) return null;
  if (zone.kind === "rectangle") {
    return {
      lng: (zone.coordinates.west + zone.coordinates.east) / 2,
      lat: (zone.coordinates.south + zone.coordinates.north) / 2
    };
  }
  if (zone.kind === "polygon" && Array.isArray(zone.coordinates) && zone.coordinates.length) {
    const sums = zone.coordinates.reduce((acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }), { lng: 0, lat: 0 });
    return { lng: sums.lng / zone.coordinates.length, lat: sums.lat / zone.coordinates.length };
  }
  return null;
}

function buildOperationalSearchResults(query) {
  const normalizedQuery = normalizeSearchTerm(query);
  if (!normalizedQuery) return [];

  const results = [];
  const pushResult = (entry) => {
    if (!entry?.score || entry.score <= 0) return;
    results.push(entry);
  };

  SCENARIO.alerts.forEach(alert => {
    const score = Math.max(
      computeSearchScore(normalizedQuery, alert.title),
      computeSearchScore(normalizedQuery, alert.region),
      computeSearchScore(normalizedQuery, alert.summary),
      computeSearchScore(normalizedQuery, alert.tags?.join(" "))
    );
    pushResult({
      id: `alert:${alert.id}`,
      kind: "alert",
      title: alert.title,
      subtitle: `${alert.region} · ${alert.summary}`,
      meta: `${alert.location.lat.toFixed(2)}°, ${alert.location.lng.toFixed(2)}°`,
      lng: alert.location.lng,
      lat: alert.location.lat,
      score
    });
  });

  SCENARIO.incidents.forEach(incident => {
    const score = Math.max(
      computeSearchScore(normalizedQuery, incident.label),
      computeSearchScore(normalizedQuery, incident.description),
      computeSearchScore(normalizedQuery, "incident")
    );
    pushResult({
      id: `incident:${incident.id}`,
      kind: "incident",
      title: incident.label,
      subtitle: incident.description,
      meta: `${incident.location.lat.toFixed(2)}°, ${incident.location.lng.toFixed(2)}°`,
      lng: incident.location.lng,
      lat: incident.location.lat,
      score
    });
  });

  SCENARIO.zones.forEach(zone => {
    const center = getZoneCenter(zone);
    if (!center) return;
    const score = Math.max(
      computeSearchScore(normalizedQuery, zone.label),
      computeSearchScore(normalizedQuery, zone.id),
      computeSearchScore(normalizedQuery, "zone")
    );
    pushResult({
      id: `zone:${zone.id}`,
      kind: "zone",
      title: zone.label,
      subtitle: "Airspace disruption / closure zone",
      meta: `${center.lat.toFixed(2)}°, ${center.lng.toFixed(2)}°`,
      lng: center.lng,
      lat: center.lat,
      score
    });
  });

  state.bookmarks.forEach(bookmark => {
    const score = Math.max(
      computeSearchScore(normalizedQuery, bookmark.label),
      computeSearchScore(normalizedQuery, "bookmark")
    );
    pushResult({
      id: `bookmark:${bookmark.id}`,
      kind: "bookmark",
      title: bookmark.label,
      subtitle: "Saved camera viewpoint",
      meta: `${bookmark.destination.lat.toFixed(2)}°, ${bookmark.destination.lng.toFixed(2)}°`,
      lng: bookmark.destination.lng,
      lat: bookmark.destination.lat,
      score
    });
  });

  [...dynamic.liveTraffic, ...dynamic.traffic].forEach(entity => {
    const info = getEntityInfo(entity);
    const coords = getEntityLngLat(entity);
    if (!info || !coords) return;
    const score = Math.max(
      computeSearchScore(normalizedQuery, info.label),
      computeSearchScore(normalizedQuery, info.description),
      computeSearchScore(normalizedQuery, info.type)
    );
    pushResult({
      id: `track:${entity.id}`,
      kind: "track",
      title: info.label,
      subtitle: `${info.type.toUpperCase()} · ${info.description || "Live monitored entity"}`,
      meta: `${coords.lat.toFixed(2)}°, ${coords.lng.toFixed(2)}°`,
      lng: coords.lng,
      lat: coords.lat,
      entityId: entity.id,
      score
    });
  });

  const deduped = new Map();
  results.sort((a, b) => b.score - a.score).forEach(result => {
    if (!deduped.has(result.id)) deduped.set(result.id, result);
  });
  return Array.from(deduped.values()).slice(0, 8);
}

function parseBoundingBox(rawBoundingBox) {
  if (!Array.isArray(rawBoundingBox) || rawBoundingBox.length !== 4) return null;
  const [southRaw, northRaw, westRaw, eastRaw] = rawBoundingBox.map(Number);
  if ([southRaw, northRaw, westRaw, eastRaw].some(Number.isNaN)) return null;
  const south = Math.min(southRaw, northRaw);
  const north = Math.max(southRaw, northRaw);
  const lonRawSpan = Math.abs(eastRaw - westRaw);
  return {
    south,
    north,
    west: westRaw,
    east: eastRaw,
    latSpan: Math.abs(north - south),
    lonSpan: Math.min(lonRawSpan, 360 - lonRawSpan),
    crossesDateLine: lonRawSpan > 180
  };
}

function haversineKm(latA, lngA, latB, lngB) {
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function collectOperationalPoints() {
  const points = [];

  [...dynamic.liveTraffic, ...dynamic.traffic].forEach(entity => {
    const info = getEntityInfo(entity);
    const coords = getEntityLngLat(entity);
    if (!info || !coords) return;
    points.push({ kind: "track", label: info.label, lat: coords.lat, lng: coords.lng, entityId: entity.id });
  });

  SCENARIO.alerts.forEach(alert => {
    points.push({ kind: "alert", label: alert.title, lat: alert.location.lat, lng: alert.location.lng });
  });
  SCENARIO.incidents.forEach(incident => {
    points.push({ kind: "incident", label: incident.label, lat: incident.location.lat, lng: incident.location.lng });
  });
  SCENARIO.zones.forEach(zone => {
    const center = getZoneCenter(zone);
    if (center) points.push({ kind: "zone", label: zone.label, lat: center.lat, lng: center.lng });
  });

  return points;
}

function applyRegionalContext(label, lng, lat) {
  const radiusKm = 1600;
  const nearby = collectOperationalPoints()
    .map(point => ({ ...point, distanceKm: haversineKm(lat, lng, point.lat, point.lng) }))
    .filter(point => point.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const nearbyTracks = nearby.filter(point => point.kind === "track").length;
  const nearbyAlerts = nearby.filter(point => point.kind !== "track").length;

  if (elements.liveRegionLabel) {
    elements.liveRegionLabel.textContent = `${label.toUpperCase()} · ${nearbyTracks} tracks · ${nearbyAlerts} alerts`;
  }
  if (elements.hudStatusMode) {
    elements.hudStatusMode.textContent = nearby.length ? "REGION FOCUS" : "LIVE FEED";
  }
  if (elements.summaryCopy) {
    if (!nearby.length) {
      elements.summaryCopy.textContent = `${label}: no nearby monitored assets in ${radiusKm.toLocaleString()} km. Live feeds continue to update globally.`;
    } else {
      const nearestPoint = nearby[0];
      elements.summaryCopy.textContent = `${label}: ${nearbyTracks} tracked assets and ${nearbyAlerts} alerts within ${radiusKm.toLocaleString()} km. Nearest signal: ${nearestPoint.label} (${Math.round(nearestPoint.distanceKm)} km).`;
    }
  }
  if (elements.searchMeta) {
    elements.searchMeta.textContent = nearby.length
      ? `Focused on ${label} · ${nearby.length} nearby signals`
      : `Focused on ${label} · no nearby signals`;
  }

  const closestEntity = nearby.find(point => point.entityId);
  if (closestEntity) {
    const entity = viewer.entities.getById(closestEntity.entityId);
    if (entity) {
      state.selectedEntity = entity;
      updateSelectedEntityCard(entity);
    }
  }

  state.regionFocus = {
    label,
    tracks: nearbyTracks,
    alerts: nearbyAlerts,
    summary: !nearby.length
      ? `${label}: no nearby monitored assets in ${radiusKm.toLocaleString()} km. Live feeds continue to update globally.`
      : `${label}: ${nearbyTracks} tracked assets and ${nearbyAlerts} alerts within ${radiusKm.toLocaleString()} km. Nearest signal: ${nearby[0].label} (${Math.round(nearby[0].distanceKm)} km).`,
    timestamp: Date.now()
  };
}

function flyToSearchResult(result) {
  if (!result) return;
  pausePassiveSpin(7000);

  if (result.kind === "geo") {
    const bounds = parseBoundingBox(result.boundingbox);
    const zoomHeight = clamp(Math.max(bounds?.latSpan ?? 8, bounds?.lonSpan ?? 8) * 150000, 1100000, 19000000);
    const flyOptions = {
      destination: Cesium.Cartesian3.fromDegrees(result.lng, result.lat, zoomHeight),
      duration: 1.7,
      complete: () => applyRegionalContext(result.title, result.lng, result.lat)
    };
    if (bounds && !bounds.crossesDateLine && (bounds.latSpan > 1.5 || bounds.lonSpan > 1.5)) {
      flyOptions.destination = Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north);
    }
    viewer.camera.flyTo(flyOptions);
    return;
  }

  if (result.entityId) {
    const entity = viewer.entities.getById(result.entityId);
    if (entity) {
      state.selectedEntity = entity;
      updateSelectedEntityCard(entity);
    }
  }

  const height = result.kind === "track" ? 1800000 : result.kind === "zone" ? 2800000 : 2300000;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(result.lng, result.lat, height),
    duration: 1.5,
    complete: () => applyRegionalContext(result.title, result.lng, result.lat)
  });
}

function setSearchCursor(index) {
  const buttons = Array.from(elements.searchResults.querySelectorAll(".search-result"));
  if (!buttons.length) {
    state.searchCursorIndex = -1;
    return;
  }

  const nextIndex = clamp(index, 0, buttons.length - 1);
  state.searchCursorIndex = nextIndex;
  buttons.forEach((button, buttonIndex) => {
    const active = buttonIndex === nextIndex;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-selected", String(active));
  });

  buttons[nextIndex].scrollIntoView({ block: "nearest" });
}

function activateSearchResultByIndex(index) {
  const result = state.searchFlatResults[index];
  if (!result) return;
  elements.searchResults.classList.add("hidden");
  elements.searchInput.value = result.title;
  flyToSearchResult(result);
}

async function runSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    elements.searchResults.classList.add("hidden");
    state.searchFlatResults = [];
    state.searchCursorIndex = -1;
    if (elements.searchMeta) elements.searchMeta.textContent = "Type a place or live object to jump into active context.";
    return;
  }

  if (state.searchAbortController) state.searchAbortController.abort();
  state.searchAbortController = new AbortController();

  const operationalResults = buildOperationalSearchResults(trimmed);
  if (elements.searchMeta) elements.searchMeta.textContent = "Searching global geospatial index…";

  let placeResults = [];
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=7&q=${encodeURIComponent(trimmed)}`,
      { signal: state.searchAbortController.signal, headers: { Accept: "application/json" } }
    );
    const payload = await response.json();
    placeResults = Array.isArray(payload)
      ? payload
        .map(result => ({
          id: `geo:${result.place_id}`,
          kind: "geo",
          title: result.display_name?.split(",")?.[0]?.trim() || "Unknown location",
          subtitle: result.display_name ?? "Geographic result",
          meta: `${result.type || "place"} · ${result.class || "geography"}`,
          lng: Number(result.lon),
          lat: Number(result.lat),
          boundingbox: result.boundingbox ?? null
        }))
        .filter(result => Number.isFinite(result.lng) && Number.isFinite(result.lat))
      : [];
  } catch {
    placeResults = [];
  }

  renderSearchResults(trimmed, operationalResults, placeResults);
}

function appendSearchGroup(label, results, startIndex) {
  if (!results.length) return;
  const header = document.createElement("div");
  header.className = "search-group-label";
  header.textContent = label;
  elements.searchResults.appendChild(header);

  let cursor = startIndex;
  results.forEach(result => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-result";
    btn.setAttribute("role", "option");
    btn.dataset.searchIndex = String(cursor);
    btn.innerHTML = `
      <span class="search-result-head">
        <span class="search-result-kind">${escapeHtml(result.kind)}</span>
        <strong>${escapeHtml(result.title)}</strong>
      </span>
      <span class="search-result-sub">${escapeHtml(result.subtitle)}</span>
      <span class="search-result-meta">${escapeHtml(result.meta)}</span>
    `;
    btn.addEventListener("mouseenter", () => setSearchCursor(Number(btn.dataset.searchIndex)));
    btn.addEventListener("click", () => activateSearchResultByIndex(Number(btn.dataset.searchIndex)));
    elements.searchResults.appendChild(btn);
    cursor += 1;
  });

  return cursor;
}

function renderSearchResults(query, operationalResults, placeResults) {
  const op = operationalResults.slice(0, 6);
  const geo = placeResults.slice(0, 6);
  state.searchFlatResults = [...op, ...geo];
  state.searchCursorIndex = -1;

  if (!op.length && !geo.length) {
    elements.searchResults.classList.add("hidden");
    if (elements.searchMeta) elements.searchMeta.textContent = `No matches found for “${query}”.`;
    return;
  }

  elements.searchResults.innerHTML = "";
  elements.searchResults.setAttribute("role", "listbox");
  let nextIndex = 0;
  nextIndex = appendSearchGroup("Operational Matches", op, nextIndex) ?? nextIndex;
  nextIndex = appendSearchGroup("Geographic Matches", geo, nextIndex) ?? nextIndex;
  elements.searchResults.classList.remove("hidden");
  if (state.searchFlatResults.length) setSearchCursor(0);

  if (elements.searchMeta) {
    const total = op.length + geo.length;
    elements.searchMeta.textContent = `${total} results · ${op.length} operational · ${geo.length} geographic`;
  }
}

function registerEvents() {
  if (elements.refreshInterval) {
    elements.refreshInterval.addEventListener("input", event => {
      state.refreshIntervalSec = Number(event.target.value);
      if (elements.refreshIntervalVal) elements.refreshIntervalVal.textContent = `${state.refreshIntervalSec}s`;
      scheduleRefresh();
    });
  }

  elements.fxIntensity.addEventListener("input", event => {
    state.fxIntensity = Number(event.target.value);
    applyFxIntensity();
  });
  elements.fxGlow.addEventListener("input", event => {
    state.fxGlow = Number(event.target.value);
    applyGlow();
  });

  elements.saveBookmark.addEventListener("click",  saveCurrentBookmark);
  elements.clearBookmarks.addEventListener("click", () => {
    state.bookmarks = [];
    saveJson(STORAGE_KEYS.bookmarks, state.bookmarks);
    renderBookmarks();
  });

  elements.refreshFeeds?.addEventListener("click",       () => refreshLiveFeeds());
  elements.saveAisEndpoint?.addEventListener("click",    () => {
    const endpoint = elements.aisEndpoint.value.trim();
    setConfiguredAisEndpoint(endpoint);
    if (elements.feedHint) elements.feedHint.textContent = endpoint ? "AIS endpoint saved. Refreshing\u2026" : "AIS endpoint cleared.";
    refreshLiveFeeds();
  });
  elements.clearAisEndpoint?.addEventListener("click",   () => {
    elements.aisEndpoint.value = "";
    setConfiguredAisEndpoint("");
    if (elements.feedHint) elements.feedHint.textContent = "AIS endpoint cleared.";
    refreshLiveFeeds();
  });
  elements.testAisEndpoint?.addEventListener("click",    testAisEndpoint);
  elements.refreshNow?.addEventListener("click",         () => refreshLiveFeeds());
  elements.btnFullscreen?.addEventListener("click",      () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  elements.btnDeclutter?.addEventListener("click",       () => { state.declutter = !state.declutter; applyDeclutterMode(); });
  elements.btnDensity?.addEventListener("click",         () => { state.compact   = !state.compact;   applyDensityMode();   });
  elements.closeIntelSheet?.addEventListener("click",    closeIntelSheet);
  elements.clpClose?.addEventListener("click",            hideClickLocationPopup);
  elements.ccbClose?.addEventListener("click",            hideClickLocationPopup);
  elements.mobileBackdrop?.addEventListener("click",     () => { setMobileDrawer(null); closeIntelSheet(); });
  elements.btnMobileLayers?.addEventListener("click",    () => setMobileDrawer("layers"));
  elements.btnMobileControls?.addEventListener("click",  () => setMobileDrawer("controls"));
  elements.btnMobileIntel?.addEventListener("click",     () => { if (state.selectedEntity) openIntelSheet(state.selectedEntity); });
  elements.trackSelected?.addEventListener("click",      () => {
    if (state.selectedEntity) {
      viewer.trackedEntity = state.selectedEntity;
      state.trackedEntity  = state.selectedEntity;
      updateTrackButtons();
    }
  });
  elements.releaseTrack?.addEventListener("click",       () => {
    viewer.trackedEntity = undefined;
    state.trackedEntity  = null;
    updateTrackButtons();
  });

  elements.searchButton?.addEventListener("click",  () => runSearch(elements.searchInput.value));
  elements.searchInput?.addEventListener("input", event => {
    if (state.searchDebounceTimer) window.clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = window.setTimeout(() => runSearch(event.target.value), 220);
  });
  elements.searchInput?.addEventListener("focus", () => {
    if (elements.searchInput.value.trim()) runSearch(elements.searchInput.value);
  });
  elements.searchInput?.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (elements.searchResults.classList.contains("hidden")) {
        runSearch(elements.searchInput.value);
        return;
      }
      setSearchCursor(state.searchCursorIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (elements.searchResults.classList.contains("hidden")) {
        runSearch(elements.searchInput.value);
        return;
      }
      setSearchCursor(state.searchCursorIndex - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!elements.searchResults.classList.contains("hidden") && state.searchCursorIndex >= 0) {
        activateSearchResultByIndex(state.searchCursorIndex);
      } else {
        runSearch(elements.searchInput.value);
      }
      return;
    }
    if (event.key === "Escape") {
      elements.searchResults.classList.add("hidden");
      state.searchCursorIndex = -1;
      return;
    }
  });
  document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.closest(".hud-search")) elements.searchResults.classList.add("hidden");
  });

  elements.btnHome?.addEventListener("click",  () => {
    state.regionFocus = null;
    viewer.camera.flyTo({ destination: homeView, duration: 1.6 });
  });
  elements.btnTilt?.addEventListener("click",  () => {
    state.tiltMode = !state.tiltMode;
    elements.btnTilt.classList.toggle("active", state.tiltMode);
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: {
        heading: viewer.camera.heading,
        pitch:   state.tiltMode ? Cesium.Math.toRadians(-38) : Cesium.Math.toRadians(-90),
        roll:    0
      },
      duration: 0.8
    });
  });
  elements.btnSpin?.addEventListener("click",  () => {
    state.spinning = !state.spinning;
    elements.btnSpin.classList.toggle("active", state.spinning);
  });

  viewer.scene.postRender.addEventListener(() => {
    const cg = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
    if (cg && elements.hudCamera) {
      elements.hudCamera.textContent = `ALT ${(cg.height / 1000).toFixed(0)} km \u00b7 HEADING ${Cesium.Math.toDegrees(viewer.camera.heading).toFixed(0)}\u00b0`;
    }
  });

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(click => {
    const picked    = viewer.scene.pick(click.position);
    pausePassiveSpin(5500);
    const cartesian = clickedCartesian(click.position, picked);
    focusCameraOnCartesian(cartesian);
    pulseConsoleFrame("click");

    // Always spawn a ping ripple at the click screen position
    spawnPing(click.position.x, click.position.y);

    if (Cesium.defined(picked) && picked.id) {
      state.selectedEntity = picked.id;
      updateSelectedEntityCard(picked.id);
      showHoverTooltip(picked.id, click.position);
      openIntelSheet(picked.id);
      setMobileDrawer(null);
      hideClickLocationPopup();
    } else {
      state.selectedEntity = null;
      updateSelectedEntityCard(null);
      hideHoverTooltip();

      // Show location popup for blank globe clicks
      if (cartesian) {
        const cg  = Cesium.Cartographic.fromCartesian(cartesian);
        const lat = Cesium.Math.toDegrees(cg.latitude);
        const lng = Cesium.Math.toDegrees(cg.longitude);
        showClickLocationPopup(click.position.x, click.position.y, lat, lng);
      } else {
        hideClickLocationPopup();
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction(() => pausePassiveSpin(6500), Cesium.ScreenSpaceEventType.LEFT_DOWN);
  handler.setInputAction(() => pausePassiveSpin(6500), Cesium.ScreenSpaceEventType.WHEEL);

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
    if (window.innerWidth > 980) setMobileDrawer(null);
  });

  window.addEventListener("keydown", event => {
    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (event.key === "/")                { event.preventDefault(); elements.searchInput.focus(); elements.searchInput.select(); return; }
    if (event.key.toLowerCase() === "f") { state.declutter = !state.declutter; applyDeclutterMode(); return; }
    if (event.key.toLowerCase() === "d") { state.compact   = !state.compact;   applyDensityMode();   return; }
    if (event.key.toLowerCase() === "r") { refreshLiveFeeds(); return; }
    if (event.key.toLowerCase() === "l") { setMobileDrawer(window.innerWidth <= 980 ? "layers"   : null); return; }
    if (event.key.toLowerCase() === "c") { setMobileDrawer(window.innerWidth <= 980 ? "controls" : null); return; }
    if (event.key.toLowerCase() === "n") { toggleNewsPanel(); return; }
    if (event.key.toLowerCase() === "i") { if (state.selectedEntity) openIntelSheet(state.selectedEntity); return; }
    if (event.key === "Escape")          { closeIntelSheet(); elements.searchResults.classList.add("hidden"); closeNewsPanel(); }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   LIVE NEWS MODULE
   ═══════════════════════════════════════════════════════════════════════════ */

function initNewsPanel() {
  // Build category pills
  const nav = elements.newsCatNav;
  if (!nav) return;
  nav.innerHTML = "";
  NEWS_CATEGORIES.forEach(cat => {
    const btn = document.createElement("button");
    btn.className = "news-cat-pill";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", cat.id === state.newsCategory ? "true" : "false");
    btn.dataset.catId = cat.id;
    btn.style.setProperty("--active-color", cat.color);
    btn.innerHTML = `<span class="news-cat-icon">${cat.icon}</span>${cat.label}<span class="news-cat-count" id="news-count-${cat.id}">—</span>`;
    btn.addEventListener("click", () => switchNewsCategory(cat.id));
    nav.appendChild(btn);
  });

  // Wire header buttons
  elements.newsToggleBtn?.addEventListener("click", toggleNewsPanel);
  elements.newsCloseBtn?.addEventListener("click",  closeNewsPanel);
  elements.newsRefreshBtn?.addEventListener("click", () => {
    invalidateNewsCache();
    loadNewsCategory(state.newsCategory, true);
  });
  // Refresh all categories
  elements.newsRefreshAll = document.getElementById("news-refresh-all");
  elements.newsRefreshAll?.addEventListener("click", () => {
    invalidateNewsCache();
    prefetchAllCategories();
  });
  // Pause/play auto-rotation
  elements.newsRotateToggle = document.getElementById("news-rotate-toggle");
  elements.newsRotateToggle?.addEventListener("click", () => {
    const paused = elements.newsRotateToggle.getAttribute("aria-pressed") === "false";
    elements.newsRotateToggle.setAttribute("aria-pressed", paused ? "true" : "false");
    state.newsCategoryPaused = !paused;
  });

  elements.liveNewsHeadline?.addEventListener("mouseenter", () => { state.newsTickerPaused = true; });
  elements.liveNewsHeadline?.addEventListener("mouseleave", () => { state.newsTickerPaused = false; });
  elements.liveNewsHeadline?.addEventListener("focus", () => { state.newsTickerPaused = true; });
  elements.liveNewsHeadline?.addEventListener("blur", () => { state.newsTickerPaused = false; });

  elements.newsBriefing?.addEventListener("mouseenter", () => { state.newsPanelHovering = true; });
  elements.newsBriefing?.addEventListener("mouseleave", () => { state.newsPanelHovering = false; });

  // Auto-refresh every 90 seconds (matches main refresh cadence)
  state.newsRefreshTimer = window.setInterval(() => {
    invalidateNewsCache();
    loadNewsCategory(state.newsCategory, false);
  }, 90_000);

  startNewsTicker();

  // Kick off initial fetch silently (panel starts closed)
  prefetchAllCategories();
}

function toggleNewsPanel() {
  if (state.newsOpen) {
    closeNewsPanel();
  } else {
    openNewsPanel();
  }
}

function openNewsPanel() {
  state.newsOpen = true;
  elements.newsBriefing?.classList.remove("hidden");
  elements.newsToggleBtn?.classList.add("active");
  startNewsCategoryRotation();
  hideBadge();
  if (!state.newsArticles.length) {
    loadNewsCategory(state.newsCategory, true);
  } else {
    renderNewsCards(state.newsArticles);
  }
}

function closeNewsPanel() {
  if (!state.newsOpen) return;
  state.newsOpen = false;
  elements.newsBriefing?.classList.add("hidden");
  elements.newsToggleBtn?.classList.remove("active");
  stopNewsCategoryRotation();
}

async function switchNewsCategory(catId) {
  if (catId === state.newsCategory && state.newsArticles.length) {
    // Just re-render; no re-fetch unless stale
    renderNewsCards(state.newsArticles);
    return;
  }
  state.newsCategory = catId;
  updateCatPillSelection(catId);
  renderNewsSkeletons();
  await loadNewsCategory(catId, false);
}

function updateCatPillSelection(catId) {
  const nav = elements.newsCatNav;
  if (!nav) return;
  nav.querySelectorAll(".news-cat-pill").forEach(pill => {
    const isActive = pill.dataset.catId === catId;
    pill.setAttribute("aria-selected", isActive ? "true" : "false");
    const cat = NEWS_CATEGORIES.find(c => c.id === pill.dataset.catId);
    if (cat) pill.style.setProperty("--active-color", cat.color);
  });
}

async function loadNewsCategory(catId, forceRefresh) {
  if (forceRefresh) {
    invalidateNewsCache();
    renderNewsSkeletons();
    animateRefreshButton(true);
  }
  try {
    const result = await fetchNewsCategory(catId);
    if (catId !== state.newsCategory) return; // category switched mid-fetch
    state.newsArticles  = result.articles ?? [];
    state.newsLastFetched = result.fetchedAt ?? new Date();
    setNewsUpdatedLabel(state.newsLastFetched);
    renderNewsCards(state.newsArticles);
    updateCategoryCount(catId, state.newsArticles.length);
    updateBadge(state.newsArticles.length);
    if (state.newsCategory === catId) {
      setNewsTickerPool(state.newsArticles);
    }
  } catch (err) {
    renderNewsError(`Fetch failed: ${err?.message ?? "Network error"}`);
  } finally {
    animateRefreshButton(false);
  }
}

async function prefetchAllCategories() {
  try {
    const all = await fetchAllNewsCategories();
    const combinedPool = [];
    Object.entries(all).forEach(([catId, result]) => {
      const catArticles = result.articles ?? [];
      updateCategoryCount(catId, catArticles.length);
      combinedPool.push(...catArticles.slice(0, 4));
    });
    setNewsTickerPool(combinedPool);

    // Seed default category
    const defaultResult = all[state.newsCategory];
    if (defaultResult?.articles?.length) {
      state.newsArticles   = defaultResult.articles;
      state.newsLastFetched = defaultResult.fetchedAt;
      setNewsUpdatedLabel(state.newsLastFetched);
      updateBadge(state.newsArticles.length);
    }
  } catch { /* silent — will load on open */ }
}

// ── Renderers ──────────────────────────────────────────────────────────────

function renderNewsSkeletons() {
  if (!elements.newsCards) return;
  elements.newsCards.innerHTML = `
    <div class="news-skeleton-list">
      <div class="news-skeleton"></div>
      <div class="news-skeleton"></div>
      <div class="news-skeleton"></div>
      <div class="news-skeleton"></div>
      <div class="news-skeleton"></div>
    </div>`;
}

function renderNewsError(message) {
  if (!elements.newsCards) return;
  elements.newsCards.innerHTML = `<div class="news-error">⚠ ${escHtml(message)}</div>`;
}

function renderNewsCards(articles) {
  if (!elements.newsCards) return;
  if (!articles.length) {
    elements.newsCards.innerHTML = `<div class="news-empty">No articles found. Try another category or refresh.</div>`;
    return;
  }
  const cat = NEWS_CATEGORIES.find(c => c.id === state.newsCategory) ?? NEWS_CATEGORIES[0];
  const frag = document.createDocumentFragment();
  articles.forEach((article, i) => {
    const card = buildNewsCard(article, cat, i);
    frag.appendChild(card);
  });
  elements.newsCards.innerHTML = "";
  elements.newsCards.appendChild(frag);
}

function buildNewsCard(article, cat, index) {
  const a = document.createElement("a");
  a.className = "news-card";
  a.href = article.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.setProperty("--card-accent", cat.color);
  a.style.animationDelay = `${index * 0.045}s`;
  a.setAttribute("role", "listitem");

  const thumbWrap = document.createElement("div");
  thumbWrap.className = "news-card-thumb-wrap";

  const fallback = document.createElement("span");
  fallback.className = "news-card-thumb-fallback";
  fallback.textContent = cat.icon;

  if (article.image) {
    const img = document.createElement("img");
    img.className = "news-card-thumb";
    img.src = article.image;
    img.alt = "";
    img.loading = "lazy";
    fallback.style.display = "none";
    img.addEventListener("error", () => {
      img.remove();
      fallback.style.display = "flex";
    });
    thumbWrap.appendChild(img);
  }
  thumbWrap.appendChild(fallback);

  const body = document.createElement("div");
  body.className = "news-card-body";

  const meta = document.createElement("div");
  meta.className = "news-card-meta";

  const catChip = document.createElement("span");
  catChip.className = "news-card-cat";
  catChip.style.background = cat.color;
  catChip.textContent = cat.label;

  const outlet = document.createElement("span");
  outlet.className = "news-card-outlet";

  const favicon = document.createElement("img");
  favicon.className = "news-outlet-favicon";
  favicon.src = article.favicon;
  favicon.alt = "";
  favicon.loading = "lazy";
  favicon.addEventListener("error", () => favicon.remove());

  const domain = document.createElement("span");
  domain.className = "news-outlet-domain";
  domain.textContent = article.domain;

  outlet.appendChild(favicon);
  outlet.appendChild(domain);
  meta.appendChild(catChip);
  meta.appendChild(outlet);

  const title = document.createElement("div");
  title.className = "news-card-title";
  title.textContent = article.title;

  const time = document.createElement("div");
  time.className = "news-card-time";
  time.textContent = `${article.relativeTime}${article.country ? ` · ${article.country}` : ""}`;

  body.appendChild(meta);
  body.appendChild(title);
  body.appendChild(time);

  a.appendChild(thumbWrap);
  a.appendChild(body);
  return a;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function setNewsTickerPool(items) {
  if (!Array.isArray(items) || !items.length) return;
  const deduped = [];
  const seen = new Set();
  items.forEach(item => {
    const key = item?.url || item?.title;
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });
  state.newsTickerPool = deduped.slice(0, 24);
  state.newsTickerIndex = 0;
  renderNewsTickerHeadline();
}

function startNewsTicker() {
  if (!elements.liveNewsHeadline) return;
  renderNewsTickerHeadline();
  if (state.newsTickerTimer) window.clearInterval(state.newsTickerTimer);
  state.newsTickerTimer = window.setInterval(() => {
    if (state.newsTickerPaused) return;
    if (!state.newsTickerPool.length) return;
    state.newsTickerIndex = (state.newsTickerIndex + 1) % state.newsTickerPool.length;
    renderNewsTickerHeadline(true);
  }, 12000);
}

function startNewsCategoryRotation() {
  if (state.newsCategoryTimer) window.clearInterval(state.newsCategoryTimer);
  state.newsCategoryTimer = window.setInterval(() => {
    if (!state.newsOpen || state.newsPanelHovering || state.newsCategoryPaused) return;
    rotateToNextNewsCategory();
  }, 22000);
}

function stopNewsCategoryRotation() {
  if (!state.newsCategoryTimer) return;
  window.clearInterval(state.newsCategoryTimer);
  state.newsCategoryTimer = null;
}

function rotateToNextNewsCategory() {
  const index = NEWS_CATEGORIES.findIndex(category => category.id === state.newsCategory);
  const nextIndex = index >= 0 ? (index + 1) % NEWS_CATEGORIES.length : 0;
  const nextCategory = NEWS_CATEGORIES[nextIndex];
  if (!nextCategory) return;
  switchNewsCategory(nextCategory.id);
}

function renderNewsTickerHeadline(animate = false) {
  const el = elements.liveNewsHeadline;
  if (!el) return;
  if (!state.newsTickerPool.length) {
    el.href = "https://www.gdeltproject.org";
    el.textContent = "🛰 Live headlines initializing…";
    return;
  }

  const item = state.newsTickerPool[state.newsTickerIndex] ?? state.newsTickerPool[0];
  el.href = item.url;
  el.textContent = `🛰 ${item.title}`;
  if (animate) {
    el.classList.remove("updating");
    void el.offsetWidth;
    el.classList.add("updating");
  }
}

function setNewsUpdatedLabel(date) {
  if (!elements.newsUpdated || !date) return;
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  elements.newsUpdated.textContent = mins < 1 ? "Just now" : `${mins}m ago`;
}

function updateCategoryCount(catId, count) {
  const el = document.getElementById(`news-count-${catId}`);
  if (el) el.textContent = count > 0 ? String(count) : "—";
}

function updateBadge(count) {
  if (!elements.newsBadge) return;
  if (!state.newsOpen && count > 0) {
    elements.newsBadge.textContent = count > 99 ? "99+" : String(count);
    elements.newsBadge.classList.remove("hidden");
  }
}

  articles.forEach((article, i) => {
    const card = buildNewsCard(article, cat, i);
    card.tabIndex = 0;
    card.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "Tab") {
        e.preventDefault();
        const next = card.nextElementSibling;
        if (next) next.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = card.previousElementSibling;
        if (prev) prev.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        card.click();
      }
    });
    frag.appendChild(card);
  });
function animateRefreshButton(spinning) {
  if (!elements.newsRefreshBtn) return;
  elements.newsRefreshBtn.classList.toggle("spinning", spinning);
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
