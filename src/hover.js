import { Popup } from 'maplibre-gl';

const depFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false
});
const kmFmt = new Intl.NumberFormat('en-GB');

// Hovering a path lights it and names the flight: where it was going, when it
// left, and how far it flew to get there. Times in the data are seconds from
// the first departure, so the popup needs the collection's epoch to turn one
// back into a wall-clock time.
export function wireHover(map, epoch) {
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    let hover = null;

    function clear() {
        if (hover) map.setFeatureState(hover, { hover: false });
        hover = null;
    }

    map.on('mousemove', 'flights-hit', (e) => {
        const feature = e.features[0];
        if (!hover || hover.id !== feature.id) {
            clear();
            hover = { source: 'flights', id: feature.id };
            map.setFeatureState(hover, { hover: true });
        }

        // Properties can come back from the worker with arrays encoded as JSON
        // strings, so times needs parsing before it can be read.
        const p = feature.properties;
        const times = typeof p.times === 'string' ? JSON.parse(p.times) : p.times;

        map.getCanvas().style.cursor = 'pointer';
        popup
            .setLngLat(e.lngLat)
            .setHTML(
                `<strong>${p.callsign || p.id} to ${p.dest}</strong>` +
                `<span>Dep ${depFmt.format(new Date((epoch + times[0]) * 1000))} HKT` +
                ` &middot; ${kmFmt.format(p.km)} km</span>`
            )
            .addTo(map);
    });

    map.on('mouseleave', 'flights-hit', () => {
        clear();
        map.getCanvas().style.cursor = '';
        popup.remove();
    });
}
