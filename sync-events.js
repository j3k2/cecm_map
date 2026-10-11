const fs = require("fs");

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

if (!GOAT_API_KEY) {
  console.error(
    "GOAT API key must be added to .env file: GOAT_API_KEY: <KEY_VALUE>",
  );
  process.exit(1);
}

const OUTPUT_FILENAME = "events-features.geojson";
const WEEK_FILTER = true;
const PAGE_SIZE = 1000;
const OFFSET_MAX = 10; // for testing only
const applyOffsetMax = false; // for testing only

async function fetchAll(
  baseUrl,
  { extraParams = {}, extractArray = (d) => d } = {},
) {
  const results = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      $limit: PAGE_SIZE,
      $offset: offset,
      ...extraParams,
    });
    const url = `${baseUrl}?${params.toString()}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} for ${url}`);
    }

    const data = await response.json();
    const batch = extractArray(data);
    if (batch.length === 0) break;

    results.push(...batch);
    console.log(`Fetched ${results.length} from ${baseUrl}...`);

    if (batch.length < PAGE_SIZE || (applyOffsetMax && offset > OFFSET_MAX))
      break;
    offset += PAGE_SIZE;
  }

  return results;
}

async function loadReferenceData() {
  return {
    parksPermitData: await fetchAll(PARKS_PERMIT_API, {
      extractArray: (d) => d.features,
    }),
    athleticsData: await fetchAll(ATHLETICS_API, {
      extractArray: (d) => d.features,
    }),
    parksPropertiesData: await fetchAll(PARKS_PROPERTIES_API, {
      extractArray: (d) => d.features,
    }),
  };
}

function isValidGoatSegment(segment) {
  if (!segment) return false;
  if (segment.out_error_message && segment.out_error_message.trim() !== "")
    return false;
  const lat = parseFloat(segment.out_from_latitude);
  return !Number.isNaN(lat);
}

async function fetchSegment(onStreet, fromStreet, toStreet, boroughCodeStr) {
  const params = new URLSearchParams({
    Borough1: boroughCodeStr,
    OnStreet: onStreet,
    Borough2: boroughCodeStr,
    FirstCrossStreet: fromStreet,
    Borough3: boroughCodeStr,
    SecondCrossStreet: toStreet,
    DisplayFormat: "JSON",
    Key: GOAT_API_KEY,
  });
  const response = await fetch(`${GOAT_SEGMENT_API}?${params.toString()}`);
  if (!response.ok)
    throw new Error(`GOAT Function 3 HTTP error: ${response.status}`);
  return response.json();
}

function parseLocation(locationStr) {
  // Street segments formatted as "X between Y and Z":
  const match = locationStr.match(/^(.+?)\s+between\s+(.+?)\s+and\s+(.+)$/i);
  if (!match) return null;
  const [, onStreet, fromStreet, toStreet] = match.map((s) => s.trim());
  return { onStreet, fromStreet, toStreet };
}

const boroughCode = {
  MANHATTAN: "1",
  BRONX: "2",
  BROOKLYN: "3",
  QUEENS: "4",
  "STATEN ISLAND": "5",
};

async function getSegmentGeometry(location_e, borough, event) {
  const boroughCodeStr = boroughCode[borough?.toUpperCase()] || "1";

  const parsed = parseLocation(location_e);
  if (!parsed) {
    // console.warn('Could not parse location:', location_e);
    return null;
  }
  const { onStreet, fromStreet, toStreet } = parsed;

  let segment = null;
  try {
    const segmentResponse = await fetchSegment(
      onStreet,
      fromStreet,
      toStreet,
      boroughCodeStr,
    );
    if (isValidGoatSegment(segmentResponse?.display)) {
      segment = segmentResponse.display;
    }
  } catch (err) {
    console.error("fetchSegment error for", location_e, err);
  }

  if (!segment) {
    // console.warn('No data from GOAT for:', location_e);
    return null;
  }

  return segmentToGeoJSON(segment, event);
}

function segmentToGeoJSON(segment, event) {
  const fromLat = parseFloat(segment.out_from_latitude);
  const fromLon = parseFloat(segment.out_from_longitude);
  const toLat = parseFloat(segment.out_to_latitude);
  const toLon = parseFloat(segment.out_to_longitude);

  if ([fromLat, fromLon, toLat, toLon].some(Number.isNaN)) {
    return null;
  }

  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [fromLon, fromLat],
        [toLon, toLat],
      ],
    },
    properties: {
      display_name: `${segment.out_stname1?.trim()} (${segment.out_stname2?.trim()} to ${segment.out_stname3?.trim()})`,
      event_id: event.event_id,
      event_name: event.event_name,
      street: segment.out_stname1?.trim(),
      from: segment.out_stname2?.trim(),
      to: segment.out_stname3?.trim(),
      borough: segment.out_boro_name1?.trim(),
    },
  };
}

const sportCodes = [
  // more specific first
  ["WHEELCHAIRFOOTBALL", "WFB"],
  ["FLAGFOOTBALL", "FFB"],
  ["LITTLELEAGUE", "BSB"],
  ["MULTIPURPOSE", "MPPA"],
  ["MULTIUSE", "MPPA"],
  ["BASKETBALL", "BKB"],
  ["BASEBALL", "BSB"],
  ["CRICKET", "CRK"],
  ["FRISBEE", "FRS"],
  ["FOOTBALL", "FTB"],
  ["HANDBALL", "HDB"],
  ["HOCKEY", "HKY"],
  ["KICKBALL", "KBL"],
  ["LACROSSE", "LCS"],
  ["NETBALL", "NTB"],
  ["RUGBY", "RBY"],
  ["SOCCER", "SCR"],
  ["SOFTBALL", "SFB"],
  ["TENNIS", "TNS"],
  ["TRACK", "TRK"],
  ["VOLLEYBALL", "VLB"],
];

function getSportCode(sportName) {
  const normalized = sportName.toUpperCase().replace(/[\s-]+/g, ""); // remove spaces and dashes
  let bestMatch = null;
  let bestIndex = Infinity;

  for (const [phrase, code] of sportCodes) {
    const index = normalized.indexOf(phrase);
    if (index !== -1 && index < bestIndex) {
      bestIndex = index;
      bestMatch = code;
    }
  }

  return bestMatch;
}

function parseFacilityText(eventArea) {
  if (!eventArea) return null;

  // Identify and separate `sportName` and `fieldId` by dash or space.
  // `fieldId` can be one letter, 1-3 numbers, or 1-3 numbers and one suffix letter.
  const match = eventArea.match(/^(.+?)[\s-]+(\d{1,3}[A-Za-z]?|[A-Za-z])\b/);
  if (match) {
    return { sportName: match[1].trim(), fieldId: match[2] };
  }

  return { sportName: eventArea.trim(), fieldId: null };
}

function normalizeFieldId(n) {
  if (!n) return null;
  return n
    .replace(/[^a-zA-Z0-9]/g, "") // remove spaces/dashes/punctuation
    .replace(/^0+(?=\d)/, "") // remove leading zeroes
    .toUpperCase();
}

function getGispropnumsForFacility(eventFacility, parksPropertiesData) {
  const facilityNames = [
    eventFacility,
    eventFacility.replace(/\s*\([^)]*\)\s*$/, "").trim(), // remove parenthetical suffix from name
  ]
    .flatMap((name) => name.split("/").map((s) => s.trim())) // if two names separated by /, try both
    .map((name) => name.toLowerCase())
    .filter(Boolean);

  const candidates = [...new Set(facilityNames)];

  return parksPropertiesData
    .filter((facility) => {
      const signname = facility.properties.signname?.trim().toLowerCase();
      return candidates.some(
        (c) =>
          signname === c || signname?.startsWith(c) || signname?.includes(c),
      );
    })
    .map((facility) => facility.properties.gispropnum);
}

function getFacilityFeature(
  event,
  eventFacility,
  eventArea,
  parksPermitData,
  athleticsData,
  parksPropertiesData,
) {
  // Try direct cemsid match against Parks Permit Areas first.
  const cemsMatch = parksPermitData.find((facility) => {
    return parseInt(facility.properties.cemsid) === parseInt(event.cemsid);
  });
  if (cemsMatch) {
    const park = cemsMatch.properties.propertyname || eventFacility;
    const sub = cemsMatch.properties.name || eventArea;
    cemsMatch.properties.display_name =
      sub && sub !== park ? `${park}: ${sub}` : park;
    return cemsMatch;
  }
  // For athletic facility lookup:
  // Get gispropnums matching the facility name in the location string.
  const gispropnums = getGispropnumsForFacility(
    eventFacility,
    parksPropertiesData,
  );
  if (gispropnums.length === 0) return null;

  // Parse location string into sport code and field number.
  const parsedArea = parseFacilityText(eventArea);
  if (!parsedArea) return null;
  const code = getSportCode(parsedArea.sportName);
  if (!code) return null;
  const fieldId = parsedArea.fieldId;

  // Filter Athletic Facilities by that gispropnum
  const candidates = athleticsData.filter((facility) =>
    gispropnums.includes(facility.properties.gispropnum),
  );

  // Match the specific field by sport code and field number.
  const sportMatches = candidates.filter(
    (f) => f.properties.primary_sport === code,
  );

  const athleticMatch =
    sportMatches.find(
      (f) =>
        f.properties.field_number &&
        fieldId &&
        normalizeFieldId(f.properties.field_number) ===
          normalizeFieldId(fieldId),
    ) || (sportMatches.length === 1 ? sportMatches[0] : null);

  if (athleticMatch) {
    const fieldNum = athleticMatch.properties.field_number;
    const sub = fieldNum ? `Field ${fieldNum}` : eventArea;
    athleticMatch.properties.display_name = `${eventFacility}: ${sub}`;
    return athleticMatch;
  }
  return null;
}

async function getFeatureFromLocation(
  event,
  parksPermitData,
  athleticsData,
  parksPropertiesData,
) {
  const location = event.event_location;
  if (!location) return null;

  const borough = event.event_borough;

  if (location.includes(":")) {
    const [facility, area] = location.split(":").map((s) => s.trim());
    const feature = getFacilityFeature(
      event,
      facility,
      area,
      parksPermitData,
      athleticsData,
      parksPropertiesData,
    );
    // if (!feature) console.warn('Could not match to facility', location)
    return feature;
  }

  return getSegmentGeometry(location, borough, event);
}

// const failureShapes = new Map();

// function recordFailure(location) {
//   const hasComma = location.includes(',');
//   const hasSlash = location.includes('/');
//   const hasColon = location.includes(':');
//   const hasParens = /\(/.test(location);
//   const hasBetween = /\bbetween\b/i.test(location);
//   const hasDashNumber = /-\d+/.test(location);

//   const shape = `colon:${hasColon}|comma:${hasComma}|slash:${hasSlash}|parens:${hasParens}|between:${hasBetween}|dashNum:${hasDashNumber}`;

//   if (!failureShapes.has(shape)) {
//     failureShapes.set(shape, { count: 0, example: location });
//   }
//   failureShapes.get(shape).count++;
// }

function writeGeoJSON(featureCollection) {
  const tempPath = `${OUTPUT_FILENAME}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(featureCollection));
  fs.renameSync(tempPath, OUTPUT_FILENAME);
}

async function processEvents() {
  const featureMap = new Map();
  const start = new Date();
  const end = new Date();
  end.setDate(start.getDate() + 7);

  const currentEvents = await fetchAll(
    EVENTS_API,
    WEEK_FILTER
      ? {
          extraParams: {
            // https://dev.socrata.com/docs/queries/where.html
            $where: `start_date_time >= '${start.toISOString().replace("Z", "")}' AND 
        start_date_time <= '${end.toISOString().replace("Z", "")}'`,
          },
        }
      : undefined,
  );
  const { parksPermitData, athleticsData, parksPropertiesData } =
    await loadReferenceData();

  const events = currentEvents.map((e) => ({
    key: `${e.event_id}_${e.start_date_time}`,
    ...e,
  }));

  let matchedCount = 0;

  for (const event of events) {
    const feature = await getFeatureFromLocation(
      event,
      parksPermitData,
      athleticsData,
      parksPropertiesData,
    );
    if (feature) {
      matchedCount++;
      const key =
        feature.properties.system ||
        JSON.stringify(feature.geometry.coordinates);

      if (!featureMap.has(key)) {
        featureMap.set(key, {
          ...feature,
          properties: {
            ...feature.properties,
            events: [event],
          },
        });
      } else {
        featureMap.get(key).properties.events.push(event);
      }
    }
  }

  const featureCollection = {
    type: "FeatureCollection",
    features: Array.from(featureMap.values()),
  };

  console.log(
    `${matchedCount}/${events.length} events matched across ${featureMap.size} unique map features`,
  );

  // const sorted = [...failureShapes.entries()].sort((a, b) => b[1].count - a[1].count);
  // for (const [shape, { count, example }] of sorted) {
  //   console.log(`\n[${count}] ${shape}`);
  //   console.log(`  e.g. ${example}`);
  // }

  writeGeoJSON(featureCollection);
}

processEvents().catch((err) => {
  console.error("processEvents failed:", err);
  process.exit(1);
});
