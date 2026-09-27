import type { Map, MapLibreEvent } from 'maplibre-gl';
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

// How much each zoom level closer in slows the clock: the clock runs at
// 2^-PACE of the speed it has one level further out.
export const PACE = 0.75;

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
export function followDepartures(map: Map): (aircraftPositions: LonLat[]) => void {
    let zoom = START_ZOOM;
    let following = true;

    function release() {
        following = false;
        map.off('mousedown', release);
        map.off('touchstart', release);
        map.off('wheel', release);
        map.off('movestart', taken);
    }

    // jumpTo below also fires movestart. Only moves started by the viewer have
    // an originalEvent.
    function taken(e: MapLibreEvent<unknown>) {
        if (e.originalEvent) release();
    }

    map.on('mousedown', release);
    map.on('touchstart', release);
    map.on('wheel', release);
    map.on('movestart', taken);

    return function follow(aircraftPositions: LonLat[]) {
        if (!following) return;

        const { clientWidth, clientHeight } = map.getContainer();
        const wholeGlobeZoom = globeZoom(HKG[1], clientWidth, clientHeight);
        for (const position of aircraftPositions) {
            zoom = Math.min(zoom, edgeZoom(HKG, position, clientWidth, clientHeight, INSET));
        }
        zoom = Math.max(zoom, wholeGlobeZoom);

        map.jumpTo({ center: HKG, zoom });

        if (zoom <= wholeGlobeZoom) release();
    };
}

// How fast the clock runs at the map's current zoom, as a fraction of full
// speed.
export function clockPace(map: Map): number {
    const { clientWidth, clientHeight } = map.getContainer();
    const wholeGlobeZoom = globeZoom(map.getCenter().lat, clientWidth, clientHeight);
    return pace(map.getZoom(), wholeGlobeZoom);
}

// How fast the clock runs at `zoom`, as a fraction of full speed. Full speed
// at `wholeGlobeZoom`, the zoom that fits the whole globe on screen, and slower
// by 2^-PACE for every level closer in. Never faster than full.
//
// Each level closer in doubles how fast aircraft move across the screen, so at
// full speed close in they leave the screen before they can be seen. A PACE of
// 1 would cancel that out exactly, but close in that is slow enough to leave
// the second departure waiting on the runway for ten seconds.
export function pace(zoom: number, wholeGlobeZoom: number): number {
    return Math.min(1, 2 ** (PACE * (wholeGlobeZoom - zoom)));
}
