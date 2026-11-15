/**
 * The lobby sky, in the look of terranlabs.com's Dark Star opening: deep space, a field of
 * small stars that slowly wheels, a dark world's limb along the bottom of the screen with
 * its atmosphere, and the sun just clearing that limb, throwing long shifting shafts of
 * light, a lens streak and ghosts. One fragment shader, no images. The sun, shafts, flare
 * and stars are that site's formulas (its PlanetGL.tsx), ported unchanged; the world here is
 * a simpler one, since most of it sits below the screen.
 *
 * It keeps out of the game's way. Disabling it (Play was pressed) gives the context back,
 * because phones allow only a few live ones; enabling it makes a new one. It does not draw
 * while the tab is hidden. At the lowest graphics level, or for people who ask for reduced
 * motion, it draws one still frame.
 */
import { qualityFrame } from './quality/ladder'

export interface StarfieldLook {
  /** Any number. Different seeds turn the world and place its clouds differently. */
  seed: number
  /** Cloud colour of the faint nebula, linear RGB 0 to 1. */
  tint: [number, number, number]
  /** Nebula strength: 0 is terranlabs.com's plain deep space, 1 a heavy blue cloud. */
  nebula: number
  /** Strength of the sun's shafts: 1 is the default, 0 none. */
  rays: number
  /** 0 hides the world and its sun, leaving stars alone. */
  world: number
}
export const DEFAULT_LOOK: StarfieldLook = { seed: 1, tint: [0.02, 0.06, 0.24], nebula: 0.35, rays: 1, world: 1 }

const VERTEX = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize; uniform float uTime; uniform float uSeed; uniform vec2 uShift; uniform float uScale;
uniform vec3 uTint; uniform float uNebula; uniform float uRays; uniform float uWorld;
out vec4 color;
// terranlabs.com's noise, unchanged.
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float t = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { t += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return t; }
// Dark Star: space, ink, accents, warm light, air (src/concepts/descent/theme.ts there).
const vec3 SPACE = vec3(0.004, 0.008, 0.039);   // #01020a
const vec3 INK = vec3(0.97, 0.98, 0.99);
const vec3 WARM = vec3(1.0, 0.77, 0.5);         // #ffc480
const vec3 ACCENT_B = vec3(0.56, 0.48, 1.0);    // #8f7bff
const vec3 AIR = vec3(0.5, 0.77, 1.0);          // #7fc4ff
const vec3 AIR_OUT = vec3(0.18, 0.49, 1.0);     // #2f7dff
void main() {
  float minSide = min(uSize.x, uSize.y);
  vec2 q = (gl_FragCoord.xy - 0.5 * uSize) / minSide;                 // y up, 1 = the short side
  vec2 pixel = gl_FragCoord.xy / uScale;                              // full-resolution pixels
  // The world: a disc far larger than the screen, its top edge a little above the bottom.
  float radius = 1.9;
  vec2 centre = vec2(0.0, -0.5 * uSize.y / minSide + 0.13 - radius) - uShift * 0.006;
  vec2 fromCentre = q - centre;
  float dist = length(fromCentre);
  float outside = mix(1.0, smoothstep(radius - 0.002, radius + 0.002, dist), uWorld);
  // The sun, just clear of the limb on the right.
  // Far enough right to stand clear of the panel, but never off a narrow screen.
  float sunX = min(0.66, 0.5 * uSize.x / minSide - 0.1), sunAngle = asin(sunX / (radius * 1.012));
  vec2 sunAt = centre + radius * 1.012 * vec2(sin(sunAngle), cos(sunAngle));
  vec2 toSun = q - sunAt;
  float sunDistance = length(toSun);
  vec2 sunDirection = toSun / max(sunDistance, 0.00001);

  vec3 c = SPACE;
  // A faint cloud, for depth. Zero gives that site's plain space.
  if (uNebula > 0.0) {
    vec3 w = vec3((q + uShift * 0.01) * 1.4 + uSeed * 3.17, uTime * 0.004);
    float n = fbm(w + 2.0 * vec3(fbm(w + 5.2), fbm(w + 1.7), 0.0));
    c += uTint * smoothstep(0.34, 0.8, n) * (0.4 + 0.8 * smoothstep(0.4, 0.9, fbm(w * 3.1))) * uNebula;
  }
  // Stars, hidden by the sun's glare. Cells are measured in full resolution pixels so the
  // field stays put when the render scale changes. The whole field wheels about a pole far
  // below the screen, the way the sky turns over a horizon.
  vec2 fromPole = pixel - vec2(0.5 * uSize.x / uScale, -2.4 * uSize.y / uScale) + uShift * 6.0;
  float wheel = uTime * 0.0035, sc = cos(wheel), ss = sin(wheel);
  vec2 heaven = vec2(fromPole.x * sc - fromPole.y * ss, fromPole.x * ss + fromPole.y * sc);
  vec2 starCell = floor(heaven / 2.0);
  float star = step(0.9987, hash(vec3(starCell, 1.0)));
  float bright = step(0.99985, hash(vec3(floor(heaven / 3.0), 5.0)));
  float twinkle = 0.55 + 0.45 * sin(uTime * 1.3 + hash(vec3(starCell, 2.0)) * 40.0);
  c += outside * INK * (star * 0.5 + bright * 1.2) * twinkle * mix(1.0, smoothstep(0.08, 0.5, sunDistance), uWorld);

  if (uWorld > 0.0) {
    if (outside < 1.0) {
      // The world's night side: dark sea and cloud, a thin lit crescent toward the sun.
      vec3 normal = vec3(fromCentre / radius, sqrt(max(0.0, 1.0 - dist * dist / (radius * radius))));
      vec3 sun = normalize(vec3(sin(sunAngle), cos(sunAngle), -0.42));
      float daylight = dot(normal, sun);
      vec3 ground = normal; float turn = uTime * 0.006 + uSeed;
      ground.xz = vec2(ground.x * cos(turn) - ground.z * sin(turn), ground.x * sin(turn) + ground.z * cos(turn));
      float land = smoothstep(0.5, 0.56, fbm(ground * 2.6 + 4.0));
      float cloud = smoothstep(0.52, 0.74, fbm(ground * 4.2 + vec3(uTime * 0.01, 0.0, 9.0)));
      vec3 day = mix(mix(vec3(0.012, 0.1, 0.29), vec3(0.055, 0.42, 0.59), land * 0.4), vec3(0.96, 0.98, 1.0), cloud * 0.7);
      vec3 surface = day * smoothstep(-0.02, 0.3, daylight) + vec3(0.006, 0.01, 0.03) * (1.0 + cloud);
      float rim = pow(1.0 - normal.z, 3.0), towardSun = 0.2 + 0.8 * smoothstep(-0.55, 0.55, daylight + 0.3);
      surface += AIR * rim * towardSun * 1.05 + vec3(0.6, 0.85, 1.0) * pow(1.0 - normal.z, 10.0) * towardSun * 0.7;
      c = mix(surface, c, outside);
    }
    // Atmosphere above the limb: a tight bright band, a blue shell and a wide haze.
    float h = max(0.0, dist - radius), lit = 0.25 + 0.75 * exp(-sunDistance * 1.6);
    c += outside * (vec3(0.75, 0.9, 1.0) * exp(-h * 160.0) * 0.9 + AIR * exp(-h * 38.0) * 0.5 + AIR_OUT * exp(-h * 9.0) * 0.16) * lit;

    // The sun: a hard core, a warm bloom, a wide haze. Hidden where the world is in front.
    float seen = mix(0.06, 1.0, outside);
    vec3 sunLight = vec3(1.0, 0.98, 0.94) * exp(-sunDistance * 42.0) * 2.4;
    sunLight += mix(WARM, vec3(1.0, 0.8, 0.55), 0.5) * exp(-sunDistance * 11.0) * 0.8;
    sunLight += mix(WARM, ACCENT_B, 0.35) * exp(-sunDistance * 2.8) * 0.22;
    // Rays: shafts of light fanning out from the sun, slowly shifting.
    float shafts =
      pow(noise(vec3(sunDirection * 2.4, uTime * 0.09)), 2.0) * 0.9 +
      pow(noise(vec3(sunDirection * 6.5 + 3.0, uTime * 0.15)), 3.0) * 0.8 +
      pow(noise(vec3(sunDirection * 17.0 + 9.0, uTime * 0.24)), 4.0) * 0.6;
    float reach = exp(-sunDistance * 1.7) * smoothstep(0.015, 0.14, sunDistance);
    sunLight += mix(vec3(1.0, 0.86, 0.66), WARM, 0.3) * shafts * reach * 0.95 * uRays;
    // Lens flare: a horizontal streak and three ghosts toward the screen centre.
    vec2 fromSun = q - sunAt;
    vec3 flare = vec3(0.55, 0.75, 1.0) * exp(-abs(fromSun.y) * 120.0) * exp(-abs(fromSun.x) * 2.6) * 0.5;
    float ghostA = 1.0 - smoothstep(0.035, 0.05, length(q - sunAt * 0.45));
    float ghostB = 1.0 - smoothstep(0.012, 0.022, length(q + sunAt * 0.25));
    float ghostC = (1.0 - smoothstep(0.07, 0.09, length(q + sunAt * 0.8))) * smoothstep(0.045, 0.07, length(q + sunAt * 0.8));
    sunLight += flare + vec3(0.4, 0.7, 1.0) * ghostA * 0.07 + vec3(1.0, 0.6, 0.3) * ghostB * 0.12 + vec3(0.6, 1.0, 0.8) * ghostC * 0.035;
    c += sunLight * seen * uWorld;
  }
  // Colours here are display colours, as on that site: light is added and rolled off at the
  // top. A little dither keeps the dark gradients smooth.
  c = c / (1.0 + 0.3 * max(max(c.r, c.g), c.b));
  c += (hash(vec3(gl_FragCoord.xy, 7.0)) - 0.5) / 255.0;
  color = vec4(c, 1.0);
}`

export class Starfield {
  canvas = document.createElement('canvas')
  /** Frames drawn, for the phone checks. */
  frames = 0
  private gl: WebGL2RenderingContext | null = null
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private look: StarfieldLook
  private shift: [number, number] = [0, 0]
  private frame = 0
  private lastDraw = 0
  private active = true
  private wasMoving = false
  private recheck?: ReturnType<typeof setTimeout>
  private readonly started = performance.now()
  private readonly resizeObserver: ResizeObserver
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)')

  /** `still` is asked each frame: true draws one frame and stops (lowest graphics level). */
  constructor(private readonly host: HTMLElement, look: Partial<StarfieldLook> = {}, private readonly still: () => boolean = () => false) {
    this.look = { ...DEFAULT_LOOK, ...look }
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.acquire()
  }
  private readonly onVisibility = (): void => { cancelAnimationFrame(this.frame); clearTimeout(this.recheck); if (this.active && !document.hidden) this.loop(0) }
  private get motionless(): boolean { return this.still() || this.reduced.matches }
  /** A fresh canvas and context. */
  private acquire(): void {
    const canvas = this.canvas = document.createElement('canvas')
    canvas.className = 'lobby-starfield'; canvas.setAttribute('aria-hidden', 'true'); this.host.prepend(canvas)
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); if (this.canvas === canvas) this.gl = null })
    canvas.addEventListener('webglcontextrestored', () => { if (this.canvas === canvas) { this.setup(); this.draw() } })
    this.setup(); this.resize(); this.loop(0)
  }
  /** Give the context back to the browser and take the canvas out of the page. */
  private release(): void {
    cancelAnimationFrame(this.frame); clearTimeout(this.recheck)
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext(); this.gl = null; this.canvas.remove()
  }
  /** False when WebGL 2 is unavailable; the CSS background behind the canvas shows instead. */
  get generated(): boolean { return this.gl !== null }
  setLook(look: Partial<StarfieldLook>): void { this.look = { ...this.look, ...look }; this.draw() }
  /** Pointer position, -1 to 1 on each axis, for parallax between the star depths. */
  setShift(x: number, y: number): void { this.shift = [x, y] }
  set enabled(value: boolean) {
    if (value === this.active) return
    this.active = value
    if (value) this.acquire(); else this.release()
  }
  private setup(): void {
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power' })
    if (!gl) { this.canvas.hidden = true; return }
    const program = gl.createProgram()!
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { console.warn('Syn3h starfield shader failed; using the plain background.', gl.getProgramInfoLog(program)); this.canvas.hidden = true; return }
    gl.useProgram(program)
    // The full-screen triangle comes from gl_VertexID, so there is no buffer to upload.
    gl.bindVertexArray(gl.createVertexArray())
    for (const name of ['uSize', 'uTime', 'uSeed', 'uShift', 'uScale', 'uTint', 'uNebula', 'uRays', 'uWorld']) this.uniforms[name] = gl.getUniformLocation(program, name)
    this.gl = gl
  }
  private resize(): void {
    // Clouds are soft and stars are small: 1.5 device pixels per CSS pixel is plenty.
    const scale = Math.min(devicePixelRatio || 1, 1.5)
    this.canvas.width = Math.max(1, Math.round(this.host.clientWidth * scale)); this.canvas.height = Math.max(1, Math.round(this.host.clientHeight * scale))
    this.draw()
  }
  private loop = (now: number): void => {
    if (!this.active || document.hidden) return
    qualityFrame(now)
    // Still mode: the one frame drawn on resize stays up. Look again in a second in case the
    // graphics level or the motion preference has changed.
    if (this.motionless) {
      if (this.wasMoving) { this.wasMoving = false; this.draw() }
      clearTimeout(this.recheck); this.recheck = setTimeout(() => { this.frame = requestAnimationFrame(this.loop) }, 1000)
      return
    }
    this.wasMoving = true
    // Thirty frames a second is smooth for a slow drift and leaves the GPU to the game.
    if (now - this.lastDraw >= 33) { this.lastDraw = now; this.draw() }
    this.frame = requestAnimationFrame(this.loop)
  }
  private draw(): void {
    const gl = this.gl, u = this.uniforms
    if (!gl) return
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.uniform2f(u.uSize, this.canvas.width, this.canvas.height)
    gl.uniform1f(u.uTime, this.motionless ? 0 : (performance.now() - this.started) / 1000)
    gl.uniform1f(u.uSeed, this.look.seed % 1000)
    gl.uniform2f(u.uShift, this.shift[0], this.shift[1])
    gl.uniform3f(u.uTint, ...this.look.tint)
    gl.uniform1f(u.uNebula, this.look.nebula); gl.uniform1f(u.uRays, this.look.rays); gl.uniform1f(u.uWorld, this.look.world)
    gl.uniform1f(u.uScale, this.canvas.width / Math.max(1, this.host.clientWidth))
    gl.drawArrays(gl.TRIANGLES, 0, 3); this.frames++
  }
  dispose(): void {
    this.active = false; this.resizeObserver.disconnect(); document.removeEventListener('visibilitychange', this.onVisibility)
    this.release()
  }
}
