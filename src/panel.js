// The overlay that reads the timeline back: Hong Kong wall time, how many
// aircraft are up, and how far through the run we are.
const hkOpts = { timeZone: 'Asia/Hong_Kong', hour12: false };
const clockFmt = new Intl.DateTimeFormat('en-GB', { ...hkOpts, hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-GB', { ...hkOpts, weekday: 'short', day: 'numeric', month: 'short' });

const el = {
    clock: document.getElementById('clock'),
    date: document.getElementById('date'),
    airborne: document.getElementById('airborne'),
    departed: document.getElementById('departed'),
    total: document.getElementById('total'),
    bar: document.getElementById('bar'),
    replay: document.getElementById('replay')
};

export function setTotal(total) {
    el.total.textContent = total;
}

export function update({ at, airborne, departed, progress }) {
    el.clock.textContent = clockFmt.format(at);
    el.date.textContent = dateFmt.format(at);
    el.airborne.textContent = airborne;
    el.departed.textContent = departed;
    el.bar.style.width = `${progress * 100}%`;
}

export function offerReplay(show) {
    el.replay.hidden = !show;
}

export function onReplay(handler) {
    el.replay.addEventListener('click', handler);
}
