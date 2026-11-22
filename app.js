import { formatDate, formatTime } from "./format.js";
import { featureCards, eventCount, popupShell } from "./popup.js";
import { CARTO_API_KEY } from "./config.js";

const map = L.map("map", { zoomSnap: 0.25 }).setView([40.73, -73.95], 11);
let allData, layer, layerByEvent, searchTimer;
const filters = { type: "", borough: "", date: "", search: "" };

L.tileLayer(
  `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`,
  {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    detectRetina: true,
    maxZoom: 20,
  },
).addTo(map);

function zoomToLayer() {
  const b = layer.getBounds();
  if (b.isValid()) map.fitBounds(b);
}

function renderTable(features) {
  const rows = features
    .flatMap((f) => f.properties.events)
    .sort((a, b) => a.start_date_time.localeCompare(b.start_date_time));
  document.querySelector("#events-table tbody").innerHTML = rows
    .map(
      (e) => `<tr data-key="${e.event_id}|${e.start_date_time}">
        <td>${formatDate(e.start_date_time)}<br>${formatTime(e.start_date_time)}</td>
        <td>${e.event_name || "Event"}</td>
        <td>${e.event_type || ""}</td>
        <td>${e.event_location || ""}</td>
      </tr>`,
    )
    .join("");
}

const renderMap = () => {
  map.closePopup();
  document.getElementById("table-panel").scrollTop = 0;
  if (layer) layer.remove();
  const features = allData.features
    .map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        events: f.properties.events.filter(
          (e) =>
            (!filters.type || e.event_type === filters.type) &&
            (!filters.borough || e.event_borough === filters.borough) &&
            (!filters.date ||
              e.start_date_time.slice(0, 10) === filters.date) &&
            (!filters.search ||
              ((e.event_name || "") + " " + (e.event_location || ""))
                .toLowerCase()
                .includes(filters.search)),
        ),
      },
    }))
    .filter((f) => f.properties.events.length > 0);

  renderTable(features);

  layer = L.geoJSON({ type: "FeatureCollection", features }).addTo(map);

  layerByEvent = new Map();
  layer.eachLayer((l) =>
    l.feature.properties.events.forEach((e) =>
      layerByEvent.set(e.event_id + "|" + e.start_date_time, l),
    ),
  );

  const bounds = layer.getBounds();
  if (bounds.isValid() && !map.getBounds().contains(bounds)) {
    map.fitBounds(bounds);
  }
};

fetch("events-features.geojson")
  .then((res) => res.json())
  .then((data) => {
    data.features.sort(
      (a, b) =>
        (b.properties.areatype === "Whole Park") -
        (a.properties.areatype === "Whole Park"),
    );
    allData = data;
    function setupFilter(id, key, getValue, getLabel = (v) => v) {
      const select = document.getElementById(id);
      const values = [
        ...new Set(
          allData.features.flatMap((f) => f.properties.events.map(getValue)),
        ),
      ]
        .filter(Boolean)
        .sort();
      select.add(new Option(`All ${key}s`, ""));
      values.forEach((v) => select.add(new Option(getLabel(v), v)));
      select.onchange = () => {
        filters[key] = select.value;
        renderMap();
        if (key === "borough") {
          if (select.value) zoomToLayer();
          else map.setView([40.73, -73.95], 11);
        }
      };
    }

    setupFilter("type-filter", "type", (e) => e.event_type);
    setupFilter("borough-filter", "borough", (e) => e.event_borough);
    setupFilter(
      "date-filter",
      "date",
      (e) => e.start_date_time.slice(0, 10),
      (d) =>
        new Date(d + "T00:00").toLocaleDateString([], {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
    );

    renderMap();
    document.querySelector(".filter-component").style.display = "block";
  });

document.getElementById("search").addEventListener("input", (ev) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filters.search = ev.target.value.trim().toLowerCase();
    renderMap();
  }, 300);
});

const tbody = document.querySelector("#events-table tbody");
tbody.addEventListener("mouseover", (ev) => {
  const row = ev.target.closest("tr");
  const l = row && layerByEvent.get(row.dataset.key);
  if (!l) return;
  l.setStyle({ color: "#dc2626", weight: 3 });
  l.bringToFront();
});
tbody.addEventListener("mouseout", (ev) => {
  const row = ev.target.closest("tr");
  const l = row && layerByEvent.get(row.dataset.key);
  if (l) l.setStyle({ color: "#3388ff", weight: 3 });
});

tbody.addEventListener("click", (ev) => {
  const row = ev.target.closest("tr");
  const l = row && layerByEvent.get(row.dataset.key);
  if (!l) return;
  map.fitBounds(l.getBounds(), { maxZoom: 17 });

  const f = l.feature;
  const name = featureName(f);
  L.popup({ maxHeight: 300 })
    .setLatLng(l.getBounds().getCenter())
    .setContent(popupShell(name, eventCount(f), featureCards(f, name, true)))
    .openOn(map);
});

function featuresAtCursor(ev) {
  const shapes = new Set(
    document.elementsFromPoint(
      ev.originalEvent.clientX,
      ev.originalEvent.clientY,
    ),
  );
  const hits = [];
  layer.eachLayer((l) => {
    const isGroup = Boolean(l.getLayers);
    const parts = isGroup ? l.getLayers() : [l];
    const partIndex = parts.findIndex((p) => shapes.has(p._path));
    if (partIndex >= 0) hits.push({ feature: l.feature, isGroup, partIndex });
  });
  return hits;
}

const featureName = (f) =>
  f.properties.display_name || f.properties.name || "Permitted Area";

const partName = (hit) =>
  (hit.feature.properties.part_names || [])[hit.partIndex] ||
  hit.feature.properties.display_name;

function showPopup(ev) {
  if (!layer) return;
  if (ev.originalEvent.target.closest(".leaflet-popup")) return;

  const hits = featuresAtCursor(ev);
  if (!hits.length) return;

  const singles = hits.filter((h) => !h.isGroup);
  const groups = hits.filter((h) => h.isGroup);
  const topSingle = singles[singles.length - 1];
  const topGroup = groups[groups.length - 1];

  // Header: the topmost single-place feature, else the part of the group selected.
  const title = topSingle ? featureName(topSingle.feature) : partName(topGroup);

  // Cards: that single-place feature's events, then any multi-location events.
  const shown = topSingle ? [topSingle, ...groups] : groups;
  const cards = shown
    .map((h, i) => featureCards(h.feature, title, i === 0))
    .join("");
  const count = shown.reduce((n, h) => n + eventCount(h.feature), 0);

  L.popup({ maxHeight: 300 })
    .setLatLng(ev.latlng)
    .setContent(popupShell(title, count, cards))
    .openOn(map);
}

map.on("click", (ev) => showPopup(ev));
let hoverTimer;
map.on("mousemove", (ev) => {
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => showPopup(ev), 300);
});
