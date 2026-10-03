import type { LonLat } from './tracks.ts';

// Geometry for the travelling fade. A point on a path is fully lit as the
// aircraft passes over it and has cooled to nothing a while later, so the lit
// stretch follows the aircraft and the path behind it settles down. MapLibre
// paints one opacity per line, so the fade cannot be a single line: the path is
// cut into segments, each drawn as its own line with its own fade.
//
// Everything here is pure and works in the recorded day's own time, so it can
// be exercised without a map.

// How long after the aircraft passes a point on its path that point has fully
// cooled: an hour and a half of the recorded day, which is about three and a
// half seconds of the run.
export const COOLS_AFTER_SECONDS = 1.5 * 3600;

// How many segments the lit stretch, from where the path has just cooled up to
// the aircraft, is drawn with.
export const LIT_SEGMENTS = 10;

// A recorded path: the aircraft was at positions[i] at timesSeconds[i], counted
// from the first departure of the day.
export type Path = {
    positions: LonLat[];
    timesSeconds: number[];
};

// A stretch of the path drawn as one line with one fade: 1 lit, 0 cooled.
export type PathSegment = {
    positions: LonLat[];
    fade: number;
};

// How a path should be drawn at one moment.
export type PathToRender = {
    segments: PathSegment[];
    aircraftPosition: LonLat;
    aircraftFade: number;
};

// A PathToRender and where the next search along the same path can start from.
//
// litStartIndex is the index of the recorded position at or just before where
// the lit stretch starts. It only moves forward as time passes, so passing it
// back as the next frame's searchFromIndex carries on from where this frame left
// off instead of searching the path from the start.
export type PathToRenderAt = {
    pathToRender: PathToRender;
    litStartIndex: number;
};

// The path as it should be drawn at `nowSeconds`: the cooled part as one
// segment, then the lit stretch up to the aircraft in LIT_SEGMENTS segments,
// each a little brighter than the one before. The search starts at
// `searchFromIndex`, which must be at or before the lit stretch's start.
export function pathToRenderAt(path: Path, nowSeconds: number, searchFromIndex = 0): PathToRenderAt {
    const { timesSeconds } = path;
    const lastIndex = timesSeconds.length - 1;
    const departureSeconds = timesSeconds[0];
    const arrivalSeconds = timesSeconds[lastIndex];

    // The lit stretch runs from where the path has just finished cooling to
    // where the aircraft is, both kept within the recorded path: before
    // departure nothing has cooled yet, and after landing the aircraft stays
    // on its last recorded position while the stretch behind it keeps cooling.
    const litStartSeconds = Math.max(nowSeconds - COOLS_AFTER_SECONDS, departureSeconds);
    const litEndSeconds = Math.min(nowSeconds, arrivalSeconds);

    // Step past every recorded position that has cooled.
    let litStartIndex = searchFromIndex;
    while (litStartIndex < lastIndex && timesSeconds[litStartIndex + 1] <= litStartSeconds) {
        litStartIndex++;
    }

    const segments: PathSegment[] = [];
    if (litStartSeconds > departureSeconds) segments.push(cooledSegment(path, litStartSeconds, litStartIndex));
    segments.push(...litSegments(path, litStartSeconds, litEndSeconds, litStartIndex, nowSeconds));

    return {
        pathToRender: {
            segments,
            aircraftPosition: positionAt(path, litEndSeconds, litStartIndex),
            aircraftFade: fadeAt(nowSeconds - litEndSeconds)
        },
        litStartIndex
    };
}

// The part of the path from departure up to `litStartSeconds`. All of it has
// cooled, so it is drawn as a single segment.
function cooledSegment(path: Path, litStartSeconds: number, litStartIndex: number): PathSegment {
    const passedPositions = path.positions.slice(0, litStartIndex + 1);
    const litStartPosition = positionAt(path, litStartSeconds, litStartIndex);
    return { positions: [...passedPositions, litStartPosition], fade: 0 };
}

// The lit stretch from `litStartSeconds` to `litEndSeconds`, cut into
// LIT_SEGMENTS segments of equal duration. Each segment is painted with the
// fade of its midpoint.
function litSegments(
    path: Path,
    litStartSeconds: number,
    litEndSeconds: number,
    litStartIndex: number,
    nowSeconds: number
): PathSegment[] {
    const { positions, timesSeconds } = path;
    const lastIndex = timesSeconds.length - 1;
    const segments: PathSegment[] = [];

    let positionIndex = litStartIndex;
    let segmentStartPosition = positionAt(path, litStartSeconds, positionIndex);
    for (let segmentNumber = 1; segmentNumber <= LIT_SEGMENTS; segmentNumber++) {
        const segmentEndSeconds = interpolate(litStartSeconds, litEndSeconds, segmentNumber / LIT_SEGMENTS);
        const segmentMidSeconds = interpolate(litStartSeconds, litEndSeconds, (segmentNumber - 0.5) / LIT_SEGMENTS);

        // Recorded positions the aircraft passed within the segment stay in
        // its line, so the segment follows the path rather than cutting
        // straight across its corners.
        const passedPositions: LonLat[] = [];
        while (positionIndex < lastIndex && timesSeconds[positionIndex + 1] < segmentEndSeconds) {
            positionIndex++;
            passedPositions.push(positions[positionIndex]);
        }

        const segmentEndPosition = positionAt(path, segmentEndSeconds, positionIndex);
        segments.push({
            positions: [segmentStartPosition, ...passedPositions, segmentEndPosition],
            fade: fadeAt(nowSeconds - segmentMidSeconds)
        });
        segmentStartPosition = segmentEndPosition;
    }
    return segments;
}

// Where the aircraft was at `timeSeconds`, interpolated between the recorded
// positions either side of it. The search starts at `searchFromIndex`, which
// must be at or before that time.
export function positionAt(path: Path, timeSeconds: number, searchFromIndex = 0): LonLat {
    const { positions, timesSeconds } = path;
    const lastIndex = timesSeconds.length - 1;

    let beforeIndex = searchFromIndex;
    while (beforeIndex < lastIndex && timesSeconds[beforeIndex + 1] <= timeSeconds) beforeIndex++;
    if (beforeIndex >= lastIndex) return positions[lastIndex];
    if (timeSeconds <= timesSeconds[beforeIndex]) return positions[beforeIndex];

    const afterIndex = beforeIndex + 1;
    const before = positions[beforeIndex];
    const after = positions[afterIndex];
    const gapSeconds = timesSeconds[afterIndex] - timesSeconds[beforeIndex];
    const fraction = gapSeconds > 0 ? (timeSeconds - timesSeconds[beforeIndex]) / gapSeconds : 0;
    return [interpolate(before[0], after[0], fraction), interpolate(before[1], after[1], fraction)];
}

// How lit a point on the path is, given how long ago the aircraft passed it.
export function fadeAt(secondsSincePassed: number): number {
    return Math.max(0, Math.min(1, 1 - secondsSincePassed / COOLS_AFTER_SECONDS));
}

// The value `fraction` of the way from `from` to `to`. Written so that a
// fraction of exactly 0 or 1 returns `from` or `to` exactly, which keeps the
// last lit segment ending precisely on the aircraft.
function interpolate(from: number, to: number, fraction: number): number {
    return from * (1 - fraction) + to * fraction;
}
