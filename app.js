"use strict";

const PROXY = "https://corsproxy.io/?url=";
const OPENSKY_ENDPOINT = "https://opensky-network.org/api/states/all";
const TELEMETRY_TIMEOUT_MS = 4000;
const DASHBOARD_PREFERENCES_KEY = "gods-eye-dashboard-preferences";
const DASHBOARD_PREFERENCE_KEYS = [
  "tileKey",
  "mode",
  "region",
  "showFlights",
  "showSats",
  "showTrails",
  "showCamPins",
  "showGlobe",
  "autoRotate",
  "selectedCameraId",
  "autoCycleEnabled",
  "mosaicEnabled"
];
const TELEMETRY_SOURCES = [
  {
    label: "OpenSky direct",
    buildUrl: url => url
  },
  {
    label: "AllOrigins proxy",
    buildUrl: url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
  },
  {
    label: "CORSProxy mirror",
    buildUrl: url => `${PROXY}${encodeURIComponent(url)}`
  },
  {
    label: "CodeTabs proxy",
    buildUrl: url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  }
];

const TILES = {
  ESRI_SAT: {
    label: "🛰 Esri Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    attribution: "Esri World Imagery"
  },
  ESRI_TOPO: {
    label: "🏔 Esri Topo",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    attribution: "Esri World Topo"
  },
  ESRI_DARK: {
    label: "🌑 Esri Dark",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 16,
    attribution: "Esri Dark Gray"
  },
  GOOGLE_SAT: {
    label: "🌍 Google Satellite",
    url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    maxZoom: 20,
    attribution: "Google Satellite"
  },
  GOOGLE_HYB: {
    label: "🌆 Google Hybrid",
    url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    maxZoom: 20,
    attribution: "Google Hybrid"
  },
  OSM: {
    label: "🗺 OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    attribution: "OpenStreetMap"
  }
};

const MODES = {
  NORMAL: {
    label: "NORMAL",
    accent: "#1ee6ff",
    mapFilter: "brightness(0.92) saturate(1.1)",
    panelTone: "#1ee6ff"
  },
  NIGHTVISION: {
    label: "NV-MODE",
    accent: "#42ff8f",
    mapFilter: "grayscale(1) brightness(0.42) sepia(1) hue-rotate(82deg) saturate(5.8) contrast(1.18)",
    panelTone: "#42ff8f"
  },
  FLIR: {
    label: "FLIR",
    accent: "#ffbc42",
    mapFilter: "grayscale(1) brightness(0.5) sepia(1) hue-rotate(-14deg) saturate(8.5) contrast(1.34)",
    panelTone: "#ffbc42"
  },
  TACTICAL: {
    label: "TACTICAL",
    accent: "#78a7ff",
    mapFilter: "grayscale(1) brightness(0.28) sepia(1) hue-rotate(190deg) saturate(4.4) contrast(1.25)",
    panelTone: "#78a7ff"
  }
};

const REGIONS = {
  GLOBAL: { n: 85, s: -85, e: 180, w: -180, center: [16, 8], zoom: 2 },
  EUROPE: { n: 72, s: 35, e: 40, w: -12, center: [50, 14], zoom: 4 },
  "N.AMERICA": { n: 63, s: 20, e: -56, w: -132, center: [40, -96], zoom: 3 },
  "M.EAST": { n: 42, s: 16, e: 66, w: 28, center: [28, 47], zoom: 4 },
  "ASIA-PAC": { n: 54, s: -12, e: 156, w: 92, center: [23, 121], zoom: 3 },
  UK: { n: 61, s: 49, e: 3, w: -11, center: [54.3, -2.2], zoom: 5 }
};

const CAMERAS = [
  {
    id: "c01",
    name: "Yellowstone North Gate",
    lat: 45.0156,
    lng: -110.7013,
    src: "https://www.nps.gov/webcams-yell/mammoth_arch.jpg",
    external: "https://www.nps.gov/media/webcam/view.htm?id=81B468BC-1DD8-B71B-0BBA4C383E179188&r=/yell/learn/photosmultimedia/webcams.htm",
    provider: "US National Park Service",
    thumb: "https://www.nps.gov/webcams-yell/mammoth_arch.jpg",
    snapshot: true,
    refreshSeconds: 60,
    region: "N.AMERICA",
    feedClass: "Verified live snapshot"
  },
  {
    id: "c02",
    name: "Tokyo Shinjuku Cam",
    lat: 35.6938,
    lng: 139.7034,
    src: "https://imgproxy.windy.com/_/full/plain/current/1460602673/original.jpg",
    external: "https://www.meteoblue.com/en/weather/webcams/tokyo_japan_1850147",
    provider: "Meteoblue / Windy",
    thumb: "https://imgproxy.windy.com/_/full/plain/current/1460602673/original.jpg",
    snapshot: true,
    refreshSeconds: 20,
    region: "ASIA-PAC",
    feedClass: "Metro live snapshot"
  },
  {
    id: "c03",
    name: "London Trafalgar Cam",
    lat: 51.508,
    lng: -0.128,
    src: "https://imgproxy.windy.com/_/full/plain/current/1420893641/original.jpg",
    external: "https://www.meteoblue.com/en/weather/webcams/london_united-kingdom_2643743",
    provider: "Meteoblue / Windy",
    thumb: "https://imgproxy.windy.com/_/full/plain/current/1420893641/original.jpg",
    snapshot: true,
    refreshSeconds: 20,
    region: "EUROPE",
    feedClass: "City-center live snapshot"
  },
  {
    id: "c04",
    name: "Reykjavík Traffic Cam",
    lat: 64.1466,
    lng: -21.9426,
    src: "https://imgproxy.windy.com/_/full/plain/current/1793876544/original.jpg",
    external: "https://www.meteoblue.com/en/weather/webcams/reykjavik_iceland_3413829",
    provider: "Meteoblue / Windy",
    thumb: "https://imgproxy.windy.com/_/full/plain/current/1793876544/original.jpg",
    snapshot: true,
    refreshSeconds: 20,
    region: "EUROPE",
    feedClass: "Traffic live snapshot"
  },
  {
    id: "c05",
    name: "Sydney Circular Quay",
    lat: -33.8611,
    lng: 151.2107,
    src: "https://imgproxy.windy.com/_/full/plain/current/1503353468/original.jpg",
    external: "https://www.meteoblue.com/en/weather/webcams/sydney_australia_2147714",
    provider: "Meteoblue / Windy",
    thumb: "https://imgproxy.windy.com/_/full/plain/current/1503353468/original.jpg",
    snapshot: true,
    refreshSeconds: 20,
    region: "ASIA-PAC",
    feedClass: "Harbor live snapshot"
  },
  {
    id: "c06",
    name: "Singapore Midview CCTV",
    lat: 1.3521,
    lng: 103.8198,
    src: "https://imgproxy.windy.com/_/full/plain/current/1369190454/original.jpg",
    external: "https://www.meteoblue.com/en/weather/webcams/singapore_singapore_1880252",
    provider: "Meteoblue / Windy",
    thumb: "https://imgproxy.windy.com/_/full/plain/current/1369190454/original.jpg",
    snapshot: true,
    refreshSeconds: 20,
    region: "ASIA-PAC",
    feedClass: "CCTV live snapshot"
  },
  {
    id: "c07",
    name: "Cape Town Table View",
    lat: -33.9249,
    lng: 18.4241,
    src: "https://imgproxy.windy.com/_/full/plain/current/1696337816/original.jpg",
    external: "https://www.meteoblue.com/en/weather/webcams/cape-town_south-africa_3369157",
    provider: "Meteoblue / Windy",
    thumb: "https://imgproxy.windy.com/_/full/plain/current/1696337816/original.jpg",
    snapshot: true,
    refreshSeconds: 20,
    region: "GLOBAL",
    feedClass: "Scenic live snapshot"
  },
  {
    id: "c08",
    name: "Nairobi Wilson Airport",
    lat: -1.3217,
    lng: 36.8148,
    src: "https://imgproxy.windy.com/_/full/plain/current/1723730357/original.jpg",
    external: "https://www.meteoblue.com/en/weather/webcams/nairobi_kenya_184745",
    provider: "Meteoblue / Windy",
    thumb: "https://imgproxy.windy.com/_/full/plain/current/1723730357/original.jpg",
    snapshot: true,
    refreshSeconds: 20,
    region: "GLOBAL",
    feedClass: "Airport live snapshot"
  },
  {
    id: "c09",
    name: "Buenos Aires Exterior",
    lat: -34.6037,
    lng: -58.3816,
    src: "https://imgproxy.windy.com/_/full/plain/current/1691337947/original.jpg",
    external: "https://www.meteoblue.com/en/weather/webcams/buenos-aires_argentina_3435910",
    provider: "Meteoblue / Windy",
    thumb: "https://imgproxy.windy.com/_/full/plain/current/1691337947/original.jpg",
    snapshot: true,
    refreshSeconds: 20,
    region: "GLOBAL",
    feedClass: "Street live snapshot"
  },
  {
    id: "c10",
    name: "Auckland Alfriston Road",
    lat: -36.8485,
    lng: 174.7633,
    src: "https://imgproxy.windy.com/_/full/plain/current/1229966053/original.jpg",
    external: "https://www.meteoblue.com/en/weather/webcams/auckland_new-zealand_2193733",
    provider: "Meteoblue / Windy",
    thumb: "https://imgproxy.windy.com/_/full/plain/current/1229966053/original.jpg",
    snapshot: true,
    refreshSeconds: 20,
    region: "ASIA-PAC",
    feedClass: "Road live snapshot"
  }
];

const SATS_TLE = [
  {
    name: "ISS",
    color: "#1ee6ff",
    tle1: "1 25544U 98067A 25069.50000000 .00021897 00000-0 39330-3 0 9991",
    tle2: "2 25544 51.6400 100.0000 0005000 90.0000 270.0000 15.49600000500000"
  },
  {
    name: "HST",
    color: "#ffbc42",
    tle1: "1 20580U 90037B 25069.50000000 .00000873 00000-0 36600-4 0 9990",
    tle2: "2 20580 28.4700 200.0000 0002600 100.0000 260.0000 15.09260000500000"
  },
  {
    name: "TIANGONG",
    color: "#ff6ca9",
    tle1: "1 48274U 21035A 25069.50000000 .00014800 00000-0 17000-3 0 9996",
    tle2: "2 48274 41.4700 180.0000 0007200 90.0000 270.0000 15.60300000500000"
  },
  {
    name: "STARLINK",
    color: "#8dd4ff",
    tle1: "1 44235U 19029D 25069.50000000 .00001200 00000-0 10000-3 0 9993",
    tle2: "2 44235 53.0000 150.0000 0001400 90.0000 270.0000 15.05800000500000"
  }
];

const state = {
  tileKey: "ESRI_SAT",
  mode: "NORMAL",
  region: "EUROPE",
  showFlights: true,
  showSats: true,
  showTrails: true,
  showCamPins: true,
  showGlobe: true,
  autoRotate: true,
  flights: [],
  satellites: [],
  selectedFlightId: null,
  openskyStatus: "INITIALIZING",
  dataSource: "Awaiting telemetry",
  lastUpdated: null,
  lastLiveAttempt: null,
  demoRegion: null,
  flightTrails: {},
  satTrails: {},
  selectedCameraId: CAMERAS[0].id,
  fetchCount: 0,
  aircraftQuery: "",
  cameraQuery: "",
  isRefreshing: false,
  lastMotionTickAt: null,
  cctvFallbackTimerId: null,
  cctvRefreshTimerId: null,
  cameraCycleTimerId: null,
  cameraFrameNonce: 0,
  autoCycleEnabled: false,
  thumbRefreshTimerId: null,
  lastCameraFrameAt: null,
  feedEvents: [],
  mosaicEnabled: false,
  mosaicRefreshTimerId: null
};

const elements = {};

let map;
let mapReady = false;
let tileLayer;
let trailCanvas;
let trailContext;
let aircraftMarkers = [];
let satelliteMarkers = [];
let cameraMarkers = [];
let globeContext;
let globeRotation = 0;
let satelliteTick = 0;
const cameraThumbFallback =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#081827" />
          <stop offset="100%" stop-color="#112944" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#g)" />
      <circle cx="160" cy="90" r="42" fill="none" stroke="#1ee6ff" stroke-width="3" opacity="0.7" />
      <path d="M140 90h40M160 70v40" stroke="#1ee6ff" stroke-width="3" stroke-linecap="round" opacity="0.85" />
      <text x="160" y="146" text-anchor="middle" fill="#d9f8ff" font-family="Arial, sans-serif" font-size="18">LIVE FEED</text>
    </svg>
  `);

const degToRad = degrees => (degrees * Math.PI) / 180;
const radToDeg = radians => (radians * 180) / Math.PI;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const value = clean.length === 3 ? clean.split("").map(char => `${char}${char}`).join("") : clean;
  const number = Number.parseInt(value, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255
  };
}

function applyAccentTheme(hex) {
  const { r, g, b } = hexToRgb(hex);
  document.documentElement.style.setProperty("--accent", hex);
  document.documentElement.style.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, 0.14)`);
  document.documentElement.style.setProperty("--accent-strong", `rgba(${r}, ${g}, ${b}, 0.34)`);
  document.documentElement.style.setProperty("--border", `rgba(${r}, ${g}, ${b}, 0.18)`);
}

function saveDashboardPreferences() {
  try {
    const payload = DASHBOARD_PREFERENCE_KEYS.reduce((preferences, key) => {
      preferences[key] = state[key];
      return preferences;
    }, {});
    window.localStorage.setItem(DASHBOARD_PREFERENCES_KEY, JSON.stringify(payload));
  } catch {
  }
}

function restoreDashboardPreferences() {
  try {
    const rawPreferences = window.localStorage.getItem(DASHBOARD_PREFERENCES_KEY);
    if (!rawPreferences) {
      return;
    }
    const preferences = JSON.parse(rawPreferences);
    if (preferences.tileKey && TILES[preferences.tileKey]) {
      state.tileKey = preferences.tileKey;
    }
    if (preferences.mode && MODES[preferences.mode]) {
      state.mode = preferences.mode;
    }
    if (preferences.region && REGIONS[preferences.region]) {
      state.region = preferences.region;
    }
    ["showFlights", "showSats", "showTrails", "showCamPins", "showGlobe", "autoRotate", "autoCycleEnabled", "mosaicEnabled"].forEach(key => {
      if (typeof preferences[key] === "boolean") {
        state[key] = preferences[key];
      }
    });
    if (preferences.selectedCameraId && CAMERAS.some(camera => camera.id === preferences.selectedCameraId)) {
      state.selectedCameraId = preferences.selectedCameraId;
    }
  } catch {
  }
}

function cacheElements() {
  Object.assign(elements, {
    app: document.getElementById("app"),
    regionButtons: document.getElementById("region-btns"),
    tileButtons: document.getElementById("tile-btns"),
    modeButtons: document.getElementById("mode-btns"),
    layerRows: document.getElementById("layer-rows"),
    satList: document.getElementById("sat-list"),
    aircraftList: document.getElementById("ac-list"),
    camList: document.getElementById("cam-list"),
    statusText: document.getElementById("status-text"),
    statusDot: document.getElementById("status-dot"),
    sbDot: document.getElementById("sb-dot"),
    sbStatus: document.getElementById("sb-status"),
    sbAircraft: document.getElementById("sb-ac"),
    sbSats: document.getElementById("sb-sats"),
    sbAttr: document.getElementById("sb-attr"),
    sbCams: document.getElementById("sb-cams"),
    metricAircraft: document.getElementById("metric-aircraft"),
    metricSats: document.getElementById("metric-sats"),
    metricMode: document.getElementById("metric-mode"),
    metricUptime: document.getElementById("metric-uptime"),
    missionSource: document.getElementById("mission-source"),
    missionAuth: document.getElementById("mission-auth"),
    missionMotion: document.getElementById("mission-motion"),
    missionRegion: document.getElementById("mission-region"),
    missionFlight: document.getElementById("mission-flight"),
    aircraftCount: document.getElementById("ac-count"),
    hudTopLeft: document.getElementById("hud-tl"),
    hudMode: document.getElementById("hud-mode"),
    hudBottomLeftText: document.getElementById("hud-bl-text"),
    hudStatusDot: document.getElementById("hud-status-dot"),
    globePanel: document.getElementById("globe-panel"),
    globeCanvas: document.getElementById("globe-canvas"),
    cctvOverlay: document.getElementById("cctv-overlay"),
    cctvTitle: document.getElementById("cctv-title"),
    cctvCoords: document.getElementById("cctv-coords"),
    cctvProvider: document.getElementById("cctv-provider"),
    cctvFeedClass: document.getElementById("cctv-feed-class"),
    cctvRefreshMeta: document.getElementById("cctv-refresh-meta"),
    cctvIframe: document.getElementById("cctv-iframe"),
    cctvImg: document.getElementById("cctv-img"),
    cctvThumbs: document.getElementById("cctv-thumbs"),
    cctvLiveTime: document.getElementById("cctv-live-time"),
    cctvOpenSource: document.getElementById("cctv-open-source"),
    cctvFallback: document.getElementById("cctv-fallback"),
    cctvFallbackImage: document.getElementById("cctv-fallback-image"),
    cctvFallbackTitle: document.getElementById("cctv-fallback-title"),
    cctvFallbackText: document.getElementById("cctv-fallback-text"),
    refreshFeedButton: document.getElementById("refresh-feed-btn"),
    focusFlightButton: document.getElementById("focus-flight-btn"),
    cctvButton: document.getElementById("cctv-btn"),
    cctvClose: document.getElementById("cctv-close"),
    cctvRefreshNow: document.getElementById("cctv-refresh-now"),
    cctvNextFeed: document.getElementById("cctv-next-feed"),
    cctvAutoCycle: document.getElementById("cctv-auto-cycle"),
    cctvMosaicToggle: document.getElementById("cctv-mosaic-toggle"),
    cctvMosaic: document.getElementById("cctv-mosaic"),
    sidebarToggle: document.getElementById("sidebar-toggle"),
    mobileBackdrop: document.getElementById("mobile-backdrop"),
    aircraftSearch: document.getElementById("ac-search"),
    cameraSearch: document.getElementById("cam-search"),
    signalFeedClass: document.getElementById("signal-feed-class"),
    signalSelectedCamera: document.getElementById("signal-selected-camera"),
    signalCameraCadence: document.getElementById("signal-camera-cadence"),
    signalCameraMode: document.getElementById("signal-camera-mode"),
    signalFrameAge: document.getElementById("signal-frame-age"),
    feedLog: document.getElementById("feed-log")
  });
}

function formatUtcTime(date) {
  return `${date.toISOString().split("T")[1].split(".")[0]} UTC`;
}

function filteredAircraft() {
  const query = state.aircraftQuery.trim().toLowerCase();
  if (!query) {
    return state.flights;
  }
  return state.flights.filter(flight => {
    return [flight.callsign, flight.country, flight.id]
      .filter(Boolean)
      .some(value => value.toLowerCase().includes(query));
  });
}

function filteredCameras() {
  const query = state.cameraQuery.trim().toLowerCase();
  if (!query) {
    return CAMERAS;
  }
  return CAMERAS.filter(camera => {
    return [camera.name, camera.provider, camera.region, camera.feedClass]
      .filter(Boolean)
      .some(value => value.toLowerCase().includes(query));
  });
}

function selectedCamera() {
  return CAMERAS.find(camera => camera.id === state.selectedCameraId) || CAMERAS[0];
}

function cameraCadenceLabel(camera) {
  if (!camera) {
    return "Standby";
  }
  if (camera.refreshSeconds) {
    return `${camera.refreshSeconds}s source · ${cameraLoopSeconds(camera)}s loop`;
  }
  if (camera.mjpeg) {
    return "Continuous stream";
  }
  return "External source";
}

function cameraLoopSeconds(camera) {
  if (!camera) {
    return 0;
  }
  if (camera.snapshot && camera.refreshSeconds) {
    return clamp(Math.round(camera.refreshSeconds / 4), 4, 12);
  }
  if (camera.mjpeg) {
    return 1;
  }
  return 0;
}

function cameraModeLabel(camera) {
  if (!camera) {
    return "Standby";
  }
  if (camera.snapshot) {
    return "Live snapshot";
  }
  if (camera.mjpeg) {
    return "Direct stream";
  }
  if (camera.externalOnly) {
    return "External stream";
  }
  return "Embedded feed";
}

function cacheBustedUrl(url) {
  state.cameraFrameNonce += 1;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}ts=${Date.now()}-${state.cameraFrameNonce}`;
}

function formatRelativeAge(date) {
  if (!date) {
    return "Awaiting lock";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 2) {
    return "Just updated";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

function pushFeedEvent(message, tone = "info") {
  state.feedEvents.unshift({
    message,
    tone,
    timestamp: new Date()
  });
  state.feedEvents = state.feedEvents.slice(0, 8);
}

function mosaicWindow() {
  const selectedIndex = CAMERAS.findIndex(camera => camera.id === state.selectedCameraId);
  const startIndex = selectedIndex >= 0 ? selectedIndex : 0;
  return Array.from({ length: Math.min(4, CAMERAS.length) }, (_, offset) => CAMERAS[(startIndex + offset) % CAMERAS.length]);
}

function renderFeedLog() {
  if (!elements.feedLog) {
    return;
  }
  if (!state.feedEvents.length) {
    elements.feedLog.innerHTML = '<div class="empty-state">No camera events logged yet.</div>';
    return;
  }
  elements.feedLog.innerHTML = state.feedEvents
    .map(event => {
      return `
        <article class="feed-log-row ${event.tone}">
          <span class="feed-log-time">${formatUtcTime(event.timestamp)}</span>
          <span class="feed-log-copy">${event.message}</span>
        </article>
      `;
    })
    .join("");
}

function renderCctvMosaic() {
  if (!elements.cctvMosaic) {
    return;
  }
  if (!state.mosaicEnabled) {
    elements.cctvMosaic.classList.remove("open");
    elements.cctvMosaic.innerHTML = "";
    return;
  }

  const cameras = mosaicWindow();
  elements.cctvMosaic.classList.add("open");
  elements.cctvMosaic.innerHTML = "";

  cameras.forEach(camera => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `mosaic-tile${camera.id === state.selectedCameraId ? " active" : ""}`;
    tile.innerHTML = `
      <img src="${cacheBustedUrl(camera.thumb || camera.src)}" alt="${camera.name} mosaic tile">
      <span class="mosaic-label">${camera.name}</span>
      <span class="mosaic-meta">${camera.region || "GLOBAL"} · ${cameraLoopSeconds(camera)}s loop</span>
    `;
    tile.addEventListener("click", () => {
      state.selectedCameraId = camera.id;
      pushFeedEvent(`Mosaic focus shifted: ${camera.name}`, "success");
      openCCTV(camera, { reason: "Mosaic focus" });
    });
    elements.cctvMosaic.appendChild(tile);
  });
}

function refreshMosaicFrames() {
  if (!state.mosaicEnabled || !elements.cctvMosaic.classList.contains("open")) {
    return;
  }
  elements.cctvMosaic.querySelectorAll(".mosaic-tile img").forEach((image, index) => {
    const camera = mosaicWindow()[index];
    if (camera) {
      image.src = cacheBustedUrl(camera.thumb || camera.src);
    }
  });
}

function startMosaicRefreshLoop() {
  if (state.mosaicRefreshTimerId) {
    window.clearInterval(state.mosaicRefreshTimerId);
  }
  if (!state.mosaicEnabled) {
    state.mosaicRefreshTimerId = null;
    return;
  }
  state.mosaicRefreshTimerId = window.setInterval(() => {
    if (elements.cctvOverlay.classList.contains("open")) {
      refreshMosaicFrames();
    }
  }, 6000);
}

function toggleMosaicMode() {
  state.mosaicEnabled = !state.mosaicEnabled;
  pushFeedEvent(state.mosaicEnabled ? "Mosaic wall engaged" : "Mosaic wall disengaged", state.mosaicEnabled ? "success" : "info");
  if (state.mosaicEnabled) {
    renderCctvMosaic();
    startMosaicRefreshLoop();
  } else {
    if (state.mosaicRefreshTimerId) {
      window.clearInterval(state.mosaicRefreshTimerId);
      state.mosaicRefreshTimerId = null;
    }
    renderCctvMosaic();
  }
  saveDashboardPreferences();
  refreshUI();
}

function stopCctvTimers() {
  if (state.cctvFallbackTimerId) {
    window.clearTimeout(state.cctvFallbackTimerId);
    state.cctvFallbackTimerId = null;
  }
  if (state.cctvRefreshTimerId) {
    window.clearInterval(state.cctvRefreshTimerId);
    state.cctvRefreshTimerId = null;
  }
  if (state.cameraCycleTimerId) {
    window.clearInterval(state.cameraCycleTimerId);
    state.cameraCycleTimerId = null;
  }
  if (state.thumbRefreshTimerId) {
    window.clearInterval(state.thumbRefreshTimerId);
    state.thumbRefreshTimerId = null;
  }
  if (state.mosaicRefreshTimerId) {
    window.clearInterval(state.mosaicRefreshTimerId);
    state.mosaicRefreshTimerId = null;
  }
}

function refreshSnapshotFrame(camera, options = {}) {
  if (!camera || !camera.snapshot) {
    return;
  }
  const { logReason = null } = options;
  const nextUrl = cacheBustedUrl(camera.src);
  const frameLoader = new Image();
  frameLoader.onload = () => {
    elements.cctvIframe.style.display = "none";
    elements.cctvImg.style.display = "block";
    elements.cctvImg.classList.remove("frame-swap");
    void elements.cctvImg.offsetWidth;
    elements.cctvImg.src = nextUrl;
    elements.cctvImg.classList.add("frame-swap");
    state.lastCameraFrameAt = new Date();
    hideCctvFallback();
    if (logReason) {
      pushFeedEvent(`${logReason}: ${camera.name}`);
    }
    refreshUI();
  };
  frameLoader.onerror = () => {
    elements.cctvImg.style.display = "none";
    showCctvFallback(camera, "Snapshot unavailable", "The live snapshot did not refresh in this browser. Use Open Source to view the provider page directly.");
    pushFeedEvent(`Frame refresh failed: ${camera.name}`, "warn");
    refreshUI();
  };
  frameLoader.src = nextUrl;
}

function startCctvRefresh(camera) {
  if (!camera || (!camera.snapshot && !camera.mjpeg)) {
    return;
  }
  if (state.cctvRefreshTimerId) {
    window.clearInterval(state.cctvRefreshTimerId);
  }
  if (camera.snapshot && camera.refreshSeconds) {
    state.cctvRefreshTimerId = window.setInterval(() => {
      if (elements.cctvOverlay.classList.contains("open") && state.selectedCameraId === camera.id) {
        refreshSnapshotFrame(camera);
      }
    }, cameraLoopSeconds(camera) * 1000);
  }
}

function refreshCameraThumbs() {
  const thumbNodes = elements.cctvThumbs.querySelectorAll(".cam-thumb img");
  CAMERAS.forEach((camera, index) => {
    if (!camera.snapshot) {
      return;
    }
    const thumbImage = thumbNodes[index];
    if (thumbImage) {
      thumbImage.src = cacheBustedUrl(camera.thumb || camera.src);
    }
  });
}

function startThumbRefreshLoop() {
  if (state.thumbRefreshTimerId) {
    window.clearInterval(state.thumbRefreshTimerId);
  }
  state.thumbRefreshTimerId = window.setInterval(() => {
    if (elements.cctvOverlay.classList.contains("open")) {
      refreshCameraThumbs();
    }
  }, 8000);
}

function cycleToNextCamera() {
  const currentIndex = CAMERAS.findIndex(camera => camera.id === state.selectedCameraId);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % CAMERAS.length : 0;
  openCCTV(CAMERAS[nextIndex], { reason: "Patrol advanced" });
}

function syncCameraCycleState() {
  if (state.cameraCycleTimerId) {
    window.clearInterval(state.cameraCycleTimerId);
    state.cameraCycleTimerId = null;
  }
  if (state.autoCycleEnabled) {
    state.cameraCycleTimerId = window.setInterval(cycleToNextCamera, 12000);
  }
}

function toggleCameraCycle() {
  state.autoCycleEnabled = !state.autoCycleEnabled;
  syncCameraCycleState();
  pushFeedEvent(state.autoCycleEnabled ? "Patrol mode engaged" : "Patrol mode disengaged", state.autoCycleEnabled ? "success" : "info");
  saveDashboardPreferences();
  refreshUI();
}

function flightColor(altitude) {
  if (altitude < 3000) {
    return "#ff5c7b";
  }
  if (altitude < 7000) {
    return "#ffbc42";
  }
  return "#1ee6ff";
}

function normalizeLongitude(longitude) {
  return ((longitude + 540) % 360) - 180;
}

function pushFlightTrail(flightId, lat, lng, maxPoints = 72) {
  if (!state.flightTrails[flightId]) {
    state.flightTrails[flightId] = [];
  }
  const trail = state.flightTrails[flightId];
  const lastPoint = trail[trail.length - 1];
  if (!lastPoint || Math.abs(lastPoint.lat - lat) > 0.001 || Math.abs(lastPoint.lng - lng) > 0.001) {
    trail.push({ lat, lng });
  }
  if (trail.length > maxPoints) {
    trail.splice(0, trail.length - maxPoints);
  }
  return trail;
}

function seededValue(seed) {
  const base = Math.sin(seed) * 10000;
  return base - Math.floor(base);
}

function createMockFlights(regionKey) {
  const region = REGIONS[regionKey];
  const count = regionKey === "GLOBAL" ? 30 : 16;
  return Array.from({ length: count }, (_, index) => {
    const seed = index * 17 + regionKey.length * 31;
    const lat = region.s + seededValue(seed) * (region.n - region.s);
    const lng = region.w + seededValue(seed + 1) * (region.e - region.w);
    const altitude = 1200 + seededValue(seed + 2) * 10800;
    const heading = seededValue(seed + 3) * 360;
    const speed = 240 + seededValue(seed + 4) * 280;
    const id = `SIM${regionKey.replace(/[^A-Z]/g, "").slice(0, 3)}${index}`;
    const trail = pushFlightTrail(id, lat, lng, 84);
    return {
      id,
      callsign: `GX-${String(index + 1).padStart(2, "0")}`,
      lat,
      lng,
      alt: altitude,
      speed,
      heading,
      country: ["US", "UK", "FR", "DE", "JP", "AE", "AU", "CA"][index % 8],
      squawk: String(1200 + index),
      color: flightColor(altitude),
      trail,
      isSimulated: true,
      regionKey,
      motionLabel: "SIMULATED",
      lastSeenAt: Date.now()
    };
  });
}

function applyDemoTelemetry(sourceLabel = "Simulated telemetry fallback") {
  const shouldResetFleet = state.openskyStatus !== "DEMO" || state.demoRegion !== state.region || state.flights.length === 0 || !state.flights.some(flight => flight.isSimulated);
  if (shouldResetFleet) {
    state.flights = createMockFlights(state.region);
  }
  state.openskyStatus = "DEMO";
  state.demoRegion = state.region;
  state.dataSource = sourceLabel;
  state.lastUpdated = new Date();
  updateAircraftMarkers();
  refreshUI();
}

function advanceFlightPositions(deltaSeconds) {
  if (!state.flights.length || deltaSeconds <= 0) {
    return;
  }

  const region = REGIONS[state.region];
  state.flights = state.flights.map(flight => {
    const speed = Math.max(80, Number(flight.speed) || 0);
    let heading = Number.isFinite(flight.heading) ? flight.heading : 90;
    const nauticalMiles = (speed * deltaSeconds) / 3600;
    const headingRad = degToRad(heading);
    let nextLat = flight.lat + (Math.cos(headingRad) * nauticalMiles) / 60;
    const longitudeDivisor = 60 * Math.max(Math.cos(degToRad(flight.lat)), 0.2);
    let nextLng = flight.lng + (Math.sin(headingRad) * nauticalMiles) / longitudeDivisor;

    if (flight.isSimulated) {
      if (nextLat > region.n || nextLat < region.s) {
        heading = 180 - heading;
        nextLat = clamp(nextLat, region.s, region.n);
      }
      if (nextLng > region.e || nextLng < region.w) {
        heading = -heading;
        nextLng = clamp(nextLng, region.w, region.e);
      }
    }

    const normalizedLng = normalizeLongitude(nextLng);
    const trail = pushFlightTrail(flight.id, nextLat, normalizedLng, flight.isSimulated ? 84 : 96);
    return {
      ...flight,
      lat: nextLat,
      lng: normalizedLng,
      heading: (heading + 360) % 360,
      trail
    };
  });

  updateAircraftMarkers();
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal
    });
    return response;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchAircraftStates(url) {
  const attempts = TELEMETRY_SOURCES.map(async source => {
    const response = await fetchJsonWithTimeout(source.buildUrl(url), TELEMETRY_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`${source.label} failed with ${response.status}`);
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.states)) {
      throw new Error(`${source.label} returned invalid aircraft data`);
    }
    return {
      data,
      source: source.label
    };
  });

  return Promise.any(attempts);
}

function parseTleFields(tle2) {
  const parts = tle2.trim().split(/\s+/);
  if (parts.length < 8) {
    throw new Error("Invalid TLE line 2");
  }
  return {
    inclination: Number.parseFloat(parts[2]),
    raan: Number.parseFloat(parts[3]),
    eccentricity: Number.parseFloat(`0.${parts[4]}`),
    argPerigee: Number.parseFloat(parts[5]),
    meanAnomaly: Number.parseFloat(parts[6]),
    meanMotion: Number.parseFloat(parts[7])
  };
}

function propagateTLE(tle1, tle2, minutesFromEpoch) {
  try {
    const { inclination, raan, eccentricity, argPerigee, meanAnomaly, meanMotion } = parseTleFields(tle2);
    const mu = 398600.4418;
    const earthRadius = 6371;
    const period = 86400 / meanMotion;
    const semiMajorAxis = Math.pow(mu * Math.pow(period / (2 * Math.PI), 2), 1 / 3);
    const inclinationRad = degToRad(inclination);
    const raanRad = degToRad(raan + minutesFromEpoch * (360 / (365.25 * 24 * 60)));
    const argPerigeeRad = degToRad(argPerigee);
    const meanAnomalyRad = (degToRad(meanAnomaly) + (minutesFromEpoch * meanMotion * degToRad(360)) / 1440) % (2 * Math.PI);
    let eccentricAnomaly = meanAnomalyRad;
    for (let index = 0; index < 10; index += 1) {
      eccentricAnomaly = meanAnomalyRad + eccentricity * Math.sin(eccentricAnomaly);
    }
    const trueAnomaly =
      2 *
      Math.atan2(
        Math.sqrt(1 + eccentricity) * Math.sin(eccentricAnomaly / 2),
        Math.sqrt(1 - eccentricity) * Math.cos(eccentricAnomaly / 2)
      );
    const radius = semiMajorAxis * (1 - eccentricity * Math.cos(eccentricAnomaly));
    const orbitalX = radius * Math.cos(trueAnomaly);
    const orbitalY = radius * Math.sin(trueAnomaly);
    const cosArg = Math.cos(argPerigeeRad);
    const sinArg = Math.sin(argPerigeeRad);
    const cosInc = Math.cos(inclinationRad);
    const sinInc = Math.sin(inclinationRad);
    const cosRaan = Math.cos(raanRad);
    const sinRaan = Math.sin(raanRad);
    const x = (cosRaan * cosArg - sinRaan * sinArg * cosInc) * orbitalX + (-cosRaan * sinArg - sinRaan * cosArg * cosInc) * orbitalY;
    const y = (sinRaan * cosArg + cosRaan * sinArg * cosInc) * orbitalX + (-sinRaan * sinArg + cosRaan * cosArg * cosInc) * orbitalY;
    const z = sinInc * sinArg * orbitalX + sinInc * cosArg * orbitalY;
    const gmst = degToRad(280.46061837 + minutesFromEpoch * 0.25068447733746215);
    const longitude = radToDeg(Math.atan2(y, x) - gmst);
    return {
      lat: radToDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
      lng: ((longitude + 540) % 360) - 180,
      alt: radius - earthRadius
    };
  } catch {
    return { lat: 0, lng: 0, alt: 400 };
  }
}

function initializeMap() {
  const region = REGIONS[state.region];
  map = L.map("map", {
    center: region.center,
    zoom: region.zoom,
    zoomControl: false,
    attributionControl: false,
    worldCopyJump: true
  });

  L.control.zoom({ position: "bottomright" }).addTo(map);
  setTileLayer(state.tileKey);

  trailCanvas = document.createElement("canvas");
  trailCanvas.style.position = "absolute";
  trailCanvas.style.inset = "0";
  trailCanvas.style.pointerEvents = "none";
  trailCanvas.style.zIndex = "350";
  map.getPanes().overlayPane.appendChild(trailCanvas);
  trailContext = trailCanvas.getContext("2d");

  const resizeTrailCanvas = () => {
    const size = map.getSize();
    trailCanvas.width = size.x;
    trailCanvas.height = size.y;
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(trailCanvas, topLeft);
  };

  map.on("resize moveend zoomend", resizeTrailCanvas);
  resizeTrailCanvas();
  mapReady = true;
  drawTrails();
}

function setTileLayer(tileKey) {
  if (tileLayer) {
    tileLayer.remove();
  }
  state.tileKey = tileKey;
  const tile = TILES[tileKey];
  tileLayer = L.tileLayer(tile.url, { maxZoom: tile.maxZoom }).addTo(map);
  applyMapFilter();
  renderTileButtons();
  refreshStatusCopy();
  saveDashboardPreferences();
}

function applyMapFilter() {
  const tilePane = document.querySelector(".leaflet-tile-pane");
  applyAccentTheme(MODES[state.mode].accent);
  if (!tilePane) {
    return;
  }
  tilePane.style.filter = MODES[state.mode].mapFilter;
  tilePane.style.transition = "filter 320ms ease";
}

function drawTrails() {
  if (!trailContext || !map) {
    return;
  }

  const width = trailCanvas.width;
  const height = trailCanvas.height;
  trailContext.clearRect(0, 0, width, height);

  const projectPoint = point => map.latLngToContainerPoint([point.lat, point.lng]);
  const overlayColor = MODES[state.mode].panelTone;

  if (state.showFlights && state.showTrails) {
    state.flights.forEach(flight => {
      if (!flight.trail || flight.trail.length < 2) {
        return;
      }
      trailContext.beginPath();
      flight.trail.forEach((point, index) => {
        const projected = projectPoint(point);
        if (index === 0) {
          trailContext.moveTo(projected.x, projected.y);
        } else {
          trailContext.lineTo(projected.x, projected.y);
        }
      });
      trailContext.strokeStyle = `${state.mode === "NORMAL" ? flight.color : overlayColor}88`;
      trailContext.lineWidth = 1.4;
      trailContext.setLineDash([5, 7]);
      trailContext.stroke();
      trailContext.setLineDash([]);
    });
  }

  if (state.showSats && state.showTrails) {
    state.satellites.forEach(satellite => {
      if (!satellite.trail || satellite.trail.length < 2) {
        return;
      }
      trailContext.beginPath();
      let previous;
      satellite.trail.forEach(point => {
        if (previous && Math.abs(point.lng - previous.lng) > 180) {
          trailContext.stroke();
          trailContext.beginPath();
          previous = undefined;
        }
        const projected = projectPoint(point);
        if (!previous) {
          trailContext.moveTo(projected.x, projected.y);
        } else {
          trailContext.lineTo(projected.x, projected.y);
        }
        previous = point;
      });
      trailContext.strokeStyle = `${satellite.color}88`;
      trailContext.lineWidth = 1.1;
      trailContext.setLineDash([3, 8]);
      trailContext.stroke();
      trailContext.setLineDash([]);
    });
  }

  if (state.mode === "NIGHTVISION" || state.mode === "FLIR") {
    for (let y = 0; y < height; y += 4) {
      trailContext.fillStyle = "rgba(0, 0, 0, 0.045)";
      trailContext.fillRect(0, y, width, 1);
    }
  }

  window.requestAnimationFrame(drawTrails);
}

function aircraftIcon(flight, color) {
  const rotation = (flight.heading || 0) - 90;
  const filterId = `a${flight.id.replace(/[^a-z0-9]/gi, "")}`;
  return L.divIcon({
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="-15 -15 30 30">
        <defs>
          <filter id="${filterId}">
            <feGaussianBlur stdDeviation="1.6" result="blur"></feGaussianBlur>
            <feMerge>
              <feMergeNode in="blur"></feMergeNode>
              <feMergeNode in="SourceGraphic"></feMergeNode>
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#${filterId})" transform="rotate(${rotation})">
          <ellipse cx="0" cy="0" rx="2.4" ry="8" fill="${color}"></ellipse>
          <polygon points="-10,1.8 10,1.8 7,6.2 -7,6.2" fill="${color}"></polygon>
          <polygon points="-3.3,-5.4 3.3,-5.4 2,-10 -2,-10" fill="${color}"></polygon>
        </g>
      </svg>
    `
  });
}

function satelliteIcon(satellite) {
  const filterId = `s${satellite.name.replace(/[^a-z0-9]/gi, "")}`;
  return L.divIcon({
    className: "",
    iconSize: [36, 24],
    iconAnchor: [18, 12],
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="36" height="24" viewBox="-18 -12 36 24">
        <defs>
          <filter id="${filterId}">
            <feGaussianBlur stdDeviation="2.3" result="blur"></feGaussianBlur>
            <feMerge>
              <feMergeNode in="blur"></feMergeNode>
              <feMergeNode in="SourceGraphic"></feMergeNode>
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#${filterId})">
          <rect x="-10" y="-3" width="20" height="6" fill="${satellite.color}"></rect>
          <rect x="-2" y="-10" width="4" height="20" fill="${satellite.color}"></rect>
          <rect x="-10" y="-3" width="7" height="6" fill="#d5f2ff" opacity="0.88"></rect>
          <rect x="3" y="-3" width="7" height="6" fill="#d5f2ff" opacity="0.88"></rect>
        </g>
      </svg>
    `
  });
}

function cameraIcon() {
  return L.divIcon({
    className: "",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    html: '<span class="cam-dot"></span>'
  });
}

function updateAircraftMarkers() {
  aircraftMarkers.forEach(marker => marker.remove());
  aircraftMarkers = [];

  if (!state.showFlights || !mapReady) {
    return;
  }

  state.flights.forEach(flight => {
    const color = state.mode === "NORMAL" ? flight.color : MODES[state.mode].panelTone;
    const sourceLabel = flight.isSimulated ? "SIMULATED" : "LIVE EST.";
    const tooltip = `
      <div class="ac-tooltip" style="border:1px solid ${color}; color:${color}">
        <strong>${flight.callsign}</strong>
        <span style="opacity:.55"> ${flight.country}</span><br>
        SRC <strong>${sourceLabel}</strong><br>
        ALT <strong>${Math.round(flight.alt)} m</strong>
        &nbsp;SPD <strong>${Math.round(flight.speed)} kts</strong><br>
        HDG <strong>${Math.round(flight.heading)}°</strong>
        &nbsp;SQK <strong>${flight.squawk}</strong>
      </div>
    `;
    const marker = L.marker([flight.lat, flight.lng], {
      icon: aircraftIcon(flight, color),
      zIndexOffset: 200
    })
      .addTo(map)
      .bindTooltip(tooltip, {
        direction: "top",
        offset: [0, -12],
        opacity: 1,
        className: "lf-tip"
      })
      .on("click", () => {
        state.selectedFlightId = flight.id;
        refreshUI();
      });
    aircraftMarkers.push(marker);
  });
}

function updateSatelliteMarkers() {
  satelliteMarkers.forEach(marker => marker.remove());
  satelliteMarkers = [];

  if (!state.showSats || !mapReady) {
    return;
  }

  state.satellites.forEach(satellite => {
    const tooltip = `
      <div class="sat-tooltip" style="border:1px solid ${satellite.color}; color:${satellite.color}">
        <strong>${satellite.name}</strong>
        <span style="opacity:.55"> orbital</span><br>
        ALT <strong>${Math.round(satellite.alt)} km</strong>
      </div>
    `;
    const marker = L.marker([satellite.lat, satellite.lng], { icon: satelliteIcon(satellite) })
      .addTo(map)
      .bindTooltip(tooltip, {
        direction: "top",
        offset: [0, -8],
        opacity: 1,
        className: "lf-tip"
      });
    satelliteMarkers.push(marker);
  });
}

function updateCameraMarkers() {
  cameraMarkers.forEach(marker => marker.remove());
  cameraMarkers = [];

  if (!state.showCamPins || !mapReady) {
    return;
  }

  CAMERAS.forEach(camera => {
    if (!camera.lat && !camera.lng) {
      return;
    }
    const marker = L.marker([camera.lat, camera.lng], { icon: cameraIcon() })
      .addTo(map)
      .bindTooltip(`<div class="cam-tooltip">REC ● ${camera.name}</div>`, {
        direction: "top",
        offset: [0, -6],
        opacity: 1,
        className: "lf-tip"
      })
      .on("click", () => openCCTV(camera, { reason: "Map camera selected" }));
    cameraMarkers.push(marker);
  });
}

function renderRegionButtons() {
  elements.regionButtons.innerHTML = "";
  Object.keys(REGIONS).forEach(regionKey => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn${regionKey === state.region ? " active" : ""}`;
    button.textContent = regionKey;
    button.addEventListener("click", () => {
      state.region = regionKey;
      fitRegion(regionKey);
      renderRegionButtons();
      refreshStatusCopy();
      saveDashboardPreferences();
      fetchOpensky();
      closeSidebar();
    });
    elements.regionButtons.appendChild(button);
  });
}

function renderTileButtons() {
  elements.tileButtons.innerHTML = "";
  Object.keys(TILES).forEach(tileKey => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tile-btn${tileKey === state.tileKey ? " active" : ""}`;
    button.textContent = TILES[tileKey].label;
    button.addEventListener("click", () => {
      setTileLayer(tileKey);
      closeSidebar();
    });
    elements.tileButtons.appendChild(button);
  });
}

function renderModeButtons() {
  elements.modeButtons.innerHTML = "";
  Object.keys(MODES).forEach(modeKey => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mode-btn${modeKey === state.mode ? " active" : ""}`;
    button.textContent = MODES[modeKey].label;
    button.addEventListener("click", () => {
      state.mode = modeKey;
      applyMapFilter();
      updateAircraftMarkers();
      updateSatelliteMarkers();
      refreshUI();
      saveDashboardPreferences();
      closeSidebar();
    });
    elements.modeButtons.appendChild(button);
  });
}

function renderLayerRows() {
  const layerConfig = [
    { label: "Flights", key: "showFlights" },
    { label: "Satellites", key: "showSats" },
    { label: "Trails", key: "showTrails" },
    { label: "CCTV Pins", key: "showCamPins" },
    { label: "3D Globe", key: "showGlobe" }
  ];
  elements.layerRows.innerHTML = "";
  layerConfig.forEach(layer => {
    const row = document.createElement("div");
    row.className = `layer-row${state[layer.key] ? " on" : ""}`;
    row.innerHTML = `<span>${layer.label}</span><button class="toggle-pill ${state[layer.key] ? "on" : ""}" type="button">${state[layer.key] ? "ON" : "OFF"}</button>`;
    row.addEventListener("click", () => {
      state[layer.key] = !state[layer.key];
      if (layer.key === "showGlobe") {
        elements.globePanel.style.display = state.showGlobe ? "block" : "none";
        if (state.showGlobe) {
          drawGlobe();
        }
      }
      updateAircraftMarkers();
      updateSatelliteMarkers();
      updateCameraMarkers();
      renderLayerRows();
      refreshUI();
      saveDashboardPreferences();
    });
    elements.layerRows.appendChild(row);
  });
}

function renderCameraList() {
  elements.camList.innerHTML = "";
  const cameras = filteredCameras();
  if (cameras.length === 0) {
    elements.camList.innerHTML = '<div class="empty-state">No camera feeds match this search.</div>';
    return;
  }
  cameras.forEach(camera => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "cam-row";
    row.innerHTML = `
      <span class="cam-dot"></span>
      <span class="cam-copy">
        <span class="cam-name">${camera.name}</span>
        <span class="cam-meta">${camera.region || "GLOBAL"} · ${cameraModeLabel(camera)} · ${cameraCadenceLabel(camera)}</span>
      </span>
    `;
    row.addEventListener("click", () => {
      if (mapReady && (camera.lat || camera.lng)) {
        map.flyTo([camera.lat, camera.lng], 11, { duration: 1.2 });
      }
      openCCTV(camera, { reason: "Camera locked" });
      closeSidebar();
    });
    elements.camList.appendChild(row);
  });
}

function renderAircraftList() {
  elements.aircraftList.innerHTML = "";
  const flights = filteredAircraft();
  if (flights.length === 0) {
    elements.aircraftList.innerHTML = '<div class="empty-state">No aircraft match this search.</div>';
    return;
  }
  flights.forEach(flight => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `ac-row${state.selectedFlightId === flight.id ? " selected" : ""}`;
    row.innerHTML = `
      <div class="ac-main">
        <span class="ac-callsign">${flight.callsign}</span>
        <span>${Math.round(flight.alt)} m</span>
        <span class="ac-country">${flight.country}</span>
      </div>
      <div class="ac-detail">
        SPD: ${Math.round(flight.speed)} kts · HDG: ${Math.round(flight.heading)}°<br>
        LAT: ${flight.lat.toFixed(3)} · LNG: ${flight.lng.toFixed(3)}
      </div>
    `;
    row.addEventListener("click", () => {
      state.selectedFlightId = state.selectedFlightId === flight.id ? null : flight.id;
      refreshUI();
      if (state.selectedFlightId) {
        map.panTo([flight.lat, flight.lng], { animate: true, duration: 1.1 });
      }
    });
    elements.aircraftList.appendChild(row);
  });
}

function renderSatelliteList() {
  elements.satList.innerHTML = "";
  state.satellites.forEach(satellite => {
    const row = document.createElement("div");
    row.className = "sat-row";
    row.innerHTML = `<span class="sat-name">${satellite.name}</span><span class="sat-alt">${Math.round(satellite.alt)} km</span>`;
    elements.satList.appendChild(row);
  });
}

function refreshStatusCopy() {
  const tile = TILES[state.tileKey];
  elements.hudTopLeft.textContent = `${tile.label.toUpperCase()} · ${state.region} · ${state.flights.length} CONTACTS`;
  elements.sbAttr.textContent = `${tile.attribution} · ${state.dataSource} · ${state.openskyStatus === "ONLINE" ? "real feed with extrapolated motion" : "simulation with motion model"}`;
  elements.missionRegion.textContent = state.region;
}

function selectedFlight() {
  return state.flights.find(flight => flight.id === state.selectedFlightId) || null;
}

function refreshUI() {
  const signalColor = state.openskyStatus === "OFFLINE" ? "var(--danger)" : state.openskyStatus === "DEMO" ? "var(--warning)" : "var(--success)";
  const statusLabel =
    state.openskyStatus === "DEMO"
      ? "DEMO FEED ACTIVE"
      : state.openskyStatus === "ONLINE"
        ? "OPENSKY ONLINE"
        : `OPENSKY ${state.openskyStatus}`;
  const flight = selectedFlight();
      const camera = selectedCamera();
        const nowUtc = new Date().toISOString().split("T")[1].split(".")[0];
        const timeText = `${nowUtc} UTC`;
        const updateText = state.lastUpdated ? formatUtcTime(state.lastUpdated) : null;
        const visibleFlights = filteredAircraft();

  elements.statusText.textContent = statusLabel;
  elements.sbStatus.textContent = statusLabel;
  elements.statusDot.style.background = signalColor;
  elements.sbDot.style.color = signalColor;
  elements.hudStatusDot.style.color = signalColor;
  elements.metricAircraft.textContent = String(state.flights.length);
  elements.metricSats.textContent = String(state.satellites.length);
  elements.metricMode.textContent = MODES[state.mode].label;
  elements.metricUptime.textContent = updateText ? `Updated ${updateText}` : "Awaiting telemetry";
  elements.missionSource.textContent = state.dataSource;
  elements.missionAuth.textContent = state.openskyStatus === "ONLINE" ? "OpenSky live aircraft" : "Simulated fallback aircraft";
  elements.missionMotion.textContent = state.openskyStatus === "ONLINE" ? "Heading/speed extrapolated between refreshes" : "Continuous demo motion + active trails";
  elements.missionFlight.textContent = flight ? `${flight.callsign} · ${flight.country}` : "No selection";
  elements.focusFlightButton.disabled = !flight;
  elements.refreshFeedButton.disabled = state.isRefreshing;
  elements.refreshFeedButton.textContent = state.isRefreshing ? "REFRESHING…" : "REFRESH FEED";
  elements.aircraftCount.textContent =
    visibleFlights.length === state.flights.length
      ? String(state.flights.length)
      : `${visibleFlights.length} / ${state.flights.length}`;
  elements.sbAircraft.textContent = String(state.flights.length);
  elements.sbSats.textContent = String(state.satellites.length);
  elements.sbCams.textContent = String(CAMERAS.length);
  elements.hudMode.textContent = `● ${MODES[state.mode].label}`;
  elements.hudBottomLeftText.textContent = `${state.flights.length} AIRCRAFT · ${state.satellites.length} SATS · ${timeText}`;
  elements.signalFeedClass.textContent = camera.feedClass || cameraModeLabel(camera);
  elements.signalSelectedCamera.textContent = camera.name;
  elements.signalCameraCadence.textContent = cameraCadenceLabel(camera);
  elements.signalCameraMode.textContent = state.mosaicEnabled ? "Mosaic surveillance" : state.autoCycleEnabled ? "Auto-cycle engaged" : "Manual lock";
  elements.signalFrameAge.textContent = formatRelativeAge(state.lastCameraFrameAt);
  elements.cctvFeedClass.textContent = (camera.feedClass || cameraModeLabel(camera)).toUpperCase();
  elements.cctvRefreshMeta.textContent = cameraCadenceLabel(camera).toUpperCase();
  elements.cctvAutoCycle.textContent = state.autoCycleEnabled ? "AUTO CYCLE ON" : "AUTO CYCLE OFF";
  elements.cctvAutoCycle.classList.toggle("active", state.autoCycleEnabled);
  elements.cctvMosaicToggle.textContent = state.mosaicEnabled ? "MOSAIC ON" : "MOSAIC OFF";
  elements.cctvMosaicToggle.classList.toggle("active", state.mosaicEnabled);
  refreshStatusCopy();
  renderAircraftList();
  renderSatelliteList();
  renderCameraList();
  renderFeedLog();
}

function fitRegion(regionKey) {
  if (!mapReady) {
    return;
  }
  const region = REGIONS[regionKey];
  map.fitBounds(
    [
      [region.s, region.w],
      [region.n, region.e]
    ],
    { padding: [24, 24] }
  );
}

function processFlights(states) {
  state.flights = states
    .filter(item => Number.isFinite(item[5]) && Number.isFinite(item[6]))
    .slice(0, 120)
    .map(item => {
      const id = item[0];
      const lat = item[6];
      const lng = item[5];
      const alt = item[7] || 0;
      const speed = (item[9] || 0) * 1.94384;
      const heading = item[10] || 0;
      const trail = pushFlightTrail(id, lat, lng, 96);
      return {
        id,
        callsign: (item[1] || "UNKNOWN").trim() || "UNKNOWN",
        country: item[2] || "N/A",
        lat,
        lng,
        alt,
        speed,
        heading,
        squawk: item[14] || "----",
        color: flightColor(alt),
        trail,
        isSimulated: false,
        motionLabel: "LIVE",
        lastSeenAt: Date.now()
      };
    });
}

async function fetchOpensky() {
  state.fetchCount += 1;
  state.isRefreshing = true;
  state.lastLiveAttempt = new Date();
  refreshUI();
  const region = REGIONS[state.region];
  const url = `${OPENSKY_ENDPOINT}?lamin=${region.s}&lamax=${region.n}&lomin=${region.w}&lomax=${region.e}`;

  try {
    const result = await fetchAircraftStates(url);
    processFlights(result.data.states);
    state.openskyStatus = "ONLINE";
    state.demoRegion = null;
    state.dataSource = `OpenSky live feed via ${result.source}`;
    state.lastUpdated = new Date();
    updateAircraftMarkers();
  } catch {
    applyDemoTelemetry("Simulated telemetry fallback");
  } finally {
    state.isRefreshing = false;
    refreshUI();
  }
}

function updateSatellites() {
  satelliteTick += 1;
  const minutesFromEpoch = (Date.now() / 60000) % 1440;
  state.satellites = SATS_TLE.map(satellite => {
    const position = propagateTLE(satellite.tle1, satellite.tle2, minutesFromEpoch);
    if (!state.satTrails[satellite.name]) {
      state.satTrails[satellite.name] = [];
    }
    if (satelliteTick % 8 === 0) {
      state.satTrails[satellite.name].push({ lat: position.lat, lng: position.lng });
      state.satTrails[satellite.name] = state.satTrails[satellite.name].slice(-180);
    }
    return {
      ...satellite,
      ...position,
      trail: state.satTrails[satellite.name]
    };
  });
  updateSatelliteMarkers();
}

function drawGlobe() {
  if (!globeContext) {
    return;
  }

  const canvas = elements.globeCanvas;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  globeContext.clearRect(0, 0, width, height);
  const radius = Math.max(48, Math.min(width, height) / 2 - 22);
  const centerX = width / 2;
  const centerY = height / 2;

  if (state.autoRotate) {
    globeRotation += 0.0045;
  }

  const gradient = globeContext.createRadialGradient(centerX, centerY, radius * 0.4, centerX, centerY, radius * 1.14);
  gradient.addColorStop(0, "rgba(30, 230, 255, 0)");
  gradient.addColorStop(1, "rgba(30, 230, 255, 0.18)");
  globeContext.fillStyle = gradient;
  globeContext.beginPath();
  globeContext.arc(centerX, centerY, radius * 1.12, 0, Math.PI * 2);
  globeContext.fill();

  globeContext.strokeStyle = "rgba(30, 230, 255, 0.3)";
  globeContext.lineWidth = 1;
  globeContext.beginPath();
  globeContext.arc(centerX, centerY, radius, 0, Math.PI * 2);
  globeContext.stroke();

  globeContext.setLineDash([2, 5]);
  for (let index = 0; index < 6; index += 1) {
    const angle = globeRotation + (index * Math.PI) / 3;
    const ellipseRadius = Math.abs(Math.cos(angle)) * radius;
    globeContext.beginPath();
    globeContext.ellipse(centerX, centerY, Math.max(2, ellipseRadius), radius, 0, 0, Math.PI * 2);
    globeContext.stroke();
  }
  globeContext.setLineDash([]);

  if (map) {
    const center = map.getCenter();
    const latitude = degToRad(center.lat);
    const longitude = degToRad(center.lng) + globeRotation;
    const pointX = centerX + radius * Math.cos(latitude) * Math.sin(longitude);
    const pointY = centerY - radius * Math.sin(latitude);
    globeContext.fillStyle = MODES[state.mode].panelTone;
    globeContext.beginPath();
    globeContext.arc(pointX, pointY, 3.5, 0, Math.PI * 2);
    globeContext.fill();
  }

  if (state.showGlobe) {
    window.requestAnimationFrame(drawGlobe);
  }
}

function updateCctvClock() {
  if (elements.cctvOverlay.classList.contains("open")) {
    const time = new Date().toISOString().split("T")[1].split(".")[0];
    const camera = selectedCamera();
    elements.cctvLiveTime.textContent = camera && camera.refreshSeconds ? `${time} · ${camera.refreshSeconds}s` : time;
  }
}

function showCctvFallback(camera, title, text) {
  elements.cctvFallback.classList.add("open");
  elements.cctvFallbackImage.src = camera.thumb || cameraThumbFallback;
  elements.cctvFallbackTitle.textContent = title;
  elements.cctvFallbackText.textContent = text;
}

function hideCctvFallback() {
  elements.cctvFallback.classList.remove("open");
}

function tickRealtimeLayers() {
  const now = Date.now();
  const deltaSeconds = state.lastMotionTickAt ? Math.min(3, (now - state.lastMotionTickAt) / 1000) : 1;
  state.lastMotionTickAt = now;
  advanceFlightPositions(deltaSeconds);
  updateSatellites();
  updateCctvClock();
  refreshUI();
}

function openCCTV(camera, options = {}) {
  stopCctvTimers();
  const reason = options.reason || "Camera locked";

  state.selectedCameraId = camera.id;
  saveDashboardPreferences();
  elements.cctvOverlay.classList.add("open");
  elements.cctvOverlay.setAttribute("aria-hidden", "false");
  elements.cctvTitle.textContent = `● CAMERA WALL: ${camera.name}`;
  elements.cctvCoords.textContent = `COORD: ${camera.lat.toFixed(4)}, ${camera.lng.toFixed(4)}`;
  elements.cctvProvider.textContent = camera.provider || "External feed";
  elements.cctvFeedClass.textContent = (camera.feedClass || cameraModeLabel(camera)).toUpperCase();
  elements.cctvRefreshMeta.textContent = cameraCadenceLabel(camera).toUpperCase();
  updateCctvClock();
  elements.cctvOpenSource.href = camera.external || camera.src;
  elements.cctvIframe.onload = null;
  elements.cctvImg.onload = null;
  elements.cctvImg.onerror = null;
  hideCctvFallback();
  pushFeedEvent(`${reason}: ${camera.name}`, reason === "Patrol advanced" ? "success" : "info");

  if (camera.snapshot) {
    refreshSnapshotFrame(camera, { logReason: "Frame sync" });
    startCctvRefresh(camera);
  } else if (camera.externalOnly) {
    elements.cctvIframe.style.display = "none";
    elements.cctvImg.style.display = "none";
    showCctvFallback(
      camera,
      "External live source recommended",
      "This provider does not embed reliably inside the VS Code preview. Use Open Source to watch the real live feed directly."
    );
  } else if (camera.mjpeg) {
    elements.cctvIframe.style.display = "none";
    elements.cctvImg.style.display = "block";
    elements.cctvImg.onload = () => hideCctvFallback();
    elements.cctvImg.onerror = () => {
      elements.cctvImg.style.display = "none";
      showCctvFallback(camera, "Feed unavailable", "The direct MJPEG feed could not be loaded here. Use Open Source to try the raw feed directly.");
    };
    elements.cctvImg.src = camera.src;
  } else {
    elements.cctvImg.style.display = "none";
    elements.cctvIframe.style.display = "block";
    elements.cctvIframe.src = camera.src;
    state.cctvFallbackTimerId = window.setTimeout(() => {
      showCctvFallback(camera, "Embed may be blocked", "If the player looks blank or says unavailable, open the source feed directly in a new tab.");
    }, 3200);
    elements.cctvIframe.onload = () => {
      if (state.cctvFallbackTimerId) {
        window.clearTimeout(state.cctvFallbackTimerId);
        state.cctvFallbackTimerId = null;
      }
    };
  }

  syncCameraCycleState();
  startThumbRefreshLoop();
  renderCctvMosaic();
  startMosaicRefreshLoop();

  elements.cctvThumbs.innerHTML = "";
  CAMERAS.forEach(item => {
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = `cam-thumb${item.id === camera.id ? " active" : ""}`;
    const thumbSource = item.snapshot ? cacheBustedUrl(item.thumb || item.src) : item.thumb || cameraThumbFallback;
    thumb.innerHTML = `
      <img src="${thumbSource}" alt="${item.name} thumbnail">
      <div class="cam-thumb-label">${item.name}<span>${cameraModeLabel(item)} · ${cameraCadenceLabel(item)}</span></div>
      <div class="cam-thumb-active-border"></div>
    `;
    thumb.addEventListener("click", () => openCCTV(item, { reason: "Thumbnail selected" }));
    elements.cctvThumbs.appendChild(thumb);
  });

  refreshUI();
}

function closeCCTV() {
  stopCctvTimers();
  elements.cctvOverlay.classList.remove("open");
  elements.cctvOverlay.setAttribute("aria-hidden", "true");
  elements.cctvIframe.src = "";
  elements.cctvImg.src = "";
  elements.cctvMosaic.innerHTML = "";
  elements.cctvMosaic.classList.remove("open");
  hideCctvFallback();
}

function focusSelectedFlight() {
  const flight = selectedFlight();
  if (!flight || !mapReady) {
    return;
  }
  map.flyTo([flight.lat, flight.lng], clamp(map.getZoom() + 1, 5, 10), { duration: 1.1 });
}

function openSidebar() {
  document.body.classList.add("sidebar-open");
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
}

function toggleSidebar() {
  document.body.classList.toggle("sidebar-open");
}

function registerEvents() {
  elements.cctvButton.addEventListener("click", () => openCCTV(CAMERAS[0], { reason: "Camera wall opened" }));
  elements.cctvClose.addEventListener("click", closeCCTV);
  elements.cctvRefreshNow.addEventListener("click", () => refreshSnapshotFrame(selectedCamera(), { logReason: "Manual frame refresh" }));
  elements.cctvNextFeed.addEventListener("click", cycleToNextCamera);
  elements.cctvAutoCycle.addEventListener("click", toggleCameraCycle);
  elements.cctvMosaicToggle.addEventListener("click", toggleMosaicMode);
  elements.refreshFeedButton.addEventListener("click", () => fetchOpensky());
  elements.focusFlightButton.addEventListener("click", focusSelectedFlight);
  elements.sidebarToggle.addEventListener("click", toggleSidebar);
  elements.mobileBackdrop.addEventListener("click", closeSidebar);
  elements.aircraftSearch.addEventListener("input", event => {
    state.aircraftQuery = event.target.value;
    refreshUI();
  });
  elements.cameraSearch.addEventListener("input", event => {
    state.cameraQuery = event.target.value;
    renderCameraList();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeCCTV();
      closeSidebar();
    }
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 820) {
      closeSidebar();
    }
  });
}

function initializeUI() {
  pushFeedEvent("Camera wall initialized", "success");
  pushFeedEvent("Telemetry warm-up armed", "info");
  renderRegionButtons();
  renderTileButtons();
  renderModeButtons();
  renderLayerRows();
  renderCameraList();
  elements.globePanel.style.display = state.showGlobe ? "block" : "none";
  refreshUI();
}

function boot() {
  cacheElements();
  restoreDashboardPreferences();
  globeContext = elements.globeCanvas.getContext("2d");
  initializeUI();
  registerEvents();
  try {
    initializeMap();
    updateCameraMarkers();
  } catch {
    state.openskyStatus = "OFFLINE";
    state.dataSource = "Map engine unavailable in this browser";
    refreshUI();
  }
  applyDemoTelemetry("Simulated telemetry warm-up");
  tickRealtimeLayers();
  fetchOpensky();
  drawGlobe();
  window.setInterval(fetchOpensky, 15000);
  window.setInterval(tickRealtimeLayers, 1000);
}

window.addEventListener("load", boot);