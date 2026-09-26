// Great-circle geometry: the shortest path over the sphere between two points,
// which is what a flown track gets measured against. Everything here is pure
// and works in plain [lon, lat] degrees, so it can be exercised without a map.

const RAD = Math.PI / 180;
const EARTH_KM = 6371;   // the mean radius scripts/build_tracks.py measures with

// Longitudes are unwrapped in the data so lines stay continuous across the
// antimeridian; point features and camera centres read better wrapped back
// into [-180, 180].
export function wrapLon(lon) {
    return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
}

// Trigonometry is periodic, so an unwrapped longitude of 240 lands in the same
// place as -120 and needs no wrapping on the way in.
function toVector([lon, lat]) {
    const phi = lat * RAD;
    const lambda = lon * RAD;
    const cos = Math.cos(phi);
    return [cos * Math.cos(lambda), cos * Math.sin(lambda), Math.sin(phi)];
}

function toLngLat([x, y, z]) {
    return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];
}

// The angle subtended at the centre of the earth, in radians.
export function separation(a, b) {
    const [ax, ay, az] = toVector(a);
    const [bx, by, bz] = toVector(b);
    return Math.acos(clamp(ax * bx + ay * by + az * bz, -1, 1));
}

export function greatCircleKm(a, b) {
    return separation(a, b) * EARTH_KM;
}

// The arc drawn beside a track has to live in the same frame the track does, or
// a trans-Pacific one whips back across the globe while its flight path stays
// put. So the arc is unwrapped the way build_tracks.py unwraps the fixes, then
// shifted to start on exactly the longitude it was handed.
function unwrapFrom(points, lon) {
    const out = [];
    let previous = points[0][0];
    let offset = 0;

    for (const [l, lat] of points) {
        if (l - previous > 180) offset -= 360;
        else if (previous - l > 180) offset += 360;
        previous = l;
        out.push([l + offset, lat]);
    }

    const shift = lon - out[0][0];
    return out.map(([l, lat]) => [l + shift, lat]);
}

// The great circle from a to b as `steps` segments. An even `steps` puts a
// vertex on the halfway point, which is what the camera centres on.
export function geodesic(a, b, steps) {
    const A = toVector(a);
    const B = toVector(b);
    const omega = separation(a, b);
    const sin = Math.sin(omega);
    const points = [];

    for (let k = 0; k <= steps; k++) {
        const f = k / steps;

        if (sin < 1e-9) {
            // Two fixes a few metres apart divide by a sine that has gone to
            // nothing, and a straight line between them is within a rounding
            // error of the arc anyway. Antipodes land here too, where there is
            // no shortest path to pick; no airport pair in the data is close
            // to half a world from Hong Kong.
            points.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
            continue;
        }

        const first = Math.sin((1 - f) * omega) / sin;
        const second = Math.sin(f * omega) / sin;
        points.push(toLngLat([
            A[0] * first + B[0] * second,
            A[1] * first + B[1] * second,
            A[2] * first + B[2] * second
        ]));
    }

    return unwrapFrom(points, a[0]);
}

// MapLibre draws the globe at the scale mercator would use at the centre of the
// screen, so at zoom 0 on the equator one world -- 512 css px -- is wrapped
// around the sphere and the ball is only 512/PI px across. It doubles with
// every zoom level.
export const GLOBE_PX = 512 / Math.PI;

// Mercator scale is what zoom means here, and mercator stretches by 1/cos(lat),
// so the same zoom draws a far bigger globe the further the centre is from the
// equator: over the pole of a Hong Kong to Toronto route it is four times the
// size it would be over the equator. Framing a polar flight without this puts
// both ends off the screen and round the back of the globe.
function globeDiameter(lat) {
    return GLOBE_PX / Math.max(Math.cos(lat * RAD), 1e-3);
}

// How much of the short side of the viewport the two ends may span. The model
// below is orthographic while MapLibre's globe camera is a perspective one,
// which compresses whatever is far from the centre of the screen -- so this
// errs towards pulling back too far rather than not far enough, and covers the
// panels sitting over the corners of the map at the same time.
const MARGIN = 1.75;

const MIN_ZOOM = 0;
const MAX_ZOOM = 4.5;

// The zoom at which both ends of an arc `arc` radians long, centred at `lat`,
// are on screen. Foreshortening means they sit a chord apart on the screen
// rather than an arc: a quarter of the world away is only sin(45) of a radius
// from the centre.
export function framingZoom(arc, lat, width, height) {
    const span = Math.max(Math.sin(arc / 2), 1e-4) * globeDiameter(lat);
    return clamp(Math.log2(Math.min(width, height) / (MARGIN * span)), MIN_ZOOM, MAX_ZOOM);
}
