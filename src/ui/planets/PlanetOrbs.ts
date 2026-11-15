/**
 * Draws the lobby's planets. One hidden WebGL 2 canvas shades a lit, slowly turning sphere
 * with an atmosphere; each card's small 2D canvas takes a copy. Any number of cards share
 * the one context, and nothing is drawn while no card is on screen.
 *
 * A planet is drawn from its real map when one has been supplied with `setMap` (an RGBA
 * equirectangular image painted from the terrain generator). Until then it is drawn from
 * the recipe's two swatch colours over generated continents, so a card never waits.
 */
export interface OrbLook {
  /** Linear-ish sRGB colours as 0xRRGGBB. */
  land: number
  sea: number
  /** A lava sea glows on the night side. */
  glow: boolean
  seed: number
  /** Cloud cover, 0 none to 1 heavy. Generated, and it drifts on its own. */
  cloud?: number
  /** A lit grid over the surface: the "shape your own" planet. */
  grid?: boolean
  /** Key for a supplied map, normally the recipe id. */
  map?: string
}
interface Orb { canvas: HTMLCanvasElement; look: OrbLook }

const VERTEX = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`
const FRAGMENT = `#version 300 es
precision highp float;
uniform float uSize, uSeed, uSpin, uGlow, uGrid, uHasMap, uCloud, uTime;
uniform vec3 uLand, uSea;
uniform sampler2D uMap;
out vec4 color;
float hash(vec3 p) { p = fract(p * 0.3183099 + uSeed * 0.071 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.02 + 3.7; a *= 0.5; } return s; }
void main() {
  vec2 p = (gl_FragCoord.xy / uSize * 2.0 - 1.0) * 1.22;
  float r = length(p);
  vec3 light = normalize(vec3(-0.55, 0.5, 0.66));
  vec3 air = mix(uSea, vec3(0.35, 0.6, 1.0), 0.45);
  if (r > 1.0) { // atmosphere: a thin halo, brighter on the lit side
    float halo = pow(smoothstep(1.2, 1.0, r), 2.5) * (0.25 + 0.75 * clamp(dot(normalize(vec3(p, 0.0)), light) * 0.5 + 0.6, 0.0, 1.0));
    color = vec4(air * halo, halo) * 0.7; return;
  }
  vec3 n = vec3(p, sqrt(1.0 - r * r));
  // Tilt the axis, then spin about it.
  float t = 0.38, c = cos(t), s = sin(t); vec3 q = vec3(n.x, c * n.y - s * n.z, s * n.y + c * n.z);
  c = cos(uSpin); s = sin(uSpin); q = vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z);
  vec3 surface; float land;
  if (uHasMap > 0.5) {
    vec4 m = texture(uMap, vec2(atan(q.x, q.z) / 6.2831853 + 0.5, 0.5 - asin(clamp(q.y, -1.0, 1.0)) / 3.1415927)); // row 0 is the north pole
    surface = m.rgb;
    // The painted map is opaque, so find the glowing lava by its colour.
    land = 1.0 - clamp((m.r - m.b * 1.6 - 0.25) * 2.2, 0.0, 1.0);
  } else {
    float h = fbm(q * 2.1), detail = fbm(q * 7.0);
    land = smoothstep(0.5, 0.54, h + (detail - 0.5) * 0.12);
    surface = mix(uSea * (0.8 + 0.4 * detail), uLand * (0.62 + 0.75 * detail) * mix(1.0, 1.25, smoothstep(0.6, 0.75, h)), land);
  }
  float lit = clamp(dot(n, light), 0.0, 1.0);
  // Weather: cloud drifts over the surface at its own pace and takes the light.
  float cloud = uCloud * smoothstep(0.5, 0.72, fbm(q * 3.2 + vec3(uTime * 0.02, 0.0, uTime * 0.013) + 9.0));
  surface = mix(surface, vec3(0.93, 0.96, 1.0), cloud * 0.85);
  vec3 col = surface * (0.035 + 1.1 * pow(lit, 0.85));
  col += mix(uSea, surface, uHasMap) * uGlow * (1.0 - land) * 0.6; // lava glows in the dark
  if (uGrid > 0.5) {
    vec2 g = abs(fract(vec2(atan(q.x, q.z) / 6.2831853 * 16.0, asin(q.y) / 3.1415927 * 9.0)) - 0.5);
    col += vec3(0.25, 0.6, 1.0) * smoothstep(0.47, 0.5, max(g.x, g.y)) * 0.75;
  }
  col += air * pow(1.0 - n.z, 3.0) * (0.15 + 0.6 * lit);           // limb haze
  float edge = smoothstep(1.0, 0.985, r);
  color = vec4(col * edge, edge);
}`
const rgb = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]

class PlanetOrbs {
  private readonly orbs = new Set<Orb>()
  private readonly maps = new Map<string, WebGLTexture>()
  private readonly pending = new Map<string, { data: Uint8ClampedArray | Uint8Array; width: number; height: number }>()
  private gl: WebGL2RenderingContext | null = null
  private canvas: HTMLCanvasElement | null = null
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private frame = 0
  private last = 0
  private failed = false

  add(canvas: HTMLCanvasElement, look: OrbLook): Orb { const orb = { canvas, look }; this.orbs.add(orb); this.start(); return orb }
  remove(orb: Orb): void { this.orbs.delete(orb); if (!this.orbs.size) { cancelAnimationFrame(this.frame); this.frame = 0 } }
  /** Supply a planet's real map: RGBA, equirectangular, alpha 1 on land and 0 on sea. */
  setMap(key: string, data: Uint8ClampedArray | Uint8Array, width: number, height: number): void { this.pending.set(key, { data, width, height }); this.start() }

  /** Forget a map that is no longer shown, for example the previous seed's. */
  dropMap(key: string): void { this.pending.delete(key); const texture = this.maps.get(key); if (texture) { this.gl?.deleteTexture(texture); this.maps.delete(key) } }
  private start(): void { if (!this.frame && this.orbs.size) this.frame = requestAnimationFrame(this.loop) }
  private setup(): boolean {
    if (this.gl) return true
    if (this.failed) return false
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, depth: false, powerPreference: 'low-power' })
    if (!gl) { this.failed = true; return false }
    const program = gl.createProgram()!
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { console.warn('Syn3h planet shader failed; cards show plain discs.', gl.getProgramInfoLog(program)); this.failed = true; return false }
    gl.useProgram(program); gl.bindVertexArray(gl.createVertexArray())
    for (const name of ['uSize', 'uSeed', 'uSpin', 'uGlow', 'uGrid', 'uHasMap', 'uCloud', 'uTime', 'uLand', 'uSea', 'uMap']) this.uniforms[name] = gl.getUniformLocation(program, name)
    canvas.addEventListener('webglcontextlost', () => { this.gl = null; this.maps.clear() })
    this.gl = gl; this.canvas = canvas
    return true
  }
  private loop = (now: number): void => {
    this.frame = this.orbs.size ? requestAnimationFrame(this.loop) : 0
    // Fifteen frames a second is plenty for a slow turn.
    if (now - this.last < 66) return
    this.last = now
    const visible = [...this.orbs].filter(orb => orb.canvas.isConnected && orb.canvas.offsetParent !== null && orb.canvas.clientWidth > 0)
    if (!visible.length) return
    if (!this.setup()) { for (const orb of visible) this.flat(orb); return }
    const gl = this.gl!, u = this.uniforms, source = this.canvas!
    for (const [key, map] of this.pending) {
      const texture = this.maps.get(key) ?? gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, map.width, map.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, map.data instanceof Uint8Array ? map.data : new Uint8Array(map.data.buffer, map.data.byteOffset, map.data.byteLength))
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this.maps.set(key, texture)
    }
    this.pending.clear()
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const orb of visible) {
      const size = Math.round(orb.canvas.clientWidth * Math.min(devicePixelRatio || 1, 2))
      if (orb.canvas.width !== size) { orb.canvas.width = size; orb.canvas.height = size }
      if (source.width !== size) { source.width = size; source.height = size }
      const map = orb.look.map ? this.maps.get(orb.look.map) : undefined
      gl.viewport(0, 0, size, size); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform1f(u.uSize, size); gl.uniform1f(u.uSeed, orb.look.seed % 1000)
      // A mapped planet has one island, at longitude 0: rock it to and fro so it stays in
      // view. A generated one turns all the way round.
      const t = still ? 0 : now / 1000
      gl.uniform1f(u.uSpin, map ? 0.95 * Math.sin(t * 0.22 + orb.look.seed) : t * 0.12 + orb.look.seed)
      gl.uniform1f(u.uTime, t); gl.uniform1f(u.uCloud, orb.look.cloud ?? 0)
      gl.uniform1f(u.uGlow, orb.look.glow ? 1 : 0); gl.uniform1f(u.uGrid, orb.look.grid ? 1 : 0); gl.uniform1f(u.uHasMap, map ? 1 : 0)
      gl.uniform3f(u.uLand, ...rgb(orb.look.land)); gl.uniform3f(u.uSea, ...rgb(orb.look.sea))
      if (map) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, map); gl.uniform1i(u.uMap, 0) }
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      const ctx = orb.canvas.getContext('2d')!
      ctx.clearRect(0, 0, size, size); ctx.drawImage(source, 0, 0)
    }
  }
  /** Without WebGL 2: a plain shaded disc in the planet's colours. */
  private flat(orb: Orb): void {
    const size = orb.canvas.width = orb.canvas.height = Math.round(orb.canvas.clientWidth * Math.min(devicePixelRatio || 1, 2))
    const ctx = orb.canvas.getContext('2d')!, hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`
    const fill = ctx.createRadialGradient(size * 0.36, size * 0.34, size * 0.05, size / 2, size / 2, size * 0.42)
    fill.addColorStop(0, hex(orb.look.land)); fill.addColorStop(0.7, hex(orb.look.sea)); fill.addColorStop(1, '#02040a')
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.41, 0, Math.PI * 2); ctx.fill()
  }
}
/** Shared by every planet card in the page. */
export const planetOrbs = new PlanetOrbs()
