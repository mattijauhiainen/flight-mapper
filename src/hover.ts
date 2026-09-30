import { Popup } from 'maplibre-gl';
import type { FeatureIdentifier, Map } from 'maplibre-gl';
import { PATH_SOURCES, hitLayerId } from './layers.ts';
import type { FlightProperties, Tracks } from './tracks.ts';

const depFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false
});
const kmFmt = new Intl.NumberFormat('en-GB');

// Hovering a path lights it and names the flight: where it was going, when it
// left, and how far it flew to get there. The features on the map carry only
// an id, so the rest is looked up in the data by that id.
export function wireHover(map: Map, data: Tracks): void {
    const flights: Record<string, FlightProperties | undefined> = {};
    for (const feature of data.features) flights[feature.properties.id] = feature.properties;

    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    let hover: FeatureIdentifier | null = null;

    function clear() {
        if (hover) map.setFeatureState(hover, { hover: false });
        hover = null;
    }

    for (const source of PATH_SOURCES) {
        const hitLayer = hitLayerId(source);

        map.on('mousemove', hitLayer, (e) => {
            const feature = e.features?.[0];
            if (!feature) return;

            // An in-progress path is drawn as many pieces sharing one id, so
            // hovering any of them lights the whole flight and reads one entry.
            const flight = typeof feature.id === 'string' ? flights[feature.id] : undefined;
            if (!flight) return;

            if (!hover || hover.id !== feature.id || hover.source !== source) {
                clear();
                hover = { source, id: feature.id };
                map.setFeatureState(hover, { hover: true });
            }

            // Times in the data are seconds from the first departure, so the
            // epoch turns the departure back into a wall-clock time.
            const departure = new Date((data.epoch + flight.times[0]) * 1000);

            map.getCanvas().style.cursor = 'pointer';
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
}
