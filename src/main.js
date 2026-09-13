import { Map, NavigationControl, Popup } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { trailPieces } from './trail.js';

const HKG = [113.9185, 22.3089];

// The whole timeline — first departure to the last recorded fix — plays in 72s.
const DURATION_MS = 3 * 24 * 1000;

const EMPTY = { type: 'FeatureCollection', features: [] };

const map = new Map({
    container: 'map',
    style: 'https://demotiles.maplibre.org/globe.json',
    center: [114.17, 22.30],
    zoom: 2
});

map.addControl(new NavigationControl(), 'top-right');

// The demotiles style is a light pastel political map. Flight paths drawn over
// it read as noise, so dim it to a night palette and let the tracks carry the
// colour. Drop this call to get the stock basemap back.
function dimBasemap() {
    map.setPaintProperty('background', 'background-color', '#070c16');
    map.setPaintProperty('countries-fill', 'fill-color', '#151f2e');
    map.setPaintProperty('countries-boundary', 'line-color', '#25344a');
    map.setPaintProperty('countries-boundary', 'line-opacity', 0.5);
    map.setPaintProperty('coastline', 'line-color', '#1e2d42');
    map.setPaintProperty('geolines', 'line-color', '#131d2c');
    map.setPaintProperty('geolines-label', 'text-color', '#2b3a50');
    map.setPaintProperty('countries-label', 'text-color', '#59718f');
    map.setPaintProperty('countries-label', 'text-halo-color', 'rgba(7,12,22,0.8)');
}

function hovered(yes, no) {
    return ['case', ['boolean', ['feature-state', 'hover'], false], yes, no];
}

// A point on a path is at LIT as the aircraft passes over it and has cooled to
// DIM one TRAIL of flying later, so the lit stretch travels with the aircraft
// and everything behind settles into context. Every feature carries a `fade`
// between 1 and 0 that the paint mixes across. Hover overrides both.
//
// The colours are opaque, and the fade mixes between them rather than running
// through the alpha channel. Translucent paths would composite where tracks
// cross, so the crowded approaches to Hong Kong would burn brighter than any
// single track and a path's brightness would depend on what lay under it.
const TRAIL = 1.5 * 3600;   // flight seconds, ~3.5s of the 72s run
const TRAIL_STEPS = 10;     // steps the lit stretch is built from
const WIDTH = { dim: 0.7, lit: 1 };
const DIM = '#574a40';
const LIT = '#ffcf9b';
const HOVER = '#eafcff';

function mixFade(dim, lit) {
    return ['interpolate', ['linear'], ['get', 'fade'], 0, dim, 1, lit];
}

// Settled paths and still-fading ones live in separate sources on purpose: the
// fading set is small and gets rewritten every frame, while the settled set is
// large and only changes when a path has finished fading.
function addLayers() {
    for (const key of ['done', 'active']) {
        map.addSource(`flights-${key}`, { type: 'geojson', data: EMPTY, promoteId: 'id' });

        // A path is only 0.5-2px wide, which is a mean thing to ask anyone to
        // point at, so a wide transparent line rides along underneath purely as
        // the hover hit target. It has to stay visible to be hit-tested —
        // visibility none would take it out of the query entirely.
        map.addLayer({
            id: `flights-${key}-hit`,
            type: 'line',
            source: `flights-${key}`,
            layout: { 'line-cap': 'butt', 'line-join': 'round' },
            paint: {
                'line-opacity': 0,
                'line-width': ['interpolate', ['linear'], ['zoom'], 0, 4, 3, 6, 7, 12]
            }
        });

        map.addLayer({
            id: `flights-${key}-line`,
            type: 'line',
            source: `flights-${key}`,
            layout: { 'line-cap': 'butt', 'line-join': 'round' },
            paint: {
                'line-color': hovered(HOVER, mixFade(DIM, LIT)),
                'line-width': [
                    'interpolate', ['linear'], ['zoom'],
                    0, hovered(1.6, mixFade(0.5 * WIDTH.dim, 0.5)),
                    3, hovered(2.6, mixFade(0.9 * WIDTH.dim, 0.9)),
                    7, hovered(4, mixFade(2 * WIDTH.dim, 2))
                ]
            }
        });
    }

    map.addSource('origin', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: HKG } }
    });

    map.addLayer({
        id: 'origin-halo',
        type: 'circle',
        source: 'origin',
        paint: { 'circle-radius': 9, 'circle-color': '#ff8a3d', 'circle-opacity': 0.18 }
    });

    map.addLayer({
        id: 'origin-dot',
        type: 'circle',
        source: 'origin',
        paint: {
            'circle-radius': 3,
            'circle-color': '#fff3e4',
            'circle-stroke-width': 1,
            'circle-stroke-color': '#ff8a3d'
        }
    });

    // The leading edge of every path that is still being drawn.
    map.addSource('planes', { type: 'geojson', data: EMPTY });

    map.addLayer({
        id: 'planes',
        type: 'circle',
        source: 'planes',
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 1.8, 3, 2.6, 7, 4],
            'circle-color': '#fff6ea',
            'circle-opacity': ['get', 'fade'],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ff8a3d',
            'circle-stroke-opacity': ['*', ['get', 'fade'], 0.35]
        }
    });
}

// Longitudes are unwrapped in the data so lines stay continuous across the
// antimeridian; point features read better wrapped back into [-180, 180].
function wrapLon(lon) {
    return ((((lon + 180) % 360) + 360) % 360) - 180;
}

const hkOpts = { timeZone: 'Asia/Hong_Kong', hour12: false };
const clockFmt = new Intl.DateTimeFormat('en-GB', { ...hkOpts, hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-GB', { ...hkOpts, weekday: 'short', day: 'numeric', month: 'short' });

const ui = {
    clock: document.getElementById('clock'),
    date: document.getElementById('date'),
    airborne: document.getElementById('airborne'),
    departed: document.getElementById('departed'),
    total: document.getElementById('total'),
    bar: document.getElementById('bar'),
    replay: document.getElementById('replay')
};

const details = {};

function animate(data) {
    const flights = data.features.map((feature) => ({
        feature,
        coords: feature.geometry.coordinates,
        times: feature.properties.times,
        start: feature.properties.times[0],
        end: feature.properties.times[feature.properties.times.length - 1],
        cursor: 0
    }));

    // Everything the popup needs moves into a lookup, so the hundreds of
    // features rebuilt each frame can carry just an id and a fade. Settled is a
    // path's resting state, so the stored feature keeps fade 0.
    for (const flight of flights) {
        const { id, callsign, maxalt, times } = flight.feature.properties;
        details[id] = { callsign, maxalt, departure: times[0] };
        flight.id = id;
        flight.feature.properties = { id, fade: 0 };
    }

    ui.total.textContent = flights.length;

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

    function dot(point, fade) {
        return {
            type: 'Feature',
            properties: { fade },
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
        planes.push(dot(head, headFade));
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

        const clock = new Date((data.epoch + Math.min(sim, data.span)) * 1000);
        ui.clock.textContent = clockFmt.format(clock);
        ui.date.textContent = dateFmt.format(clock);
        ui.airborne.textContent = airborne;
        ui.departed.textContent = landed.length + flying.length;
        ui.bar.style.width = `${progress * 100}%`;

        if (progress < 1 || flying.length) {
            requestAnimationFrame(frame);
        } else {
            running = false;
            ui.replay.hidden = false;
        }
    }

    function play() {
        if (running) return;
        running = true;
        ui.replay.hidden = true;
        reset();
        requestAnimationFrame(frame);
    }

    ui.replay.addEventListener('click', play);
    play();
}

function wireHover(epoch) {
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    const depFmt = new Intl.DateTimeFormat('en-GB', { ...hkOpts, hour: '2-digit', minute: '2-digit' });
    let hover = null;

    function clear() {
        if (hover) map.setFeatureState(hover, { hover: false });
        hover = null;
    }

    for (const key of ['done', 'active']) {
        const source = `flights-${key}`;

        map.on('mousemove', `${source}-hit`, (e) => {
            const feature = e.features[0];
            if (!hover || hover.id !== feature.id || hover.source !== source) {
                clear();
                hover = { source, id: feature.id };
                map.setFeatureState(hover, { hover: true });
            }

            // An in-progress path is drawn as many pieces sharing one id, so
            // hovering any of them lights the whole flight and reads one entry.
            const flight = details[feature.id];
            if (!flight) return;

            map.getCanvas().style.cursor = 'pointer';
            popup
                .setLngLat(e.lngLat)
                .setHTML(
                    `<strong>${flight.callsign || feature.id}</strong>` +
                    `<span>dep ${depFmt.format(new Date((epoch + flight.departure) * 1000))} HKT` +
                    ` &middot; FL${Math.round(flight.maxalt / 100)}</span>`
                )
                .addTo(map);
        });

        map.on('mouseleave', `${source}-hit`, () => {
            clear();
            map.getCanvas().style.cursor = '';
            popup.remove();
        });
    }

}

// Start the download immediately rather than waiting on the map, and hang the
// layers off 'style.load' — 'load' also waits for the first basemap tiles,
// which needlessly delays the tracks on a slow connection.
const tracksReady = fetch(`${import.meta.env.BASE_URL}tracks.geojson`).then((r) => r.json());

map.on('style.load', async () => {
    dimBasemap();
    addLayers();
    const data = await tracksReady;
    animate(data);
    wireHover(data.epoch);
});

export { map };
