const fs = require('fs');

const EVENTS_API = 'https://data.cityofnewyork.us/resource/tvpp-9vvx.json';
const PARKS_PERMIT_API = 'https://data.cityofnewyork.us/resource/c5vm-g2dk.geojson';
const ATHLETICS_API = 'https://data.cityofnewyork.us/resource/qnem-b8re.geojson';
const PARKS_PROPERTIES_API = 'https://data.cityofnewyork.us/resource/enfh-gkve.geojson';

const GOAT_SEGMENT_API = 'https://geoservice.planning.nyc.gov/geoservice/geoservice.svc/Function_3';
const GOAT_STRETCH_API = 'https://geoservice.planning.nyc.gov/geoservice/geoservice.svc/Function_3S';
const GOAT_API_KEY = '3s6v9y6BkEAHkMbQ';

const SOURCE_MODE = 'local'; // 'local' | 'api'

const boroughCode = {
  'MANHATTAN': '1',
  'BRONX': '2',
  'BROOKLYN': '3',
  'QUEENS': '4',
  'STATEN ISLAND': '5',
};

const PAGE_SIZE = 1000;
const OFFSET_MAX = 10; // for testing only
const applyOffsetMax = false; // for testing only

async function fetchAll(baseUrl, { extraParams = {}, extractArray = (d) => d } = {}) {
  const results = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({ $limit: PAGE_SIZE, $offset: offset, ...extraParams });
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

    if (batch.length < PAGE_SIZE || (applyOffsetMax && offset > OFFSET_MAX)) break;
    offset += PAGE_SIZE;
  }

  return results;
}

function loadFromLocalFile(path) {
  console.log(`Loading ${path} from local file...`);
  const raw = fs.readFileSync(path, 'utf8');
  const geojson = JSON.parse(raw);
  return geojson.features;
}

async function loadFromApi(apiUrl) {
  console.log(`Fetching ${apiUrl} from API...`);
  return fetchAll(apiUrl, { extractArray: (d) => d.features });
}

async function loadReferenceData() {
  // TODO: switch to cached API call
  if (SOURCE_MODE === 'local') {
    return {
      parksPermitData: loadFromLocalFile('data/Parks Permit Areas_20250923.geojson'),
      athleticsData: loadFromLocalFile('data/Athletic Facilities_20250923.geojson'),
      parksPropertiesData: loadFromLocalFile('data/Parks Properties_20250916.geojson'),
    };
  }

  if (SOURCE_MODE === 'api') {
    return {
      parksPermitData: await loadFromApi(PARKS_PERMIT_API),
      athleticsData: await loadFromApi(ATHLETICS_API),
      parksPropertiesData: await loadFromApi(PARKS_PROPERTIES_API),
    };
  }

  throw new Error(`Unknown SOURCE_MODE: ${SOURCE_MODE}`);
}

function isValidGoatSegment(segment) {
  if (!segment) return false;
  if (segment.out_error_message && segment.out_error_message.trim() !== '') return false;
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
    DisplayFormat: 'JSON',
    Key: GOAT_API_KEY,
  });
  const response = await fetch(`${GOAT_SEGMENT_API}?${params.toString()}`);
  if (!response.ok) throw new Error(`GOAT Function 3 HTTP error: ${response.status}`);
  return response.json();
}

function parseLocation(locationStr) {
  const match = locationStr.match(/^(.+?)\s+between\s+(.+?)\s+and\s+(.+)$/i);
  if (!match) return null;
  const [, onStreet, fromStreet, toStreet] = match.map((s) => s.trim());
  return { onStreet, fromStreet, toStreet };
}

async function getSegmentGeometry(location_e, borough, event) {
  const boroughCodeStr = boroughCode[borough?.toUpperCase()] || '1';

  const parsed = parseLocation(location_e);
  if (!parsed) {
    // console.warn('Could not parse location:', location_e);
    return null;
  }
  const { onStreet, fromStreet, toStreet } = parsed;

  let segment = null;
  try {
    const segmentResponse = await fetchSegment(onStreet, fromStreet, toStreet, boroughCodeStr);
    if (isValidGoatSegment(segmentResponse?.display)) {
      segment = segmentResponse.display;
    }
  } catch (err) {
    console.error('fetchSegment error for', location_e, err);
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
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [fromLon, fromLat],
        [toLon, toLat],
      ],
    },
    properties: {
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
  ['WHEELCHAIRFOOTBALL', 'WFB'],
  ['FLAGFOOTBALL', 'FFB'],
  ['LITTLELEAGUE', 'BSB'],
  ['MULTIPURPOSE', 'MPPA'],
  ['MULTIUSE', 'MPPA'],
  ['BASKETBALL', 'BKB'],
  ['BASEBALL', 'BSB'],
  ['CRICKET', 'CRK'],
  ['FRISBEE', 'FRS'],
  ['FOOTBALL', 'FTB'],
  ['HANDBALL', 'HDB'],
  ['HOCKEY', 'HKY'],
  ['KICKBALL', 'KBL'],
  ['LACROSSE', 'LCS'],
  ['NETBALL', 'NTB'],
  ['RUGBY', 'RBY'],
  ['SOCCER', 'SCR'],
  ['SOFTBALL', 'SFB'],
  ['TENNIS', 'TNS'],
  ['TRACK', 'TRK'],
  ['VOLLEYBALL', 'VLB'],
];

function getSportCode(sportWord) {
  const normalized = sportWord.toUpperCase().replace(/[\s-]+/g, '');
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

  const match = eventArea.match(/^(.+?)[\s-]+(\d{1,3}[A-Za-z]?|[A-Za-z])\b/);
  if (match) {
    return { sportWord: match[1].trim(), fieldId: match[2] };
  }

  return { sportWord: eventArea.trim(), fieldId: null };
}

function normalizeFieldId(n) {
  if (!n) return null;
  return n.replace(/[^a-zA-Z0-9]/g, '').replace(/^0+(?=\d)/, '').toUpperCase();
}

function getGispropnumsForFacility(eventFacility, parksPropertiesData) {
  const facilityNames = [
    eventFacility,
    eventFacility.replace(/\s*\([^)]*\)\s*$/, '').trim(), // strip trailing parentheticals from name
  ]
    .flatMap((name) => name.split('/').map((s) => s.trim())) // if two names separated by /, try both
    .map((name) => name.toLowerCase())
    .filter(Boolean);

  const candidates = [...new Set(facilityNames)];

  return parksPropertiesData
    .filter((facility) => {
      const signname = facility.properties.signname?.trim().toLowerCase();
      return candidates.some((c) => signname === c || signname?.startsWith(c) || signname?.includes(c));
    })
    .map((facility) => facility.properties.gispropnum);
}

function getFacilityGeometry(event, eventFacility, eventArea, parksPermitData, athleticsData, parksPropertiesData) {
  // Try direct cemsid match against Parks Permit Areas first.
  const cemsMatch = parksPermitData.find((facility) => {
    return parseInt(facility.properties.cemsid) === parseInt(event.cemsid);
  });
  if (cemsMatch) return cemsMatch.geometry;

  // For athletic facility lookup:
  // Get gispropnums matching the facility name in the location string.
  const gispropnums = getGispropnumsForFacility(eventFacility, parksPropertiesData);
  if (gispropnums.length === 0) return null;

  // Parse location string into sport code and field number.
  const parsedArea = parseFacilityText(eventArea);
  if (!parsedArea) return null;
  const code = getSportCode(parsedArea.sportWord)
  if (!code) return null;
  const fieldId = parsedArea.fieldId;

  // Filter Athletic Facilities by that gispropnum
  const candidates = athleticsData.filter((facility) => gispropnums.includes(facility.properties.gispropnum));

  // Match the specific field by sport code and field number.
  const sportMatches = candidates.filter((f) => f.properties.primary_sport === code);

  const athleticMatch =
    sportMatches.find((f) => f.properties.field_number && fieldId && normalizeFieldId(f.properties.field_number) === normalizeFieldId(fieldId)) ||
    (sportMatches.length === 1 ? sportMatches[0] : null);

  return athleticMatch ? athleticMatch.geometry : null;
}
 
async function getFeatureFromLocation(event, parksPermitData, athleticsData, parksPropertiesData) {
  const location = event.event_location;
  if (!location) return null;
 
  const borough = event.event_borough;
 
  if (location.includes(':')) {
    const [facility, area] = location.split(':').map((s) => s.trim());
    const feature = getFacilityGeometry(event, facility, area, parksPermitData, athleticsData, parksPropertiesData);
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

async function processEvents() {
  const currentEvents = await fetchAll(EVENTS_API);
  const { parksPermitData, athleticsData, parksPropertiesData } = await loadReferenceData();

  const events = currentEvents.map((e) => ({
    key: `${e.event_id}_${e.start_date_time}`,
    ...e,
  }));
  
  // let matchedCount = 0;

  for (const event of events) {
    event.feature = await getFeatureFromLocation(event, parksPermitData, athleticsData, parksPropertiesData)

  //   if (event.feature) {
  //     // console.log("Matched: ", event.feature)
  //     matchedCount++;
  //   } else {
  //     recordFailure(event.event_location)
  //     // console.log('Failed: ', event.event_location)    
  //   }
  }
  // console.log(matchedCount, events.length);

  // const sorted = [...failureShapes.entries()].sort((a, b) => b[1].count - a[1].count);
  // for (const [shape, { count, example }] of sorted) {
  //   console.log(`\n[${count}] ${shape}`);
  //   console.log(`  e.g. ${example}`);
  // }

  return events;
}

processEvents().catch((err) => {
  console.error('processEvents failed:', err);
  process.exit(1);
});