import { EMPTY, setSelection } from './flights.js';
import { framingZoom, geodesic, greatCircleKm, separation, wrapLon } from './geo.js';
import * as detail from './detail.js';
import * as panel from './panel.js';

const HIT_LAYERS = ['flights-done-hit', 'flights-active-hit'];

// Enough segments that the arc reads as a curve at any zoom the globe offers,
// and an even count so its halfway point is a vertex the camera can centre on.
const ARC_STEPS = 128;

// Long enough to read as the globe turning rather than cutting. easeTo is left
// non-essential on purpose: a viewer who has asked for reduced motion gets the
// same framing, arrived at instantly.
const TURN_MS = 1400;

function feature(geometry) {
    return {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry }]
    };
}

// Clicking a path pulls one flight out of the traffic: everything else recedes,
// the globe turns until both ends of the flight are on screen, and the arc it
// could have flown is drawn against the track it did. Times in the data are
// seconds from the first departure, so the overlay needs the collection's epoch
// to turn one back into a wall-clock time.
export function wireSelect(map, epoch, details, muteHover) {
    let selected = null;

    function clear() {
        if (selected === null) return;
        selected = null;
        setSelection(map, null);
        muteHover(null);
        map.getSource('geodesic').setData(EMPTY);
        map.getSource('destination').setData(EMPTY);
        detail.hide();
    }

    // The camera frames the two ends rather than the track between them: the
    // track is what the arc is being compared against, and a flight that swung
    // wide is still a flight between those two airports.
    function frame(arc) {
        const { clientWidth, clientHeight } = map.getContainer();
        const middle = arc[arc.length >> 1];
        const arcRadians = separation(arc[0], arc.at(-1));

        map.easeTo({
            center: [wrapLon(middle[0]), middle[1]],
            zoom: framingZoom(arcRadians, middle[1], clientWidth, clientHeight),
            duration: TURN_MS
        });
    }

    // Clicking the flight that is already selected does the whole thing again,
    // which is how you get the camera back after turning the globe by hand, and
    // moves the overlay to wherever along the path you asked this time.
    function select(id, at) {
        const flight = details[id];
        if (!flight) return;

        selected = id;
        setSelection(map, id);

        // The pointer is still sitting on the path it just picked, and no
        // mouseleave is coming to take the hover popup away: without this it
        // stays open on top of the overlay the click was for, and the path
        // stays painted in the hover colour rather than the selected one.
        muteHover(id);

        const arc = geodesic(flight.from, flight.to, ARC_STEPS);
        map.getSource('geodesic').setData(feature({ type: 'LineString', coordinates: arc }));
        map.getSource('destination').setData(feature({
            type: 'Point',
            coordinates: [wrapLon(flight.to[0]), flight.to[1]]
        }));

        detail.show(map, at, {
            ...flight,
            flown: flight.km,
            direct: greatCircleKm(flight.from, flight.to),
            departure: new Date((epoch + flight.departure) * 1000)
        });

        frame(arc);
    }

    // One handler that asks what is under the pointer, rather than a per-layer
    // click alongside a bare one: a layer handler and a map handler both fire
    // for the same click, and the bare one would have cleared the selection the
    // layer one had just made.
    map.on('click', (e) => {
        const [hit] = map.queryRenderedFeatures(e.point, { layers: HIT_LAYERS });
        if (hit) select(hit.id, e.lngLat);
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
