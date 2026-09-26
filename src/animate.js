import { EMPTY } from './flights.js';
import { wrapLon } from './geo.js';
import { trailPieces } from './trail.js';
import * as panel from './panel.js';

// The whole timeline — first departure to the last recorded fix — plays in 72s.
const DURATION_MS = 3 * 24 * 1000;

const TRAIL = 1.5 * 3600;   // flight seconds, ~3.5s of the 72s run
const TRAIL_STEPS = 10;     // steps the lit stretch is built from

// Runs the timeline and returns what it took out of the features on the way:
// everything the popup and the selection overlay need, keyed by flight id. The
// hundreds of features rebuilt each frame carry just an id and a fade, so the
// callsign and the rest have to live somewhere the per-frame work never
// touches -- including the two ends of the track, which are all the geodesic
// and the camera need of a geometry that is otherwise redrawn piecemeal.
export function animate(map, data) {
    const flights = data.features.map((feature) => ({
        feature,
        coords: feature.geometry.coordinates,
        times: feature.properties.times,
        start: feature.properties.times[0],
        end: feature.properties.times[feature.properties.times.length - 1],
        cursor: 0
    }));

    // Settled is a path's resting state, so the stored feature keeps fade 0.
    const details = {};
    for (const flight of flights) {
        const { id, callsign, dest, km, times } = flight.feature.properties;
        details[id] = {
            id,
            callsign,
            dest,
            km,
            departure: times[0],
            from: flight.coords[0],
            to: flight.coords[flight.coords.length - 1]
        };
        flight.id = id;
        flight.feature.properties = { id, fade: 0 };
    }

    panel.setTotal(flights.length);

    let waiting;   // not yet departed, latest first so pop() takes the earliest
    let flying;    // departed, still carrying some lit trail
    let landed;    // fully cooled, already handed to the static source
    let startedAt;
    let running = false;

    function reset() {
        waiting = flights.slice().reverse();
        flying = [];
        landed = [];
        for (const flight of flights) flight.cursor = 0;
        map.getSource('flights-done').setData(EMPTY);
        map.getSource('flights-active').setData(EMPTY);
        map.getSource('planes').setData(EMPTY);
        startedAt = performance.now();
    }

    function dot(flight, point, fade) {
        return {
            type: 'Feature',
            properties: { id: flight.id, fade },
            geometry: { type: 'Point', coordinates: [wrapLon(point[0]), point[1]] }
        };
    }

    function piece(flight, coordinates, fade) {
        return {
            type: 'Feature',
            properties: { id: flight.id, fade },
            geometry: { type: 'LineString', coordinates }
        };
    }

    // Wraps the drawn part of a path into features the map can take.
    function trail(flight, sim, lines, planes) {
        const { pieces, head, headFade } = trailPieces(flight, sim, TRAIL, TRAIL_STEPS);
        for (const part of pieces) lines.push(piece(flight, part.coordinates, part.fade));
        planes.push(dot(flight, head, headFade));
    }

    function frame(now) {
        // The clock stops at the last fix, but time keeps running underneath so
        // the trails still burning at that point can finish cooling.
        const sim = ((now - startedAt) / DURATION_MS) * data.span;
        const progress = Math.min(sim / data.span, 1);

        while (waiting.length && waiting[waiting.length - 1].start <= sim) {
            flying.push(waiting.pop());
        }

        const active = [];
        const planes = [];
        let airborne = 0;
        let anySettled = false;

        for (let i = flying.length - 1; i >= 0; i--) {
            const flight = flying[i];
            if (sim - TRAIL >= flight.end) {
                landed.push(flight.feature);
                flying.splice(i, 1);
                anySettled = true;
                continue;
            }
            if (sim < flight.end) airborne++;
            trail(flight, sim, active, planes);
        }

        if (anySettled) {
            map.getSource('flights-done').setData({ type: 'FeatureCollection', features: landed });
        }
        map.getSource('flights-active').setData({ type: 'FeatureCollection', features: active });
        map.getSource('planes').setData({ type: 'FeatureCollection', features: planes });

        panel.update({
            at: new Date((data.epoch + Math.min(sim, data.span)) * 1000),
            airborne,
            departed: landed.length + flying.length,
            progress
        });

        if (progress < 1 || flying.length) {
            requestAnimationFrame(frame);
        } else {
            running = false;
            panel.offerReplay(true);
        }
    }

    function play() {
        if (running) return;
        running = true;
        panel.offerReplay(false);
        reset();
        requestAnimationFrame(frame);
    }

    panel.onReplay(play);
    play();

    return details;
}
