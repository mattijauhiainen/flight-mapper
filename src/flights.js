import { color } from './palette.js';

const HKG = [113.9185, 22.3089];

export function addFlights(map, data) {
    map.addSource('flights', { type: 'geojson', data, promoteId: 'id' });

    map.addLayer({
        id: 'flights-line',
        type: 'line',
        source: 'flights',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
            'line-color': color('flight-path'),
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
        paint: { 'circle-radius': 9, 'circle-color': color('origin'), 'circle-opacity': 0.18 }
    });

    map.addLayer({
        id: 'origin-dot',
        type: 'circle',
        source: 'origin',
        paint: {
            'circle-radius': 3,
            'circle-color': color('origin-core'),
            'circle-stroke-width': 1,
            'circle-stroke-color': color('origin')
        }
    });
}
