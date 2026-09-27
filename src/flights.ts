import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Map } from 'maplibre-gl';
import { color } from './palette.ts';
import type { Tracks } from './tracks.ts';

export function hovered(yes: string | number, no: string | number): ExpressionSpecification {
    return ['case', ['boolean', ['feature-state', 'hover'], false], yes, no];
}

export function addFlights(map: Map, data: Tracks): void {
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
            'line-color': hovered(color('flight-path-hover'), color('flight-path')),
            'line-width': [
                'interpolate', ['linear'], ['zoom'],
                0, hovered(1.6, 0.5),
                3, hovered(2.6, 0.9),
                7, hovered(4, 2)
            ]
        }
    });
}
