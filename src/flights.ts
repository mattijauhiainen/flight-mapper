import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection } from 'geojson';
import type { Map } from 'maplibre-gl';
import { color } from './palette.ts';

export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function hovered(yes: string | number, no: string | number): ExpressionSpecification {
    return ['case', ['boolean', ['feature-state', 'hover'], false], yes, no];
}

// Paths still being drawn and finished ones live in separate sources on
// purpose: the drawing set is small and gets rewritten every frame, while the
// finished set is large and only changes when a flight lands. One source for
// all of it would mean re-sending every point of all 168 paths every frame.
export function addLayers(map: Map): void {
    for (const key of ['done', 'active']) {
        map.addSource(`flights-${key}`, { type: 'geojson', data: EMPTY, promoteId: 'id' });

        // A path is only 0.5-2px wide, which is a mean thing to ask anyone to
        // point at, so a wide transparent line rides along underneath purely as
        // the hover hit target. It has to stay visible to be hit-tested —
        // visibility none would take it out of the query entirely.
        map.addLayer({
            id: `flights-${key}-hit`,
            type: 'line',
            source: `flights-${key}`,
            layout: { 'line-cap': 'butt', 'line-join': 'round' },
            paint: {
                'line-opacity': 0,
                'line-width': ['interpolate', ['linear'], ['zoom'], 0, 4, 3, 6, 7, 12]
            }
        });

        map.addLayer({
            id: `flights-${key}-line`,
            type: 'line',
            source: `flights-${key}`,
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

    // The leading edge of every path that is still being drawn.
    map.addSource('planes', { type: 'geojson', data: EMPTY });

    map.addLayer({
        id: 'planes',
        type: 'circle',
        source: 'planes',
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 1.8, 3, 2.6, 7, 4],
            'circle-color': color('flight-head'),
            'circle-stroke-width': 2,
            'circle-stroke-color': color('accent'),
            'circle-stroke-opacity': 0.35
        }
    });
}
