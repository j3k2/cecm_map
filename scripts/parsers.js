const sportCodes = [
  // more specific first
  ["WHEELCHAIRFOOTBALL", "WFB"],
  ["FLAGFOOTBALL", "FFB"],
  ["LITTLELEAGUE", "BSB"],
  ["MULTIPURPOSE", "MPPA"],
  ["MULTIUSE", "MPPA"],
  ["BASKETBALL", "BKB"],
  ["BASEBALL", "BSB"],
  ["CRICKET", "CRK"],
  ["FRISBEE", "FRS"],
  ["FOOTBALL", "FTB"],
  ["HANDBALL", "HDB"],
  ["HOCKEY", "HKY"],
  ["KICKBALL", "KBL"],
  ["LACROSSE", "LCS"],
  ["NETBALL", "NTB"],
  ["RUGBY", "RBY"],
  ["SOCCER", "SCR"],
  ["SOFTBALL", "SFB"],
  ["TENNIS", "TNS"],
  ["TRACK", "TRK"],
  ["VOLLEYBALL", "VLB"],
];

function parseLocation(locationStr) {
  // Street segments formatted as "X between Y and Z":
  const match = locationStr.match(/^(.+?)\s+between\s+(.+?)\s+and\s+(.+)$/i);
  if (!match) return null;
  const [, onStreet, fromStreet, toStreet] = match.map((s) => s.trim());
  return { onStreet, fromStreet, toStreet };
}

function getSportCode(sportName) {
  const normalized = sportName.toUpperCase().replace(/[\s-]+/g, ""); // remove spaces and dashes
  let bestMatch = null;
  let bestIndex = Infinity;

  for (const [phrase, code] of sportCodes) {
    const index = normalized.indexOf(phrase);
    if (index !== -1 && index < bestIndex) {
      bestIndex = index;
      bestMatch = code;
    }
  }

  return bestMatch;
}

function parseFacilityText(eventFacility) {
  if (!eventFacility) return null;

  // Identify and separate `sportName` and `fieldId` by dash or space.
  // `fieldId` can be one letter, 1-3 numbers, or 1-3 numbers and one suffix letter.
  const match = eventFacility.match(
    /^(.+?)[\s-]+(\d{1,3}[A-Za-z]?|[A-Za-z])\b/,
  );
  if (match) {
    return { sportName: match[1].trim(), fieldId: match[2] };
  }

  return { sportName: eventFacility.trim(), fieldId: null };
}

function normalizeFieldId(n) {
  if (!n) return null;
  return n
    .replace(/[^a-zA-Z0-9]/g, "") // remove spaces/dashes/punctuation
    .replace(/^0+(?=\d)/, "") // remove leading zeroes
    .toUpperCase();
}

module.exports = {
  parseLocation,
  getSportCode,
  parseFacilityText,
  normalizeFieldId,
};
