import { EMPTY } from './flights.js';
import * as panel from './panel.js';

// The whole timeline — first departure to the last recorded fix — plays in 72s.
const DURATION_MS = 3 * 24 * 1000;

// Longitudes are unwrapped in the data so lines stay continuous across the
// antimeridian; point features read better wrapped back into [-180, 180].
function wrapLon(lon) {
    return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function animate(map, data) {
    const flights = data.features.map((feature) => ({
        feature,
        coords: feature.geometry.coordinates,
        times: feature.properties.times,
        start: feature.properties.times[0],
        end: feature.properties.times[feature.properties.times.length - 1],
        cursor: 0
    }));

    panel.setTotal(flights.length);

    let waiting;   // not yet departed, latest first so pop() takes the earliest
    let flying;    // being drawn right now
    let landed;    // finished, already handed to the static source
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

    function dot(point) {
        return {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [wrapLon(point[0]), point[1]] }
        };
    }

    // The drawn part of a path: every fix reached so far, plus an interpolated
    // head so the line grows smoothly between fixes rather than snapping from
    // one sample to the next. The cursor only ever moves forward, so no frame
    // rescans a track it has already walked.
    function partial(flight, sim) {
        const { coords, times } = flight;
        while (flight.cursor < times.length - 1 && times[flight.cursor + 1] <= sim) {
            flight.cursor++;
        }
        const k = flight.cursor;
        const drawn = coords.slice(0, k + 1);

        const next = coords[k + 1];
        if (next) {
            const t = (sim - times[k]) / (times[k + 1] - times[k]);
            drawn.push([
                coords[k][0] + (next[0] - coords[k][0]) * t,
                coords[k][1] + (next[1] - coords[k][1]) * t
            ]);
        }
        return drawn;
    }

    function frame(now) {
        const progress = Math.min((now - startedAt) / DURATION_MS, 1);
        const sim = progress * data.span;

        while (waiting.length && waiting[waiting.length - 1].start <= sim) {
            flying.push(waiting.pop());
        }

        const active = [];
        const planes = [];
        let anyLanded = false;

        for (let i = flying.length - 1; i >= 0; i--) {
            const flight = flying[i];
            if (sim >= flight.end) {
                landed.push(flight.feature);
                flying.splice(i, 1);
                anyLanded = true;
                continue;
            }
            const drawn = partial(flight, sim);
            active.push({
                type: 'Feature',
                properties: flight.feature.properties,
                geometry: { type: 'LineString', coordinates: drawn }
            });
            planes.push(dot(drawn[drawn.length - 1]));
        }

        if (anyLanded) {
            map.getSource('flights-done').setData({ type: 'FeatureCollection', features: landed });
        }
        map.getSource('flights-active').setData({ type: 'FeatureCollection', features: active });
        map.getSource('planes').setData({ type: 'FeatureCollection', features: planes });

        panel.update({
            at: new Date((data.epoch + sim) * 1000),
            airborne: flying.length,
            departed: landed.length + flying.length,
            progress
        });

        if (progress < 1) {
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
}
