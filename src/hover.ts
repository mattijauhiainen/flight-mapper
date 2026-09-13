import { Popup } from 'maplibre-gl';
import type { FeatureIdentifier, Map } from 'maplibre-gl';
import { PATH_SOURCES, hitLayerId } from './layers.ts';
import { flightsById } from './tracks.ts';
import type { Tracks } from './tracks.ts';

const depFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false
});
const kmFmt = new Intl.NumberFormat('en-GB');

// Hovering a path lights it and names the flight: where it was going, when it
// left, and how far it flew to get there.
//
// Returns the switch that mutes one flight. The selected flight is the one case
// where hovering says nothing: it is lit already and has an overlay of its own
// anchored to it, saying more than this popup can.
export function wireHover(map: Map, data: Tracks): (id: string | null) => void {
    const flights = flightsById(data);
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    let hover: FeatureIdentifier | null = null;
    let muted: string | null = null;

    function clear() {
        if (hover) map.setFeatureState(hover, { hover: false });
        hover = null;
    }

    for (const source of PATH_SOURCES) {
        const hitLayer = hitLayerId(source);

        map.on('mousemove', hitLayer, (e) => {
            const feature = e.features?.[0];
            if (!feature) return;
            map.getCanvas().style.cursor = 'pointer';

            // An in-progress path is drawn as many pieces sharing one id, so
            // hovering any of them lights the whole flight and reads one entry.
            const flight = typeof feature.id === 'string' ? flights[feature.id]?.properties : undefined;
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

            // Times in the data are seconds from the first departure, so the
            // epoch turns the departure back into a wall-clock time.
            const departure = new Date((data.epoch + flight.times[0]) * 1000);

            popup
                .setLngLat(e.lngLat)
                .setHTML(
                    `<strong>${flight.callsign || flight.id} to ${flight.dest}</strong>` +
                    `<span>Dep ${depFmt.format(departure)} HKT` +
                    ` &middot; ${kmFmt.format(flight.km)} km</span>`
                )
                .addTo(map);
        });

        map.on('mouseleave', hitLayer, () => {
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
