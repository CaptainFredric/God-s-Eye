import { BASEMAPS, DEFAULT_BOOKMARKS, FX_MODES, LAYERS, SCENARIO, STORAGE_KEYS } from "./data/scenario.js";
import { fetchLiveFeeds, fetchAisFeed, getConfiguredAisEndpoint, setConfiguredAisEndpoint } from "./services/live-feeds.js";
import { NEWS_CATEGORIES, fetchNewsCategory, fetchAllNewsCategories, invalidateNewsCache } from "./services/news-feeds.js";
import { initPresence, setPresenceName, getPresencePeers, onPeersChanged, isPresenceConnected } from "./services/presence.js";
import { initAudioEngine, sfx, setAudioEnabled, isAudioEnabled } from "./services/audio-engine.js";

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
  compact:   "panopticon-earth-compact",
  panelState:"panopticon-earth-panel-state",
  layouts:   "panopticon-earth-layouts",
  onboardingSeen: "panopticon-earth-onboarding-seen",
  panelStateVersion: "panopticon-earth-panel-version"
};

const PANEL_STATE_VERSION = 2;

const BOOT_SESSION_KEY = "panopticon-earth-boot-seen";

const PANEL_IDS = ["panel-layers", "panel-right", "floating-summary", "map-legend"];

const CAMERA_PRESETS = [
  {
    id: "preset-home",
    label: "Home",
    kicker: "Global",
    destination: {
      lng: SCENARIO.initialView.lng,
      lat: SCENARIO.initialView.lat,
      height: SCENARIO.initialView.height,
      heading: SCENARIO.initialView.heading,
      pitch: SCENARIO.initialView.pitch,
      roll: SCENARIO.initialView.roll
    }
  },
  { id: "preset-gulf", label: "Gulf Ops", kicker: "AOI", destination: DEFAULT_BOOKMARKS[0].destination, regionFocus: "Gulf Ops" },
  { id: "preset-europe", label: "Europe Arc", kicker: "Air", destination: DEFAULT_BOOKMARKS[1].destination, regionFocus: "Europe Arc" },
  { id: "preset-pacific", label: "Pacific Watch", kicker: "Nav", destination: DEFAULT_BOOKMARKS[2].destination, regionFocus: "Pacific Watch" },
  {
    id: "preset-theater",
    label: "Theater Core",
    kicker: "Signal",
    destination: { lng: 51.4, lat: 35.6, height: 2800000, heading: 0.22, pitch: -0.98, roll: 0 },
    regionFocus: "Theater Core"
  }
];

const STARTUP_VIEW = {
  lng: SCENARIO.initialView.lng,
  lat: SCENARIO.initialView.lat,
  height: 15800000,
  heading: SCENARIO.initialView.heading,
  pitch: -1.36,
  roll: 0
};

const SYSTEM_BOOKMARK_IDS = new Set(DEFAULT_BOOKMARKS.map(bookmark => bookmark.id));

const MISSION_GUIDE_STEPS = [
  {
    kicker: "Quick Start",
    title: "Live intelligence, right now",
    lead: "God's Eye pulls live ADS-B aircraft from OpenSky Network, real orbital tracks, maritime data, and GDELT 2.0 global news headlines — all rendered on a 3D WebGL globe with no backend required.",
    sections: [
      { title: "Start Here", items: ["Hit Next Hotspot to jump to an active geopolitical alert zone", "Click any aircraft, satellite, vessel, or incident to open its Intel Sheet", "Open News Briefing to see live GDELT headlines linked to map events"] }
    ],
    actions: [
      { id: "hotspot", label: "Go To Hotspot" },
      { id: "random-track", label: "Pick A Track" }
    ]
  },
  {
    kicker: "Workflow",
    title: "A typical intel session",
    lead: "Jump to a hotspot, cross-reference live news headlines, inspect conflict intel when you click any coordinates, then save your layout for the next session.",
    sections: [
      { title: "Core Loop", items: ["Next Hotspot → flies to an active alert with rotating narrative updates", "News Briefing → GDELT 2.0 headlines across 5 intelligence categories", "Click the globe → Conflict Intel Box surfaces nearby alerts by distance", "Brief Focus → generates a live situational summary of the current view"] },
      { title: "Visual Modes", items: ["FX: Night Vision, Thermal, and CRT overlays for different briefing aesthetics", "Event Visuals: ephemeral conflict bursts spawn from live GDELT headlines", "Location HUD: real-time geocoding as you pan across any region"] }
    ],
    actions: [
      { id: "brief", label: "Create Brief" },
      { id: "intel", label: "Open Intel" }
    ]
  },
  {
    kicker: "What It Is",
    title: "A real intelligence platform",
    lead: "Built entirely in vanilla JS and CesiumJS — no framework, no backend. Every aircraft is a live ADS-B transponder. Every news event is a real GDELT headline. Every conflict burst is algorithmically tied to live geospatial data.",
    sections: [
      { title: "Live Data Sources", items: ["OpenSky Network: real ADS-B transponder data, globally, every 90s", "GDELT 2.0 DOC API: 100+ language global media corpus, 5 categories", "OpenStreetMap Nominatim: geocoding for click-to-inspect coordinate popups"] },
      { title: "Technical Highlights", items: ["CesiumJS 3D globe with WebGL bloom, FXAA, and day/night globe lighting", "Persistent layouts, bookmarks, and FX settings via localStorage", "Draggable glass-morphism HUD with live threat-level computation"] }
    ],
    actions: [
      { id: "tour", label: "Start Tour" },
      { id: "save-layout", label: "Save Layout" }
    ]
  }
];

const state = {
  selectedEntity:        null,
  trackedEntity:         null,
  hoveredEntity:         null,
  spinning:              true,
  spinPausedUntil:       0,
  activeDrawer:          null,
  opsHotspotIndex:       0,
  opsTourTimer:          null,
  onboardingSeen:        loadJson(UI_STORAGE_KEYS.onboardingSeen, false),
  onboardingStep:        0,
  intelSheetOpen:        false,
  declutter:             loadJson(UI_STORAGE_KEYS.declutter, false),
  compact:               loadJson(UI_STORAGE_KEYS.compact, false),
  panelState:            loadPanelStateWithVersion(),
  savedLayouts:          loadJson(UI_STORAGE_KEYS.layouts, []),
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
  sessionStats:          { eventsSpawned: 0, articlesIngested: 0, countriesSeen: new Set(), sessionStart: Date.now() },
  locationHudVisible:    false,
  locationLastGeocode:   0,
  locationLastLng:       null,
  locationLastLat:       null,
  locationGeocodeTimer:  null,
  basemapId:             loadJson(STORAGE_KEYS.basemap, BASEMAPS[0].id),
  fxMode:                loadJson(STORAGE_KEYS.fxMode, FX_MODES[0].id),
  bookmarks:             normalizeBookmarks(loadJson(STORAGE_KEYS.bookmarks, DEFAULT_BOOKMARKS)),
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
let refreshPanelRestoreStrip = () => {};
const sparklineData = {
  tracks: [],
  alerts: [],
  orbits: [],
  feeds: []
};
const SPARKLINE_MAX_POINTS = 12;

const EVENT_VISUAL_STYLES = {
  alert: {
    dot: "#ff4d6d",
    cone: "#ff9f43",
    trail: "#00d4ff",
    ttlMs: 120000,
    coneLength: 210000,
    coneRadius: 68000,
    trailDistance: 540000
  },
  incident: {
    dot: "#ff0040",
    cone: "#ff4d6d",
    trail: "#a78bfa",
    ttlMs: 150000,
    coneLength: 260000,
    coneRadius: 82000,
    trailDistance: 680000
  }
};

const EVENT_REGION_OVERRIDES = {
  gulf: { trail: "#00ffc8", cone: "#ff9f43" },
  pacific: { trail: "#00d4ff", cone: "#a78bfa" },
  theater: { trail: "#ff4d6d", cone: "#ff0040" },
  europe: { trail: "#7ec8ff", cone: "#ff9f43" }
};

// ── Country geocoding for GDELT sourcecountry field ─────────────────────
// Approximate capital / centroid coords for countries GDELT commonly returns.
// Used to spawn event visuals at the real geographic origin of news articles.
const COUNTRY_COORDS = {
  "united states":    { lat: 38.9,  lng: -77.0 },
  "united kingdom":   { lat: 51.5,  lng: -0.13 },
  "france":           { lat: 48.9,  lng: 2.35  },
  "germany":          { lat: 52.5,  lng: 13.4  },
  "russia":           { lat: 55.8,  lng: 37.6  },
  "china":            { lat: 39.9,  lng: 116.4 },
  "india":            { lat: 28.6,  lng: 77.2  },
  "japan":            { lat: 35.7,  lng: 139.7 },
  "south korea":      { lat: 37.6,  lng: 127.0 },
  "north korea":      { lat: 39.0,  lng: 125.8 },
  "iran":             { lat: 35.7,  lng: 51.4  },
  "iraq":             { lat: 33.3,  lng: 44.4  },
  "israel":           { lat: 31.8,  lng: 35.2  },
  "palestine":        { lat: 31.9,  lng: 35.2  },
  "saudi arabia":     { lat: 24.7,  lng: 46.7  },
  "turkey":           { lat: 39.9,  lng: 32.9  },
  "syria":            { lat: 33.5,  lng: 36.3  },
  "lebanon":          { lat: 33.9,  lng: 35.5  },
  "egypt":            { lat: 30.0,  lng: 31.2  },
  "ukraine":          { lat: 50.4,  lng: 30.5  },
  "poland":           { lat: 52.2,  lng: 21.0  },
  "italy":            { lat: 41.9,  lng: 12.5  },
  "spain":            { lat: 40.4,  lng: -3.7  },
  "brazil":           { lat: -15.8, lng: -47.9 },
  "mexico":           { lat: 19.4,  lng: -99.1 },
  "canada":           { lat: 45.4,  lng: -75.7 },
  "australia":        { lat: -35.3, lng: 149.1 },
  "pakistan":          { lat: 33.7,  lng: 73.0  },
  "afghanistan":      { lat: 34.5,  lng: 69.2  },
  "nigeria":          { lat: 9.06,  lng: 7.49  },
  "south africa":     { lat: -25.7, lng: 28.2  },
  "kenya":            { lat: -1.29, lng: 36.8  },
  "ethiopia":         { lat: 9.02,  lng: 38.7  },
  "somalia":          { lat: 2.05,  lng: 45.3  },
  "sudan":            { lat: 15.6,  lng: 32.5  },
  "libya":            { lat: 32.9,  lng: 13.2  },
  "yemen":            { lat: 15.4,  lng: 44.2  },
  "united arab emirates": { lat: 24.5, lng: 54.7 },
  "qatar":            { lat: 25.3,  lng: 51.5  },
  "kuwait":           { lat: 29.4,  lng: 47.9  },
  "bahrain":          { lat: 26.2,  lng: 50.6  },
  "oman":             { lat: 23.6,  lng: 58.5  },
  "jordan":           { lat: 31.9,  lng: 35.9  },
  "morocco":          { lat: 34.0,  lng: -6.83 },
  "algeria":          { lat: 36.8,  lng: 3.06  },
  "tunisia":          { lat: 36.8,  lng: 10.2  },
  "taiwan":           { lat: 25.0,  lng: 121.6 },
  "philippines":      { lat: 14.6,  lng: 121.0 },
  "indonesia":        { lat: -6.2,  lng: 106.8 },
  "malaysia":         { lat: 3.14,  lng: 101.7 },
  "singapore":        { lat: 1.35,  lng: 103.8 },
  "thailand":         { lat: 13.8,  lng: 100.5 },
  "vietnam":          { lat: 21.0,  lng: 105.9 },
  "myanmar":          { lat: 19.8,  lng: 96.2  },
  "bangladesh":       { lat: 23.8,  lng: 90.4  },
  "nepal":            { lat: 27.7,  lng: 85.3  },
  "sri lanka":        { lat: 6.93,  lng: 79.8  },
  "colombia":         { lat: 4.71,  lng: -74.1 },
  "argentina":        { lat: -34.6, lng: -58.4 },
  "venezuela":        { lat: 10.5,  lng: -66.9 },
  "chile":            { lat: -33.4, lng: -70.7 },
  "peru":             { lat: -12.0, lng: -77.0 },
  "cuba":             { lat: 23.1,  lng: -82.4 },
  "greece":           { lat: 37.98, lng: 23.7  },
  "netherlands":      { lat: 52.4,  lng: 4.90  },
  "belgium":          { lat: 50.8,  lng: 4.35  },
  "sweden":           { lat: 59.3,  lng: 18.1  },
  "norway":           { lat: 59.9,  lng: 10.7  },
  "denmark":          { lat: 55.7,  lng: 12.6  },
  "finland":          { lat: 60.2,  lng: 24.9  },
  "switzerland":      { lat: 46.9,  lng: 7.45  },
  "austria":          { lat: 48.2,  lng: 16.4  },
  "romania":          { lat: 44.4,  lng: 26.1  },
  "hungary":          { lat: 47.5,  lng: 19.0  },
  "czech republic":   { lat: 50.1,  lng: 14.4  },
  "czechia":          { lat: 50.1,  lng: 14.4  },
  "portugal":         { lat: 38.7,  lng: -9.14 },
  "ireland":          { lat: 53.3,  lng: -6.26 },
  "new zealand":      { lat: -41.3, lng: 174.8 },
  "congo":            { lat: -4.32, lng: 15.3  },
  "democratic republic of the congo": { lat: -4.32, lng: 15.3 },
  "cameroon":         { lat: 3.87,  lng: 11.5  },
  "ghana":            { lat: 5.56,  lng: -0.19 },
  "mozambique":       { lat: -25.97, lng: 32.6 },
  "zimbabwe":         { lat: -17.8, lng: 31.0  },
  "tanzania":         { lat: -6.16, lng: 35.7  },
  "uganda":           { lat: 0.32,  lng: 32.6  },
  "mali":             { lat: 12.6,  lng: -8.0  },
  "niger":            { lat: 13.5,  lng: 2.12  },
  "burkina faso":     { lat: 12.4,  lng: -1.5  },
  "georgia":          { lat: 41.7,  lng: 44.8  },
  "armenia":          { lat: 40.2,  lng: 44.5  },
  "azerbaijan":       { lat: 40.4,  lng: 49.9  },
  "uzbekistan":       { lat: 41.3,  lng: 69.3  },
  "kazakhstan":       { lat: 51.2,  lng: 71.4  },
  "serbia":           { lat: 44.8,  lng: 20.5  },
  "croatia":          { lat: 45.8,  lng: 16.0  },
  "bosnia":           { lat: 43.9,  lng: 18.4  },
  "kosovo":           { lat: 42.7,  lng: 21.2  },
};

/**
 * City-level lookup dictionary — ~200 cities commonly appearing in geopolitical/conflict news.
 * Keys are lowercase. Coordinates are city centres (not country centroids).
 * This is the primary resolution layer; COUNTRY_COORDS is the fallback.
 */
const CITY_COORDS = {
  // Middle East & North Africa
  "gaza":           { lat: 31.52,  lng: 34.47,  name: "Gaza" },
  "gaza city":      { lat: 31.52,  lng: 34.47,  name: "Gaza City" },
  "tel aviv":       { lat: 32.09,  lng: 34.78,  name: "Tel Aviv" },
  "jerusalem":      { lat: 31.78,  lng: 35.22,  name: "Jerusalem" },
  "west bank":      { lat: 31.95,  lng: 35.30,  name: "West Bank" },
  "rafah":          { lat: 31.29,  lng: 34.25,  name: "Rafah" },
  "ramallah":       { lat: 31.90,  lng: 35.21,  name: "Ramallah" },
  "haifa":          { lat: 32.82,  lng: 34.99,  name: "Haifa" },
  "beirut":         { lat: 33.89,  lng: 35.50,  name: "Beirut" },
  "damascus":       { lat: 33.51,  lng: 36.29,  name: "Damascus" },
  "aleppo":         { lat: 36.20,  lng: 37.16,  name: "Aleppo" },
  "raqqa":          { lat: 35.95,  lng: 39.01,  name: "Raqqa" },
  "idlib":          { lat: 35.93,  lng: 36.63,  name: "Idlib" },
  "baghdad":        { lat: 33.34,  lng: 44.40,  name: "Baghdad" },
  "mosul":          { lat: 36.34,  lng: 43.13,  name: "Mosul" },
  "basra":          { lat: 30.51,  lng: 47.81,  name: "Basra" },
  "erbil":          { lat: 36.19,  lng: 44.01,  name: "Erbil" },
  "fallujah":       { lat: 33.35,  lng: 43.79,  name: "Fallujah" },
  "tehran":         { lat: 35.69,  lng: 51.39,  name: "Tehran" },
  "isfahan":        { lat: 32.66,  lng: 51.68,  name: "Isfahan" },
  "natanz":         { lat: 33.72,  lng: 51.93,  name: "Natanz" },
  "sanaa":          { lat: 15.37,  lng: 44.19,  name: "Sanaa" },
  "aden":           { lat: 12.78,  lng: 45.04,  name: "Aden" },
  "hodeidah":       { lat: 14.80,  lng: 42.95,  name: "Hodeidah" },
  "riyadh":         { lat: 24.69,  lng: 46.72,  name: "Riyadh" },
  "jeddah":         { lat: 21.49,  lng: 39.19,  name: "Jeddah" },
  "mecca":          { lat: 21.39,  lng: 39.86,  name: "Mecca" },
  "amman":          { lat: 31.95,  lng: 35.93,  name: "Amman" },
  "cairo":          { lat: 30.04,  lng: 31.24,  name: "Cairo" },
  "alexandria":     { lat: 31.21,  lng: 29.92,  name: "Alexandria" },
  "tripoli":        { lat: 32.90,  lng: 13.18,  name: "Tripoli" },
  "benghazi":       { lat: 32.12,  lng: 20.07,  name: "Benghazi" },
  "tunis":          { lat: 36.82,  lng: 10.17,  name: "Tunis" },
  "algiers":        { lat: 36.74,  lng: 3.06,   name: "Algiers" },
  "casablanca":     { lat: 33.59,  lng: -7.62,  name: "Casablanca" },
  "rabat":          { lat: 34.02,  lng: -6.83,  name: "Rabat" },
  "ankara":         { lat: 39.93,  lng: 32.86,  name: "Ankara" },
  "istanbul":       { lat: 41.01,  lng: 28.98,  name: "Istanbul" },
  "doha":           { lat: 25.29,  lng: 51.53,  name: "Doha" },
  "abu dhabi":      { lat: 24.45,  lng: 54.38,  name: "Abu Dhabi" },
  "dubai":          { lat: 25.20,  lng: 55.27,  name: "Dubai" },
  "muscat":         { lat: 23.62,  lng: 58.59,  name: "Muscat" },
  "kuwait city":    { lat: 29.37,  lng: 47.98,  name: "Kuwait City" },
  "manama":         { lat: 26.22,  lng: 50.59,  name: "Manama" },
  // Ukraine / Russia / Eastern Europe
  "kyiv":           { lat: 50.45,  lng: 30.52,  name: "Kyiv" },
  "kiev":           { lat: 50.45,  lng: 30.52,  name: "Kyiv" },
  "kharkiv":        { lat: 49.99,  lng: 36.23,  name: "Kharkiv" },
  "odessa":         { lat: 46.48,  lng: 30.72,  name: "Odessa" },
  "odesa":          { lat: 46.48,  lng: 30.72,  name: "Odesa" },
  "zaporizhzhia":   { lat: 47.84,  lng: 35.14,  name: "Zaporizhzhia" },
  "donetsk":        { lat: 48.00,  lng: 37.80,  name: "Donetsk" },
  "mariupol":       { lat: 47.10,  lng: 37.54,  name: "Mariupol" },
  "bakhmut":        { lat: 48.59,  lng: 38.00,  name: "Bakhmut" },
  "kherson":        { lat: 46.63,  lng: 32.62,  name: "Kherson" },
  "lviv":           { lat: 49.84,  lng: 24.03,  name: "Lviv" },
  "dnipro":         { lat: 48.46,  lng: 35.05,  name: "Dnipro" },
  "crimea":         { lat: 45.19,  lng: 34.00,  name: "Crimea" },
  "sevastopol":     { lat: 44.59,  lng: 33.52,  name: "Sevastopol" },
  "moscow":         { lat: 55.75,  lng: 37.62,  name: "Moscow" },
  "st. petersburg": { lat: 59.94,  lng: 30.32,  name: "St. Petersburg" },
  "st petersburg":  { lat: 59.94,  lng: 30.32,  name: "St. Petersburg" },
  "belgorod":       { lat: 50.60,  lng: 36.59,  name: "Belgorod" },
  "kaliningrad":    { lat: 54.71,  lng: 20.51,  name: "Kaliningrad" },
  "minsk":          { lat: 53.90,  lng: 27.57,  name: "Minsk" },
  "warsaw":         { lat: 52.23,  lng: 21.01,  name: "Warsaw" },
  "bucharest":      { lat: 44.43,  lng: 26.10,  name: "Bucharest" },
  "budapest":       { lat: 47.50,  lng: 19.04,  name: "Budapest" },
  "prague":         { lat: 50.08,  lng: 14.44,  name: "Prague" },
  "bratislava":     { lat: 48.15,  lng: 17.11,  name: "Bratislava" },
  "vilnius":        { lat: 54.69,  lng: 25.28,  name: "Vilnius" },
  "riga":           { lat: 56.95,  lng: 24.11,  name: "Riga" },
  "tallinn":        { lat: 59.44,  lng: 24.75,  name: "Tallinn" },
  "helsinki":       { lat: 60.17,  lng: 24.94,  name: "Helsinki" },
  "tbilisi":        { lat: 41.69,  lng: 44.83,  name: "Tbilisi" },
  "yerevan":        { lat: 40.18,  lng: 44.51,  name: "Yerevan" },
  "baku":           { lat: 40.41,  lng: 49.87,  name: "Baku" },
  "nagorno-karabakh": { lat: 39.82, lng: 46.76, name: "Nagorno-Karabakh" },
  // Asia-Pacific
  "beijing":        { lat: 39.91,  lng: 116.39, name: "Beijing" },
  "shanghai":       { lat: 31.23,  lng: 121.47, name: "Shanghai" },
  "hong kong":      { lat: 22.32,  lng: 114.17, name: "Hong Kong" },
  "taipei":         { lat: 25.05,  lng: 121.56, name: "Taipei" },
  "seoul":          { lat: 37.57,  lng: 126.98, name: "Seoul" },
  "pyongyang":      { lat: 39.02,  lng: 125.75, name: "Pyongyang" },
  "tokyo":          { lat: 35.69,  lng: 139.69, name: "Tokyo" },
  "osaka":          { lat: 34.69,  lng: 135.50, name: "Osaka" },
  "new delhi":      { lat: 28.61,  lng: 77.21,  name: "New Delhi" },
  "mumbai":         { lat: 19.08,  lng: 72.88,  name: "Mumbai" },
  "kolkata":        { lat: 22.57,  lng: 88.36,  name: "Kolkata" },
  "chennai":        { lat: 13.08,  lng: 80.27,  name: "Chennai" },
  "islamabad":      { lat: 33.72,  lng: 73.06,  name: "Islamabad" },
  "karachi":        { lat: 24.86,  lng: 67.01,  name: "Karachi" },
  "lahore":         { lat: 31.55,  lng: 74.34,  name: "Lahore" },
  "peshawar":       { lat: 34.01,  lng: 71.58,  name: "Peshawar" },
  "quetta":         { lat: 30.19,  lng: 67.01,  name: "Quetta" },
  "kabul":          { lat: 34.53,  lng: 69.17,  name: "Kabul" },
  "kandahar":       { lat: 31.62,  lng: 65.71,  name: "Kandahar" },
  "dhaka":          { lat: 23.81,  lng: 90.41,  name: "Dhaka" },
  "colombo":        { lat: 6.93,   lng: 79.86,  name: "Colombo" },
  "kathmandu":      { lat: 27.72,  lng: 85.32,  name: "Kathmandu" },
  "rangoon":        { lat: 16.87,  lng: 96.19,  name: "Yangon" },
  "yangon":         { lat: 16.87,  lng: 96.19,  name: "Yangon" },
  "naypyidaw":      { lat: 19.74,  lng: 96.12,  name: "Naypyidaw" },
  "bangkok":        { lat: 13.75,  lng: 100.52, name: "Bangkok" },
  "hanoi":          { lat: 21.03,  lng: 105.85, name: "Hanoi" },
  "ho chi minh":    { lat: 10.82,  lng: 106.63, name: "Ho Chi Minh City" },
  "jakarta":        { lat: -6.21,  lng: 106.85, name: "Jakarta" },
  "manila":         { lat: 14.60,  lng: 120.98, name: "Manila" },
  "kuala lumpur":   { lat: 3.14,   lng: 101.69, name: "Kuala Lumpur" },
  "singapore":      { lat: 1.35,   lng: 103.82, name: "Singapore" },
  "sydney":         { lat: -33.87, lng: 151.21, name: "Sydney" },
  "canberra":       { lat: -35.28, lng: 149.13, name: "Canberra" },
  // Africa
  "nairobi":        { lat: -1.29,  lng: 36.82,  name: "Nairobi" },
  "mogadishu":      { lat: 2.05,   lng: 45.34,  name: "Mogadishu" },
  "addis ababa":    { lat: 9.03,   lng: 38.74,  name: "Addis Ababa" },
  "khartoum":       { lat: 15.55,  lng: 32.53,  name: "Khartoum" },
  "omdurman":       { lat: 15.65,  lng: 32.48,  name: "Omdurman" },
  "juba":           { lat: 4.85,   lng: 31.60,  name: "Juba" },
  "asmara":         { lat: 15.34,  lng: 38.93,  name: "Asmara" },
  "djibouti":       { lat: 11.59,  lng: 43.15,  name: "Djibouti" },
  "kinshasa":       { lat: -4.32,  lng: 15.32,  name: "Kinshasa" },
  "lagos":          { lat: 6.52,   lng: 3.38,   name: "Lagos" },
  "abuja":          { lat: 9.07,   lng: 7.40,   name: "Abuja" },
  "accra":          { lat: 5.56,   lng: -0.21,  name: "Accra" },
  "dakar":          { lat: 14.72,  lng: -17.47, name: "Dakar" },
  "bamako":         { lat: 12.65,  lng: -8.00,  name: "Bamako" },
  "ouagadougou":    { lat: 12.37,  lng: -1.53,  name: "Ouagadougou" },
  "niamey":         { lat: 13.51,  lng: 2.12,   name: "Niamey" },
  "ndjamena":       { lat: 12.11,  lng: 15.04,  name: "N'Djamena" },
  "bangui":         { lat: 4.36,   lng: 18.56,  name: "Bangui" },
  "cape town":      { lat: -33.93, lng: 18.42,  name: "Cape Town" },
  "johannesburg":   { lat: -26.20, lng: 28.04,  name: "Johannesburg" },
  "harare":         { lat: -17.83, lng: 31.05,  name: "Harare" },
  "maputo":         { lat: -25.97, lng: 32.59,  name: "Maputo" },
  "luanda":         { lat: -8.84,  lng: 13.23,  name: "Luanda" },
  "dar es salaam":  { lat: -6.79,  lng: 39.21,  name: "Dar es Salaam" },
  "kampala":        { lat: 0.32,   lng: 32.58,  name: "Kampala" },
  "kigali":         { lat: -1.95,  lng: 30.06,  name: "Kigali" },
  // Europe
  "london":         { lat: 51.51,  lng: -0.13,  name: "London" },
  "paris":          { lat: 48.85,  lng: 2.35,   name: "Paris" },
  "berlin":         { lat: 52.52,  lng: 13.40,  name: "Berlin" },
  "brussels":       { lat: 50.85,  lng: 4.35,   name: "Brussels" },
  "madrid":         { lat: 40.42,  lng: -3.70,  name: "Madrid" },
  "barcelona":      { lat: 41.39,  lng: 2.16,   name: "Barcelona" },
  "seville":        { lat: 37.39,  lng: -5.98,  name: "Seville" },
  "valencia":       { lat: 39.47,  lng: -0.38,  name: "Valencia" },
  "bilbao":         { lat: 43.26,  lng: -2.93,  name: "Bilbao" },
  "rome":           { lat: 41.90,  lng: 12.50,  name: "Rome" },
  "milan":          { lat: 45.46,  lng: 9.19,   name: "Milan" },
  "naples":         { lat: 40.85,  lng: 14.27,  name: "Naples" },
  "florence":       { lat: 43.77,  lng: 11.25,  name: "Florence" },
  "turin":          { lat: 45.07,  lng: 7.69,   name: "Turin" },
  "amsterdam":      { lat: 52.37,  lng: 4.90,   name: "Amsterdam" },
  "rotterdam":      { lat: 51.92,  lng: 4.48,   name: "Rotterdam" },
  "stockholm":      { lat: 59.33,  lng: 18.07,  name: "Stockholm" },
  "gothenburg":     { lat: 57.71,  lng: 11.97,  name: "Gothenburg" },
  "oslo":           { lat: 59.91,  lng: 10.75,  name: "Oslo" },
  "copenhagen":     { lat: 55.68,  lng: 12.57,  name: "Copenhagen" },
  "vienna":         { lat: 48.21,  lng: 16.37,  name: "Vienna" },
  "bern":           { lat: 46.95,  lng: 7.45,   name: "Bern" },
  "zurich":         { lat: 47.38,  lng: 8.54,   name: "Zurich" },
  "geneva":         { lat: 46.20,  lng: 6.14,   name: "Geneva" },
  "munich":         { lat: 48.14,  lng: 11.58,  name: "Munich" },
  "frankfurt":      { lat: 50.11,  lng: 8.68,   name: "Frankfurt" },
  "hamburg":        { lat: 53.55,  lng: 9.99,   name: "Hamburg" },
  "cologne":        { lat: 50.94,  lng: 6.96,   name: "Cologne" },
  "düsseldorf":     { lat: 51.23,  lng: 6.78,   name: "Düsseldorf" },
  "dusseldorf":     { lat: 51.23,  lng: 6.78,   name: "Düsseldorf" },
  "lyon":           { lat: 45.76,  lng: 4.84,   name: "Lyon" },
  "marseille":      { lat: 43.30,  lng: 5.37,   name: "Marseille" },
  "toulouse":       { lat: 43.60,  lng: 1.44,   name: "Toulouse" },
  "nice":           { lat: 43.71,  lng: 7.26,   name: "Nice" },
  "strasbourg":     { lat: 48.57,  lng: 7.75,   name: "Strasbourg" },
  // Greece
  "athens":         { lat: 37.98,  lng: 23.73,  name: "Athens" },
  "thessaloniki":   { lat: 40.64,  lng: 22.94,  name: "Thessaloniki" },
  "patras":         { lat: 38.25,  lng: 21.73,  name: "Patras" },
  "heraklion":      { lat: 35.34,  lng: 25.13,  name: "Heraklion" },
  "larissa":        { lat: 39.64,  lng: 22.42,  name: "Larissa" },
  "volos":          { lat: 39.36,  lng: 22.94,  name: "Volos" },
  "ioannina":       { lat: 39.66,  lng: 20.85,  name: "Ioannina" },
  "piraeus":        { lat: 37.94,  lng: 23.65,  name: "Piraeus" },
  "rhodes":         { lat: 36.43,  lng: 28.22,  name: "Rhodes" },
  "corfu":          { lat: 39.62,  lng: 19.92,  name: "Corfu" },
  "crete":          { lat: 35.24,  lng: 24.47,  name: "Crete" },
  "lesbos":         { lat: 39.10,  lng: 26.55,  name: "Lesbos" },
  "samos":          { lat: 37.75,  lng: 26.97,  name: "Samos" },
  "chios":          { lat: 38.37,  lng: 26.14,  name: "Chios" },
  "alexandroupoli": { lat: 40.85,  lng: 25.87,  name: "Alexandroupoli" },
  "kavala":         { lat: 40.94,  lng: 24.40,  name: "Kavala" },
  "chania":         { lat: 35.51,  lng: 24.02,  name: "Chania" },
  // Balkans extended
  "belgrade":       { lat: 44.80,  lng: 20.46,  name: "Belgrade" },
  "zagreb":         { lat: 45.81,  lng: 15.98,  name: "Zagreb" },
  "sarajevo":       { lat: 43.85,  lng: 18.40,  name: "Sarajevo" },
  "pristina":       { lat: 42.67,  lng: 21.17,  name: "Pristina" },
  "skopje":         { lat: 41.99,  lng: 21.43,  name: "Skopje" },
  "tirana":         { lat: 41.33,  lng: 19.82,  name: "Tirana" },
  "podgorica":      { lat: 42.44,  lng: 19.26,  name: "Podgorica" },
  "sofia":          { lat: 42.70,  lng: 23.32,  name: "Sofia" },
  "plovdiv":        { lat: 42.15,  lng: 24.75,  name: "Plovdiv" },
  "chisinau":       { lat: 47.01,  lng: 28.86,  name: "Chișinău" },
  // Portugal
  "lisbon":         { lat: 38.72,  lng: -9.14,  name: "Lisbon" },
  "porto":          { lat: 41.16,  lng: -8.63,  name: "Porto" },
  // UK / Ireland
  "dublin":         { lat: 53.33,  lng: -6.25,  name: "Dublin" },
  "edinburgh":      { lat: 55.95,  lng: -3.19,  name: "Edinburgh" },
  "manchester":     { lat: 53.48,  lng: -2.24,  name: "Manchester" },
  "birmingham":     { lat: 52.49,  lng: -1.89,  name: "Birmingham" },
  "belfast":        { lat: 54.60,  lng: -5.93,  name: "Belfast" },
  "glasgow":        { lat: 55.86,  lng: -4.25,  name: "Glasgow" },
  // Nordics / Poland
  "gdansk":         { lat: 54.35,  lng: 18.65,  name: "Gdańsk" },
  "krakow":         { lat: 50.06,  lng: 19.94,  name: "Kraków" },
  "wroclaw":        { lat: 51.11,  lng: 17.04,  name: "Wrocław" },
  // Americas
  "washington":     { lat: 38.90,  lng: -77.03, name: "Washington D.C." },
  "washington d.c.": { lat: 38.90, lng: -77.03, name: "Washington D.C." },
  "new york":       { lat: 40.71,  lng: -74.01, name: "New York" },
  "los angeles":    { lat: 34.05,  lng: -118.24,name: "Los Angeles" },
  "chicago":        { lat: 41.88,  lng: -87.63, name: "Chicago" },
  "houston":        { lat: 29.76,  lng: -95.37, name: "Houston" },
  "san francisco":  { lat: 37.77,  lng: -122.42,name: "San Francisco" },
  "miami":          { lat: 25.76,  lng: -80.19, name: "Miami" },
  "atlanta":        { lat: 33.75,  lng: -84.39, name: "Atlanta" },
  "boston":          { lat: 42.36,  lng: -71.06, name: "Boston" },
  "seattle":        { lat: 47.61,  lng: -122.33,name: "Seattle" },
  "denver":         { lat: 39.74,  lng: -104.99,name: "Denver" },
  "dallas":         { lat: 32.78,  lng: -96.80, name: "Dallas" },
  "phoenix":        { lat: 33.45,  lng: -112.07,name: "Phoenix" },
  "detroit":        { lat: 42.33,  lng: -83.05, name: "Detroit" },
  "ottawa":         { lat: 45.42,  lng: -75.70, name: "Ottawa" },
  "toronto":        { lat: 43.70,  lng: -79.42, name: "Toronto" },
  "vancouver":      { lat: 49.28,  lng: -123.12,name: "Vancouver" },
  "montreal":       { lat: 45.50,  lng: -73.57, name: "Montreal" },
  "mexico city":    { lat: 19.43,  lng: -99.13, name: "Mexico City" },
  "guadalajara":    { lat: 20.67,  lng: -103.35,name: "Guadalajara" },
  "monterrey":      { lat: 25.69,  lng: -100.32,name: "Monterrey" },
  "tijuana":        { lat: 32.53,  lng: -117.02,name: "Tijuana" },
  "havana":         { lat: 23.14,  lng: -82.38, name: "Havana" },
  "bogota":         { lat: 4.71,   lng: -74.07, name: "Bogotá" },
  "medellin":       { lat: 6.25,   lng: -75.56, name: "Medellín" },
  "caracas":        { lat: 10.48,  lng: -66.88, name: "Caracas" },
  "lima":           { lat: -12.05, lng: -77.04, name: "Lima" },
  "quito":          { lat: -0.18,  lng: -78.47, name: "Quito" },
  "guayaquil":      { lat: -2.19,  lng: -79.89, name: "Guayaquil" },
  "buenos aires":   { lat: -34.61, lng: -58.38, name: "Buenos Aires" },
  "santiago":       { lat: -33.46, lng: -70.65, name: "Santiago" },
  "brasilia":       { lat: -15.78, lng: -47.93, name: "Brasília" },
  "sao paulo":      { lat: -23.55, lng: -46.63, name: "São Paulo" },
  "rio de janeiro": { lat: -22.91, lng: -43.17, name: "Rio de Janeiro" },
  "rio":            { lat: -22.91, lng: -43.17, name: "Rio de Janeiro" },
  "port-au-prince": { lat: 18.54,  lng: -72.34, name: "Port-au-Prince" },
  "panama city":    { lat: 8.98,   lng: -79.52, name: "Panama City" },
  "san juan":       { lat: 18.47,  lng: -66.11, name: "San Juan" },
  "santo domingo":  { lat: 18.47,  lng: -69.90, name: "Santo Domingo" },
  "managua":        { lat: 12.13,  lng: -86.25, name: "Managua" },
  "tegucigalpa":    { lat: 14.07,  lng: -87.19, name: "Tegucigalpa" },
  "san salvador":   { lat: 13.69,  lng: -89.22, name: "San Salvador" },
  "guatemala city": { lat: 14.63,  lng: -90.51, name: "Guatemala City" },
  "montevideo":     { lat: -34.88, lng: -56.16, name: "Montevideo" },
  "asuncion":       { lat: -25.26, lng: -57.58, name: "Asunción" },
  "la paz":         { lat: -16.49, lng: -68.12, name: "La Paz" },
  // Straits / regions
  "strait of hormuz": { lat: 26.60, lng: 56.40, name: "Strait of Hormuz" },
  "red sea":        { lat: 20.0,   lng: 38.0,   name: "Red Sea" },
  "black sea":      { lat: 43.0,   lng: 35.0,   name: "Black Sea" },
  "south china sea":{ lat: 15.0,   lng: 115.0,  name: "South China Sea" },
  "taiwan strait":  { lat: 24.5,   lng: 119.5,  name: "Taiwan Strait" },
  "baltic sea":     { lat: 58.0,   lng: 20.0,   name: "Baltic Sea" },
  "persian gulf":   { lat: 26.5,   lng: 51.5,   name: "Persian Gulf" },
  "gulf of aden":   { lat: 12.0,   lng: 47.0,   name: "Gulf of Aden" },
  "suez canal":     { lat: 30.58,  lng: 32.35,  name: "Suez Canal" },
  "bosporus":       { lat: 41.12,  lng: 29.08,  name: "Bosporus" },
  "hormuz":         { lat: 26.60,  lng: 56.40,  name: "Strait of Hormuz" },
  "mediterranean":  { lat: 35.0,   lng: 18.0,   name: "Mediterranean Sea" },
  "aegean":         { lat: 38.5,   lng: 25.0,   name: "Aegean Sea" },
  "adriatic":       { lat: 42.5,   lng: 16.0,   name: "Adriatic Sea" },
  "arctic":         { lat: 75.0,   lng: 0.0,    name: "Arctic" },
  // Native-script city names (for non-English headlines)
  // Greek
  "αθήνα":          { lat: 37.98,  lng: 23.73,  name: "Athens" },
  "θεσσαλονίκη":   { lat: 40.64,  lng: 22.94,  name: "Thessaloniki" },
  "πάτρα":          { lat: 38.25,  lng: 21.73,  name: "Patras" },
  "ηράκλειο":       { lat: 35.34,  lng: 25.13,  name: "Heraklion" },
  "πειραιάς":       { lat: 37.94,  lng: 23.65,  name: "Piraeus" },
  "λάρισα":         { lat: 39.64,  lng: 22.42,  name: "Larissa" },
  "κρήτη":          { lat: 35.24,  lng: 24.47,  name: "Crete" },
  "ρόδος":          { lat: 36.43,  lng: 28.22,  name: "Rhodes" },
  "κέρκυρα":        { lat: 39.62,  lng: 19.92,  name: "Corfu" },
  "χανιά":          { lat: 35.51,  lng: 24.02,  name: "Chania" },
  "βόλος":          { lat: 39.36,  lng: 22.94,  name: "Volos" },
  "ιωάννινα":       { lat: 39.66,  lng: 20.85,  name: "Ioannina" },
  "αλεξανδρούπολη": { lat: 40.85,  lng: 25.87,  name: "Alexandroupoli" },
  "χεζμπολάχ":      { lat: 33.89,  lng: 35.50,  name: "Beirut" },
  // Arabic
  "بغداد":          { lat: 33.34,  lng: 44.40,  name: "Baghdad" },
  "دمشق":           { lat: 33.51,  lng: 36.29,  name: "Damascus" },
  "بيروت":          { lat: 33.89,  lng: 35.50,  name: "Beirut" },
  "القاهرة":        { lat: 30.04,  lng: 31.24,  name: "Cairo" },
  "الرياض":         { lat: 24.69,  lng: 46.72,  name: "Riyadh" },
  "طهران":          { lat: 35.69,  lng: 51.39,  name: "Tehran" },
  "غزة":            { lat: 31.52,  lng: 34.47,  name: "Gaza" },
  "القدس":          { lat: 31.78,  lng: 35.22,  name: "Jerusalem" },
  "صنعاء":          { lat: 15.37,  lng: 44.19,  name: "Sanaa" },
  "الخرطوم":        { lat: 15.55,  lng: 32.53,  name: "Khartoum" },
  "طرابلس":         { lat: 32.90,  lng: 13.18,  name: "Tripoli" },
  "حلب":            { lat: 36.20,  lng: 37.16,  name: "Aleppo" },
  "إدلب":           { lat: 35.93,  lng: 36.63,  name: "Idlib" },
  "الموصل":         { lat: 36.34,  lng: 43.13,  name: "Mosul" },
  // Russian / Cyrillic
  "москва":         { lat: 55.75,  lng: 37.62,  name: "Moscow" },
  "киев":           { lat: 50.45,  lng: 30.52,  name: "Kyiv" },
  "київ":           { lat: 50.45,  lng: 30.52,  name: "Kyiv" },
  "харків":         { lat: 49.99,  lng: 36.23,  name: "Kharkiv" },
  "харьков":        { lat: 49.99,  lng: 36.23,  name: "Kharkiv" },
  "одеса":          { lat: 46.48,  lng: 30.72,  name: "Odesa" },
  "донецьк":        { lat: 48.00,  lng: 37.80,  name: "Donetsk" },
  "донецк":         { lat: 48.00,  lng: 37.80,  name: "Donetsk" },
  "минск":          { lat: 53.90,  lng: 27.57,  name: "Minsk" },
  "белгород":       { lat: 50.60,  lng: 36.59,  name: "Belgorod" },
  "санкт-петербург": { lat: 59.94, lng: 30.32,  name: "St. Petersburg" },
  // Chinese
  "北京":            { lat: 39.91,  lng: 116.39, name: "Beijing" },
  "上海":            { lat: 31.23,  lng: 121.47, name: "Shanghai" },
  "台北":            { lat: 25.05,  lng: 121.56, name: "Taipei" },
  "香港":            { lat: 22.32,  lng: 114.17, name: "Hong Kong" },
  // Japanese
  "東京":            { lat: 35.69,  lng: 139.69, name: "Tokyo" },
  "大阪":            { lat: 34.69,  lng: 135.50, name: "Osaka" },
  // Korean
  "서울":            { lat: 37.57,  lng: 126.98, name: "Seoul" },
  "평양":            { lat: 39.02,  lng: 125.75, name: "Pyongyang" },
  // Turkish
  "İstanbul":       { lat: 41.01,  lng: 28.98,  name: "Istanbul" },
  // Spanish-language city names
  "ciudad de méxico": { lat: 19.43, lng: -99.13, name: "Mexico City" },
  "nueva york":     { lat: 40.71,  lng: -74.01, name: "New York" },
  // Portuguese
  "são paulo":      { lat: -23.55, lng: -46.63, name: "São Paulo" },
  "rio de janeiro": { lat: -22.91, lng: -43.17, name: "Rio de Janeiro" },
  // Hindi / Devanagari
  "दिल्ली":          { lat: 28.61,  lng: 77.21,  name: "New Delhi" },
  "मुंबई":           { lat: 19.08,  lng: 72.88,  name: "Mumbai" },
  // Hebrew
  "תל אביב":        { lat: 32.09,  lng: 34.78,  name: "Tel Aviv" },
  "ירושלים":        { lat: 31.78,  lng: 35.22,  name: "Jerusalem" },
  // Hezbollah / organisation-as-location (maps to HQ area)
  "hezbollah":      { lat: 33.86,  lng: 35.51,  name: "Beirut" },
  "hamas":          { lat: 31.52,  lng: 34.47,  name: "Gaza" },
  "houthi":         { lat: 15.37,  lng: 44.19,  name: "Sanaa" },
  "houthis":        { lat: 15.37,  lng: 44.19,  name: "Sanaa" },
  "kremlin":        { lat: 55.75,  lng: 37.62,  name: "Moscow" },
  "pentagon":       { lat: 38.87,  lng: -77.06, name: "Washington D.C." },
  "nato":           { lat: 50.88,  lng: 4.43,   name: "Brussels" },
  "wagner":         { lat: 55.75,  lng: 37.62,  name: "Moscow" },
};

/**
 * Extract the best location from a news article title and sourcecountry.
 * Returns { lat, lng, name } or null.
 * Priority: city/place match in title > Nominatim-cached lookup > country capital
 */

// Persistent Nominatim geocode cache — survives page reloads
const _GEO_CACHE_KEY = "ge-geocache-v1";
let _nominatimGeoCache = (() => {
  try { return JSON.parse(localStorage.getItem(_GEO_CACHE_KEY) || "{}"); }
  catch(e) { return {}; }
})();
function _saveGeoCache() {
  try { localStorage.setItem(_GEO_CACHE_KEY, JSON.stringify(_nominatimGeoCache)); } catch(e) {}
}

// Rate-limited async enrichment — geocodes unknown place names via Nominatim,
// stores results in _nominatimGeoCache for future synchronous use.
const _enrichQueue = new Set();
async function enrichGeoCache(placeName) {
  if (!placeName || _enrichQueue.has(placeName) || _nominatimGeoCache[placeName]) return;
  _enrichQueue.add(placeName);
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(placeName)}&format=json&limit=1&addressdetails=0`;
    const resp = await nominatimFetch(url);
    if (!resp.ok) return;
    const results = await resp.json();
    if (Array.isArray(results) && results.length > 0) {
      const r = results[0];
      _nominatimGeoCache[placeName] = { lat: parseFloat(r.lat), lng: parseFloat(r.lon), name: r.display_name.split(",")[0] };
      _saveGeoCache();
    }
  } catch(e) { /* non-critical */ } finally {
    _enrichQueue.delete(placeName);
  }
}

function resolveArticleGeo(article) {
  const title = (article?.title || "").toLowerCase();
  const country = (article?.country || "").toLowerCase().trim();

  // 1. Scan title for known city/place names (longest match wins)
  let bestMatch = null;
  let bestLen = 0;
  for (const [key, coords] of Object.entries(CITY_COORDS)) {
    if (key.length > bestLen && title.includes(key)) {
      bestMatch = coords;
      bestLen = key.length;
    }
  }
  if (bestMatch) {
    return {
      lat: bestMatch.lat + (Math.random() - 0.5) * 0.3,
      lng: bestMatch.lng + (Math.random() - 0.5) * 0.3,
      name: bestMatch.name
    };
  }

  // 2. Check Nominatim persistent cache (filled async from previous lookups)
  if (country && _nominatimGeoCache[country]) {
    const c = _nominatimGeoCache[country];
    return { lat: c.lat + (Math.random() - 0.5) * 0.5, lng: c.lng + (Math.random() - 0.5) * 0.5, name: c.name };
  }

  // 3. Fall back to country capital coords (already city-level)
  if (!country) return null;
  const coords = COUNTRY_COORDS[country];
  if (coords) {
    // Fire async enrichment for countries not in our city dict — result cached for next time
    if (!COUNTRY_COORDS[country] || !CITY_COORDS[country]) enrichGeoCache(article.country);
    return {
      lat: coords.lat + (Math.random() - 0.5) * 1.5,
      lng: coords.lng + (Math.random() - 0.5) * 1.5,
      name: article.country
    };
  }

  // 4. Last resort: fire Nominatim and return null this time (will succeed next spawn)
  enrichGeoCache(article.country || title.split(" ").slice(0, 3).join(" "));
  return null;
}

const dynamic = {
  trails:      [],
  zones:       [],
  incidents:   [],
  traffic:     [],
  rings:       [],
  radars:      [],
  liveTraffic: [],
  eventVisuals: [],
  connectionLines: []
};

let frameSamples = [];
let _consolePulseTimer = null;
let _throughputBytes = 0;
let _ambientUpdateTimer = null;
let eventVisualSpawnTimer = null;
let eventVisualPruneTimer = null;
let eventVisualLabelTimer = null;
let threatUpdateTimer = null;

// Global Nominatim rate limiter (≤1 request per second)
let _lastNominatimMs = 0;
async function nominatimFetch(url) {
  const now = Date.now();
  const wait = Math.max(0, 1050 - (now - _lastNominatimMs));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastNominatimMs = Date.now();
  return fetch(url, {
    headers: { "Accept-Language": "en-US,en", "User-Agent": "GodsEye/1.0 intelligence-dashboard" }
  });
}

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
viewer.scene.globe.nightFadeOutDistance    = 1e7;
viewer.scene.globe.nightFadeInDistance     = 5e6;
viewer.scene.skyAtmosphere.show            = true;
viewer.scene.skyAtmosphere.hueShift        = -0.05;
viewer.scene.skyAtmosphere.saturationShift = 0.12;
viewer.scene.skyAtmosphere.brightnessShift = -0.08;
viewer.scene.globe.atmosphereLightIntensity = 6.0;
viewer.scene.globe.showGroundAtmosphere    = true;
viewer.scene.globe.depthTestAgainstTerrain = false;
viewer.clock.shouldAnimate                 = false;
viewer.resolutionScale                     = Math.min(window.devicePixelRatio || 1, 1.6);

const homeView = Cesium.Cartesian3.fromDegrees(
  STARTUP_VIEW.lng,
  STARTUP_VIEW.lat,
  STARTUP_VIEW.height
);
// Start zoomed out for dramatic entry, then fly in
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(STARTUP_VIEW.lng, STARTUP_VIEW.lat, 28000000),
  orientation: {
    heading: STARTUP_VIEW.heading,
    pitch:   -1.57,
    roll:    STARTUP_VIEW.roll
  }
});
// Animate zoom-in after 500ms delay
setTimeout(() => {
  viewer.camera.flyTo({
    destination: homeView,
    orientation: {
      heading: STARTUP_VIEW.heading,
      pitch:   STARTUP_VIEW.pitch,
      roll:    STARTUP_VIEW.roll
    },
    duration: 3.0,
    easingFunction: Cesium.EasingFunction.QUARTIC_IN_OUT
  });
}, 500);

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
renderCameraPresets();
renderBookmarks();
renderSavedLayouts();
renderFxButtons();
installBasemap(state.basemapId);
seedScene();
renderFeedStatus();
renderTrustIndicators();
registerEvents();
updateSummaryHint();
updateOperationsControls();
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
ensureMobilePanelVisibility();
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
  if (selectedType === "incident" || selectedType === "alert") {
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
    cameraPresets:       document.getElementById("camera-presets"),
    bookmarkList:        document.getElementById("bookmark-list"),
    saveBookmark:        document.getElementById("save-bookmark"),
    clearBookmarks:      document.getElementById("clear-bookmarks"),
    layoutList:          document.getElementById("layout-list"),
    saveLayout:          document.getElementById("save-layout"),
    clearLayouts:        document.getElementById("clear-layouts"),
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
    opsNextHotspot:      document.getElementById("ops-next-hotspot"),
    opsRandomTrack:      document.getElementById("ops-random-track"),
    opsOpenIntel:        document.getElementById("ops-open-intel"),
    opsBriefFocus:       document.getElementById("ops-brief-focus"),
    opsTourToggle:       document.getElementById("ops-tour-toggle"),
    opsBrief:            document.getElementById("ops-brief"),
    opsBriefTitle:       document.getElementById("ops-brief-title"),
    opsBriefCopy:        document.getElementById("ops-brief-copy"),
    opsBriefMeta:        document.getElementById("ops-brief-meta"),
    summaryStage:        document.getElementById("summary-stage"),
    summaryTime:         document.getElementById("summary-time"),
    summaryCopy:         document.getElementById("summary-copy"),
    summaryTags:         document.getElementById("summary-tags"),
    summaryHotspot:      document.getElementById("summary-hotspot"),
    summaryRandom:       document.getElementById("summary-random"),
    summaryNews:         document.getElementById("summary-news"),
    summaryGuide:        document.getElementById("summary-guide"),
    summaryHint:         document.getElementById("summary-hint"),
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
    btnMobileSignals:    document.getElementById("btn-mobile-signals"),
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
    intelSourceBar:      document.getElementById("intel-sheet-source-bar"),
    intelSourceLink:     document.getElementById("intel-source-link"),
    btnTranslateIntel:   document.getElementById("btn-translate-intel"),
    intelSheetHandle:    document.getElementById("intel-sheet-handle"),
    hudUtc:              document.getElementById("hud-utc"),
    hudLocal:            document.getElementById("hud-local"),
    hudFps:              document.getElementById("hud-fps"),
    hudCamera:           document.getElementById("hud-camera"),
    hudStatusText:       document.getElementById("hud-status-text"),
    btnGuide:            document.getElementById("btn-guide"),
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
    missionGuide:        document.getElementById("mission-guide"),
    missionGuideKicker:  document.getElementById("mission-guide-kicker"),
    missionGuideTitle:   document.getElementById("mission-guide-title"),
    missionGuideProgress:document.getElementById("mission-guide-progress"),
    missionGuideBody:    document.getElementById("mission-guide-body"),
    missionGuideClose:   document.getElementById("mission-guide-close"),
    missionGuideSkip:    document.getElementById("mission-guide-skip"),
    missionGuidePrev:    document.getElementById("mission-guide-prev"),
    missionGuideNext:    document.getElementById("mission-guide-next"),
    liveNewsHeadline:    document.getElementById("live-news-headline"),
    newsBriefing:        document.getElementById("news-briefing"),
    newsCards:           document.getElementById("news-cards"),
    newsCatNav:          document.getElementById("news-cat-nav"),
    newsUpdated:         document.getElementById("news-updated"),
    newsRefreshBtn:      document.getElementById("news-refresh"),
    newsCloseBtn:        document.getElementById("news-close"),
    newsToggleBtn:       document.getElementById("btn-news-toggle"),
    newsBadge:           document.getElementById("news-badge"),
    threatSegments:      document.getElementById("threat-segments"),
    threatValue:         document.getElementById("threat-value"),
    throughputBars:      document.getElementById("throughput-bars"),
    throughputValue:     document.getElementById("throughput-value"),
    sigAdsb:             document.getElementById("sig-adsb"),
    sigNews:             document.getElementById("sig-news"),
    sigAis:              document.getElementById("sig-ais")
  });

  if (elements.fxIntensity)    elements.fxIntensity.value   = String(state.fxIntensity);
  if (elements.fxGlow)         elements.fxGlow.value        = String(state.fxGlow);
  if (elements.refreshInterval) elements.refreshInterval.value = String(state.refreshIntervalSec);
  if (elements.aisEndpoint)    elements.aisEndpoint.value   = getConfiguredAisEndpoint();
  syncMobileActionButtons();
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

function normalizeBookmarks(bookmarks) {
  const source = Array.isArray(bookmarks) && bookmarks.length ? bookmarks : DEFAULT_BOOKMARKS;
  return source.map(bookmark => ({
    ...bookmark,
    system: bookmark.system ?? SYSTEM_BOOKMARK_IDS.has(bookmark.id)
  }));
}

function createDefaultPanelState() {
  const defaults = {
    "panel-layers": { hidden: false, minimized: false },
    "panel-right": { hidden: false, minimized: true },
    "floating-summary": { hidden: false, minimized: true },
    "map-legend": { hidden: true, minimized: true }
  };
  return Object.fromEntries(PANEL_IDS.map(id => [id, defaults[id] ?? { hidden: false, minimized: false }]));
}

function loadPanelStateWithVersion() {
  const storedVersion = loadJson(UI_STORAGE_KEYS.panelStateVersion, 0);
  if (storedVersion < PANEL_STATE_VERSION) {
    // Version mismatch — reset to clean defaults and save new version
    const fresh = createDefaultPanelState();
    saveJson(UI_STORAGE_KEYS.panelState, fresh);
    saveJson(UI_STORAGE_KEYS.panelStateVersion, PANEL_STATE_VERSION);
    return fresh;
  }
  return loadJson(UI_STORAGE_KEYS.panelState, createDefaultPanelState());
}

function normalizePanelState(panelState) {
  return PANEL_IDS.reduce((accumulator, id) => {
    const current = panelState?.[id] ?? {};
    accumulator[id] = {
      hidden: !!current.hidden,
      minimized: !!current.minimized
    };
    return accumulator;
  }, {});
}

function savePanelState() {
  state.panelState = normalizePanelState(state.panelState);
  saveJson(UI_STORAGE_KEYS.panelState, state.panelState);
  saveJson(UI_STORAGE_KEYS.panelStateVersion, PANEL_STATE_VERSION);
}

function getPanelState(panelId) {
  const defaultState = createDefaultPanelState()[panelId] ?? { hidden: false, minimized: false };
  state.panelState[panelId] ??= { ...defaultState };
  return state.panelState[panelId];
}

function getManagedPanel(panelId) {
  return document.getElementById(panelId);
}

function setPanelHidden(panelId, hidden) {
  const panel = getManagedPanel(panelId);
  if (!panel) return;
  getPanelState(panelId).hidden = hidden;
  panel.classList.toggle("panel-hidden", hidden);
  savePanelState();
}

function setPanelMinimized(panelId, minimized) {
  const panel = getManagedPanel(panelId);
  if (!panel) return;
  getPanelState(panelId).minimized = minimized;
  panel.classList.toggle("panel-minimized", minimized);
  const button = panel.querySelector(`[data-minimize-panel="${panelId}"]`);
  if (button) button.textContent = minimized ? "+" : "—";
  savePanelState();
}

function applyStoredPanelState() {
  state.panelState = normalizePanelState(state.panelState);
  PANEL_IDS.forEach(panelId => {
    const panel = getManagedPanel(panelId);
    const current = getPanelState(panelId);
    if (!panel) return;
    panel.classList.toggle("panel-hidden", current.hidden);
    panel.classList.toggle("panel-minimized", current.minimized);
    const button = panel.querySelector(`[data-minimize-panel="${panelId}"]`);
    if (button) button.textContent = current.minimized ? "+" : "—";
  });
  sanitizePanelPositions();
  refreshPanelRestoreStrip();
}

function ensureMobilePanelVisibility() {
  if (window.innerWidth > 980) return;

  let changed = false;
  ["floating-summary", "map-legend"].forEach(panelId => {
    const panel = getManagedPanel(panelId);
    const current = getPanelState(panelId);
    if (!panel) return;
    if (current.hidden) {
      current.hidden = false;
      panel.classList.remove("panel-hidden");
      changed = true;
    }
    if (current.minimized) {
      current.minimized = false;
      panel.classList.remove("panel-minimized");
      const button = panel.querySelector(`[data-minimize-panel="${panelId}"]`);
      if (button) button.textContent = "—";
      changed = true;
    }
  });

  if (changed) savePanelState();
  refreshPanelRestoreStrip();
}

function sanitizePanelPositions() {
  if (window.innerWidth <= 980) return;
  const minTop = 118;
  document.querySelectorAll(".draggable-panel").forEach(panel => {
    if (!(panel instanceof HTMLElement)) return;
    if (panel.classList.contains("panel-hidden")) return;
    const rect = panel.getBoundingClientRect();
    if (rect.top >= minTop) return;
    panel.style.position = "fixed";
    panel.style.left = `${Math.max(12, rect.left)}px`;
    panel.style.top = `${minTop}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.transform = "none";
  });
}

function captureCameraDestination() {
  const cg = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
  return {
    lng: Cesium.Math.toDegrees(cg.longitude),
    lat: Cesium.Math.toDegrees(cg.latitude),
    height: cg.height,
    heading: viewer.camera.heading,
    pitch: viewer.camera.pitch,
    roll: viewer.camera.roll
  };
}

function flyToDestination(destination, complete, duration = 1.8) {
  // ── Surgical zoom: blur UI and zoom camera simultaneously ──
  document.body.classList.add("surgical-zoom");
  sfx.zoom();
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(destination.lng, destination.lat, destination.height),
    orientation: {
      heading: destination.heading,
      pitch: destination.pitch,
      roll: destination.roll
    },
    duration,
    easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
    complete() {
      document.body.classList.remove("surgical-zoom");
      document.body.classList.add("surgical-zoom-landing");
      setTimeout(() => document.body.classList.remove("surgical-zoom-landing"), 600);
      if (complete) complete();
    }
  });
}

function renderCameraPresets() {
  if (!elements.cameraPresets) return;
  elements.cameraPresets.innerHTML = CAMERA_PRESETS.map(preset => `
    <button type="button" class="camera-preset-btn" data-preset-id="${preset.id}">
      <span>${preset.label}</span>
      <small>${preset.kicker}</small>
    </button>
  `).join("");
  elements.cameraPresets.querySelectorAll(".camera-preset-btn").forEach(button => {
    button.addEventListener("click", () => {
      const preset = CAMERA_PRESETS.find(item => item.id === button.dataset.presetId);
      if (!preset) return;
      state.regionFocus = preset.regionFocus ?? null;
      flyToDestination(preset.destination, () => {
        if (preset.regionFocus) applyRegionalContext(preset.regionFocus, preset.destination.lng, preset.destination.lat);
      }, 2.1);
    });
  });
}

function captureLayoutSnapshot(name) {
  return {
    id: `layout-${Date.now()}`,
    name,
    savedAt: Date.now(),
    panelState: normalizePanelState(state.panelState),
    panelPositions: Object.fromEntries(PANEL_IDS.map(id => {
      const panel = getManagedPanel(id);
      return [id, panel ? {
        position: panel.style.position || "",
        left: panel.style.left || "",
        top: panel.style.top || "",
        right: panel.style.right || "",
        bottom: panel.style.bottom || "",
        transform: panel.style.transform || ""
      } : {}];
    })),
    camera: captureCameraDestination(),
    ui: {
      declutter: state.declutter,
      compact: state.compact,
      basemapId: state.basemapId,
      fxMode: state.fxMode
    }
  };
}

function saveCurrentLayout() {
  const layout = captureLayoutSnapshot(`Layout ${state.savedLayouts.length + 1}`);
  state.savedLayouts = [layout, ...state.savedLayouts].slice(0, 8);
  saveJson(UI_STORAGE_KEYS.layouts, state.savedLayouts);
  renderSavedLayouts();
}

function applyLayout(layoutId) {
  const layout = state.savedLayouts.find(item => item.id === layoutId);
  if (!layout) return;
  state.panelState = normalizePanelState(layout.panelState);
  PANEL_IDS.forEach(id => {
    const panel = getManagedPanel(id);
    const pos = layout.panelPositions?.[id];
    if (!panel || !pos) return;
    panel.style.position = pos.position || "";
    panel.style.left = pos.left || "";
    panel.style.top = pos.top || "";
    panel.style.right = pos.right || "";
    panel.style.bottom = pos.bottom || "";
    panel.style.transform = pos.transform || "";
  });
  applyStoredPanelState();
  state.declutter = !!layout.ui?.declutter;
  state.compact = !!layout.ui?.compact;
  applyDeclutterMode();
  applyDensityMode();
  if (layout.ui?.basemapId) installBasemap(layout.ui.basemapId);
  if (layout.ui?.fxMode) {
    state.fxMode = layout.ui.fxMode;
    applyFxMode(state.fxMode);
    renderFxButtons();
  }
  if (layout.camera) flyToDestination(layout.camera, undefined, 2.2);
}

function removeLayout(layoutId) {
  state.savedLayouts = state.savedLayouts.filter(item => item.id !== layoutId);
  saveJson(UI_STORAGE_KEYS.layouts, state.savedLayouts);
  renderSavedLayouts();
}

function renderSavedLayouts() {
  if (!elements.layoutList) return;
  if (!state.savedLayouts.length) {
    elements.layoutList.innerHTML = `<div class="layout-empty">No saved layouts yet.</div>`;
    return;
  }
  elements.layoutList.innerHTML = state.savedLayouts.map(layout => `
    <div class="layout-item">
      <button type="button" class="layout-launch" data-layout-id="${layout.id}">
        <span>${layout.name}</span>
        <small>${new Date(layout.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
      </button>
      <button type="button" class="layout-remove" data-layout-remove="${layout.id}">✕</button>
    </div>
  `).join("");
  elements.layoutList.querySelectorAll(".layout-launch").forEach(button => {
    button.addEventListener("click", () => applyLayout(button.dataset.layoutId));
  });
  elements.layoutList.querySelectorAll(".layout-remove").forEach(button => {
    button.addEventListener("click", () => removeLayout(button.dataset.layoutRemove));
  });
}

function renderMissionGuide() {
  if (!elements.missionGuideBody || !elements.missionGuideProgress) return;
  const step = MISSION_GUIDE_STEPS[state.onboardingStep] ?? MISSION_GUIDE_STEPS[0];
  if (elements.missionGuideKicker) elements.missionGuideKicker.textContent = step.kicker;
  if (elements.missionGuideTitle) elements.missionGuideTitle.textContent = step.title;

  elements.missionGuideProgress.innerHTML = MISSION_GUIDE_STEPS.map((item, index) => `
    <button type="button" class="mission-guide-dot${index === state.onboardingStep ? " active" : ""}" data-guide-step="${index}" aria-label="Go to step ${index + 1}: ${escapeHtml(item.title)}"></button>
  `).join("");

  elements.missionGuideBody.innerHTML = `
    <p class="mission-guide-lead">${step.lead}</p>
    <div class="mission-guide-sections">
      ${step.sections.map(section => `
        <section class="mission-guide-section">
          <h3>${section.title}</h3>
          <ul>
            ${section.items.map(item => `<li>${item}</li>`).join("")}
          </ul>
        </section>
      `).join("")}
    </div>
    <div class="mission-guide-actions">
      ${step.actions.map(action => `<button type="button" class="panel-btn mission-guide-action" data-guide-action="${action.id}">${action.label}</button>`).join("")}
    </div>
  `;

  elements.missionGuideBody.querySelectorAll("[data-guide-action]").forEach(button => {
    button.addEventListener("click", () => executeMissionGuideAction(button.dataset.guideAction));
  });
  elements.missionGuideProgress.querySelectorAll("[data-guide-step]").forEach(button => {
    button.addEventListener("click", () => {
      state.onboardingStep = Number(button.dataset.guideStep) || 0;
      renderMissionGuide();
    });
  });

  if (elements.missionGuidePrev) elements.missionGuidePrev.disabled = state.onboardingStep === 0;
  if (elements.missionGuideNext) {
    elements.missionGuideNext.textContent = state.onboardingStep === MISSION_GUIDE_STEPS.length - 1 ? "Finish" : "Next";
  }
}

function openMissionGuide(step = 0) {
  if (!elements.missionGuide) return;
  if (window.innerWidth <= 980) setMobileDrawer(null);
  state.onboardingStep = clamp(step, 0, MISSION_GUIDE_STEPS.length - 1);
  renderMissionGuide();
  elements.missionGuide.classList.remove("hidden");
  elements.missionGuide.setAttribute("aria-hidden", "false");
  document.body.classList.add("mission-guide-open");
}

function closeMissionGuide(markSeen = true) {
  if (!elements.missionGuide) return;
  elements.missionGuide.classList.add("hidden");
  elements.missionGuide.setAttribute("aria-hidden", "true");
  document.body.classList.remove("mission-guide-open");
  if (markSeen) {
    state.onboardingSeen = true;
    saveJson(UI_STORAGE_KEYS.onboardingSeen, true);
  }
  updateSummaryHint();
}

function updateSummaryHint() {
  if (!elements.summaryHint) return;
  if (!state.onboardingSeen) {
    elements.summaryHint.textContent = "Start with Search or Hotspot. Guide stays available if you want a walkthrough.";
    return;
  }
  if (window.innerWidth <= 980) {
    elements.summaryHint.textContent = "Use Layers, Control, and Intel at the bottom to move through the map quickly.";
    return;
  }
  elements.summaryHint.textContent = "Search, jump to a hotspot, or click the globe to inspect a region.";
}

function stepMissionGuide(direction) {
  const nextStep = state.onboardingStep + direction;
  if (nextStep >= MISSION_GUIDE_STEPS.length) {
    closeMissionGuide(true);
    return;
  }
  state.onboardingStep = clamp(nextStep, 0, MISSION_GUIDE_STEPS.length - 1);
  renderMissionGuide();
}

function executeMissionGuideAction(actionId) {
  if (!actionId) return;
  switch (actionId) {
    case "hotspot":
      focusNextHotspot();
      break;
    case "brief":
      createFocusBrief();
      break;
    case "search-gulf":
      if (elements.searchInput) elements.searchInput.value = "Gulf";
      runSearch("Gulf");
      break;
    case "random-track":
      focusRandomTrack();
      break;
    case "intel":
      if (state.selectedEntity) openIntelSheet(state.selectedEntity);
      else setOpsBrief("Nothing Selected", "Pick a track or jump to a hotspot first, then open intel from there.", "Select something first");
      break;
    case "save-layout":
      saveCurrentLayout();
      break;
    case "tour":
      if (!state.opsTourTimer) toggleAlertTour();
      break;
    case "open-news":
      openNewsPanel();
      break;
    case "save-view":
      saveCurrentBookmark();
      break;
    case "home":
      flyToDestination({
        lng: SCENARIO.initialView.lng,
        lat: SCENARIO.initialView.lat,
        height: SCENARIO.initialView.height,
        heading: SCENARIO.initialView.heading,
        pitch: SCENARIO.initialView.pitch,
        roll: SCENARIO.initialView.roll
      }, undefined, 1.8);
      break;
    default:
      return;
  }
  closeMissionGuide(false);
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
      <strong class="metric-value counting-value">${m.value}</strong>
      <span class="metric-foot">${m.foot}</span>
      <div class="metric-sparkline" data-sparkline="${m.key}"></div>
    </article>
  `).join("");
}

function updateMetricCard(key, value, foot) {
  const card = elements.metricCluster.querySelector(`[data-metric="${key}"]`);
  if (!card) return;
  const v = card.querySelector(".metric-value");
  const f = card.querySelector(".metric-foot");
  if (v) {
    const oldVal = parseInt(v.textContent, 10);
    const newVal = parseInt(value, 10);
    if (!isNaN(oldVal) && !isNaN(newVal) && oldVal !== newVal) {
      animateCountTo(v, oldVal, newVal, 600);
    } else {
      v.textContent = String(value);
    }
  }
  if (f) f.textContent = foot;
  updateSparkline(key, typeof value === "number" ? value : parseInt(value, 10) || 0);
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
    // Count entities in this layer
    let count = 0;
    try {
      const entities = viewer?.entities?.values;
      if (entities) {
        for (const e of entities) {
          if (e.properties?.layerId?.getValue?.() === layer.id) count++;
        }
      }
    } catch { /* */ }
    const badge = count > 0 ? `<span class="layer-count">${count}</span>` : "";
    row.innerHTML = `
      <span class="layer-copy">
        <span class="layer-name">${layer.label}${badge}</span>
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
    const removable = !bookmark.system;
    row.innerHTML = `
      <button type="button" class="bookmark-launch">
        <span>${bookmark.label}</span>
        <small>${bookmark.system ? "SYSTEM PRESET" : "SAVED VIEW"}</small>
      </button>
      ${removable ? `<button type="button" data-remove="${bookmark.id}">✕</button>` : `<span class="bookmark-badge">SYS</span>`}
    `;
    row.firstElementChild.addEventListener("click", () => flyToBookmark(bookmark));
    if (removable) row.lastElementChild.addEventListener("click", () => removeBookmark(bookmark.id));
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
      btn.addEventListener("click", () => focusAlert(alert));
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

function setOpsBrief(title, copy, meta = "Quick actions") {
  if (elements.opsBriefTitle) elements.opsBriefTitle.textContent = title;
  if (elements.opsBriefCopy) elements.opsBriefCopy.textContent = copy;
  if (elements.opsBriefMeta) elements.opsBriefMeta.textContent = meta;
  if (elements.opsBrief) {
    elements.opsBrief.classList.remove("is-updating");
    void elements.opsBrief.offsetWidth;
    elements.opsBrief.classList.add("is-updating");
  }
}

function updateOperationsControls() {
  if (elements.opsOpenIntel) elements.opsOpenIntel.disabled = !state.selectedEntity;
  if (elements.opsTourToggle) {
    const active = !!state.opsTourTimer;
    elements.opsTourToggle.classList.toggle("active", active);
    elements.opsTourToggle.textContent = active ? "Stop Tour" : "Tour Alerts";
  }
}

function focusAlert(alert) {
  if (!alert) return;
  pausePassiveSpin(7000);
  const activeNarrative = getActiveAlertNarrative(alert);
  const activeTitle = activeNarrative.title ?? alert.title;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(alert.location.lng, alert.location.lat, 2600000),
    duration: 1.8,
    complete: () => applyRegionalContext(activeTitle, alert.location.lng, alert.location.lat)
  });
  setOpsBrief(
    activeTitle,
    activeNarrative.summary ?? alert.summary,
    `${alert.region} · ${activeNarrative.publishedAt ?? "Live rolling brief"}`
  );
}

function focusNextHotspot() {
  // Combine scenario alerts with live geo events for richer cycling
  const geoEvents = dynamic.eventVisuals.filter(v => v.geoSpawned && v.lng != null);
  const combinedCount = SCENARIO.alerts.length + geoEvents.length;
  if (!combinedCount) return;

  const idx = state.opsHotspotIndex % combinedCount;
  state.opsHotspotIndex = (state.opsHotspotIndex + 1) % combinedCount;

  if (idx < SCENARIO.alerts.length) {
    focusAlert(SCENARIO.alerts[idx]);
  } else {
    const ev = geoEvents[idx - SCENARIO.alerts.length];
    if (ev) {
      pausePassiveSpin(7000);
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(ev.lng, ev.lat, 1200000),
        duration: 1.5
      });
    }
  }
}

function focusRandomTrack() {
  const candidates = [...dynamic.liveTraffic, ...dynamic.traffic].filter(entity => entity?.show !== false && entity?.position);
  if (!candidates.length) {
    setOpsBrief("No Tracks Right Now", "There are not any active tracks to inspect at the moment.", "Waiting for refresh");
    return;
  }
  const entity = candidates[Math.floor(Math.random() * candidates.length)];
  const info = getEntityInfo(entity);
  const coords = getEntityLngLat(entity);
  if (!info || !coords) return;
  pausePassiveSpin(7000);
  state.selectedEntity = entity;
  updateSelectedEntityCard(entity);
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(coords.lng, coords.lat, info.type.startsWith("live-") ? 1600000 : 2000000),
    duration: 1.6,
    complete: () => applyRegionalContext(info.label, coords.lng, coords.lat)
  });
  setOpsBrief(info.label, info.description || "A track from the current scene.", `${info.type.toUpperCase()} · ${info.locationMeta}`);
}

function createFocusBrief() {
  const now = new Date().toUTCString().slice(17, 25);
  if (state.selectedEntity) {
    const info = getEntityInfo(state.selectedEntity);
    if (info) {
      setOpsBrief(
        `${info.label} Brief`,
        `${info.type.toUpperCase()} at ${info.locationMeta}. ${info.description || "Still visible in the current scene."}`,
        `ALT ${Math.round(info.altitude).toLocaleString()} m · ${now} UTC`
      );
      return;
    }
  }
  if (state.regionFocus) {
    setOpsBrief(
      `${state.regionFocus.label} Brief`,
      state.regionFocus.summary,
      `${state.regionFocus.tracks} tracks · ${state.regionFocus.alerts} alerts · ${now} UTC`
    );
    return;
  }
  const liveCount = [state.liveFeeds.adsb, state.liveFeeds.ais].filter(feed => feed.status === "live").length;
  setOpsBrief(
    "Global Brief",
    `The scene currently shows ${dynamic.traffic.length + dynamic.liveTraffic.length} tracked assets and ${SCENARIO.alerts.length + SCENARIO.incidents.length} alerts or incidents in the scenario layer.`,
    `${liveCount} live feeds online · ${now} UTC`
  );
}

function toggleAlertTour() {
  if (state.opsTourTimer) {
    window.clearInterval(state.opsTourTimer);
    state.opsTourTimer = null;
    updateOperationsControls();
    setOpsBrief("Tour Paused", "You can keep exploring manually, or step through hotspots one at a time.", "Tour off");
    return;
  }
  focusNextHotspot();
  state.opsTourTimer = window.setInterval(() => {
    focusNextHotspot();
  }, 9000);
  updateOperationsControls();
  setOpsBrief("Tour Running", "Cycling through hotspots every 9 seconds.", "Tour on");
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

function resolveEventRegionKey(lng, lat) {
  if (lng >= 43 && lng <= 62 && lat >= 22 && lat <= 38) return "gulf";
  if (lng >= 125 && lng <= 170 && lat >= 15 && lat <= 45) return "pacific";
  if (lng >= 44 && lng <= 58 && lat >= 30 && lat <= 40) return "theater";
  if (lng >= -10 && lng <= 35 && lat >= 35 && lat <= 60) return "europe";
  return null;
}

function resolveEventVisualStyle(kind, lng, lat) {
  const base = EVENT_VISUAL_STYLES[kind] ?? EVENT_VISUAL_STYLES.alert;
  const regionKey = resolveEventRegionKey(lng, lat);
  const override = regionKey ? EVENT_REGION_OVERRIDES[regionKey] : null;
  if (!override) return base;
  return {
    ...base,
    ...override
  };
}

function pickEventSource() {
  // Fallback pool from scenario data (used when no live geo articles available)
  const weighted = [
    ...SCENARIO.alerts.map(item => ({ kind: "alert", source: item, weight: 2 })),
    ...SCENARIO.incidents.map(item => ({ kind: "incident", source: item, weight: 3 }))
  ];
  if (!weighted.length) return null;

  const pool = [];
  weighted.forEach(item => {
    for (let i = 0; i < item.weight; i += 1) pool.push(item);
  });

  if (state.regionFocus?.label) {
    const camCarto = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
    const camLat = Cesium.Math.toDegrees(camCarto.latitude);
    const camLng = Cesium.Math.toDegrees(camCarto.longitude);
    const focused = pool.filter(item => {
      const loc = item.source.location;
      if (!loc) return false;
      return haversineKm(loc.lat, loc.lng, camLat, camLng) <= 2200;
    });
    if (focused.length) return focused[Math.floor(Math.random() * focused.length)];
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

// Track recently-used article URLs to maximize geographic diversity
const _recentGeoArticles = new Set();
const _RECENT_GEO_MAX = 16;

/**
 * Pick a geolocatable news article from the live ticker pool.
 * Uses title-based city extraction + country fallback (no external GEO API).
 * Returns { article, geo: {lat, lng, name} } or null.
 */
function pickGeoArticle() {
  const pool = state.newsTickerPool;
  if (!pool.length) return null;

  // Build list of geolocatable articles
  const geoPool = [];
  for (const article of pool) {
    const geo = resolveArticleGeo(article);
    if (geo) geoPool.push({ article, geo });
  }
  if (!geoPool.length) return null;

  // Prefer articles we haven't used recently for diversity
  const fresh = geoPool.filter(item => !_recentGeoArticles.has(item.article.url));
  const selection = fresh.length ? fresh : geoPool;
  const pick = selection[Math.floor(Math.random() * selection.length)];

  // Track usage
  _recentGeoArticles.add(pick.article.url);
  if (_recentGeoArticles.size > _RECENT_GEO_MAX) {
    const first = _recentGeoArticles.values().next().value;
    _recentGeoArticles.delete(first);
  }

  return pick;
}

function pruneEventVisuals(forceTrim = false) {
  const now = Date.now();
  const maxVisuals = 12;
  for (let i = dynamic.eventVisuals.length - 1; i >= 0; i -= 1) {
    const item = dynamic.eventVisuals[i];
    const expired = forceTrim || now - item.bornAt > item.ttlMs;
    if (!expired) continue;
    viewer.entities.remove(item.dot);
    viewer.entities.remove(item.cone);
    viewer.entities.remove(item.trail);
    dynamic.eventVisuals.splice(i, 1);
  }

  while (dynamic.eventVisuals.length > maxVisuals) {
    const oldest = dynamic.eventVisuals.shift();
    if (!oldest) break;
    viewer.entities.remove(oldest.dot);
    viewer.entities.remove(oldest.cone);
    viewer.entities.remove(oldest.trail);
  }
  updateEventCount();
  rebuildConnectionLines();
}

// ── CONNECTION LINES between nearby events ──────────────────────────────────
// Links events within ~40° of each other with faint geodesic arcs.
function rebuildConnectionLines() {
  // Remove old lines
  for (const line of dynamic.connectionLines) {
    viewer.entities.remove(line);
  }
  dynamic.connectionLines.length = 0;

  const events = dynamic.eventVisuals.filter(v => v.lng != null && v.lat != null);
  if (events.length < 2) return;

  const MAX_DEG_DIST = 40;
  const MAX_LINES = 8;
  const pairs = [];

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i], b = events[j];
      const dlat = a.lat - b.lat;
      const dlng = a.lng - b.lng;
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);
      if (dist < MAX_DEG_DIST) {
        pairs.push({ a, b, dist });
      }
    }
  }

  // Sort by distance, take closest pairs
  pairs.sort((x, y) => x.dist - y.dist);
  const selected = pairs.slice(0, MAX_LINES);

  for (const { a, b } of selected) {
    const midAlt = 6000 + Math.random() * 4000;
    const line = viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([
          a.lng, a.lat, 1200,
          (a.lng + b.lng) / 2, (a.lat + b.lat) / 2, midAlt,
          b.lng, b.lat, 1200
        ]),
        width: 1.5,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString("#8b5cf6").withAlpha(0.4),
          gapColor: Cesium.Color.TRANSPARENT,
          dashLength: 16
        }),
        arcType: Cesium.ArcType.GEODESIC
      },
      properties: {
        layerId: "incidents",
        entityType: "connection-line",
        label: "Intel link",
        description: "Event correlation link"
      }
    });
    dynamic.connectionLines.push(line);
  }

  // Update link count badge
  const linkEl = document.getElementById("hud-link-count");
  if (linkEl) linkEl.textContent = `⟁ ${dynamic.connectionLines.length}`;
}

function updateEventCount() {
  const el = document.getElementById("hud-event-count");
  if (!el) return;
  const n = dynamic.eventVisuals.length;
  const prev = parseInt(el.dataset.count) || 0;
  el.dataset.count = n;
  // Animated counting effect
  if (n !== prev && prev > 0) {
    animateCounter(el, prev, n, 600);
  } else {
    el.textContent = n > 0 ? `${n} events` : "— events";
  }
  el.classList.toggle("has-events", n > 0);
  // Pop animation when count increases
  if (n > prev) {
    el.classList.remove("count-bump");
    void el.offsetWidth; // reflow
    el.classList.add("count-bump");
  }
  // Classification bar glow when events active
  const cbar = document.getElementById("classification-bar");
  if (cbar) cbar.classList.toggle("events-active", n > 0);
  // Update page title with event count for background tab awareness
  document.title = n > 0
    ? `(${n}) God's Eye — Live Global Surveillance Dashboard`
    : "God's Eye — Live Global Surveillance Dashboard";
  // Flash title if tab is hidden
  if (document.hidden && n > 0 && !_titleFlashInterval) {
    let alt = false;
    _titleFlashInterval = setInterval(() => {
      alt = !alt;
      document.title = alt
        ? `⚡ NEW EVENT — God's Eye`
        : `(${dynamic.eventVisuals.length}) God's Eye — Live Global Surveillance Dashboard`;
    }, 1500);
  }
}

function animateCounter(el, from, to, duration) {
  const start = performance.now();
  const diff = to - from;
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOut
    const current = Math.round(from + diff * ease);
    el.textContent = `${current} events`;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

let _titleFlashInterval = null;
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && _titleFlashInterval) {
    clearInterval(_titleFlashInterval);
    _titleFlashInterval = null;
    updateEventCount();
  }
  // Throttle rendering when tab is hidden to save GPU/CPU
  if (viewer && viewer.scene) {
    viewer.scene.requestRenderMode = document.hidden;
    if (!document.hidden) viewer.scene.requestRender();
  }
});

// ── SPAWN FLASH — expanding ring when new event appears ─────────────────────
function flashEventSpawn(lng, lat) {
  const ring = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lng, lat, 800),
    ellipse: {
      semiMinorAxis: 10000,
      semiMajorAxis: 10000,
      height: 800,
      material: Cesium.Color.fromCssColorString("#00f0ff").withAlpha(0.5),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString("#00f0ff").withAlpha(0.8),
      outlineWidth: 2
    },
    properties: { layerId: "incidents", entityType: "spawn-flash" }
  });

  let step = 0;
  const maxSteps = 20;
  const interval = setInterval(() => {
    step++;
    const t = step / maxSteps;
    const radius = 10000 + t * 120000;
    const alpha = 0.5 * (1 - t);
    ring.ellipse.semiMinorAxis = radius;
    ring.ellipse.semiMajorAxis = radius;
    ring.ellipse.material = Cesium.Color.fromCssColorString("#00f0ff").withAlpha(alpha);
    ring.ellipse.outlineColor = Cesium.Color.fromCssColorString("#00f0ff").withAlpha(alpha * 1.5);
    if (step >= maxSteps) {
      clearInterval(interval);
      viewer.entities.remove(ring);
    }
  }, 80);

  // Second ring — delayed, pink, for double-shockwave effect
  setTimeout(() => {
    const ring2 = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat, 800),
      ellipse: {
        semiMinorAxis: 10000,
        semiMajorAxis: 10000,
        height: 800,
        material: Cesium.Color.TRANSPARENT,
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#ff4d6d").withAlpha(0.6),
        outlineWidth: 1.5
      },
      properties: { layerId: "incidents", entityType: "spawn-flash" }
    });
    let s2 = 0;
    const i2 = setInterval(() => {
      s2++;
      const t = s2 / maxSteps;
      const radius = 10000 + t * 80000;
      const alpha = 0.6 * (1 - t);
      ring2.ellipse.semiMinorAxis = radius;
      ring2.ellipse.semiMajorAxis = radius;
      ring2.ellipse.outlineColor = Cesium.Color.fromCssColorString("#ff4d6d").withAlpha(alpha);
      if (s2 >= maxSteps) {
        clearInterval(i2);
        viewer.entities.remove(ring2);
      }
    }, 80);
  }, 200);

  // Radar blip
  spawnRadarBlip();
}

function pickNewsLabel() {
  const pool = state.newsTickerPool;
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Refresh the label/description on existing event visuals so hover tooltips
// and the selected-entity card always reflect current news headlines.
function refreshEventVisualLabels() {
  if (!dynamic.eventVisuals.length) return;
  for (const item of dynamic.eventVisuals) {
    // Geo-spawned visuals keep their original article-specific label
    if (item.geoSpawned) continue;
    const newsItem = pickNewsLabel();
    if (!newsItem) continue;
    const headline = newsItem.title.slice(0, 80);
    const aUrl = newsItem.url || "";
    const aLang = newsItem.language || "";
    const aDomain = newsItem.domain || "";
    for (const ent of [item.dot, item.cone, item.trail]) {
      ent.properties.articleUrl    = aUrl;
      ent.properties.articleLang   = aLang;
      ent.properties.articleDomain = aDomain;
    }
    item.dot.properties.label       = `${headline} marker`;
    item.dot.properties.description = `${newsItem.domain} — ${newsItem.title}`;
    item.cone.properties.label       = `${headline} cone`;
    item.cone.properties.description = `${newsItem.domain} — projection`;
    item.trail.properties.label       = `${headline} trail`;
    item.trail.properties.description = `${newsItem.domain} — trajectory`;
  }
  // Keep sidebar card fresh if the user has an event visual selected
  const selectedType = state.selectedEntity?.properties?.entityType
    ?.getValue?.(viewer.clock.currentTime);
  if (selectedType === "event-visual" || selectedType === "event-cone" || selectedType === "event-trail") {
    updateSelectedEntityCard(state.selectedEntity);
  }
}

function spawnEventVisualBurst() {
  if (!state.layers.incidents) return;

  // ── PRIMARY: Try to spawn from a geolocated live news article ──────────
  const geoPick = pickGeoArticle();
  if (geoPick) {
    const { article, geo } = geoPick;
    const lng = geo.lng;
    const lat = geo.lat;
    const kind = "alert"; // live news events are alerts by default
    const style = resolveEventVisualStyle(kind, lng, lat);
    const bearing = (performance.now() / 40 + Math.random() * 360) % 360;
    const target = destinationPoint(lat, lng, style.trailDistance, bearing);

    const eventLabel = article.title.slice(0, 80);
    const articleUrl = article.url || "";
    const articleLang = article.language || "";
    const articleDomain = article.domain || "";
    const geoName = geo.name || article.country || null;
    const countryNote = geoName ? ` [${geoName}]` : article.country ? ` [${article.country}]` : "";
    // Pin label: show place name when we have real coords, else truncated title
    const pinLabel = geoName || (article.country ? article.country.toUpperCase() : eventLabel.slice(0, 28));

    const dot = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat, 1200),
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString(style.dot).withAlpha(0.95),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.85),
        outlineWidth: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: pinLabel,
        font: '11px "Share Tech Mono", monospace',
        fillColor: Cesium.Color.fromCssColorString(style.dot).withAlpha(0.95),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(5,12,23,0.72)"),
        backgroundPadding: new Cesium.Cartesian2(5, 3),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(8, -8),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 8e6, 0.4),
        translucencyByDistance: new Cesium.NearFarScalar(1e6, 1.0, 1.2e7, 0.0)
      },
      properties: {
        layerId: "incidents",
        entityType: "event-visual",
        label: eventLabel,
        description: `${articleDomain}${countryNote} — ${article.title}`,
        articleUrl,
        articleLang,
        articleDomain
      }
    });

    const coneLen = style.coneLength;
    const cone = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat, coneLen / 2),
      cylinder: {
        length: coneLen,
        topRadius: 0,
        bottomRadius: style.coneRadius,
        material: Cesium.Color.fromCssColorString(style.cone).withAlpha(0.14),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString(style.cone).withAlpha(0.35)
      },
      properties: {
        layerId: "incidents",
        entityType: "event-cone",
        label: `${eventLabel} — projection`,
        description: `${articleDomain}${countryNote} — projection cone`,
        articleUrl,
        articleLang,
        articleDomain
      }
    });

    const trail = viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([
          lng, lat, 1000,
          target.lng, target.lat, 22000
        ]),
        width: 2.2,
        material: Cesium.Color.fromCssColorString(style.trail).withAlpha(0.72),
        arcType: Cesium.ArcType.GEODESIC
      },
      properties: {
        layerId: "incidents",
        entityType: "event-trail",
        label: `${eventLabel} — trajectory`,
        description: `${articleDomain}${countryNote} — trajectory`,
        articleUrl,
        articleLang,
        articleDomain
      }
    });

    dynamic.eventVisuals.push({
      bornAt: Date.now(),
      ttlMs: style.ttlMs + Math.floor(Math.random() * 30000),
      geoSpawned: true,
      lng, lat,
      dot, cone, trail
    });

    pruneEventVisuals();
    updateEventCount();
    flashEventSpawn(lng, lat);
    updateEventHistoryTrail(lng, lat);
    rebuildConnectionLines();
    // Show translated toast for non-English articles
    if (articleLang && isNonEnglish(articleLang)) {
      const cacheKey = `${articleLang}::${article.title}`;
      const cached = _translationCache.get(cacheKey);
      if (cached && cached !== article.title) {
        showEventToast(cached, article.country);
      } else {
        showEventToast(article.title, article.country);
        translateTitle(article.title, articleLang).then(translated => {
          // Toast already shown with original — next time it'll be cached
        });
      }
    } else {
      showEventToast(article.title, article.country);
    }
    updateSessionStats(article.country);
    // Haptic buzz on mobile when a geo event spawns
    if (navigator.vibrate) navigator.vibrate(40);
    // Auto-fly to the first geo event so the user immediately sees live data
    if (state.sessionStats.eventsSpawned === 1 && viewer) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, 4500000),
        duration: 2.2,
        easingFunction: Cesium.EasingFunction.QUARTIC_OUT
      });
    }
    return;
  }

  // ── FALLBACK: Use scenario locations when no geolocatable articles ─────
  const picked = pickEventSource();
  if (!picked?.source?.location) return;

  const { kind, source } = picked;
  const { lng: baseLng, lat: baseLat } = source.location;

  // Apply positional jitter so visuals don't pile on the exact same coordinate
  const lng = baseLng + (Math.random() - 0.5) * 3.2;
  const lat = baseLat + (Math.random() - 0.5) * 2.4;

  const style = resolveEventVisualStyle(kind, baseLng, baseLat);
  const bearing = (performance.now() / 40 + Math.random() * 360) % 360;
  const target = destinationPoint(lat, lng, style.trailDistance, bearing);

  // Pull a live news headline for the label when available
  const newsItem = pickNewsLabel();
  const eventLabel = newsItem
    ? newsItem.title.slice(0, 80)
    : (source.title || source.label || "Event");
  const articleUrl = newsItem?.url || "";
  const articleLang = newsItem?.language || "";

  const dot = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lng, lat, 1200),
    point: {
      pixelSize: kind === "incident" ? 12 : 9,
      color: Cesium.Color.fromCssColorString(style.dot).withAlpha(0.95),
      outlineColor: Cesium.Color.WHITE.withAlpha(0.85),
      outlineWidth: 1.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    properties: {
      layerId: "incidents",
      entityType: "event-visual",
      label: `${eventLabel} marker`,
      description: newsItem ? `${newsItem.domain} — ${newsItem.title}` : "Ephemeral conflict marker",
      articleUrl,
      articleLang,
      articleDomain: newsItem?.domain || ""
    }
  });

  const coneLen = style.coneLength;
  const cone = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lng, lat, coneLen / 2),
    cylinder: {
      length: coneLen,
      topRadius: 0,
      bottomRadius: style.coneRadius,
      material: Cesium.Color.fromCssColorString(style.cone).withAlpha(0.14),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString(style.cone).withAlpha(0.35)
    },
    properties: {
      layerId: "incidents",
      entityType: "event-cone",
      label: `${eventLabel} cone`,
      description: newsItem ? `${newsItem.domain} — projection` : "Ephemeral event projection cone",
      articleUrl,
      articleLang,
      articleDomain: newsItem?.domain || ""
    }
  });

  const trail = viewer.entities.add({
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArrayHeights([
        lng, lat, 1000,
        target.lng, target.lat, 22000
      ]),
      width: kind === "incident" ? 2.6 : 2.1,
      material: Cesium.Color.fromCssColorString(style.trail).withAlpha(0.72),
      arcType: Cesium.ArcType.GEODESIC
    },
    properties: {
      layerId: "incidents",
      entityType: "event-trail",
      label: `${eventLabel} trail`,
      description: newsItem ? `${newsItem.domain} — trajectory` : "Ephemeral event trajectory",
      articleUrl,
      articleLang,
      articleDomain: newsItem?.domain || ""
    }
  });

  dynamic.eventVisuals.push({
    bornAt: Date.now(),
    ttlMs: style.ttlMs + Math.floor(Math.random() * 30000),
    lng, lat,
    dot, cone, trail
  });

  pruneEventVisuals();
  updateEventCount();
  flashEventSpawn(lng, lat);
  updateEventHistoryTrail(lng, lat);
  rebuildConnectionLines();
}

function startEventVisualLifecycle() {
  if (eventVisualSpawnTimer) window.clearInterval(eventVisualSpawnTimer);
  if (eventVisualPruneTimer) window.clearInterval(eventVisualPruneTimer);
  if (eventVisualLabelTimer) window.clearInterval(eventVisualLabelTimer);

  // Delay first spawn so the globe opens clean before anything appears
  window.setTimeout(() => {
    spawnEventVisualBurst();
    eventVisualSpawnTimer = window.setInterval(() => {
      spawnEventVisualBurst();
    }, 8000);
  }, 3000);

  eventVisualPruneTimer = window.setInterval(() => {
    pruneEventVisuals();
  }, 12000);

  // Refresh descriptions/labels on living visuals every 30 s so
  // the hover tooltip and entity card always show current headlines.
  eventVisualLabelTimer = window.setInterval(() => {
    refreshEventVisualLabels();
  }, 30000);
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
  dynamic.eventVisuals.forEach(({ dot, cone, trail }) => {
    dot.show = !!state.layers.incidents;
    cone.show = !!state.layers.incidents;
    trail.show = !!state.layers.incidents;
  });
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
  if (elements.liveRegionLabel) elements.liveRegionLabel.textContent = "Global Intelligence Active";
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
  const stats = getSessionSummary();
  const statsHtml = `<span class="summary-tag session-stat">⏱ <span class="session-stat-value">${stats.duration}</span></span>` +
    `<span class="summary-tag session-stat">⚡ <span class="session-stat-value">${stats.eventsSpawned}</span> events</span>` +
    `<span class="summary-tag session-stat">🌍 <span class="session-stat-value">${stats.countriesSeen}</span> countries</span>`;
  elements.summaryTags.innerHTML = active.slice(0, 4).map(t => `<span class="summary-tag">${t}</span>`).join("") + statsHtml;
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
  sfx.ping();
  if (window.innerWidth <= 980) {
    setMobileDrawer(null);
    // Show backdrop for intel sheet on mobile
    if (elements.mobileBackdrop) elements.mobileBackdrop.classList.remove("hidden");
  }

  const isEvent = info.type === "event-visual" || info.type === "event-cone" || info.type === "event-trail";
  const incident = info.type === "incident" ? findScenarioIncidentById(info.entityId) : null;
  const incidentNarrative = incident ? getActiveIncidentNarrative(incident) : null;
  const effectiveDescription = incidentNarrative?.description ?? info.description;

  // Build source link for events and incidents
  const articleUrl = info.articleUrl || incidentNarrative?.sourceUrl || "";
  const articleDomain = info.articleDomain || incidentNarrative?.sourceLabel || "";
  const intelSourceLine = articleUrl
    ? `<div><a class="intel-source-link" href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(articleDomain || "Source article")} ↗</a></div>`
    : articleDomain
      ? `<div>${escapeHtml(articleDomain)}</div>`
      : "";

  state.intelSheetOpen = true;
  state._intelSheetInfo = info; // Save for translate
  document.body.classList.add("intel-sheet-open");
  elements.intelSheet.classList.remove("hidden");
  elements.intelSheet.classList.add("classified");
  elements.intelSheet.setAttribute("aria-hidden", "false");

  // Source article bar
  if (elements.intelSourceBar && elements.intelSourceLink) {
    if (articleUrl) {
      elements.intelSourceLink.href = articleUrl;
      elements.intelSourceLink.textContent = `${articleDomain || "View article"} ↗`;
      elements.intelSourceBar.classList.remove("hidden");
    } else {
      elements.intelSourceBar.classList.add("hidden");
    }
  }

  // Translate button visibility
  if (elements.btnTranslateIntel) {
    const showTranslate = info.articleLang && isNonEnglish(info.articleLang);
    elements.btnTranslateIntel.classList.toggle("hidden", !showTranslate);
  }

  const typeLabel = isEvent ? "LIVE EVENT" : info.type.toUpperCase();
  elements.intelSheetKicker.textContent = `${typeLabel} — LIVE TRACK`;
  elements.intelSheetTitle.textContent = info.label;
  elements.intelSheetOverview.textContent = effectiveDescription || "Track selected for review.";

  const now = new Date();
  elements.intelSheetTelemetry.innerHTML = `
    <div>${info.locationMeta}</div>
    <div>Altitude: ${info.altitude > 0 ? Math.round(info.altitude).toLocaleString() + ' m' : '—'}</div>
    <div>Status: LIVE MONITORING</div>
    <div>Class: ${isEvent ? "Ephemeral event marker" : info.synthetic ? "Auxiliary model track" : "Primary track"}</div>
  `;

  const assessmentText = isEvent
    ? "Live intelligence event — sourced from real-time global news feeds."
    : info.type === "incident"
      ? "Active incident — conflict marker or disruption event."
      : info.type === "zone"
        ? "Active exclusion or disruption zone."
        : info.type === "military" || info.type === "radar"
          ? "Military-linked track with active radar coverage."
          : info.type === "satellite"
            ? "Orbital asset under continuous tracking."
            : info.type === "maritime"
              ? "Maritime vessel — shipping lane monitoring."
              : "Traffic track contributing to current route density.";

  const feedText = isEvent
    ? "GDELT real-time news feed"
    : info.type === "incident" || info.type === "zone"
      ? "Scenario intelligence overlay"
      : info.type.startsWith("live-") ? "Live feed adapter" : "Static backdrop overlay";

  elements.intelSheetAssessment.innerHTML = `
    <div>${assessmentText}</div>
    <div>Feed: ${feedText}</div>
    <div>Last updated: ${now.toUTCString().slice(17, 25)} UTC</div>
    ${intelSourceLine}
  `;
  elements.intelSheetTimeline.innerHTML = [
    { kicker: "Now",  copy: `${info.label} under active surveillance` },
    { kicker: "Feed", copy: isEvent ? "GDELT DOC API — real-time news intelligence" : info.type.startsWith("live-") ? "Real-time ADS-B / AIS data" : "Static backdrop model track" },
    { kicker: "Next", copy: "Continue monitoring — auto-refresh active" }
  ].map(item => `
    <div class="intel-timeline-item">
      <strong>${escapeHtml(item.kicker)}</strong>
      <span>${escapeHtml(item.copy)}</span>
    </div>
  `).join("");
  syncMobileActionButtons();
}

function closeIntelSheet() {
  state.intelSheetOpen = false;
  state._intelSheetInfo = null;
  document.body.classList.remove("intel-sheet-open");
  if (!elements.intelSheet) return;
  elements.intelSheet.classList.add("hidden");
  elements.intelSheet.classList.remove("classified");
  elements.intelSheet.setAttribute("aria-hidden", "true");
  if (elements.intelSourceBar) elements.intelSourceBar.classList.add("hidden");
  // Hide mobile backdrop if no drawer is open
  if (window.innerWidth <= 980 && !state.activeDrawer && elements.mobileBackdrop) {
    elements.mobileBackdrop.classList.add("hidden");
  }
  syncMobileActionButtons();
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
  syncMobileActionButtons();
}

function openMobileDrawer(drawer) {
  const panelId = drawer === "layers"
    ? "panel-layers"
    : drawer === "controls"
      ? "panel-right"
      : null;

  if (panelId) setPanelHidden(panelId, false);
  if (window.innerWidth <= 980) {
    closeIntelSheet();
    closeNewsPanel();
  }
  setMobileDrawer(drawer);
}

function syncMobileActionButtons() {
  elements.btnMobileLayers?.classList.toggle("active", state.activeDrawer === "layers");
  elements.btnMobileControls?.classList.toggle("active", state.activeDrawer === "controls");
  elements.btnMobileSignals?.classList.toggle("active", !!state.newsOpen);

  if (elements.btnMobileIntel) {
    const hasSelection = !!state.selectedEntity;
    elements.btnMobileIntel.disabled = !hasSelection;
    elements.btnMobileIntel.classList.toggle("active", hasSelection && state.intelSheetOpen);
  }
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
  const shimmer = document.getElementById("refresh-shimmer");
  if (shimmer) shimmer.classList.add("active");
  state.liveFeeds = await fetchLiveFeeds();
  if (shimmer) shimmer.classList.remove("active");
  renderFeedStatus();
  renderTrustIndicators();
  // Only clear + recreate entities if at least one feed has data;
  // otherwise keep previous entities visible until next successful refresh
  const hasAdsb = state.liveFeeds.adsb.status === "live" && state.liveFeeds.adsb.records.length;
  const hasAis  = state.liveFeeds.ais.status  === "live" && state.liveFeeds.ais.records.length;
  if (hasAdsb || hasAis) {
    clearLiveTraffic();
    if (hasAdsb) {
      addLiveTrafficEntities(state.liveFeeds.adsb.records, "commercial", Cesium.Color.fromCssColorString("#90f4ff"), "live-adsb");
    }
    if (hasAis) {
      addLiveTrafficEntities(state.liveFeeds.ais.records, "maritime", Cesium.Color.fromCssColorString("#7bffcb"), "live-ais");
    }
  }
  refreshEntityVisibility();
  const now = new Date().toLocaleTimeString([], { hour12: false });
  if (elements.liveLastRefresh) elements.liveLastRefresh.textContent = `Last refresh: ${now} UTC`;
  if (elements.hudStatusMode)   elements.hudStatusMode.textContent   = "LIVE FEED";
  state.nextRefreshAt = Date.now() + state.refreshIntervalSec * 1000;
  state._lastRefreshTime = Date.now();
  updateRefreshCountdown();
  renderLegend();
  renderLayerToggles();

  // Pulse the LIVE badge to indicate fresh data
  const liveBadge = document.querySelector(".hud-live");
  if (liveBadge) {
    liveBadge.classList.add("data-pulse");
    setTimeout(() => liveBadge.classList.remove("data-pulse"), 1200);
  }
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
  let lastTypeFrame = 0;

  function frame(now) {
    const progress = Math.min((now - startedAt) / duration, 1);
    const revealCount = Math.floor(finalText.length * progress);
    // Throttled type sound (max every ~60ms)
    if (revealCount > lastTypeFrame + 2) {
      lastTypeFrame = revealCount;
      sfx.type();
    }
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
  const altitude    = props?.altitude?.getValue?.(viewer.clock.currentTime) ?? 0;
  const synthetic   = !!props?.synthetic?.getValue?.(viewer.clock.currentTime);
  const articleUrl  = props?.articleUrl?.getValue?.(viewer.clock.currentTime) ?? "";
  const articleLang = props?.articleLang?.getValue?.(viewer.clock.currentTime) ?? "";
  const articleDomain = props?.articleDomain?.getValue?.(viewer.clock.currentTime) ?? "";
  return { label, description, type, locationMeta, altitude, synthetic, entityId: entity.id, articleUrl, articleLang, articleDomain };
}

function hideHoverTooltip() { elements.hoverTooltip.classList.add("hidden"); }

function showHoverTooltip(entity, screenPosition) {
  const info = getEntityInfo(entity);
  if (!info) { hideHoverTooltip(); return; }
  const isEvent = info.type === "event-visual" || info.type === "event-cone" || info.type === "event-trail";
  const articleLine = isEvent && info.articleUrl
    ? `<span class="tooltip-article-hint">${escapeHtml(info.articleDomain || "Source article")} ↗</span>`
    : "";
  const langLine = isEvent && info.articleLang && isNonEnglish(info.articleLang)
    ? `<span class="tooltip-lang">${escapeHtml(langDisplayName(info.articleLang))}</span>`
    : "";
  const typeDisplay = isEvent ? "LIVE EVENT" : info.type.toUpperCase();
  // Try to get entity coordinates
  let coordLine = "";
  if (entity.position) {
    try {
      const pos = entity.position.getValue ? entity.position.getValue(viewer.clock.currentTime) : entity.position;
      if (pos) {
        const cg = Cesium.Cartographic.fromCartesian(pos);
        const lat = Cesium.Math.toDegrees(cg.latitude).toFixed(2);
        const lng = Cesium.Math.toDegrees(cg.longitude).toFixed(2);
        coordLine = `<span class="tooltip-coords">${lat}° ${lng}°</span>`;
      }
    } catch { /* ignore */ }
  }
  elements.hoverTooltip.innerHTML = `
    <strong>${escapeHtml(info.label)}</strong>
    <span>${escapeHtml(typeDisplay)}</span>
    <p>${escapeHtml(info.description || info.locationMeta)}</p>
    ${coordLine}${langLine}${articleLine}
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
  const { label, description, type, locationMeta, altitude, synthetic, entityId, articleUrl, articleLang, articleDomain } = getEntityInfo(entity);
  const incident = type === "incident" ? findScenarioIncidentById(entityId) : null;
  const incidentNarrative = incident ? getActiveIncidentNarrative(incident) : null;
  const effectiveDescription = incidentNarrative?.description ?? description;

  // Article source link — from scenario incidents OR from event-visual news links
  const isEventVisual = type === "event-visual" || type === "event-cone" || type === "event-trail";
  let sourceMarkup;
  if (incidentNarrative?.sourceUrl) {
    sourceMarkup = `<a class="entity-source-link" href="${escapeHtml(incidentNarrative.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(incidentNarrative.sourceLabel || "Source article")} ↗</a>`;
  } else if (incidentNarrative?.sourceLabel) {
    sourceMarkup = `<span class="entity-source-text">${escapeHtml(incidentNarrative.sourceLabel)}</span>`;
  } else if (isEventVisual && articleUrl) {
    const langNote = articleLang && isNonEnglish(articleLang)
      ? ` <span class="entity-lang-chip">${escapeHtml(langDisplayName(articleLang))}</span>`
      : "";
    sourceMarkup = `<a class="entity-source-link" href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(articleDomain || "Read article")} ↗</a>${langNote}`;
  } else {
    sourceMarkup = "";
  }
  const typeDisplay = isEventVisual ? "LIVE EVENT" : type.toUpperCase();
  elements.entityInfo.innerHTML = `
    <strong>${escapeHtml(label)}</strong>
    <div>${escapeHtml(effectiveDescription)}</div>
    ${sourceMarkup}
    <div class="entity-meta">
      <span>${escapeHtml(typeDisplay)}</span>
      <span>${escapeHtml(locationMeta)}</span>
    </div>
    <div class="entity-stats">
      <span>ALT ${altitude > 0 ? Math.round(altitude).toLocaleString() + ' m' : '—'}</span>
      <span>${synthetic ? "AUX MODEL" : "PRIMARY TRACK"}</span>
      <span>LIVE</span>
    </div>
  `;
  elements.entityInfo.onclick = (e) => { if (e.target.closest('a')) return; openIntelSheet(entity); };
  updateTrackButtons();
}

function updateTrackButtons() {
  const canTrack = !!state.selectedEntity && !!state.selectedEntity.position;
  elements.trackSelected.disabled = !canTrack;
  elements.releaseTrack.disabled  = !state.trackedEntity;
  updateOperationsControls();
  syncMobileActionButtons();
}

function saveCurrentBookmark() {
  const next = {
    id:    `bookmark-${Date.now()}`,
    label: `View ${state.bookmarks.length + 1}`,
    destination: captureCameraDestination()
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
  flyToDestination(bookmark.destination, undefined, 1.4);
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
  const isWarroom = mode === "warroom";
  postStages.blackAndWhite.enabled             = mode === "nightvision" || mode === "thermal";
  postStages.blackAndWhite.uniforms.gradations = mode === "thermal" ? 8 : 14;
  postStages.brightness.enabled                = mode !== "normal";
  postStages.brightness.uniforms.brightness    = mode === "nightvision" ? 0.08 : mode === "thermal" ? 0.15 : mode === "crt" ? 0.05 : isWarroom ? 0.03 : 0;
  if (isWarroom && bloomStage) {
    bloomStage.uniforms.brightness = 0.05;
    bloomStage.uniforms.delta      = 2.5;
    bloomStage.uniforms.sigma      = 3.2;
  }
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

  const quickBoot = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    || window.sessionStorage.getItem(BOOT_SESSION_KEY) === "1";

  if (quickBoot) {
    fillEl.style.width = "100%";
    statusEl.textContent = "● GOD'S EYE ONLINE";
    finishBoot({ immediate: true });
    return;
  }

  let stepIdx = 0;
  const STEP_DELAY = 180;
  const bootTimeout = setTimeout(() => { finishBoot(); }, 4800);
  const bootLog = document.getElementById("boot-log");

  const LOG_LINES = [
    "[SYS] Kernel handshake .............. OK",
    "[NET] Satellite uplink .............. OK",
    "[GEO] CesiumJS renderer ............. OK",
    "[ADS] ADS-B feed binding ............ OK",
    "[MAR] Maritime AIS decoder .......... OK",
    "[SAT] Orbital TLE parser ............ OK",
    "[INT] GDELT news pipeline ........... OK",
    "[SEC] Encryption layer .............. OK",
    "[HUD] Tactical HUD assembly ......... OK",
    "[GPU] WebGL context acquired ........ OK",
    "[SYS] All subsystems nominal",
  ];

  function appendBootLog(idx) {
    if (!bootLog || idx >= LOG_LINES.length) return;
    const line = document.createElement("div");
    line.className = "boot-log-line" + (idx === LOG_LINES.length - 1 ? " ok" : "");
    line.textContent = LOG_LINES[idx];
    bootLog.appendChild(line);
    // Keep max 8 visible lines
    while (bootLog.children.length > 8) bootLog.removeChild(bootLog.firstChild);
  }

  function runStep() {
    if (stepIdx >= BOOT_STEPS.length) {
      clearTimeout(bootTimeout);
      finishBoot();
      return;
    }
    const { pct, msg } = BOOT_STEPS[stepIdx];
    if (fillEl)   fillEl.style.width = `${pct}%`;
    if (statusEl) statusEl.textContent = msg;
    appendBootLog(stepIdx);
    stepIdx++;
    setTimeout(runStep, STEP_DELAY);
  }

  setTimeout(runStep, 140);
}

function finishBoot({ immediate = false } = {}) {
  const overlay = elements.bootOverlay;
  if (!overlay) return;

  const finishOverlay = () => {
    overlay.classList.add("boot-fading");
    overlay.style.pointerEvents = "none";
    document.body.classList.add("boot-complete");
    pulseConsoleFrame("boot");
    applyCleanLandingLayout();
    startAmbientUpdates();
    initPresenceLayer();
    updateSummaryHint();
    // ── Audio engine: first gesture already happened (boot overlay click) ──
    initAudioEngine();
    sfx.startAmbient();
    try {
      window.sessionStorage.setItem(BOOT_SESSION_KEY, "1");
    } catch {
      // Ignore unavailable session storage.
    }
    // After boot animations finish, remove animation classes so
    // panel-hidden / panel-minimized CSS takes effect properly.
    setTimeout(() => {
      document.body.classList.remove("ui-booting");
      document.querySelectorAll(".draggable-panel, #hud-top, #hud-bottom, .news-toggle-btn").forEach(el => {
        el.style.animation = "none";
      });
      // Re-apply stored panel state now that animations are cleared
      applyStoredPanelState();
    }, immediate ? 200 : 900);
    setTimeout(() => {
      overlay.style.display = "none";
      overlay.remove();
      // Show first-visit tip
      if (!localStorage.getItem("ge-visited")) {
        localStorage.setItem("ge-visited", "1");
        setTimeout(() => {
          showToast("Press ? for keyboard shortcuts · Backtick for console", "info");
        }, 2000);
      }
    }, immediate ? 120 : 560);
  };

  if (immediate) {
    finishOverlay();
    return;
  }

  const shutterTop    = overlay.querySelector(".boot-shutter-top");
  const shutterBottom = overlay.querySelector(".boot-shutter-bottom");
  if (shutterTop)    shutterTop.classList.add("open");
  if (shutterBottom) shutterBottom.classList.add("open");

  viewer.camera.flyTo({
    destination: homeView,
    orientation: {
      heading: STARTUP_VIEW.heading,
      pitch:   STARTUP_VIEW.pitch,
      roll:    STARTUP_VIEW.roll
    },
    duration: 0.9,
    complete: () => {
      startGlobeSpinDown();
    }
  });

  setTimeout(finishOverlay, 320);
}

function applyCleanLandingLayout() {
  if (window.innerWidth <= 980) return;
  setPanelMinimized("panel-right", true);
  setPanelMinimized("floating-summary", true);
  setPanelHidden("map-legend", true);
  refreshPanelRestoreStrip();
}

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

  // ── Audio toggle button ──
  const audioBtn = document.getElementById("btn-audio-toggle");
  if (audioBtn) {
    const syncAudioIcon = () => {
      const on = isAudioEnabled();
      audioBtn.textContent = on ? "🔊" : "🔇";
      audioBtn.classList.toggle("muted", !on);
    };
    syncAudioIcon();
    audioBtn.addEventListener("click", () => {
      initAudioEngine();
      setAudioEnabled(!isAudioEnabled());
      syncAudioIcon();
      sfx.click();
    });
  }

  // ── Terminal CLI ──
  initTerminalCli();

  // ── Click sound on all interactive elements ──
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("button, .panel-btn, .hud-action, .layer-toggle, .camera-preset-btn, .news-btn, .transport-btn, .search-btn, .fx-mode-btn, .basemap-btn")) {
      sfx.click();
    }
  }, { passive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// TERMINAL CLI
// ─────────────────────────────────────────────────────────────────────────────
function initTerminalCli() {
  const cliWrap  = document.getElementById("terminal-cli");
  const cliInput = document.getElementById("terminal-cli-input");
  const cliOut   = document.getElementById("terminal-cli-output");
  if (!cliWrap || !cliInput) return;

  let cliVisible = false;

  function toggleCli(show) {
    cliVisible = typeof show === "boolean" ? show : !cliVisible;
    cliWrap.classList.toggle("hidden", !cliVisible);
    if (cliVisible) cliInput.focus();
  }

  // Backtick (`) or Ctrl+/ toggles the terminal
  document.addEventListener("keydown", (e) => {
    if (e.key === "`" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (document.activeElement === cliInput) { toggleCli(false); return; }
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
      e.preventDefault();
      toggleCli();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      toggleCli();
    }
    if (e.key === "Escape" && cliVisible) {
      toggleCli(false);
    }
  });

  function appendOutput(text, cls = "cmd-info") {
    if (!cliOut) return;
    const line = document.createElement("div");
    line.className = `cmd-line ${cls}`;
    // Support multiline output
    if (text.includes("\n")) {
      line.style.whiteSpace = "pre-wrap";
    }
    line.textContent = text;
    cliOut.appendChild(line);
    cliOut.scrollTop = cliOut.scrollHeight;
    // Auto-clear old lines
    while (cliOut.children.length > 50) cliOut.removeChild(cliOut.firstChild);
  }

  const _cmdHistory = [];
  let _cmdHistoryIdx = 0;

  function runCommand(raw) {
    const input = raw.trim();
    if (!input) return;
    sfx.type();
    _cmdHistory.push(input);
    _cmdHistoryIdx = _cmdHistory.length;

    const parts = input.split(/\s+/);
    const cmd   = parts[0].toLowerCase();
    const arg   = parts.slice(1).join(" ");

    switch (cmd) {
      case "/help":
        appendOutput("Commands: /focus <region> · /mode <fx> · /alert <level> · /scan · /warroom · /normal · /stats · /events · /country <name> · /refresh · /screenshot · /theme · /fullscreen · /uptime · /goto <lat,lng> · /layers · /fly <dest> · /perf · /reset · /search <term> · /time · /opacity <0-1> · /summary · /bookmark <name> · /measure · /export · /clear · /help", "cmd-info");
        break;

      case "/focus": {
        const preset = CAMERA_PRESETS.find(p => p.label.toLowerCase().includes(arg.toLowerCase()));
        if (preset) {
          appendOutput(`FOCUS → ${preset.label}`, "cmd-ok");
          state.regionFocus = preset.regionFocus ?? null;
          flyToDestination(preset.destination, () => {
            if (preset.regionFocus) applyRegionalContext(preset.regionFocus, preset.destination.lng, preset.destination.lat);
          }, 2.1);
        } else {
          appendOutput(`Unknown region: ${arg}. Try: gulf, europe, pacific`, "cmd-err");
        }
        break;
      }

      case "/mode": {
        const mode = FX_MODES.find(m => m.id === arg.toLowerCase() || m.label.toLowerCase() === arg.toLowerCase());
        if (mode) {
          appendOutput(`FX MODE → ${mode.label}`, "cmd-ok");
          state.fxMode = mode.id;
          applyFxMode(mode.id);
        } else {
          appendOutput(`Unknown mode: ${arg}. Try: normal, nightvision, thermal, crt, warroom`, "cmd-err");
        }
        break;
      }

      case "/warroom":
        appendOutput("WAR ROOM ENGAGED", "cmd-warn");
        state.fxMode = "warroom";
        applyFxMode("warroom");
        break;

      case "/normal":
        appendOutput("Normal mode restored", "cmd-ok");
        state.fxMode = "normal";
        applyFxMode("normal");
        break;

      case "/alert": {
        const lvl = parseInt(arg) || 0;
        appendOutput(`THREAT LEVEL OVERRIDE → ${Math.min(100, Math.max(0, lvl))}%`, "cmd-warn");
        if (elements.threatFill) elements.threatFill.style.width = `${Math.min(100, Math.max(0, lvl))}%`;
        sfx.alert();
        break;
      }

      case "/scan":
        appendOutput("Initiating regional scan sweep…", "cmd-info");
        sfx.ping();
        pulseConsoleFrame("scan");
        break;

      case "/clear":
        if (cliOut) cliOut.innerHTML = "";
        break;

      case "/stats": {
        const s = getSessionSummary();
        appendOutput(`SESSION: ${s.duration} uptime · ${s.eventsSpawned} events · ${s.countriesSeen} countries · ${s.articlesIngested} articles`, "cmd-info");
        break;
      }

      case "/events":
        appendOutput(`Active events: ${dynamic.eventVisuals.length} (${dynamic.eventVisuals.filter(v => v.geoSpawned).length} geo-sourced)`, "cmd-info");
        break;

      case "/country": {
        if (!arg) { appendOutput("Usage: /country <name>", "cmd-err"); break; }
        const match = Object.entries(COUNTRY_COORDS).find(([k]) => k.includes(arg.toLowerCase()));
        if (match) {
          const [name, coords] = match;
          appendOutput(`FOCUS → ${name.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" ")} (${coords.lat}°, ${coords.lng}°)`, "cmd-ok");
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(coords.lng, coords.lat, 2500000),
            duration: 1.8
          });
        } else {
          appendOutput(`Country not found: ${arg}`, "cmd-err");
        }
        break;
      }

      case "/refresh":
        appendOutput("Force-refreshing all live feeds…", "cmd-info");
        refreshLiveFeeds();
        break;

      case "/screenshot":
        captureGlobeScreenshot();
        appendOutput("Screenshot captured — downloading…", "cmd-ok");
        break;

      case "/theme":
        toggleDarkTheme();
        appendOutput(`Theme: ${_ultraDark ? "ultra-dark" : "normal"}`, "cmd-ok");
        break;

      case "/fullscreen":
        toggleFullscreen();
        appendOutput(document.fullscreenElement ? "Exiting fullscreen…" : "Entering fullscreen…", "cmd-ok");
        break;

      case "/uptime": {
        const summary = getSessionSummary();
        appendOutput(`Session uptime: ${summary.duration} · ${summary.eventsSpawned} events · ${summary.countriesSeen} countries · ${summary.articlesIngested} articles`, "cmd-ok");
        break;
      }

      case "/goto": {
        const coords = arg.split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
        if (coords.length >= 2) {
          const [lat, lng] = coords;
          const alt = coords[2] || 2000000;
          appendOutput(`Flying to ${lat.toFixed(2)}, ${lng.toFixed(2)} at ${(alt/1000).toFixed(0)}km`, "cmd-ok");
          pausePassiveSpin(8000);
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lng, lat, alt),
            duration: 2.5
          });
        } else {
          appendOutput("Usage: /goto <lat>, <lng> [, alt]  e.g. /goto 48.85, 2.35", "cmd-err");
        }
        break;
      }

      case "/layers": {
        const layers = state.layerVisibility;
        const lines = Object.entries(layers).map(([id, vis]) => `  ${vis ? "●" : "○"} ${id}`);
        appendOutput("Active layers:\n" + lines.join("\n"), "cmd-info");
        break;
      }

      case "/fly": {
        const presetNames = CAMERA_PRESETS.map(p => p.label).join(", ");
        if (!arg) {
          appendOutput(`Available: ${presetNames}`, "cmd-info");
        } else {
          const preset = CAMERA_PRESETS.find(p => p.label.toLowerCase().includes(arg.toLowerCase()));
          if (preset) {
            appendOutput(`Flying to ${preset.label}`, "cmd-ok");
            pausePassiveSpin(8000);
            flyToDestination(preset.destination, null, 2.5);
          } else {
            appendOutput(`Unknown destination. Available: ${presetNames}`, "cmd-err");
          }
        }
        break;
      }

      case "/perf": {
        const totalEntities = viewer.entities.values.length;
        const fps = frameSamples.length;
        const mem = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} MB` : "N/A";
        const lines = [
          `Entities: ${totalEntities}`,
          `Events: ${dynamic.eventVisuals.length}`,
          `Connections: ${dynamic.connectionLines.length}`,
          `FPS: ${fps}`,
          `Memory: ${mem}`,
          `Imagery layers: ${viewer.imageryLayers.length}`,
        ];
        appendOutput("Performance:\n" + lines.join("\n"), "cmd-info");
        break;
      }

      case "/reset": {
        appendOutput("Resetting camera to home view…", "cmd-ok");
        navFlyHome();
        break;
      }

      case "/search": {
        if (!arg) {
          appendOutput("Usage: /search <keyword>  — search entity names", "cmd-info");
        } else {
          const q = arg.toLowerCase();
          const hits = viewer.entities.values.filter(e => {
            const n = e.name || "";
            return n.toLowerCase().includes(q);
          });
          if (hits.length === 0) {
            appendOutput(`No entities matching "${arg}"`, "cmd-err");
          } else {
            const names = hits.slice(0, 10).map(e => e.name).join(", ");
            appendOutput(`Found ${hits.length} entit${hits.length === 1 ? "y" : "ies"}: ${names}${hits.length > 10 ? "…" : ""}`, "cmd-ok");
            // Fly to first match
            if (hits[0].position) {
              const pos = hits[0].position.getValue ? hits[0].position.getValue(Cesium.JulianDate.now()) : hits[0].position;
              if (pos) {
                const carto = Cesium.Cartographic.fromCartesian(pos);
                pausePassiveSpin(6000);
                viewer.camera.flyTo({
                  destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 2000000),
                  duration: 2.0
                });
              }
            }
          }
        }
        break;
      }

      case "/time": {
        const now = new Date();
        const utc = now.toISOString().replace("T", " ").split(".")[0] + " UTC";
        const local = now.toLocaleTimeString();
        const up = document.getElementById("session-uptime");
        appendOutput(`UTC: ${utc}\nLocal: ${local}\nSession: ${up ? up.textContent : "N/A"}`, "cmd-info");
        break;
      }

      case "/opacity": {
        const val = parseFloat(arg);
        if (isNaN(val) || val < 0 || val > 1) {
          appendOutput("Usage: /opacity <0-1>  — set globe base opacity", "cmd-info");
        } else {
          viewer.scene.globe.baseColor = Cesium.Color.fromAlpha(Cesium.Color.BLACK, val);
          appendOutput(`Globe opacity set to ${val}`, "cmd-ok");
        }
        break;
      }

      case "/summary": {
        const totalEntities = viewer.entities.values.length;
        const events = dynamic.eventVisuals.length;
        const conns = dynamic.connectionLines.length;
        const upEl = document.getElementById("session-uptime");
        const uptime = upEl ? upEl.textContent : "N/A";
        const layerCounts = Object.entries(state.layerVisibility)
          .filter(([, v]) => v)
          .map(([k]) => k);
        const lines = [
          "╔══════════════════════════════════════╗",
          "║       SESSION INTELLIGENCE BRIEF      ║",
          "╚══════════════════════════════════════╝",
          `Uptime:      ${uptime}`,
          `Entities:    ${totalEntities}`,
          `Live events: ${events}`,
          `Connections: ${conns}`,
          `Active layers: ${layerCounts.join(", ") || "none"}`,
          `Threat level: ${document.getElementById("threat-value")?.textContent || "N/A"}`,
          `Mode:        ${state.uiMode || "normal"}`,
          `Camera alt:  ${Math.round(viewer.camera.positionCartographic.height / 1000)} km`,
        ];
        appendOutput(lines.join("\n"), "cmd-info");
        break;
      }

      case "/bookmark": {
        if (!arg) {
          // List bookmarks
          const bm = JSON.parse(localStorage.getItem("ge-bookmarks") || "{}");
          const names = Object.keys(bm);
          if (names.length === 0) appendOutput("No bookmarks saved. Use /bookmark <name> to save current view.", "cmd-info");
          else appendOutput(`Bookmarks: ${names.join(", ")}`, "cmd-info");
        } else if (arg.startsWith("-d ")) {
          // Delete bookmark
          const name = arg.slice(3).trim();
          const bm = JSON.parse(localStorage.getItem("ge-bookmarks") || "{}");
          delete bm[name];
          localStorage.setItem("ge-bookmarks", JSON.stringify(bm));
          appendOutput(`Deleted bookmark: ${name}`, "cmd-ok");
        } else {
          // Check if bookmark exists — if so, fly to it; otherwise save
          const bm = JSON.parse(localStorage.getItem("ge-bookmarks") || "{}");
          if (bm[arg]) {
            const { lat, lng, alt, heading, pitch } = bm[arg];
            pausePassiveSpin(8000);
            viewer.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(lng, lat, alt),
              orientation: { heading: Cesium.Math.toRadians(heading), pitch: Cesium.Math.toRadians(pitch), roll: 0 },
              duration: 2.0
            });
            appendOutput(`Flying to bookmark: ${arg}`, "cmd-ok");
          } else {
            const cam = viewer.camera.positionCartographic;
            bm[arg] = {
              lat: Cesium.Math.toDegrees(cam.latitude),
              lng: Cesium.Math.toDegrees(cam.longitude),
              alt: cam.height,
              heading: Cesium.Math.toDegrees(viewer.camera.heading),
              pitch: Cesium.Math.toDegrees(viewer.camera.pitch),
            };
            localStorage.setItem("ge-bookmarks", JSON.stringify(bm));
            appendOutput(`Saved bookmark: ${arg}`, "cmd-ok");
          }
        }
        break;
      }

      case "/measure": {
        _measurePoint = null;
        appendOutput("Measurement mode: Shift+click two points on the globe to measure distance.", "cmd-info");
        break;
      }

      case "/export": {
        // Export current live events as JSON to clipboard
        try {
          const exportData = {
            exportedAt: new Date().toISOString(),
            threatLevel: document.getElementById("threat-value")?.textContent || "N/A",
            liveEvents: dynamic.eventVisuals.map((v, i) => ({
              index: i,
              lat: v.lat ?? null,
              lng: v.lng ?? null,
              bornAt: new Date(v.bornAt).toISOString(),
              ttlMs: v.ttlMs,
              geoSpawned: v.geoSpawned ?? false
            })),
            connectionCount: dynamic.connectionLines.length,
            entityCount: viewer.entities.values.length
          };
          const json = JSON.stringify(exportData, null, 2);
          navigator.clipboard.writeText(json).then(() => {
            appendOutput(`✓ Exported ${exportData.liveEvents.length} events to clipboard as JSON.`, "cmd-ok");
          }).catch(() => {
            appendOutput(json.slice(0, 500) + "\n[...truncated — copy from above]", "cmd-info");
          });
        } catch (e) {
          appendOutput(`Export failed: ${e.message}`, "cmd-err");
        }
        break;
      }

      default:
        appendOutput(`Unknown command: ${cmd}. Type /help for available commands.`, "cmd-err");
    }
  }

  const CLI_COMMANDS = ["/help", "/focus", "/mode", "/alert", "/scan", "/warroom", "/normal", "/stats", "/events", "/country", "/refresh", "/screenshot", "/theme", "/fullscreen", "/uptime", "/goto", "/layers", "/fly", "/perf", "/reset", "/search", "/time", "/opacity", "/summary", "/bookmark", "/measure", "/export", "/clear"];

  cliInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = cliInput.value;
      cliInput.value = "";
      runCommand(val);
    }
    // Tab autocomplete
    if (e.key === "Tab") {
      e.preventDefault();
      const val = cliInput.value.toLowerCase();
      if (!val.startsWith("/")) return;
      const matches = CLI_COMMANDS.filter(c => c.startsWith(val));
      if (matches.length === 1) {
        cliInput.value = matches[0] + " ";
      } else if (matches.length > 1) {
        appendOutput(matches.join("  "), "cmd-info");
      }
    }
    // Up arrow for command history
    if (e.key === "ArrowUp" && _cmdHistory.length) {
      _cmdHistoryIdx = Math.max(0, _cmdHistoryIdx - 1);
      cliInput.value = _cmdHistory[_cmdHistoryIdx] || "";
    }
    if (e.key === "ArrowDown" && _cmdHistory.length) {
      _cmdHistoryIdx = Math.min(_cmdHistory.length, _cmdHistoryIdx + 1);
      cliInput.value = _cmdHistory[_cmdHistoryIdx] || "";
    }
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
      if (window.innerWidth <= 980 && (panel.id === "panel-layers" || panel.id === "panel-right")) return;
      const bar   = panel.querySelector(".panel-drag-bar");
      const label = bar?.querySelector(".drag-label")?.textContent ?? panel.id;
      const btn   = document.createElement("button");
      btn.className = "panel-restore-btn";
      btn.textContent = `⊕ ${label}`;
      btn.title = `Restore ${label} panel`;
      btn.addEventListener("click", () => {
        setPanelHidden(panel.id, false);
        // Reset any drag transform back to CSS default
        panel.style.left = "";
        panel.style.top  = "";
        panel.style.right = "";
        panel.style.bottom = "";
        panel.style.transform = "";
        if (window.innerWidth <= 980) {
          if (panel.id === "panel-layers") openMobileDrawer("layers");
          else if (panel.id === "panel-right") openMobileDrawer("controls");
          else panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        refreshRestoreStrip();
      });
      restoreStrip.appendChild(btn);
    });

    // Also show restore button for the news panel if it was closed
    const newsBriefing = document.getElementById("news-briefing");
    if (newsBriefing && newsBriefing.classList.contains("hidden") && !state.newsOpen && window.innerWidth > 980) {
      const btn = document.createElement("button");
      btn.className = "panel-restore-btn";
      btn.textContent = "⊕ SIGNALS";
      btn.title = "Restore news intelligence panel";
      btn.addEventListener("click", () => {
        toggleNewsPanel();
        refreshRestoreStrip();
      });
      restoreStrip.appendChild(btn);
    }
  }

  refreshPanelRestoreStrip = refreshRestoreStrip;

  // Close buttons
  document.querySelectorAll(".panel-close-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const targetId = btn.dataset.closePanel;
      const panel    = targetId ? document.getElementById(targetId) : btn.closest(".draggable-panel");
      if (!panel) return;
      setPanelHidden(panel.id, true);
      // If a mobile drawer is open for this panel, close it too
      if (window.innerWidth <= 980) setMobileDrawer(null);
      refreshRestoreStrip();
    });
  });

  document.querySelectorAll(".panel-minimize-btn").forEach(btn => {
    btn.addEventListener("click", event => {
      event.stopPropagation();
      const targetId = btn.dataset.minimizePanel;
      const panel = targetId ? document.getElementById(targetId) : btn.closest(".draggable-panel");
      if (!panel) return;
      const current = getPanelState(panel.id);
      setPanelMinimized(panel.id, !current.minimized);
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
        savePanelState();
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
        savePanelState();
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend",  onTouchEnd);
      }
      document.addEventListener("touchmove", onTouchMove, { passive: true });
      document.addEventListener("touchend",  onTouchEnd);
    }, { passive: true });
  });

  applyStoredPanelState();
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
      const resp = await nominatimFetch(url);
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
    const resp = await nominatimFetch(url);
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

  // Also match COUNTRY_COORDS for quick country-code / country-name jumps
  for (const [name, coords] of Object.entries(COUNTRY_COORDS)) {
    const score = computeSearchScore(normalizedQuery, name);
    if (score > 0.3 && !deduped.has(`country:${name}`)) {
      deduped.set(`country:${name}`, {
        id: `country:${name}`,
        kind: "country",
        title: name.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" "),
        subtitle: "Country — news-monitored region",
        meta: `${coords.lat.toFixed(1)}°, ${coords.lng.toFixed(1)}°`,
        lng: coords.lng,
        lat: coords.lat,
        score
      });
    }
  }

  return Array.from(deduped.values()).sort((a, b) => b.score - a.score).slice(0, 8);
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
    const geoUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=7&q=${encodeURIComponent(trimmed)}`;
    const response = await nominatimFetch(geoUrl);
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
    state.bookmarks = state.bookmarks.filter(bookmark => bookmark.system);
    saveJson(STORAGE_KEYS.bookmarks, state.bookmarks);
    renderBookmarks();
  });
  elements.saveLayout?.addEventListener("click", saveCurrentLayout);
  elements.clearLayouts?.addEventListener("click", () => {
    state.savedLayouts = [];
    saveJson(UI_STORAGE_KEYS.layouts, state.savedLayouts);
    renderSavedLayouts();
  });

  elements.refreshFeeds?.addEventListener("click",       () => refreshLiveFeeds());
  elements.opsNextHotspot?.addEventListener("click",     focusNextHotspot);
  elements.opsRandomTrack?.addEventListener("click",     focusRandomTrack);
  elements.opsOpenIntel?.addEventListener("click",       () => {
    if (state.selectedEntity) openIntelSheet(state.selectedEntity);
  });
  elements.opsBriefFocus?.addEventListener("click",      createFocusBrief);
  elements.opsTourToggle?.addEventListener("click",      toggleAlertTour);
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
  elements.btnGuide?.addEventListener("click",           () => openMissionGuide(state.onboardingStep || 0));
  elements.summaryGuide?.addEventListener("click",       () => openMissionGuide(state.onboardingStep || 0));
  elements.summaryHotspot?.addEventListener("click",     focusNextHotspot);
  elements.summaryRandom?.addEventListener("click",      focusRandomTrack);
  elements.summaryNews?.addEventListener("click",        toggleNewsPanel);
  elements.missionGuideClose?.addEventListener("click",  () => closeMissionGuide(true));
  elements.missionGuideSkip?.addEventListener("click",   () => closeMissionGuide(true));
  elements.missionGuidePrev?.addEventListener("click",   () => stepMissionGuide(-1));
  elements.missionGuideNext?.addEventListener("click",   () => stepMissionGuide(1));
  elements.missionGuide?.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.closeGuide === "true") closeMissionGuide(true);
  });
  elements.btnFullscreen?.addEventListener("click",      () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  elements.btnDeclutter?.addEventListener("click",       () => { state.declutter = !state.declutter; applyDeclutterMode(); });
  elements.btnDensity?.addEventListener("click",         () => { state.compact   = !state.compact;   applyDensityMode();   });
  elements.closeIntelSheet?.addEventListener("click",    closeIntelSheet);

  // ── Translate to English button in intel sheet ──
  elements.btnTranslateIntel?.addEventListener("click", async () => {
    const info = state._intelSheetInfo;
    if (!info || !info.articleLang || !isNonEnglish(info.articleLang)) return;
    elements.btnTranslateIntel.disabled = true;
    elements.btnTranslateIntel.textContent = "⏳";
    try {
      const translatedTitle = await translateTitle(info.label, info.articleLang);
      const translatedDesc = await translateTitle(info.description || "", info.articleLang);
      if (elements.intelSheetTitle) elements.intelSheetTitle.textContent = translatedTitle;
      if (elements.intelSheetOverview) elements.intelSheetOverview.textContent = translatedDesc || "Track selected for review.";
    } catch { /* silent */ }
    elements.btnTranslateIntel.textContent = "✓ EN";
    elements.btnTranslateIntel.disabled = false;
  });

  // ── Swipe-to-dismiss for intel sheet on mobile ──
  if (elements.intelSheetHandle) {
    let startY = 0;
    elements.intelSheetHandle.addEventListener("touchstart", (e) => {
      startY = e.touches[0].clientY;
    }, { passive: true });
    elements.intelSheetHandle.addEventListener("touchend", (e) => {
      const dy = e.changedTouches[0].clientY - startY;
      if (dy > 60) closeIntelSheet();
    }, { passive: true });
  }

  // ── Threat bar: click to jump to nearest critical event ──
  elements.threatSegments?.closest("#threat-level-bar")?.addEventListener("click", () => {
    sfx.click();
    // Find the nearest active incident or event visual and fly to it
    const incidents = dynamic.incidents.filter(({ entity }) => entity.show);
    if (incidents.length) {
      const pick = incidents[Math.floor(Math.random() * incidents.length)];
      state.selectedEntity = pick.entity;
      const pos = pick.entity.position?.getValue(viewer.clock.currentTime);
      if (pos) {
        const cg = Cesium.Cartographic.fromCartesian(pos);
        flyToDestination({
          lng: Cesium.Math.toDegrees(cg.longitude),
          lat: Cesium.Math.toDegrees(cg.latitude),
          height: 1200000,
          heading: 0, pitch: -0.7, roll: 0
        }, () => openIntelSheet(pick.entity));
      }
    } else if (dynamic.eventVisuals.length) {
      const ev = dynamic.eventVisuals[Math.floor(Math.random() * dynamic.eventVisuals.length)];
      state.selectedEntity = ev.dot;
      const pos = ev.dot.position?.getValue(viewer.clock.currentTime);
      if (pos) {
        const cg = Cesium.Cartographic.fromCartesian(pos);
        flyToDestination({
          lng: Cesium.Math.toDegrees(cg.longitude),
          lat: Cesium.Math.toDegrees(cg.latitude),
          height: 1200000,
          heading: 0, pitch: -0.7, roll: 0
        }, () => openIntelSheet(ev.dot));
      }
    }
  });

  elements.clpClose?.addEventListener("click",            hideClickLocationPopup);
  elements.ccbClose?.addEventListener("click",            hideClickLocationPopup);

  // Copy coordinates button on the click-location popup
  document.getElementById("clp-copy")?.addEventListener("click", () => {
    const coords = elements.clpCoordsPopup?.textContent?.trim();
    if (coords) {
      navigator.clipboard.writeText(coords).then(() => {
        const btn = document.getElementById("clp-copy");
        if (btn) { btn.textContent = "✓ COPIED"; setTimeout(() => { btn.textContent = "⎘ COPY"; }, 1500); }
      }).catch(() => {});
    }
  });
  elements.mobileBackdrop?.addEventListener("click",     () => { setMobileDrawer(null); closeIntelSheet(); });
  elements.btnMobileLayers?.addEventListener("click",    () => openMobileDrawer("layers"));
  elements.btnMobileControls?.addEventListener("click",  () => openMobileDrawer("controls"));
  elements.btnMobileIntel?.addEventListener("click",     () => {
    if (!state.selectedEntity) return;
    setMobileDrawer(null);
    openIntelSheet(state.selectedEntity);
  });
  elements.btnMobileSignals?.addEventListener("click",   () => {
    if (window.innerWidth <= 980) setMobileDrawer(null);
    toggleNewsPanel();
  });
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
  document.addEventListener("keydown", event => {
    state._shiftHeld = event.shiftKey;
    if (event.key === "Escape" && !elements.missionGuide?.classList.contains("hidden")) {
      closeMissionGuide(true);
      return;
    }
    if (event.key === "?" || (event.shiftKey && event.key === "/")) {
      event.preventDefault();
      openMissionGuide(state.onboardingStep || 0);
    }
  });

  elements.btnHome?.addEventListener("click",  () => {
    state.regionFocus = null;
    state.selectedEntity = null;
    if (elements.searchMeta) elements.searchMeta.textContent = "Search a place, alert, route, or saved view.";
    if (elements.hudStatusMode) elements.hudStatusMode.textContent = "LIVE FEED";
    if (elements.liveRegionLabel) elements.liveRegionLabel.textContent = "Global Intelligence Active";
    closeIntelSheet();
    flyToDestination({
      lng: SCENARIO.initialView.lng,
      lat: SCENARIO.initialView.lat,
      height: SCENARIO.initialView.height,
      heading: SCENARIO.initialView.heading,
      pitch: SCENARIO.initialView.pitch,
      roll: SCENARIO.initialView.roll
    }, undefined, 1.8);
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

    // Distance measurement mode (hold Shift+click)
    if (state._shiftHeld && cartesian) {
      handleMeasureClick(cartesian);
      return;
    }

    if (Cesium.defined(picked) && picked.id) {
      state.selectedEntity = picked.id;
      updateSelectedEntityCard(picked.id);
      showHoverTooltip(picked.id, click.position);
      openIntelSheet(picked.id);
      setMobileDrawer(null);
      hideClickLocationPopup();
      showSelectionRing(picked.id);
    } else {
      state.selectedEntity = null;
      updateSelectedEntityCard(null);
      hideHoverTooltip();
      hideSelectionRing();

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

  // Double-click: fly to clicked entity for close inspection, or fly to globe location
  handler.setInputAction(click => {
    const picked = viewer.scene.pick(click.position);
    if (Cesium.defined(picked) && picked.id && picked.id.position) {
      pausePassiveSpin(15000);
      const pos = picked.id.position.getValue(viewer.clock.currentTime);
      if (pos) {
        const cg = Cesium.Cartographic.fromCartesian(pos);
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromRadians(cg.longitude, cg.latitude, 800000),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-45),
            roll: 0
          },
          duration: 1.8
        });
      }
    } else {
      // Double-click on blank globe: fly closer to that location
      const cartesian = viewer.scene.pickPosition(click.position)
        || viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
      if (cartesian) {
        pausePassiveSpin(15000);
        const cg = Cesium.Cartographic.fromCartesian(cartesian);
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromRadians(cg.longitude, cg.latitude, 2500000),
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-35),
            roll: 0
          },
          duration: 2.0
        });
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

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

  // Right-click context menu on globe
  handler.setInputAction(click => {
    const picked = viewer.scene.pick(click.position);
    const cartesian = clickedCartesian(click.position, picked);
    const entity = (Cesium.defined(picked) && picked.id) ? picked.id : null;

    let lat = null, lng = null;
    if (cartesian) {
      const cg = Cesium.Cartographic.fromCartesian(cartesian);
      lat = Cesium.Math.toDegrees(cg.latitude);
      lng = Cesium.Math.toDegrees(cg.longitude);
    }

    showGlobeContextMenu(click.position.x, click.position.y, entity, lat, lng);
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  window.addEventListener("resize", () => {
    viewer.resize();
    if (window.innerWidth > 980) setMobileDrawer(null);
    ensureMobilePanelVisibility();
    sanitizePanelPositions();
    updateSummaryHint();
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
    if (event.key.toLowerCase() === "h") { navFlyHome(); return; }
    if (event.key.toLowerCase() === "j") { focusNextHotspot(); return; }
    if (event.key === "+" || event.key === "=") { document.getElementById("nav-zoom-in")?.click(); return; }
    if (event.key === "-" || event.key === "_") { document.getElementById("nav-zoom-out")?.click(); return; }
    if (event.key === "?")               { toggleKeyboardShortcuts(); return; }
    if (event.key === "S" && event.shiftKey) { captureGlobeScreenshot(); showToast("Screenshot captured", "info"); return; }
    if (event.key.toLowerCase() === "s" && !event.shiftKey) { elements.btnSpin?.click(); return; }
    if (event.key.toLowerCase() === "g") { toggleFullscreen(); return; }
    if (event.key.toLowerCase() === "t") { toggleDarkTheme(); return; }
    if (event.key.toLowerCase() === "w") { toggleGlobeGrid(); return; }
    if (event.key.toLowerCase() === "m") { toggleAudioMute(); return; }
    if (event.key.toLowerCase() === "c") { toggleCinemaMode(); return; }
    if (event.key === " ")               { event.preventDefault(); toggleAutoRotatePause(); return; }
    if (event.key === "Escape")          { closeIntelSheet(); elements.searchResults.classList.add("hidden"); closeNewsPanel(); document.getElementById("shortcuts-overlay")?.classList.add("hidden"); }
  });
  document.addEventListener("keyup", event => { state._shiftHeld = event.shiftKey; });

  // ── Konami Code Easter Egg ────────────────────────────────────
  const KONAMI = ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","b","a"];
  let _konamiIdx = 0;
  document.addEventListener("keydown", e => {
    if (e.key === KONAMI[_konamiIdx]) {
      _konamiIdx++;
      if (_konamiIdx === KONAMI.length) {
        _konamiIdx = 0;
        showToast("🎮 GOD MODE ACTIVATED", "info");
        document.body.style.filter = "hue-rotate(180deg)";
        setTimeout(() => { document.body.style.filter = ""; }, 5000);
        // Fly to a dramatic random location
        pausePassiveSpin(10000);
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            -73.935, 40.730, 500 // NYC low flyover
          ),
          orientation: { heading: Cesium.Math.toRadians(45), pitch: Cesium.Math.toRadians(-15), roll: 0 },
          duration: 3.0
        });
      }
    } else {
      _konamiIdx = 0;
    }
  });

  // ── Globe navigation toolbar ──────────────────────────────────
  const navZoomIn    = document.getElementById("nav-zoom-in");
  const navZoomOut   = document.getElementById("nav-zoom-out");
  const navNorth     = document.getElementById("nav-north");
  const navTiltUp    = document.getElementById("nav-tilt-up");
  const navTiltDown  = document.getElementById("nav-tilt-down");
  const navFlyHomeBtn  = document.getElementById("nav-fly-home");
  const navFlyRandom   = document.getElementById("nav-fly-random");

  navZoomIn?.addEventListener("click", () => {
    const cg = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
    const newHeight = Math.max(cg.height * 0.5, 5000);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(cg.longitude, cg.latitude, newHeight),
      orientation: { heading: viewer.camera.heading, pitch: viewer.camera.pitch, roll: 0 },
      duration: 0.6
    });
    pausePassiveSpin(4000);
  });

  navZoomOut?.addEventListener("click", () => {
    const cg = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
    const newHeight = Math.min(cg.height * 2.0, 40000000);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(cg.longitude, cg.latitude, newHeight),
      orientation: { heading: viewer.camera.heading, pitch: viewer.camera.pitch, roll: 0 },
      duration: 0.6
    });
    pausePassiveSpin(4000);
  });

  navNorth?.addEventListener("click", () => {
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: { heading: 0, pitch: viewer.camera.pitch, roll: 0 },
      duration: 0.5
    });
  });

  navTiltUp?.addEventListener("click", () => {
    const newPitch = Math.min(viewer.camera.pitch + Cesium.Math.toRadians(15), Cesium.Math.toRadians(-5));
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: { heading: viewer.camera.heading, pitch: newPitch, roll: 0 },
      duration: 0.4
    });
  });

  navTiltDown?.addEventListener("click", () => {
    const newPitch = Math.max(viewer.camera.pitch - Cesium.Math.toRadians(15), Cesium.Math.toRadians(-90));
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: { heading: viewer.camera.heading, pitch: newPitch, roll: 0 },
      duration: 0.4
    });
  });

  navFlyHomeBtn?.addEventListener("click", navFlyHome);
  navFlyRandom?.addEventListener("click", focusNextHotspot);
}

function navFlyHome() {
  state.regionFocus = null;
  flyToDestination({
    lng: SCENARIO.initialView.lng,
    lat: SCENARIO.initialView.lat,
    height: SCENARIO.initialView.height,
    heading: SCENARIO.initialView.heading,
    pitch: SCENARIO.initialView.pitch,
    roll: SCENARIO.initialView.roll
  }, undefined, 1.8);
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

  // Background full-category refresh every 3 minutes so the event visual
  // label pool stays current even when the news panel is closed
  window.setInterval(() => {
    prefetchAllCategories();
  }, 180_000);

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
  if (window.innerWidth <= 980) setMobileDrawer(null);
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
  syncMobileActionButtons();
  if (typeof refreshPanelRestoreStrip === "function") refreshPanelRestoreStrip();
}

function closeNewsPanel() {
  if (!state.newsOpen) return;
  state.newsOpen = false;
  elements.newsBriefing?.classList.add("hidden");
  elements.newsToggleBtn?.classList.remove("active");
  stopNewsCategoryRotation();
  syncMobileActionButtons();
  if (typeof refreshPanelRestoreStrip === "function") refreshPanelRestoreStrip();
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
    card.tabIndex = 0;
    card.addEventListener("keydown", event => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = card.nextElementSibling;
        if (next instanceof HTMLElement) next.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prev = card.previousElementSibling;
        if (prev instanceof HTMLElement) prev.focus();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        card.click();
      }
    });
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

  const titleRow = document.createElement("div");
  titleRow.className = "news-card-title-row";

  const title = document.createElement("span");
  title.className = "news-card-title";

  const lang = article.language;
  const nonEng = isNonEnglish(lang);
  const cacheKey = nonEng ? `${lang}::${article.title}` : null;
  const cachedTranslation = cacheKey ? _translationCache.get(cacheKey) : undefined;

  if (nonEng) {
    const showingTranslated = cachedTranslation && cachedTranslation !== article.title && !article._cardShowOriginal;
    title.textContent = showingTranslated ? cachedTranslation : article.title;

    const langTag = document.createElement("button");
    langTag.type = "button";
    langTag.className = "card-lang-tag";
    const lname = langDisplayName(lang);
    if (article._cardShowOriginal || !showingTranslated) {
      langTag.textContent = lang.slice(0, 3).toUpperCase();
      langTag.title = cachedTranslation
        ? `Translated from ${lname} · click to show translation`
        : `Source language: ${lname}`;
      if (article._cardShowOriginal) langTag.classList.add("showing-original");
    } else {
      langTag.textContent = lang.slice(0, 3).toUpperCase();
      langTag.title = `Translated from ${lname} · click to show original`;
    }

    langTag.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      article._cardShowOriginal = !article._cardShowOriginal;
      if (article._cardShowOriginal) {
        title.textContent = article.title;
        langTag.textContent = "EN";
        langTag.title = `Show English translation (from ${lname})`;
        langTag.classList.add("showing-original");
      } else {
        const latest = _translationCache.get(cacheKey);
        title.textContent = (latest && latest !== article.title) ? latest : article.title;
        langTag.textContent = lang.slice(0, 3).toUpperCase();
        langTag.title = `Translated from ${lname} · click to show original`;
        langTag.classList.remove("showing-original");
      }
    };

    titleRow.appendChild(title);
    titleRow.appendChild(langTag);

    // Async translate if not already cached
    if (!cachedTranslation) {
      translateTitle(article.title, lang).then(translated => {
        if (translated && translated !== article.title && !article._cardShowOriginal) {
          title.textContent = translated;
          langTag.title = `Translated from ${lname} · click to show original`;
        }
      });
    }
  } else {
    title.textContent = article.title;
    titleRow.appendChild(title);
  }

  const time = document.createElement("div");
  time.className = "news-card-time";
  time.textContent = `${article.relativeTime}${article.country ? ` · ${article.country}` : ""}`;

  body.appendChild(meta);
  body.appendChild(titleRow);
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

  // Pre-translate non-English articles in background so they're ready when displayed
  preTranslatePool(state.newsTickerPool);
}

/** Fire-and-forget: translate up to 16 non-English titles ahead of time */
function preTranslatePool(pool) {
  let queued = 0;
  for (const item of pool) {
    if (queued >= 16) break;
    if (!item.language || !isNonEnglish(item.language)) continue;
    const cacheKey = `${item.language}::${item.title}`;
    if (_translationCache.has(cacheKey)) continue;
    queued++;
    // Stagger requests to avoid rate-limiting (200ms apart)
    setTimeout(() => translateTitle(item.title, item.language), queued * 200);
  }
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

  // Swipe left/right on ticker to cycle headlines manually
  let _tickerTouchStartX = 0;
  const tickerEl = elements.liveNewsHeadline;
  if (tickerEl) {
    tickerEl.addEventListener("touchstart", (e) => {
      _tickerTouchStartX = e.touches[0].clientX;
    }, { passive: true });
    tickerEl.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - _tickerTouchStartX;
      if (Math.abs(dx) < 40) return; // not a swipe
      if (!state.newsTickerPool.length) return;
      if (dx < 0) {
        // Swipe left → next
        state.newsTickerIndex = (state.newsTickerIndex + 1) % state.newsTickerPool.length;
      } else {
        // Swipe right → previous
        state.newsTickerIndex = (state.newsTickerIndex - 1 + state.newsTickerPool.length) % state.newsTickerPool.length;
      }
      renderNewsTickerHeadline(true);
      if (navigator.vibrate) navigator.vibrate(15);
    }, { passive: true });
  }
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

/* ══════════════════════════════════════════════════════════════════════════
   TRANSLATION LAYER  (MyMemory free tier — no key required)
   ══════════════════════════════════════════════════════════════════════════ */
const _translationCache = new Map(); // key: `${langCode}::${text}` → translated string

// GDELT returns full language names; MyMemory expects ISO 639-1 codes
const _LANG_TO_ISO = {
  "arabic": "ar", "chinese": "zh", "dutch": "nl", "french": "fr",
  "german": "de", "greek": "el", "hebrew": "he", "hindi": "hi",
  "hungarian": "hu", "indonesian": "id", "italian": "it", "japanese": "ja",
  "korean": "ko", "malay": "ms", "marathi": "mr", "norwegian": "no",
  "persian": "fa", "polish": "pl", "portuguese": "pt", "romanian": "ro",
  "russian": "ru", "serbian": "sr", "spanish": "es", "swedish": "sv",
  "tamil": "ta", "telugu": "te", "thai": "th", "turkish": "tr",
  "ukrainian": "uk", "urdu": "ur", "vietnamese": "vi", "bengali": "bn",
  "czech": "cs", "danish": "da", "finnish": "fi", "bulgarian": "bg",
  "catalan": "ca", "croatian": "hr", "slovak": "sk", "slovenian": "sl",
  "swahili": "sw", "tagalog": "tl", "afrikaans": "af", "albanian": "sq",
  "amharic": "am", "azerbaijani": "az", "basque": "eu", "belarusian": "be",
  "bosnian": "bs", "burmese": "my", "estonian": "et", "georgian": "ka",
  "gujarati": "gu", "hausa": "ha", "icelandic": "is", "kannada": "kn",
  "kazakh": "kk", "khmer": "km", "latvian": "lv", "lithuanian": "lt",
  "macedonian": "mk", "malayalam": "ml", "mongolian": "mn", "nepali": "ne",
  "pashto": "ps", "punjabi": "pa", "sinhala": "si", "somali": "so",
  "uzbek": "uz", "yoruba": "yo", "zulu": "zu"
};

function langToIso(code) {
  if (!code) return code;
  // If already a 2-3 letter code, return as-is
  if (code.length <= 3) return code.toLowerCase();
  // Try lookup by full name
  const iso = _LANG_TO_ISO[code.toLowerCase()];
  return iso || code.toLowerCase();
}

let _langNames;
try {
  _langNames = new Intl.DisplayNames(["en"], { type: "language" });
} catch (_) {
  _langNames = null;
}

function langDisplayName(code) {
  if (!code) return code;
  try {
    const name = _langNames?.of(code);
    if (name && name !== code) return name;
  } catch (_) { /* ignore */ }
  // fallback: capitalize the code
  return code.toUpperCase();
}

function isNonEnglish(langCode) {
  if (!langCode) return false;
  const lc = langCode.toLowerCase();
  return lc !== "en" && lc !== "eng" && lc !== "english";
}

/**
 * Translate a single title via Google Translate (free, no key).
 * Returns the translated string, or the original if translation fails/matches.
 * Results are cached in-memory.
 */
async function translateTitle(text, fromLang) {
  if (!text || !fromLang || !isNonEnglish(fromLang)) return text;
  const cacheKey = `${fromLang}::${text}`;
  if (_translationCache.has(cacheKey)) return _translationCache.get(cacheKey);

  const isoCode = langToIso(fromLang);
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(isoCode)}&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const signal = AbortSignal.timeout ? AbortSignal.timeout(7000) : undefined;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Response is nested array: [[["translated","original",...],...],...]
    const translated = data?.[0]?.map(s => s[0]).join("");
    if (translated && translated !== text) {
      _translationCache.set(cacheKey, translated);
      return translated;
    }
  } catch (_) { /* silently fall back */ }
  _translationCache.set(cacheKey, text); // cache original to avoid re-fetching
  return text;
}

function renderNewsTickerHeadline(animate = false) {
  const el = elements.liveNewsHeadline;
  const langBtn = document.getElementById("ticker-lang-btn");
  if (!el) return;

  if (!state.newsTickerPool.length) {
    el.href = "https://www.gdeltproject.org";
    el.textContent = "◉ Initializing signal feed…";
    if (langBtn) langBtn.hidden = true;
    return;
  }

  const item = state.newsTickerPool[state.newsTickerIndex] ?? state.newsTickerPool[0];
  el.href = item.url;

  const lang = item.language;
  const nonEng = isNonEnglish(lang);

  if (nonEng) {
    const cacheKey = `${lang}::${item.title}`;
    const cached = _translationCache.get(cacheKey);

    if (cached !== undefined && cached !== item.title) {
      // We have a translation ready
      const showOrig = item._tickerShowOriginal;
      el.textContent = `◉ ${showOrig ? item.title : cached}`;

      if (langBtn) {
        langBtn.hidden = false;
        const lname = langDisplayName(lang);
        if (showOrig) {
          langBtn.textContent = "EN";
          langBtn.title = "Show English translation";
          langBtn.classList.add("showing-original");
        } else {
          langBtn.textContent = lang.slice(0, 3).toUpperCase();
          langBtn.title = `Translated from ${lname} · click to show original`;
          langBtn.classList.remove("showing-original");
        }
        langBtn.onclick = () => {
          item._tickerShowOriginal = !item._tickerShowOriginal;
          renderNewsTickerHeadline(false);
        };
      }
    } else {
      // No translation yet — show original while we fetch
      el.textContent = `◉ ${item.title}`;
      if (langBtn) langBtn.hidden = true;
      translateTitle(item.title, lang).then(translated => {
        if (translated && translated !== item.title) {
          // Re-render only if this is still the current item
          const cur = state.newsTickerPool[state.newsTickerIndex] ?? state.newsTickerPool[0];
          if (cur?.url === item.url && !item._tickerShowOriginal) {
            renderNewsTickerHeadline(false);
          }
        }
      });
    }
  } else {
    el.textContent = `◉ ${item.title}`;
    if (langBtn) langBtn.hidden = true;
  }

  // Append country badge if available
  if (item.country) {
    const tag = document.createElement("span");
    tag.className = "ticker-country-tag";
    tag.textContent = item.country.toUpperCase();
    el.appendChild(tag);
  }

  if (animate) {
    el.classList.remove("updating");
    void el.offsetWidth;
    el.classList.add("updating");
  }

  // Update the news count badge in the footer
  const newsCountEl = document.getElementById("hud-news-count");
  if (newsCountEl) {
    const n = state.newsTickerPool.length;
    newsCountEl.textContent = n > 0 ? `${n} news` : "— news";
    newsCountEl.classList.toggle("has-news", n > 0);
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
    return;
  }
  elements.newsBadge.classList.add("hidden");
}

function hideBadge() {
  if (!elements.newsBadge) return;
  elements.newsBadge.classList.add("hidden");
}

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

/* ═══════════════════════════════════════════════════════════════════════════
   ENHANCED LIVE DYNAMICS
   ═══════════════════════════════════════════════════════════════════════════ */

// Animated number counter
function animateCountTo(el, from, to, duration) {
  if (!el) return;
  const start = performance.now();
  el.classList.add("updating");
  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = String(to);
      el.classList.remove("updating");
    }
  }
  requestAnimationFrame(tick);
}

function updateSparkline(key, value) {
  if (!sparklineData[key]) return;
  sparklineData[key].push(value);
  if (sparklineData[key].length > SPARKLINE_MAX_POINTS) sparklineData[key].shift();
  renderSparkline(key);
}

function renderSparkline(key) {
  const container = document.querySelector(`[data-sparkline="${key}"]`);
  if (!container) return;
  const data = sparklineData[key];
  if (data.length < 2) return;
  const max = Math.max(...data, 1);
  container.innerHTML = data.map(v => {
    const h = Math.max(2, (v / max) * 18);
    return `<span class="spark-bar" style="height:${h}px"></span>`;
  }).join("");
}

// Threat level system
function updateThreatLevel() {
  if (!elements.threatSegments) return;
  const segs = elements.threatSegments.querySelectorAll(".threat-seg");
  const activeIncidentCount = dynamic.incidents.filter(({ entity }) => entity.show).length;
  const activeZoneCount = dynamic.zones.filter(({ entity }) => entity.show).length;
  const burstCount = dynamic.eventVisuals.length;
  const level = Math.min(10, Math.max(1, Math.round(activeIncidentCount * 1.6 + activeZoneCount * 0.7 + burstCount * 0.08)));
  const prevLevel = state._prevThreatLevel ?? 0;

  segs.forEach((seg, i) => {
    seg.classList.remove("active", "low", "med", "high", "crit");
    if (i < level) {
      seg.classList.add("active");
      if (i < 3) seg.classList.add("low");
      else if (i < 6) seg.classList.add("med");
      else if (i < 8) seg.classList.add("high");
      else seg.classList.add("crit");
    }
  });
  // Alert sound when threat crosses into critical (level 8+)
  if (level >= 8 && prevLevel < 8) sfx.alert();
  state._prevThreatLevel = level;
  if (elements.threatValue) {
    elements.threatValue.textContent = String(level);
    elements.threatValue.style.color =
      level <= 3 ? "var(--threat-low)" :
      level <= 6 ? "var(--threat-med)" :
      level <= 8 ? "var(--threat-high)" : "var(--threat-crit)";
  }
  // Update threat ring SVG
  const ringFill = document.getElementById("threat-ring-fill");
  if (ringFill) {
    const circumference = 75.4; // 2 * PI * 12
    const offset = circumference * (1 - level / 10);
    ringFill.style.strokeDashoffset = offset;
  }
}

// Data throughput simulation
function updateThroughput() {
  if (!elements.throughputBars || !elements.throughputValue) return;
  // Simulate data flow based on active feeds
  const feedCount = [state.liveFeeds.adsb, state.liveFeeds.ais].filter(f => f.status === "live").length;
  const base = feedCount * 1200 + Math.random() * 800;
  _throughputBytes = Math.max(0, Math.round(base + Math.random() * 400 - 200));
  const bars = elements.throughputBars.querySelectorAll(".throughput-bar");
  bars.forEach(bar => {
    bar.style.height = `${Math.round(3 + Math.random() * 11)}px`;
  });
  const formatted = _throughputBytes > 1024
    ? `${(_throughputBytes / 1024).toFixed(1)} KB/s`
    : `${_throughputBytes} B/s`;
  elements.throughputValue.textContent = formatted;
}

// Signal status indicators
function updateSignalIndicators() {
  if (!elements.sigAdsb) return;
  const setSignal = (el, status) => {
    el.classList.remove("green", "amber", "red");
    el.classList.add(status === "live" ? "green" : status === "error" ? "red" : "amber");
  };
  setSignal(elements.sigAdsb, state.liveFeeds.adsb.status);
  setSignal(elements.sigNews, state.newsLastFetched || state.newsArticles.length ? "live" : "pending");
  setSignal(elements.sigAis, state.liveFeeds.ais.status);
}

// Master ambient update loop for all dynamic indicators
function startAmbientUpdates() {
  if (_ambientUpdateTimer) clearInterval(_ambientUpdateTimer);
  if (threatUpdateTimer) clearInterval(threatUpdateTimer);
  // Fast updates (every 2s) for throughput/signal
  _ambientUpdateTimer = setInterval(() => {
    updateThroughput();
    updateSignalIndicators();
  }, 2000);
  // Slower threat update every 8s
  threatUpdateTimer = setInterval(updateThreatLevelEnhanced, 8000);
  startEventVisualLifecycle();
  // Initial run
  updateThroughput();
  updateSignalIndicators();
  updateThreatLevelEnhanced();
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTIPLAYER PRESENCE LAYER
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, Cesium.Entity>} */
const presenceEntities = new Map();

function initPresenceLayer() {
  // Restore saved operator name or generate one
  let operatorName;
  try { operatorName = localStorage.getItem("panopticon-earth-operator-name"); } catch { /* */ }
  if (!operatorName) {
    operatorName = `Operator-${Math.floor(Math.random() * 9000 + 1000)}`;
    try { localStorage.setItem("panopticon-earth-operator-name", operatorName); } catch { /* */ }
  }

  initPresence(viewer);
  setPresenceName(operatorName);

  // Render peer entities whenever the peer list changes
  onPeersChanged(renderPresencePeers);

  // Update the presence status indicator every 3 seconds
  setInterval(updatePresenceIndicator, 3000);
  updatePresenceIndicator();
}

function renderPresencePeers(peers) {
  // Remove entities for peers that left
  for (const [id, entity] of presenceEntities) {
    if (!peers.has(id)) {
      viewer.entities.remove(entity);
      presenceEntities.delete(id);
    }
  }

  // Update or create entities for current peers
  for (const [id, peer] of peers) {
    let entity = presenceEntities.get(id);
    const position = Cesium.Cartesian3.fromDegrees(peer.lng, peer.lat, Math.min(peer.alt * 0.5, 600000));

    if (entity) {
      entity.position = position;
      if (entity.label) entity.label.text = peer.name;
    } else {
      entity = viewer.entities.add({
        id: `presence-${id}`,
        position,
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString(peer.color).withAlpha(0.9),
          outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: peer.name,
          font: '12px "Share Tech Mono"',
          fillColor: Cesium.Color.fromCssColorString(peer.color),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("rgba(4,10,18,0.82)"),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          pixelOffset: new Cesium.Cartesian2(14, -4),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scale: 0.8
        },
        properties: {
          layerId: "presence",
          entityType: "presence-peer",
          label: peer.name,
          description: `Remote operator: ${peer.name}`
        }
      });
      presenceEntities.set(id, entity);
    }
  }
}

function updatePresenceIndicator() {
  const el = document.getElementById("presence-indicator");
  if (!el) return;
  const connected = isPresenceConnected();
  const peerCount = getPresencePeers().size;
  const online = navigator.onLine;
  el.classList.toggle("connected", connected && online);
  el.classList.toggle("offline", !online);
  if (!online) {
    el.textContent = "NET COMMS: OFFLINE";
  } else {
    el.textContent = connected
      ? `NET COMMS: ${peerCount + 1} ACTIVE`
      : "NET COMMS: STANDBY";
  }
}

// Listen for online/offline events
window.addEventListener("online", () => {
  showToast("Network connection restored", "info");
  updatePresenceIndicator();
});
window.addEventListener("offline", () => {
  showToast("Network connection lost", "info");
  updatePresenceIndicator();
});

// ─────────────────────────────────────────────────────────────────────────────
// IDLE AUTO-ROTATE — Globe slowly spins after 60 s of no interaction
// ─────────────────────────────────────────────────────────────────────────────
let _idleTimer = null;
let _idleSpinning = false;
const IDLE_TIMEOUT_MS = 60000;
let _idleBadgeEl = null;

function resetIdleTimer() {
  if (_idleSpinning) stopIdleSpin();
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(startIdleSpin, IDLE_TIMEOUT_MS);
}

function startIdleSpin() {
  if (state.spinning || state.trackedEntity || _autoRotatePaused) return; // manual spin, tracking, or paused
  _idleSpinning = true;
  state.spinning = true;
  elements.btnSpin?.classList.add("active");
  if (!_idleBadgeEl) {
    _idleBadgeEl = document.createElement("div");
    _idleBadgeEl.className = "idle-spin-badge";
    _idleBadgeEl.textContent = "IDLE — AUTO-ROTATE";
    document.body.appendChild(_idleBadgeEl);
  }
  requestAnimationFrame(() => _idleBadgeEl.classList.add("visible"));
  setTimeout(() => _idleBadgeEl?.classList.remove("visible"), 3000);
}

function stopIdleSpin() {
  if (!_idleSpinning) return;
  _idleSpinning = false;
  state.spinning = false;
  elements.btnSpin?.classList.remove("active");
  _idleBadgeEl?.classList.remove("visible");
}

function initIdleAutoRotate() {
  const events = ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"];
  events.forEach(evt => document.addEventListener(evt, resetIdleTimer, { passive: true }));
  resetIdleTimer();
}

let _autoRotatePaused = false;
function toggleAutoRotatePause() {
  _autoRotatePaused = !_autoRotatePaused;
  if (_autoRotatePaused) {
    // Stop any current auto-rotation
    if (_passiveSpinListener) {
      viewer?.clock?.onTick?.removeEventListener(_passiveSpinListener);
      _passiveSpinListener = null;
    }
    showEventToast("Auto-rotate paused", "SYSTEM");
  } else {
    resetIdleTimer();
    showEventToast("Auto-rotate resumed", "SYSTEM");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FULLSCREEN TOGGLE — Enter/exit fullscreen with G key
// ─────────────────────────────────────────────────────────────────────────────
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
    showEventToast("Fullscreen ON", "SYSTEM");
  } else {
    document.exitFullscreen?.();
    showEventToast("Fullscreen OFF", "SYSTEM");
  }
}

function toggleCinemaMode() {
  document.body.classList.toggle("cinema-mode");
  const on = document.body.classList.contains("cinema-mode");
  showToast(on ? "Cinema mode ON" : "Cinema mode OFF", "info");
}

// ─────────────────────────────────────────────────────────────────────────────
// DARK THEME TOGGLE — cycle between default and ultra-dark
// ─────────────────────────────────────────────────────────────────────────────
let _ultraDark = false;
function toggleDarkTheme() {
  _ultraDark = !_ultraDark;
  document.body.classList.toggle("ultra-dark", _ultraDark);
  showEventToast(_ultraDark ? "Ultra-dark mode ON" : "Normal theme", "SYSTEM");
}

// Auto-detect system dark preference
if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
  _ultraDark = true;
  document.body.classList.add("ultra-dark");
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD SHORTCUTS OVERLAY — Toggle with ?
// ─────────────────────────────────────────────────────────────────────────────
let _kbdOverlay = null;

function toggleKeyboardShortcuts() {
  const overlay = document.getElementById("shortcuts-overlay");
  if (!overlay) return;
  overlay.classList.toggle("hidden");
  // Wire close button once
  if (!overlay._wired) {
    overlay._wired = true;
    document.getElementById("shortcuts-close")?.addEventListener("click", () => overlay.classList.add("hidden"));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PINCH-TO-ZOOM HINT — Shows once on mobile touch devices
// ─────────────────────────────────────────────────────────────────────────────
function showPinchHint() {
  const HINT_KEY = "panopticon-earth-pinch-hint-seen";
  try { if (localStorage.getItem(HINT_KEY)) return; } catch { /* */ }
  if (!("ontouchstart" in window)) return;
  const hint = document.createElement("div");
  hint.className = "pinch-hint";
  hint.innerHTML = `
    <span class="pinch-hint-icon">👆👆</span>
    <span>Pinch to zoom · Drag to rotate</span>
  `;
  document.body.appendChild(hint);
  try { localStorage.setItem(HINT_KEY, "1"); } catch { /* */ }
  setTimeout(() => hint.remove(), 5000);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT COUNT CHIP — Pulse when events are active
// ─────────────────────────────────────────────────────────────────────────────
const _origUpdateEventCount = updateEventCount;
// Wrap existing updateEventCount to add .has-events class
(function patchEventCountChip() {
  const original = updateEventCount;
  // Already monkey-patched above; override directly
})();

function updateEventCountChip() {
  const el = document.getElementById("hud-event-count");
  if (!el) return;
  const n = dynamic.eventVisuals.length;
  el.textContent = n > 0 ? `${n} events` : "— events";
  el.classList.toggle("has-events", n > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPROVED THREAT LEVEL — Factor in live news pool size + geo events
// ─────────────────────────────────────────────────────────────────────────────
function updateThreatLevelEnhanced() {
  if (!elements.threatSegments) return;
  const segs = elements.threatSegments.querySelectorAll(".threat-seg");
  const activeIncidentCount = dynamic.incidents.filter(({ entity }) => entity.show).length;
  const activeZoneCount = dynamic.zones.filter(({ entity }) => entity.show).length;
  const burstCount = dynamic.eventVisuals.length;
  const newsPoolSize = state.newsTickerPool?.length ?? 0;
  const geoEventCount = dynamic.eventVisuals.filter(v => v.geoSpawned).length;

  // Weighted formula: incidents are critical, news volume raises awareness, geo events add intensity
  const level = Math.min(10, Math.max(1, Math.round(
    activeIncidentCount * 1.6 +
    activeZoneCount * 0.7 +
    burstCount * 0.12 +
    newsPoolSize * 0.08 +
    geoEventCount * 0.15
  )));
  const prevLevel = state._prevThreatLevel ?? 0;

  segs.forEach((seg, i) => {
    seg.classList.remove("active", "low", "med", "high", "crit");
    if (i < level) {
      seg.classList.add("active");
      if (i < 3) seg.classList.add("low");
      else if (i < 6) seg.classList.add("med");
      else if (i < 8) seg.classList.add("high");
      else seg.classList.add("crit");
    }
  });
  if (level >= 8 && prevLevel < 8) {
    sfx.alert();
    // Text-to-speech announcement for critical threat
    if (window.speechSynthesis && isAudioEnabled()) {
      const msg = new SpeechSynthesisUtterance(`Warning. Threat level elevated to ${level}. Critical alert.`);
      msg.rate = 0.9;
      msg.pitch = 0.8;
      msg.volume = 0.6;
      window.speechSynthesis.speak(msg);
    }
  }
  state._prevThreatLevel = level;
  if (elements.threatValue) {
    elements.threatValue.textContent = String(level);
    elements.threatValue.style.color =
      level <= 3 ? "var(--threat-low)" :
      level <= 6 ? "var(--threat-med)" :
      level <= 8 ? "var(--threat-high)" : "var(--threat-crit)";
  }
  // Tint the classification bar based on threat level
  const classBar = document.getElementById("classification-bar");
  if (classBar) {
    classBar.classList.remove("threat-elevated", "threat-critical");
    if (level >= 8) classBar.classList.add("threat-critical");
    else if (level >= 6) classBar.classList.add("threat-elevated");
  }
  document.body.classList.toggle("threat-critical-glow", level >= 8);

  // Camera shake on new critical threshold
  const wasCritical = state._lastThreatCritical || false;
  const isCritical = level >= 8;
  if (isCritical && !wasCritical) {
    document.body.classList.add("camera-shake");
    setTimeout(() => document.body.classList.remove("camera-shake"), 600);
  }
  state._lastThreatCritical = isCritical;

  // Tint atmosphere based on threat level
  if (viewer.scene.globe.enableLighting !== undefined) {
    const atmo = viewer.scene.atmosphere;
    if (atmo) {
      if (level >= 8) {
        atmo.hueShift = -0.05; // slight red tint
        atmo.saturationShift = 0.1;
      } else if (level >= 6) {
        atmo.hueShift = -0.02;
        atmo.saturationShift = 0.05;
      } else {
        atmo.hueShift = 0;
        atmo.saturationShift = 0;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE UTC CLOCK — updates every second in the footer
// ─────────────────────────────────────────────────────────────────────────────
function initUtcClock() {
  const el = document.getElementById("live-utc-clock");
  if (!el) return;

  const ZONES = [
    { label: "UTC",    tz: "UTC" },
    { label: "EST",    tz: "America/New_York" },
    { label: "PST",    tz: "America/Los_Angeles" },
    { label: "CET",    tz: "Europe/Paris" },
    { label: "MSK",    tz: "Europe/Moscow" },
    { label: "JST",    tz: "Asia/Tokyo" },
    { label: "CST",    tz: "Asia/Shanghai" },
    { label: "IST",    tz: "Asia/Kolkata" },
    { label: "AEST",   tz: "Australia/Sydney" },
  ];
  let zoneIdx = 0;

  function tick() {
    const now = new Date();
    const zone = ZONES[zoneIdx];
    try {
      const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: zone.tz,
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false
      });
      el.textContent = `${fmt.format(now)} ${zone.label}`;
    } catch {
      const h = String(now.getUTCHours()).padStart(2, "0");
      const m = String(now.getUTCMinutes()).padStart(2, "0");
      const s = String(now.getUTCSeconds()).padStart(2, "0");
      el.textContent = `${h}:${m}:${s} UTC`;
    }
  }
  tick();
  setInterval(tick, 1000);

  // Click to cycle through time zones
  el.style.cursor = "pointer";
  el.title = "Click to cycle time zones";
  el.addEventListener("click", () => {
    zoneIdx = (zoneIdx + 1) % ZONES.length;
    tick();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// REGION ACTIVITY HALOS — colored circles around high-activity regions
// ─────────────────────────────────────────────────────────────────────────────
const _regionHalos = [];

function updateRegionHalos() {
  // Remove old halos
  for (const h of _regionHalos) viewer.entities.remove(h);
  _regionHalos.length = 0;

  // Group events by rough region (10° grid cells)
  const grid = new Map();
  for (const ev of dynamic.eventVisuals) {
    if (ev.lng == null || ev.lat == null) continue;
    const key = `${Math.round(ev.lat / 10) * 10},${Math.round(ev.lng / 10) * 10}`;
    if (!grid.has(key)) grid.set(key, { lat: 0, lng: 0, count: 0 });
    const cell = grid.get(key);
    cell.lat += ev.lat;
    cell.lng += ev.lng;
    cell.count++;
  }

  for (const [, cell] of grid) {
    if (cell.count < 2) continue;
    const avgLat = cell.lat / cell.count;
    const avgLng = cell.lng / cell.count;
    const intensity = Math.min(cell.count / 5, 1);
    const radius = 300000 + intensity * 500000;
    const color = intensity > 0.6
      ? Cesium.Color.fromCssColorString("#ff3366").withAlpha(0.08 + intensity * 0.06)
      : Cesium.Color.fromCssColorString("#f59e0b").withAlpha(0.06 + intensity * 0.04);

    const halo = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(avgLng, avgLat),
      ellipse: {
        semiMinorAxis: radius,
        semiMajorAxis: radius,
        height: 200,
        material: color,
        outline: true,
        outlineColor: color.withAlpha(color.alpha * 2),
        outlineWidth: 1
      },
      properties: {
        layerId: "incidents",
        entityType: "region-halo",
        label: `Activity cluster (${cell.count} events)`,
        description: `Region hotspot: ${cell.count} active events`
      }
    });
    _regionHalos.push(halo);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATED THROUGHPUT BARS — make them bounce based on actual throughput
// ─────────────────────────────────────────────────────────────────────────────
function animateThroughputBars() {
  const bars = document.querySelectorAll("#throughput-bars .throughput-bar");
  if (!bars.length) return;
  const throughput = _throughputBytes || 0;
  const normalized = Math.min(throughput / 2000, 1); // normalize to 0-1 range

  bars.forEach((bar, i) => {
    const base = 3 + Math.random() * 4;
    const boost = normalized * (6 + Math.random() * 6);
    bar.style.height = `${Math.round(base + boost)}px`;
    bar.style.transition = "height 0.4s ease";
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC TOAST — brief UI feedback messages
// ─────────────────────────────────────────────────────────────────────────────
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `event-toast toast-${type}`;
  const icon = type === "warning" ? "⚠" : "ℹ";
  toast.innerHTML = `<span class="toast-icon">${icon}</span> <span class="toast-text">${escapeHtml(message)}</span>`;
  toast.style.top = "60px";
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast-enter"));
  setTimeout(() => {
    toast.classList.remove("toast-enter");
    toast.classList.add("toast-exit");
    setTimeout(() => toast.remove(), 400);
  }, 2500);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT TOAST NOTIFICATIONS — slide-in toasts when new events spawn
// ─────────────────────────────────────────────────────────────────────────────
const _toastQueue = [];

function showEventToast(title, country) {
  _toastQueue.push({ title, country });
  processToastQueue();
}

let _activeToasts = [];
const MAX_TOASTS = 3;

function processToastQueue() {
  if (!_toastQueue.length) return;
  if (_activeToasts.length >= MAX_TOASTS) return; // wait for a slot

  const { title, country } = _toastQueue.shift();

  const toast = document.createElement("div");
  toast.className = "event-toast";
  const countryTag = country ? `<span class="toast-country">${country.toUpperCase()}</span>` : "";
  toast.innerHTML = `<span class="toast-icon">⚡</span> <span class="toast-text">${escapeHtml(title.slice(0, 60))}${title.length > 60 ? "…" : ""}</span>${countryTag}`;
  document.body.appendChild(toast);

  // Stack offset
  const idx = _activeToasts.length;
  toast.style.top = `${60 + idx * 56}px`;
  _activeToasts.push(toast);

  requestAnimationFrame(() => toast.classList.add("toast-enter"));

  setTimeout(() => {
    toast.classList.remove("toast-enter");
    toast.classList.add("toast-exit");
    setTimeout(() => {
      toast.remove();
      _activeToasts = _activeToasts.filter(t => t !== toast);
      // Reposition remaining toasts
      _activeToasts.forEach((t, i) => { t.style.top = `${60 + i * 56}px`; });
      processToastQueue(); // process queued toasts
    }, 400);
  }, 3000);

  // Try to fill more slots
  if (_toastQueue.length && _activeToasts.length < MAX_TOASTS) {
    setTimeout(() => processToastQueue(), 200);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION STATS — track and display operational session metrics
// ─────────────────────────────────────────────────────────────────────────────

// Event history breadcrumb trail — connects the last N geo-spawned events
const _eventHistoryPositions = [];
const _EVENT_HISTORY_MAX = 20;
let _eventHistoryEntity = null;

function updateEventHistoryTrail(lng, lat) {
  _eventHistoryPositions.push(Cesium.Cartesian3.fromDegrees(lng, lat, 3000));
  if (_eventHistoryPositions.length > _EVENT_HISTORY_MAX) {
    _eventHistoryPositions.shift();
  }
  if (_eventHistoryPositions.length < 2) return;

  if (_eventHistoryEntity) {
    try { viewer.entities.remove(_eventHistoryEntity); } catch (e) {}
  }
  _eventHistoryEntity = viewer.entities.add({
    polyline: {
      positions: [..._eventHistoryPositions],
      width: 1.0,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString("#00e5ff").withAlpha(0.25),
        dashLength: 18,
        dashPattern: 0xFF00
      }),
      arcType: Cesium.ArcType.GEODESIC,
      clampToGround: false
    }
  });
}

function updateSessionStats(country) {
  state.sessionStats.eventsSpawned++;
  if (country) state.sessionStats.countriesSeen.add(country.toLowerCase());
}

function getSessionSummary() {
  const elapsed = Date.now() - state.sessionStats.sessionStart;
  const mins = Math.floor(elapsed / 60000);
  return {
    duration: mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`,
    eventsSpawned: state.sessionStats.eventsSpawned,
    countriesSeen: state.sessionStats.countriesSeen.size,
    articlesIngested: state.newsTickerPool?.length ?? 0
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCANLINE OVERLAY — subtle CRT-style scan lines for surveillance aesthetic
// ─────────────────────────────────────────────────────────────────────────────
function initScanlineOverlay() {
  if (document.getElementById("scanline-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "scanline-overlay";
  overlay.className = "scanline-overlay";
  document.body.appendChild(overlay);
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMERA POSITION INDICATOR — show current lat/lng/altitude in header
// ─────────────────────────────────────────────────────────────────────────────
function initCameraPositionHud() {
  const el = document.getElementById("camera-position-hud");
  const zoomEl = document.getElementById("hud-zoom-level");
  const reticle = document.getElementById("center-reticle");
  if (!el) return;

  let _lastCoords = "";

  function update() {
    const cam = viewer.camera.positionCartographic;
    if (!cam) return;
    const lat = Cesium.Math.toDegrees(cam.latitude).toFixed(1);
    const lng = Cesium.Math.toDegrees(cam.longitude).toFixed(1);
    const alt = cam.height;
    const altStr = alt > 1000000
      ? `${(alt / 1000000).toFixed(1)}M m`
      : alt > 1000
        ? `${(alt / 1000).toFixed(0)}K m`
        : `${Math.round(alt)} m`;
    _lastCoords = `${lat}, ${lng}`;
    el.textContent = `${lat}° ${lng}° · ${altStr}`;

    // Zoom level label
    if (zoomEl) {
      let level;
      if (alt > 12000000) level = "ORBITAL";
      else if (alt > 5000000) level = "GLOBAL";
      else if (alt > 2000000) level = "CONTINENTAL";
      else if (alt > 500000) level = "REGIONAL";
      else if (alt > 100000) level = "TACTICAL";
      else level = "GROUND";
      zoomEl.textContent = level;
    }

    // Hide reticle at far orbital distances
    if (reticle) {
      reticle.style.opacity = alt > 18000000 ? "0" : "";
    }
  }
  viewer.camera.changed.addEventListener(update);
  update();

  // Click to copy coordinates
  el.style.cursor = "pointer";
  el.title = "Click to copy coordinates";
  el.addEventListener("click", () => {
    if (!_lastCoords) return;
    navigator.clipboard?.writeText(_lastCoords).then(() => {
      showEventToast(`Copied: ${_lastCoords}`, "SYSTEM");
    }).catch(() => {});
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ARROW KEY CAMERA NUDGE — fine-tune camera position with arrow keys
// ─────────────────────────────────────────────────────────────────────────────
function initArrowKeyNudge() {
  window.addEventListener("keydown", event => {
    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

    const nudgeAmount = event.shiftKey ? 0.01 : 0.002;
    let heading = 0, pitch = 0;

    switch (event.key) {
      case "ArrowLeft":  heading = -nudgeAmount; break;
      case "ArrowRight": heading = nudgeAmount; break;
      case "ArrowUp":    pitch = nudgeAmount; break;
      case "ArrowDown":  pitch = -nudgeAmount; break;
      default: return;
    }

    event.preventDefault();
    pausePassiveSpin(5000);
    viewer.camera.rotateLeft(heading);
    viewer.camera.rotateUp(pitch);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTION RING — highlight the selected entity with a pulsing ring
// ─────────────────────────────────────────────────────────────────────────────
let _selectionRingEntity = null;
function showSelectionRing(entity) {
  hideSelectionRing();
  if (!entity?.position || !viewer) return;
  try {
    const pos = entity.position.getValue(viewer.clock.currentTime);
    if (!pos) return;
    const cg = Cesium.Cartographic.fromCartesian(pos);
    const lng = Cesium.Math.toDegrees(cg.longitude);
    const lat = Cesium.Math.toDegrees(cg.latitude);
    let step = 0;
    const ring = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat),
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => {
          return 50000 + Math.sin(step * 0.08) * 15000;
        }, false),
        semiMinorAxis: new Cesium.CallbackProperty(() => {
          return 50000 + Math.sin(step * 0.08) * 15000;
        }, false),
        material: Cesium.Color.CYAN.withAlpha(0.0),
        outline: true,
        outlineColor: new Cesium.CallbackProperty(() => {
          step++;
          const alpha = 0.3 + Math.sin(step * 0.06) * 0.15;
          return Cesium.Color.CYAN.withAlpha(alpha);
        }, false),
        outlineWidth: 2,
        height: 0,
      },
    });
    _selectionRingEntity = ring;
  } catch { /* */ }
}

function hideSelectionRing() {
  if (_selectionRingEntity && viewer) {
    try { viewer.entities.remove(_selectionRingEntity); } catch { /* */ }
    _selectionRingEntity = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBE CONTEXT MENU — Right-click actions on the globe
// ─────────────────────────────────────────────────────────────────────────────
let _ctxMenu = null;
function showGlobeContextMenu(x, y, entity, lat, lng) {
  hideGlobeContextMenu();
  const menu = document.createElement("div");
  menu.className = "globe-ctx-menu";
  const items = [];

  if (lat !== null && lng !== null) {
    items.push({ label: `📍 ${lat.toFixed(2)}°, ${lng.toFixed(2)}°`, disabled: true });
    items.push({ label: "🔎 Fly here", action: () => {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, 1500000),
        duration: 1.5
      });
    }});
    items.push({ label: "📋 Copy coordinates", action: () => {
      navigator.clipboard?.writeText(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      showEventToast("Coordinates copied", "SYSTEM");
    }});
  }

  if (entity) {
    const info = getEntityInfo(entity);
    if (info) {
      items.push({ label: `📊 Intel: ${info.label}`, action: () => openIntelSheet(entity) });
    }
    if (entity.position) {
      items.push({ label: "🎯 Track entity", action: () => {
        viewer.trackedEntity = entity;
        state.trackedEntity = entity;
      }});
    }
  }

  items.push({ label: "📸 Screenshot", action: () => captureGlobeScreenshot() });
  items.push({ label: "🏠 Fly home", action: () => navFlyHome() });

  items.forEach(item => {
    const el = document.createElement("div");
    el.className = "globe-ctx-item" + (item.disabled ? " disabled" : "");
    el.textContent = item.label;
    if (item.action) {
      el.addEventListener("click", () => { hideGlobeContextMenu(); item.action(); });
    }
    menu.appendChild(el);
  });

  // Position menu within viewport
  menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - items.length * 34 - 20)}px`;
  document.body.appendChild(menu);
  _ctxMenu = menu;

  // Close on next click anywhere
  setTimeout(() => {
    document.addEventListener("click", hideGlobeContextMenu, { once: true });
    document.addEventListener("contextmenu", function suppress(e) {
      if (_ctxMenu) { e.preventDefault(); hideGlobeContextMenu(); }
      document.removeEventListener("contextmenu", suppress);
    });
  }, 50);
}

function hideGlobeContextMenu() {
  if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBE SCREENSHOT — Captures the Cesium canvas + overlays
// ─────────────────────────────────────────────────────────────────────────────
function captureGlobeScreenshot() {
  if (!viewer) return;
  viewer.render(); // force a fresh frame
  const canvas = viewer.scene.canvas;
  try {
    const dataUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `gods-eye-${ts}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    console.warn("Screenshot failed (CORS?):", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOT: Wire up all enhancements
// ─────────────────────────────────────────────────────────────────────────────
initIdleAutoRotate();
showPinchHint();
initUtcClock();
initScanlineOverlay();
initCameraPositionHud();
initArrowKeyNudge();
initEventSparkline();
initFpsCounter();
initUptimeCounter();
initCompassRose();
initAmbientParticles();
setInterval(animateThroughputBars, 2000);

// Data age chip
setInterval(() => {
  const el = document.getElementById("hud-data-age");
  const sigEl = document.getElementById("hud-signal-strength");
  if (!el || !state._lastRefreshTime) return;
  const ago = Math.floor((Date.now() - state._lastRefreshTime) / 1000);
  if (ago < 60) el.textContent = `⏱ ${ago}s`;
  else el.textContent = `⏱ ${Math.floor(ago / 60)}m`;
  el.classList.toggle("stale", ago > 120);
  // Signal strength based on data freshness
  if (sigEl) {
    sigEl.classList.remove("sig-excellent", "sig-good", "sig-fair", "sig-poor");
    if (ago < 30) sigEl.classList.add("sig-excellent");
    else if (ago < 90) sigEl.classList.add("sig-good");
    else if (ago < 180) sigEl.classList.add("sig-fair");
    else sigEl.classList.add("sig-poor");
  }
}, 1000);
setInterval(updateRegionHalos, 15000);

// ─────────────────────────────────────────────────────────────────────────────
// EVENT SPARKLINE — tiny chart showing event frequency over last 5 minutes
// ─────────────────────────────────────────────────────────────────────────────
function initEventSparkline() {
  const canvas = document.getElementById("sparkline-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  // 30 buckets × 10s each = 5 minutes
  const buckets = new Array(30).fill(0);
  let bucketIdx = 0;

  // Track event spawns via the sessionStats counter
  let lastCount = state.sessionStats.eventsSpawned;

  setInterval(() => {
    const cur = state.sessionStats.eventsSpawned;
    buckets[bucketIdx % 30] = cur - lastCount;
    lastCount = cur;
    bucketIdx++;
    drawSparkline(ctx, canvas, buckets, bucketIdx);
  }, 10000);
}

function drawSparkline(ctx, canvas, buckets, idx) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const len = buckets.length;
  const max = Math.max(1, ...buckets);
  const barW = w / len;

  for (let i = 0; i < len; i++) {
    // Read from oldest to newest
    const bi = (idx + i) % len;
    const val = buckets[bi];
    const barH = (val / max) * (h - 2);
    const alpha = 0.3 + 0.7 * (i / len);
    ctx.fillStyle = val > 0
      ? `rgba(255, 77, 109, ${alpha})`
      : `rgba(126, 224, 255, ${alpha * 0.3})`;
    ctx.fillRect(i * barW, h - barH, barW - 1, barH);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FPS COUNTER — performance monitor in the HUD
// ─────────────────────────────────────────────────────────────────────────────
function initFpsCounter() {
  const fpsEl = document.getElementById("hud-fps");
  if (!fpsEl) return;
  let frames = 0;
  let lastTime = performance.now();

  function tick() {
    frames++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
      const fps = Math.round(frames * 1000 / (now - lastTime));
      fpsEl.textContent = `${fps} fps`;
      fpsEl.classList.toggle("fps-low", fps < 30);
      frames = 0;
      lastTime = now;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION UPTIME — live display of how long the dashboard has been running
// ─────────────────────────────────────────────────────────────────────────────
function initUptimeCounter() {
  const el = document.getElementById("session-uptime");
  if (!el) return;
  setInterval(() => {
    const elapsed = Date.now() - state.sessionStats.sessionStart;
    const secs = Math.floor(elapsed / 1000);
    const mins = Math.floor(secs / 60);
    const hrs  = Math.floor(mins / 60);
    if (hrs > 0) {
      el.textContent = `↑ ${hrs}h ${mins % 60}m`;
    } else if (mins > 0) {
      el.textContent = `↑ ${mins}m ${secs % 60}s`;
    } else {
      el.textContent = `↑ ${secs}s`;
    }
  }, 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBE GRID OVERLAY — toggleable lat/lon graticule
// ─────────────────────────────────────────────────────────────────────────────
let _gridLayer = null;
// ─────────────────────────────────────────────────────────────────────────────
// DISTANCE MEASUREMENT — Shift+click two points to measure great-circle distance
// ─────────────────────────────────────────────────────────────────────────────
let _measurePoint = null;
function handleMeasureClick(cartesian) {
  if (!cartesian) return;
  const cg = Cesium.Cartographic.fromCartesian(cartesian);
  const lat = Cesium.Math.toDegrees(cg.latitude);
  const lng = Cesium.Math.toDegrees(cg.longitude);

  if (!_measurePoint) {
    _measurePoint = { lat, lng, carto: cg };
    showToast(`📍 Point A: ${lat.toFixed(2)}°, ${lng.toFixed(2)}° — Shift+click another point`, "info");
  } else {
    const R = 6371; // km
    const dLat = cg.latitude - _measurePoint.carto.latitude;
    const dLng = cg.longitude - _measurePoint.carto.longitude;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(_measurePoint.carto.latitude) * Math.cos(cg.latitude) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = R * c;
    const distStr = dist > 1000 ? `${(dist / 1000).toFixed(1)}K km` : `${dist.toFixed(0)} km`;
    showToast(`📏 Distance: ${distStr} (${(dist * 0.539957).toFixed(0)} nmi)`, "info");
    _measurePoint = null;
  }
}

function toggleGlobeGrid() {
  if (_gridLayer) {
    viewer.imageryLayers.remove(_gridLayer);
    _gridLayer = null;
    showToast("Grid overlay OFF", "info");
  } else {
    _gridLayer = viewer.imageryLayers.addImageryProvider(
      new Cesium.GridImageryProvider()
    );
    _gridLayer.alpha = 0.15;
    showToast("Grid overlay ON", "info");
  }
}

function toggleAudioMute() {
  const enabled = isAudioEnabled();
  setAudioEnabled(!enabled);
  showToast(enabled ? "Audio muted 🔇" : "Audio enabled 🔊", "info");
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY PROXIMITY DETECTION — alert when two live events are within ~500 km
// ─────────────────────────────────────────────────────────────────────────────
const _proximityAlerted = new Set();

function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function checkEntityProximity() {
  const now = Cesium.JulianDate.now();
  const live = dynamic.eventVisuals.filter(v => v.lat != null && v.lng != null);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const key = `${i}|${j}`;
      if (_proximityAlerted.has(key)) continue;
      const dist = _haversineKm(a.lat, a.lng, b.lat, b.lng);
      if (dist < 500) {
        _proximityAlerted.add(key);
        setTimeout(() => _proximityAlerted.delete(key), 60000);
        showToast(`⚠ Proximity alert: ${dist.toFixed(0)} km between events`, "warning");
        // Spawn a brief yellow ring at midpoint
        try {
          const midLat = (a.lat + b.lat) / 2, midLng = (a.lng + b.lng) / 2;
          const now = Cesium.JulianDate.now();
          const pRing = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(midLng, midLat, 0),
            ellipse: {
              semiMajorAxis: new Cesium.CallbackProperty(t => {
                const age = Cesium.JulianDate.secondsDifference(t, now);
                return Math.max(10000, 400000 * (1 - age / 4));
              }, false),
              semiMinorAxis: new Cesium.CallbackProperty(t => {
                const age = Cesium.JulianDate.secondsDifference(t, now);
                return Math.max(10000, 400000 * (1 - age / 4));
              }, false),
              height: 0,
              material: Cesium.Color.YELLOW.withAlpha(0.0),
              outline: true,
              outlineColor: Cesium.Color.YELLOW.withAlpha(0.7),
              outlineWidth: 2
            }
          });
          setTimeout(() => { try { viewer.entities.remove(pRing); } catch(e){} }, 4000);
        } catch(e) {}
      }
    }
  }
}
setInterval(checkEntityProximity, 15000);

// ─────────────────────────────────────────────────────────────────────────────
// RADAR BLIP — spawn a blip on the mini radar when events arrive
// ─────────────────────────────────────────────────────────────────────────────
function spawnRadarBlip() {
  const radar = document.querySelector(".radar-mini");
  if (!radar) return;
  const blip = document.createElement("div");
  blip.className = "radar-blip";
  const angle = Math.random() * Math.PI * 2;
  const dist = 4 + Math.random() * 8;
  blip.style.left = `${14 + Math.cos(angle) * dist - 2}px`;
  blip.style.top  = `${14 + Math.sin(angle) * dist - 2}px`;
  radar.appendChild(blip);
  setTimeout(() => blip.remove(), 2000);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPASS ROSE — rotating compass that reflects camera heading
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// AMBIENT PARTICLES — floating motes for atmospheric depth
// ─────────────────────────────────────────────────────────────────────────────
function initAmbientParticles() {
  const canvas = document.getElementById("ambient-particles");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const PARTICLE_COUNT = 35;
  const particles = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.3,
      dx: (Math.random() - 0.5) * 0.15,
      dy: (Math.random() - 0.5) * 0.1 - 0.05,
      alpha: Math.random() * 0.4 + 0.1,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.x += p.dx;
      p.y += p.dy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(126, 224, 255, ${p.alpha})`;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  draw();
}

function initCompassRose() {
  const rose = document.getElementById("compass-rose");
  if (!rose) return;
  const svg = rose.querySelector("svg");
  if (!svg) return;

  function updateHeading() {
    const heading = Cesium.Math.toDegrees(viewer.camera.heading);
    svg.style.transform = `rotate(${-heading}deg)`;
  }
  viewer.camera.changed.addEventListener(updateHeading);
  updateHeading();

  // Click to reset north
  rose.addEventListener("click", () => {
    pausePassiveSpin(5000);
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: {
        heading: 0,
        pitch: viewer.camera.pitch,
        roll: 0
      },
      duration: 0.8
    });
  });
}
