import { Map, NavigationControl, Popup } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const HKG = [113.9185, 22.3089];

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

const PATH = '#ffcf9b';
const HOVER = '#eafcff';

function hovered(yes, no) {
    return ['case', ['boolean', ['feature-state', 'hover'], false], yes, no];
}

function addFlights(data) {
    map.addSource('flights', { type: 'geojson', data, promoteId: 'id' });

    // A path is only 0.5-2px wide, which is a mean thing to ask anyone to
    // point at, so a wide transparent line rides along underneath purely as
    // the hover hit target. It has to stay visible to be hit-tested —
    // visibility none would take it out of the query entirely.
    map.addLayer({
        id: 'flights-hit',
        type: 'line',
        source: 'flights',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
            'line-opacity': 0,
            'line-width': ['interpolate', ['linear'], ['zoom'], 0, 4, 3, 6, 7, 12]
        }
    });

    map.addLayer({
        id: 'flights-line',
        type: 'line',
        source: 'flights',
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
}

const depFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false
});

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

    map.on('mousemove', 'flights-hit', (e) => {
        const feature = e.features[0];
        if (!hover || hover.id !== feature.id) {
            clear();
            hover = { source: 'flights', id: feature.id };
            map.setFeatureState(hover, { hover: true });
        }

        // Properties can come back from the worker with arrays encoded as JSON
        // strings, so times needs parsing before it can be read.
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

    map.on('mouseleave', 'flights-hit', () => {
        clear();
        map.getCanvas().style.cursor = '';
        popup.remove();
    });
}

// Start the download immediately rather than waiting on the map, and hang the
// layers off 'style.load' — 'load' also waits for the first basemap tiles,
// which needlessly delays the tracks on a slow connection.
const tracksReady = fetch(`${import.meta.env.BASE_URL}tracks.geojson`).then((r) => r.json());

map.on('style.load', async () => {
    dimBasemap();
    const data = await tracksReady;
    addFlights(data);
    wireHover(data.epoch);
});

export { map };
