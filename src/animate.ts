import type { Feature, Point, Position } from 'geojson';
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { EMPTY } from './flights.ts';
import * as panel from './panel.ts';
import type { FlightFeature, Tracks } from './tracks.ts';

// How long one run of the animation takes in real time. The whole recorded
// timeline, from the first departure to the last recorded position of the
// last flight still in the air, is squeezed into this.
const DURATION_MS = 72 * 1000;

// A flight as the animation tracks it.
//
// The data records each flight as a list of positions, each with the time it
// was recorded at: the aircraft was at coords[i] at times[i]. Times are
// seconds since the first departure of the day, the same unit as the playhead.
type Flight = {
    feature: FlightFeature;
    coords: Position[];
    times: number[];
    departs: number;
    arrives: number;
    // Index of the last recorded position the playhead has passed. It only
    // moves forward, so each frame carries on from where the previous one
    // stopped instead of searching the track from the start.
    lastPassed: number;
};

// Plays the day's departures on the map. Each frame moves a playhead through
// the recorded day, draws every flight in the air up to where it has got to,
// and reports the clock to the panel.
//
// A flight goes through three stages: waiting to depart, in the air, landed.
// Flights in the air are redrawn every frame; landed ones are handed to a
// separate map source that only changes when a flight lands (see addLayers).
export function animate(map: Map, data: Tracks): void {
    const sources = {
        landed: geojsonSource(map, 'flights-done'),
        inTheAir: geojsonSource(map, 'flights-active'),
        aircraft: geojsonSource(map, 'planes')
    };

    // In order of departure, so the next flight to take off is always at
    // flights[nextToDepart].
    const flights = data.features.map(toFlight).sort((a, b) => a.departs - b.departs);

    let nextToDepart = 0;
    let inTheAir: Flight[] = [];
    let landed: FlightFeature[] = [];
    let startedAt = 0;
    let running = false;

    panel.setTotal(flights.length);
    panel.onReplay(play);
    play();

    function play(): void {
        if (running) return;
        running = true;
        panel.offerReplay(false);
        reset();
        requestAnimationFrame(drawFrame);
    }

    function reset(): void {
        nextToDepart = 0;
        inTheAir = [];
        landed = [];
        for (const flight of flights) flight.lastPassed = 0;
        sources.landed.setData(EMPTY);
        sources.inTheAir.setData(EMPTY);
        sources.aircraft.setData(EMPTY);
        startedAt = performance.now();
    }

    function drawFrame(now: number): void {
        // How far through the run we are, 0 to 1. requestAnimationFrame's
        // timestamp can be slightly older than startedAt on the first frame,
        // hence the clamp at 0.
        const progress = Math.min(Math.max((now - startedAt) / DURATION_MS, 0), 1);

        // The playhead: the moment of the recorded day this frame shows, in
        // seconds since the first departure.
        const playhead = progress * data.span;

        takeOff(playhead);
        const anyLanded = land(playhead);

        const paths = inTheAir.map((flight) => pathSoFar(flight, playhead));

        if (anyLanded) {
            sources.landed.setData({ type: 'FeatureCollection', features: landed });
        }
        sources.inTheAir.setData({
            type: 'FeatureCollection',
            features: paths.map((path, i) => lineFeature(inTheAir[i], path))
        });
        sources.aircraft.setData({
            type: 'FeatureCollection',
            features: paths.map((path) => aircraftFeature(path[path.length - 1]))
        });

        panel.update({
            at: new Date((data.epoch + playhead) * 1000),
            airborne: inTheAir.length,
            departed: nextToDepart,
            progress
        });

        if (progress < 1) {
            requestAnimationFrame(drawFrame);
        } else {
            running = false;
            panel.offerReplay(true);
        }
    }

    // Moves every flight that has departed by the playhead into the air.
    function takeOff(playhead: number): void {
        while (nextToDepart < flights.length && flights[nextToDepart].departs <= playhead) {
            inTheAir.push(flights[nextToDepart]);
            nextToDepart++;
        }
    }

    // Moves every flight that has arrived by the playhead out of the air.
    // Returns whether any did.
    function land(playhead: number): boolean {
        const stillFlying = inTheAir.filter((flight) => flight.arrives > playhead);
        if (stillFlying.length === inTheAir.length) return false;

        for (const flight of inTheAir) {
            if (flight.arrives <= playhead) landed.push(flight.feature);
        }
        inTheAir = stillFlying;
        return true;
    }
}

function toFlight(feature: FlightFeature): Flight {
    const { times } = feature.properties;
    return {
        feature,
        coords: feature.geometry.coordinates,
        times,
        departs: times[0],
        arrives: times[times.length - 1],
        lastPassed: 0
    };
}

// The part of a flight's path flown by the playhead: every recorded position
// it has passed, and then where the aircraft is now.
//
// The playhead almost always falls between two recorded positions, often
// minutes apart. Ending the line at the last one passed would make it grow in
// jumps, so the final point is an estimate of where the aircraft is right now,
// found by moving along the straight line to the next recorded position in
// proportion to the time elapsed.
function pathSoFar(flight: Flight, playhead: number): Position[] {
    const { coords, times } = flight;

    while (flight.lastPassed < times.length - 1 && times[flight.lastPassed + 1] <= playhead) {
        flight.lastPassed++;
    }

    const passed = flight.lastPassed;
    const path = coords.slice(0, passed + 1);

    const from = coords[passed];
    const to = coords[passed + 1];
    if (to) {
        const fraction = (playhead - times[passed]) / (times[passed + 1] - times[passed]);
        path.push([
            from[0] + (to[0] - from[0]) * fraction,
            from[1] + (to[1] - from[1]) * fraction
        ]);
    }
    return path;
}

function lineFeature(flight: Flight, path: Position[]): FlightFeature {
    return {
        type: 'Feature',
        properties: flight.feature.properties,
        geometry: { type: 'LineString', coordinates: path }
    };
}

function aircraftFeature(position: Position): Feature<Point> {
    return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [normalizeLongitude(position[0]), position[1]] }
    };
}

// Longitude normally runs from -180 to 180, and jumps from one to the other
// at the antimeridian: the 180° line through the middle of the Pacific. A
// flight from Hong Kong to Los Angeles crosses it, so its recorded longitudes
// go ..., 178, 179, -179, -178, ... A line drawn through those would take the
// long way from 179 to -179, right round the globe the wrong way.
//
// To avoid that, scripts/build_tracks.py rewrites the longitudes to keep
// counting past 180 instead (..., 178, 179, 181, 182, ...), which lines draw
// correctly. A single point like the aircraft marker has no line to break,
// so it is brought back into the usual -180 to 180 range.
function normalizeLongitude(lon: number): number {
    return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function geojsonSource(map: Map, id: string): GeoJSONSource {
    const source = map.getSource<GeoJSONSource>(id);
    if (!source) throw new Error(`animate: source '${id}' has not been added`);
    return source;
}
