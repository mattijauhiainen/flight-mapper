import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACE, pace } from './camera.ts';

const close = (actual: number, expected: number, tolerance: number, what: string) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} vs ${expected}`);

test('the clock runs at full speed with the whole globe in view', () => {
    assert.equal(pace(2.6, 2.6), 1);
});

test('the clock never runs faster than full speed, however far out', () => {
    assert.equal(pace(0, 2.6), 1);
    assert.equal(pace(-3, 2.6), 1);
});

test('every zoom level closer in costs the clock the same share of its speed', () => {
    const step = 2 ** -PACE;
    for (const zoom of [3.6, 5, 7.25]) close(pace(zoom + 1, 2.6) / pace(zoom, 2.6), step, 1e-12, `at ${zoom}`);
});

test('the clock slows down as the camera closes in', () => {
    let previous = pace(2.6, 2.6);
    for (let zoom = 3; zoom <= 12; zoom += 0.5) {
        const now = pace(zoom, 2.6);
        assert.ok(now < previous, `sped up at ${zoom}`);
        previous = now;
    }
});
