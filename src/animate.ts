import type { FlightLayers } from './layers.ts';
import * as panel from './panel.ts';
import { startTimeline } from './timeline.ts';
import type { Timeline } from './timeline.ts';
import type { Tracks } from './tracks.ts';

// How long one run of the animation takes in real time. The whole recorded
// timeline, from the first departure to the last recorded position of the
// last flight still in the air, is squeezed into this.
const DURATION_MS = 72 * 1000;

// Plays the day's departures on the map. Each frame moves on through the
// recorded day, draws the timeline as it stands there, and reports the clock to
// the panel.
export function animate(layers: FlightLayers, data: Tracks): void {
    let timeline: Timeline;
    let startedAtMs = 0;
    let running = false;

    panel.setTotal(data.features.length);
    panel.onReplay(play);
    play();

    function play(): void {
        if (running) return;
        running = true;
        panel.offerReplay(false);
        timeline = startTimeline(data);
        layers.clear();
        startedAtMs = performance.now();
        requestAnimationFrame(drawFrame);
    }

    function drawFrame(frameTimeMs: number): void {
        // The moment of the recorded day this frame shows, in seconds since the
        // first departure. requestAnimationFrame's timestamp can be slightly
        // older than startedAtMs on the first frame, hence the clamp at 0. The
        // clock stops at the last recorded position, but nowSeconds runs on
        // past it so the trails still lit then can cool.
        const nowSeconds = (Math.max(frameTimeMs - startedAtMs, 0) / DURATION_MS) * data.span;

        // How far through the run we are, 0 to 1.
        const progress = Math.min(nowSeconds / data.span, 1);

        const moment = timeline.advanceTo(nowSeconds);
        if (moment.settledChanged) layers.drawSettled(moment.settled);
        layers.drawLit(moment.pathsToRender);

        panel.update({
            at: new Date((data.epoch + Math.min(nowSeconds, data.span)) * 1000),
            airborne: moment.airborne,
            departed: moment.departed,
            progress
        });

        if (progress < 1 || moment.pathsToRender.length) {
            requestAnimationFrame(drawFrame);
        } else {
            running = false;
            panel.offerReplay(true);
        }
    }
}
