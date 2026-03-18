export const STORAGE_KEYS = {
  bookmarks: "panopticon-earth-bookmarks",
  layers: "panopticon-earth-layers",
  basemap: "panopticon-earth-basemap",
  fxMode: "panopticon-earth-fx-mode"
};

export const BASEMAPS = [
  {
    id: "satellite",
    label: "Satellite",
    type: "url",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    credit: "Esri World Imagery"
  },
  {
    id: "streets",
    label: "Streets",
    type: "osm",
    url: "https://tile.openstreetmap.org/",
    credit: "OpenStreetMap"
  },
  {
    id: "dark",
    label: "Dark",
    type: "url",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    credit: "Esri Dark Gray"
  },
  {
    id: "terrain",
    label: "Terrain",
    type: "url",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    credit: "Esri Topographic"
  }
];

export const FX_MODES = [
  { id: "normal", label: "Normal" },
  { id: "nightvision", label: "NV" },
  { id: "thermal", label: "Thermal" },
  { id: "crt", label: "CRT" }
];

export const LAYERS = [
  { id: "commercial", label: "Commercial Flights", description: "Civilian global air traffic", color: "#7ee0ff", enabled: true },
  { id: "military", label: "Military Flights", description: "Patrol, ISR, tanker, and AWACS tracks", color: "#ffbe5c", enabled: true },
  { id: "satellites", label: "Satellites", description: "Orbital passes with path trails", color: "#af9dff", enabled: true },
  { id: "maritime", label: "Maritime", description: "Tankers, cargo, and shipping lanes", color: "#60f7bf", enabled: true },
  { id: "incidents", label: "Incident Nodes", description: "Strikes, blackouts, and pressure points", color: "#ff6d8d", enabled: true },
  { id: "zones", label: "Jamming / Closures", description: "Active disruption and exclusion zones", color: "#ffc0cb", enabled: true }
];

export const DEFAULT_BOOKMARKS = [
  {
    id: "bookmark-gulf",
    label: "Gulf",
    destination: { lng: 53.6, lat: 25.8, height: 2200000, heading: 0.2, pitch: -0.85, roll: 0 }
  },
  {
    id: "bookmark-europe",
    label: "Europe",
    destination: { lng: 10.3, lat: 48.2, height: 5200000, heading: 0.15, pitch: -1.05, roll: 0 }
  },
  {
    id: "bookmark-pacific",
    label: "Pacific",
    destination: { lng: 142.1, lat: 29.1, height: 7800000, heading: 0.45, pitch: -1.15, roll: 0 }
  }
];

export const SCENARIO = {
  title: "Panopticon Earth",
  subtitle: "A globe-first intelligence sandbox for replaying traffic, orbits, incidents, and closures with direct camera control.",
  durationMinutes: 120,
  initialView: {
    lng: 34,
    lat: 24,
    height: 18500000,
    heading: 0.25,
    pitch: -1.2,
    roll: 0
  },
  events: [
    {
      id: "baseline",
      minute: 0,
      title: "Global baseline established",
      summary: "Panopticon Earth opens with transcontinental civilian air traffic, maritime shipping, and orbital passes already in motion.",
      tags: ["air", "maritime", "orbit"],
      location: { lng: 26.4, lat: 35.1 }
    },
    {
      id: "gulf-jamming",
      minute: 16,
      title: "Gulf navigation jamming intensifies",
      summary: "Disruption tiles expand over the Gulf corridor, distorting tracks and triggering early reroute behavior.",
      tags: ["jamming", "gulf", "aviation"],
      location: { lng: 53.8, lat: 29.9 }
    },
    {
      id: "orbital-focus",
      minute: 28,
      title: "Orbital collection converges",
      summary: "Commercial and state imaging platforms align over multiple hotspots across the Gulf and Levant.",
      tags: ["satellite", "aoi", "imagery"],
      location: { lng: 54.1, lat: 33.5 }
    },
    {
      id: "corridor-bend",
      minute: 41,
      title: "Civilian routes bend away",
      summary: "Airliners and cargo traffic begin avoiding the most disrupted corridors, creating visible track arcs on the globe.",
      tags: ["commercial", "reroute"],
      location: { lng: 49.8, lat: 27.2 }
    },
    {
      id: "zero-hour",
      minute: 56,
      title: "Zero-hour strike sequence",
      summary: "A concentrated event window lights up across the AOI while support aircraft and satellites reposition in response.",
      tags: ["strike", "aoi", "military"],
      location: { lng: 53.9, lat: 33.1 }
    },
    {
      id: "closure-wave",
      minute: 73,
      title: "Closure wave spreads regionally",
      summary: "Airspace and chokepoint closures ripple west and south, changing both air traffic and tanker behavior.",
      tags: ["closure", "cascade", "shipping"],
      location: { lng: 46.1, lat: 28.8 }
    },
    {
      id: "pacific-alert",
      minute: 88,
      title: "Pacific posture hardens",
      summary: "Military aviation and orbital monitoring spike over the western Pacific, broadening the theater beyond a single region.",
      tags: ["pacific", "military", "orbit"],
      location: { lng: 139.2, lat: 29.6 }
    },
    {
      id: "global-afterglow",
      minute: 120,
      title: "Persistent afterglow",
      summary: "Traffic normalizes unevenly while satellite interest and operator monitoring remain elevated worldwide.",
      tags: ["aftermath", "global"],
      location: { lng: 11.4, lat: 46.2 }
    }
  ],
  flights: {
    commercial: [
      {
        id: "com-thy631",
        label: "THY631",
        description: "Long-haul civilian track pressing through the edge of the Gulf corridor.",
        altitude: 11200,
        positions: [
          { minute: 0, lng: 55.2, lat: 25.1 },
          { minute: 24, lng: 56.1, lat: 28.7 },
          { minute: 48, lng: 53.8, lat: 31.9 },
          { minute: 74, lng: 46.1, lat: 35.8 },
          { minute: 98, lng: 36.2, lat: 39.1 },
          { minute: 120, lng: 28.7, lat: 41 }
        ]
      },
      {
        id: "com-vir354",
        label: "VIR354",
        description: "Civilian route that visibly bends around the disruption field.",
        altitude: 10900,
        positions: [
          { minute: 0, lng: 55.4, lat: 25.7 },
          { minute: 22, lng: 54.8, lat: 28.4 },
          { minute: 44, lng: 50.9, lat: 29.6 },
          { minute: 70, lng: 43.1, lat: 26.4 },
          { minute: 97, lng: 36.7, lat: 23.4 },
          { minute: 120, lng: 31.1, lat: 21.2 }
        ]
      },
      {
        id: "com-qtr908",
        label: "QTR908",
        description: "Wide-body passenger track turning west after closure wave onset.",
        altitude: 11100,
        positions: [
          { minute: 0, lng: 50.4, lat: 24.3 },
          { minute: 18, lng: 52.1, lat: 25.6 },
          { minute: 36, lng: 53.1, lat: 27.5 },
          { minute: 60, lng: 49.3, lat: 26.4 },
          { minute: 84, lng: 43.6, lat: 24.1 },
          { minute: 120, lng: 36.4, lat: 21.8 }
        ]
      },
      {
        id: "com-lha700",
        label: "LHA700",
        description: "High-latitude Europe-to-Asia traffic segment.",
        altitude: 11400,
        positions: [
          { minute: 0, lng: 8.6, lat: 50.2 },
          { minute: 24, lng: 18.1, lat: 53.4 },
          { minute: 48, lng: 31.6, lat: 55.2 },
          { minute: 72, lng: 47.9, lat: 54.1 },
          { minute: 96, lng: 66.8, lat: 50.7 },
          { minute: 120, lng: 84.1, lat: 46.9 }
        ]
      },
      {
        id: "com-jal44",
        label: "JAL44",
        description: "Transpacific commercial line crossing into the western Pacific watch area.",
        altitude: 11350,
        positions: [
          { minute: 0, lng: 166.8, lat: 35.2 },
          { minute: 26, lng: 176.5, lat: 37.9 },
          { minute: 52, lng: -171.3, lat: 39.8 },
          { minute: 78, lng: -160.6, lat: 39.2 },
          { minute: 102, lng: -148.7, lat: 37.1 },
          { minute: 120, lng: -138.9, lat: 35.4 }
        ]
      },
      {
        id: "com-sia318",
        label: "SIA318",
        description: "Singapore-Europe lane threading through the Indian Ocean to the Mediterranean.",
        altitude: 11050,
        positions: [
          { minute: 0, lng: 103.9, lat: 1.2 },
          { minute: 24, lng: 85.1, lat: 10.5 },
          { minute: 48, lng: 63.6, lat: 20.3 },
          { minute: 72, lng: 43.2, lat: 28.4 },
          { minute: 96, lng: 21.4, lat: 35.8 },
          { minute: 120, lng: 2.3, lat: 44.1 }
        ]
      }
    ],
    military: [
      {
        id: "mil-isr22",
        label: "ISR22",
        description: "Persistent intelligence, surveillance, and reconnaissance orbit over the Gulf theater.",
        altitude: 9600,
        positions: [
          { minute: 0, lng: 43.8, lat: 29.2 },
          { minute: 28, lng: 46.2, lat: 31.6 },
          { minute: 56, lng: 50.4, lat: 33.3 },
          { minute: 84, lng: 47.6, lat: 32.5 },
          { minute: 120, lng: 43.9, lat: 30.8 }
        ]
      },
      {
        id: "mil-awacs5",
        label: "AWACS5",
        description: "Wide-area early warning orbit supporting the theater edge.",
        altitude: 10100,
        positions: [
          { minute: 0, lng: 45.6, lat: 26.1 },
          { minute: 24, lng: 47.1, lat: 26.8 },
          { minute: 48, lng: 48.3, lat: 27.2 },
          { minute: 72, lng: 47.5, lat: 26.8 },
          { minute: 96, lng: 46.4, lat: 26.3 },
          { minute: 120, lng: 45.5, lat: 26 }
        ]
      },
      {
        id: "mil-tnk14",
        label: "TNK14",
        description: "Support tanker loitering outside the densest disruption area.",
        altitude: 9400,
        positions: [
          { minute: 0, lng: 45, lat: 27.9 },
          { minute: 20, lng: 46.9, lat: 28.7 },
          { minute: 40, lng: 48.2, lat: 29.3 },
          { minute: 70, lng: 49.1, lat: 29.6 },
          { minute: 95, lng: 46.4, lat: 29.1 },
          { minute: 120, lng: 43.7, lat: 28.5 }
        ]
      },
      {
        id: "mil-pacpatrol",
        label: "PAC-PATROL",
        description: "Western Pacific military patrol orbit to broaden the globe narrative.",
        altitude: 9800,
        positions: [
          { minute: 0, lng: 132.5, lat: 25.8 },
          { minute: 24, lng: 135.7, lat: 27.3 },
          { minute: 48, lng: 139.2, lat: 29.1 },
          { minute: 72, lng: 142.8, lat: 30.4 },
          { minute: 96, lng: 139.1, lat: 29.7 },
          { minute: 120, lng: 134.6, lat: 27.4 }
        ]
      }
    ]
  },
  satellites: [
    {
      id: "sat-wv-legion",
      label: "WV Legion",
      description: "Commercial EO satellite with pre- and post-event collection windows.",
      altitude: 610000,
      positions: [
        { minute: 0, lng: 12, lat: 4 },
        { minute: 20, lng: 34, lat: 21 },
        { minute: 40, lng: 56, lat: 35 },
        { minute: 60, lng: 82, lat: 49 },
        { minute: 90, lng: 116, lat: 58 },
        { minute: 120, lng: 146, lat: 63 }
      ]
    },
    {
      id: "sat-capella7",
      label: "Capella-7",
      description: "Synthetic aperture radar platform crossing the AOI during the strike window.",
      altitude: 590000,
      positions: [
        { minute: 0, lng: 96, lat: 60 },
        { minute: 20, lng: 74, lat: 44 },
        { minute: 40, lng: 55, lat: 31 },
        { minute: 60, lng: 26, lat: 18 },
        { minute: 90, lng: -12, lat: -3 },
        { minute: 120, lng: -38, lat: -17 }
      ]
    },
    {
      id: "sat-persona3",
      label: "Persona-3",
      description: "Military imaging satellite with multiple revisits through the theater.",
      altitude: 635000,
      positions: [
        { minute: 0, lng: -92, lat: 66 },
        { minute: 24, lng: -40, lat: 53 },
        { minute: 48, lng: 4, lat: 42 },
        { minute: 72, lng: 50, lat: 31 },
        { minute: 96, lng: 95, lat: 20 },
        { minute: 120, lng: 136, lat: 11 }
      ]
    },
    {
      id: "sat-topaz234",
      label: "Topaz 234",
      description: "Military radar platform with a direct zero-hour overpass.",
      altitude: 670000,
      positions: [
        { minute: 0, lng: -118, lat: 1 },
        { minute: 24, lng: -60, lat: 18 },
        { minute: 48, lng: 2, lat: 26 },
        { minute: 72, lng: 58, lat: 34 },
        { minute: 96, lng: 103, lat: 47 },
        { minute: 120, lng: 145, lat: 58 }
      ]
    }
  ],
  maritime: [
    {
      id: "sea-meridian",
      label: "Meridian LNG",
      description: "LNG tanker edging through the Strait as restrictions tighten.",
      altitude: 0,
      positions: [
        { minute: 0, lng: 55.7, lat: 26.8 },
        { minute: 24, lng: 56.1, lat: 26.5 },
        { minute: 48, lng: 56.3, lat: 26.3 },
        { minute: 72, lng: 56.7, lat: 26.1 },
        { minute: 96, lng: 57.2, lat: 25.9 },
        { minute: 120, lng: 57.6, lat: 25.7 }
      ]
    },
    {
      id: "sea-atlas",
      label: "Atlas Tanker",
      description: "Oil tanker reversing course as the chokepoint risk climbs.",
      altitude: 0,
      positions: [
        { minute: 0, lng: 56.4, lat: 25.9 },
        { minute: 24, lng: 55.9, lat: 25.8 },
        { minute: 48, lng: 55.2, lat: 25.7 },
        { minute: 72, lng: 54.2, lat: 25.5 },
        { minute: 96, lng: 53.4, lat: 25.2 },
        { minute: 120, lng: 52.9, lat: 25.1 }
      ]
    },
    {
      id: "sea-suez-cargo",
      label: "Suez Cargo",
      description: "East Mediterranean cargo flow for globe-scale maritime motion.",
      altitude: 0,
      positions: [
        { minute: 0, lng: 31.1, lat: 30.1 },
        { minute: 24, lng: 32.6, lat: 29.1 },
        { minute: 48, lng: 34.2, lat: 27.6 },
        { minute: 72, lng: 35.8, lat: 26.4 },
        { minute: 96, lng: 37.6, lat: 25.2 },
        { minute: 120, lng: 39.1, lat: 24.1 }
      ]
    },
    {
      id: "sea-pacific-container",
      label: "Pacific Container",
      description: "Container ship holding course across the western Pacific trade lane.",
      altitude: 0,
      positions: [
        { minute: 0, lng: 136.2, lat: 31.8 },
        { minute: 24, lng: 139.1, lat: 31.4 },
        { minute: 48, lng: 142.6, lat: 31.1 },
        { minute: 72, lng: 146.4, lat: 30.8 },
        { minute: 96, lng: 149.2, lat: 30.5 },
        { minute: 120, lng: 152.4, lat: 30.2 }
      ]
    }
  ],
  incidents: [
    {
      id: "incident-aoi",
      label: "AOI Strike",
      description: "Primary zero-hour event window.",
      start: 54,
      end: 73,
      location: { lng: 53.9, lat: 33.1 }
    },
    {
      id: "incident-blackout",
      label: "Comms Blackout",
      description: "Ground reporting collapse in the theater core.",
      start: 61,
      end: 90,
      location: { lng: 51.4, lat: 35.6 }
    },
    {
      id: "incident-pacific",
      label: "Pacific Alert",
      description: "Posture increase around the western Pacific watch area.",
      start: 88,
      end: 120,
      location: { lng: 139.4, lat: 28.7 }
    }
  ],
  zones: [
    {
      id: "zone-gulf-jam",
      label: "Gulf GPS Disruption",
      kind: "rectangle",
      start: 16,
      end: 92,
      color: "#ff6d8d",
      fill: 0.16,
      coordinates: { west: 49.1, south: 28.2, east: 55.6, north: 33.8 }
    },
    {
      id: "zone-gulf-closure",
      label: "Regional Closure Wave",
      kind: "polygon",
      start: 73,
      end: 120,
      color: "#ffffff",
      fill: 0.08,
      coordinates: [
        [44.7, 38.5],
        [60.8, 38.9],
        [61.7, 24.6],
        [46.1, 24.1]
      ]
    },
    {
      id: "zone-pacific-watch",
      label: "Pacific Watch Box",
      kind: "rectangle",
      start: 88,
      end: 120,
      color: "#7ee0ff",
      fill: 0.08,
      coordinates: { west: 133.5, south: 24.4, east: 147.8, north: 33.6 }
    }
  ]
};
