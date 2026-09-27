import type { LonLat } from './tracks.ts';

// Great-circle geometry: the shortest path over the sphere between two points,
// which is what a flown track gets measured against. Everything here is pure
// and works in plain [lon, lat] degrees, so it can be exercised without a map.

const RAD = Math.PI / 180;
const EARTH_KM = 6371;   // the mean radius scripts/build_tracks.py measures with

type Vector = [number, number, number];

// Longitude normally runs from -180 to 180, and jumps from one to the other
// at the antimeridian: the 180° line through the middle of the Pacific. A
// flight from Hong Kong to Los Angeles crosses it, so its recorded longitudes
// go ..., 178, 179, -179, -178, ... A line drawn through those would take the
// long way from 179 to -179, right round the globe the wrong way.
//
// To avoid that, scripts/build_tracks.py rewrites the longitudes to keep
// counting past 180 instead (..., 178, 179, 181, 182, ...), which lines draw
// correctly. A single point like the aircraft marker, or the centre of the
// camera, has no line to break, so it is brought back into the usual -180 to
// 180 range.
export function normalizeLongitude(lon: number): number {
    return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function clamp(value: number, low: number, high: number): number {
    return Math.max(low, Math.min(high, value));
}

// Trigonometry is periodic, so an unwrapped longitude of 240 lands in the same
// place as -120 and needs no wrapping on the way in.
function toVector([lon, lat]: LonLat): Vector {
    const phi = lat * RAD;
    const lambda = lon * RAD;
    const cos = Math.cos(phi);
    return [cos * Math.cos(lambda), cos * Math.sin(lambda), Math.sin(phi)];
}

function toLngLat([x, y, z]: Vector): LonLat {
    return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];
}

// The angle subtended at the centre of the earth, in radians.
export function separation(a: LonLat, b: LonLat): number {
    const [ax, ay, az] = toVector(a);
    const [bx, by, bz] = toVector(b);
    return Math.acos(clamp(ax * bx + ay * by + az * bz, -1, 1));
}

export function greatCircleKm(a: LonLat, b: LonLat): number {
    return separation(a, b) * EARTH_KM;
}

// The arc drawn beside a track has to live in the same frame the track does, or
// a trans-Pacific one whips back across the globe while its flight path stays
// put. So the arc is unwrapped the way build_tracks.py unwraps the fixes, then
// shifted to start on exactly the longitude it was handed.
function unwrapFrom(points: LonLat[], lon: number): LonLat[] {
    const out: LonLat[] = [];
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
export function geodesic(a: LonLat, b: LonLat, steps: number): LonLat[] {
    const A = toVector(a);
    const B = toVector(b);
    const omega = separation(a, b);
    const sin = Math.sin(omega);
    const points: LonLat[] = [];

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
function globeDiameter(lat: number): number {
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
export function framingZoom(arc: number, lat: number, width: number, height: number): number {
    const span = Math.max(Math.sin(arc / 2), 1e-4) * globeDiameter(lat);
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
