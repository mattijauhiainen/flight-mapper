import { Popup } from 'maplibre-gl';

// The overlay a click opens, and the one place on the page where a flight is
// measured rather than merely named: what the track cost against the shortest
// path between the same two ends.
//
// It hangs off the point that was clicked. Pinned to a corner of the page it
// read as furniture unrelated to the map, and the path it was describing was
// somewhere else entirely; anchored, it arrives where you were already looking
// and then rides the globe as the camera turns. Its markup lives in the page
// rather than in a template string here, the way the clock panel's does.
const depFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false
});
const kmFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

const el = {
    root: document.getElementById('detail'),
    callsign: document.getElementById('detail-callsign'),
    dest: document.getElementById('detail-dest'),
    direct: document.getElementById('detail-direct'),
    flown: document.getElementById('detail-flown'),
    extra: document.getElementById('detail-extra'),
    departed: document.getElementById('detail-departed')
};

// closeOnClick would fight the click handler that drives the selection, which
// already decides what a click on the map means. locationOccludedOpacity takes
// the popup with the globe: turn the anchor round the back and it goes with it
// rather than hanging over the ocean on the near side.
const popup = new Popup({
    className: 'detail',
    closeOnClick: false,
    locationOccludedOpacity: 0,
    offset: 12,
    maxWidth: '260px'
});

popup.setDOMContent(el.root);
el.root.hidden = false;   // the popup owns whether it is on screen from here

const km = (value) => `${kmFmt.format(value)} km`;

export function show(map, at, { id, callsign, dest, flown, direct, departure }) {
    // A track is a sum of great-circle hops between its own two ends, so it can
    // never come out shorter than the great circle between them. It can come
    // out a shade under after the flown distance is rounded to whole kilometres,
    // which is a rounding artefact and not a shortcut.
    const extra = Math.max(flown - direct, 0);

    el.callsign.textContent = callsign || id;
    el.dest.textContent = dest;
    el.direct.textContent = km(direct);
    el.flown.textContent = km(flown);
    el.extra.textContent = `+${km(extra)} · +${pctFmt.format((extra / direct) * 100)}%`;
    el.departed.textContent = `Departed ${depFmt.format(departure)} HKT`;

    // Moved rather than re-added when it is already up. addTo() on an open
    // popup begins by removing it, and that removal fires the close event the
    // selection listens to -- so picking a second path would tear down the
    // selection the same click had just made, leaving the overlay open over a
    // flight that was no longer lit and no longer had an arc.
    popup.setLngLat(at);
    if (!popup.isOpen()) popup.addTo(map);
}

export function hide() {
    popup.remove();
}

// Fires for the popup's own close button as well as for hide(), so the button
// needs no wiring of its own.
export function onClose(handler) {
    popup.on('close', handler);
}
