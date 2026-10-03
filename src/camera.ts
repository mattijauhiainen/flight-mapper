import type { Map, MapLibreEvent } from 'maplibre-gl';
import { pace } from './clock.ts';
import { edgeZoom, globeZoom } from './geo.ts';
import type { LonLat } from './tracks.ts';

// Hong Kong International, where every flight in the data departs from.
export const HKG: LonLat = [113.9185, 22.3089];

// The run opens close in on Hong Kong, where the first departures are, and the
// camera backs away as the traffic spreads out -- centred on the airport the
// whole time, so the starburst grows out of the middle of the screen.
export const START_ZOOM = 8;

// How close to the edge of the screen an aircraft gets before it pushes the
// camera back: near enough that it visibly does the pushing, far enough that
// the dot and its halo are still whole.
const INSET = 24;

// The camera holds still until an aircraft reaches the edge of the screen, and
// from then on backs away just fast enough to keep it there -- so whichever
// aircraft is furthest out, in the direction the screen is shortest, is the one
// visibly pushing the view back. It only ever goes out: every point a path has
// drawn was an aircraft's position at some frame, so the paths stay in view
// along with the aircraft.
//
// It stops for good as soon as the viewer takes the camera -- a drag, a wheel,
// a pinch, a key or the zoom buttons -- or once the whole globe is in view and
// there is nothing further out to show.
export function followDepartures(map: Map): (heads: LonLat[]) => void {
    let zoom = START_ZOOM;
    let following = true;

    function release() {
        following = false;
        map.off('mousedown', release);
        map.off('touchstart', release);
        map.off('wheel', release);
        map.off('movestart', taken);
    }

    // The camera's own jumps start moves too, but only a viewer's carry the
    // event that caused them.
    function taken(e: MapLibreEvent<unknown>) {
        if (e.originalEvent) release();
    }

    map.on('mousedown', release);
    map.on('touchstart', release);
    map.on('wheel', release);
    map.on('movestart', taken);

    return function follow(heads: LonLat[]) {
        if (!following) return;

        const { clientWidth, clientHeight } = map.getContainer();
        const whole = globeZoom(HKG[1], clientWidth, clientHeight);
        for (const head of heads) {
            zoom = Math.min(zoom, edgeZoom(HKG, head, clientWidth, clientHeight, INSET));
        }
        zoom = Math.max(zoom, whole);

        map.jumpTo({ center: HKG, zoom });

        if (zoom <= whole) release();
    };
}

// The share of full speed the clock runs at with the camera where it is now
// (see clock.ts).
export function clockPace(map: Map): number {
    const { clientWidth, clientHeight } = map.getContainer();
    const whole = globeZoom(map.getCenter().lat, clientWidth, clientHeight);
    return pace(map.getZoom(), whole);
}
