/**
 * The wordmark as a signed distance field, generated on the GPU from the vector path when the
 * logo starts: one draw of a fragment shader that measures, for every texel, the distance to
 * the nearest of the path's 332 straight segments and counts crossings for the even-odd fill.
 * Negative inside the letters, positive outside, in wordmark units (one unit is the box
 * height). Nothing is loaded: the texture is computed from WORDMARK_PATH.
 *
 * Shaded with the pixel's own footprint (see FIELD_GLSL's wordmarkCoverage), the field gives
 * edges antialiased to a fraction of a pixel at any size and any angle, sharp corners, and
 * the edge line, outline and silhouette tests the lobby's scene variants need, from one
 * texture lookup.
 *
 * Resolution follows the largest size it has been asked to draw at: `ensure` rebakes only when
 * the mark is drawn more than a little larger than the field was baked for, so a texel is
 * never wider than about three quarters of a screen pixel.
 */
import { ASPECT, wordmarkContours, type Contour } from './wordmarkMesh'
import { recordStartupPhase } from '../../core/diagnostics'

/** Room round the box the field covers, in wordmark units: for antialiasing, rims and the in-space halo. */
export const FIELD_PAD = 0.3
/** The field's rectangle in wordmark units: min x, min y, width, height. */
export const FIELD_BOUNDS = [-ASPECT / 2 - FIELD_PAD, -0.5 - FIELD_PAD, ASPECT + FIELD_PAD * 2, 1 + FIELD_PAD * 2] as const
/**
 * Distances an 8-bit field (on a device without half-float render targets) stores, either side
 * of the outline: as far as the in-scene halo reaches. Stored on a square-root curve, so the
 * steps are finest at the outline (about a tenth of a screen pixel there) and coarse only far
 * out, where the halo fades: the 8-bit field draws the in-scene name as well as the float one.
 */
const BYTE_RANGE = 0.32
/** Texels per wordmark unit, the least and the most baked. */
const MIN_DENSITY = 192, MAX_DENSITY = 640
/** Texels per screen pixel the field is baked at, at least. */
const OVERSAMPLE = 1.33

/** Every straight segment of the path, as x0, y0, x1, y1 in wordmark units. */
export function wordmarkSegments(contours: Contour[] = wordmarkContours()): Float32Array {
  const out: number[] = []
  for (const { points } of contours) for (let i = 0; i < points.length; i++) { const p = points[i], q = points[(i + 1) % points.length]; out.push(p[0], p[1], q[0], q[1]) }
  return new Float32Array(out)
}

/** The same measurement the bake shader makes, for tests: signed distance at a point. */
export function signedDistance(segments: Float32Array, x: number, y: number): number {
  let best = Infinity, inside = false
  for (let i = 0; i < segments.length; i += 4) {
    const ax = segments[i], ay = segments[i + 1], bx = segments[i + 2], by = segments[i + 3]
    const ex = bx - ax, ey = by - ay, px = x - ax, py = y - ay
    const t = Math.min(1, Math.max(0, (px * ex + py * ey) / Math.max(1e-12, ex * ex + ey * ey)))
    best = Math.min(best, Math.hypot(px - ex * t, py - ey * t))
    if ((ay > y) !== (by > y) && x < ex * (y - ay) / ey + ax) inside = !inside
  }
  return inside ? -best : best
}

const BAKE_VERTEX = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`
const BAKE_FRAGMENT = `#version 300 es
precision highp float;
uniform highp sampler2D uSegments; uniform int uCount; uniform vec4 uBounds; uniform vec2 uSize; uniform vec2 uEncode;   // range, 1 for bytes
out vec4 color;
void main() {
  vec2 p = uBounds.xy + gl_FragCoord.xy / uSize * uBounds.zw;
  float best = 1e9; bool inside = false;
  for (int i = 0; i < uCount; i++) {
    vec4 s = texelFetch(uSegments, ivec2(i, 0), 0);
    vec2 e = s.zw - s.xy, w = p - s.xy;
    float t = clamp(dot(w, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
    vec2 d = w - e * t; best = min(best, dot(d, d));
    if ((s.y > p.y) != (s.w > p.y) && p.x < e.x * (p.y - s.y) / e.y + s.x) inside = !inside;
  }
  float d = inside ? -sqrt(best) : sqrt(best);
  // Float targets keep the distance as it is; bytes keep it on a square-root curve in 0 to 1,
  // finest at the outline (wordmarkDistance decodes it).
  color = vec4(uEncode.y > 0.5 ? 0.5 + 0.5 * sign(d) * sqrt(min(abs(d) / uEncode.x, 1.0)) : d, 0.0, 0.0, 1.0);
}`

/**
 * GLSL for anything that draws with the field. Declares its uniforms and two functions:
 * wordmarkDistance(p), the signed distance at p in wordmark units, and wordmarkCoverage(d, w),
 * the share of a pixel of footprint w (wordmark units) covered by the letters.
 */
export const FIELD_GLSL = `
uniform highp sampler2D uField; uniform vec4 uFieldBounds; uniform vec2 uFieldDecode;   // range, 1 for an 8-bit field
float wordmarkDistance(vec2 p) {
  vec2 uv = (p - uFieldBounds.xy) / uFieldBounds.zw;
  // Outside the baked rectangle the field only knows it is far: never inside a letter.
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;
  // No mipmaps, so level 0 explicitly: this may run in branches where derivatives are undefined.
  float v = textureLod(uField, uv, 0.0).r;
  if (uFieldDecode.y < 0.5) return v;
  float x = 2.0 * v - 1.0; return sign(x) * x * x * uFieldDecode.x;
}
// A box filter one pixel wide across the edge: exact for straight edges, a hair soft at corners.
float wordmarkCoverage(float d, float w) { return clamp(0.5 - d / max(w, 1e-6), 0.0, 1.0); }
// The pixel's footprint in wordmark units, from the model position's screen derivatives.
float wordmarkFootprint(vec2 model) { vec2 x = dFdx(model), y = dFdy(model); return sqrt(0.5 * (dot(x, x) + dot(y, y))); }`

export class WordmarkField {
  /** Texels per wordmark unit of the current bake; 0 before the first. */
  density = 0
  /**
   * Milliseconds the last bake took, waited for to the end of the GPU work (one pixel read
   * back), shader compile included. For diagnostics (startup phases); it decides nothing.
   */
  lastBakeMs = 0

  bakes = 0
  private texture: WebGLTexture | null = null
  private segments: WebGLTexture | null = null
  private framebuffer: WebGLFramebuffer | null = null
  private program: WebGLProgram | null = null
  private readonly count: number
  /** Distances are stored as they are in a half-float target; otherwise scaled into a byte. */
  private readonly float: boolean
  private readonly maxSize: number
  private readonly locations: Record<string, WebGLUniformLocation | null> = {}

  constructor(private readonly gl: WebGL2RenderingContext, private readonly compile: (vertex: string, fragment: string) => WebGLProgram | null, private readonly unit: number) {
    const data = wordmarkSegments()
    this.count = data.length / 4
    // Half floats keep distances exactly; either extension makes R16F a render target.
    this.float = Boolean(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))
    this.maxSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096
    this.program = compile(BAKE_VERTEX, BAKE_FRAGMENT)
    if (!this.program) return
    for (const name of ['uSegments', 'uCount', 'uBounds', 'uSize', 'uEncode']) this.locations[name] = gl.getUniformLocation(this.program, name)
    gl.activeTexture(gl.TEXTURE0 + unit)
    this.segments = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.segments)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.count, 1, 0, gl.RGBA, gl.FLOAT, data)
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
    this.texture = gl.createTexture(); this.framebuffer = gl.createFramebuffer()
  }

  get ok(): boolean { return Boolean(this.program && this.texture) }
  /** Distances in a half-float target (exact), or in bytes on a square-root curve (see BYTE_RANGE). */
  get precise(): boolean { return this.float }
  /** How a texel turns back into a distance: the byte curve's range, and 1 for bytes. */
  get decode(): [number, number] { return this.float ? [1, 0] : [BYTE_RANGE, 1] }

  /**
   * Bakes the field if the mark is to be drawn at `pixelsPerUnit` screen pixels per wordmark
   * unit and the last bake is too coarse for that. Leaves the field bound on its unit, the
   * viewport changed, blending and the scissor test off, and `framebuffer` bound: the caller
   * restores its own state.
   * Returns true when it baked.
   */
  ensure(pixelsPerUnit: number, framebuffer: WebGLFramebuffer | null): boolean {
    const gl = this.gl
    if (!this.ok) return false
    const want = Math.min(MAX_DENSITY, Math.max(MIN_DENSITY, Math.ceil(pixelsPerUnit * OVERSAMPLE / 64) * 64))
    if (want <= this.density) return false
    const started = performance.now()
    const width = Math.min(this.maxSize, Math.ceil(FIELD_BOUNDS[2] * want)), height = Math.min(this.maxSize, Math.ceil(FIELD_BOUNDS[3] * want))
    gl.activeTexture(gl.TEXTURE0 + this.unit); gl.bindTexture(gl.TEXTURE_2D, this.texture)
    if (this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, width, height, 0, gl.RED, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0)
    // The segments on the same unit, sampled with texelFetch; the field is unbound while it is the target.
    gl.bindTexture(gl.TEXTURE_2D, this.segments)
    gl.viewport(0, 0, width, height)
    // The whole field, whatever the caller's last draw left on. WordmarkCrisp scissors to the
    // letters' box on screen; a rebake under that scissor (the box grew: a rotation, a resize,
    // the render scale recovering) baked nothing, and the zeroed field drew a pale box.
    gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true)
    gl.useProgram(this.program)
    const u = this.locations, [scale, bias] = this.decode
    gl.uniform1i(u.uSegments, this.unit); gl.uniform1i(u.uCount, this.count)
    gl.uniform4f(u.uBounds, FIELD_BOUNDS[0], FIELD_BOUNDS[1], FIELD_BOUNDS[2], FIELD_BOUNDS[3]); gl.uniform2f(u.uSize, width, height)
    gl.uniform2f(u.uEncode, scale, bias)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    // One pixel read back waits for the GPU, so the time is the real cost. Once per bake.
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    this.density = want; this.bakes++
    this.lastBakeMs = performance.now() - started
    // Measured for the diagnostics only: a slow bake is a one-off cost under the opening, never
    // a reason to draw something else.
    recordStartupPhase('lobby wordmark field bake', started, `${width}x${height} ${this.float ? 'half float' : '8-bit'}`)
    return true
  }

  /** Binds the field on its unit and sets FIELD_GLSL's uniforms on the program in use. */
  bind(locate: (name: string) => WebGLUniformLocation | null): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + this.unit); gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.uniform1i(locate('uField'), this.unit)
    gl.uniform4f(locate('uFieldBounds'), FIELD_BOUNDS[0], FIELD_BOUNDS[1], FIELD_BOUNDS[2], FIELD_BOUNDS[3])
    gl.uniform2f(locate('uFieldDecode'), ...this.decode)
  }

  dispose(): void {
    const gl = this.gl
    if (this.program) gl.deleteProgram(this.program)
    for (const texture of [this.texture, this.segments]) if (texture) gl.deleteTexture(texture)
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer)
    this.program = this.texture = this.segments = this.framebuffer = null
  }
}
