// Approximate area in square miles (flat projection near NYC)
const METERS_PER_DEG_LAT = 110574;
const METERS_PER_DEG_LON = 111320 * Math.cos((40.7 * Math.PI) / 180);
const SQ_METERS_PER_SQ_MILE = 2589988;

function ringArea(ring) {
  // Shoelace formula for calculating the area of the linear ring of a polygon:
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] * METERS_PER_DEG_LON;
    const y1 = ring[i][1] * METERS_PER_DEG_LAT;
    const x2 = ring[i + 1][0] * METERS_PER_DEG_LON;
    const y2 = ring[i + 1][1] * METERS_PER_DEG_LAT;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function polygonArea([outer, ...holes]) {
  return ringArea(outer) - holes.reduce((sum, h) => sum + ringArea(h), 0);
}

function geometryArea(geometry) {
  if (geometry.type === "Polygon") {
    return polygonArea(geometry.coordinates) / SQ_METERS_PER_SQ_MILE;
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce(
      (sum, polygon) => sum + polygonArea(polygon) / SQ_METERS_PER_SQ_MILE,
      0,
    );
  }
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.reduce((sum, g) => sum + geometryArea(g), 0);
  }
  // Lines have 0 area:
  return 0;
}

module.exports = { geometryArea };
