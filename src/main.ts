import { Map, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { dimBasemap } from './basemap.ts';
import { addLayers } from './layers.ts';
import { daylightLayer } from './daylight.ts';
import { color } from './palette.ts';
import { animate } from './animate.ts';
import { wireHover } from './hover.ts';
import { wireSelect } from './select.ts';
import type { Tracks } from './tracks.ts';

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
const tracksReady = fetch(`${import.meta.env.BASE_URL}tracks.geojson`).then((r) => r.json() as Promise<Tracks>);

map.on('style.load', async () => {
    dimBasemap(map);

    // Daylight lights the ground the aircraft fly over and never the aircraft
    // themselves, so it all goes in before the flights. The sea pass goes
    // straight after the sea, under everything painted on top of it; the land
    // and night passes slip in under the basemap's first label, so the names
    // read the same by day and by night. daylight.ts has why there are three.
    const passes = [daylightLayer('sea'), daylightLayer('land'), daylightLayer('night')];
    const styleLayers = map.getStyle().layers;
    const firstLabel = styleLayers.find((layer) => layer.type === 'symbol')?.id;
    map.addLayer(passes[0], styleLayers[styleLayers.findIndex((layer) => layer.type === 'background') + 1].id);
    map.addLayer(passes[1], firstLabel);
    map.addLayer(passes[2], firstLabel);
    const daylight = { setTime: (ms: number) => passes.forEach((pass) => pass.setTime(ms)) };

    const layers = addLayers(map);
    const data = await tracksReady;
    const muteHover = wireHover(map, data);
    wireSelect(map, data, layers, muteHover);
    animate(layers, data, daylight);
});

export { map };
