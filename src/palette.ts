// Every colour the page uses is declared once, in style.css, under a name that
// says what it is for. MapLibre paint properties take plain colour strings and
// know nothing of var(--x), so the custom properties are resolved to values
// here and handed to the layers as literals.
export function color(name: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
    if (!value) throw new Error(`palette: --${name} is not defined in style.css`);
    return value;
}
