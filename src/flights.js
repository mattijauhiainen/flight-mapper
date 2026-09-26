import { color } from './palette.js';

const HKG = [113.9185, 22.3089];

export const EMPTY = { type: 'FeatureCollection', features: [] };

function hovered(yes, no) {
    return ['case', ['boolean', ['feature-state', 'hover'], false], yes, no];
}

// Paths still being drawn and finished ones live in separate sources on
// purpose: the drawing set is small and gets rewritten every frame, while the
// finished set is large and only changes when a flight lands. One source for
// all of it would mean re-sending every point of all 168 paths every frame.
export function addLayers(map) {
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
            'circle-stroke-color': color('origin'),
            'circle-stroke-opacity': 0.35
        }
    });
}
