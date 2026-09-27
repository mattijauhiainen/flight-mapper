import type { LonLat } from './tracks.ts';

// Great-circle geometry on a spherical earth: distances, the shortest path
// between two points, and the zoom that frames such a path on the globe.

const RAD = Math.PI / 180;
const EARTH_KM = 6371;   // the mean radius scripts/build_tracks.py measures with

// The great circle from a to b as `steps` segments. An even `steps` puts a
// vertex on the halfway point, which is what the camera centres on. The
// longitudes continue past ±180 the way the tracks' do (see normalizeLongitude),
// starting from a's.
export function geodesic(a: LonLat, b: LonLat, steps: number): LonLat[] {
    const A = lonLatToVector(a);
    const B = lonLatToVector(b);
    const omega = separation(a, b);
    const sin = Math.sin(omega);
    const points: LonLat[] = [];

    for (let k = 0; k <= steps; k++) {
        const f = k / steps;

        if (sin < 1e-9) {
            // a and b are the same point or opposite each other, and the
            // formula below would divide by zero. A straight line is close
            // enough for the first case; no destination in the data is near
            // opposite Hong Kong.
            points.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
            continue;
        }

        const first = Math.sin((1 - f) * omega) / sin;
        const second = Math.sin(f * omega) / sin;
        points.push(vectorToLonLat([
            A[0] * first + B[0] * second,
            A[1] * first + B[1] * second,
            A[2] * first + B[2] * second
        ]));
    }

    return unwrapFrom(points, a[0]);
}

export function greatCircleKm(a: LonLat, b: LonLat): number {
    return separation(a, b) * EARTH_KM;
}

// The angle between a and b seen from the centre of the earth, in radians.
export function separation(a: LonLat, b: LonLat): number {
    const [ax, ay, az] = lonLatToVector(a);
    const [bx, by, bz] = lonLatToVector(b);
    return Math.acos(clamp(ax * bx + ay * by + az * bz, -1, 1));
}

// The diameter in CSS px of the globe at zoom 0 with the centre of the screen on
// the equator. MapLibre wraps one 512 px mercator world around the sphere, so
// it is 512 / PI. It doubles with every zoom level.
export const GLOBE_PX = 512 / Math.PI;

// The shorter side of the viewport is this many times the on-screen distance
// between the two ends. framingZoom models the globe as an orthographic
// projection, but MapLibre's camera has perspective, which squeezes points far
// from the centre; this is generous enough to cover that and to keep the ends
// clear of the panels in the corners.
const MARGIN = 1.75;

const MIN_ZOOM = 0;
const MAX_ZOOM = 4.5;

// The zoom at which both ends of an arc `arcRadians` long, centred at latitude
// `lat`, fit in a `width` x `height` px viewport. On screen the ends are a chord
// apart, sin(arcRadians / 2) of the globe's diameter.
export function framingZoom(arcRadians: number, lat: number, width: number, height: number): number {
    const span = Math.max(Math.sin(arcRadians / 2), 1e-4) * globeDiameter(lat);
    return clamp(Math.log2(Math.min(width, height) / (MARGIN * span)), MIN_ZOOM, MAX_ZOOM);
}

// MapLibre's camera looks down from 0.5 / tan(fov / 2) heights of the viewport
// above the centre of the screen, and its fov defaults to 36.87 degrees, whose
// half has a tangent of exactly a third.
const CAMERA_HEIGHTS = 1.5;

// Past the point where the whole ball fits across the short side of the screen,
// zooming out only adds empty space around it: nothing more of the world comes
// into view. This is as far back as the opening camera ever pulls.
//
// Seen from that close, the ball looks a good deal smaller than the diameter
// the zoom gives it -- a globe exactly as wide as the screen on paper fills only
// seven tenths of it -- so the fit is solved for the camera. A globe of radius R
// seen from d above its near side has an outline of R d / sqrt(d^2 + 2 d R) on
// the screen; setting that to half the short side, h, gives the R below.
export function globeZoom(lat: number, width: number, height: number): number {
    const h = Math.min(width, height) / 2;
    const d = CAMERA_HEIGHTS * height;
    const radius = (h * h + h * Math.hypot(h, d)) / d;
    return Math.log2((2 * radius) / globeDiameter(lat));
}

// Which way b lies from a, as the camera sees it looking straight down on a
// with north up: radians clockwise from the top of the screen. The globe camera
// is an azimuthal projection about the centre of the screen, so a point shows
// on the screen in exactly the direction the great circle leaves for it.
export function bearing(a: LonLat, b: LonLat): number {
    const [phi1, phi2] = [a[1] * RAD, b[1] * RAD];
    const dLambda = (b[0] - a[0]) * RAD;
    return Math.atan2(
        Math.sin(dLambda) * Math.cos(phi2),
        Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda)
    );
}

// The closest zoom that keeps `point` inside a viewport centred on `center`,
// `inset` px in from its edges -- the zoom at which it sits right on that edge.
//
// A point theta round the globe from the centre sits R sin(theta) out from the
// axis and R (1 - cos(theta)) further from the camera than the centre does, so
// the camera, d above the near side, puts it R sin(theta) d / (d + R (1 -
// cos(theta))) from the middle of the screen, in the direction of its bearing.
// Setting that to how far the edge is in that direction and solving for R
// gives the radius, and so the zoom.
//
// Zooming in never pushes a point out past d sin(theta) / (1 - cos(theta)):
// that is where the horizon sits, and a point that far round never leaves the
// screen at any zoom, so it asks for none and gets Infinity. So does anything
// past a quarter of the world, which is round the back of the globe.
export function edgeZoom(center: LonLat, point: LonLat, width: number, height: number, inset: number): number {
    const theta = separation(center, point);
    if (theta >= Math.PI / 2) return Infinity;

    const beta = bearing(center, point);
    const across = Math.abs(Math.sin(beta));
    const up = Math.abs(Math.cos(beta));
    const room = Math.min(
        across > 1e-9 ? (width / 2 - inset) / across : Infinity,
        up > 1e-9 ? (height / 2 - inset) / up : Infinity
    );

    const d = CAMERA_HEIGHTS * height;
    const below = Math.sin(theta) * d - room * (1 - Math.cos(theta));
    if (below <= 0) return Infinity;

    return Math.log2((2 * ((room * d) / below)) / globeDiameter(center[1]));
}

// Longitude normally runs from -180 to 180, and jumps from one to the other
// at the antimeridian: the 180° line through the middle of the Pacific. A
// flight from Hong Kong to Los Angeles crosses it, so its recorded longitudes
// go ..., 178, 179, -179, -178, ... A line drawn through those would go from
// 179 to -179 the long way round the globe.
//
// To avoid that, scripts/build_tracks.py rewrites the longitudes to keep
// counting past 180 instead (..., 178, 179, 181, 182, ...), which lines draw
// correctly. A single point, like the aircraft marker or the centre of the
// camera, has no line to break, so it is brought back into the usual -180 to
// 180 range.
export function normalizeLongitude(lon: number): number {
    return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export type Vector = [number, number, number];

// A point on the unit sphere: x through longitude 0 on the equator, y through
// 90°E on the equator, z through the north pole. Longitudes past 180 need no
// normalizing first: sin and cos give the same result for 240 as for -120.
export function lonLatToVector([lon, lat]: LonLat): Vector {
    const phi = lat * RAD;
    const lambda = lon * RAD;
    const cos = Math.cos(phi);
    return [cos * Math.cos(lambda), cos * Math.sin(lambda), Math.sin(phi)];
}

function vectorToLonLat([x, y, z]: Vector): LonLat {
    return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];
}

// Rewrites the longitudes of `points` to continue past ±180 instead of
// jumping, the way scripts/build_tracks.py does for the tracks, then shifts
// them so the first one is `startLon`. Without this, an arc beside a track that
// crosses the antimeridian would be drawn the long way round the globe.
function unwrapFrom(points: LonLat[], startLon: number): LonLat[] {
    const unwrapped: LonLat[] = [];
    let previousLon = points[0][0];
    let offset = 0;

    for (const [lon, lat] of points) {
        if (lon - previousLon > 180) offset -= 360;
        else if (previousLon - lon > 180) offset += 360;
        previousLon = lon;
        unwrapped.push([lon + offset, lat]);
    }

    const shift = startLon - unwrapped[0][0];
    return unwrapped.map(([lon, lat]) => [lon + shift, lat]);
}

// The globe's diameter at zoom 0 with the centre of the screen at latitude
// `lat`. MapLibre scales the globe as mercator would at the centre of the
// screen, which grows by 1 / cos(lat) away from the equator, so the same zoom
// draws a bigger globe nearer the poles.
function globeDiameter(lat: number): number {
    return GLOBE_PX / Math.max(Math.cos(lat * RAD), 1e-3);
}

function clamp(value: number, low: number, high: number): number {
    return Math.max(low, Math.min(high, value));
}
