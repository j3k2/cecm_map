const fs = require("fs");

const {
  EVENTS_API,
  GOAT_API_KEY,
  OUTPUT_FILENAME,
  WEEK_FILTER,
  FALLBACK_DISTRICT,
  fallbackDistrictTypes,
  boroughCodes,
} = require("./scripts/config");
const {
  fetchAll,
  loadReferenceData,
  fetchSegment,
} = require("./scripts/fetch");
const {
  parseLocation,
  getSportCode,
  parseFacilityText,
  normalizeFieldId,
} = require("./scripts/parsers");
const { geometryArea } = require("./scripts/geometry");

if (!GOAT_API_KEY) {
  console.error(
    "GOAT API key must be added to .env file: GOAT_API_KEY: <KEY_VALUE>",
  );
  process.exit(1);
}

function isValidGoatSegment(segment) {
  if (!segment) return false;
  if (segment.out_error_message && segment.out_error_message.trim() !== "")
    return false;
  const lat = parseFloat(segment.out_from_latitude);
  return !Number.isNaN(lat);
}

async function getSegmentFeature(location_e, borough, event) {
  const boroughCodeStr = boroughCodes[borough?.toUpperCase()] || "1";

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

function getPropertyNames(eventProperty) {
  const propertyNames = [
    eventProperty,
    eventProperty.replace(/\s*\([^)]*\)\s*$/, "").trim(), // remove parenthetical suffix from name
  ]
    .flatMap((name) => name.split("/").map((s) => s.trim())) // if two names separated by /, try both
    .map((name) => name.toLowerCase())
    .filter(Boolean);

  return [...new Set(propertyNames)];
}

function getGispropnumsForProperty(eventProperty, parksPropertiesData) {
  const candidates = getPropertyNames(eventProperty);

  return parksPropertiesData
    .filter((property) => {
      const signname = property.properties.signname?.trim().toLowerCase();
      return candidates.some(
        (c) =>
          signname === c || signname?.startsWith(c) || signname?.includes(c),
      );
    })
    .map((property) => property.properties.gispropnum);
}

function nameSimilarity(signname, candidates) {
  // Lower is more similar:
  if (candidates.some((c) => signname === c)) return 0;
  if (candidates.some((c) => signname.startsWith(c))) return 1;
  if (candidates.some((c) => signname.includes(c))) return 2;
  return null;
}

function getParksProperty(eventProperty, parksPropertiesData) {
  const candidates = getPropertyNames(eventProperty);
  const matches = parksPropertiesData
    .map((f) => ({ f, signname: f.properties.signname?.trim().toLowerCase() }))
    .filter(
      (m) => m.signname && nameSimilarity(m.signname, candidates) !== null,
    )
    .sort(
      (a, b) =>
        nameSimilarity(a.signname, candidates) -
          nameSimilarity(b.signname, candidates) ||
        a.signname.length - b.signname.length,
    );
  if (matches.length === 0) return null;

  const park = matches[0].f;
  return {
    type: "Feature",
    geometry: park.geometry,
    properties: {
      system: `park:${park.properties.gispropnum}`,
      gispropnum: park.properties.gispropnum,
      display_name: park.properties.signname,
      approximate: true,
    },
  };
}

function getParkByName(parkName, parksPermitAreasData, parksPropertiesData) {
  // Try parksPermitAreasData by exact name:
  const name = parkName.trim().toLowerCase();
  const permitAreaPark = parksPermitAreasData.find(
    (f) =>
      f.properties.areatype === "Whole Park" &&
      f.properties.propertyname?.trim().toLowerCase() === name,
  );
  if (permitAreaPark) {
    return {
      type: "Feature",
      geometry: permitAreaPark.geometry,
      properties: {
        ...permitAreaPark.properties,
        display_name: permitAreaPark.properties.propertyname,
        approximate: true,
      },
    };
  }
  // Then try parksPropertiesData by most similar name:
  return getParksProperty(parkName, parksPropertiesData);
}

function getFacility(
  eventProperty,
  eventFacility,
  athleticFacilitiesData,
  parksPropertiesData,
) {
  // For athletic facility lookup:
  // Get gispropnums matching the property name in the location string.
  const gispropnums = getGispropnumsForProperty(
    eventProperty,
    parksPropertiesData,
  );
  if (gispropnums.length === 0) return null;

  // Parse location string into sport code and field number.
  const parsedFacility = parseFacilityText(eventFacility);
  if (!parsedFacility) return null;
  const code = getSportCode(parsedFacility.sportName);
  if (!code) return null;
  const fieldId = parsedFacility.fieldId;

  // Filter Athletic Facilities by that gispropnum
  const candidates = athleticFacilitiesData.filter((facility) =>
    gispropnums.includes(facility.properties.gispropnum),
  );

  // Match the specific field by sport code and field number.
  const sportMatches = candidates.filter(
    (f) => f.properties.primary_sport === code,
  );

  const facilityMatch =
    sportMatches.find(
      (f) =>
        f.properties.field_number &&
        fieldId &&
        normalizeFieldId(f.properties.field_number) ===
          normalizeFieldId(fieldId),
    ) || (sportMatches.length === 1 ? sportMatches[0] : null);

  if (facilityMatch) {
    const fieldNum = facilityMatch.properties.field_number;
    const sub = fieldNum ? `Field ${fieldNum}` : eventFacility;
    facilityMatch.properties.display_name = `${eventProperty}: ${sub}`;
    return facilityMatch;
  }
  return null;
}

async function getFeatureByName(
  event,
  parksPermitAreasData,
  athleticFacilitiesData,
  parksPropertiesData,
) {
  const location = event.event_location;
  if (!location) return null;

  const borough = event.event_borough;

  if (location.includes(":")) {
    const [property, facility] = location.split(":").map((s) => s.trim());
    // Look for facility match:
    const feature =
      getFacility(
        property,
        facility,
        athleticFacilitiesData,
        parksPropertiesData,
      ) ||
      // If facility match not found, look for park match:
      getParkByName(property, parksPermitAreasData, parksPropertiesData);
    // if (!feature) console.warn('Could not match to facility', location)
    return feature;
  }

  const street = await getSegmentFeature(location, borough, event);
  if (street || parseLocation(location)) return street;

  // If no ':' and not street segment, try park by name:
  return getParkByName(location, parksPermitAreasData, parksPropertiesData);
}

function getFeatureByCemsid(cemsid, parksPermitAreasData) {
  const cemsMatch = parksPermitAreasData.find((permitArea) => {
    return parseInt(permitArea.properties.cemsid) === parseInt(cemsid);
  });
  if (cemsMatch) {
    const park = cemsMatch.properties.propertyname;
    const sub = cemsMatch.properties.name;
    cemsMatch.properties.display_name =
      !sub || sub === park ? park : park ? `${park}: ${sub}` : sub;
  }
  return cemsMatch;
}

function getFeaturesFromDistrict(event, fallbackDistricts) {
  const area = fallbackDistrictTypes[FALLBACK_DISTRICT];
  return area.getIds(event).flatMap((id) => {
    const polygon = fallbackDistricts.find(
      (f) => Number(f.properties[area.idField]) === id,
    );
    if (!polygon) return [];
    return [
      {
        type: "Feature",
        geometry: polygon.geometry,
        properties: {
          system: `${FALLBACK_DISTRICT}:${id}`,
          display_name: `${area.label} ${id}`,
          approximate: true,
        },
      },
    ];
  });
}

async function getFeaturesFromEvent(
  event,
  parksPermitAreasData,
  athleticFacilitiesData,
  parksPropertiesData,
  fallbackDistricts,
) {
  // Get all cemsids and location names:
  const cemsids = String(event.cemsid || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const locations = (event.event_location || "")
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const features = [];

  // Match by cemsid:
  for (const cemsid of cemsids) {
    if (cemsid === "0") continue; // ignore placeholder 0
    const feature = getFeatureByCemsid(cemsid, parksPermitAreasData);
    if (feature) features.push(feature);
  }

  // Match by name:
  for (const location of locations) {
    const feature = await getFeatureByName(
      { ...event, event_location: location, cemsid: null },
      parksPermitAreasData,
      athleticFacilitiesData,
      parksPropertiesData,
    );
    if (feature) features.push(feature);
  }

  // Dedupe by feature id or coordinates:
  const byKey = new Map();
  for (const f of features) {
    const key = f.properties.system || JSON.stringify(f.geometry.coordinates);
    if (!byKey.has(key)) byKey.set(key, f);
  }
  const deduped = [...byKey.values()];

  // Prioritize more precise match:
  const uniqueMatch = deduped.filter((f, i) => {
    const gispropnum = f.properties.gispropnum;
    if (!f.properties.approximate || !gispropnum) return true;
    return !deduped.some(
      (o, j) =>
        o.properties.gispropnum === gispropnum &&
        (!o.properties.approximate || j < i),
    );
  });

  if (uniqueMatch.length > 0) return uniqueMatch;

  // Fallback to district if no match found:
  return getFeaturesFromDistrict(event, fallbackDistricts);
}

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
  const {
    parksPermitAreasData,
    athleticFacilitiesData,
    parksPropertiesData,
    fallbackDistricts,
  } = await loadReferenceData();

  const events = currentEvents.map((e) => ({
    key: `${e.event_id}_${e.start_date_time}`,
    ...e,
  }));

  let matchedCount = 0;
  let approximateParkCount = 0;
  let approximateDistrictCount = 0;
  let unmatchedCount = 0;

  for (const event of events) {
    const matches = await getFeaturesFromEvent(
      event,
      parksPermitAreasData,
      athleticFacilitiesData,
      parksPropertiesData,
      fallbackDistricts,
    );

    if (matches.length === 0) {
      unmatchedCount++;
    } else if (matches.every((f) => f.properties.approximate)) {
      if (
        matches.every((f) =>
          f.properties.system?.startsWith(`${FALLBACK_DISTRICT}:`),
        )
      ) {
        approximateDistrictCount++;
      } else {
        approximateParkCount++;
      }
    } else {
      matchedCount++;
    }

    // If approximate match used, save name to a separate field:
    if (matches.length > 0 && matches.every((f) => f.properties.approximate)) {
      event.approximate_name = matches
        .map((f) => f.properties.display_name)
        .join(", ");
    }

    if (matches.length === 1) {
      // one location for this event:
      const feature = matches[0];
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
    } else if (matches.length > 1) {
      // multiple locations for this event:
      featureMap.set(`event:${event.key}`, {
        type: "Feature",
        geometry: {
          type: "GeometryCollection",
          geometries: matches.map((f) => f.geometry),
        },
        properties: {
          display_name: event.event_name,
          part_names: matches.map((f) => f.properties.display_name),
          events: [event],
        },
      });
    }
  }

  const featureCollection = {
    type: "FeatureCollection",
    features: Array.from(featureMap.values()).map((f) => ({
      ...f,
      properties: { ...f.properties, area: geometryArea(f.geometry) },
    })),
  };

  console.log(
    `${events.length} events: ${matchedCount} matched, ${approximateParkCount} park fallback, ${approximateDistrictCount} district fallback, ${unmatchedCount} not included; ${featureMap.size} unique map features`,
  );

  writeGeoJSON(featureCollection);
}

processEvents().catch((err) => {
  console.error("processEvents failed:", err);
  process.exit(1);
});
