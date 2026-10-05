import type { Map } from 'maplibre-gl';

// Longest wait for the first view before revealing the page anyway, so a
// stalled tile request cannot keep the loader up for good.
const TIMEOUT_MS = 15 * 1000;

const loader = document.getElementById('loader');

// Waits until the map has drawn the current view with every tile, glyph and
// sprite it needs, then fades the loader out and resolves.
export async function revealWhenDrawn(map: Map): Promise<void> {
    await Promise.race([drawn(map), new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS))]);
    document.body.classList.remove('loading');
    loader?.addEventListener('transitionend', () => loader.remove(), { once: true });
}

function drawn(map: Map): Promise<void> {
    return new Promise((resolve) => {
        if (map.loaded()) resolve();
        else map.once('idle', () => resolve());
    });
}
