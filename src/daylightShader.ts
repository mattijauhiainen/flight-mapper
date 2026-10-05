import type { CustomRenderMethodInput } from 'maplibre-gl';

type ShaderData = CustomRenderMethodInput['shaderData'];

// The value of u_pass for each of the daylight passes.
export const PASS_UNIFORM = { sea: 0, land: 1, night: 2 } as const;

export function vertexSource({ vertexShaderPrelude, define }: ShaderData): string {
    return `#version 300 es
${define}
${vertexShaderPrelude}
in vec2 a_pos;
in float a_pole;
in vec3 a_normal;
out vec3 v_normal;
void main() {
    v_normal = a_normal;
    gl_Position = projectTile(a_pos, vec2(0.0, a_pole));
}`;
}

export const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
// Unit vector from the centre of the earth towards the sun.
uniform vec3 u_sun_direction;
// The sea's colour in full day.
uniform vec3 u_sea_day_color;
// The light the land pass adds to the land in full day.
uniform vec3 u_land_day_light;
uniform int u_pass;   // 0 sea, 1 land, 2 night
in vec3 v_normal;
out vec4 fragColor;
// The sine of the sun's elevation at which daylight starts to come up, and at
// which it is full.
const float DAWN_SUN_HEIGHT = sin(radians(-12.0));
const float FULL_DAY_SUN_HEIGHT = sin(radians(22.0));
// How much of the map's brightness the night pass takes away in full night.
const float NIGHT_DIMMING = 0.4;
// Interleaved gradient noise, 0..1 per pixel. The rise from night to day is
// gentle enough that it only moves the screen one colour level every few
// dozen pixels, and each of those steps shows as a stripe. Up to a level of
// noise breaks them up. It can only be added -- anything below zero is
// clamped before the blend -- so it lifts the map by half a level on average,
// which is far too little to see.
float dither() {
    return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}
void main() {
    // The sine of the sun's elevation above the horizon at this point.
    float sunHeight = dot(normalize(v_normal), u_sun_direction);
    // 0 at night, 1 in full day.
    float daylight = smoothstep(DAWN_SUN_HEIGHT, FULL_DAY_SUN_HEIGHT, sunHeight);
    float noise = dither() / 255.0;
    if (u_pass == 0) {
        fragColor = vec4(u_sea_day_color * daylight + noise, daylight);
    } else if (u_pass == 1) {
        fragColor = vec4(u_land_day_light * daylight + noise, 1.0);
    } else {
        fragColor = vec4(vec3(noise), 1.0 - NIGHT_DIMMING * (1.0 - daylight));
    }
}`;
