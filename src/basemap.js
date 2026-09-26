import { color } from './palette.js';

// MapLibre's demotiles style is a light pastel political map, and flight paths
// drawn over it read as noise. This repaints it in the night palette so the
// tracks carry the colour.
//
// Every label needs its halo repainted, not just its text. The stock halos are
// opaque white, sized to lift dark type off a pale map; over a night one a halo
// like that reads as fog with the label lost somewhere inside it, which is what
// the Tropic of Cancer and the rest of the graticule did.
//
// Crimea is the one piece of land painted from its own layer rather than
// countries-fill, so it needs a line of its own or it stays lilac.
export function dimBasemap(map) {
    map.setPaintProperty('background', 'background-color', color('map-ocean'));
    map.setPaintProperty('countries-fill', 'fill-color', color('map-land'));
    map.setPaintProperty('crimea-fill', 'fill-color', color('map-land'));
    map.setPaintProperty('countries-boundary', 'line-color', color('map-border'));
    map.setPaintProperty('countries-boundary', 'line-opacity', 0.5);
    map.setPaintProperty('coastline', 'line-color', color('map-coast'));
    map.setPaintProperty('geolines', 'line-color', color('map-graticule'));
    map.setPaintProperty('geolines-label', 'text-color', color('map-graticule-label'));
    map.setPaintProperty('geolines-label', 'text-halo-color', color('map-label-halo'));
    map.setPaintProperty('geolines-label', 'text-halo-width', 1.2);
    map.setPaintProperty('geolines-label', 'text-halo-blur', 0);
    map.setPaintProperty('countries-label', 'text-color', color('map-label'));
    map.setPaintProperty('countries-label', 'text-halo-color', color('map-label-halo'));
}
