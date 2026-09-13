const fs = require('fs');

const EVENTS_API = 'https://data.cityofnewyork.us/resource/tvpp-9vvx.json';

const GOAT_SEGMENT_API = 'https://geoservice.planning.nyc.gov/geoservice/geoservice.svc/Function_3';
const GOAT_API_KEY = '3s6v9y6BkEAHkMbQ';

const boroughCode = {
  'MANHATTAN': '1',
  'BRONX': '2',
  'BROOKLYN': '3',
  'QUEENS': '4',
  'STATEN ISLAND': '5',
};

const PAGE_SIZE = 1000;

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
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return results;
}

function loadFromLocalFile(path) {
  const raw = fs.readFileSync(path, 'utf8');
  return JSON.parse(raw).features;
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

function segmentToGeoJSON(segment, event) {
  const fromLat = parseFloat(segment.out_from_latitude);
  const fromLon = parseFloat(segment.out_from_longitude);
  const toLat = parseFloat(segment.out_to_latitude);
  const toLon = parseFloat(segment.out_to_longitude);

  if ([fromLat, fromLon, toLat, toLon].some(Number.isNaN)) return null;

  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[fromLon, fromLat], [toLon, toLat]] },
    properties: { event_id: event.event_id, event_name: event.event_name },
  };
}

async function getSegmentGeometry(location_e, borough, event) {
  const boroughCodeStr = boroughCode[borough?.toUpperCase()] || '1';
  const parsed = parseLocation(location_e);
  if (!parsed) return null;
  const { onStreet, fromStreet, toStreet } = parsed;

  let segment = null;
  try {
    const segmentResponse = await fetchSegment(onStreet, fromStreet, toStreet, boroughCodeStr);
    if (isValidGoatSegment(segmentResponse?.display)) segment = segmentResponse.display;
  } catch (err) {
  }
  if (!segment) return null;
  return segmentToGeoJSON(segment, event);
}

function getFacilityGeometry(bname, pname, spname, parksPermitData, athleticsData) {
  const match = parksPermitData.find((f) => {
    const p = f.properties;
    return (
      bname === p.bname &&
      p.propertyname?.trim().toLowerCase() === pname?.trim().toLowerCase() &&
      p.name?.trim().toLowerCase() === spname?.trim().toLowerCase()
    );
  });
  if (match) return match.geometry;

  const athleticMatch = athleticsData.find((f) => {
    const p = f.properties;
    return (
      bname === p.bname &&
      p.eapply?.trim().toLowerCase() === pname?.trim().toLowerCase() &&
      p.sub?.trim().toLowerCase() === spname?.trim().toLowerCase()
    );
  });
  return athleticMatch ? athleticMatch.geometry : null;
}

async function getFeatureFromLocation(event, parksPermitData, athleticsData) {
  const location = event.event_location;
  if (!location) return null;

  const borough = event.event_borough;

  if (location.includes(':')) {
    const [facility, area] = location.split(':').map((s) => s.trim());
    return getFacilityGeometry(borough, facility, area, parksPermitData, athleticsData);
  }

  return getSegmentGeometry(location, borough, event);
}

async function run() {
  const currentEvents = await fetchAll(EVENTS_API);
  const parksPermitData = loadFromLocalFile('data/Parks Permit Areas_20250923.geojson');
  const athleticsData = loadFromLocalFile('data/Athletic Facilities_20250923.geojson');

  let matchedCount = 0;

  for (const event of currentEvents) {
    const feature = await getFeatureFromLocation(event, parksPermitData, athleticsData);
    if (feature) matchedCount++;
  }

  const pct = ((matchedCount / currentEvents.length) * 100).toFixed(1);
  console.log(`${matchedCount} / ${currentEvents.length} matched (${pct}%)`);
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});