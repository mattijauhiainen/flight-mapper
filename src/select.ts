import type { LngLat, Map } from 'maplibre-gl';
import * as selectionPopup from './selectionPopup.ts';
import { framingZoom, geodesic, greatCircleKm, normalizeLongitude, separation } from './geo.ts';
import { PATH_SOURCES, hitLayerId } from './layers.ts';
import type { FlightLayers } from './layers.ts';
import * as panel from './panel.ts';
import { flightsById } from './tracks.ts';
import type { LonLat, Tracks } from './tracks.ts';

// Enough segments for the arc to look curved at any zoom. Even, so the halfway
// point is a vertex the camera can centre on.
const ARC_STEPS = 128;

// How long the camera takes to turn to a selected flight. With reduced motion
// turned on, easeTo jumps straight there.
const TURN_MS = 1400;

// Clicking a path selects its flight: the other flights are dimmed, the
// great-circle arc between its two ends is drawn, the camera turns to show both
// ends, and the selection popup opens at the clicked point.
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
        selectionPopup.hide();
    }

    // Centres the camera on the middle of the arc and zooms to fit its two
    // ends. The track itself may swing wider than that.
    function zoomIntoView(arc: LonLat[]) {
        const { clientWidth, clientHeight } = map.getContainer();
        const middle = arc[arc.length >> 1];
        const arcRadians = separation(arc[0], arc[arc.length - 1]);

        map.easeTo({
            center: [normalizeLongitude(middle[0]), middle[1]],
            zoom: framingZoom(arcRadians, middle[1], clientWidth, clientHeight),
            duration: TURN_MS
        });
    }

    // Selecting the flight that is already selected runs all of this again,
    // which moves the camera back and the popup to the new click.
    function select(id: string, at: LngLat) {
        const flight = flights[id];
        if (!flight) return;
        const { callsign, dest, km, times } = flight.properties;
        const { coordinates } = flight.geometry;
        const from = coordinates[0];
        const to = coordinates[coordinates.length - 1];

        selected = id;

        // The pointer is still over the path, so no mouseleave will close the
        // hover popup or clear the hover colour. Mute hover for this flight.
        muteHover(id);

        const arc = geodesic(from, to, ARC_STEPS);
        layers.select(id, arc);

        selectionPopup.show(map, at, {
            id,
            callsign,
            dest,
            flownKm: km,
            directKm: greatCircleKm(from, to),
            departure: new Date((data.epoch + times[0]) * 1000)
        });

        zoomIntoView(arc);
    }

    // One map-wide handler. A handler on the hit layers plus a map-wide one to
    // clear would both fire on a path click, and the second would undo the
    // selection.
    map.on('click', (e) => {
        const [hit] = map.queryRenderedFeatures(e.point, { layers: hitLayers });
        if (typeof hit?.id === 'string') select(hit.id, e.lngLat);
        else clear();
    });

    // Escape, the popup's close button and Replay also clear the selection.
    // Replay redraws every path from the start, so the selected one would
    // disappear from under the popup.
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') clear();
    });
    selectionPopup.onClose(clear);
    panel.onReplay(clear);
}
