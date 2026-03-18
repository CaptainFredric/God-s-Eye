"use strict";

const STORAGE_KEY = "worldline-4d-foundation-preferences";
const TILESETS = {
  DARK: {
    label: "Dark Globe",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 16
  },
  SAT: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19
  },
  TOPO: {
    label: "Topo",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19
  }
};

const PLAYBACK_SPEEDS = [
  { label: "1×", value: 1, minutesPerTick: 1 },
  { label: "5×", value: 5, minutesPerTick: 3 },
  { label: "15×", value: 15, minutesPerTick: 8 }
];

const LAYER_CONFIG = [
  { key: "showCommercialFlights", label: "Commercial Flights", meta: "Civilian ADS-B traffic" },
  { key: "showMilitaryFlights", label: "Military Flights", meta: "ISR, tanker, and patrol tracks" },
  { key: "showSatellites", label: "Satellite Passes", meta: "Commercial and defense overhead windows" },
  { key: "showJamming", label: "GPS Jamming", meta: "Disruption grid intensification" },
  { key: "showMaritime", label: "Maritime Traffic", meta: "Tankers and shipping lanes" },
  { key: "showClosures", label: "Closures", meta: "Airspace and chokepoint restrictions" },
  { key: "showIncidents", label: "Incident Markers", meta: "Strikes, blackouts, and cascade events" }
];

const SCENARIO = {
  title: "Gulf Escalation Replay",
  theater: "Levant · Gulf · Strait Corridor",
  durationMinutes: 105,
  description:
    "A 4D replay of a rapidly escalating regional crisis, correlating public flights, military air activity, satellite overhead windows, jamming intensity, maritime shifts, and cascading closures.",
  aoi: {
    label: "Primary AOI",
    lat: 33.2,
    lng: 53.8,
    radiusMeters: 210000
  },
  stages: [
    { id: "monitoring-opens", minute: 0, title: "Monitoring opens", summary: "Commercial air traffic is dense across the Gulf corridor while the theater remains nominal.", impact: "Baseline traffic volume and normal corridor usage are established.", category: "Baseline", lat: 26.2, lng: 51.4 },
    { id: "jamming-begins", minute: 12, title: "Localized GPS jamming begins", summary: "ADS-B derived disruption tiles begin appearing around the area of interest.", impact: "Navigation confidence deteriorates and reroute risk rises.", category: "Disruption", lat: 31.5, lng: 52.7 },
    { id: "satellite-prepass", minute: 19, title: "Satellite interest intensifies", summary: "Commercial and defense satellites begin lining up overhead passes across the AOI.", impact: "Imaging attention suggests elevated preparation and verification activity.", category: "Orbital", lat: 33.0, lng: 54.1 },
    { id: "prestrike-reroutes", minute: 29, title: "Commercial reroutes begin", summary: "Civilian flights start bending south and west as disruptions grow stronger.", impact: "Route confidence breaks before formal closure announcements.", category: "Aviation", lat: 29.2, lng: 49.6 },
    { id: "zero-hour", minute: 42, title: "Zero hour strike window", summary: "A strike occurs inside the AOI while multiple imaging satellites are overhead or approaching.", impact: "Immediate demand for pre- and post-event observation spikes.", category: "Strike", lat: 33.2, lng: 53.8 },
    { id: "damage-assessment", minute: 51, title: "Damage assessment pass", summary: "A follow-on set of satellite passes crosses the AOI to capture aftermath indicators.", impact: "Commercial and military collection align tightly with event timing.", category: "Orbital", lat: 33.4, lng: 53.6 },
    { id: "blackout", minute: 60, title: "Regional communications blackout", summary: "Ground reporting thins as blackout conditions appear near the theater core.", impact: "Open-source confidence drops while indirect indicators become more important.", category: "Blackout", lat: 35.4, lng: 51.5 },
    { id: "closure-iran", minute: 66, title: "Primary airspace closes", summary: "The central theater transitions into a no-fly zone and civil traffic evacuates.", impact: "Airspace fragmentation begins across neighboring states.", category: "Closure", lat: 31.6, lng: 51.8 },
    { id: "closure-cascade", minute: 74, title: "Closure cascade spreads west and south", summary: "Neighboring countries begin shutting down or constraining their airspace in sequence.", impact: "Regional route density collapses and holding patterns emerge.", category: "Closure", lat: 29.7, lng: 47.9 },
    { id: "retaliation", minute: 82, title: "Retaliatory strikes hit external bases", summary: "Secondary military targets outside the AOI are struck, expanding the crisis footprint.", impact: "Cross-border defensive activity rises and flight avoidance increases sharply.", category: "Retaliation", lat: 25.1, lng: 51.2 },
    { id: "maritime-shift", minute: 91, title: "Maritime traffic reverses course", summary: "Tankers and vessels begin clearing away from the chokepoint while one damaged tanker lingers.", impact: "Trade routes react slower than aircraft but ultimately show a clear retreat pattern.", category: "Maritime", lat: 26.4, lng: 56.3 },
    { id: "theater-thins", minute: 105, title: "Theater traffic thins out", summary: "The crisis settles into a heavily monitored but much quieter state with sparse transit and persistent observation.", impact: "The post-event picture is defined by imaging passes, closures, and residual avoidance behavior.", category: "Aftermath", lat: 28.6, lng: 52.9 }
  ]
};

const SATELLITES = [
  {
    id: "wv-legion",
    name: "WV Legion",
    type: "Commercial EO",
    color: "#8dd4ff",
    route: [
      { minute: 0, lat: 8, lng: 14 },
      { minute: 18, lat: 25, lng: 36 },
      { minute: 34, lat: 35, lng: 54 },
      { minute: 56, lat: 49, lng: 78 },
      { minute: 82, lat: 57, lng: 110 },
      { minute: 105, lat: 62, lng: 148 }
    ],
    passWindows: [
      { start: 28, end: 36, note: "Pre-strike electro-optical pass" },
      { start: 50, end: 58, note: "Post-strike damage assessment" }
    ]
  },
  {
    id: "pneo-1",
    name: "Pleiades Neo",
    type: "Commercial EO",
    color: "#bba8ff",
    route: [
      { minute: 0, lat: 55, lng: -26 },
      { minute: 14, lat: 46, lng: 8 },
      { minute: 30, lat: 37, lng: 44 },
      { minute: 46, lat: 28, lng: 62 },
      { minute: 70, lat: 12, lng: 96 },
      { minute: 105, lat: -8, lng: 138 }
    ],
    passWindows: [{ start: 38, end: 46, note: "Strike window confirmation pass" }]
  },
  {
    id: "capella-7",
    name: "Capella-7",
    type: "SAR",
    color: "#d48cff",
    route: [
      { minute: 0, lat: 60, lng: 98 },
      { minute: 20, lat: 43, lng: 76 },
      { minute: 40, lat: 31, lng: 56 },
      { minute: 60, lat: 18, lng: 28 },
      { minute: 84, lat: 1, lng: -6 },
      { minute: 105, lat: -14, lng: -32 }
    ],
    passWindows: [
      { start: 41, end: 48, note: "All-weather SAR collection" },
      { start: 64, end: 70, note: "Cloud-agnostic revisit" }
    ]
  },
  {
    id: "gaofen-12",
    name: "Gaofen-12",
    type: "State imaging",
    color: "#ff9b7e",
    route: [
      { minute: 0, lat: -5, lng: 126 },
      { minute: 18, lat: 11, lng: 106 },
      { minute: 35, lat: 22, lng: 84 },
      { minute: 51, lat: 34, lng: 58 },
      { minute: 72, lat: 48, lng: 30 },
      { minute: 105, lat: 63, lng: -14 }
    ],
    passWindows: [{ start: 47, end: 54, note: "Immediate post-event pass" }]
  },
  {
    id: "persona-3",
    name: "Persona-3",
    type: "Military imaging",
    color: "#ffbe4d",
    route: [
      { minute: 0, lat: 66, lng: -88 },
      { minute: 19, lat: 54, lng: -40 },
      { minute: 38, lat: 42, lng: 3 },
      { minute: 58, lat: 31, lng: 46 },
      { minute: 80, lat: 22, lng: 84 },
      { minute: 105, lat: 14, lng: 124 }
    ],
    passWindows: [{ start: 55, end: 63, note: "Military revisit pass" }]
  },
  {
    id: "topaz-234",
    name: "USA 234 Topaz",
    type: "Military radar",
    color: "#74d6ff",
    route: [
      { minute: 0, lat: 2, lng: -118 },
      { minute: 18, lat: 16, lng: -66 },
      { minute: 36, lat: 24, lng: -12 },
      { minute: 48, lat: 31, lng: 38 },
      { minute: 68, lat: 43, lng: 80 },
      { minute: 105, lat: 58, lng: 136 }
    ],
    passWindows: [{ start: 40, end: 46, note: "Zero-hour military overhead" }]
  }
];

const FLIGHTS = [
  { id: "thy631", callsign: "THY631", type: "commercial", route: [{ minute: 0, lat: 25.1, lng: 55.2 }, { minute: 20, lat: 28.2, lng: 56.4 }, { minute: 42, lat: 31.8, lng: 54.9 }, { minute: 60, lat: 34.7, lng: 49.2 }, { minute: 84, lat: 38.6, lng: 39.7 }, { minute: 105, lat: 41.0, lng: 28.8 }], note: "Presses through longer than most civilian traffic." },
  { id: "vir354", callsign: "VIR354", type: "commercial", route: [{ minute: 0, lat: 25.7, lng: 55.4 }, { minute: 18, lat: 28.0, lng: 55.0 }, { minute: 34, lat: 30.4, lng: 53.1 }, { minute: 46, lat: 28.6, lng: 49.1 }, { minute: 72, lat: 25.1, lng: 42.6 }, { minute: 105, lat: 22.2, lng: 34.5 }], note: "Reroutes south once jamming and closures intensify." },
  { id: "qtr908", callsign: "QTR908", type: "commercial", route: [{ minute: 0, lat: 24.2, lng: 50.6 }, { minute: 22, lat: 25.8, lng: 51.8 }, { minute: 40, lat: 27.1, lng: 52.9 }, { minute: 50, lat: 26.1, lng: 49.8 }, { minute: 76, lat: 23.6, lng: 45.4 }, { minute: 105, lat: 21.4, lng: 39.8 }], note: "Turns back west after closure cascade begins." },
  { id: "uae221", callsign: "UAE221", type: "commercial", route: [{ minute: 0, lat: 25.1, lng: 55.3 }, { minute: 24, lat: 24.8, lng: 53.1 }, { minute: 44, lat: 24.0, lng: 50.2 }, { minute: 62, lat: 23.6, lng: 47.7 }, { minute: 82, lat: 23.2, lng: 44.1 }, { minute: 105, lat: 22.8, lng: 40.4 }], note: "Enters holding geometry before diverting south-west." },
  { id: "alk710", callsign: "ALK710", type: "commercial", route: [{ minute: 0, lat: 26.5, lng: 47.3 }, { minute: 18, lat: 28.4, lng: 48.6 }, { minute: 36, lat: 30.0, lng: 49.8 }, { minute: 54, lat: 31.3, lng: 46.4 }, { minute: 78, lat: 32.5, lng: 40.7 }, { minute: 105, lat: 33.6, lng: 35.5 }], note: "Corridor thins around it as neighboring closures activate." },
  { id: "isr-22", callsign: "ISR22", type: "military", route: [{ minute: 0, lat: 29.3, lng: 43.8 }, { minute: 20, lat: 31.6, lng: 46.0 }, { minute: 38, lat: 32.8, lng: 49.6 }, { minute: 56, lat: 33.1, lng: 51.8 }, { minute: 80, lat: 32.4, lng: 48.3 }, { minute: 105, lat: 31.0, lng: 44.0 }], note: "Persistent orbit near the AOI throughout escalation." },
  { id: "tnk-14", callsign: "TNK14", type: "military", route: [{ minute: 0, lat: 28.0, lng: 45.0 }, { minute: 22, lat: 28.8, lng: 46.8 }, { minute: 40, lat: 29.4, lng: 48.2 }, { minute: 62, lat: 29.7, lng: 49.4 }, { minute: 84, lat: 29.1, lng: 46.7 }, { minute: 105, lat: 28.5, lng: 43.2 }], note: "Support aircraft remains outside the densest disruption zone." },
  { id: "awacs-5", callsign: "AWACS5", type: "military", route: [{ minute: 0, lat: 26.3, lng: 46.0 }, { minute: 26, lat: 26.9, lng: 47.4 }, { minute: 48, lat: 27.1, lng: 48.3 }, { minute: 72, lat: 26.8, lng: 47.5 }, { minute: 92, lat: 26.4, lng: 46.6 }, { minute: 105, lat: 26.2, lng: 45.7 }], note: "Airborne warning coverage expands after the first strike." }
];

const VESSELS = [
  { id: "tanker-a", name: "Tanker Meridian", type: "LNG", route: [{ minute: 0, lat: 26.8, lng: 55.7 }, { minute: 28, lat: 26.5, lng: 56.1 }, { minute: 54, lat: 26.3, lng: 56.3 }, { minute: 84, lat: 26.1, lng: 56.8 }, { minute: 105, lat: 25.8, lng: 57.4 }] },
  { id: "tanker-b", name: "Tanker Atlas", type: "Oil", route: [{ minute: 0, lat: 25.9, lng: 56.4 }, { minute: 26, lat: 25.8, lng: 56.0 }, { minute: 52, lat: 25.7, lng: 55.2 }, { minute: 78, lat: 25.4, lng: 54.1 }, { minute: 105, lat: 25.1, lng: 52.8 }] },
  { id: "damaged-tanker", name: "Damaged Tanker", type: "Oil", route: [{ minute: 0, lat: 26.0, lng: 56.2 }, { minute: 40, lat: 26.2, lng: 56.3 }, { minute: 82, lat: 26.1, lng: 56.2 }, { minute: 105, lat: 26.0, lng: 56.1 }] },
  { id: "cargo-east", name: "Cargo Eastbound", type: "Cargo", route: [{ minute: 0, lat: 24.8, lng: 53.1 }, { minute: 28, lat: 25.1, lng: 54.7 }, { minute: 56, lat: 25.3, lng: 56.0 }, { minute: 84, lat: 25.5, lng: 57.2 }, { minute: 105, lat: 25.7, lng: 58.4 }] }
];

const JAMMING_ZONES = [
  { id: "jam-1", bounds: [[30.2, 50.7], [33.8, 54.9]], start: 12, peak: 42, end: 88 },
  { id: "jam-2", bounds: [[28.4, 49.1], [31.6, 52.6]], start: 24, peak: 50, end: 92 },
  { id: "jam-3", bounds: [[25.2, 48.0], [28.8, 51.3]], start: 66, peak: 82, end: 105 }
];

const CLOSURES = [
  { id: "closure-iran", name: "Primary Theater Airspace", type: "Airspace Closure", polygon: [[38.4, 44.5], [39.1, 60.8], [25.3, 61.7], [24.4, 46.0]], start: 66, end: 105 },
  { id: "closure-iraq", name: "Western Closure Cascade", type: "Airspace Closure", polygon: [[37.8, 38.5], [37.5, 48.7], [28.8, 48.8], [29.0, 39.1]], start: 74, end: 105 },
  { id: "closure-strait", name: "Strait Restriction Zone", type: "Maritime Constraint", polygon: [[26.9, 55.3], [26.9, 57.3], [25.2, 57.3], [25.2, 55.3]], start: 91, end: 105 }
];

const state = {
  minute: 0,
  isPlaying: false,
  speed: 1,
  tileKey: "DARK",
  showCommercialFlights: true,
  showMilitaryFlights: true,
  showSatellites: true,
  showJamming: true,
  showMaritime: true,
  showClosures: true,
  showIncidents: true
};

const elements = {};
const layerGroups = {};
let map;
let tileLayer;
let playbackTimer;

function cacheElements() {
  Object.assign(elements, {
    scenarioBrief: document.getElementById("scenario-brief"),
    tileControls: document.getElementById("tile-controls"),
    layerControls: document.getElementById("layer-controls"),
    legendList: document.getElementById("legend-list"),
    eventList: document.getElementById("event-list"),
    assetSummary: document.getElementById("asset-summary"),
    dataNotes: document.getElementById("data-notes"),
    eventDetail: document.getElementById("event-detail"),
    passList: document.getElementById("pass-list"),
    impactList: document.getElementById("impact-list"),
    playbackStatusDot: document.getElementById("playback-status-dot"),
    playbackStatusText: document.getElementById("playback-status-text"),
    metricAlerts: document.getElementById("metric-alerts"),
    metricFlights: document.getElementById("metric-flights"),
    metricPasses: document.getElementById("metric-passes"),
    metricClosures: document.getElementById("metric-closures"),
    hudTheater: document.getElementById("hud-theater"),
    hudTime: document.getElementById("hud-time"),
    hudLayerSummary: document.getElementById("hud-layer-summary"),
    playToggle: document.getElementById("play-toggle"),
    pauseButton: document.getElementById("pause-btn"),
    resetButton: document.getElementById("reset-btn"),
    speedControls: document.getElementById("speed-controls"),
    timelineSlider: document.getElementById("timeline-slider"),
    timelineMarkers: document.getElementById("timeline-markers"),
    currentTime: document.getElementById("current-time"),
    currentStage: document.getElementById("current-stage")
  });
}

function savePreferences() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
  }
}

function restorePreferences() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const saved = JSON.parse(raw);
    Object.keys(state).forEach(key => {
      if (typeof state[key] === typeof saved[key]) {
        state[key] = saved[key];
      }
    });
    state.minute = clamp(state.minute, 0, SCENARIO.durationMinutes);
    if (!TILESETS[state.tileKey]) {
      state.tileKey = "DARK";
    }
    state.isPlaying = false;
  } catch {
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatMinute(minute) {
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutes = String(minute % 60).padStart(2, "0");
  return `T+${hours}:${minutes}Z`;
}

function activeStage() {
  return SCENARIO.stages.reduce((current, stage) => {
    if (stage.minute <= state.minute) {
      return stage;
    }
    return current;
  }, SCENARIO.stages[0]);
}

function nextStage() {
  return SCENARIO.stages.find(stage => stage.minute > state.minute) || null;
}

function interpolateRoute(route, minute) {
  if (!route.length) {
    return null;
  }
  if (minute <= route[0].minute) {
    return { lat: route[0].lat, lng: route[0].lng };
  }
  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const next = route[index];
    if (minute <= next.minute) {
      const span = next.minute - previous.minute;
      const ratio = span === 0 ? 0 : (minute - previous.minute) / span;
      return {
        lat: previous.lat + (next.lat - previous.lat) * ratio,
        lng: previous.lng + (next.lng - previous.lng) * ratio
      };
    }
  }
  const last = route[route.length - 1];
  return { lat: last.lat, lng: last.lng };
}

function isActiveWindow(start, end) {
  return state.minute >= start && state.minute <= end;
}

function currentFlights() {
  return FLIGHTS.filter(flight => {
    return (flight.type === "commercial" && state.showCommercialFlights) || (flight.type === "military" && state.showMilitaryFlights);
  }).map(flight => ({
    ...flight,
    ...interpolateRoute(flight.route, state.minute)
  }));
}

function currentSatellites() {
  if (!state.showSatellites) {
    return [];
  }
  return SATELLITES.map(satellite => ({
    ...satellite,
    ...interpolateRoute(satellite.route, state.minute),
    activePass: satellite.passWindows.find(window => isActiveWindow(window.start, window.end)) || null
  }));
}

function currentVessels() {
  if (!state.showMaritime) {
    return [];
  }
  return VESSELS.map(vessel => ({
    ...vessel,
    ...interpolateRoute(vessel.route, state.minute)
  }));
}

function currentJammingZones() {
  if (!state.showJamming) {
    return [];
  }
  return JAMMING_ZONES.filter(zone => state.minute >= zone.start && state.minute <= zone.end).map(zone => {
    const intensity = state.minute <= zone.peak
      ? (state.minute - zone.start) / Math.max(1, zone.peak - zone.start)
      : 1 - (state.minute - zone.peak) / Math.max(1, zone.end - zone.peak);
    return {
      ...zone,
      intensity: clamp(intensity, 0.18, 0.95)
    };
  });
}

function currentClosures() {
  if (!state.showClosures) {
    return [];
  }
  return CLOSURES.filter(closure => isActiveWindow(closure.start, closure.end));
}

function currentIncidents() {
  if (!state.showIncidents) {
    return [];
  }
  return SCENARIO.stages.filter(stage => stage.minute <= state.minute && state.minute - stage.minute <= 30);
}

function currentPassList() {
  return currentSatellites().filter(satellite => satellite.activePass);
}

function initMap() {
  map = L.map("map", {
    center: [29.7, 52.4],
    zoom: 4,
    zoomControl: false,
    attributionControl: false,
    worldCopyJump: true
  });

  L.control.zoom({ position: "bottomright" }).addTo(map);

  layerGroups.aoi = L.layerGroup().addTo(map);
  layerGroups.closures = L.layerGroup().addTo(map);
  layerGroups.jamming = L.layerGroup().addTo(map);
  layerGroups.flights = L.layerGroup().addTo(map);
  layerGroups.satellites = L.layerGroup().addTo(map);
  layerGroups.passes = L.layerGroup().addTo(map);
  layerGroups.vessels = L.layerGroup().addTo(map);
  layerGroups.incidents = L.layerGroup().addTo(map);

  setTileLayer(state.tileKey);
}

function setTileLayer(tileKey) {
  if (tileLayer) {
    tileLayer.remove();
  }
  state.tileKey = tileKey;
  const tile = TILESETS[tileKey];
  tileLayer = L.tileLayer(tile.url, { maxZoom: tile.maxZoom }).addTo(map);
  renderTileControls();
  savePreferences();
}

function tooltipOptions() {
  return {
    direction: "top",
    offset: [0, -8],
    opacity: 1,
    className: "worldline-tooltip"
  };
}

function iconHtml(className) {
  return `<span class="${className}"></span>`;
}

function drawMapLayers() {
  Object.values(layerGroups).forEach(group => group.clearLayers());

  const aoi = SCENARIO.aoi;
  L.circle([aoi.lat, aoi.lng], {
    radius: aoi.radiusMeters,
    color: "#74d6ff",
    weight: 1.2,
    fillColor: "#74d6ff",
    fillOpacity: 0.06,
    dashArray: "5 10"
  })
    .bindTooltip(`<strong>${aoi.label}</strong><br>Area-of-interest correlation ring`, tooltipOptions())
    .addTo(layerGroups.aoi);

  currentClosures().forEach(closure => {
    L.polygon(closure.polygon, {
      color: "rgba(255,255,255,0.82)",
      weight: 1.2,
      fillColor: "rgba(255,255,255,0.25)",
      fillOpacity: 0.12,
      dashArray: "6 8"
    })
      .bindTooltip(`<strong>${closure.name}</strong><br>${closure.type}`, tooltipOptions())
      .addTo(layerGroups.closures);
  });

  currentJammingZones().forEach(zone => {
    const color = `rgba(255,108,139,${zone.intensity})`;
    L.rectangle(zone.bounds, {
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: zone.intensity * 0.34
    })
      .bindTooltip(`<strong>GPS Disruption</strong><br>Intensity ${(zone.intensity * 100).toFixed(0)}%`, tooltipOptions())
      .addTo(layerGroups.jamming);
  });

  currentFlights().forEach(flight => {
    const className = flight.type === "commercial" ? "asset-icon commercial" : "asset-icon military";
    L.marker([flight.lat, flight.lng], {
      icon: L.divIcon({ className: "", iconSize: [12, 12], iconAnchor: [6, 6], html: iconHtml(className) })
    })
      .bindTooltip(`<strong>${flight.callsign}</strong><br>${flight.type === "commercial" ? "Commercial" : "Military"}<br>${flight.note}`, tooltipOptions())
      .addTo(layerGroups.flights);
  });

  currentSatellites().forEach(satellite => {
    L.marker([satellite.lat, satellite.lng], {
      icon: L.divIcon({ className: "", iconSize: [12, 12], iconAnchor: [6, 6], html: iconHtml("sat-icon") })
    })
      .bindTooltip(`<strong>${satellite.name}</strong><br>${satellite.type}${satellite.activePass ? `<br>${satellite.activePass.note}` : ""}`, tooltipOptions())
      .addTo(layerGroups.satellites);

    if (satellite.activePass) {
      L.polyline([[satellite.lat, satellite.lng], [aoi.lat, aoi.lng]], {
        color: satellite.color,
        weight: 1.2,
        opacity: 0.72,
        dashArray: "4 8"
      }).addTo(layerGroups.passes);
    }
  });

  currentVessels().forEach(vessel => {
    L.marker([vessel.lat, vessel.lng], {
      icon: L.divIcon({ className: "", iconSize: [12, 12], iconAnchor: [6, 6], html: iconHtml("ship-icon") })
    })
      .bindTooltip(`<strong>${vessel.name}</strong><br>${vessel.type} vessel`, tooltipOptions())
      .addTo(layerGroups.vessels);
  });

  currentIncidents().forEach(incident => {
    L.marker([incident.lat, incident.lng], {
      icon: L.divIcon({ className: "", iconSize: [12, 12], iconAnchor: [6, 6], html: iconHtml("event-icon") })
    })
      .bindTooltip(`<strong>${incident.title}</strong><br>${incident.summary}`, tooltipOptions())
      .addTo(layerGroups.incidents);
  });
}

function renderScenarioBrief() {
  elements.scenarioBrief.innerHTML = `
    <div class="brief-block">
      <p><strong>${SCENARIO.title}</strong></p>
      <p>${SCENARIO.description}</p>
    </div>
    <div class="brief-block">
      <p><strong>Theater:</strong> ${SCENARIO.theater}</p>
      <p><strong>Duration:</strong> ${SCENARIO.durationMinutes} minutes</p>
      <p><strong>AOI:</strong> ${SCENARIO.aoi.label}</p>
    </div>
  `;
}

function renderTileControls() {
  elements.tileControls.innerHTML = "";
  Object.entries(TILESETS).forEach(([key, tile]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn${key === state.tileKey ? " active" : ""}`;
    button.textContent = tile.label;
    button.addEventListener("click", () => setTileLayer(key));
    elements.tileControls.appendChild(button);
  });
}

function renderLayerControls() {
  elements.layerControls.innerHTML = "";
  LAYER_CONFIG.forEach(layer => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `layer-row${state[layer.key] ? " active" : ""}`;
    row.innerHTML = `
      <span class="layer-copy">
        <span class="layer-label">${layer.label}</span>
        <span class="layer-meta">${layer.meta}</span>
      </span>
      <span class="btn layer-toggle">${state[layer.key] ? "ON" : "OFF"}</span>
    `;
    row.addEventListener("click", () => {
      state[layer.key] = !state[layer.key];
      savePreferences();
      refreshUI();
    });
    elements.layerControls.appendChild(row);
  });
}

function renderLegend() {
  const legend = [
    { className: "commercial", label: "Commercial flights and civilian reroutes" },
    { className: "military", label: "Military air activity and support orbits" },
    { className: "satellite", label: "Orbital assets and AOI pass connections" },
    { className: "jamming", label: "GPS disruption tiles derived from tracking anomalies" },
    { className: "maritime", label: "Maritime traffic and tanker movement" },
    { className: "closure", label: "Airspace or maritime closure polygons" }
  ];
  elements.legendList.innerHTML = legend.map(item => `
    <div class="legend-row">
      <span class="legend-swatch ${item.className}"></span>
      <span class="legend-copy">${item.label}</span>
    </div>
  `).join("");
}

function renderEventList() {
  elements.eventList.innerHTML = SCENARIO.stages.map(stage => {
    const isActive = activeStage().id === stage.id;
    return `
      <button class="event-row${isActive ? " active" : ""}" type="button" data-minute="${stage.minute}">
        <span class="event-kicker">${formatMinute(stage.minute)} · ${stage.category}</span>
        <span class="event-title">${stage.title}</span>
        <span class="event-summary">${stage.summary}</span>
      </button>
    `;
  }).join("");

  elements.eventList.querySelectorAll("[data-minute]").forEach(button => {
    button.addEventListener("click", () => goToMinute(Number(button.dataset.minute)));
  });
}

function renderEventDetail() {
  const stage = activeStage();
  const next = nextStage();
  elements.eventDetail.innerHTML = `
    <div class="brief-block">
      <p><strong>${stage.title}</strong></p>
      <p>${stage.summary}</p>
    </div>
    <div class="brief-block">
      <p><strong>Impact:</strong> ${stage.impact}</p>
      <p><strong>Category:</strong> ${stage.category}</p>
      <p><strong>Next:</strong> ${next ? `${formatMinute(next.minute)} · ${next.title}` : "Replay complete"}</p>
    </div>
  `;
}

function renderPassList() {
  const passes = currentPassList();
  if (!passes.length) {
    elements.passList.innerHTML = '<div class="note-row">No satellites are directly crossing the AOI at the current replay minute.</div>';
    return;
  }
  elements.passList.innerHTML = passes.map(pass => `
    <div class="pass-row">
      <span class="pass-kicker">${pass.type}</span>
      <span class="pass-title">${pass.name}</span>
      <span class="event-summary">${pass.activePass.note}</span>
    </div>
  `).join("");
}

function renderImpactList() {
  const impacts = [
    ...currentClosures().map(item => ({ title: item.name, kicker: item.type, copy: "Active until replay end window." })),
    ...currentJammingZones().map(item => ({ title: item.id.toUpperCase(), kicker: "GPS Jamming", copy: `Intensity ${(item.intensity * 100).toFixed(0)}%.` }))
  ];

  if (!impacts.length) {
    elements.impactList.innerHTML = '<div class="note-row">No active closures or jamming cascades at this minute.</div>';
    return;
  }

  elements.impactList.innerHTML = impacts.map(impact => `
    <div class="impact-row">
      <span class="impact-kicker">${impact.kicker}</span>
      <span class="impact-title">${impact.title}</span>
      <span class="event-summary">${impact.copy}</span>
    </div>
  `).join("");
}

function renderAssetSummary() {
  const flights = currentFlights();
  const commercialCount = flights.filter(flight => flight.type === "commercial").length;
  const militaryCount = flights.filter(flight => flight.type === "military").length;
  const satellites = currentSatellites().length;
  const vessels = currentVessels().length;

  elements.assetSummary.innerHTML = `
    <div class="asset-row">
      <span class="asset-kicker">Air</span>
      <span class="asset-title">${commercialCount} commercial · ${militaryCount} military</span>
      <span class="event-summary">Tracks continue to update as the replay minute advances.</span>
    </div>
    <div class="asset-row">
      <span class="asset-kicker">Orbit</span>
      <span class="asset-title">${satellites} visible satellites</span>
      <span class="event-summary">${currentPassList().length} are currently correlated to the AOI.</span>
    </div>
    <div class="asset-row">
      <span class="asset-kicker">Sea</span>
      <span class="asset-title">${vessels} tracked vessels</span>
      <span class="event-summary">Tankers and cargo traffic react after chokepoint risk increases.</span>
    </div>
  `;
}

function renderDataNotes() {
  elements.dataNotes.innerHTML = `
    <div class="note-row">This build is a foundation demo: public-source style layers are correlated in time, not presented as live intelligence.</div>
    <div class="note-row">Satellites, flights, vessels, jamming, and closures are modeled as a replay dataset to prove the visualization workflow.</div>
    <div class="note-row">The architecture is ready for future replacement with real feeds and a 3D globe engine.</div>
  `;
}

function renderSpeedControls() {
  elements.speedControls.innerHTML = "";
  PLAYBACK_SPEEDS.forEach(speed => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn${speed.value === state.speed ? " active" : ""}`;
    button.textContent = speed.label;
    button.addEventListener("click", () => {
      state.speed = speed.value;
      savePreferences();
      restartPlaybackLoop();
      renderSpeedControls();
    });
    elements.speedControls.appendChild(button);
  });
}

function renderTimelineMarkers() {
  elements.timelineMarkers.innerHTML = "";
  SCENARIO.stages.forEach(stage => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = `timeline-marker${activeStage().id === stage.id ? " active" : ""}`;
    marker.style.left = `${(stage.minute / SCENARIO.durationMinutes) * 100}%`;
    marker.title = `${formatMinute(stage.minute)} · ${stage.title}`;
    marker.addEventListener("click", () => goToMinute(stage.minute));
    elements.timelineMarkers.appendChild(marker);
  });
}

function refreshHUD() {
  const stage = activeStage();
  const flights = currentFlights();
  const satellites = currentSatellites();
  const vessels = currentVessels();
  const incidents = currentIncidents();
  const activeClosures = currentClosures().length;
  const activeJamming = currentJammingZones().length;
  const totalDisruptions = activeClosures + activeJamming;

  elements.playbackStatusText.textContent = state.isPlaying ? `PLAYING · ${state.speed}×` : "PAUSED";
  elements.playbackStatusDot.style.background = state.isPlaying ? "var(--success)" : "var(--warning)";
  elements.playbackStatusDot.style.boxShadow = state.isPlaying ? "0 0 14px rgba(77, 243, 168, 0.65)" : "0 0 14px rgba(255, 190, 77, 0.65)";

  elements.metricAlerts.textContent = String(totalDisruptions);
  elements.metricFlights.textContent = String(flights.length);
  elements.metricPasses.textContent = String(currentPassList().length);
  elements.metricClosures.textContent = String(activeClosures);

  elements.hudTheater.textContent = `${SCENARIO.theater.toUpperCase()} · ${stage.category.toUpperCase()} ACTIVE`;
  elements.hudTime.textContent = formatMinute(state.minute);
  elements.hudLayerSummary.textContent = `${flights.length} FLIGHTS · ${satellites.length} SATS · ${vessels.length} SHIPS · ${incidents.length} INCIDENTS`;
  elements.currentTime.textContent = formatMinute(state.minute);
  elements.currentStage.textContent = stage.title;
  elements.timelineSlider.value = String(state.minute);
}

function refreshUI() {
  drawMapLayers();
  renderEventList();
  renderEventDetail();
  renderPassList();
  renderImpactList();
  renderAssetSummary();
  renderTimelineMarkers();
  refreshHUD();
}

function goToMinute(minute) {
  state.minute = clamp(Math.round(minute), 0, SCENARIO.durationMinutes);
  savePreferences();
  refreshUI();
}

function pausePlayback() {
  state.isPlaying = false;
  if (playbackTimer) {
    window.clearInterval(playbackTimer);
    playbackTimer = null;
  }
  refreshHUD();
}

function stepPlayback() {
  const profile = PLAYBACK_SPEEDS.find(speed => speed.value === state.speed) || PLAYBACK_SPEEDS[0];
  const nextMinute = state.minute + profile.minutesPerTick;
  if (nextMinute >= SCENARIO.durationMinutes) {
    goToMinute(SCENARIO.durationMinutes);
    pausePlayback();
    return;
  }
  goToMinute(nextMinute);
}

function restartPlaybackLoop() {
  if (!state.isPlaying) {
    refreshHUD();
    return;
  }
  if (playbackTimer) {
    window.clearInterval(playbackTimer);
  }
  playbackTimer = window.setInterval(stepPlayback, 350);
  refreshHUD();
}

function playPlayback() {
  state.isPlaying = true;
  restartPlaybackLoop();
}

function resetPlayback() {
  pausePlayback();
  goToMinute(0);
}

function registerEvents() {
  elements.playToggle.addEventListener("click", playPlayback);
  elements.pauseButton.addEventListener("click", pausePlayback);
  elements.resetButton.addEventListener("click", resetPlayback);
  elements.timelineSlider.addEventListener("input", event => goToMinute(Number(event.target.value)));
}

function boot() {
  cacheElements();
  restorePreferences();
  renderScenarioBrief();
  renderTileControls();
  renderLayerControls();
  renderLegend();
  renderDataNotes();
  renderSpeedControls();
  initMap();
  registerEvents();
  refreshUI();
}

window.addEventListener("load", boot);
