import { CITIES } from './cities.ts';
import type { City } from './cities.ts';
import { formatDate, formatTime } from './format.ts';

// The overlay that reads the timeline back: the city's wall time, how many
// aircraft are up, and how far through the run we are.

function byId(id: string): HTMLElement {
    const node = document.getElementById(id);
    if (!node) throw new Error(`panel: #${id} is not in index.html`);
    return node;
}

const el = {
    cityName: byId('city-name'),
    city: byId('city') as HTMLSelectElement,
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

let timeZone = 'UTC';

// Selects the city in the title and sets the time zone the clock reads in.
export function setCity(city: City): void {
    el.cityName.textContent = city.name;
    el.city.replaceChildren(...CITIES.map(({ id, name }) => new Option(name, id, false, id === city.id)));
    timeZone = city.timeZone;
}

// `handler` gets the id of the city picked in the title.
export function onCityChange(handler: (id: string) => void): void {
    el.city.addEventListener('change', () => handler(el.city.value));
}

export function setTotal(total: number): void {
    el.total.textContent = String(total);
}

export function update({ at, airborne, departed, progress }: Reading): void {
    el.clock.textContent = formatTime(at, timeZone);
    el.date.textContent = formatDate(at, timeZone);
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
