import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLOBE_PX, framingZoom, geodesic, greatCircleKm, separation, wrapLon } from './geo.js';

const HKG = [113.9185, 22.3089];
const STEPS = 64;

// Length of a polyline, leg by leg, which is how build_tracks.py measures a
// flown track: the arc's own length has to come out the same way.
function polylineKm(points) {
    let km = 0;
    for (let i = 1; i < points.length; i++) km += greatCircleKm(points[i - 1], points[i]);
    return km;
}

const close = (actual, expected, tolerance, what) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} vs ${expected}`);

test('wrapLon brings an unwrapped longitude back into [-180, 180]', () => {
    assert.equal(wrapLon(113), 113);
    assert.equal(wrapLon(240), -120);
    assert.equal(wrapLon(-200), 160);
    assert.equal(wrapLon(180), -180);
});

test('greatCircleKm measures the quarter worlds it should', () => {
    const quarter = (6371 * Math.PI) / 2;
    close(greatCircleKm([0, 0], [90, 0]), quarter, 1e-6, 'a quarter of the equator');
    close(greatCircleKm([0, 0], [0, 90]), quarter, 1e-6, 'equator to pole');
    close(greatCircleKm([0, 0], [180, 0]), quarter * 2, 1e-6, 'halfway round');
    assert.equal(greatCircleKm(HKG, HKG), 0);
});

test('greatCircleKm ignores which turn of the globe a longitude is written on', () => {
    close(greatCircleKm(HKG, [-122.4, 37.6]), greatCircleKm(HKG, [237.6, 37.6]), 1e-9, 'SFO');
});

test('a geodesic starts and ends exactly where it was told to', () => {
    for (const to of [[139.8, 35.5], [-0.45, 51.47], [237.6, 37.6], [0, -90]]) {
        const arc = geodesic(HKG, to, STEPS);
        assert.equal(arc.length, STEPS + 1);
        close(arc[0][0], HKG[0], 1e-9, 'start lon');
        close(arc[0][1], HKG[1], 1e-9, 'start lat');
        close(arc.at(-1)[0], to[0], 1e-9, 'end lon');
        close(arc.at(-1)[1], to[1], 1e-9, 'end lat');
    }
});

test('a geodesic is as long as the distance it spans', () => {
    for (const to of [[139.8, 35.5], [-0.45, 51.47], [-122.4, 37.6]]) {
        const direct = greatCircleKm(HKG, to);
        close(polylineKm(geodesic(HKG, to, STEPS)), direct, direct * 1e-4, 'arc length');
    }
});

test('along the equator the arc is the straight line it looks like', () => {
    const arc = geodesic([0, 0], [80, 0], 8);
    arc.forEach(([lon, lat], i) => {
        close(lon, i * 10, 1e-9, `vertex ${i} lon`);
        close(lat, 0, 1e-9, `vertex ${i} lat`);
    });
});

test('an even step count puts a vertex on the halfway point', () => {
    const arc = geodesic(HKG, [-0.45, 51.47], STEPS);
    const middle = arc[arc.length >> 1];
    close(
        greatCircleKm(HKG, middle),
        greatCircleKm(middle, [-0.45, 51.47]),
        1e-6,
        'the two halves'
    );
});

test('a geodesic stays in the frame its start was written in', () => {
    // Hong Kong to San Francisco crosses the antimeridian. The tracks run past
    // 180 into 181, 182 rather than jumping to -179, and the arc has to agree
    // or it will be drawn back the wrong way round the globe.
    const arc = geodesic(HKG, [237.6, 37.6], STEPS);
    for (let i = 1; i < arc.length; i++) {
        assert.ok(arc[i][0] > arc[i - 1][0], `longitude went backwards at vertex ${i}`);
        assert.ok(arc[i][0] - arc[i - 1][0] < 180, `longitude jumped at vertex ${i}`);
    }
    assert.ok(arc.some(([lon]) => lon > 180), 'the arc never ran past the antimeridian');
});

test('a track already written past the antimeridian keeps its turn of the globe', () => {
    const arc = geodesic([190, 10], [200, 20], 4);
    assert.ok(arc.every(([lon]) => lon > 180), 'the arc was wrapped back');
});

test('two points in the same place give an arc that stays there', () => {
    for (const point of geodesic(HKG, HKG, 4)) {
        close(point[0], HKG[0], 1e-9, 'lon');
        close(point[1], HKG[1], 1e-9, 'lat');
    }
});

test('framingZoom pulls back as the two ends get further apart', () => {
    const zooms = [5, 25, 80, 160].map((deg) => framingZoom(deg * (Math.PI / 180), 0, 1200, 800));
    for (let i = 1; i < zooms.length; i++) {
        assert.ok(zooms[i] < zooms[i - 1], `zoom rose from ${zooms[i - 1]} to ${zooms[i]}`);
    }
});

test('framingZoom pulls back further the nearer the centre is to a pole', () => {
    // Zoom here means the scale mercator would draw at the centre of the
    // screen, and mercator stretches by 1/cos(lat), so the same flight framed
    // over the pole needs a lower number for the same amount of globe. At 75N
    // -- where a Hong Kong to Toronto route crosses -- that is a factor of
    // four, which is two zoom levels.
    const arc = 40 * (Math.PI / 180);
    const equator = framingZoom(arc, 0, 1200, 800);
    const polar = framingZoom(arc, 75.4, 1200, 800);

    assert.ok(polar > 0 && equator < 4.5, 'neither end of this pair should be clamped');
    assert.ok(Math.abs(equator - polar - 2) < 0.05, `expected two levels, got ${equator - polar}`);
});

test('a polar flight is pinned to the widest view the globe offers', () => {
    // Hong Kong to Toronto crosses at about 75N and spans 113 degrees, which
    // asks for more globe than zoom 0 can give. It gets zoom 0.
    const arc = separation([113.9185, 22.3089], [-79.4, 43.6]);
    assert.equal(framingZoom(arc, 75.4, 1200, 800), 0);
});

test('framingZoom fits the short side, and stays within the globe zoom range', () => {
    const arc = separation([113.9185, 22.3089], [139.8, 35.5]);
    assert.ok(framingZoom(arc, 0, 400, 1200) < framingZoom(arc, 0, 1200, 1200), 'a narrow window');
    assert.equal(framingZoom(arc, 0, 1200, 400), framingZoom(arc, 0, 400, 1200), 'either way up');

    assert.ok(framingZoom(1e-9, 0, 1200, 800) <= 4.5, 'two fixes on top of each other');
    assert.ok(framingZoom(Math.PI, 0, 200, 200) >= 0, 'opposite sides of the world');
    assert.ok(framingZoom(Math.PI, 90, 200, 200) >= 0, 'and centred on the pole itself');
});

test('both ends of a framed arc land inside the viewport', () => {
    // The camera sits over the halfway point, so each end is half the arc from
    // it: on screen, half a chord across a globe of the size that zoom and that
    // centre latitude draw.
    const offset = (arc, lat, zoom) =>
        (Math.sin(arc / 2) * (GLOBE_PX / Math.cos(lat * (Math.PI / 180))) * 2 ** zoom) / 2;

    for (const [deg, lat] of [[4, 0], [12, 30], [25, 30], [50, 45], [80, 60], [113, 75]]) {
        const arc = deg * (Math.PI / 180);
        const [width, height] = [1200, 800];
        const zoom = framingZoom(arc, lat, width, height);
        if (zoom >= 4.5 || zoom <= 0) continue;   // clamped, and no longer promising a fit

        const room = Math.min(width, height) / 2;
        assert.ok(offset(arc, lat, zoom) < room, `${deg} degrees at ${lat}N ran off the screen`);
        assert.ok(offset(arc, lat, zoom) > room / 4, `${deg} degrees at ${lat}N left the globe tiny`);
    }
});
