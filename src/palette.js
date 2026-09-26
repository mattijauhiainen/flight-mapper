// Every colour the page uses is declared once, in style.css, under a name that
// says what it is for. MapLibre paint properties take plain colour strings and
// know nothing of var(--x), so the custom properties are resolved to values
// here and handed to the layers as literals.
//
// getComputedStyle returns a live view of the element's style, so one lookup at
// module load is enough; each read goes to the stylesheet as it stands.
const root = getComputedStyle(document.documentElement);

export function color(name) {
    const value = root.getPropertyValue(`--${name}`).trim();
    if (!value) throw new Error(`palette: --${name} is not defined in style.css`);
    return value;
}
