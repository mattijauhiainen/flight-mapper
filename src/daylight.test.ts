import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { globeMesh, addedLandLight } from './daylight.ts';

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

// The palette as style.css declares it, so the test checks the real colours.
function palette(name: string): string {
    const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!match) throw new Error(`--${name} is not in style.css`);
    return match[1];
}

const STRIDE = 6;   // mercator x, y, pole marker, then the unit normal

// Rounded, and with -0 folded into 0, so exact axes can be compared directly.
const tidy = (normal: number[]) => normal.map((c) => Math.round(c * 1e9) / 1e9 + 0);

function vertex(vertices: Float32Array, k: number) {
    const at = k * STRIDE;
    return {
        x: vertices[at],
        y: vertices[at + 1],
        pole: vertices[at + 2],
        normal: [vertices[at + 3], vertices[at + 4], vertices[at + 5]]
    };
}

test('globeMesh covers the mercator square and reaches both poles', () => {
    const { vertices } = globeMesh(8, 4);
    const all = Array.from({ length: vertices.length / STRIDE }, (_, k) => vertex(vertices, k));

    assert.equal(Math.min(...all.map((v) => v.x)), 0);
    assert.equal(Math.max(...all.map((v) => v.x)), 1);
    assert.equal(Math.min(...all.map((v) => v.y)), 0);
    assert.equal(Math.max(...all.map((v) => v.y)), 1);

    const north = all.filter((v) => v.pole < 0);
    const south = all.filter((v) => v.pole > 0);
    assert.equal(north.length, 9);
    assert.equal(south.length, 9);
    for (const v of north) assert.deepEqual(tidy(v.normal), [0, 0, 1]);
    for (const v of south) assert.deepEqual(tidy(v.normal), [0, 0, -1]);
});

test('globeMesh normals are unit length and its triangles stay in range', () => {
    const { vertices, indices } = globeMesh(8, 4);
    const count = vertices.length / STRIDE;

    for (let k = 0; k < count; k++) {
        const [x, y, z] = vertex(vertices, k).normal;
        assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-6, `vertex ${k}`);
    }
    assert.equal(indices.length % 3, 0);
    assert.ok(Math.max(...indices) < count);
});

test('globeMesh puts the middle of the square on the equator', () => {
    const { vertices } = globeMesh(8, 4);
    // Row 0 is the north pole, so mercator y = 0.5 is row 3; column 4 is
    // longitude 0, which lonLatToVector puts on +x.
    const v = vertex(vertices, 3 * 9 + 4);
    assert.equal(v.y, 0.5);
    assert.deepEqual(tidy(v.normal), [1, 0, 0]);
});

test('addedLandLight takes the night land to the day land', () => {
    // Exact only while --day-land has at least --map-land's share of every
    // channel; the land pass can only add light.
    const nightLand = palette('map-land');
    const dayLand = palette('day-land');
    const added = addedLandLight(nightLand, dayLand);
    const level = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;

    for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(level(nightLand, i) + added[i] - level(dayLand, i)) < 1e-9, `channel ${i}`);
    }
});

test('addedLandLight never takes light away', () => {
    const added = addedLandLight('#303030', '#206040');
    assert.deepEqual(added.map((c) => Math.round(c * 255)), [0, 48, 16]);
});
