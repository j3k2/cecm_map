const fs = require('fs');

const EVENTS_API = 'https://data.cityofnewyork.us/resource/tvpp-9vvx.json';
const PARKS_PERMIT_API = 'https://data.cityofnewyork.us/resource/c5vm-g2dk.geojson';
const ATHLETICS_API = 'https://data.cityofnewyork.us/resource/qnem-b8re.geojson';

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

    if (batch.length < PAGE_SIZE) break;
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
    };
  }

  if (SOURCE_MODE === 'api') {
    return {
      parksPermitData: await loadFromApi(PARKS_PERMIT_API),
      athleticsData: await loadFromApi(ATHLETICS_API),
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
    console.warn('Could not parse location:', location_e);
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
    console.warn('No data from GOAT for:', location_e);
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


async function processEvents() {
  const currentEvents = await fetchAll(EVENTS_API);
  const { parksPermitData, athleticsData } = await loadReferenceData();

  const events = currentEvents.map((e) => ({
    key: `${e.event_id}_${e.start_date_time}`,
    ...e,
  }));


  for (const event of events) {
    event.feature = await getFeatureFromLocation(event, parksPermitData, athleticsData)

    // if (event.feature) {
    //   console.log("Matched: ", event.feature)
    // } else {
    //   console.log('Failed: ', event.event_location)    
    // }
  }
  
  return events;
}

processEvents().catch((err) => {
  console.error('processEvents failed:', err);
  process.exit(1);
});