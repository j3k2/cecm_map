const EVENTS_API = 'https://data.cityofnewyork.us/resource/tvpp-9vvx.json';
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

const currentEvents = await fetchAll(EVENTS_API);

// Map from shape -> { count, example }
const shapeCounts = new Map();
let noLocationCount = 0;

for (const e of currentEvents) {
  const loc = e.event_location;
  if (!loc) {
    noLocationCount++;
    continue;
  }

  const hasColon = loc.includes(':');
  const hasComma = loc.includes(',');
  const hasBetween = /\bbetween\b/i.test(loc);
  const startsWithNumber = /^\d/.test(loc);

  const shape = `colon:${hasColon}|comma:${hasComma}|between:${hasBetween}|startsNum:${startsWithNumber}`;

  if (!shapeCounts.has(shape)) {
    shapeCounts.set(shape, { count: 0, example: loc });
  }
  shapeCounts.get(shape).count++;
}

// Sort shapes by count, descending, so the most common patterns show first.
const sorted = [...shapeCounts.entries()].sort((a, b) => b[1].count - a[1].count);

console.log(`\nTotal events: ${currentEvents.length}`);
console.log(`Events with no event_location: ${noLocationCount}\n`);
console.log('Shape breakdown (most common first):');
for (const [shape, { count, example }] of sorted) {
  const pct = ((count / currentEvents.length) * 100).toFixed(1);
  console.log(`\n[${count} events, ${pct}%] ${shape}`);
  console.log(`  example: ${example}`);
}