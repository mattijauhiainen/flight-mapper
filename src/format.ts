// Text formats shared by the clock panel and the popups.

const hongKongTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false
});
const hongKongDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong', weekday: 'short', day: 'numeric', month: 'short'
});
const wholeNumber = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// "14:05", in Hong Kong time
export function formatHongKongTime(date: Date): string {
    return hongKongTime.format(date);
}

// "Fri 21 Feb", in Hong Kong time
export function formatHongKongDate(date: Date): string {
    return hongKongDate.format(date);
}

// "11,045 km"
export function formatKm(km: number): string {
    return `${wholeNumber.format(km)} km`;
}

// "15.2%"
export function formatPercent(percent: number): string {
    return `${oneDecimal.format(percent)}%`;
}
