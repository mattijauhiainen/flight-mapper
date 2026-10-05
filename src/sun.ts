import { normalizeLongitude } from './geo.ts';
import type { LonLat } from './tracks.ts';

// Where the sun is at a given instant, using the low-precision formulae from
// the Astronomical Almanac. They are accurate to about a hundredth of a degree
// this century.

const RAD = Math.PI / 180;
const J2000 = 2451545.0;          // julian date of 2000-01-01 12:00 UT
const UNIX_EPOCH_JD = 2440587.5;  // julian date of 1970-01-01 00:00 UT

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

    return [normalizeLongitude(ascension / RAD - sidereal), declination / RAD];
}

