import { Popup } from 'maplibre-gl';
import type { LngLatLike, Map } from 'maplibre-gl';
import { formatHongKongTime, formatKm, formatPercent } from './format.ts';

// The popup that opens when a path is clicked. It names the selected flight
// and compares the distance it flew with the great-circle distance between its
// two ends. It is anchored to the clicked point. Its markup is in index.html.

// What the popup shows about one flight. Distances are in kilometres.
export type MeasuredFlight = {
    id: string;
    callsign: string;
    dest: string;
    flownKm: number;    // along the recorded track
    directKm: number;   // along the great circle between the track's two ends
    departure: Date;
};

export function show(map: Map, at: LngLatLike, flight: MeasuredFlight): void {
    const { id, callsign, dest, flownKm, directKm, departure } = flight;
    const detourKm = Math.max(flownKm - directKm, 0);

    el.callsign.textContent = callsign || id;
    el.dest.textContent = dest;
    el.direct.textContent = formatKm(directKm);
    el.flown.textContent = formatKm(flownKm);
    el.detour.textContent = `+${formatKm(detourKm)} · +${formatPercent((detourKm / directKm) * 100)}`;
    el.departed.textContent = `Departed ${formatHongKongTime(departure)} HKT`;

    // If the popup is already open, only move it. addTo() on an open popup
    // removes it first, which fires 'close', and select.ts clears the selection
    // on close.
    popup.setLngLat(at);
    if (!popup.isOpen()) popup.addTo(map);
}

export function hide(): void {
    popup.remove();
}

// Also fires when the popup's own close button is clicked.
export function onClose(handler: () => void): void {
    popup.on('close', handler);
}

const el = {
    root: byId('selection-popup'),
    callsign: byId('selection-callsign'),
    dest: byId('selection-dest'),
    direct: byId('selection-direct'),
    flown: byId('selection-flown'),
    detour: byId('selection-detour'),
    departed: byId('selection-departed')
};

const popup = new Popup({
    className: 'selection-popup',
    // select.ts decides what a click on the map does, including closing this.
    closeOnClick: false,
    // Hide the popup while its anchor is on the far side of the globe.
    locationOccludedOpacity: 0,
    offset: 12,
    maxWidth: '260px'
});

popup.setDOMContent(el.root);
// The markup is hidden in index.html until the popup takes it over.
el.root.hidden = false;

function byId(id: string): HTMLElement {
    const node = document.getElementById(id);
    if (!node) throw new Error(`selectionPopup: #${id} is not in index.html`);
    return node;
}
