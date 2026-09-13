import { Map, NavigationControl, Popup } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

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

const PATH = '#ffcf9b';
const HOVER = '#eafcff';

// Paths still being drawn and finished ones live in separate sources on
// purpose: the drawing set is small and gets rewritten every frame, while the
// finished set is large and only changes when a flight lands. One source for
// all of it would mean re-sending every point of all 168 paths every frame.
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
                'line-color': hovered(HOVER, PATH),
                'line-width': [
                    'interpolate', ['linear'], ['zoom'],
                    0, hovered(1.6, 0.5),
                    3, hovered(2.6, 0.9),
                    7, hovered(4, 2)
                ]
            }
        });
    }

    // Every one of these flights leaves from the same place, so the origin gets
    // a marker of its own to anchor the starburst.
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
            'circle-stroke-width': 2,
            'circle-stroke-color': 'rgba(255,138,61,0.35)'
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

function animate(data) {
    const flights = data.features.map((feature) => ({
        feature,
        coords: feature.geometry.coordinates,
        times: feature.properties.times,
        start: feature.properties.times[0],
        end: feature.properties.times[feature.properties.times.length - 1],
        cursor: 0
    }));

    ui.total.textContent = flights.length;

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

        const clock = new Date((data.epoch + sim) * 1000);
        ui.clock.textContent = clockFmt.format(clock);
        ui.date.textContent = dateFmt.format(clock);
        ui.airborne.textContent = flying.length;
        ui.departed.textContent = landed.length + flying.length;
        ui.bar.style.width = `${progress * 100}%`;

        if (progress < 1) {
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

const depFmt = new Intl.DateTimeFormat('en-GB', { ...hkOpts, hour: '2-digit', minute: '2-digit' });

// Hovering a path lights it and names the flight. Times in the data are
// seconds from the first departure, so the popup needs the collection's epoch
// to turn one back into a wall-clock time.
function wireHover(epoch) {
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 });
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

            // Properties can come back from the worker with arrays encoded as
            // JSON strings, so times needs parsing before it can be read.
            const p = feature.properties;
            const times = typeof p.times === 'string' ? JSON.parse(p.times) : p.times;

            map.getCanvas().style.cursor = 'pointer';
            popup
                .setLngLat(e.lngLat)
                .setHTML(
                    `<strong>${p.callsign || p.id}</strong>` +
                    `<span>dep ${depFmt.format(new Date((epoch + times[0]) * 1000))} HKT` +
                    ` &middot; FL${Math.round(p.maxalt / 100)}</span>`
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
