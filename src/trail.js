// Geometry for the travelling fade. A point on a path is fully lit as the
// aircraft passes over it and has cooled to nothing one trail-length of flying
// later, so the lit stretch follows the aircraft and the path behind it settles
// down. MapLibre paints one opacity per feature, so the ramp cannot be a single
// line — it has to be built from short pieces, each carrying its own fade.
//
// Everything here is pure, and works in flight time (seconds from the start of
// the timeline), so it can be exercised without a map.

// How lit a point is, given how long ago the aircraft passed over it.
export function fadeAt(age, trail) {
    return Math.max(0, Math.min(1, 1 - age / trail));
}

// Position along a track at time t, scanning forward from vertex `from`.
export function positionAt(flight, t, from = 0) {
    const { coords, times } = flight;
    const last = times.length - 1;
    let i = from;
    while (i < last && times[i + 1] <= t) i++;
    if (i >= last) return coords[last];
    if (t <= times[i]) return coords[i];

    const step = times[i + 1] - times[i];
    const f = step > 0 ? (t - times[i]) / step : 0;
    return [
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * f,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * f
    ];
}

// The drawn part of a path at time `sim`, as the cooled tail (fade 0) followed
// by `steps` lit pieces. `flight.cursor` is carried between calls so repeated
// frames don't rescan the whole track; it only ever moves forward.
export function trailPieces(flight, sim, trail, steps) {
    const { coords, times } = flight;
    const last = times.length - 1;
    const cooled = sim - trail;
    const from = Math.max(cooled, times[0]);
    const to = Math.min(sim, times[last]);
    const pieces = [];

    while (flight.cursor < last && times[flight.cursor + 1] <= from) flight.cursor++;

    if (cooled > times[0]) {
        const cut = positionAt(flight, from, flight.cursor);
        pieces.push({ fade: 0, coordinates: [...coords.slice(0, flight.cursor + 1), cut] });
    }

    let vertex = flight.cursor;
    let previous = positionAt(flight, from, vertex);
    for (let k = 1; k <= steps; k++) {
        const t = from + ((to - from) * k) / steps;

        // Real fixes falling inside a step stay in the geometry, so the pieces
        // follow the track rather than chording across it.
        const between = [];
        while (vertex < last && times[vertex + 1] < t) between.push(coords[++vertex]);

        const point = positionAt(flight, t, vertex);
        const middle = t - (to - from) / (2 * steps);
        pieces.push({ fade: fadeAt(sim - middle, trail), coordinates: [previous, ...between, point] });
        previous = point;
    }

    return { pieces, head: previous, headFade: fadeAt(sim - to, trail) };
}
