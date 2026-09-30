import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOLS_AFTER_SECONDS } from './path.ts';
import { startTimeline } from './timeline.ts';
import type { FlightFeature, Tracks } from './tracks.ts';

// Times below are counted in trail-lengths, as in path.test.ts.
const trailLengths = (count: number) => count * COOLS_AFTER_SECONDS;

// Two flights, listed out of departure order: 'late' departs at 2 and lands at
// 3, 'early' departs at 0 and lands at 1.
function day(): Tracks {
    return {
        type: 'FeatureCollection',
        epoch: 0,
        span: trailLengths(3),
        features: [flight('late', 2, 3), flight('early', 0, 1)]
    };
}

function flight(id: string, departs: number, lands: number): FlightFeature {
    return {
        type: 'Feature',
        properties: { id, callsign: '', dest: 'XXX', km: 0, times: [trailLengths(departs), trailLengths(lands)] },
        geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] }
    };
}

const litIds = (flights: { id: string }[]) => flights.map((flight) => flight.id);

test('a flight is lit from departure until its path has cooled after landing, then settles', () => {
    const timeline = startTimeline(day());

    let moment = timeline.advanceTo(trailLengths(0.5));
    assert.deepEqual(litIds(moment.pathsToRender), ['early']);
    assert.equal(moment.airborne, 1);
    assert.equal(moment.departed, 1);

    moment = timeline.advanceTo(trailLengths(1.5));
    assert.deepEqual(litIds(moment.pathsToRender), ['early'], 'landed but still cooling');
    assert.equal(moment.airborne, 0);
    assert.equal(moment.settledChanged, false);

    moment = timeline.advanceTo(trailLengths(2));
    assert.deepEqual(litIds(moment.pathsToRender), ['late'], 'early has cooled; late departs');
    assert.deepEqual(litIds(moment.settled), ['early']);
    assert.equal(moment.settledChanged, true);
    assert.equal(moment.departed, 2);

    moment = timeline.advanceTo(trailLengths(2.5));
    assert.equal(moment.settledChanged, false, 'nothing new settled');

    moment = timeline.advanceTo(trailLengths(4));
    assert.deepEqual(moment.pathsToRender, []);
    assert.deepEqual(litIds(moment.settled), ['early', 'late']);
    assert.equal(moment.settledChanged, true);
});

test('a new timeline starts from the beginning', () => {
    const data = day();
    startTimeline(data).advanceTo(trailLengths(4));

    const moment = startTimeline(data).advanceTo(trailLengths(0.5));
    assert.deepEqual(litIds(moment.pathsToRender), ['early']);
    assert.deepEqual(moment.settled, []);
    assert.deepEqual(moment.pathsToRender[0].pathToRender.aircraftPosition, [5, 0]);
});
