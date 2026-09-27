The `sync-events.js` script will fetch NYC CECM events from the NYC Open Data API (for the next week, by default) and save identified features to a GeoJSON file named `events-features.geojson`.

Run with node, including GOAT API key as an argument: `node sync-events.js <GOAT API KEY>`