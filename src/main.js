import { Map, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { dimBasemap } from './basemap.js';
import { addFlights } from './flights.js';

const map = new Map({
    container: 'map',
    style: 'https://demotiles.maplibre.org/globe.json',
    center: [114.17, 22.30],
    zoom: 2
});

map.addControl(new NavigationControl(), 'top-right');

// Start the download immediately rather than waiting on the map, and hang the
// layers off 'style.load' — 'load' also waits for the first basemap tiles,
// which needlessly delays the tracks on a slow connection.
const tracksReady = fetch(`${import.meta.env.BASE_URL}tracks.geojson`).then((r) => r.json());

map.on('style.load', async () => {
    dimBasemap(map);
    addFlights(map, await tracksReady);
});

export { map };
