import type { CustomLayerInterface, CustomRenderMethodInput, Map } from 'maplibre-gl';
import { subsolar, toSphere } from './sun.ts';

// Daylight on the globe, drawn as a custom WebGL layer rather than as fill
// polygons. MapLibre's styling colours whole features and cannot ask whether
// the sun is up at a given pixel, and stacked translucent polygons show every
// edge they are made of. So this draws one mesh over the whole sphere and
// works out the sun's height for every pixel in the fragment shader, which
// gives a light that rises continuously through dawn with no band to see.
//
// Sea and land each get a day colour of their own, which takes three passes
// of the same mesh and the canvas's alpha channel as a mask:
//
// - sea, straight after the basemap's background: fades the sea towards
//   --day-ocean, and writes alpha 0 to mark every pixel it touched as sea.
// - The basemap then paints its land over that, opaque, which writes alpha
//   back to 1 wherever there is land.
// - land, above the land: adds the light that takes --map-land to --day-land,
//   scaled by that alpha, so it lands on the land and nowhere else, and puts
//   alpha back to 1 for the canvas.
// - night, straight after: scales everything down on the night side.
//
// Nothing else reads the alpha in between, and the canvas only shows once the
// frame is finished, by which time the land pass has made it whole again.

const RAD = Math.PI / 180;

// The sun's height, in degrees, at which the light starts to come up and at
// which it is full. Starting well below the horizon lets dawn creep in the
// way twilight does; finishing well above it spreads the rise over a few
// thousand kilometres, so there is no edge to the day, only a slope.
const DAWN = -12;
const MORNING = 22;

export const NIGHT_DIM = 0.4;   // how much of the map deep night takes away

const COLS = 144;        // two and a half degrees of longitude apart
const ROWS = 72;         // evenly spaced in mercator y, so closer near the poles

// MapLibre's projection can put a vertex exactly on a pole, which the mercator
// square cannot reach, when its raw y is past either of these.
const NORTH_POLE = -32768;
const SOUTH_POLE = 32767;

function mercatorLat(y: number): number {
    return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / RAD;
}

// The sphere as a grid in mercator coordinates, 0..1 on both axes, which is
// what the projection's `projectTile` takes from a custom layer. A row is
// added at each end on the pole itself, so the caps beyond the mercator
// square are lit along with everything else. Each vertex carries its mercator
// position, the raw y that marks a pole, and its direction from the centre of
// the earth, which is all the fragment shader needs to find the sun's height.
export function globeMesh(cols = COLS, rows = ROWS): { vertices: Float32Array; indices: Uint16Array } {
    const vertices: number[] = [];
    const lines = rows + 3;

    for (let j = 0; j < lines; j++) {
        const y = Math.min(Math.max((j - 1) / rows, 0), 1);
        const pole = j === 0 ? NORTH_POLE : j === lines - 1 ? SOUTH_POLE : 0;
        const lat = pole === NORTH_POLE ? 90 : pole === SOUTH_POLE ? -90 : mercatorLat(y);

        for (let i = 0; i <= cols; i++) {
            const x = i / cols;
            vertices.push(x, y, pole, ...toSphere([x * 360 - 180, lat]));
        }
    }

    const indices: number[] = [];
    for (let j = 0; j < lines - 1; j++) {
        for (let i = 0; i < cols; i++) {
            const a = j * (cols + 1) + i;
            const b = a + cols + 1;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }

    return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
    const n = parseInt(hex.replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// What the sea and land passes need at full day, as 0..1 rgb. The sea pass
// fades to its colour outright; the land pass can only add light, so it gets
// the difference between the land by day and by night. A day land darker
// than the night one in any channel comes out as the night one there.
export function daylights({ land, dayOcean, dayLand }: { land: string; dayOcean: string; dayLand: string }): { sea: Rgb; land: Rgb } {
    const night = rgb(land);
    const day = rgb(dayLand);
    return {
        sea: rgb(dayOcean),
        land: [0, 1, 2].map((i) => Math.max(day[i] - night[i], 0)) as Rgb
    };
}

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 u_sun;
uniform vec3 u_day;
uniform vec2 u_ramp;
uniform float u_night;
uniform int u_pass;   // 0 sea, 1 land, 2 night
in vec3 v_normal;
out vec4 fragColor;
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
    float height = dot(normalize(v_normal), u_sun);
    float day = smoothstep(u_ramp.x, u_ramp.y, height);
    float noise = dither() / 255.0;
    if (u_pass == 0) {
        fragColor = vec4(u_day * day + noise, day);
    } else if (u_pass == 1) {
        fragColor = vec4(u_day * day + noise, 1.0);
    } else {
        fragColor = vec4(vec3(noise), 1.0 - u_night * (1.0 - day));
    }
}`;

type ShaderData = CustomRenderMethodInput['shaderData'];

function vertexSource({ vertexShaderPrelude, define }: ShaderData): string {
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

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('daylight: could not create a shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`daylight: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
}

// How each pass blends, as [src rgb, dst rgb, src alpha, dst alpha] factors.
// The sea mixes towards its colour and marks itself with alpha 0; the land
// adds its light only where the alpha says land, and restores the alpha; the
// night multiplies the map by its dimming and leaves the alpha alone.
type BlendFactor = 'ONE' | 'ZERO' | 'SRC_ALPHA' | 'ONE_MINUS_SRC_ALPHA' | 'DST_ALPHA';

export type Kind = 'sea' | 'land' | 'night';

const PASSES: Record<Kind, { index: number; blend: [BlendFactor, BlendFactor, BlendFactor, BlendFactor] }> = {
    sea: { index: 0, blend: ['ONE', 'ONE_MINUS_SRC_ALPHA', 'ZERO', 'ZERO'] },
    land: { index: 1, blend: ['DST_ALPHA', 'ONE', 'ONE', 'ZERO'] },
    night: { index: 2, blend: ['ONE', 'SRC_ALPHA', 'ZERO', 'ONE'] }
};

// One pass of daylight, `kind` being 'sea', 'land' or 'night'. `light` is
// the sea's day colour or the land's added light, as 0..1 rgb, and `night`
// how much of the map deep night takes away.
type Program = {
    program: WebGLProgram;
    pos: number;
    pole: number;
    normal: number;
    uniforms: Record<string, WebGLUniformLocation | null>;
};

// A pass as main.ts adds it to the map: a custom layer, and the way to move
// the sun it lights the globe by.
export type DaylightLayer = CustomLayerInterface & { setTime(ms: number): void };

export function daylightLayer(
    id: string,
    kind: Kind,
    { light = [0, 0, 0], night = 0 }: { light?: Rgb; night?: number } = {}
): DaylightLayer {
    const pass = PASSES[kind];
    const programs: Record<string, Program> = {};   // one per projection variant, compiled on first use
    let sun: [number, number, number] = [0, 0, 1];
    let map: Map | undefined;
    let buffers: { vertices: WebGLBuffer; indices: WebGLBuffer } | undefined;
    let count = 0;

    function program(gl: WebGL2RenderingContext, shaderData: ShaderData): Program {
        if (programs[shaderData.variantName]) return programs[shaderData.variantName];

        const p = gl.createProgram();
        gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vertexSource(shaderData)));
        gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            throw new Error(`daylight: ${gl.getProgramInfoLog(p)}`);
        }

        const at = (name: string) => gl.getUniformLocation(p, name);
        programs[shaderData.variantName] = {
            program: p,
            pos: gl.getAttribLocation(p, 'a_pos'),
            pole: gl.getAttribLocation(p, 'a_pole'),
            normal: gl.getAttribLocation(p, 'a_normal'),
            uniforms: {
                matrix: at('u_projection_matrix'),
                fallback: at('u_projection_fallback_matrix'),
                tile: at('u_projection_tile_mercator_coords'),
                clipping: at('u_projection_clipping_plane'),
                transition: at('u_projection_transition'),
                sun: at('u_sun'),
                day: at('u_day'),
                ramp: at('u_ramp'),
                night: at('u_night'),
                pass: at('u_pass')
            }
        };
        return programs[shaderData.variantName];
    }

    return {
        id,
        type: 'custom',
        renderingMode: '2d',

        onAdd(m, gl) {
            map = m;
            const mesh = globeMesh();
            count = mesh.indices.length;
            buffers = { vertices: gl.createBuffer(), indices: gl.createBuffer() };
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertices);
            gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
        },

        onRemove(m, gl) {
            if (buffers) {
                gl.deleteBuffer(buffers.vertices);
                gl.deleteBuffer(buffers.indices);
            }
            for (const { program: p } of Object.values(programs)) gl.deleteProgram(p);
        },

        // The time the light shows is the animation's, not the wall clock's.
        setTime(ms: number) {
            sun = toSphere(subsolar(ms));
            map?.triggerRepaint();
        },

        render(gl, { shaderData, defaultProjectionData: projection }) {
            if (!buffers) return;
            const { program: p, pos, pole, normal, uniforms: u } = program(gl, shaderData);
            gl.useProgram(p);

            gl.uniformMatrix4fv(u.matrix, false, projection.mainMatrix);
            gl.uniformMatrix4fv(u.fallback, false, projection.fallbackMatrix);
            gl.uniform4f(u.tile, ...projection.tileMercatorCoords);
            gl.uniform4f(u.clipping, ...projection.clippingPlane);
            gl.uniform1f(u.transition, projection.projectionTransition);
            gl.uniform3f(u.sun, ...sun);
            gl.uniform3f(u.day, ...light);
            gl.uniform2f(u.ramp, Math.sin(DAWN * RAD), Math.sin(MORNING * RAD));
            gl.uniform1f(u.night, night);
            gl.uniform1i(u.pass, pass.index);

            const stride = 6 * 4;
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertices);
            gl.enableVertexAttribArray(pos);
            gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, stride, 0);
            gl.enableVertexAttribArray(pole);
            gl.vertexAttribPointer(pole, 1, gl.FLOAT, false, stride, 2 * 4);
            gl.enableVertexAttribArray(normal);
            gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, stride, 3 * 4);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);

            // MapLibre restores its own blend state after a custom layer.
            gl.enable(gl.BLEND);
            const [srcRgb, dstRgb, srcAlpha, dstAlpha] = pass.blend;
            gl.blendFuncSeparate(gl[srcRgb], gl[dstRgb], gl[srcAlpha], gl[dstAlpha]);
            gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
        }
    };
}
