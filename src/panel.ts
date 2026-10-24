import { CITIES } from './cities.ts';
import type { City } from './cities.ts';
import { formatCount, formatDate, formatTime } from './format.ts';

// The overlay that reads the timeline back: the city's wall time, how many
// aircraft are up, and how far through the run we are.

function byId(id: string): HTMLElement {
    const node = document.getElementById(id);
    if (!node) throw new Error(`panel: #${id} is not in index.html`);
    return node;
}

const el = {
    panel: byId('panel'),
    cityName: byId('city-name'),
    cities: byId('cities'),
    cityList: byId('city-list'),
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
    timeZone: string;   // the one the clock reads in
    airborne: number;
    departed: number;   // including those that have since landed
    progress: number;   // 0..1 through the run
};

// Names the city in the title and marks it in the city picker.
export function setCity(city: City): void {
    el.cityName.textContent = city.name;
    el.cityList.replaceChildren(...CITIES.map((each) => cityRow(each, each.id === city.id)));
}

// `handler` gets the id of the city picked. Picking one closes the picker.
export function onCityChange(handler: (id: string) => void): void {
    el.cityList.addEventListener('click', (e) => {
        const row = (e.target as Element).closest<HTMLButtonElement>('button[data-city]');
        if (!row?.dataset.city || row.disabled) return;
        el.cities.hidePopover();
        handler(row.dataset.city);
    });
}

// `handler` runs every time the city picker opens.
export function onCitiesOpen(handler: () => void): void {
    el.cities.addEventListener('toggle', (e) => {
        if ((e as ToggleEvent).newState === 'open') handler();
    });
}

export function setTotal(total: number): void {
    el.total.textContent = String(total);
}

export function update({ at, timeZone, airborne, departed, progress }: Reading): void {
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

// One city in the picker: its name and airport, and the day of departures it
// has. The city on the map is marked and cannot be picked.
function cityRow(city: City, current: boolean): HTMLLIElement {
    const row = document.createElement('button');
    row.dataset.city = city.id;
    row.disabled = current;
    if (current) row.setAttribute('aria-current', 'true');
    const date = formatDate(new Date(city.firstDepartureMs), city.timeZone);
    row.append(
        span('name', city.name),
        span('airport', city.airport),
        span('day', `${date} · ${formatCount(city.departures)} departures`)
    );

    const item = document.createElement('li');
    item.append(row);
    return item;
}

function span(className: string, text: string): HTMLSpanElement {
    const node = document.createElement('span');
    node.className = className;
    node.textContent = text;
    return node;
}

// The picker opens under the title, as wide as the panel. It is in the top
// layer, so its position is worked out from the panel's.
el.cities.addEventListener('beforetoggle', (e) => {
    if ((e as ToggleEvent).newState !== 'open') return;
    const panel = el.panel.getBoundingClientRect();
    el.cities.style.top = `${el.cityName.getBoundingClientRect().bottom + 8}px`;
    el.cities.style.left = `${panel.left}px`;
    el.cities.style.width = `${panel.width}px`;
});
