import { Map, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const map = new Map({
    container: 'map',
    style: 'https://demotiles.maplibre.org/globe.json',
    center: [114.17, 22.30],
    zoom: 2
});

map.addControl(new NavigationControl(), 'top-right');

export { map };
