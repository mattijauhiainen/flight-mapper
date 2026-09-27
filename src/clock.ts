// The clock runs at a pace set by how close in the camera is. Every zoom level
// closer doubles how fast the ground slides across the screen, so a clock at
// full speed close in flings the aircraft off the edge before the eye has found
// them. Here each level in costs the clock a fixed share of its speed instead,
// reaching full speed once the whole globe is in view -- so the run opens at a
// crawl over Hong Kong and gathers pace as the camera backs away, whether it is
// the opening camera doing the backing or the viewer.
//
// An exponent of 1 would hold the aircraft to one on-screen speed at every
// zoom, which close in is slow enough to leave the second departure waiting on
// the runway for ten seconds. At 0.75 they still slow down a long way, only not
// all the way.
export const PACE = 0.75;

// The share of full speed the clock runs at `zoom`, when `whole` is the zoom
// at which the whole globe is in view. Never faster than full.
export function pace(zoom: number, whole: number): number {
    return Math.min(1, 2 ** (PACE * (whole - zoom)));
}
