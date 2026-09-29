// The overlay that reads the timeline back: Hong Kong wall time, how many
// aircraft are up, and how far through the run we are.
const hkOpts = { timeZone: 'Asia/Hong_Kong', hour12: false };
const clockFmt = new Intl.DateTimeFormat('en-GB', { ...hkOpts, hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-GB', { ...hkOpts, weekday: 'short', day: 'numeric', month: 'short' });

function byId(id: string): HTMLElement {
    const node = document.getElementById(id);
    if (!node) throw new Error(`panel: #${id} is not in index.html`);
    return node;
}

const el = {
    clock: byId('clock'),
    date: byId('date'),
    airborne: byId('airborne'),
    departed: byId('departed'),
    total: byId('total'),
    bar: byId('bar'),
    replay: byId('replay')
};

export type Reading = {
    at: Date;           // the simulated wall-clock time
    airborne: number;
    departed: number;   // including those that have since landed
    progress: number;   // 0..1 through the run
};

export function setTotal(total: number): void {
    el.total.textContent = String(total);
}

export function update({ at, airborne, departed, progress }: Reading): void {
    el.clock.textContent = clockFmt.format(at);
    el.date.textContent = dateFmt.format(at);
    el.airborne.textContent = String(airborne);
    el.departed.textContent = String(departed);
    el.bar.style.width = `${progress * 100}%`;
}

export function offerReplay(show: boolean): void {
    el.replay.hidden = !show;
}

export function onReplay(handler: () => void): void {
    el.replay.addEventListener('click', handler);
}
