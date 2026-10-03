import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LonLat } from './tracks.ts';
import { subsolar, toSphere } from './sun.ts';

function near(actual: number, expected: number, tolerance: number, message: string) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `${message}: ${actual} is not within ${tolerance} of ${expected}`
    );
}

test('subsolar puts the sun over the equator at the March equinox', () => {
    // 2025-03-20 09:01 UTC
    const [, lat] = subsolar(Date.UTC(2025, 2, 20, 9, 1));
    near(lat, 0, 0.02, 'declination');
});

test('subsolar puts the sun over the tropic at the June solstice', () => {
    // 2025-06-21 02:42 UTC
    const [, lat] = subsolar(Date.UTC(2025, 5, 21, 2, 42));
    near(lat, 23.44, 0.02, 'declination');
});

test('subsolar tracks the equation of time on the day of the data', () => {
    // On 21 Feb the sun runs about 13.8 minutes slow, so at noon UTC it has
    // not yet reached Greenwich: it is about 3.4 degrees east of it, over a
    // latitude about 10.4 degrees south.
    const [lon, lat] = subsolar(Date.UTC(2025, 1, 21, 12));
    near(lon, 3.45, 0.1, 'longitude');
    near(lat, -10.37, 0.05, 'declination');
});

test('subsolar moves west fifteen degrees an hour', () => {
    const [a] = subsolar(Date.UTC(2025, 1, 21, 0));
    const [b] = subsolar(Date.UTC(2025, 1, 21, 1));
    near(((a - b + 540) % 360) - 180, 15, 0.05, 'hourly step');
});

test('toSphere lays the axes out the way the globe shaders do', () => {
    const cases: [LonLat, number[]][] = [
        [[0, 0], [0, 0, 1]],
        [[90, 0], [1, 0, 0]],
        [[0, 90], [0, 1, 0]],
        [[180, -90], [0, -1, 0]]
    ];
    for (const [lngLat, expected] of cases) {
        toSphere(lngLat).forEach((v, i) => near(v, expected[i], 1e-12, `${lngLat} axis ${i}`));
    }
});
