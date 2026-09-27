// Where the sun is at a given instant. It is placed with the low-precision
// formulae from the Astronomical Almanac, good to about a hundredth of a degree
// this century -- far finer than daylight on a globe the size of a screen can
// show. Everything here is pure, so it can be exercised without a map.

import type { LonLat } from './tracks.ts';

const RAD = Math.PI / 180;
const J2000 = 2451545.0;          // julian date of 2000-01-01 12:00 UT
const UNIX_EPOCH_JD = 2440587.5;  // julian date of 1970-01-01 00:00 UT

function wrapLon(lon: number): number {
    return ((((lon + 180) % 360) + 360) % 360) - 180;
}

// The point on the earth with the sun directly overhead at `ms` (a unix time in
// milliseconds), as [lon, lat].
export function subsolar(ms: number): LonLat {
    const n = ms / 86400000 + UNIX_EPOCH_JD - J2000;

    const meanLon = 280.460 + 0.9856474 * n;
    const anomaly = (357.528 + 0.9856003 * n) * RAD;
    const eclipticLon = (meanLon + 1.915 * Math.sin(anomaly) + 0.020 * Math.sin(2 * anomaly)) * RAD;
    const obliquity = (23.439 - 0.0000004 * n) * RAD;

    const ascension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLon), Math.cos(eclipticLon));
    const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
    const sidereal = 280.46061837 + 360.98564736629 * n;

    return [wrapLon(ascension / RAD - sidereal), declination / RAD];
}

// A point on the unit sphere, in the frame MapLibre's globe shaders use: y
// through the north pole, z through the meridian at longitude 0, and x
// through 90 degrees east.
export function toSphere([lon, lat]: LonLat): [number, number, number] {
    const cos = Math.cos(lat * RAD);
    return [Math.sin(lon * RAD) * cos, Math.sin(lat * RAD), Math.cos(lon * RAD) * cos];
}
