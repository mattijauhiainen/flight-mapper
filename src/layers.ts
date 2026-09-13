import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Geometry, LineString, Point } from 'geojson';
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { normalizeLongitude } from './geo.ts';
import { color } from './palette.ts';
import type { Flight, FlightPathToRender } from './timeline.ts';
import type { LonLat } from './tracks.ts';

const SOURCES = {
    settled: 'flights-done',
    lit: 'flights-active',
    aircraft: 'planes',
    geodesic: 'geodesic',
    destination: 'destination'
};

// The two sources paths are drawn into. Each has a hit layer (see addLayers)
// that hover and selection listen on.
export const PATH_SOURCES = [SOURCES.settled, SOURCES.lit];

export function hitLayerId(pathSource: string): string {
    return `${pathSource}-hit`;
}

function lineLayerId(pathSource: string): string {
    return `${pathSource}-line`;
}

// Draws the flights into the sources addLayers set up.
export type FlightLayers = {
    drawLit(pathsToRender: FlightPathToRender[]): void;
    drawSettled(flights: Flight[]): void;
    clear(): void;
    // Picks one flight out of the traffic: it alone stays lit while the rest
    // recede, and `arc` is drawn beside it, ending in a marker at the far end.
    select(id: string, arc: LonLat[]): void;
    clearSelection(): void;
};

// What every path and aircraft drawn on the map carries. The id is what hover
// lights a flight by and what the paint picks out a selected flight by, and the
// fade is what the paint mixes a feature between
// lit (1) and cooled (0) with. Nothing else is copied onto the features, since
// the lit ones are rebuilt every frame.
type DrawnProperties = { id: string; fade: number };

// A paint value: a literal colour or width, or an expression that works one out.
type Paint = ExpressionSpecification | string | number;

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

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

// Settled paths and still-fading ones live in separate sources on purpose: the
// fading set is small and gets rewritten every frame, while the settled set is
// large and only changes when a path has finished fading.
export function addLayers(map: Map): FlightLayers {
    for (const source of PATH_SOURCES) {
        map.addSource(source, { type: 'geojson', data: EMPTY, promoteId: 'id' });

        // A path is only 0.5-2px wide, which is a mean thing to ask anyone to
        // point at, so a wide transparent line rides along underneath purely as
        // the hover and click hit target. It has to stay visible to be
        // hit-tested — visibility none would take it out of the query entirely.
        map.addLayer({
            id: hitLayerId(source),
            type: 'line',
            source,
            layout: { 'line-cap': 'butt', 'line-join': 'round' },
            paint: {
                'line-opacity': 0,
                'line-width': ['interpolate', ['linear'], ['zoom'], 0, 4, 3, 6, 7, 12]
            }
        });

        map.addLayer({
            id: lineLayerId(source),
            type: 'line',
            source,
            layout: { 'line-cap': 'butt', 'line-join': 'round' },
            paint: { 'line-color': lineColor(null), 'line-width': lineWidth(null) }
        });
    }

    // The shortest path the selected flight could have taken, drawn to be read
    // against the track rather than mistaken for one: cold, thin and dashed
    // where every flown path is warm and solid.
    map.addSource(SOURCES.geodesic, { type: 'geojson', data: EMPTY });

    map.addLayer({
        id: 'geodesic-line',
        type: 'line',
        source: SOURCES.geodesic,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
            'line-color': color('geodesic'),
            'line-dasharray': [3, 3],
            'line-opacity': 0.9,
            'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 3, 1.2, 7, 1.8]
        }
    });

    // The far end of the arc gets a marker while a flight is selected, so it
    // reads as the end the distance is measured to.
    map.addSource(SOURCES.destination, { type: 'geojson', data: EMPTY });

    map.addLayer({
        id: 'destination-dot',
        type: 'circle',
        source: SOURCES.destination,
        paint: {
            'circle-radius': 3,
            'circle-color': color('geodesic-core'),
            'circle-stroke-width': 1,
            'circle-stroke-color': color('geodesic')
        }
    });

    // The leading edge of every path that is still being drawn.
    map.addSource(SOURCES.aircraft, { type: 'geojson', data: EMPTY });

    map.addLayer({
        id: 'planes',
        type: 'circle',
        source: SOURCES.aircraft,
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 1.8, 3, 2.6, 7, 4],
            'circle-color': color('flight-head'),
            'circle-opacity': dotOpacity(null, 1),
            'circle-stroke-width': 2,
            'circle-stroke-color': color('accent'),
            'circle-stroke-opacity': dotOpacity(null, 0.35)
        }
    });

    return flightLayers(map);
}

function lineColor(selected: string | null): ExpressionSpecification {
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
function lineWidth(selected: string | null): ExpressionSpecification {
    const stops: Paint[] = [];
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
type Rungs = { hover: Paint; chosen: Paint; muted: Paint; fading: Paint };

function ladder(selected: string | null, { hover, chosen, muted, fading }: Rungs): ExpressionSpecification {
    const rest: Paint = selected === null
        ? fading
        : ['case', ['==', ['get', 'id'], selected], chosen, muted];
    return ['case', ['boolean', ['feature-state', 'hover'], false], hover, rest];
}

function mixFade(dim: Paint, lit: Paint): ExpressionSpecification {
    return ['interpolate', ['linear'], ['get', 'fade'], 0, dim, 1, lit];
}

// The dots ride the leading edge of a path, so they dim with it. Their own fade
// is scaled first, which is how the halo stays a fraction of the core.
function dotOpacity(selected: string | null, scale: number): ExpressionSpecification {
    const own: ExpressionSpecification = scale === 1 ? ['get', 'fade'] : ['*', ['get', 'fade'], scale];
    if (selected === null) return own;
    return ['case', ['==', ['get', 'id'], selected], own, ['*', own, MUTED_DOT]];
}

function flightLayers(map: Map): FlightLayers {
    const sources = {
        settled: geojsonSource(map, SOURCES.settled),
        lit: geojsonSource(map, SOURCES.lit),
        aircraft: geojsonSource(map, SOURCES.aircraft),
        geodesic: geojsonSource(map, SOURCES.geodesic),
        destination: geojsonSource(map, SOURCES.destination)
    };

    return {
        drawLit(pathsToRender) {
            const segments: Feature<LineString, DrawnProperties>[] = [];
            const aircraft: Feature<Point, DrawnProperties>[] = [];
            for (const { id, pathToRender } of pathsToRender) {
                for (const segment of pathToRender.segments) {
                    segments.push(lineFeature(id, segment.positions, segment.fade));
                }
                aircraft.push(aircraftFeature(id, pathToRender.aircraftPosition, pathToRender.aircraftFade));
            }
            sources.lit.setData({ type: 'FeatureCollection', features: segments });
            sources.aircraft.setData({ type: 'FeatureCollection', features: aircraft });
        },

        // A settled path has cooled end to end, so it is one line at fade 0.
        drawSettled(flights) {
            const features = flights.map((flight) => lineFeature(flight.id, flight.path.positions, 0));
            sources.settled.setData({ type: 'FeatureCollection', features });
        },

        clear() {
            sources.settled.setData(EMPTY);
            sources.lit.setData(EMPTY);
            sources.aircraft.setData(EMPTY);
        },

        select(id, arc) {
            paintSelection(map, id);
            sources.geodesic.setData(collectionOf({ type: 'LineString', coordinates: arc }));
            const [lon, lat] = arc[arc.length - 1];
            sources.destination.setData(collectionOf({ type: 'Point', coordinates: [normalizeLongitude(lon), lat] }));
        },

        clearSelection() {
            paintSelection(map, null);
            sources.geodesic.setData(EMPTY);
            sources.destination.setData(EMPTY);
        }
    };
}

// Passing null gives every layer its unselected paint back.
function paintSelection(map: Map, selected: string | null): void {
    for (const source of PATH_SOURCES) {
        map.setPaintProperty(lineLayerId(source), 'line-color', lineColor(selected));
        map.setPaintProperty(lineLayerId(source), 'line-width', lineWidth(selected));
    }
    map.setPaintProperty('planes', 'circle-opacity', dotOpacity(selected, 1));
    map.setPaintProperty('planes', 'circle-stroke-opacity', dotOpacity(selected, 0.35));
}

function collectionOf(geometry: Geometry): FeatureCollection {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] };
}

function geojsonSource(map: Map, id: string): GeoJSONSource {
    const source = map.getSource<GeoJSONSource>(id);
    if (!source) throw new Error(`layers: source '${id}' has not been added`);
    return source;
}

function lineFeature(id: string, path: LonLat[], fade: number): Feature<LineString, DrawnProperties> {
    return {
        type: 'Feature',
        properties: { id, fade },
        geometry: { type: 'LineString', coordinates: path }
    };
}

function aircraftFeature(id: string, position: LonLat, fade: number): Feature<Point, DrawnProperties> {
    return {
        type: 'Feature',
        properties: { id, fade },
        geometry: { type: 'Point', coordinates: [normalizeLongitude(position[0]), position[1]] }
    };
}
