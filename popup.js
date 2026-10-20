import { formatDate, formatTime } from "./format.js";

function shouldShowLocation(eventLocation, locationName) {
  if (!eventLocation || !locationName) return false;

  // Escape special regex characters in locationName (parentheses, brackets, etc.)
  const escaped = locationName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Strip out every occurrence of locationName
  const stripped = eventLocation.replace(new RegExp(escaped, "gi"), "");

  // Strip common delimiters/noise left behind (colons, dashes, spaces, commas, slashes)
  const remainder = stripped.replace(/[\s:,\/\-–—]+/g, "").trim();

  // If nothing alphanumeric remains, it was purely repetitive
  return remainder.length > 0;
}

function renderEventCard(e, isSubsequent, sharedProps, locationName) {
  const dateStr = formatDate(e.start_date_time);
  const timeRange = `${formatTime(e.start_date_time)} – ${formatTime(e.end_date_time)}`;
  const dividerClass = isSubsequent ? "event-divider" : "";

  const extraBadges = [];
  if (e.street_closure_type && e.street_closure_type !== "N/A") {
    extraBadges.push(
      `<span class="badge badge-neutral">${e.street_closure_type}</span>`,
    );
  }
  if (sharedProps.surface_type) {
    extraBadges.push(
      `<span class="badge badge-neutral">${sharedProps.surface_type}</span>`,
    );
  }

  return `
          <div class="${dividerClass}">
          <div class="event-title">${e.event_name || "Event"}</div>

          <div class="event-type">
              <span class="badge badge-primary">${e.event_type || "Event"}</span>
          </div>

          <div class="event-badges">
              ${e.event_borough ? `<span class="badge badge-neutral">${e.event_borough}</span>` : ""}
              ${e.event_agency ? `<span class="badge badge-neutral">${e.event_agency}</span>` : ""}
              ${extraBadges.join(" ")}
          </div>

          <div class="event-time">${dateStr ? `${dateStr} · ` : ""}${timeRange}</div>

          ${shouldShowLocation(e.event_location, locationName) ? `<div class="event-loc">${e.event_location}</div>` : ""}
          </div>
      `;
}

const onEachFeature = (feature, layer) => {
  const p = feature.properties || {};
  const events =
    Array.isArray(p.events) && p.events.length > 0 ? p.events : [p];
  const locationName = p.display_name || p.name || "Permitted Area";

  let eventCardsHtml = "";
  for (let i = 0; i < events.length; i++) {
    eventCardsHtml += renderEventCard(events[i], i > 0, p, locationName);
  }

  const popupHtml = `
                <div class="popup-body">
                  <div class="popup-header">
                    <strong>${locationName}</strong> ${events.length > 1 ? `(${events.length} events)` : ""}
                  </div>
                  ${eventCardsHtml}
                </div>
              `;

  layer.bindPopup(popupHtml, { maxHeight: 300 });
};

export { onEachFeature };
