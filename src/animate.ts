import type { Day } from './day.ts';
import type { FlightLayers } from './layers.ts';
import * as panel from './panel.ts';
import { startTimeline } from './timeline.ts';
import type { Moment, Timeline } from './timeline.ts';
import type { LonLat } from './tracks.ts';

// How long one run of the animation takes in real time at full speed. The
// whole recorded timeline, from the first departure to the last recorded
// position of the last flight still in the air, is squeezed into this. The
// run takes longer while the camera is zoomed in, because the clock then runs
// slower (see clockPace in camera.ts).
const DURATION_MS = 72 * 1000;

// The most a single frame can move the clock on. Browsers stop drawing frames
// in a background tab, and without this the first one back would jump the
// clock by however long the tab was away.
const LONGEST_FRAME_MS = 100;

// Plays a day's departures on the map, and runs it back to the start when
// another city is picked.
export type Player = {
    // Plays `day` from its first departure. Every frame, `follow` gets the
    // current position of every aircraft in the air.
    play(day: Day, follow: (aircraftPositions: LonLat[]) => void): void;
    // Runs the day on the map back to its first departure over `durationMs`,
    // flights flying backwards, while the daylight moves to `daylightToMs`.
    // Resolves once there, with the map cleared. Called again before then, it
    // carries on from wherever the clock is and resolves the earlier call.
    rewind(durationMs: number, daylightToMs: number): Promise<void>;
};

type Rewind = {
    fromSeconds: number;
    daylightFromMs: number;
    daylightToMs: number;
    durationMs: number;
    startMs: number | null;     // the first frame's time
    done: () => void;
};

// `daylight` gets the time the sun is drawn at every frame, and `pace` gives
// how fast the clock runs while playing, as a fraction of full speed.
export function startPlayer(
    layers: FlightLayers,
    daylight: { setTime(ms: number): void },
    pace: () => number
): Player {
    let day: Day | null = null;
    let timeline: Timeline;
    let follow: (aircraftPositions: LonLat[]) => void = () => {};
    let rewinding: Rewind | null = null;
    let nowSeconds = 0;                     // the moment of the day on the map, in seconds since its first departure
    let daylightMs = 0;
    let elapsedMs = 0;                      // of full-speed running so far
    let lastFrameTimeMs: number | null = null;
    let frameRequested = false;

    panel.onReplay(() => {
        if (day) play(day, follow);
    });

    return { play, rewind };

    function play(nextDay: Day, nextFollow: (aircraftPositions: LonLat[]) => void): void {
        day = nextDay;
        follow = nextFollow;
        rewinding = null;
        timeline = startTimeline(day.data);
        layers.clear();
        nowSeconds = 0;
        elapsedMs = 0;
        lastFrameTimeMs = null;
        panel.setTotal(day.data.features.length);
        panel.offerReplay(false);
        requestFrame();
    }

    function rewind(durationMs: number, daylightToMs: number): Promise<void> {
        rewinding?.done();
        panel.offerReplay(false);
        return new Promise((done) => {
            rewinding = { fromSeconds: nowSeconds, daylightFromMs: daylightMs, daylightToMs, durationMs, startMs: null, done };
            requestFrame();
        });
    }

    function requestFrame(): void {
        if (frameRequested) return;
        frameRequested = true;
        requestAnimationFrame(drawFrame);
    }

    function drawFrame(frameTimeMs: number): void {
        frameRequested = false;
        if (!day) return;
        const more = rewinding ? rewindFrame(rewinding, frameTimeMs) : playFrame(day, frameTimeMs);
        if (more) requestFrame();
    }

    // Moves the day on by one frame. Returns whether there is more to play.
    function playFrame({ data }: Day, frameTimeMs: number): boolean {
        // The clock moves on by however much of the frame the camera's zoom
        // allows. requestAnimationFrame's timestamps can run slightly out of
        // order, hence the clamp at 0.
        if (lastFrameTimeMs !== null) {
            const frameMs = Math.min(Math.max(frameTimeMs - lastFrameTimeMs, 0), LONGEST_FRAME_MS);
            elapsedMs += frameMs * pace();
        }
        lastFrameTimeMs = frameTimeMs;

        // The clock stops at the last recorded position, but nowSeconds runs on
        // past it so the trails still lit then can cool.
        nowSeconds = (elapsedMs / DURATION_MS) * data.span;

        const moment = timeline.advanceTo(nowSeconds);
        daylightMs = clockTime(data.epoch, data.span).getTime();
        draw(moment);
        follow(moment.pathsToRender.map(({ pathToRender }) => pathToRender.aircraftPosition));

        if (nowSeconds < data.span || moment.pathsToRender.length) return true;
        panel.offerReplay(true);
        return false;
    }

    // Moves the rewind on by one frame. Returns whether there is more to rewind.
    function rewindFrame(rewind: Rewind, frameTimeMs: number): boolean {
        rewind.startMs ??= frameTimeMs;
        const progress = Math.min((frameTimeMs - rewind.startMs) / rewind.durationMs, 1);
        const eased = (1 - Math.cos(Math.PI * progress)) / 2;

        nowSeconds = rewind.fromSeconds * (1 - eased);
        daylightMs = rewind.daylightFromMs + (rewind.daylightToMs - rewind.daylightFromMs) * eased;
        draw(timeline.momentAt(nowSeconds));

        if (progress < 1) return true;
        layers.clear();
        rewinding = null;
        rewind.done();
        return false;
    }

    // Draws `moment` and reports it to the panel. The clock shows nowSeconds as
    // a real date, stopped at the last recorded position.
    function draw(moment: Moment): void {
        if (!day) return;
        const { data, city } = day;
        if (moment.settledChanged) layers.drawSettled(moment.settled);
        layers.drawLit(moment.pathsToRender);
        daylight.setTime(daylightMs);
        panel.update({
            at: clockTime(data.epoch, data.span),
            timeZone: city.timeZone,
            airborne: moment.airborne,
            departed: moment.departed,
            progress: Math.min(nowSeconds / data.span, 1)
        });
    }

    function clockTime(epoch: number, span: number): Date {
        return new Date((epoch + Math.min(nowSeconds, span)) * 1000);
    }
}
