/**
 * The lobby sky: a deep blue nebula and three depths of drifting stars, generated in one
 * fragment shader. No images are loaded. The look comes from a seed and a few numbers, so
 * it can follow the world seed or a player's taste, and it costs one small WebGL 2 context
 * that draws at most thirty times a second.
 *
 * It keeps out of the game's way. Disabling it (Play was pressed) gives the context back,
 * because phones allow only a few live ones; enabling it makes a new one. It does not draw
 * while the tab is hidden. At the lowest graphics level, or for people who ask for reduced
 * motion, it draws one still frame: stars and clouds, no drift.
 *
 * The 2017 Unity lobby used a baked plasma skybox and a particle system drifting down at
 * 0.009 units a second; this keeps that direction and mood without the bitmap.
 */
export interface StarfieldLook {
  /** Any number. Different seeds give different clouds and star positions. */
  seed: number
  /** Cloud colour, linear RGB 0 to 1. */
  tint: [number, number, number]
  /** Cloud strength, 0 none to about 1.5 heavy. */
  nebula: number
  /** Share of sky cells that hold a star, 0 to 1. */
  density: number
}
export const DEFAULT_LOOK: StarfieldLook = { seed: 1, tint: [0.045, 0.13, 0.52], nebula: 1.1, density: 0.46 }

const VERTEX = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize; uniform float uTime; uniform float uSeed; uniform vec2 uShift;
uniform vec3 uTint; uniform float uNebula; uniform float uDensity;
out vec4 color;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21) + uSeed * 0.1371); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; } return s; }
// One star at most per cell: a few bright and soft, most faint and sharp.
float stars(vec2 uv, float scale, float depth) {
  uv = uv * scale + vec2(0.0, uTime * 0.009 * depth * scale * 0.35);
  vec2 cell = floor(uv), f = fract(uv);
  float pick = hash(cell + scale);
  if (pick > uDensity) return 0.0;
  vec2 at = vec2(hash(cell + 3.1), hash(cell + 7.7)) * 0.76 + 0.12;
  float mag = pow(hash(cell + 11.3), 5.0);
  float twinkle = 0.86 + 0.14 * sin(uTime * (0.6 + 2.4 * hash(cell + 5.0)) + pick * 40.0);
  return smoothstep(mix(0.035, 0.1, mag), 0.0, length(f - at)) * (0.22 + 0.78 * mag) * twinkle;
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uSize) / uSize.y;
  // Clouds: warped noise, kept to the edges so the panel in the middle stays readable.
  vec2 w = (p + uShift * 0.012) * 1.5 + uSeed * 3.17;
  float warp = fbm(w + uTime * 0.004);
  float n = fbm(w * 1.3 + 2.0 * vec2(warp, fbm(w + 5.2)));
  float cloud = smoothstep(0.3, 0.8, n);
  float wisps = smoothstep(0.42, 0.95, fbm(w * 3.1 + n * 2.0));
  vec3 c = vec3(0.004, 0.006, 0.014);
  c += uTint * cloud * (0.5 + 0.7 * wisps) * uNebula;
  c += vec3(0.16, 0.05, 0.34) * uTint.b * pow(cloud, 3.0) * wisps * uNebula;
  c *= mix(0.55, 1.0, smoothstep(0.1, 0.8, length(p * vec2(0.7, 1.0))));
  // Stars: near ones are larger, brighter and move more with the pointer.
  float s = stars(p + uShift * 0.030, 13.0, 1.0) * 1.0
          + stars(p + uShift * 0.018, 29.0, 0.6) * 0.8
          + stars(p + uShift * 0.008, 61.0, 0.35) * 0.6;
  c += s * vec3(0.72, 0.83, 1.0);
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0; // dither: no banding in the dark gradients
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
    for (const name of ['uSize', 'uTime', 'uSeed', 'uShift', 'uTint', 'uNebula', 'uDensity']) this.uniforms[name] = gl.getUniformLocation(program, name)
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
    gl.uniform1f(u.uNebula, this.look.nebula); gl.uniform1f(u.uDensity, this.look.density)
    gl.drawArrays(gl.TRIANGLES, 0, 3); this.frames++
  }
  dispose(): void {
    this.active = false; this.resizeObserver.disconnect(); document.removeEventListener('visibilitychange', this.onVisibility)
    this.release()
  }
}
