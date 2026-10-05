import type { Map } from 'maplibre-gl';
import { color } from './palette.ts';

// MapLibre's demotiles style is a light pastel political map, and flight paths
// drawn over it read as noise. This repaints it in the night palette so the
// tracks carry the colour.
export function dimBasemap(map: Map): void {
    // Crimea's layer is drawn above the labels, which would leave it above the
    // daylight too; move it down onto the rest of the land.
    map.moveLayer('crimea-fill', 'countries-boundary');

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
