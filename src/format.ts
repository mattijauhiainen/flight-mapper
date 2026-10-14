// Text formats shared by the clock panel and the popups.

// "14:05", in `timeZone`
export function formatTime(date: Date, timeZone: string): string {
    return dateTimeFormat(timeZone, 'time').format(date);
}

// "Fri 21 Feb", in `timeZone`
export function formatDate(date: Date, timeZone: string): string {
    return dateTimeFormat(timeZone, 'date').format(date);
}

// "1,326"
export function formatCount(count: number): string {
    return wholeNumber.format(count);
}

// "11,045 km"
export function formatKm(km: number): string {
    return `${wholeNumber.format(km)} km`;
}

// "15.2%"
export function formatPercent(percent: number): string {
    return `${oneDecimal.format(percent)}%`;
}

const wholeNumber = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const DATE_TIME_OPTIONS: Record<'time' | 'date', Intl.DateTimeFormatOptions> = {
    time: { hour: '2-digit', minute: '2-digit', hour12: false },
    date: { weekday: 'short', day: 'numeric', month: 'short' }
};

// The panel formats the clock every animation frame, so each format is made
// once per time zone and kept.
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormat(timeZone: string, kind: 'time' | 'date'): Intl.DateTimeFormat {
    const key = `${timeZone} ${kind}`;
    let format = dateTimeFormats.get(key);
    if (!format) {
        format = new Intl.DateTimeFormat('en-GB', { timeZone, ...DATE_TIME_OPTIONS[kind] });
        dateTimeFormats.set(key, format);
    }
    return format;
}
