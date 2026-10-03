// The shape of public/tracks.geojson, as scripts/build_tracks.py writes it.
// Times are seconds from `epoch`, the unix time of the first departure, and
// there is one per vertex of the path.
//
// The file is GeoJSON, but these types describe only the part of it this app
// reads, so the rest of the app can use them without depending on the GeoJSON
// types that the map code works with.
export type Tracks = {
    type: 'FeatureCollection';
    features: FlightFeature[];
    epoch: number;
    span: number;       // seconds from the first departure to the last position recorded
};

export type FlightFeature = {
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: LonLat[] };
    properties: FlightProperties;
};

export type FlightProperties = {
    id: string;
    callsign: string;   // '' when the tracker never saw one
    dest: string;       // IATA code
    km: number;
    times: number[];
};

// A point on the globe, in degrees. Longitudes on a path that crosses the
// antimeridian keep counting past 180 rather than wrapping (see
// normalizeLongitude in geo.ts).
export type LonLat = [lon: number, lat: number];

// Every flight in `data`, by id: the features on the map carry only an id, and
// whatever is said about a flight is looked up here.
export function flightsById(data: Tracks): Record<string, FlightFeature | undefined> {
    const byId: Record<string, FlightFeature | undefined> = {};
    for (const feature of data.features) byId[feature.properties.id] = feature;
    return byId;
}
