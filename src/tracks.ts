import type { FeatureCollection, LineString } from 'geojson';

// The shape of public/tracks.geojson, as scripts/build_tracks.py writes it.
// Times are seconds from `epoch`, the unix time of the first departure, and
// there is one per vertex of the path.
export type FlightProperties = {
    id: string;
    callsign: string;   // '' when the tracker never saw one
    dest: string;       // IATA code
    km: number;
    times: number[];
};

export interface Tracks extends FeatureCollection<LineString, FlightProperties> {
    epoch: number;
    span: number;       // seconds from the first departure to the last position recorded
}

// MapLibre types a rendered feature's properties as any, so a feature handed
// back by an event is checked before the page trusts it to be a flight.
export function isFlightProperties(p: Record<string, unknown>): p is FlightProperties {
    return typeof p.id === 'string'
        && typeof p.callsign === 'string'
        && typeof p.dest === 'string'
        && typeof p.km === 'number'
        && Array.isArray(p.times);
}
