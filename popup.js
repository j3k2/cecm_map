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

function featureCards(feature, locationName, isFirstGroup) {
  const p = feature.properties || {};
  const events =
    Array.isArray(p.events) && p.events.length > 0 ? p.events : [p];
  return events
    .map((e, i) => renderEventCard(e, !isFirstGroup || i > 0, p, locationName))
    .join("");
}

function eventCount(feature) {
  const p = feature.properties || {};
  return Array.isArray(p.events) && p.events.length > 0 ? p.events.length : 1;
}

function popupShell(name, count, cards) {
  return `
    <div class="popup-body">
      <div class="popup-header">
        <strong>${name}</strong> ${count > 1 ? `(${count} events)` : ""}
      </div>
      ${cards}
    </div>
  `;
}

export { featureCards, eventCount, popupShell };
