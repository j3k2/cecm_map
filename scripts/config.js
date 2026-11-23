const EVENTS_API = "https://data.cityofnewyork.us/resource/tvpp-9vvx.json";
const PARKS_PERMIT_API =
  "https://data.cityofnewyork.us/resource/c5vm-g2dk.geojson";
const ATHLETICS_API =
  "https://data.cityofnewyork.us/resource/qnem-b8re.geojson";
const PARKS_PROPERTIES_API =
  "https://data.cityofnewyork.us/resource/enfh-gkve.geojson";

const GOAT_SEGMENT_API =
  "https://geoservice.planning.nyc.gov/geoservice/geoservice.svc/Function_3";
// const GOAT_STRETCH_API = 'https://geoservice.planning.nyc.gov/geoservice/geoservice.svc/Function_3S';
const GOAT_API_KEY = process.env.GOAT_API_KEY;

const OUTPUT_FILENAME = "events-features.geojson";
const WEEK_FILTER = true;
const PAGE_SIZE = 1000;
const OFFSET_MAX = 10; // for testing only
const applyOffsetMax = false; // for testing only
const FALLBACK_DISTRICT = "police_precinct";

const boroughCodes = {
  MANHATTAN: "1",
  BRONX: "2",
  BROOKLYN: "3",
  QUEENS: "4",
  "STATEN ISLAND": "5",
};

const fallbackDistrictTypes = {
  community_district: {
    api: "https://data.cityofnewyork.us/resource/5crt-au7u.geojson",
    idField: "boro_cd", // borough digit + board number, e.g. 412
    label: "Community District",
    getIds: (event) => {
      const digit = Number(boroughCodes[event.event_borough?.toUpperCase()]);
      if (!digit) return [];
      return String(event.community_board || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((board) => digit * 100 + Number(board));
    },
  },
  police_precinct: {
    api: "https://data.cityofnewyork.us/resource/y76i-bdw7.geojson",
    idField: "precinct",
    label: "Police Precinct",
    getIds: (event) =>
      String(event.police_precinct || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number),
  },
};

module.exports = {
  EVENTS_API,
  PARKS_PERMIT_API,
  ATHLETICS_API,
  PARKS_PROPERTIES_API,
  GOAT_SEGMENT_API,
  GOAT_API_KEY,
  OUTPUT_FILENAME,
  WEEK_FILTER,
  PAGE_SIZE,
  OFFSET_MAX,
  applyOffsetMax,
  FALLBACK_DISTRICT,
  fallbackDistrictTypes,
  boroughCodes,
};
