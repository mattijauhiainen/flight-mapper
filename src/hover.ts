import { Popup } from 'maplibre-gl';
import type { FeatureIdentifier, Map } from 'maplibre-gl';
import { formatHongKongTime, formatKm } from './format.ts';
import { PATH_SOURCES, hitLayerId } from './layers.ts';
import { flightsById } from './tracks.ts';
import type { Tracks } from './tracks.ts';

// Hovering a path lights it and names the flight: where it was going, when it
// left, and how far it flew to get there.
//
// Returns a function that mutes hover for one flight, used for the selected
// flight, which has the selection popup instead.
export function wireHover(map: Map, data: Tracks): (id: string | null) => void {
    const flights = flightsById(data);
    const popup = new Popup({ className: 'hover-popup', closeButton: false, closeOnClick: false, offset: 8 });
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
                    `<h2 class="overlay-title">${flight.callsign || flight.id} <em>to</em> ${flight.dest}</h2>` +
                    `<p>Dep ${formatHongKongTime(departure)} HKT &middot; ${formatKm(flight.km)}</p>`
                )
                .addTo(map);
        });

        map.on('mouseleave', hitLayer, () => {
            clear();
            map.getCanvas().style.cursor = '';
            popup.remove();
        });
    }

    // Pass the id to mute, or null to unmute. Either way, closes the hover popup
    // and clears the hover colour.
    return (id) => {
        muted = id;
        clear();
        popup.remove();
    };
}
