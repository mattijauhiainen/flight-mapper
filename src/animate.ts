import type { FlightLayers } from './layers.ts';
import * as panel from './panel.ts';
import { startTimeline } from './timeline.ts';
import type { Timeline } from './timeline.ts';
import type { LonLat, Tracks } from './tracks.ts';

// How long one run of the animation takes in real time at full speed. The
// whole recorded timeline, from the first departure to the last recorded
// position of the last flight still in the air, is squeezed into this.
// clock.ts slows it down for as long as the camera is close in.
const DURATION_MS = 72 * 1000;

// The most a single frame can move the clock on. Browsers stop drawing frames
// in a background tab, and without this the first one back would jump the
// clock by however long the tab was away.
const LONGEST_FRAME_MS = 100;

// Plays the day's departures on the map. Each frame moves on through the
// recorded day, draws the timeline as it stands there, and reports the clock to
// the panel.
//
// The daylight layer is handed the same instant the clock shows, every frame,
// and `follow` is handed where every aircraft has got to. `pace` says what share
// of full speed the clock runs at right now.
export function animate(
    layers: FlightLayers,
    data: Tracks,
    daylight: { setTime(ms: number): void },
    follow: (aircraftPositions: LonLat[]) => void,
    pace: () => number
): void {
    let timeline: Timeline;
    let elapsedMs = 0;                      // of full-speed running so far
    let lastFrameTimeMs: number | null = null;
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
        elapsedMs = 0;
        lastFrameTimeMs = null;
        requestAnimationFrame(drawFrame);
    }

    function drawFrame(frameTimeMs: number): void {
        // The clock moves on by however much of the frame the camera's zoom
        // allows. requestAnimationFrame's timestamps can run slightly out of
        // order, hence the clamp at 0.
        if (lastFrameTimeMs !== null) {
            const frameMs = Math.min(Math.max(frameTimeMs - lastFrameTimeMs, 0), LONGEST_FRAME_MS);
            elapsedMs += frameMs * pace();
        }
        lastFrameTimeMs = frameTimeMs;

        // The moment of the recorded day this frame shows, in seconds since the
        // first departure. The clock stops at the last recorded position, but
        // nowSeconds runs on past it so the trails still lit then can cool.
        const nowSeconds = (elapsedMs / DURATION_MS) * data.span;

        // How far through the run we are, 0 to 1.
        const progress = Math.min(nowSeconds / data.span, 1);

        const moment = timeline.advanceTo(nowSeconds);
        if (moment.settledChanged) layers.drawSettled(moment.settled);
        layers.drawLit(moment.pathsToRender);

        const at = new Date((data.epoch + Math.min(nowSeconds, data.span)) * 1000);
        daylight.setTime(at.getTime());
        follow(moment.pathsToRender.map(({ pathToRender }) => pathToRender.aircraftPosition));
        panel.update({
            at,
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
