import { color } from './palette.js';

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
}
