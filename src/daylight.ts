import type { CustomLayerInterface, CustomRenderMethodInput, Map } from 'maplibre-gl';
import { lonLatToVector, type Vector } from './geo.ts';
import { color } from './palette.ts';
import { subsolar } from './sun.ts';
import { FRAGMENT_SOURCE, PASS_UNIFORM, vertexSource } from './daylightShader.ts';

// Daylight on the globe, drawn as a custom WebGL layer: one mesh over the
// whole sphere, with the sun's height worked out per pixel in the fragment
// shader. MapLibre's fill layers cannot vary colour within a feature, and
// stacked translucent polygons show their edges.
//
// It takes three passes of the same mesh, added to the map in this order:
// - sea, straight after the basemap's background: fades the sea to its day
//   colour.
// - land, after the basemap's land: adds light to the land.
// - night, straight after: dims the night side.

export type Kind = 'sea' | 'land' | 'night';

export type DaylightLayer = CustomLayerInterface & { setTime(ms: number): void };

type Rgb = [number, number, number];

const RAD = Math.PI / 180;

export function daylightLayer(kind: Kind): DaylightLayer {
    const seaDayColor = rgb(color('day-ocean'));
    const landDayLight = addedLandLight(color('map-land'), color('day-land'));
    // One per projection variant, compiled on first use.
    const programs: Record<string, Program> = {};
    let sunDirection: Vector = [1, 0, 0];
    let map: Map | undefined;
    let buffers: { vertices: WebGLBuffer; indices: WebGLBuffer } | undefined;
    let count = 0;

    return {
        id: `daylight-${kind}`,
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
            sunDirection = lonLatToVector(subsolar(ms));
            map?.triggerRepaint();
        },

        render(gl, { shaderData, defaultProjectionData: projection }) {
            if (!buffers) return;
            programs[shaderData.variantName] ??= createProgram(gl, shaderData);
            const { program: p, pos, pole, normal, uniforms: u } = programs[shaderData.variantName];
            gl.useProgram(p);

            gl.uniformMatrix4fv(u.matrix, false, projection.mainMatrix);
            gl.uniformMatrix4fv(u.fallback, false, projection.fallbackMatrix);
            gl.uniform4f(u.tile, ...projection.tileMercatorCoords);
            gl.uniform4f(u.clipping, ...projection.clippingPlane);
            gl.uniform1f(u.transition, projection.projectionTransition);
            gl.uniform3f(u.sunDirection, ...sunDirection);
            gl.uniform3f(u.seaDayColor, ...seaDayColor);
            gl.uniform3f(u.landDayLight, ...landDayLight);
            gl.uniform1i(u.pass, PASS_UNIFORM[kind]);

            const stride = 6 * 4;
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertices);
            gl.enableVertexAttribArray(pos);
            gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, stride, 0);
            gl.enableVertexAttribArray(pole);
            gl.vertexAttribPointer(pole, 1, gl.FLOAT, false, stride, 2 * 4);
            gl.enableVertexAttribArray(normal);
            gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, stride, 3 * 4);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);

            // canvasColor: the colour already on the canvas.
            // canvasAlpha: the alpha already on the canvas.
            // src:         what the shader outputs for the pixel, as (srcColor, srcAlpha).
            // result:      what the blend writes back to the canvas.
            //
            // With blending on, result is a combination of src and what is already on
            // the canvas, instead of src alone. blendFuncSeparate(a, b, c, d) sets the
            // four factors of that combination:
            //
            //   result colour = srcColor * a + canvasColor * b
            //   result alpha  = srcAlpha * c + canvasAlpha * d
            //
            // A factor is a constant such as ONE or ZERO, or one of the values above,
            // such as SRC_ALPHA or DST_ALPHA (canvasAlpha). Each pass picks factors that
            // change the map already drawn instead of covering it. The shader's dither
            // noise is left out of the comments below.
            // MapLibre restores its own blend state after a custom layer.
            gl.enable(gl.BLEND);
            if (kind === 'sea') {
                // seaNightColor: the colour already on the canvas, the basemap's night sea.
                // src:           what the shader outputs for the pixel, as (colour, alpha):
                //                (seaDayColor * daylight, daylight), where daylight is 0 at
                //                night and 1 in full day.
                // result:        what the blend writes back to the canvas.
                //
                //   result colour = seaDayColor * daylight + seaNightColor * (1 - daylight)
                //   result alpha  = 0
                //
                // The colour goes from seaNightColor at daylight 0 to seaDayColor at
                // daylight 1. Alpha 0 marks the pixel as sea. The basemap's land is drawn
                // opaque over it next, which sets alpha back to 1 on land, so the land pass
                // can tell land from sea.
                gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ZERO);
            } else if (kind === 'land') {
                // mapColor:    the colour already on the canvas, the map drawn so far.
                // canvasAlpha: the alpha already on the canvas, 0 on sea and 1 on land.
                // src:         what the shader outputs for the pixel, as (colour, alpha):
                //              (landDayLight * daylight, 1), where daylight is 0 at
                //              night and 1 in full day.
                // result:      what the blend writes back to the canvas.
                //
                //   result colour = landDayLight * daylight * canvasAlpha + mapColor
                //   result alpha  = 1
                //
                // On land the light is added to mapColor, and on sea nothing is added.
                // Alpha 1 makes the canvas opaque again.
                gl.blendFuncSeparate(gl.DST_ALPHA, gl.ONE, gl.ONE, gl.ZERO);
            } else {
                // mapColor:    the colour already on the canvas, the map drawn so far.
                // canvasAlpha: the alpha already on the canvas.
                // src:         what the shader outputs for the pixel, as (colour, alpha):
                //              (0, 1 - NIGHT_DIMMING * (1 - daylight)), where daylight
                //              is 0 at night and 1 in full day.
                // result:      what the blend writes back to the canvas.
                //
                //   result colour = mapColor * (1 - NIGHT_DIMMING * (1 - daylight))
                //   result alpha  = canvasAlpha
                //
                // The colour is mapColor at daylight 1, and mapColor dimmed by
                // NIGHT_DIMMING at daylight 0. Alpha is left unchanged.
                gl.blendFuncSeparate(gl.ONE, gl.SRC_ALPHA, gl.ZERO, gl.ONE);
            }
            gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
        }
    };
}

// The light that takes the land from its night colour to its day colour: the
// day colour minus the night colour, per rgb channel. Blending can only add
// light, so a channel that is darker by day than by night gets 0.
export function addedLandLight(nightLand: string, dayLand: string): Rgb {
    const night = rgb(nightLand);
    const day = rgb(dayLand);
    return [0, 1, 2].map((i) => Math.max(day[i] - night[i], 0)) as Rgb;
}

function rgb(hex: string): Rgb {
    const n = parseInt(hex.replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Two and a half degrees of longitude apart.
const COLS = 144;
// Evenly spaced in mercator y, so closer near the poles.
const ROWS = 72;

// MapLibre's projection can put a vertex exactly on a pole, which the mercator
// square cannot reach, when its raw y is past either of these.
const NORTH_POLE = -32768;
const SOUTH_POLE = 32767;

// The sphere as a grid in mercator coordinates, 0..1 on both axes, which is
// what the projection's `projectTile` takes from a custom layer. A row is
// added at each end on the pole itself, so the caps beyond the mercator
// square are lit too. Each vertex carries its mercator position, the raw y
// that marks a pole, and its direction from the centre of the earth.
export function globeMesh(cols = COLS, rows = ROWS): { vertices: Float32Array; indices: Uint16Array } {
    const vertices: number[] = [];
    const lines = rows + 3;

    for (let j = 0; j < lines; j++) {
        const y = Math.min(Math.max((j - 1) / rows, 0), 1);
        const pole = j === 0 ? NORTH_POLE : j === lines - 1 ? SOUTH_POLE : 0;
        const lat = pole === NORTH_POLE ? 90 : pole === SOUTH_POLE ? -90 : mercatorLat(y);

        for (let i = 0; i <= cols; i++) {
            const x = i / cols;
            vertices.push(x, y, pole, ...lonLatToVector([x * 360 - 180, lat]));
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

function mercatorLat(y: number): number {
    return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / RAD;
}

type ShaderData = CustomRenderMethodInput['shaderData'];

type Program = {
    program: WebGLProgram;
    pos: number;
    pole: number;
    normal: number;
    uniforms: Record<string, WebGLUniformLocation | null>;
};

function createProgram(gl: WebGL2RenderingContext, shaderData: ShaderData): Program {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vertexSource(shaderData)));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(`daylight: ${gl.getProgramInfoLog(p)}`);
    }

    const at = (name: string) => gl.getUniformLocation(p, name);
    return {
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
            sunDirection: at('u_sun_direction'),
            seaDayColor: at('u_sea_day_color'),
            landDayLight: at('u_land_day_light'),
            pass: at('u_pass')
        }
    };
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
