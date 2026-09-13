import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Geometry, LineString, Point } from 'geojson';
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { normalizeLongitude } from './geo.ts';
import { color } from './palette.ts';
import type { Flight, FlightPathToRender } from './timeline.ts';
import type { LonLat } from './tracks.ts';

const SOURCES = {
    settled: 'flights-settled',
    lit: 'flights-lit',
    aircraft: 'aircraft',
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
    // Draws flight `id` lit end to end and dims the others, and draws `arc` with
    // a dot at its far end.
    select(id: string, arc: LonLat[]): void;
    clearSelection(): void;
};

// The properties of every path and aircraft feature. Anything else about a
// flight is looked up by its id (see flightsById).
type DrawnProperties = {
    // The flight. Hover and selection find a flight's features by it.
    id: string;
    // 1 where the aircraft has just passed, falling to 0 as the path cools.
    // The paint interpolates the colour and width of a path, and the opacity
    // of an aircraft, by it.
    fade: number;
};

// A paint value: a literal colour or width, or an expression that works one out.
type Paint = ExpressionSpecification | string | number;

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

// A path is drawn in --flight-path where `fade` is 1 and --flight-path-cooled
// where it is 0, and at full width down to DIM_WIDTH of it. Hover and selection
// override both.
//
// The colours are opaque. With transparency, overlapping paths near Hong Kong
// would add up and look brighter than a single path.
const DIM_WIDTH = 0.7;     // how much of the lit width a cooled path keeps
const MUTED_WIDTH = 0.45;  // how much of the lit width an unselected path keeps
const MUTED_DOT = 0.12;    // how much of its opacity an unselected aircraft keeps

// [zoom, lit width, highlighted width], in px. Hovered and selected paths are
// highlighted.
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

    // The great-circle arc of the selected flight: thin, dashed and in a cold
    // colour so it is not mistaken for a flight path.
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

    // A dot at the destination end of the arc.
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
        id: SOURCES.aircraft,
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

function lineColor(selectedId: string | null): ExpressionSpecification {
    return ladder(selectedId, {
        hover: color('flight-path'),
        selected: color('flight-path'),
        muted: color('flight-path-muted'),
        fading: mixFade(color('flight-path-cooled'), color('flight-path'))
    });
}

// A selected path is drawn at full width end to end, ignoring its fade, so it
// can be compared with the arc along its whole length.
function lineWidth(selectedId: string | null): ExpressionSpecification {
    const stops: Paint[] = [];
    for (const [zoom, lit, highlighted] of WIDTHS) {
        stops.push(zoom, ladder(selectedId, {
            hover: highlighted,
            selected: highlighted,
            muted: lit * MUTED_WIDTH,
            fading: mixFade(lit * DIM_WIDTH, lit)
        }));
    }
    return ['interpolate', ['linear'], ['zoom'], ...stops];
}

// Picks a paint value for a path, in order of priority:
//   hover:    the path is hovered, even while another flight is selected
//   selected: the path belongs to the selected flight
//   muted:    another flight is selected
//   fading:   nothing is selected
//
// The selected id is written into the expression instead of being set as
// feature-state, because the lit paths are replaced every frame and would lose
// their state. Selection changes are rare, so rebuilding the paint is cheap.
type Rungs = { hover: Paint; selected: Paint; muted: Paint; fading: Paint };

function ladder(selectedId: string | null, { hover, selected, muted, fading }: Rungs): ExpressionSpecification {
    const rest: Paint = selectedId === null
        ? fading
        : ['case', ['==', ['get', 'id'], selectedId], selected, muted];
    return ['case', ['boolean', ['feature-state', 'hover'], false], hover, rest];
}

function mixFade(dim: Paint, lit: Paint): ExpressionSpecification {
    return ['interpolate', ['linear'], ['get', 'fade'], 0, dim, 1, lit];
}

// The aircraft dot fades with the path behind it. `scale` makes the halo a
// fraction of the dot's opacity.
function dotOpacity(selectedId: string | null, scale: number): ExpressionSpecification {
    const own: ExpressionSpecification = scale === 1 ? ['get', 'fade'] : ['*', ['get', 'fade'], scale];
    if (selectedId === null) return own;
    return ['case', ['==', ['get', 'id'], selectedId], own, ['*', own, MUTED_DOT]];
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
function paintSelection(map: Map, selectedId: string | null): void {
    for (const source of PATH_SOURCES) {
        map.setPaintProperty(lineLayerId(source), 'line-color', lineColor(selectedId));
        map.setPaintProperty(lineLayerId(source), 'line-width', lineWidth(selectedId));
    }
    map.setPaintProperty(SOURCES.aircraft, 'circle-opacity', dotOpacity(selectedId, 1));
    map.setPaintProperty(SOURCES.aircraft, 'circle-stroke-opacity', dotOpacity(selectedId, 0.35));
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
