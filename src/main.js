import { Map, NavigationControl } from 'maplibre-gl';
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

function addFlights(data) {
    map.addSource('flights', { type: 'geojson', data, promoteId: 'id' });

    map.addLayer({
        id: 'flights-line',
        type: 'line',
        source: 'flights',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
            'line-color': PATH,
            'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 3, 0.9, 7, 2]
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

// Start the download immediately rather than waiting on the map, and hang the
// layers off 'style.load' — 'load' also waits for the first basemap tiles,
// which needlessly delays the tracks on a slow connection.
const tracksReady = fetch(`${import.meta.env.BASE_URL}tracks.geojson`).then((r) => r.json());

map.on('style.load', async () => {
    dimBasemap();
    addFlights(await tracksReady);
});

export { map };
