import { color } from './palette.js';

const HKG = [113.9185, 22.3089];

export const EMPTY = { type: 'FeatureCollection', features: [] };

// A point on a path is at --flight-path as the aircraft passes over it and has
// cooled to --flight-path-cooled one trail-length of flying later, so the lit
// stretch travels with the aircraft and everything behind settles into context.
// Every feature carries a `fade` between 1 and 0 that the paint mixes across.
// Hover and selection override both.
//
// The colours are opaque, and the fade mixes between them rather than running
// through the alpha channel. Translucent paths would composite where tracks
// cross, so the crowded approaches to Hong Kong would burn brighter than any
// single track and a path's brightness would depend on what lay under it.
const DIM_WIDTH = 0.7;     // how much of the lit width a cooled path keeps
const MUTED_WIDTH = 0.45;  // and how much it keeps once another flight is selected
const MUTED_DOT = 0.12;    // the aircraft of an unselected flight, as a fraction of lit

// The lit width of a path at zoom 0, 3 and 7, and the width it takes when it is
// the one being pointed at -- which a selected path borrows, since a selection
// is the same claim on the eye that a hover is.
const WIDTHS = [[0, 0.5, 1.6], [3, 0.9, 2.6], [7, 2, 4]];

function mixFade(dim, lit) {
    return ['interpolate', ['linear'], ['get', 'fade'], 0, dim, 1, lit];
}

// Colour and width both read the same ladder. Hover stays outermost so a path
// can still be picked out while another flight is selected -- that is how you
// change your mind about which one you wanted. Under it, a selection splits the
// traffic into the chosen flight and the rest; with nothing selected the
// ordinary travelling fade comes through untouched.
//
// The selected id is a plain value rather than a feature-state: `flights-active`
// is rewritten every frame, and one in-progress flight is many pieces sharing an
// id, so the test belongs in the expression where it can be asked of every
// piece. Selection changes are rare, so rebuilding the paint costs nothing.
function ladder(selected, { hover, chosen, muted, fading }) {
    const rest = selected === null
        ? fading
        : ['case', ['==', ['get', 'id'], selected], chosen, muted];
    return ['case', ['boolean', ['feature-state', 'hover'], false], hover, rest];
}

function lineColor(selected) {
    return ladder(selected, {
        hover: color('flight-path-hover'),
        chosen: color('flight-path'),
        muted: color('flight-path-muted'),
        fading: mixFade(color('flight-path-cooled'), color('flight-path'))
    });
}

// A selected path is drawn lit end to end rather than carrying its travelling
// fade: it is being read against the arc beside it, and half of it faded out
// would make that comparison guesswork.
function lineWidth(selected) {
    const stops = [];
    for (const [zoom, lit, strong] of WIDTHS) {
        stops.push(zoom, ladder(selected, {
            hover: strong,
            chosen: strong,
            muted: lit * MUTED_WIDTH,
            fading: mixFade(lit * DIM_WIDTH, lit)
        }));
    }
    return ['interpolate', ['linear'], ['zoom'], ...stops];
}

// The dots ride the leading edge of a path, so they dim with it. Their own fade
// is scaled first, which is how the halo stays a fraction of the core.
function dotOpacity(selected, scale) {
    const own = scale === 1 ? ['get', 'fade'] : ['*', ['get', 'fade'], scale];
    if (selected === null) return own;
    return ['case', ['==', ['get', 'id'], selected], own, ['*', own, MUTED_DOT]];
}

// Clicking a path picks one flight out of the traffic: it alone stays lit while
// the rest recede. Passing null gives every layer its unselected paint back.
export function setSelection(map, selected) {
    for (const key of ['done', 'active']) {
        map.setPaintProperty(`flights-${key}-line`, 'line-color', lineColor(selected));
        map.setPaintProperty(`flights-${key}-line`, 'line-width', lineWidth(selected));
    }
    map.setPaintProperty('planes', 'circle-opacity', dotOpacity(selected, 1));
    map.setPaintProperty('planes', 'circle-stroke-opacity', dotOpacity(selected, 0.35));
}

// Settled paths and still-fading ones live in separate sources on purpose: the
// fading set is small and gets rewritten every frame, while the settled set is
// large and only changes when a path has finished fading.
export function addLayers(map) {
    for (const key of ['done', 'active']) {
        map.addSource(`flights-${key}`, { type: 'geojson', data: EMPTY, promoteId: 'id' });

        // A path is only 0.5-2px wide, which is a mean thing to ask anyone to
        // point at, so a wide transparent line rides along underneath purely as
        // the hover and click hit target. It has to stay visible to be
        // hit-tested — visibility none would take it out of the query entirely.
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
            paint: { 'line-color': lineColor(null), 'line-width': lineWidth(null) }
        });
    }

    // The shortest path the selected flight could have taken, drawn to be read
    // against the track rather than mistaken for one: cold, thin and dashed
    // where every flown path is warm and solid.
    map.addSource('geodesic', { type: 'geojson', data: EMPTY });

    map.addLayer({
        id: 'geodesic-line',
        type: 'line',
        source: 'geodesic',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
            'line-color': color('geodesic'),
            'line-dasharray': [3, 3],
            'line-opacity': 0.9,
            'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 3, 1.2, 7, 1.8]
        }
    });

    // Every one of these flights leaves from the same place, so the origin gets
    // a marker of its own to anchor the starburst. The far end of the arc gets
    // the matching one while a flight is selected, so the pair of them read as
    // the two ends the distances are measured between.
    map.addSource('origin', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: HKG } }
    });

    map.addSource('destination', { type: 'geojson', data: EMPTY });

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

    map.addLayer({
        id: 'destination-dot',
        type: 'circle',
        source: 'destination',
        paint: {
            'circle-radius': 3,
            'circle-color': color('geodesic-core'),
            'circle-stroke-width': 1,
            'circle-stroke-color': color('geodesic')
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
            'circle-opacity': dotOpacity(null, 1),
            'circle-stroke-width': 2,
            'circle-stroke-color': color('origin'),
            'circle-stroke-opacity': dotOpacity(null, 0.35)
        }
    });
}
