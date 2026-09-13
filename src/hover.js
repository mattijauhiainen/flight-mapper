import { Popup } from 'maplibre-gl';

const depFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false
});
const kmFmt = new Intl.NumberFormat('en-GB');

// Hovering a path lights it and names the flight: where it was going, when it
// left, and how far it flew to get there. Times in the data are seconds from
// the first departure, so the popup needs the collection's epoch to turn one
// back into a wall-clock time.
//
// Returns the switch that mutes one flight. The selected flight is the one case
// where hovering says nothing: it is lit already and has an overlay of its own
// anchored to it, saying more than this popup can.
export function wireHover(map, epoch, details) {
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    let hover = null;
    let muted = null;

    function clear() {
        if (hover) map.setFeatureState(hover, { hover: false });
        hover = null;
    }

    for (const key of ['done', 'active']) {
        const source = `flights-${key}`;

        map.on('mousemove', `${source}-hit`, (e) => {
            const feature = e.features[0];
            map.getCanvas().style.cursor = 'pointer';

            // An in-progress path is drawn as many pieces sharing one id, so
            // hovering any of them lights the whole flight and reads one entry.
            const flight = details[feature.id];
            if (!flight || feature.id === muted) {
                clear();
                popup.remove();
                return;
            }

            if (!hover || hover.id !== feature.id || hover.source !== source) {
                clear();
                hover = { source, id: feature.id };
                map.setFeatureState(hover, { hover: true });
            }

            popup
                .setLngLat(e.lngLat)
                .setHTML(
                    `<strong>${flight.callsign || feature.id} to ${flight.dest}</strong>` +
                    `<span>Dep ${depFmt.format(new Date((epoch + flight.departure) * 1000))} HKT` +
                    ` &middot; ${kmFmt.format(flight.km)} km</span>`
                )
                .addTo(map);
        });

        map.on('mouseleave', `${source}-hit`, () => {
            clear();
            map.getCanvas().style.cursor = '';
            popup.remove();
        });
    }

    // Pass the flight to keep quiet about, or null to hear about all of them
    // again. Either way whatever is showing now goes.
    return (id) => {
        muted = id;
        clear();
        popup.remove();
    };
}
