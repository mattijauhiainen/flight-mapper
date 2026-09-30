import { COOLS_AFTER_SECONDS, pathToRenderAt } from './path.ts';
import type { Path, PathToRender } from './path.ts';
import type { FlightFeature, Tracks } from './tracks.ts';

// A flight as the timeline tracks it.
export type Flight = {
    id: string;
    path: Path;
    departureSeconds: number;
    arrivalSeconds: number;
};

// A lit flight's path as it should be drawn at the moment the timeline has
// reached.
export type FlightPathToRender = {
    id: string;
    pathToRender: PathToRender;
};

// Everything one moment of the day draws and reports.
export type Moment = {
    pathsToRender: FlightPathToRender[];    // one per lit flight
    settled: Flight[];                      // every flight whose whole path has cooled
    settledChanged: boolean;                // whether any flight settled since the previous moment
    airborne: number;
    departed: number;                       // including those that have since landed
};

export type Timeline = {
    advanceTo(nowSeconds: number): Moment;
};

// A lit flight and where pathToRenderAt's next search along its path starts.
// The index lives only while the flight is lit, so a fresh timeline starts
// every search from the beginning without anything to reset.
type LitFlight = {
    flight: Flight;
    litStartIndex: number;
};

// The day's flights moving through their three stages: waiting to depart, lit,
// and settled once the whole path has cooled, COOLS_AFTER_SECONDS after the
// flight landed. A point on a path is lit as the aircraft passes over it and
// has cooled COOLS_AFTER_SECONDS later, so the lit stretch travels with the
// aircraft.
//
// advanceTo only moves forward: each call carries on from where the previous
// one left off. To go back to the start, start a new timeline.
export function startTimeline(data: Tracks): Timeline {
    // In order of departure, so the next flight to take off is always at
    // flights[nextToDepart].
    const flights = data.features.map(toFlight).sort((a, b) => a.departureSeconds - b.departureSeconds);

    let nextToDepart = 0;
    let lit: LitFlight[] = [];
    const settled: Flight[] = [];

    return { advanceTo };

    function advanceTo(nowSeconds: number): Moment {
        takeOff(nowSeconds);
        const settledChanged = settle(nowSeconds);
        return {
            pathsToRender: lit.map((litFlight) => nextPathToRender(litFlight, nowSeconds)),
            settled,
            settledChanged,
            airborne: lit.filter(({ flight }) => flight.arrivalSeconds > nowSeconds).length,
            departed: nextToDepart
        };
    }

    // Lights every flight that has departed by `nowSeconds`.
    function takeOff(nowSeconds: number): void {
        while (nextToDepart < flights.length && flights[nextToDepart].departureSeconds <= nowSeconds) {
            lit.push({ flight: flights[nextToDepart], litStartIndex: 0 });
            nextToDepart++;
        }
    }

    // Settles every flight whose path has cooled all the way by `nowSeconds`.
    // Returns whether any did.
    function settle(nowSeconds: number): boolean {
        const cooled = ({ flight }: LitFlight) => flight.arrivalSeconds + COOLS_AFTER_SECONDS <= nowSeconds;
        const stillLit = lit.filter((litFlight) => !cooled(litFlight));
        if (stillLit.length === lit.length) return false;

        for (const litFlight of lit) {
            if (cooled(litFlight)) settled.push(litFlight.flight);
        }
        lit = stillLit;
        return true;
    }
}

// How `litFlight` should be drawn at `nowSeconds`. Moves its litStartIndex
// forward for the next call.
function nextPathToRender(litFlight: LitFlight, nowSeconds: number): FlightPathToRender {
    const { flight } = litFlight;
    const { pathToRender, litStartIndex } = pathToRenderAt(flight.path, nowSeconds, litFlight.litStartIndex);
    litFlight.litStartIndex = litStartIndex;
    return { id: flight.id, pathToRender };
}

function toFlight(feature: FlightFeature): Flight {
    const { id, times } = feature.properties;
    return {
        id,
        path: { positions: feature.geometry.coordinates, timesSeconds: times },
        departureSeconds: times[0],
        arrivalSeconds: times[times.length - 1]
    };
}
