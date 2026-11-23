const {
  PARKS_PERMIT_API,
  ATHLETICS_API,
  PARKS_PROPERTIES_API,
  GOAT_SEGMENT_API,
  GOAT_API_KEY,
  PAGE_SIZE,
  OFFSET_MAX,
  applyOffsetMax,
  FALLBACK_DISTRICT,
  fallbackDistrictTypes,
} = require("./config");

const RETRY_STATUSES = [429, 500, 502, 503, 504];
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url) {
  for (const delay of [...RETRY_DELAYS_MS, null]) {
    let response;
    try {
      response = await fetch(url);
    } catch (err) {
      if (!(err instanceof TypeError) || delay === null) throw err;
      console.warn(`${err.message}, retrying in ${delay / 1000}s:`, url);
      await wait(delay);
      continue;
    }

    if (!RETRY_STATUSES.includes(response.status) || delay === null)
      return response;
    console.warn(`HTTP ${response.status}, retrying in ${delay / 1000}s:`, url);
    await wait(delay);
  }
}

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

    const response = await fetchWithRetry(url);
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
    parksPermitAreasData: await fetchAll(PARKS_PERMIT_API, {
      extractArray: (d) => d.features,
    }),
    athleticFacilitiesData: await fetchAll(ATHLETICS_API, {
      extractArray: (d) => d.features,
    }),
    parksPropertiesData: await fetchAll(PARKS_PROPERTIES_API, {
      extractArray: (d) => d.features,
    }),
    fallbackDistricts: await fetchAll(
      fallbackDistrictTypes[FALLBACK_DISTRICT].api,
      {
        extractArray: (d) => d.features,
      },
    ),
  };
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
  const response = await fetchWithRetry(
    `${GOAT_SEGMENT_API}?${params.toString()}`,
  );
  if (!response.ok)
    throw new Error(`GOAT Function 3 HTTP error: ${response.status}`);
  return response.json();
}

module.exports = { fetchAll, loadReferenceData, fetchSegment };
