import { Map, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { dimBasemap } from './basemap.ts';
import { addLayers } from './layers.ts';
import { daylightLayer } from './daylight.ts';
import { color } from './palette.ts';
import { startPlayer } from './animate.ts';
import { START_ZOOM, clockPace, flyToCity, followDepartures } from './camera.ts';
import { CITIES, cityFromUrl, putCityInUrl } from './cities.ts';
import { loadDay } from './day.ts';
import { wireHover } from './hover.ts';
import { wireSelect } from './select.ts';
import { revealWhenDrawn } from './loader.ts';
import * as panel from './panel.ts';

// How long the trip to another city takes: the camera's flight there and the
// rewind of the day on the map.
const SWITCH_MS = 4000;

const city = cityFromUrl();

const map = new Map({
    container: 'map',
    style: 'https://demotiles.maplibre.org/globe.json',
    center: city.origin,
    zoom: START_ZOOM
});

map.addControl(new NavigationControl(), 'top-right');

// Start the download immediately rather than waiting on the map, and hang the
// layers off 'style.load' rather than 'load', so their sources load alongside
// the first basemap tiles instead of after them.
const firstDay = loadDay(city);

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
    let day = await firstDay;
    const muteHover = wireHover(map, () => day);
    const clearSelection = wireSelect(map, () => day, layers, muteHover);
    const player = startPlayer(layers, daylight, () => clockPace(map));
    panel.setCity(city);
    panel.onCityChange(switchCity);
    await revealWhenDrawn(map);
    player.play(day, followDepartures(map, city.origin));

    // Picking a city flies the camera there while the day on the map runs
    // backwards, and plays the new city's day once both are done and its
    // tracks are in. A city picked on the way takes over from wherever the
    // clock has got to.
    let latestSwitch = 0;
    async function switchCity(id: string) {
        const next = CITIES.find((city) => city.id === id);
        if (!next) return;
        const thisSwitch = ++latestSwitch;
        putCityInUrl(next);
        panel.setCity(next);
        clearSelection();
        const nextDay = loadDay(next);
        const flight = flyToCity(map, next.origin, SWITCH_MS);
        await player.rewind(SWITCH_MS, next.firstDepartureMs);
        const loaded = await nextDay;
        flight.stopWatching();
        // Another city was picked while this one was rewinding or loading.
        // That switch plays its own day, so this one stops here.
        if (thisSwitch !== latestSwitch) return;
        day = loaded;
        player.play(day, flight.viewerTookCamera() ? () => {} : followDepartures(map, next.origin));
    }
});

export { map };
