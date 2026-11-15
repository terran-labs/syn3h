/**
 * The galaxy: the lobby as a place. A sun, and one world per planet recipe in orbit round it.
 * Drag empty space to swing the view, pinch or scroll to move in and out, tap a world to fly
 * down to it. One fragment shader traces the sun and the spheres, so there are no meshes, no
 * libraries and no images: each world is lit from where the sun really is, wears its real
 * generated map once that has been painted, and throws a shadow through the sun's shafts.
 *
 * The sun, shafts, flare and stars are terranlabs.com's (src/concepts/descent/PlanetGL.tsx there). Like the other
 * lobby graphics it draws at most thirty times a second, stops in a hidden tab, and gives
 * its WebGL context back when disabled.
 */
import { qualityFrame, qualityScale, qualityShed } from '../quality/ladder'

export interface GalaxyWorld {
  id: string
  label: string
  /** 0xRRGGBB, used until the world's map is painted. */
  land: number
  sea: number
  /** A lava sea glows on the night side. */
  glow: boolean
  seed: number
  /** A world still forming: molten, its crust shifting. It has no map. The custom planet. */
  forming?: boolean
  /** The planet recipe its map is painted from, when that is not its id. */
  recipe?: string
}
export interface GalaxyOptions {
  worlds: readonly GalaxyWorld[]
  /** A world was tapped and the camera has arrived at it. */
  onArrive(id: string): void
  /** Called every frame with where each world is on screen, for labels. */
  onLayout?(places: readonly { id: string; x: number; y: number; radius: number; visible: boolean }[], chosen?: string): void
  /**
   * Asked each frame. True holds the system still: the worlds stop in their orbits and a frame
   * is drawn only while something moves (a drag, a flight, a dive). For the lowest graphics
   * level, so weak devices keep the galaxy at almost no cost. Reduced motion does the same.
   */
  still?(): boolean
}
/**
 * The most worlds the galaxy draws, the sun aside. The trace costs little per world (a ray
 * against a sphere, a shadow cut through the shafts); the limit is the screen and the maps.
 */
export const GALAXY_MAX = 12
const MAX = GALAXY_MAX
/** Orbits round the sun; more worlds than this share them. */
const RINGS = 4
/**
 * Level of detail for the maps: every world wears a small one (512 by 256, about 40 ms to
 * paint on a desktop, half a megabyte on the GPU) from one texture array; the world being
 * flown to, and dived into, is repainted at full size (1024 by 512, about 130 ms).
 */
const SMALL = [512, 256] as const, CLOSE = [1024, 512] as const
const VERTEX = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize; uniform float uTime; uniform float uScale;
uniform vec2 uShed;                 // quality ladder: x sheds post effects, y shader cost
uniform float uAmbience;            // 1 keeps twinkle and drifting cloud, 0 sheds them
uniform float uDive;                // 0 in orbit, 1 through the atmosphere of the chosen world
uniform vec3 uEye, uRight, uUp, uForward; uniform float uTan;
uniform int uCount;
uniform vec4 uWorld[${MAX}];        // xyz position, w radius
uniform vec3 uLand[${MAX}], uSea[${MAX}];
uniform vec4 uKind[${MAX}];         // x glow, y has map, z spin, w seed
uniform highp sampler2DArray uMaps; uniform sampler2D uClose; uniform int uCloseIndex;
out vec4 color;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float t = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    // At lower quality the two finest octaves fade out, then are skipped.
    if (i < 3 || uShed.y <= 0.0) t += a * noise(p); else { if (uShed.y >= 1.0) break; t += a * noise(p) * (1.0 - uShed.y); }
    p = p * 2.03 + 11.7; a *= 0.5;
  }
  return t;
}
const vec3 SPACE = vec3(0.004, 0.008, 0.039);
const vec3 WARM = vec3(1.0, 0.77, 0.5);
const vec3 ACCENT_B = vec3(0.56, 0.48, 1.0);
vec4 mapAt(int i, vec2 uv) { return i == uCloseIndex ? texture(uClose, uv) : texture(uMaps, vec3(uv, float(i))); }
// Where a point in space lands on screen, in the same units as q below. z is depth.
vec3 toScreen(vec3 p) { vec3 d = p - uEye; float z = dot(d, uForward); return vec3(dot(d, uRight), dot(d, uUp), z) / vec3(max(z, 0.0001) * uTan, max(z, 0.0001) * uTan, 1.0); }
void main() {
  float minSide = min(uSize.x, uSize.y);
  vec2 q = (gl_FragCoord.xy - 0.5 * uSize) / minSide * 2.0;           // -1..1 on the short side
  vec3 ray = normalize(uForward + (q.x * uRight + q.y * uUp) * uTan);
  vec3 c = SPACE;
  // Stars, fixed to the sky so they turn as the view does.
  vec3 cell = floor(ray * 420.0);
  float star = step(0.9965, hash(cell)), bright = step(0.99955, hash(floor(ray * 260.0) + 5.0));
  float twinkle = mix(0.8, 0.55 + 0.45 * sin(uTime * 1.3 + hash(cell + 2.0) * 40.0), uAmbience);
  vec3 sky = vec3(0.97, 0.98, 0.99) * (star * 0.5 + bright * 1.2) * twinkle;
  // A faint band of cloud along the orbital plane's far side, for depth.
  if (uAmbience > 0.0) sky += vec3(0.02, 0.06, 0.24) * smoothstep(0.38, 0.8, fbm(ray * 2.2 + 7.0)) * 0.5 * uAmbience;

  // The nearest world along this ray.
  float nearest = 1e9; int found = -1; vec3 normal = vec3(0.0); float halo = 0.0; vec3 haloTint = vec3(0.0);
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount) break;
    vec3 oc = uEye - uWorld[i].xyz; float r = uWorld[i].w;
    float b = dot(oc, ray), cc = dot(oc, oc) - r * r, disc = b * b - cc;
    if (disc > 0.0) { float t = -b - sqrt(disc); if (t > 0.0 && t < nearest) { nearest = t; found = i; normal = normalize(oc + ray * t); } }
    else if (b < 0.0) {
      // Just outside the limb: a thin shell of air, brighter toward the sun.
      float miss = sqrt(max(0.0, cc + r * r - b * b)) - r;          // how far the ray passes outside the limb
      vec3 air = mix(uSea[i], vec3(0.35, 0.6, 1.0), 0.45);
      float toward = 0.3 + 0.7 * clamp(dot(normalize(-uWorld[i].xyz), normalize(oc + ray * (-b))) * 0.5 + 0.5, 0.0, 1.0);
      halo += pow(clamp(1.0 - miss / (r * 0.14), 0.0, 1.0), 2.5) * toward * 0.6; haloTint = air;
    }
  }
  // The sun at the centre, as a light in the sky: core, bloom and haze by angle from it.
  vec3 sunP = toScreen(vec3(0.0));
  vec2 toSun = q * 0.5 - sunP.xy * 0.5;
  float sunDistance = sunP.z > 0.0 ? length(toSun) : 9.0;
  vec2 sunDirection = toSun / max(length(toSun), 0.00001);
  vec3 sunLight = vec3(1.0, 0.98, 0.94) * exp(-sunDistance * 42.0) * 2.4;
  sunLight += mix(WARM, vec3(1.0, 0.8, 0.55), 0.5) * exp(-sunDistance * 11.0) * 0.8;
  sunLight += mix(WARM, ACCENT_B, 0.35) * exp(-sunDistance * 2.8) * 0.22;
  float shafts =
    pow(noise(vec3(sunDirection * 2.4, uTime * 0.09)), 2.0) * 0.9 +
    pow(noise(vec3(sunDirection * 6.5 + 3.0, uTime * 0.15)), 3.0) * 0.8 +
    pow(noise(vec3(sunDirection * 17.0 + 9.0, uTime * 0.24)), 4.0) * 0.6;
  float reach = exp(-sunDistance * 1.7) * smoothstep(0.015, 0.14, sunDistance);
  // Each world stands in the light: behind it, as seen from the sun, the shafts are cut.
  float shade = 1.0;
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount || uShed.x >= 1.0) break;
    vec3 w = toScreen(uWorld[i].xyz);
    if (w.z <= 0.0) continue;
    vec2 centre = w.xy * 0.5 - sunP.xy * 0.5;                // from the sun, on screen
    float along = dot(centre, sunDirection), size = uWorld[i].w / (w.z * uTan) * 0.5;
    if (along > 0.0 && length(toSun) > along) {
      float off = length(centre - sunDirection * along);
      // The shadow widens a little and softens with distance behind the world.
      float spread = size * (1.0 + (length(toSun) - along) * 0.6);
      shade *= 1.0 - (1.0 - smoothstep(spread * 0.7, spread * 1.25, off)) * 0.85 * (1.0 - uShed.x);
    }
  }
  sunLight += mix(vec3(1.0, 0.86, 0.66), WARM, 0.3) * shafts * reach * 0.95 * shade;
  // Lens: a horizontal streak and three ghosts toward the centre. Post effects, shed first.
  vec3 flare = vec3(0.55, 0.75, 1.0) * exp(-abs(toSun.y) * 120.0) * exp(-abs(toSun.x) * 2.6) * 0.5;
  vec2 view = q * 0.5, sunView = sunP.xy * 0.5;
  float ghostA = 1.0 - smoothstep(0.035, 0.05, length(view - sunView * 0.45));
  float ghostB = 1.0 - smoothstep(0.012, 0.022, length(view + sunView * 0.25));
  float ghostC = (1.0 - smoothstep(0.07, 0.09, length(view + sunView * 0.8))) * smoothstep(0.045, 0.07, length(view + sunView * 0.8));
  flare += vec3(0.4, 0.7, 1.0) * ghostA * 0.07 + vec3(1.0, 0.6, 0.3) * ghostB * 0.12 + vec3(0.6, 1.0, 0.8) * ghostC * 0.035;
  flare *= (1.0 - uShed.x) * step(0.0, sunP.z);

  if (found >= 0) {
    vec3 at = uEye + ray * nearest, centre = uWorld[found].xyz;
    vec3 light = normalize(-centre);                         // the sun is at the origin
    float lit = clamp(dot(normal, light), 0.0, 1.0);
    // Turn the world on its tilted axis.
    float tilt = 0.38, ct = cos(tilt), st = sin(tilt); vec3 g = vec3(normal.x, ct * normal.y - st * normal.z, st * normal.y + ct * normal.z);
    float spin = uKind[found].z; g = vec3(cos(spin) * g.x + sin(spin) * g.z, g.y, -sin(spin) * g.x + cos(spin) * g.z);
    vec3 surface; float land; float molten = 0.0; float dry = 1.0;   // dry: ground a settlement could stand on
    if (uKind[found].x > 1.5) {
      // A world still forming: plates of dark crust drifting on magma, never the same twice.
      float plates = fbm(g * 2.4 + vec3(0.0, uTime * 0.05, uKind[found].w)), cracks = fbm(g * 6.0 + vec3(uTime * 0.11, 0.0, 3.0));
      molten = smoothstep(0.42, 0.6, plates * 0.65 + cracks * 0.5 + 0.08 * sin(uTime * 0.7 + plates * 9.0));
      surface = mix(vec3(0.07, 0.05, 0.06), vec3(1.0, 0.42, 0.08), molten) + vec3(1.0, 0.85, 0.5) * pow(molten, 6.0) * 0.6; land = 1.0;
    } else if (uKind[found].y > 0.5) {
      vec4 m = mapAt(found, vec2(atan(g.x, g.z) / 6.2831853 + 0.5, 0.5 - asin(clamp(g.y, -1.0, 1.0)) / 3.1415927));
      surface = m.rgb; land = 1.0 - clamp((m.r - m.b * 1.6 - 0.25) * 2.2, 0.0, 1.0);
      // The painted map is opaque: open water is where blue leads the other two.
      dry = 1.0 - smoothstep(0.02, 0.14, m.b - max(m.r, m.g));
    } else {
      float h = fbm(g * 2.1 + uKind[found].w), detail = fbm(g * 7.0);
      land = smoothstep(0.5, 0.54, h + (detail - 0.5) * 0.12);
      surface = mix(uSea[found] * (0.8 + 0.4 * detail), uLand[found] * (0.62 + 0.75 * detail), land); dry = land;
    }
    float cloud = uAmbience > 0.0 && uKind[found].x < 0.5 ? 0.5 * uAmbience * smoothstep(0.5, 0.72, fbm(g * 3.2 + vec3(uTime * 0.02, 0.0, uTime * 0.013) + 9.0)) : 0.0;
    surface = mix(surface, vec3(0.93, 0.96, 1.0), cloud);
    // A little fill, so a world seen from its night side is still a world and not a hole.
    vec3 world = surface * (0.11 + 1.1 * pow(lit, 0.85));
    world += mix(uSea[found], surface, uKind[found].y) * step(0.5, uKind[found].x) * step(uKind[found].x, 1.5) * (1.0 - land) * 0.6;   // lava glows in the dark
    world += surface * molten * 0.9;                                              // and magma lights itself
    // Night side of a watered world: the lights of settlements on the land.
    if (uKind[found].x < 0.5 && uShed.y < 1.0) {
      vec3 lampCell = floor(g * 46.0); float lamp = step(0.93, hash(lampCell)) * smoothstep(0.35, 0.0, lit) * dry;
      world += vec3(1.0, 0.75, 0.42) * lamp * 0.55 * (1.0 - uShed.y);
    }
    vec3 air = mix(uSea[found], vec3(0.35, 0.6, 1.0), 0.45);
    world += air * pow(1.0 - clamp(dot(normal, -ray), 0.0, 1.0), 3.0) * (0.15 + 0.7 * lit);
    c = world;
    // The sun is hidden behind a world that stands in front of it.
    if (sunP.z > nearest) sunLight *= 0.06;
  } else {
    c += sky * smoothstep(0.08, 0.5, sunDistance) + haloTint * halo;
  }
  c += sunLight + flare * (found >= 0 ? 0.2 : 1.0);
  // The dive: streaks rushing outward, then the brightness of air as the world fills the view.
  if (uDive > 0.0) {
    float rush = pow(noise(vec3(normalize(q + 0.0001) * 11.0, uTime * 3.2)), 3.0) * smoothstep(0.15, 1.3, length(q));
    c += vec3(0.7, 0.86, 1.0) * rush * uDive * 0.9;
    c = mix(c, vec3(0.72, 0.87, 1.0), smoothstep(0.5, 1.0, uDive) * 0.92);
  }
  // Grade: roll the highlights off, a vignette to hold the eye in the middle, fine film grain.
  c = c / (1.0 + 0.3 * max(max(c.r, c.g), c.b));
  vec2 corner = gl_FragCoord.xy / uSize - 0.5;
  c *= 1.0 - dot(corner, corner) * 0.85;
  c += (hash(vec3(gl_FragCoord.xy, floor(uTime * 24.0))) - 0.5) * 0.028 * (1.0 - uShed.x);
  c += (hash(vec3(gl_FragCoord.xy, 7.0)) - 0.5) / 255.0;
  color = vec4(c, 1.0);
}`
const rgb = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
type Vec = [number, number, number]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec): Vec => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const mix = (a: number, b: number, t: number) => a + (b - a) * t

export class Galaxy {
  canvas = document.createElement('canvas')
  /** Frames drawn, for the checks. */
  frames = 0
  private gl: WebGL2RenderingContext | null = null
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  /** Painted maps by `recipe:seed:size`, kept across context loss so they upload again. */
  private readonly maps = new Map<string, { data: Uint8ClampedArray; width: number; height: number }>()
  /** Which small map each texture array layer holds, and which map the close texture holds. */
  private layers: (string | undefined)[] = []
  private closeKey?: string
  private closeIndex = -1
  private array: WebGLTexture | null = null
  private close: WebGLTexture | null = null
  private worker: Worker | null = null
  private readonly queue: { key: string; id: string; seed: number; width: number; height: number }[] = []
  private painting = false
  private frame = 0
  private last = 0
  private active = false
  // Seconds of orbit shown. It advances only while the system is not held still.
  private clock = 0
  private lastClock = performance.now()
  /** Frames still owed after a change (a tap, a resize, a map arriving), in still mode. */
  private wake = 2
  private settled = false
  private holding = false
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)')
  /** Frames skipped because nothing moved, for the checks. */
  idle = 0
  // The view: an orbit round a point, which is the sun until a world is chosen.
  private yaw = 0.6
  private pitch = 0.5
  private framed = false
  private distance = 13
  private target: Vec = [0, 0, 0]
  private spinVelocity = 0
  private chosen = -1
  private diving = false
  private dive = 0
  private shownScale = 0
  private arriving = 0
  private arrived = false
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private pinch = 0
  private readonly abort = new AbortController()
  private readonly resizeObserver: ResizeObserver

  constructor(private readonly host: HTMLElement, private readonly options: GalaxyOptions) {
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host)
    document.addEventListener('visibilitychange', () => { cancelAnimationFrame(this.frame); if (this.active && !document.hidden) this.loop(0) }, { signal: this.abort.signal })
  }
  /** False when WebGL 2 is not available: the caller keeps the ordinary lobby. */
  static supported(): boolean { try { return Boolean(document.createElement('canvas').getContext('webgl2')) } catch { return false } }
  get live(): boolean { return this.gl !== null }
  /** Worlds whose painted maps have arrived. */
  get painted(): number { return this.options.worlds.filter(world => this.maps.has(this.mapKey(world, SMALL))).length }
  private mapKey(world: GalaxyWorld, size: readonly [number, number]): string { return `${world.recipe ?? world.id}:${world.seed}:${size[0]}` }
  set enabled(value: boolean) {
    if (value === this.active) return
    this.active = value
    if (value) this.acquire(); else this.release()
  }
  /** Back out to the whole system, for example after returning from a world's panel. */
  home(): void { this.wake = 2; this.chosen = -1; this.arriving = 0; this.arrived = false; this.diving = false; this.dive = 0 }
  /** The descent: fall toward a world until its air fills the view. Resolves when it has. */
  descend(id: string): Promise<void> {
    this.choose(id); this.arrived = true; this.diving = true; this.wake = 2
    return new Promise(resolve => { const wait = () => { if (!this.active || this.dive >= 0.995) resolve(); else setTimeout(wait, 50) }; wait() })
  }

  private acquire(): void {
    const canvas = this.canvas = document.createElement('canvas')
    canvas.className = 'galaxy-canvas'; canvas.setAttribute('aria-hidden', 'true'); this.host.prepend(canvas)
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' })
    if (!gl) return
    const program = gl.createProgram()!
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) { const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(program, shader) }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { console.warn('Syn3h galaxy shader failed.', gl.getProgramInfoLog(program)); return }
    gl.useProgram(program); gl.bindVertexArray(gl.createVertexArray())
    for (const name of ['uShed', 'uAmbience', 'uDive', 'uSize', 'uTime', 'uScale', 'uEye', 'uRight', 'uUp', 'uForward', 'uTan', 'uCount', 'uWorld', 'uLand', 'uSea', 'uKind', 'uMaps', 'uClose', 'uCloseIndex']) this.uniforms[name] = gl.getUniformLocation(program, name)
    // One array of small maps on unit 0, the close map on unit 1.
    const linear = (target: number) => { gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE) }
    gl.activeTexture(gl.TEXTURE0); this.array = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.array)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, SMALL[0], SMALL[1], MAX); linear(gl.TEXTURE_2D_ARRAY)
    gl.activeTexture(gl.TEXTURE1); this.close = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.close)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); linear(gl.TEXTURE_2D)
    gl.uniform1i(this.uniforms.uMaps, 0); gl.uniform1i(this.uniforms.uClose, 1)
    this.layers = []; this.closeKey = undefined; this.closeIndex = -1
    this.gl = gl
    const signal = this.abort.signal, options = { signal }
    canvas.addEventListener('pointerdown', event => this.down(event), options)
    canvas.addEventListener('pointermove', event => this.move(event), options)
    for (const type of ['pointerup', 'pointercancel'] as const) canvas.addEventListener(type, event => this.up(event, type === 'pointerup'), options)
    canvas.addEventListener('wheel', event => { event.preventDefault(); this.wake = 2; if (this.chosen < 0) this.distance = Math.min(26, Math.max(6, this.distance * Math.exp(event.deltaY * 0.0012))) }, { signal, passive: false })
    // Held upright, a phone has height to spare and no width: look down more steeply so the
    // orbits open out into the height. Only for the first view; after that the player's stands.
    if (!this.framed) { this.framed = true; if (this.host.clientHeight > this.host.clientWidth * 1.2) this.pitch = 0.85 }
    this.paintMaps(); this.resize(); this.loop(0)
  }
  private release(): void {
    cancelAnimationFrame(this.frame); this.worker?.terminate(); this.worker = null; this.queue.length = 0; this.painting = false
    this.array = this.close = null
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext(); this.gl = null; this.canvas.remove(); this.pointers.clear(); this.drag = null
  }
  /** Each world's small map, painted off the main thread, one after another. */
  private paintMaps(): void {
    for (const world of this.options.worlds.slice(0, MAX)) if (!world.forming) this.request(world, SMALL)
  }
  /** Ask for a map. `first` jumps the queue: the world being flown to. */
  private request(world: GalaxyWorld, size: readonly [number, number], first = false): void {
    const key = this.mapKey(world, size)
    if (this.maps.has(key) || this.queue.some(job => job.key === key)) return
    const job = { key, id: world.recipe ?? world.id, seed: world.seed, width: size[0], height: size[1] }
    if (first) this.queue.unshift(job); else this.queue.push(job)
    this.next()
  }
  private next(): void {
    if (this.painting || typeof Worker !== 'function') return
    const job = this.queue.shift()
    if (!job) { this.worker?.terminate(); this.worker = null; return }
    try {
      if (!this.worker) {
        const worker = this.worker = new Worker(new URL('../planets/planetMapWorker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = event => { const { key, data, width, height } = event.data; this.maps.set(key, { data, width, height }); this.painting = false; this.wake = 2; this.next() }
        worker.onerror = () => { worker.terminate(); this.worker = null; this.painting = false; this.queue.length = 0 }
      }
      this.painting = true; this.worker.postMessage(job)
    } catch { this.worker = null; this.painting = false }
  }
  /** Upload what has been painted: small maps into their layers, the chosen world's close map. */
  private upload(gl: WebGL2RenderingContext): void {
    const worlds = this.options.worlds
    for (const [i, world] of worlds.slice(0, MAX).entries()) {
      const key = this.mapKey(world, SMALL), map = this.maps.get(key)
      if (!map || this.layers[i] === key || map.width !== SMALL[0] || map.height !== SMALL[1]) continue
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.array)
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, SMALL[0], SMALL[1], 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(map.data.buffer, map.data.byteOffset, map.data.byteLength))
      this.layers[i] = key
    }
    const world = this.chosen >= 0 ? worlds[this.chosen] : undefined
    const key = world && !world.forming ? this.mapKey(world, CLOSE) : undefined, map = key ? this.maps.get(key) : undefined
    if (map && key !== this.closeKey) {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.close)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, map.width, map.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(map.data.buffer, map.data.byteOffset, map.data.byteLength))
      this.closeKey = key
      // Keep the CPU copies of close maps few: the newest two.
      const closes = [...this.maps.keys()].filter(k => k.endsWith(`:${CLOSE[0]}`) && k !== key)
      for (const old of closes.slice(0, Math.max(0, closes.length - 1))) this.maps.delete(old)
    }
    this.closeIndex = map && key === this.closeKey ? this.chosen : -1
  }
  private resize(): void {
    if (!this.gl) return
    // The ladder's render scale: whole steps, applied with the redraw so no blank frame shows.
    const scale = Math.min(devicePixelRatio || 1, 1.5) * qualityScale()
    this.shownScale = qualityScale(); this.wake = 2
    this.canvas.width = Math.max(1, Math.round(this.host.clientWidth * scale)); this.canvas.height = Math.max(1, Math.round(this.host.clientHeight * scale))
  }
  /**
   * Where the worlds are now: slow circular orbits, each at its own pace. There are at most
   * four orbits, at the original spacing; with more than four worlds they share them, spread
   * evenly round each one and moving together, so ten worlds keep the size four had and the
   * system still fits a phone held upright.
   */
  private places(time: number): { position: Vec; radius: number }[] {
    const count = Math.min(MAX, this.options.worlds.length), rings = Math.min(RINGS, count)
    return this.options.worlds.slice(0, MAX).map((_, i) => {
      const ring = i % rings, slot = Math.floor(i / rings), sharing = Math.ceil((count - ring) / rings)
      const orbit = 2.9 + ring * 1.45, angle = 0.9 + ring * 1.9 + slot * Math.PI * 2 / sharing + time * 0.045 / Math.sqrt(orbit / 2.9)
      return { position: [Math.cos(angle) * orbit, 0, Math.sin(angle) * orbit] as Vec, radius: 0.7 + (i % 2) * 0.12 }
    })
  }
  private camera(places: { position: Vec; radius: number }[]) {
    // Ease toward the chosen world; arriving is the camera settling close above it.
    const goal: Vec = this.chosen >= 0 ? places[this.chosen].position : [0, 0, 0]
    const ease = this.chosen >= 0 ? 0.08 : 0.06
    this.target = [mix(this.target[0], goal[0], ease), mix(this.target[1], goal[1], ease), mix(this.target[2], goal[2], ease)]
    const wantDistance = this.chosen >= 0 ? places[this.chosen].radius * (this.diving ? 1.12 : 3.1) : this.distance
    this.reach = mix(this.reach, wantDistance, this.diving ? 0.075 : this.chosen >= 0 ? 0.05 : 0.12)
    // Close enough that a held-still view can stop drawing; it snaps the last step so the
    // frame left on screen is where the camera was going.
    this.settled = Math.abs(this.reach - wantDistance) < 0.01 * wantDistance && Math.hypot(...sub(this.target, goal)) < 0.01 * wantDistance
    if (this.settled && this.holding) { this.target = goal; this.reach = wantDistance }
    // The dive runs about a second and a half.
    this.dive = this.diving ? Math.min(1, this.dive + 0.022) : Math.max(0, this.dive - 0.05)
    const cp = Math.cos(this.pitch), eye: Vec = [this.target[0] + Math.sin(this.yaw) * cp * this.reach, this.target[1] + Math.sin(this.pitch) * this.reach, this.target[2] + Math.cos(this.yaw) * cp * this.reach]
    const forward = unit(sub(this.target, eye)), right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward)
    return { eye, forward, right, up, // The short side of the screen always spans the same slice of space, so the system fills
    // a phone held upright as well as it fills a wide monitor.
    tan: 0.62 }
  }
  private reach = 13
  private loop = (now: number): void => {
    if (!this.active || document.hidden) return
    this.frame = requestAnimationFrame(this.loop)
    qualityFrame(now)
    if (now - this.last < 33) return
    this.last = now
    const gl = this.gl, u = this.uniforms
    if (!gl) return
    if (this.shownScale !== qualityScale()) this.resize()
    const still = Boolean(this.options.still?.()) || this.reduced.matches, wall = performance.now()
    if (!still) this.clock += Math.min(0.25, (wall - this.lastClock) / 1000)
    this.lastClock = wall
    const time = this.clock; this.holding = still
    // The view keeps a little of the last drag's swing, and drifts very slowly when left alone.
    if (!this.drag) { this.yaw += this.spinVelocity; this.spinVelocity *= 0.93; if (Math.abs(this.spinVelocity) < 1e-5) this.spinVelocity = 0; if (this.chosen < 0 && !still) this.yaw += 0.0006 }
    const places = this.places(time), view = this.camera(places), worlds = this.options.worlds
    // Held still, draw only while something is moving; the last frame stays on the canvas.
    const moving = this.drag !== null || this.pointers.size > 0 || this.spinVelocity !== 0 || this.diving || this.dive > 0 || (this.chosen >= 0 && !this.arrived) || !this.settled
    if (still && !moving && this.wake <= 0) { this.idle++; return }
    this.wake = Math.max(0, this.wake - 1)
    this.upload(gl); gl.uniform1i(u.uCloseIndex, this.closeIndex)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.uniform2f(u.uSize, this.canvas.width, this.canvas.height); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uScale, this.canvas.width / Math.max(1, this.host.clientWidth))
    gl.uniform3f(u.uEye, ...view.eye); gl.uniform3f(u.uRight, ...view.right); gl.uniform3f(u.uUp, ...view.up); gl.uniform3f(u.uForward, ...view.forward); gl.uniform1f(u.uTan, view.tan)
    gl.uniform2f(u.uShed, qualityShed(2), qualityShed(3)); gl.uniform1f(u.uAmbience, 1 - qualityShed(1)); gl.uniform1f(u.uDive, this.dive)
    gl.uniform1i(u.uCount, Math.min(MAX, worlds.length))
    gl.uniform4fv(u.uWorld, places.flatMap(p => [...p.position, p.radius]))
    gl.uniform3fv(u.uLand, worlds.slice(0, MAX).flatMap(w => rgb(w.land))); gl.uniform3fv(u.uSea, worlds.slice(0, MAX).flatMap(w => rgb(w.sea)))
    gl.uniform4fv(u.uKind, worlds.slice(0, MAX).flatMap((w, i) => [w.forming ? 2 : w.glow ? 1 : 0, this.layers[i] || i === this.closeIndex ? 1 : 0, time * 0.05 + i * 2.1, (w.seed % 97) + i * 3.1]))
    gl.drawArrays(gl.TRIANGLES, 0, 3); this.frames++
    // Tell the labels where the worlds are, and notice arrival.
    const width = this.host.clientWidth, height = this.host.clientHeight, short = Math.min(width, height)
    this.screen = places.map((place, i) => {
      const d = sub(place.position, view.eye), z = dot(d, view.forward)
      return { id: worlds[i].id, x: width / 2 + (dot(d, view.right) / (Math.max(z, 0.001) * view.tan)) * short / 2, y: height / 2 - (dot(d, view.up) / (Math.max(z, 0.001) * view.tan)) * short / 2, radius: (place.radius / (Math.max(z, 0.001) * view.tan)) * short / 2, visible: z > 0 }
    })
    this.options.onLayout?.(this.screen, this.chosen >= 0 ? worlds[this.chosen].id : undefined)
    if (this.chosen >= 0 && !this.arrived && ++this.arriving > 45) { this.arrived = true; this.options.onArrive(worlds[this.chosen].id) }
  }
  private screen: { id: string; x: number; y: number; radius: number; visible: boolean }[] = []
  /** Fly to a world, as a tap on it does. */
  choose(id: string): void {
    this.wake = 2; const index = this.options.worlds.findIndex(world => world.id === id)
    if (index < 0 || index >= MAX) return
    // Without a context there is no flight to wait for: arrive at once.
    if (!this.gl) { this.options.onArrive(id); return }
    this.chosen = index; this.arriving = 0; this.arrived = false
    // Its full-size map, ahead of anything else waiting, for the close view and the dive.
    const world = this.options.worlds[index]
    if (!world.forming) this.request(world, CLOSE, true)
  }
  private down(event: PointerEvent): void {
    this.canvas.setPointerCapture(event.pointerId); this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (this.pointers.size === 1) { this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; this.spinVelocity = 0 }
    else if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = Math.hypot(a.x - b.x, a.y - b.y); this.drag = null }
  }
  private move(event: PointerEvent): void {
    const point = this.pointers.get(event.pointerId); if (!point) return
    this.wake = 2
    const dx = event.clientX - point.x, dy = event.clientY - point.y; point.x = event.clientX; point.y = event.clientY
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()], gap = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.pinch > 0 && this.chosen < 0) this.distance = Math.min(26, Math.max(6, this.distance * this.pinch / Math.max(1, gap)))
      this.pinch = gap; return
    }
    if (!this.drag || this.drag.id !== event.pointerId) return
    if (Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) > 7) this.drag.moved = true
    if (!this.drag.moved) return
    this.yaw -= dx * 0.006; this.spinVelocity = -dx * 0.006 * 0.6
    this.pitch = Math.min(1.25, Math.max(-0.2, this.pitch + dy * 0.005))
  }
  private up(event: PointerEvent, tap: boolean): void {
    this.pointers.delete(event.pointerId)
    const drag = this.drag; if (!drag || drag.id !== event.pointerId) return
    this.drag = null
    if (drag.moved || !tap) return
    // A tap: the nearest world under the finger, with a generous margin on small screens.
    const box = this.canvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top
    const found = this.screen.filter(s => s.visible).map(s => ({ s, d: Math.hypot(s.x - x, s.y - y) - s.radius })).filter(e => e.d < 22).sort((a, b) => a.d - b.d)[0]
    if (found) this.choose(found.s.id); else if (this.chosen >= 0) this.home()
  }
  dispose(): void { this.active = false; this.abort.abort(); this.resizeObserver.disconnect(); this.release() }
}
