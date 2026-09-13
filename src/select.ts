import type { LngLat, Map } from 'maplibre-gl';
import * as detail from './detail.ts';
import { framingZoom, geodesic, greatCircleKm, normalizeLongitude, separation } from './geo.ts';
import { PATH_SOURCES, hitLayerId } from './layers.ts';
import type { FlightLayers } from './layers.ts';
import * as panel from './panel.ts';
import { flightsById } from './tracks.ts';
import type { LonLat, Tracks } from './tracks.ts';

// Enough segments that the arc reads as a curve at any zoom the globe offers,
// and an even count so its halfway point is a vertex the camera can centre on.
const ARC_STEPS = 128;

// Long enough to read as the globe turning rather than cutting. easeTo is left
// non-essential on purpose: a viewer who has asked for reduced motion gets the
// same framing, arrived at instantly.
const TURN_MS = 1400;

// Clicking a path pulls one flight out of the traffic: everything else recedes,
// the globe turns until both ends of the flight are on screen, and the arc it
// could have flown is drawn against the track it did.
export function wireSelect(
    map: Map,
    data: Tracks,
    layers: FlightLayers,
    muteHover: (id: string | null) => void
): void {
    const flights = flightsById(data);
    const hitLayers = PATH_SOURCES.map(hitLayerId);
    let selected: string | null = null;

    function clear() {
        if (selected === null) return;
        selected = null;
        layers.clearSelection();
        muteHover(null);
        detail.hide();
    }

    // The camera frames the two ends rather than the track between them: the
    // track is what the arc is being compared against, and a flight that swung
    // wide is still a flight between those two airports.
    function frame(arc: LonLat[]) {
        const { clientWidth, clientHeight } = map.getContainer();
        const middle = arc[arc.length >> 1];
        const arcRadians = separation(arc[0], arc[arc.length - 1]);

        map.easeTo({
            center: [normalizeLongitude(middle[0]), middle[1]],
            zoom: framingZoom(arcRadians, middle[1], clientWidth, clientHeight),
            duration: TURN_MS
        });
    }

    // Clicking the flight that is already selected does the whole thing again,
    // which is how you get the camera back after turning the globe by hand, and
    // moves the overlay to wherever along the path you asked this time.
    function select(id: string, at: LngLat) {
        const flight = flights[id];
        if (!flight) return;
        const { callsign, dest, km, times } = flight.properties;
        const { coordinates } = flight.geometry;
        const from = coordinates[0];
        const to = coordinates[coordinates.length - 1];

        selected = id;

        // The pointer is still sitting on the path it just picked, and no
        // mouseleave is coming to take the hover popup away: without this it
        // stays open on top of the overlay the click was for, and the path
        // stays painted in the hover colour rather than the selected one.
        muteHover(id);

        const arc = geodesic(from, to, ARC_STEPS);
        layers.select(id, arc);

        detail.show(map, at, {
            id,
            callsign,
            dest,
            flown: km,
            direct: greatCircleKm(from, to),
            departure: new Date((data.epoch + times[0]) * 1000)
        });

        frame(arc);
    }

    // One handler that asks what is under the pointer, rather than a per-layer
    // click alongside a bare one: a layer handler and a map handler both fire
    // for the same click, and the bare one would have cleared the selection the
    // layer one had just made.
    map.on('click', (e) => {
        const [hit] = map.queryRenderedFeatures(e.point, { layers: hitLayers });
        if (typeof hit?.id === 'string') select(hit.id, e.lngLat);
        else clear();
    });

    // Escape, the popup's own close button, or clicking the map off any path.
    // Replaying the
    // timeline clears it too: the selected flight is about to be undrawn and
    // redrawn from the start, and an overlay left standing would be describing
    // a path that is no longer on the globe.
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') clear();
    });
    detail.onClose(clear);
    panel.onReplay(clear);
}
