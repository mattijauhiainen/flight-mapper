import type { City } from './cities.ts';
import { flightsById } from './tracks.ts';
import type { FlightFeature, Tracks } from './tracks.ts';

// One city's recorded day of departures.
export type Day = {
    city: City;
    data: Tracks;
    flights: Record<string, FlightFeature | undefined>;     // data's flights by id
};

const downloads = new Map<string, Promise<Day>>();

// Downloads `city`'s day once and hands the same day to every later call.
export function loadDay(city: City): Promise<Day> {
    let download = downloads.get(city.id);
    if (!download) {
        download = fetch(`${import.meta.env.BASE_URL}tracks/${city.id}.geojson`)
            .then((response) => response.json() as Promise<Tracks>)
            .then((data) => ({ city, data, flights: flightsById(data) }));
        downloads.set(city.id, download);
    }
    return download;
}
