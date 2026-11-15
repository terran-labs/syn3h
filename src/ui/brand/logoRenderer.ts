/**
 * The animated Syn3h logo, drawn with raw WebGL 2 into any context it is handed: its own
 * canvas (LogoMark) or someone else's, inside their frame (the lobby galaxy). Three draw
 * calls, no textures, no depth buffer:
 *
 *   1. a quad of sky: the red sun with granulation and a moving corona, and, if asked, deep
 *      space with stars behind it;
 *   2. the glow: thousands of additive points born on the outline of the letters, drifting
 *      out and up through a curl field and fading. Every position is computed in the vertex
 *      shader from the particle's outline point, its seed and the time, so the CPU does
 *      nothing per frame but set a dozen uniforms;
 *   3. the wordmark itself, an extruded mesh with a chamfer, near-black and glossy, with the
 *      sheen of the original across the top of the letters.
 *
 * Layout: the caller gives a box in pixels. At zero tilt the front face of the wordmark
 * covers that box exactly, as the SVG wordmark (viewBox 962 by 226) covers its element, so
 * the two can be laid over each other and cross-faded. The glow and the sun spill outside
 * the box, so leave room around it: about a third of the box height left and right and
 * three quarters above and below.
 */
import { ASPECT, buildWordmarkMesh, FLOATS_PER_VERTEX, sampleOutline } from './wordmarkMesh'

export type Rgb = [number, number, number]
export interface LogoLook {
  /** Any number. Changes the particles' births and the sun's surface. */
  seed: number
  /** The glow's main colour near the letters, display RGB 0 to 1. */
  glow: Rgb
  /** The colour the glow turns as it drifts away. */
  glowEdge: Rgb
  /** The sun's corona colour. */
  sun: Rgb
  /** Sun radius in box heights; 0 hides the sun. */
  sunSize: number
  /** Particles drawn. The buffer grows if more are asked for than were built. */
  particles: number
  /** Deep space and stars behind everything (true), or only the logo, over what is there. */
  space: boolean
  /** Overall opacity, for cross-fading with the SVG wordmark. */
  opacity: number
  /** How far the mark turns by itself, in radians. 0 holds it flat (and aligned with the SVG). */
  sway: number
}
export const DEFAULT_LOGO_LOOK: LogoLook = {
  seed: 1, glow: [0.34, 0.42, 1.0], glowEdge: [0.52, 0.28, 0.98], sun: [1.0, 0.25, 0.02], sunSize: 0.68,
  particles: 12000, space: false, opacity: 1, sway: 0.07,
}
/** A box in pixels, measured from the top left of the viewport. */
export interface PixelRect { x: number; y: number; width: number; height: number }
/** A GL viewport: pixels, from the bottom left of the drawing buffer. */
export interface GlViewport { x: number; y: number; width: number; height: number }

/** Seconds the intro takes: particles fly in and draw the letters, the sun comes up. */
export const INTRO_SECONDS = 3.6
/** Model units: the wordmark is one unit tall, so the camera distance sets the perspective. */
const CAMERA = 6
/** Where the sun sits, behind the middle of the mark. */
const SUN_AT: [number, number, number] = [0.02, -0.04, -0.6]

const PROJECT = `
uniform mat3 uRot; uniform vec3 uBox; uniform vec2 uTarget;
const float CAMERA = ${CAMERA.toFixed(1)};
// Model units to clip space: the box centre and height in pixels place the plane z = 0.
vec4 project(vec3 p, out float scale) {
  vec3 r = uRot * p;
  scale = CAMERA / max(CAMERA - r.z, 0.05);
  vec2 px = uBox.xy + vec2(r.x, -r.y) * scale * uBox.z;
  return vec4(px.x / uTarget.x * 2.0 - 1.0, 1.0 - px.y / uTarget.y * 2.0, 0.0, 1.0);
}`

const SKY_VERTEX = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`
const SKY_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uTarget; uniform vec2 uOrigin; uniform vec3 uSun; uniform vec3 uBox; uniform float uTime; uniform float uSunAmount;
uniform float uSpace; uniform float uSeed; uniform vec3 uSunColor; uniform float uOpacity;
out vec4 color;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float t = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { t += a * noise(p); p = p * 2.07 + 7.3; a *= 0.5; } return t; }
void main() {
  vec2 px = vec2(gl_FragCoord.x - uOrigin.x, uTarget.y - (gl_FragCoord.y - uOrigin.y));
  vec3 c = vec3(0.0);
  if (uSpace > 0.5) {
    // Deep space as on the icon: a blue haze around the mark, near black at the corners.
    float far = length((px - uBox.xy) / max(uTarget.x, uTarget.y));
    c = mix(vec3(0.075, 0.12, 0.22), vec3(0.012, 0.022, 0.045), smoothstep(0.0, 0.75, far));
    vec2 cell = floor(px / max(2.0, uBox.z * 0.012));
    float star = step(0.9965, hash(vec3(cell, uSeed)));
    float twinkle = 0.6 + 0.4 * sin(uTime * (0.7 + hash(vec3(cell, 3.0)) * 1.5) + hash(vec3(cell, 2.0)) * 40.0);
    c += vec3(0.7, 0.8, 1.0) * star * twinkle * (0.25 + 0.75 * hash(vec3(cell, 4.0)));
  }
  // The sun, in sun radii.
  vec2 d = (px - uSun.xy) / max(uSun.z, 1.0);
  float r = length(d);
  vec3 sun = vec3(0.0);
  if (uSun.z > 0.5 && r < 2.8) {
    float disc = 1.0 - smoothstep(0.97, 1.0, r);
    if (disc > 0.0) {
      // Granulation on a slowly turning sphere: bright cells, dark lanes, darker at the limb.
      vec3 s = vec3(d, sqrt(max(0.0, 1.0 - r * r)));
      float turn = uTime * 0.025, ct = cos(turn), st = sin(turn);
      s.xz = vec2(s.x * ct - s.z * st, s.x * st + s.z * ct);
      float g = fbm(s * 8.0 + uSeed * 1.3 + vec3(0.0, 0.0, uTime * 0.03));
      float cells = 1.0 - abs(noise(s * 30.0 + vec3(uTime * 0.06, uSeed, 0.0)) * 2.0 - 1.0);
      vec3 surface = mix(vec3(0.62, 0.13, 0.03), vec3(1.0, 0.50, 0.16), smoothstep(0.30, 0.70, g));
      surface *= 0.75 + 0.35 * cells * cells;
      float limb = pow(max(s.z, 0.0), 0.45);
      sun = surface * mix(0.45, 1.0, limb) + uSunColor * pow(r, 8.0) * 0.6;
    }
    // Corona: an uneven, slowly boiling red blob that fades well clear of the disc.
    float angle = atan(d.y, d.x);
    vec3 around = vec3(cos(angle) * 1.6, sin(angle) * 1.6, uTime * 0.11 + uSeed);
    float boil = fbm(around + vec3(r * 0.9 - uTime * 0.05));
    float edge = 1.0 + 0.7 * boil;
    float corona = exp(-max(r - 1.0, 0.0) * 2.8 / edge) * 1.0 + exp(-r * 0.9) * 0.3;
    corona *= smoothstep(2.8, 1.5, r);
    sun = mix(uSunColor * corona, sun, disc);
  }
  c += sun * uSunAmount;
  // Dither keeps the dark gradients smooth.
  c += (hash(vec3(gl_FragCoord.xy, 7.0)) - 0.5) / 255.0;
  // Premultiplied: opaque over space, otherwise only as opaque as it is bright.
  float a = uSpace > 0.5 ? 1.0 : clamp(max(max(c.r, c.g), c.b), 0.0, 1.0);
  color = vec4(c, a) * uOpacity;
}`

const GLOW_VERTEX = `#version 300 es
precision highp float;
in vec4 aOutline; in vec4 aSeed;
${PROJECT}
uniform float uTime; uniform float uIntro; uniform float uBreath; uniform float uMinPoint; uniform float uDensity;
uniform vec3 uGlow; uniform vec3 uGlowEdge;
out vec3 vColor; out float vAlpha;
float h1(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec2 base = aOutline.xy, n = aOutline.zw;
  // A third of the particles cling to the edge, large and faint: they make the steady halo.
  // The rest stream away from the letters.
  float cling = step(aSeed.z, 0.45);
  float life = mix(2.2, 4.6, aSeed.x) * mix(1.0, 1.7, cling);
  float t = uTime / life + aSeed.y;
  float age = fract(t);
  float r = h1(floor(t) * 12.9898 + aSeed.w * 78.233);      // a fresh number each life
  vec2 tangent = vec2(-n.y, n.x);
  vec2 p = base + tangent * (r - 0.5) * 0.025;
  float reach = mix(pow(age, 1.35) * mix(0.07, 0.30, r * r), 0.004 + 0.07 * aSeed.w * aSeed.w, cling);
  p += n * reach;
  float stream = 1.0 - cling;
  p.y += stream * age * age * mix(0.03, 0.15, r);           // heat rises
  // Curl of psi = sin(ax + f) sin(by + g): a swirling, divergence-free drift.
  vec2 q = p * vec2(2.3, 3.1) + vec2(uTime * 0.21, -uTime * 0.17);
  vec2 curl = vec2(3.1 * sin(q.x) * cos(q.y), -2.3 * cos(q.x) * sin(q.y));
  vec2 q2 = p * vec2(5.7, 4.9) + vec2(-uTime * 0.31, uTime * 0.27);
  curl += 0.5 * vec2(4.9 * sin(q2.x) * cos(q2.y), -5.7 * cos(q2.x) * sin(q2.y));
  p += curl * age * stream * 0.012;
  vec3 pos = vec3(p, -0.02 - 0.09 * aSeed.w);
  // Intro: every particle flies in from a wide ring, spiralling, in a sweep left to right.
  float sweep = base.x / ${ASPECT.toFixed(4)} + 0.5;
  float delay = 0.05 + sweep * 1.4 + aSeed.x * 0.45;
  float k = clamp((uIntro - delay) / 1.15, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - k, 3.0);
  float angle = aSeed.y * 6.2831853, radius = mix(1.4, 3.6, aSeed.z);
  vec3 start = vec3(base * 0.3 + vec2(cos(angle), sin(angle)) * radius, mix(-1.2, 1.4, aSeed.w));
  vec3 rel = start - pos;
  float swirl = (1.0 - e) * 2.4, cs = cos(swirl), sn = sin(swirl);
  rel.xy = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs);
  pos += rel * (1.0 - e);
  float scale;
  gl_Position = project(pos, scale);
  float size = mix(mix(0.010, 0.024, aSeed.x) * (1.0 - 0.45 * age), mix(0.05, 0.12, aSeed.x), cling);
  float fade = mix(smoothstep(0.0, 0.1, age) * pow(1.0 - age, 1.3) * 0.9, sin(3.14159 * age) * 0.22, cling);
  vec3 near = mix(uGlow, vec3(1.0), 0.3);
  vec3 col = mix(near, uGlow, smoothstep(0.0, 0.06, reach));
  col = mix(col, uGlowEdge, smoothstep(0.06, 0.26, reach));
  // In flight: small, hot and blue white; a flash as it lands.
  float flying = 1.0 - smoothstep(0.85, 1.0, k);
  col = mix(col, vec3(0.75, 0.88, 1.0), flying);
  float alpha = mix(fade * uBreath * uDensity, 0.85, flying) * smoothstep(0.0, 0.08, k);
  alpha += exp(-pow((k - 0.97) * 14.0, 2.0)) * 0.6 * (1.0 - step(1.0, k));   // only while landing
  size = mix(size, 0.016, flying);
  float pixels = size * scale * uBox.z;
  // Below the minimum, keep the light and spread it: a 1 pixel point flickers.
  alpha *= min(1.0, pixels * pixels / (uMinPoint * uMinPoint));
  gl_PointSize = max(pixels, uMinPoint);
  vColor = col; vAlpha = alpha;
}`
const GLOW_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vColor; in float vAlpha;
uniform float uOpacity;
out vec4 color;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  // A soft round dot: a gaussian core that reaches zero at the rim.
  float f = (1.0 - r2) * (1.0 - r2) * exp(-r2 * 2.5);
  float a = vAlpha * f * uOpacity;
  color = vec4(vColor * a, a * 0.6);
}`

const MARK_VERTEX = `#version 300 es
precision highp float;
in vec3 aPosition; in vec3 aNormal; in float aPart;
${PROJECT}
out vec3 vNormal; out vec3 vModel; out float vPart;
void main() { float scale; gl_Position = project(aPosition, scale); vNormal = uRot * aNormal; vModel = aPosition; vPart = aPart; }`
const MARK_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal; in vec3 vModel; in float vPart;
uniform float uTime; uniform float uIntro; uniform float uBreath; uniform vec2 uTilt; uniform float uOpacity;
uniform vec3 uGlow; uniform vec3 uGlowEdge;
out vec4 color;
void main() {
  // Intro: the letters appear behind a hot front that follows the particles across.
  float front = mix(-2.6, 2.6, clamp((uIntro - 0.8) / 2.0, 0.0, 1.0));
  if (vModel.x > front) discard;
  float hot = (1.0 - smoothstep(0.0, 0.45, front - vModel.x)) * (1.0 - smoothstep(2.0, 2.6, front));
  vec3 N = normalize(vNormal);
  vec3 base = vec3(0.008, 0.009, 0.014);
  vec3 L = normalize(vec3(-0.3, 0.8, 0.5)), H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(N, H), 0.0), 30.0);
  vec3 rim = mix(uGlow, uGlowEdge, 0.5 + 0.5 * N.x) * uBreath;
  vec3 c;
  if (vPart < 0.5) {
    // The original's gloss: a bright band over the top of the letters with a sharp lower
    // edge, as if a horizon were reflected in them. It slides as the mark turns.
    float y = vModel.y;
    float cut = 0.13 + uTilt.x * 0.9 + 0.025 * sin(uTime * 0.23) + 0.04 * sin(vModel.x * 0.9 + uTilt.y * 3.0);
    float sheen = smoothstep(cut - 0.006, cut + 0.006, y) * mix(0.07, 0.30, smoothstep(cut, 0.5, y));
    // The bar has its own, thinner gloss.
    float barCut = -0.405 + uTilt.x * 0.3;
    sheen += step(y, -0.31) * smoothstep(barCut - 0.004, barCut + 0.004, y) * mix(0.05, 0.18, smoothstep(barCut, -0.31, y));
    // Now and then a glint crosses the face on a diagonal.
    float glint = mod(uTime * 0.9, 15.0) - 4.0;
    sheen += exp(-pow((vModel.x + vModel.y * 0.7 - glint) * 7.0, 2.0)) * 0.12;
    c = base + vec3(0.60, 0.65, 0.76) * sheen;
  } else if (vPart < 1.5) {
    // The chamfer: a thin bright rim, white where it faces the light, glow coloured below.
    float up = clamp(N.y * 1.3, 0.0, 1.0);
    c = mix(rim * 0.9, vec3(0.80, 0.84, 0.95), up * 0.75) + spec * 0.5;
  } else {
    c = base + rim * 0.2 * (1.0 - abs(N.z)) + spec * 0.15;
  }
  c += mix(uGlow, vec3(1.0), 0.35) * hot * hot * 0.7;
  color = vec4(c * uOpacity, uOpacity);
}`

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

/** Rotation by pitch (about x) then yaw (about y), column major for uniformMatrix3fv. */
function rotation(pitch: number, yaw: number): Float32Array {
  const cx = Math.cos(pitch), sx = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw)
  // R = Ry * Rx
  return new Float32Array([cy, 0, -sy, sy * sx, cx, cy * sx, sy * cx, -sx, cy * cx])
}

/** The GL state the logo changes, read before and put back after each draw. */
interface SavedState {
  program: WebGLProgram | null; vao: WebGLVertexArrayObject | null; arrayBuffer: WebGLBuffer | null
  viewport: Int32Array; scissor: Int32Array; colorMask: boolean[]
  enabled: [number, boolean][]
  blend: [number, number, number, number, number, number]
}

export interface DrawStats { drawCalls: number; particles: number; triangles: number }

/**
 * The logo's GL resources in one context. It never creates or loses a context: the owner
 * does that. `draw` leaves the GL state as it found it.
 */
export class LogoRenderer {
  look: LogoLook
  readonly triangles: number
  /** False if a shader failed to build; then `draw` does nothing and the SVG should stay. */
  readonly ok: boolean
  private sky: WebGLProgram | null = null
  private glow: WebGLProgram | null = null
  private mark: WebGLProgram | null = null
  private skyVao: WebGLVertexArrayObject | null = null
  private glowVao: WebGLVertexArrayObject | null = null
  private markVao: WebGLVertexArrayObject | null = null
  private glowBuffer: WebGLBuffer | null = null
  private markBuffer: WebGLBuffer | null = null
  private builtParticles = 0
  private builtSeed = Number.NaN
  private markVertices = 0
  private readonly uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>()
  private introStart: number | null = null
  private tilt: [number, number] = [0, 0]
  /** Pointer or device tilt, -1 to 1 on each axis; added to the mark's own sway. */
  lean: [number, number] = [0, 0]

  constructor(private readonly gl: WebGL2RenderingContext, look: Partial<LogoLook> = {}) {
    this.look = { ...DEFAULT_LOGO_LOOK, ...look }
    const mesh = buildWordmarkMesh()
    this.triangles = mesh.triangles
    let ok = false
    try { ok = this.build(mesh.vertices) } catch (error) { console.warn('Syn3h logo could not start; the SVG wordmark stays.', error) }
    this.ok = ok
  }

  private build(vertices: Float32Array): boolean {
    const gl = this.gl
    const saved = this.save()
    try {
      this.sky = compile(gl, SKY_VERTEX, SKY_FRAGMENT)
      this.glow = compile(gl, GLOW_VERTEX, GLOW_FRAGMENT)
      this.mark = compile(gl, MARK_VERTEX, MARK_FRAGMENT)
      if (!this.sky || !this.glow || !this.mark) return false
      this.skyVao = gl.createVertexArray()
      this.markVao = gl.createVertexArray(); this.markBuffer = gl.createBuffer()
      gl.bindVertexArray(this.markVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.markBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
      const stride = FLOATS_PER_VERTEX * 4
      for (const [name, size, offset] of [['aPosition', 3, 0], ['aNormal', 3, 12], ['aPart', 1, 24]] as const) {
        const at = gl.getAttribLocation(this.mark, name); if (at < 0) continue
        gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, size, gl.FLOAT, false, stride, offset)
      }
      this.markVertices = vertices.length / FLOATS_PER_VERTEX
      this.glowVao = gl.createVertexArray(); this.glowBuffer = gl.createBuffer()
      this.fillParticles()
      return true
    } finally { this.restore(saved) }
  }

  /** (Re)builds the particle buffer when the count grows past it or the seed changes. */
  private fillParticles(): void {
    const gl = this.gl, count = Math.max(1, Math.round(this.look.particles))
    if (count <= this.builtParticles && this.look.seed === this.builtSeed) return
    const built = Math.max(count, this.builtParticles), samples = sampleOutline(built, this.look.seed)
    const data = new Float32Array(built * 8)
    for (let i = 0; i < built; i++) { data.set(samples.points.subarray(i * 4, i * 4 + 4), i * 8); data.set(samples.seeds.subarray(i * 4, i * 4 + 4), i * 8 + 4) }
    gl.bindVertexArray(this.glowVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.glowBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    for (const [name, offset] of [['aOutline', 0], ['aSeed', 16]] as const) {
      const at = gl.getAttribLocation(this.glow!, name); if (at < 0) continue
      gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 4, gl.FLOAT, false, 32, offset)
    }
    this.builtParticles = built; this.builtSeed = this.look.seed
  }

  setLook(look: Partial<LogoLook>): void { this.look = { ...this.look, ...look } }
  /** Starts the intro again at the next draw (or at `atSeconds` on the draw clock). */
  replayIntro(atSeconds?: number): void { this.introStart = atSeconds ?? null }
  /** Skips the intro: the next draw shows the settled logo. */
  skipIntro(): void { this.introStart = -1e6 }
  /** Seconds into the intro at the last draw; at least INTRO_SECONDS once it has finished. */
  introTime = 0

  get stats(): DrawStats {
    const sky = this.look.sunSize > 0 || this.look.space
    return { drawCalls: (sky ? 1 : 0) + 2, particles: Math.min(this.look.particles, this.builtParticles), triangles: this.triangles }
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
      viewport: gl.getParameter(gl.VIEWPORT), scissor: gl.getParameter(gl.SCISSOR_BOX), colorMask: gl.getParameter(gl.COLOR_WRITEMASK),
      enabled: [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST, gl.RASTERIZER_DISCARD, gl.SAMPLE_ALPHA_TO_COVERAGE].map(cap => [cap, gl.isEnabled(cap)] as [number, boolean]),
      blend: [gl.getParameter(gl.BLEND_SRC_RGB), gl.getParameter(gl.BLEND_DST_RGB), gl.getParameter(gl.BLEND_SRC_ALPHA), gl.getParameter(gl.BLEND_DST_ALPHA), gl.getParameter(gl.BLEND_EQUATION_RGB), gl.getParameter(gl.BLEND_EQUATION_ALPHA)],
    }
  }
  private restore(s: SavedState): void {
    const gl = this.gl
    gl.useProgram(s.program); gl.bindVertexArray(s.vao); gl.bindBuffer(gl.ARRAY_BUFFER, s.arrayBuffer)
    if (s.viewport) gl.viewport(s.viewport[0], s.viewport[1], s.viewport[2], s.viewport[3])
    if (s.scissor) gl.scissor(s.scissor[0], s.scissor[1], s.scissor[2], s.scissor[3])
    if (s.colorMask) gl.colorMask(s.colorMask[0], s.colorMask[1], s.colorMask[2], s.colorMask[3])
    for (const [cap, on] of s.enabled) { if (on) gl.enable(cap); else gl.disable(cap) }
    gl.blendFuncSeparate(s.blend[0], s.blend[1], s.blend[2], s.blend[3]); gl.blendEquationSeparate(s.blend[4], s.blend[5])
  }

  /**
   * Draws one frame of the logo into whatever framebuffer is bound.
   *
   * @param seconds   the caller's clock; the animation and intro follow it.
   * @param box       where the flat wordmark goes, in pixels from the top left of `viewport`.
   * @param viewport  the GL viewport to draw in (bottom left origin); the whole drawing
   *                  buffer if left out.
   */
  draw(seconds: number, box: PixelRect, viewport?: GlViewport): void {
    const gl = this.gl
    if (!this.ok || gl.isContextLost()) return
    const view = viewport ?? { x: 0, y: 0, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight }
    if (view.width < 1 || view.height < 1 || box.height <= 0) return
    if (this.introStart === null) this.introStart = seconds
    const intro = this.introTime = Math.max(0, seconds - this.introStart)
    const look = this.look
    const saved = this.save()
    try {
      this.fillParticles()
      // The mark's own slow sway, plus any lean the caller feeds in, eased.
      const target: [number, number] = [
        look.sway * (0.45 * Math.sin(seconds * 0.17) + 0.25 * Math.sin(seconds * 0.071 + 1.3)) + this.lean[1] * 0.12,
        look.sway * (Math.sin(seconds * 0.11) + 0.4 * Math.sin(seconds * 0.043 + 2.1)) + this.lean[0] * 0.22,
      ]
      this.tilt = [this.tilt[0] + (target[0] - this.tilt[0]) * 0.08, this.tilt[1] + (target[1] - this.tilt[1]) * 0.08]
      const [pitch, yaw] = this.tilt
      const rot = rotation(pitch, yaw)
      const centre: [number, number] = [box.x + box.width / 2, box.y + box.height / 2], height = box.height
      const breath = 0.86 + 0.1 * Math.sin(seconds * 0.7) + 0.04 * Math.sin(seconds * 0.23 + 1)
      // The sun's place and size on screen, by the same projection as the shaders.
      const sx = SUN_AT[0], sy = SUN_AT[1], sz = SUN_AT[2]
      const rx = rot[0] * sx + rot[3] * sy + rot[6] * sz, ry = rot[1] * sx + rot[4] * sy + rot[7] * sz, rz = rot[2] * sx + rot[5] * sy + rot[8] * sz
      const scale = CAMERA / (CAMERA - rz)
      const sun: [number, number, number] = [centre[0] + rx * scale * height, centre[1] - ry * scale * height, look.sunSize * scale * height]
      const sunAmount = smooth(0.3, 2.9, intro)

      gl.viewport(view.x, view.y, view.width, view.height)
      gl.colorMask(true, true, true, true)
      for (const cap of [gl.DEPTH_TEST, gl.CULL_FACE, gl.STENCIL_TEST, gl.RASTERIZER_DISCARD, gl.SAMPLE_ALPHA_TO_COVERAGE]) gl.disable(cap)
      gl.blendEquation(gl.FUNC_ADD)

      const common = (program: WebGLProgram) => {
        gl.useProgram(program)
        gl.uniform2f(this.location(program, 'uTarget'), view.width, view.height)
        gl.uniform3f(this.location(program, 'uBox'), centre[0], centre[1], height)
        gl.uniformMatrix3fv(this.location(program, 'uRot'), false, rot)
        gl.uniform1f(this.location(program, 'uTime'), seconds)
        gl.uniform1f(this.location(program, 'uIntro'), intro)
        gl.uniform1f(this.location(program, 'uBreath'), breath)
        gl.uniform1f(this.location(program, 'uOpacity'), look.opacity)
        gl.uniform3f(this.location(program, 'uGlow'), ...look.glow)
        gl.uniform3f(this.location(program, 'uGlowEdge'), ...look.glowEdge)
      }

      // 1. Sky. Over space it is opaque and fills the viewport; otherwise it blends over the
      // host's picture, and only the sun's square is shaded.
      if (look.space || look.sunSize > 0) {
        common(this.sky!)
        const u = (name: string) => this.location(this.sky!, name)
        gl.uniform2f(u('uOrigin'), view.x, view.y)
        gl.uniform3f(u('uSun'), sun[0], sun[1], sun[2])
        gl.uniform1f(u('uSunAmount'), sunAmount); gl.uniform1f(u('uSpace'), look.space ? 1 : 0)
        gl.uniform1f(u('uSeed'), look.seed % 1000); gl.uniform3f(u('uSunColor'), ...look.sun)
        if (look.space) { gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST) }
        else {
          gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
          const reach = sun[2] * 2.8, x0 = Math.max(0, Math.floor(sun[0] - reach)), x1 = Math.min(view.width, Math.ceil(sun[0] + reach))
          const y0 = Math.max(0, Math.floor(view.height - sun[1] - reach)), y1 = Math.min(view.height, Math.ceil(view.height - sun[1] + reach))
          gl.enable(gl.SCISSOR_TEST); gl.scissor(view.x + x0, view.y + y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0))
        }
        gl.bindVertexArray(this.skyVao); gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      gl.disable(gl.SCISSOR_TEST); gl.enable(gl.BLEND)

      // 2. Glow, added on.
      common(this.glow!)
      gl.uniform1f(this.location(this.glow!, 'uMinPoint'), 1.6)
      // Fewer particles each shine brighter, so every budget gives about the same glow.
      gl.uniform1f(this.location(this.glow!, 'uDensity'), Math.min(2.5, Math.max(0.5, 12000 / Math.max(1, look.particles))))
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE)
      gl.bindVertexArray(this.glowVao); gl.drawArrays(gl.POINTS, 0, Math.min(Math.round(look.particles), this.builtParticles))

      // 3. The wordmark: walls, face, then chamfer (see buildWordmarkMesh).
      common(this.mark!)
      gl.uniform2f(this.location(this.mark!, 'uTilt'), pitch, yaw)
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.bindVertexArray(this.markVao); gl.drawArrays(gl.TRIANGLES, 0, this.markVertices)
    } finally { this.restore(saved) }
  }

  /** Deletes the logo's GL objects. The context itself belongs to the caller. */
  dispose(): void {
    const gl = this.gl
    for (const program of [this.sky, this.glow, this.mark]) if (program) gl.deleteProgram(program)
    for (const vao of [this.skyVao, this.glowVao, this.markVao]) if (vao) gl.deleteVertexArray(vao)
    for (const buffer of [this.glowBuffer, this.markBuffer]) if (buffer) gl.deleteBuffer(buffer)
    this.sky = this.glow = this.mark = null; this.skyVao = this.glowVao = this.markVao = null; this.glowBuffer = this.markBuffer = null
    this.uniforms.clear()
  }
}

function smooth(from: number, to: number, x: number): number { const t = Math.min(1, Math.max(0, (x - from) / (to - from))); return t * t * (3 - 2 * t) }
