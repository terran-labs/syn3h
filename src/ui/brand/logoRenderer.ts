/**
 * The animated Syn3h logo, drawn with raw WebGL 2 into any context it is handed: its own
 * canvas (LogoMark) or someone else's, inside their frame (the lobby galaxy). Three draw
 * calls (four over space), no image textures, no depth buffer:
 *
 *   1. only with `space`: a quad of deep space with small seeded stars, for icons and cards;
 *   2. the plasma's body, a field: a band grown outward from the outline, brightest at the
 *      letters and falling smoothly away, with broad bands of brightness and reach flowing
 *      slowly round each letter by arc length. One continuous glow, never dots;
 *   3. over it, a few large, faint points on a lane just outside the letters, carried by
 *      one slow curl flow: gentle large-scale variation in the body. Every position is
 *      computed in the vertex shader, so the CPU does nothing per frame but set uniforms;
 *   4. the wordmark itself, flat: a face of one colour with a pale line inside its edge,
 *      one quad shaded from a signed distance field of the path (wordmarkField.ts), so
 *      its edges are antialiased at every size without multisampling.
 *
 * It fades in in two stages, both eased at both ends: first the dark silhouette with its edge
 * (`markFade`), then, after `glowGap`, the blue glow more slowly still (`glowFade`). Nothing
 * shows on the first frame. Whenever the caller's opacity has been zero and comes back, the
 * fade starts again, so a logo hidden and shown again arrives the same way each time.
 *
 * Layout: the caller gives a box in pixels. The wordmark covers that box exactly, as the
 * SVG wordmark (viewBox 962 by 226) covers its element, so the two can be laid over each
 * other and cross-faded. The plasma spills outside the box, so leave room around it: about
 * a third of the box height on every side (glowWidth, plus the particles).
 */
import { ASPECT, buildGlowBand, GLOW_FLOATS_PER_VERTEX, sampleOutline } from './wordmarkMesh'
import { FIELD_GLSL, WordmarkField } from './wordmarkField'

export type Rgb = [number, number, number]
export interface LogoLook {
  /** Any number. Changes where the particles are born and the stars of `space`. */
  seed: number
  /** The plasma's colour near the letters, display RGB 0 to 1. */
  glow: Rgb
  /** The colour the plasma turns as it reaches away. */
  glowEdge: Rgb
  /** How far the plasma's body reaches from the letters, in box heights. */
  glowWidth: number
  /** The wordmark's flat face colour. */
  face: Rgb
  /** Particles drawn. The buffer grows if more are asked for than were built. */
  particles: number
  /** Particle diameter in box heights (before each particle's own variation). */
  plasmaSize: number
  /** How fast the plasma flows; 1 is the designed pace. */
  flowSpeed: number
  /** How bright the plasma is: its body, and its particles before they share it out by count. */
  glowStrength: number
  /** Deep space and stars behind everything (true), or only the logo, over what is there. */
  space: boolean
  /** Overall opacity, for cross-fading with the SVG wordmark. Back from zero, the fade replays. */
  opacity: number
  /** Seconds the silhouette (the face and its edge line) takes to fade in. */
  markFade: number
  /** Seconds between the silhouette arriving and the glow starting to fade in. */
  glowGap: number
  /** Seconds the glow (the field and its particles) takes to fade in. */
  glowFade: number
  /**
   * Inert. The mark used to turn by itself; it is flat now. Kept because the lobby galaxy
   * (src/ui/galaxy/Galaxy.ts) still sets it.
   */
  sway: number
}
export const DEFAULT_LOGO_LOOK: LogoLook = {
  // Galaxy sunShafts: mix([1,.86,.66], WARM [1,.77,.5], .3).
  seed: 1, glow: [1, 0.833, 0.612], glowEdge: [1, 0.77, 0.5], glowWidth: 0.26, face: [0.008, 0.016, 0.039],
  particles: 160, plasmaSize: 0.3, flowSpeed: 1, glowStrength: 1, space: false, opacity: 1, markFade: 1.5, glowGap: 0, glowFade: 3, sway: 0,
}
/** A box in pixels, measured from the top left of the viewport. */
export interface PixelRect { x: number; y: number; width: number; height: number }
/** A GL viewport: pixels, from the bottom left of the drawing buffer. */
export interface GlViewport { x: number; y: number; width: number; height: number }

/** Seconds the whole fade in takes with the default look: silhouette, gap, then glow. */
export const INTRO_SECONDS = DEFAULT_LOGO_LOOK.markFade + DEFAULT_LOGO_LOOK.glowGap + DEFAULT_LOGO_LOOK.glowFade
/** Where skipIntro puts the start of the fade: long enough ago for any fade to have ended. */
const SKIPPED = -1e6
/** The particle count the glow strength is designed at; other counts share the same light. */
const DESIGN_PARTICLES = 160

const PROJECT = `
uniform vec3 uBox; uniform vec2 uTarget;
// Wordmark units (one unit is the box height, y up) to clip space.
vec4 project(vec2 p) {
  vec2 px = uBox.xy + vec2(p.x, -p.y) * uBox.z;
  return vec4(px.x / uTarget.x * 2.0 - 1.0, 1.0 - px.y / uTarget.y * 2.0, 0.0, 1.0);
}`

const SPACE_VERTEX = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`
const SPACE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uTarget; uniform vec2 uOrigin; uniform vec3 uBox; uniform float uTime; uniform float uSeed; uniform float uOpacity;
out vec4 color;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec2 px = vec2(gl_FragCoord.x - uOrigin.x, uTarget.y - (gl_FragCoord.y - uOrigin.y));
  // Deep space as on the icon: a blue haze around the mark, near black at the corners.
  float far = length((px - uBox.xy) / max(uTarget.x, uTarget.y));
  vec3 c = mix(vec3(0.075, 0.12, 0.22), vec3(0.012, 0.022, 0.045), smoothstep(0.0, 0.75, far));
  vec2 cell = floor(px / max(2.0, uBox.z * 0.012));
  float star = step(0.9965, hash(vec3(cell, uSeed)));
  float twinkle = 0.6 + 0.4 * sin(uTime * (0.7 + hash(vec3(cell, 3.0)) * 1.5) + hash(vec3(cell, 2.0)) * 40.0);
  c += vec3(0.7, 0.8, 1.0) * star * twinkle * (0.25 + 0.75 * hash(vec3(cell, 4.0)));
  // Dither keeps the dark gradient smooth.
  c += (hash(vec3(gl_FragCoord.xy, 7.0)) - 0.5) / 255.0;
  color = vec4(c, 1.0) * uOpacity;
}`

const FIELD_VERTEX = `#version 300 es
precision highp float;
in vec2 aPosition; in vec2 aOffset; in vec2 aAlong;
${PROJECT}
uniform float uWidth;
out float vReach; out float vAround; out float vLength; out vec2 vModel;
void main() {
  vec2 p = aPosition + aOffset * uWidth;
  gl_Position = project(p);
  vReach = length(aOffset); vAround = aAlong.x; vLength = aAlong.y; vModel = p;
}`
const FIELD_FRAGMENT = `#version 300 es
precision highp float;
in float vReach; in float vAround; in float vLength; in vec2 vModel;
uniform float uFlow; uniform float uStrength; uniform float uOpacity;
uniform vec3 uGlow; uniform vec3 uGlowEdge;
out vec4 color;
const float TAU = 6.2831853;
// A whole number of waves round each contour, so the bands meet themselves seamlessly.
float waves(float wavelength) { return TAU * vAround * max(1.0, floor(vLength / wavelength + 0.5)); }
void main() {
  // Broad bands of brightness flowing round each letter, two speeds and two lengths, and a
  // slow large swirl across the whole mark. Leaning with the distance out, they curl.
  float b = 0.5 + 0.3 * sin(waves(1.7) - uFlow * 0.35 + vReach * 2.0) + 0.2 * sin(waves(0.75) + uFlow * 0.23 - vReach * 1.5);
  b += 0.15 * sin(vModel.x * 2.3 + uFlow * 0.19) * sin(vModel.y * 4.1 - uFlow * 0.13);
  b = clamp(b, 0.0, 1.0);
  // Brightest at the letter, falling smoothly to nothing at the rim; the bands also carry
  // the glow further out where they are bright.
  float d = min(1.0, vReach / (0.35 + 0.65 * b));
  float falloff = exp(-1.8 * d) * (1.0 - d * d * (3.0 - 2.0 * d));
  float a = clamp(uStrength * falloff * mix(0.3, 1.0, b), 0.0, 1.0) * uOpacity;
  // Warm corona with blue highlights near the letters, warming toward the outer edge.
  vec3 c = mix(mix(uGlow, vec3(143.0, 227.0, 255.0) / 255.0, 0.25), uGlowEdge, smoothstep(0.0, 0.6, d));
  color = vec4(c * a, a);
}`

const PLASMA_VERTEX = `#version 300 es
precision highp float;
in vec4 aOutline; in vec4 aSeed;
${PROJECT}
uniform float uFlow; uniform float uMinPoint; uniform float uSize; uniform float uStrength;
uniform vec3 uGlow; uniform vec3 uGlowEdge;
out vec3 vColor; out float vAlpha;
void main() {
  vec2 base = aOutline.xy, n = aOutline.zw, tangent = vec2(-n.y, n.x);
  // No lives, no births: every particle shines steadily near its home on the outline, so
  // the stratified spacing along it keeps the glow even. A particle that came and went, or
  // strayed off the lane alone, would read as a dot.
  float phase = aSeed.y * 6.2831853;
  vec2 p = base + tangent * 0.03 * sin(uFlow * 0.21 + phase);
  // A narrow lane just outside the letters, breathing slowly in and out; the sprite's own
  // breadth makes the halo.
  float reach = 0.045 + 0.02 * aSeed.z + 0.012 * sin(uFlow * 0.33 + phase * 1.7);
  p += n * reach;
  // One slow, smooth flow for all of them, so neighbours move together: the curl of
  // psi = sin(ax + f) sin(by + g), which swirls without bunching up.
  vec2 q = p * vec2(1.3, 1.9) + vec2(uFlow * 0.09, -uFlow * 0.06);
  p += vec2(1.9 * sin(q.x) * cos(q.y), -1.3 * cos(q.x) * sin(q.y)) * 0.018;
  gl_Position = project(p);
  float pixels = uSize * mix(0.85, 1.15, aSeed.w) * uBox.z;
  // Broad bright bands drift slowly along the mark, so the light flows rather than sits.
  float wave = 0.5 + 0.5 * sin(base.x * 2.1 - uFlow * 0.3 + 1.4 * sin(base.y * 2.7 + uFlow * 0.17));
  float alpha = mix(0.35, 1.0, wave) * uStrength;
  // Below the minimum, keep the light and spread it: a 1 pixel point flickers.
  alpha *= min(1.0, pixels * pixels / (uMinPoint * uMinPoint));
  gl_PointSize = max(pixels, uMinPoint);
  vColor = mix(uGlow, uGlowEdge, aSeed.x * 0.6);
  vAlpha = alpha;
}`
const PLASMA_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vColor; in float vAlpha;
uniform float uOpacity;
out vec4 color;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 >= 1.0) discard;
  // A broad gaussian, windowed to reach zero at the rim: no bright core and no edge.
  // Broad enough that the sprite's whole square does work: neighbours blend into one glow.
  float a = vAlpha * exp(-1.5 * r2) * (1.0 - r2) * uOpacity;
  color = vec4(vColor * a, a);
}`

const MARK_VERTEX = `#version 300 es
precision highp float;
${PROJECT}
uniform vec2 uHalf;
out vec2 vModel;
void main() {
  // One quad over the box and a margin of a few pixels: two triangles from the vertex index.
  int k = gl_VertexID % 6; vec2 c = vec2(k == 1 || k == 2 || k == 4 ? 1.0 : -1.0, k == 2 || k == 4 || k == 5 ? 1.0 : -1.0);
  vModel = c * uHalf; gl_Position = project(vModel);
}`
const MARK_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vModel;
${FIELD_GLSL}
uniform vec3 uGlow; uniform vec3 uFace; uniform float uOpacity; uniform float uEdge;
out vec4 color;
void main() {
  float d = wordmarkDistance(vModel), w = wordmarkFootprint(vModel);
  float cover = wordmarkCoverage(d, w);
  if (cover <= 0.0) discard;
  // One flat colour for the face; the edge a pale line of the glow colour, uEdge wide just
  // inside the outline, its inner side antialiased the same way as the outline.
  float line = 1.0 - wordmarkCoverage(d + uEdge, w);
  vec3 c = mix(uFace, mix(uGlow, vec3(1.0), 0.6), line);
  color = vec4(c, 1.0) * cover * uOpacity;
}`
/** The texture unit the field is bound on: well clear of the lobby galaxy's own (0 to 2). */
export const FIELD_UNIT = 7

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram | null {
  const program = gl.createProgram()
  if (!program) return null
  const shaders: WebGLShader[] = []
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type); if (!shader) return null
    gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(program, shader); shaders.push(shader)
  }
  gl.linkProgram(program)
  for (const shader of shaders) gl.deleteShader(shader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Syn3h logo shader failed; the SVG wordmark stays.', gl.getProgramInfoLog(program))
    gl.deleteProgram(program); return null
  }
  return program
}

/**
 * The host's GL state that the logo changes, read once when the renderer is made and put
 * back after every draw. Reading it per draw is what must never happen: each getParameter
 * or isEnabled is a synchronous round trip that waits for the GPU process to drain all the
 * work queued before it, the host's whole frame included. Measured in the lobby, that was
 * 0.7 to 1.9 s main-thread stalls on the way down to a planet. The viewport is not cached:
 * draw puts back the whole drawing buffer, which tracks resizes.
 */
interface SavedState {
  program: WebGLProgram | null; vao: WebGLVertexArrayObject | null; arrayBuffer: WebGLBuffer | null
  framebuffer: WebGLFramebuffer | null; activeTexture: number
  colorMask: boolean[]
  enabled: [number, boolean][]
  blend: [number, number, number, number, number, number]
}

export interface DrawStats { drawCalls: number; particles: number; triangles: number; fieldDensity: number; fieldBakeMs: number }

/**
 * The logo's GL resources in one context. It never creates or loses a context: the owner
 * does that. `draw` puts back the state the host had when the renderer was made (see
 * SavedState) and a viewport over the whole drawing buffer, without querying anything. So a
 * host that changes its own resting program, vertex array, blend or enabled capabilities after
 * making the renderer must set it again after `draw`, or make a new renderer. After a lost
 * context, make a new renderer: that also reads the state afresh.
 */
export class LogoRenderer {
  look: LogoLook
  readonly triangles: number
  /** False if a shader failed to build; then `draw` does nothing and the SVG should stay. */
  readonly ok: boolean
  private space: WebGLProgram | null = null
  private field: WebGLProgram | null = null
  private plasma: WebGLProgram | null = null
  private mark: WebGLProgram | null = null
  private spaceVao: WebGLVertexArrayObject | null = null
  private fieldVao: WebGLVertexArrayObject | null = null
  private plasmaVao: WebGLVertexArrayObject | null = null
  private markVao: WebGLVertexArrayObject | null = null
  private plasmaBuffer: WebGLBuffer | null = null
  private fieldBuffer: WebGLBuffer | null = null
  private fieldVertices = 0
  private builtParticles = 0
  private builtSeed = Number.NaN
  /** The wordmark's distance field, baked on the first draw and again when drawn much larger. */
  distanceField: WordmarkField | null = null
  private readonly uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>()
  /** Read once, here, and never again: see SavedState. */
  private readonly host: SavedState
  /** Particle attribute locations, looked up once when the programs are built. */
  private particleAttributes: [number, number][] = []
  private introStart: number | null = null
  /** The caller's opacity was zero at the last draw: when it returns, the fade replays. */
  private hidden = false

  constructor(private readonly gl: WebGL2RenderingContext, look: Partial<LogoLook> = {}) {
    this.look = { ...DEFAULT_LOGO_LOOK, ...look }
    this.host = this.save()
    const band = buildGlowBand()
    this.triangles = 2 + band.triangles
    let ok = false
    try { ok = this.build(band.vertices) } catch (error) { console.warn('Syn3h logo could not start; the SVG wordmark stays.', error) }
    this.ok = ok
  }

  private build(band: Float32Array): boolean {
    const gl = this.gl
    try {
      this.space = compile(gl, SPACE_VERTEX, SPACE_FRAGMENT)
      this.field = compile(gl, FIELD_VERTEX, FIELD_FRAGMENT)
      this.plasma = compile(gl, PLASMA_VERTEX, PLASMA_FRAGMENT)
      this.mark = compile(gl, MARK_VERTEX, MARK_FRAGMENT)
      if (!this.space || !this.field || !this.plasma || !this.mark) return false
      this.distanceField = new WordmarkField(gl, (vertex, fragment) => compile(gl, vertex, fragment), FIELD_UNIT)
      if (!this.distanceField.ok) return false
      this.spaceVao = gl.createVertexArray(); this.markVao = gl.createVertexArray()
      const upload = (program: WebGLProgram, data: Float32Array, floats: number, layout: readonly (readonly [string, number, number])[]) => {
        const vao = gl.createVertexArray(), buffer = gl.createBuffer()
        gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
        for (const [name, size, offset] of layout) {
          const at = gl.getAttribLocation(program, name); if (at < 0) continue
          gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, size, gl.FLOAT, false, floats * 4, offset)
        }
        return [vao, buffer] as const
      }
      ;[this.fieldVao, this.fieldBuffer] = upload(this.field, band, GLOW_FLOATS_PER_VERTEX, [['aPosition', 2, 0], ['aOffset', 2, 8], ['aAlong', 2, 16]])
      this.fieldVertices = band.length / GLOW_FLOATS_PER_VERTEX
      this.particleAttributes = ([['aOutline', 0], ['aSeed', 16]] as const).map(([name, offset]): [number, number] => [gl.getAttribLocation(this.plasma!, name), offset]).filter(([at]) => at >= 0)
      this.plasmaVao = gl.createVertexArray(); this.plasmaBuffer = gl.createBuffer()
      this.fillParticles()
      return true
    } finally { this.restore() }
  }

  /** (Re)builds the particle buffer when the count grows past it or the seed changes. */
  private fillParticles(): void {
    const gl = this.gl, count = Math.max(1, Math.round(this.look.particles))
    if (count <= this.builtParticles && this.look.seed === this.builtSeed) return
    const built = Math.max(count, this.builtParticles), samples = sampleOutline(built, this.look.seed)
    const data = new Float32Array(built * 8)
    for (let i = 0; i < built; i++) { data.set(samples.points.subarray(i * 4, i * 4 + 4), i * 8); data.set(samples.seeds.subarray(i * 4, i * 4 + 4), i * 8 + 4) }
    gl.bindVertexArray(this.plasmaVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.plasmaBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    for (const [at, offset] of this.particleAttributes) { gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 4, gl.FLOAT, false, 32, offset) }
    this.builtParticles = built; this.builtSeed = this.look.seed
  }

  setLook(look: Partial<LogoLook>): void { this.look = { ...this.look, ...look } }
  /** Starts both stages of the fade in again at the next draw (or at `atSeconds` on the draw clock). */
  replayIntro(atSeconds?: number): void { this.introStart = atSeconds ?? null }
  /** Skips the fade in: the next draw shows the whole logo at once, with no fade at all. */
  skipIntro(): void { this.introStart = SKIPPED }
  /** Seconds into the fade in at the last draw; at least INTRO_SECONDS once it has finished. */
  introTime = 0

  get stats(): DrawStats {
    return { drawCalls: (this.look.space ? 1 : 0) + 3, particles: Math.min(this.look.particles, this.builtParticles), triangles: this.triangles, fieldDensity: this.distanceField?.density ?? 0, fieldBakeMs: this.distanceField?.lastBakeMs ?? 0 }
  }

  private location(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    let table = this.uniforms.get(program)
    if (!table) { table = new Map(); this.uniforms.set(program, table) }
    if (!table.has(name)) table.set(name, this.gl.getUniformLocation(program, name))
    return table.get(name) ?? null
  }

  private save(): SavedState {
    const gl = this.gl
    return {
      program: gl.getParameter(gl.CURRENT_PROGRAM), vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
      framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING), activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE),
      colorMask: gl.getParameter(gl.COLOR_WRITEMASK),
      enabled: [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST, gl.RASTERIZER_DISCARD, gl.SAMPLE_ALPHA_TO_COVERAGE].map(cap => [cap, gl.isEnabled(cap)] as [number, boolean]),
      blend: [gl.getParameter(gl.BLEND_SRC_RGB), gl.getParameter(gl.BLEND_DST_RGB), gl.getParameter(gl.BLEND_SRC_ALPHA), gl.getParameter(gl.BLEND_DST_ALPHA), gl.getParameter(gl.BLEND_EQUATION_RGB), gl.getParameter(gl.BLEND_EQUATION_ALPHA)],
    }
  }
  private restore(): void {
    const gl = this.gl, s = this.host
    gl.useProgram(s.program); gl.bindVertexArray(s.vao); gl.bindBuffer(gl.ARRAY_BUFFER, s.arrayBuffer)
    if (typeof s.activeTexture === 'number') gl.activeTexture(s.activeTexture)
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    if (s.colorMask) gl.colorMask(s.colorMask[0], s.colorMask[1], s.colorMask[2], s.colorMask[3])
    for (const [cap, on] of s.enabled) { if (on) gl.enable(cap); else gl.disable(cap) }
    gl.blendFuncSeparate(s.blend[0], s.blend[1], s.blend[2], s.blend[3]); gl.blendEquationSeparate(s.blend[4], s.blend[5])
  }

  /**
   * Draws one frame of the logo into whatever framebuffer is bound.
   *
   * @param seconds   the caller's clock; the animation and the fade in follow it.
   * @param box       where the wordmark goes, in pixels from the top left of `viewport`.
   * @param viewport  the GL viewport to draw in (bottom left origin); the whole drawing
   *                  buffer if left out.
   */
  draw(seconds: number, box: PixelRect, viewport?: GlViewport): void {
    const gl = this.gl
    if (!this.ok || gl.isContextLost()) return
    const view = viewport ?? { x: 0, y: 0, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight }
    if (view.width < 1 || view.height < 1 || box.height <= 0) return
    const look = this.look
    // Shown again after being hidden: the fade starts over, unless the caller has skipped it.
    if (look.opacity <= 0) this.hidden = true
    else if (this.hidden) { this.hidden = false; if (this.introStart !== SKIPPED) this.introStart = null }
    if (this.introStart === null) this.introStart = seconds
    const intro = this.introTime = Math.max(0, seconds - this.introStart)
    try {
      this.fillParticles()
      // The field, baked (once, or again when drawn much larger) before anything is drawn.
      // The bake binds its own target, then the framebuffer the host had when this renderer
      // was made: the lobby and LogoMark both draw to the screen.
      if (this.distanceField!.ensure(box.height, this.host.framebuffer)) gl.viewport(view.x, view.y, view.width, view.height)
      const centre: [number, number] = [box.x + box.width / 2, box.y + box.height / 2], height = box.height
      // The silhouette fades in first, then the glow, more slowly; each eased at both ends.
      const glowStart = look.markFade + look.glowGap
      const markOpacity = look.opacity * smooth(0, look.markFade, intro)
      const glowOpacity = look.opacity * smooth(glowStart, glowStart + look.glowFade, intro)
      // A slow breath in the plasma's brightness, the same for every particle.
      const breath = 0.92 + 0.08 * Math.sin(seconds * 0.5)

      gl.viewport(view.x, view.y, view.width, view.height)
      gl.colorMask(true, true, true, true)
      for (const cap of [gl.DEPTH_TEST, gl.CULL_FACE, gl.STENCIL_TEST, gl.RASTERIZER_DISCARD, gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SCISSOR_TEST]) gl.disable(cap)
      gl.blendEquation(gl.FUNC_ADD)

      const common = (program: WebGLProgram, opacity: number) => {
        gl.useProgram(program)
        gl.uniform2f(this.location(program, 'uTarget'), view.width, view.height)
        gl.uniform3f(this.location(program, 'uBox'), centre[0], centre[1], height)
        gl.uniform1f(this.location(program, 'uOpacity'), opacity)
        gl.uniform3f(this.location(program, 'uGlow'), ...look.glow)
      }

      // 1. Space, opaque, over the whole viewport: only for icons and cards.
      if (look.space) {
        common(this.space!, markOpacity)
        const u = (name: string) => this.location(this.space!, name)
        gl.uniform2f(u('uOrigin'), view.x, view.y); gl.uniform1f(u('uTime'), seconds); gl.uniform1f(u('uSeed'), look.seed % 1000)
        gl.disable(gl.BLEND)
        gl.bindVertexArray(this.spaceVao); gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      gl.enable(gl.BLEND)

      // 2. The plasma's body. Where its band overlaps itself the brighter wins (MAX), so
      // corners and close letters glow no harder than anywhere else.
      common(this.field!, glowOpacity)
      gl.uniform1f(this.location(this.field!, 'uWidth'), look.glowWidth)
      gl.uniform1f(this.location(this.field!, 'uFlow'), seconds * look.flowSpeed)
      gl.uniform1f(this.location(this.field!, 'uStrength'), 0.9 * look.glowStrength * breath)
      gl.uniform3f(this.location(this.field!, 'uGlowEdge'), ...look.glowEdge)
      gl.blendEquation(gl.MAX)
      gl.bindVertexArray(this.fieldVao); gl.drawArrays(gl.TRIANGLES, 0, this.fieldVertices)
      gl.blendEquation(gl.FUNC_ADD)

      // 3. The particles, screened on: it brightens what is there but never past white, so where
      // many overlap it saturates gently instead of blowing out.
      const count = Math.min(Math.round(look.particles), this.builtParticles)
      common(this.plasma!, glowOpacity)
      const u = (name: string) => this.location(this.plasma!, name)
      gl.uniform1f(u('uFlow'), seconds * look.flowSpeed)
      gl.uniform1f(u('uMinPoint'), 1.6)
      // Smaller budgets draw each particle a little larger, so they still overlap into one
      // glow instead of showing their spacing; the fill still falls, as the square root of
      // the count. Each also shines brighter, so every budget gives about the same light.
      const share = DESIGN_PARTICLES / Math.max(1, count), grow = Math.min(1.5, Math.max(0.8, Math.sqrt(Math.sqrt(share))))
      gl.uniform1f(u('uSize'), look.plasmaSize * grow)
      gl.uniform3f(u('uGlowEdge'), ...look.glowEdge)
      gl.uniform1f(u('uStrength'), 0.14 * look.glowStrength * breath * Math.min(3, Math.max(0.5, share / (grow * grow))))
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.bindVertexArray(this.plasmaVao); gl.drawArrays(gl.POINTS, 0, count)

      // 4. The wordmark: face and edge line in one quad, from the distance field.
      common(this.mark!, markOpacity)
      const mark = (name: string) => this.location(this.mark!, name)
      gl.uniform3f(mark('uFace'), ...look.face)
      // About 2.7 path units wide, but never thinner than one and a half pixels.
      gl.uniform1f(mark('uEdge'), Math.max(0.012, 1.5 / height))
      // The box, and three pixels round it for the antialiased edge.
      const margin = 3 / height
      gl.uniform2f(mark('uHalf'), ASPECT / 2 + margin, 0.5 + margin)
      this.distanceField!.bind(mark)
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.bindVertexArray(this.markVao); gl.drawArrays(gl.TRIANGLES, 0, 6)
    } finally { this.restore() }
  }

  /** Deletes the logo's GL objects. The context itself belongs to the caller. */
  dispose(): void {
    const gl = this.gl
    for (const program of [this.space, this.field, this.plasma, this.mark]) if (program) gl.deleteProgram(program)
    for (const vao of [this.spaceVao, this.fieldVao, this.plasmaVao, this.markVao]) if (vao) gl.deleteVertexArray(vao)
    for (const buffer of [this.fieldBuffer, this.plasmaBuffer]) if (buffer) gl.deleteBuffer(buffer)
    this.distanceField?.dispose(); this.distanceField = null
    this.space = this.field = this.plasma = this.mark = null; this.spaceVao = this.fieldVao = this.plasmaVao = this.markVao = null; this.fieldBuffer = this.plasmaBuffer = null
    this.uniforms.clear()
  }
}

/** 0 before `from`, 1 after `to`, eased at both ends between; a zero-length span is a step. */
function smooth(from: number, to: number, x: number): number {
  if (to <= from) return x >= to ? 1 : 0
  const t = Math.min(1, Math.max(0, (x - from) / (to - from))); return t * t * (3 - 2 * t)
}
