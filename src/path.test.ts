import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOLS_AFTER_SECONDS, LIT_SEGMENTS, fadeAt, pathToRenderAt, positionAt } from './path.ts';
import type { Path, PathToRender } from './path.ts';
import type { LonLat } from './tracks.ts';

// Times below are counted in trail-lengths: trailLengths(2.5) is two and a
// half times as long as a point takes to cool.
const trailLengths = (count: number) => count * COOLS_AFTER_SECONDS;

// A straight path due east, one recorded position per trail-length and ten degrees between
// them, so the position after any number of trail-lengths n is simply
// [n * 10, 0] and every assertion below can be read without doing
// trigonometry in your head.
const END = trailLengths(3);

const path: Path = {
    positions: [[0, 0], [10, 0], [20, 0], [30, 0]],
    timesSeconds: [0, trailLengths(1), trailLengths(2), END]
};

const at = (trailLengths: number): LonLat => [trailLengths * 10, 0];

// Every coordinate the segments are made of, tail to aircraft, with the seams
// collapsed: each segment starts where the one before it ended.
function drawn({ segments }: PathToRender): LonLat[] {
    return segments.reduce<LonLat[]>(
        (all, segment) => all.concat(segment.positions.slice(all.length ? 1 : 0)),
        []
    );
}

test('fadeAt runs from lit to cooled and clamps at both ends', () => {
    assert.equal(fadeAt(0), 1);
    assert.equal(fadeAt(trailLengths(0.5)), 0.5);
    assert.equal(fadeAt(trailLengths(1)), 0);
    assert.equal(fadeAt(trailLengths(10)), 0, 'long past cooled stays at 0');
    assert.equal(fadeAt(-5), 1, 'a negative age cannot burn brighter than lit');
});

test('positionAt lands on recorded positions, interpolates between them and clamps outside', () => {
    assert.deepEqual(positionAt(path, trailLengths(1)), [10, 0]);
    assert.deepEqual(positionAt(path, trailLengths(1.5)), [15, 0]);
    assert.deepEqual(positionAt(path, -trailLengths(0.5)), [0, 0]);
    assert.deepEqual(positionAt(path, trailLengths(99)), [30, 0]);
});

test('positionAt gives the same answer from any search index at or before the time', () => {
    for (const from of [0, 1, 2]) {
        assert.deepEqual(positionAt(path, trailLengths(2.5), from), [25, 0]);
    }
});

test('at departure the path starts at the origin with no cooled tail', () => {
    const result = pathToRenderAt(path, trailLengths(0.4)).pathToRender;

    assert.equal(result.segments.length, LIT_SEGMENTS, 'no cooled segment yet');
    assert.deepEqual(drawn(result)[0], [0, 0]);
    assert.deepEqual(result.aircraftPosition, at(0.4));
    assert.equal(result.aircraftFade, 1, 'the aircraft is always fully lit');
});

test('mid-flight the cooled tail reaches the origin and the lit stretch the aircraft', () => {
    const result = pathToRenderAt(path, trailLengths(2.5)).pathToRender;
    const [tail, ...lit] = result.segments;

    assert.equal(lit.length, LIT_SEGMENTS);
    assert.equal(tail.fade, 0);
    assert.deepEqual(tail.positions[0], [0, 0], 'the settled tail still starts at departure');
    assert.deepEqual(tail.positions.at(-1), at(1.5), 'and ends one trail behind the aircraft');
    assert.deepEqual(result.aircraftPosition, at(2.5));
    assert.equal(result.aircraftFade, 1);
});

test('segments join end to end, with no gap at any seam', () => {
    for (const now of [0.1, 0.4, 0.99, 1, 1.75, 2.5, 2.99, 3, 3.4, 3.95].map(trailLengths)) {
        const { segments } = pathToRenderAt(path, now).pathToRender;
        for (let i = 1; i < segments.length; i++) {
            assert.deepEqual(
                segments[i].positions[0],
                segments[i - 1].positions.at(-1),
                `seam ${i} is broken at now ${now}`
            );
        }
    }
});

test('fade rises monotonically from the tail to the aircraft', () => {
    for (const now of [0.4, 1, 1.75, 2.5, 3, 3.4, 3.95].map(trailLengths)) {
        const { segments, aircraftFade } = pathToRenderAt(path, now).pathToRender;
        const fades = segments.map((segment) => segment.fade);
        for (let i = 1; i < fades.length; i++) {
            assert.ok(fades[i] >= fades[i - 1], `fade dips at segment ${i}, now ${now}`);
        }
        assert.ok(aircraftFade >= fades[fades.length - 1], `the aircraft is dimmer than its trail at now ${now}`);
        assert.ok(Math.min(...fades) >= 0 && Math.max(...fades) <= 1);
    }
});

test('recorded positions stay in the line rather than being cut across', () => {
    // A path with a corner just past halfway, so at touchdown the position at the
    // corner falls inside a segment of the lit stretch rather than on a seam, and
    // a straight line from one seam to the next would cut the corner off.
    const cornered: Path = {
        positions: [[0, 0], [5, 5], [10, 0]],
        timesSeconds: [0, trailLengths(0.55), trailLengths(1)]
    };
    const points = drawn(pathToRenderAt(cornered, trailLengths(1)).pathToRender);

    assert.ok(points.some((p) => p[0] === 5 && p[1] === 5), 'the corner was cut');
});

test('at touchdown the aircraft sits on the last recorded position, still fully lit', () => {
    const result = pathToRenderAt(path, END).pathToRender;

    assert.deepEqual(result.aircraftPosition, [30, 0]);
    assert.equal(result.aircraftFade, 1);
});

test('after landing the trail keeps cooling while the aircraft stays put', () => {
    const half = pathToRenderAt(path, END + trailLengths(0.5)).pathToRender;
    assert.deepEqual(half.aircraftPosition, [30, 0], 'the aircraft does not run on past its last position');
    assert.equal(half.aircraftFade, 0.5);

    // One trail-length after landing the whole path has settled, which is
    // the moment the timeline hands it to the static source.
    const cold = pathToRenderAt(path, END + trailLengths(0.999)).pathToRender;
    assert.deepEqual(cold.aircraftPosition, [30, 0]);
    assert.ok(cold.aircraftFade < 0.002);
    assert.ok(cold.segments.every((segment) => segment.fade < 0.002), 'nothing is still burning');
});

test('the carried litStartIndex gives the same answer as a fresh scan', () => {
    // The timeline passes each frame's litStartIndex back in as the next
    // frame's searchFromIndex; carrying it through a replay of the day has to
    // match starting from scratch at each instant.
    let litStartIndex = 0;
    for (let now = 0; now <= END + trailLengths(1); now += trailLengths(0.07)) {
        const carried = pathToRenderAt(path, now, litStartIndex);
        assert.deepEqual(carried, pathToRenderAt(path, now), `carried litStartIndex diverged at now ${now}`);
        litStartIndex = carried.litStartIndex;
    }
    assert.ok(litStartIndex > 0, 'litStartIndex did move');
});
