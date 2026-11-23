function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ts
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
}

export { formatTime, formatDate };
