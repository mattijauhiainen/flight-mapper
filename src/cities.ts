import cities from './cities.json' with { type: 'json' };
import type { LonLat } from './tracks.ts';

// A city whose departures the app can show, as scripts/build_tracks.py writes
// it to cities.json.
export type City = {
    id: string;             // its tracks are in public/tracks/<id>.geojson
    name: string;
    airport: string;        // IATA code of the airport every flight departs from
    origin: LonLat;         // where that airport is
    timeZone: string;       // IANA time zone, e.g. 'Asia/Hong_Kong'
    timeZoneName: string;   // its abbreviation on the day of the data, e.g. 'HKT'
};

// In the order the city selector lists them. The first is the default.
export const CITIES = cities as City[];
