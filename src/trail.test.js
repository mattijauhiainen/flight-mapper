import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fadeAt, positionAt, trailPieces } from './trail.js';

// A straight track due east at a tenth of a degree per second, so the position
// at any time t is simply [t / 10, 0] and every assertion below can be read
// without doing trigonometry in your head.
const START = 0;
const END = 300;
const TRAIL = 100;
const STEPS = 4;

function flight() {
    return {
        coords: [[0, 0], [10, 0], [20, 0], [30, 0]],
        times: [START, 100, 200, END],
        cursor: 0
    };
}

const at = (t) => [t / 10, 0];

// Every coordinate the pieces are made of, tail to head, with the seams
// collapsed: each piece starts where the one before it ended.
function drawn({ pieces }) {
    return pieces.reduce(
        (all, piece) => all.concat(piece.coordinates.slice(all.length ? 1 : 0)),
        []
    );
}

test('fadeAt runs from lit to cooled and clamps at both ends', () => {
    assert.equal(fadeAt(0, TRAIL), 1);
    assert.equal(fadeAt(TRAIL / 2, TRAIL), 0.5);
    assert.equal(fadeAt(TRAIL, TRAIL), 0);
    assert.equal(fadeAt(TRAIL * 10, TRAIL), 0, 'long past cooled stays at 0');
    assert.equal(fadeAt(-5, TRAIL), 1, 'a negative age cannot burn brighter than lit');
});

test('positionAt lands on fixes, interpolates between them and clamps outside', () => {
    assert.deepEqual(positionAt(flight(), 100), [10, 0]);
    assert.deepEqual(positionAt(flight(), 150), [15, 0]);
    assert.deepEqual(positionAt(flight(), -50), [0, 0]);
    assert.deepEqual(positionAt(flight(), 9999), [30, 0]);
});

test('positionAt gives the same answer from any cursor at or before the time', () => {
    for (const from of [0, 1, 2]) {
        assert.deepEqual(positionAt(flight(), 250, from), [25, 0]);
    }
});

test('at departure the path starts at the origin with no cooled tail', () => {
    const result = trailPieces(flight(), 40, TRAIL, STEPS);

    assert.equal(result.pieces.length, STEPS, 'no cooled piece yet');
    assert.deepEqual(drawn(result)[0], [0, 0]);
    assert.deepEqual(result.head, at(40));
    assert.equal(result.headFade, 1, 'the aircraft is always fully lit');
});

test('mid-flight the cooled tail reaches the origin and the lit stretch the aircraft', () => {
    const result = trailPieces(flight(), 250, TRAIL, STEPS);
    const [tail, ...lit] = result.pieces;

    assert.equal(lit.length, STEPS);
    assert.equal(tail.fade, 0);
    assert.deepEqual(tail.coordinates[0], [0, 0], 'the settled tail still starts at departure');
    assert.deepEqual(tail.coordinates.at(-1), at(150), 'and ends one trail behind the aircraft');
    assert.deepEqual(result.head, at(250));
    assert.equal(result.headFade, 1);
});

test('pieces join end to end, with no gap at any seam', () => {
    for (const sim of [10, 40, 99, 100, 175, 250, 299, END, 340, 395]) {
        const { pieces } = trailPieces(flight(), sim, TRAIL, STEPS);
        for (let i = 1; i < pieces.length; i++) {
            assert.deepEqual(
                pieces[i].coordinates[0],
                pieces[i - 1].coordinates.at(-1),
                `seam ${i} is broken at sim ${sim}`
            );
        }
    }
});

test('fade rises monotonically from the tail to the aircraft', () => {
    for (const sim of [40, 100, 175, 250, END, 340, 395]) {
        const { pieces, headFade } = trailPieces(flight(), sim, TRAIL, STEPS);
        const fades = pieces.map((piece) => piece.fade);
        for (let i = 1; i < fades.length; i++) {
            assert.ok(fades[i] >= fades[i - 1], `fade dips at piece ${i}, sim ${sim}`);
        }
        assert.ok(headFade >= fades.at(-1), `the aircraft is dimmer than its trail at sim ${sim}`);
        assert.ok(Math.min(...fades) >= 0 && Math.max(...fades) <= 1);
    }
});

test('real fixes stay in the geometry rather than being chorded across', () => {
    // Two steps span the whole track, so fixes 1 and 2 fall inside a step and
    // would be cut off by a straight line from one step boundary to the next.
    const result = trailPieces(flight(), END, TRAIL * 10, 2);
    const points = drawn(result);

    for (const fix of [[10, 0], [20, 0]]) {
        assert.ok(points.some((p) => p[0] === fix[0] && p[1] === fix[1]), `fix ${fix} was cut`);
    }
});

test('at touchdown the aircraft sits on the last fix, still fully lit', () => {
    const result = trailPieces(flight(), END, TRAIL, STEPS);

    assert.deepEqual(result.head, [30, 0]);
    assert.equal(result.headFade, 1);
});

test('after landing the trail keeps cooling while the aircraft stays put', () => {
    const half = trailPieces(flight(), END + TRAIL / 2, TRAIL, STEPS);
    assert.deepEqual(half.head, [30, 0], 'the aircraft does not run on past its last fix');
    assert.equal(half.headFade, 0.5);

    // One trail-length after the last fix the whole path has settled, which is
    // the moment animate.js hands it to the static source.
    const cold = trailPieces(flight(), END + TRAIL * 0.999, TRAIL, STEPS);
    assert.deepEqual(cold.head, [30, 0]);
    assert.ok(cold.headFade < 0.002);
    assert.ok(cold.pieces.every((piece) => piece.fade < 0.002), 'nothing is still burning');
});

test('the carried cursor gives the same answer as a fresh scan', () => {
    // animate.js reuses one flight object across every frame and only ever
    // moves its cursor forward; replaying the timeline on a single object has
    // to match starting from scratch at each instant.
    const carried = flight();
    for (let sim = 0; sim <= END + TRAIL; sim += 7) {
        assert.deepEqual(
            trailPieces(carried, sim, TRAIL, STEPS),
            trailPieces(flight(), sim, TRAIL, STEPS),
            `carried cursor diverged at sim ${sim}`
        );
    }
    assert.ok(carried.cursor > 0, 'the cursor did move');
});
