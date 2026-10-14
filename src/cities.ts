import cities from './cities.json' with { type: 'json' };
import type { LonLat } from './tracks.ts';

// A city whose departures the app can show, as scripts/build_tracks.py writes
// it to cities.json.
export type City = {
    id: string;                 // its tracks are in public/tracks/<id>.geojson
    name: string;
    airport: string;            // IATA code of the airport every flight departs from
    origin: LonLat;             // where that airport is
    timeZone: string;           // IANA time zone, e.g. 'Asia/Hong_Kong'
    timeZoneName: string;       // its abbreviation on the day of the data, e.g. 'HKT'
    firstDepartureMs: number;   // unix time of the first departure in its tracks
    departures: number;         // flights in its tracks
};

// In the order the city picker lists them. The first is the default.
export const CITIES = cities as City[];

// The city named by the page's ?city= parameter, or the first city when there
// is none or it names no city.
export function cityFromUrl(): City {
    const id = new URLSearchParams(location.search).get('city');
    return CITIES.find((city) => city.id === id) ?? CITIES[0];
}

// Puts `city` in the page's ?city= parameter, in place of the current history
// entry.
export function putCityInUrl(city: City): void {
    const url = new URL(location.href);
    url.searchParams.set('city', city.id);
    history.replaceState(null, '', url);
}
