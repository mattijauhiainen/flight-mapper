import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { color } from './palette.ts';
import type { Flight, FlightPathToRender } from './timeline.ts';
import type { LonLat } from './tracks.ts';

const SOURCES = { settled: 'flights-done', lit: 'flights-active', aircraft: 'planes' };

// The two sources paths are drawn into. Each has a hit layer (see addLayers)
// that hover listens on.
export const PATH_SOURCES = [SOURCES.settled, SOURCES.lit];

export function hitLayerId(pathSource: string): string {
    return `${pathSource}-hit`;
}

// Draws the flights into the sources addLayers set up.
export type FlightLayers = {
    drawLit(pathsToRender: FlightPathToRender[]): void;
    drawSettled(flights: Flight[]): void;
    clear(): void;
};

// What every path and aircraft drawn on the map carries. The id is what hover
// lights a flight by, and the fade is what the paint mixes a feature between
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
// Hover overrides both.
//
// The colours are opaque, and the fade mixes between them rather than running
// through the alpha channel. Translucent paths would composite where tracks
// cross, so the crowded approaches to Hong Kong would burn brighter than any
// single track and a path's brightness would depend on what lay under it.
const DIM_WIDTH = 0.7;     // how much of the lit width a cooled path keeps

// Settled paths and still-fading ones live in separate sources on purpose: the
// fading set is small and gets rewritten every frame, while the settled set is
// large and only changes when a path has finished fading.
export function addLayers(map: Map): FlightLayers {
    for (const source of PATH_SOURCES) {
        map.addSource(source, { type: 'geojson', data: EMPTY, promoteId: 'id' });

        // A path is only 0.5-2px wide, which is a mean thing to ask anyone to
        // point at, so a wide transparent line rides along underneath purely as
        // the hover hit target. It has to stay visible to be hit-tested —
        // visibility none would take it out of the query entirely.
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
            id: `${source}-line`,
            type: 'line',
            source,
            layout: { 'line-cap': 'butt', 'line-join': 'round' },
            paint: {
                'line-color': hovered(
                    color('flight-path-hover'),
                    mixFade(color('flight-path-cooled'), color('flight-path'))
                ),
                'line-width': [
                    'interpolate', ['linear'], ['zoom'],
                    0, hovered(1.6, mixFade(0.5 * DIM_WIDTH, 0.5)),
                    3, hovered(2.6, mixFade(0.9 * DIM_WIDTH, 0.9)),
                    7, hovered(4, mixFade(2 * DIM_WIDTH, 2))
                ]
            }
        });
    }

    // The leading edge of every path that is still being drawn. The dots ride
    // the lit end of a path, so they dim with it.
    map.addSource(SOURCES.aircraft, { type: 'geojson', data: EMPTY });

    map.addLayer({
        id: 'planes',
        type: 'circle',
        source: SOURCES.aircraft,
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 1.8, 3, 2.6, 7, 4],
            'circle-color': color('flight-head'),
            'circle-opacity': ['get', 'fade'],
            'circle-stroke-width': 2,
            'circle-stroke-color': color('accent'),
            'circle-stroke-opacity': ['*', ['get', 'fade'], 0.35]
        }
    });

    return flightLayers(map);
}

function hovered(yes: Paint, no: Paint): ExpressionSpecification {
    return ['case', ['boolean', ['feature-state', 'hover'], false], yes, no];
}

function mixFade(dim: Paint, lit: Paint): ExpressionSpecification {
    return ['interpolate', ['linear'], ['get', 'fade'], 0, dim, 1, lit];
}

function flightLayers(map: Map): FlightLayers {
    const sources = {
        settled: geojsonSource(map, SOURCES.settled),
        lit: geojsonSource(map, SOURCES.lit),
        aircraft: geojsonSource(map, SOURCES.aircraft)
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
        }
    };
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

// Longitude normally runs from -180 to 180, and jumps from one to the other
// at the antimeridian: the 180° line through the middle of the Pacific. A
// flight from Hong Kong to Los Angeles crosses it, so its recorded longitudes
// go ..., 178, 179, -179, -178, ... A line drawn through those would take the
// long way from 179 to -179, right round the globe the wrong way.
//
// To avoid that, scripts/build_tracks.py rewrites the longitudes to keep
// counting past 180 instead (..., 178, 179, 181, 182, ...), which lines draw
// correctly. A single point like the aircraft marker has no line to break,
// so it is brought back into the usual -180 to 180 range.
function normalizeLongitude(lon: number): number {
    return ((((lon + 180) % 360) + 360) % 360) - 180;
}
