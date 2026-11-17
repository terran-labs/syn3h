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
import { PresenceFeed, type Populations } from './presence'
import { FIELD_UNIT, LogoRenderer, type PixelRect } from '../brand/logoRenderer'
import { logoBudget, STILL_SECONDS } from '../brand/LogoMark'
import { placementOf, placeWordmark, poseView, surfacePoint, WordmarkRig, WORDMARK_SCENE_GLSL, wordmarkCrispPass, wordmarkPlacement } from '../brand/wordmarkScene'
import { ASPECT } from '../brand/wordmarkMesh'
import { WordmarkOverlay } from '../brand/wordmarkOverlay'
import { startupTiming } from '../../core/diagnostics'
/** Why the lobby showed the flat wordmark instead of the name in the scene, once, for the diagnostics. */
function noteWordmarkFallback(reason: string): void { if (!startupTiming.wordmarkFallback) { startupTiming.wordmarkFallback = reason; console.info(`Syn3h: flat lobby wordmark: ${reason}`) } }
import { GLOW_GLSL, glowColour, GlowState, glowTarget, hoverGlowIntensity, hoverGlowSpeed } from './hoverGlow'
import { IdlePulse, idleAfter, idlePeak } from './idlePulse'
import { introMode, LEAVING_SECONDS, leavingMark, openingPace, openingState, RETURN_SECONDS, returningMark, SETTLED, type OpeningMode, type OpeningState } from './opening'
/** The opening plays once per page load: returning from a world goes straight to the lobby. */
let openingPlayed = false
import { WordmarkCrisp } from '../brand/wordmarkCrisp'
import type { ParamValue } from '../../../shared/params'
import { ORDINARY_BODY, planetById, type PlanetBody } from '../../world/planets'
import { lobbyLook, type LobbyLook } from '../../world/lobbyLook'
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
  /** Its name setting (world.nameSeed): what its label calls it, and what picking it keeps. */
  nameSeed?: number
  /** A world still forming: molten, its crust shifting. It has no map. The custom planet. */
  forming?: boolean
  /** The planet recipe its map is painted from, when that is not its id. */
  recipe?: string
  /** Sanitized registry snapshot for the live Custom map. */
  overrides?: Record<string, ParamValue>
  mapVariant?: string
}
export interface GalaxyOptions {
  worlds: readonly GalaxyWorld[]
  /** A world was tapped and the camera has arrived at it. */
  onArrive(id: string): void
  /** A world was tapped. Return true to take it from here (a drop); otherwise the camera flies to it. */
  onTap?(id: string): boolean
  /** Called every frame with where each world is on screen, for labels. depth is the distance along the view: smaller is nearer. */
  onLayout?(places: readonly { id: string; x: number; y: number; radius: number; visible: boolean; depth: number; /** False while the opening has not yet brought its label in. */ labelled?: boolean }[], chosen?: string): void
  /**
   * Asked each frame. True holds the system still: the worlds stop in their orbits and a frame
   * is drawn only while something moves (a drag, a flight, a dive). For the lowest graphics
   * level, so weak devices keep the galaxy at almost no cost. Reduced motion does the same.
   */
  still?(): boolean
  /** Where to centre the system and how large, as [x from left, y from bottom, scale], in
   *  fractions of the host. Asked each frame; undefined keeps the default framing. */
  frame?(): readonly [number, number, number] | undefined
  /**
   * The world under a hovering pointer or a finger held down, or undefined when there is none:
   * its label shows while it is pointed at, even where the layout had to fade it.
   */
  onPoint?(id: string | undefined): void
  /** Each frame drawn: every world's resting pulse, 0 to idlePeak, in the order the worlds came (idlePulse.ts). */
  onRest?(pulses: readonly number[]): void
  /** Focus the label selected with a controller, so its normal activation stays accessible. */
  onFocus?(id: string): void
  /** Logo box in CSS pixels relative to this host, plus the existing graphics tier. */
  logo?(): { box: PixelRect; level: number } | undefined
  onLogo?(drawn: boolean): void
  /**
   * CSS pixels to keep clear at the top of the galaxy, asked each frame (the lobby's update
   * banner sits there). The worlds shift down and shrink to leave that band, keeping their
   * bottom edge where it was; 0 restores the usual framing. At most 30% of the height.
   */
  topInset?(): number
  onPresence?(values: Populations): void
  presenceVisible?(): boolean
}
/**
 * The most worlds the galaxy draws, the sun aside. The trace costs little per world (a ray
 * against a sphere, a shadow cut through the shafts); the limit is the screen and the maps.
 */
export const GALAXY_MAX = 12
/** The rest pulses' seed: the same breathing every visit, so checks can reproduce it. */
const REST_SEED = 20261116
const MAX = GALAXY_MAX
/** Each world's axis leans this far. */
const TILT = 0.38
/** How far the view can tilt: a little under the orbital plane, most of the way over the top. */
const PITCH_LOW = -0.2, PITCH_HIGH = 1.25
/**
 * The system's scale. An ordinary planet's radius; the innermost orbit; the clear space kept
 * between the surfaces of worlds on neighbouring orbits; the innermost world's turn per second.
 */
const PLANET = 0.5, INNER = 1.4, CLEAR = 0.08, RATE = 0.07
/** The view's half angle on the short side of the screen, as a tangent. */
const VIEW_TAN = 0.62
/**
 * A world's radius in the lobby from its size. Slightly compressed, so the ratios read true
 * (a moon is plainly a moon) while the smallest world is still something to tap on a phone.
 */
export const worldRadius = (size: number) => PLANET * Math.pow(Math.min(1.6, Math.max(0.3, size)), 0.85)
export interface OrbitPlace {
  position: [number, number, number]; radius: number
  /** Distance from the sun along the orbit's long axis (its semi-major axis); a moon's is its planet's. */
  orbit: number
  /** The farthest the world goes from the sun, its moon's swing included. */
  reach: number
  /** A moon's planet, as an index into the bodies; absent for a planet. */
  parent?: number
  /**
   * The orbit's path, for drawing it: the normal of its plane, the direction of its nearest
   * point to the sun (in that plane) and its eccentricity. Absent for a moon.
   */
  path?: { normal: [number, number, number]; nearest: [number, number, number]; eccentricity: number }
}
/** A body to lay out: a recipe's, with its id so a moon can find its planet. */
export type OrbitBody = PlanetBody & { id?: string }
/**
 * Each lane's tilt and shape, the same every time: inclinations of 1.5 to 4 degrees with the
 * line where the orbit crosses the system's plane turned a golden angle on per lane, and
 * eccentricities of 0.02 to 0.05. Small, so the system still reads as one disc from the
 * resting view, the labels and the camera behave, and nothing hides below the plane.
 */
export function orbitShape(lane: number): { inclination: number; node: number; eccentricity: number; perihelion: number } {
  const frac = (v: number) => v - Math.floor(v)
  return {
    inclination: (1.5 + 2.5 * frac(lane * 0.618034 + 0.31)) * Math.PI / 180,
    node: frac(lane * 0.381966 + 0.13) * Math.PI * 2,
    eccentricity: 0.02 + 0.03 * frac(lane * 0.7548777 + 0.57),
    perihelion: frac(lane * 0.5698403 + 0.21) * Math.PI * 2,
  }
}
/** v turned by angle a about the unit axis k (Rodrigues). */
function turnAbout(v: Vec, k: Vec, a: number): Vec {
  const c = Math.cos(a), s = Math.sin(a), d = (1 - c) * dot(k, v), x = cross(k, v)
  return [v[0] * c + x[0] * s + k[0] * d, v[1] * c + x[1] * s + k[1] * d, v[2] * c + x[2] * s + k[2] * d]
}
/** How far a moon circles from its planet's centre: both radii and a gap that reads at a glance. */
const moonDistance = (planet: number, moon: number) => planet + moon + Math.max(0.16, planet * 0.4)
/**
 * Where the worlds are at a time. Every planet has an orbit of its own round the sun, ordered
 * by heat, the hottest world nearest the sun and the frozen ones farthest out. A moon (a body
 * with a parent among the bodies) circles its planet instead, faster, on a tilted path of its
 * own, and its planet's lane is widened to hold it.
 *
 * Orbits are slightly tilted and slightly oval (see orbitShape). Each lane's nearest point to
 * the sun lies beyond the last lane's farthest by both worlds' reaches and a clear space. No
 * world is ever nearer the sun than its own lane's nearest point or farther than its farthest,
 * so two worlds on different lanes can never touch, whatever their tilts and wherever they
 * are in their years: it holds by construction, not by timing.
 *
 * The years are Kepler's: a world's turn per second falls as its orbit to the power 3/2, so
 * the inner worlds visibly overtake the outer ones. Each starts a golden angle on from the
 * last, which never lines the system up. Places are returned in the order the bodies came.
 */
export function orbitLayout(bodies: readonly OrbitBody[], time: number): OrbitPlace[] {
  const count = Math.min(MAX, bodies.length), places: OrbitPlace[] = new Array(count)
  const parentOf = (i: number) => {
    const id = bodies[i].parent
    const p = id === undefined ? -1 : bodies.findIndex((b, j) => j < count && j !== i && b.id === id && b.parent === undefined)
    return p < 0 ? undefined : p
  }
  const moons = new Map<number, number[]>()
  for (let i = 0; i < count; i++) { const p = parentOf(i); if (p !== undefined) moons.set(p, [...(moons.get(p) ?? []), i]) }
  const isMoon = (i: number) => parentOf(i) !== undefined
  const order = Array.from({ length: count }, (_, i) => i).filter(i => !isMoon(i)).sort((a, b) => bodies[b].heat - bodies[a].heat || a - b)
  // A planet's reach: its own radius, or its farthest moon's swing round it.
  const span = (i: number) => {
    const radius = worldRadius(bodies[i].size)
    return Math.max(radius, ...(moons.get(i) ?? []).map((m, k) => moonDistance(radius, worldRadius(bodies[m].size)) + k * 0.6 + worldRadius(bodies[m].size)))
  }
  let far = 0, lastSpan = 0
  order.forEach((index, lane) => {
    const radius = worldRadius(bodies[index].size), reach = span(index), shape = orbitShape(lane), e = shape.eccentricity
    // The innermost lane's nearest point is INNER; each next one starts beyond the last one's farthest.
    const orbit = lane === 0 ? INNER / (1 - e) : (far + lastSpan + reach + CLEAR) / (1 - e)
    far = orbit * (1 + e); lastSpan = reach
    // The orbit's plane: the flat plane turned about the line of nodes by the inclination.
    const node: Vec = [Math.cos(shape.node), 0, Math.sin(shape.node)]
    const mean = 0.9 + lane * 2.399963 + time * RATE * Math.pow(INNER / orbit, 1.5)
    // The angle from the nearest point, and the distance there: an ellipse with the sun at a focus.
    const along = mean - shape.perihelion, r = orbit * (1 - e * e) / (1 + e * Math.cos(along))
    const flat: Vec = [Math.cos(mean) * r, 0, Math.sin(mean) * r]
    const position = turnAbout(flat, node, shape.inclination)
    const nearest = turnAbout([Math.cos(shape.perihelion), 0, Math.sin(shape.perihelion)], node, shape.inclination)
    places[index] = { position, radius, orbit, reach: far + reach, path: { normal: turnAbout([0, 1, 0], node, shape.inclination), nearest, eccentricity: e } }
    for (const [k, moon] of (moons.get(index) ?? []).entries()) {
      const mr = worldRadius(bodies[moon].size), d = moonDistance(radius, mr) + k * 0.6
      // A moon's month: quick enough to watch it go round, slow enough to stay calm.
      const turn = 0.6 + k * 1.9 + time * RATE * 4.5, tilt = (8 + k * 5) * Math.PI / 180
      const offset = turnAbout([Math.cos(turn) * d, 0, Math.sin(turn) * d], [Math.cos(shape.node + 1), 0, Math.sin(shape.node + 1)], tilt)
      places[moon] = { position: [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]], radius: mr, orbit, reach: far + reach, parent: index }
    }
  })
  return places
}
/** The camera distance at which the whole system fits the short side of the screen, with a margin. */
export function fitDistance(bodies: readonly OrbitBody[]): number {
  return Math.max(...orbitLayout(bodies, 0).map(place => place.reach), INNER) * 1.08 / VIEW_TAN
}
/** Portrait phones start closer so the planets read; a pinch can reveal the outer orbits. */
export function openingDistance(bodies: readonly OrbitBody[], width: number, height: number): number {
  const portraitPhone = width > 0 && width <= 600 && height > width * 1.2
  // Short landscape screens are framed by the Shell (galaxyFrame: the space left of the button
  // column), so they keep the fitted distance here.
  return fitDistance(bodies) * (portraitPhone ? 0.8 : 1)
}
/** The body a galaxy world is laid out as: its recipe's, or an ordinary planet's. */
export function bodyOf(world: GalaxyWorld): OrbitBody {
  // A world still forming is molten: it belongs close in, among the hot worlds.
  if (world.forming) return { size: 1, heat: 0.95 }
  const recipe = world.recipe ?? world.id.split('~')[0]
  // A rehearsal copy ("alpine~1") is its own body: its moon stays with the real planet.
  return { ...(planetById(recipe)?.body ?? ORDINARY_BODY), id: world.id }
}
/**
 * The world a tap at (x, y) means. On a disc, the nearest disc there: the one that is seen,
 * since a tap is a drop and must never land on a world hidden behind it. Just off every disc,
 * a generous margin on small screens picks the closest edge.
 */
export function pickWorld(screen: readonly { id: string; x: number; y: number; radius: number; visible: boolean; depth: number }[], x: number, y: number, margin = 22): string | undefined {
  const shown = screen.filter(s => s.visible).map(s => ({ s, d: Math.hypot(s.x - x, s.y - y) - s.radius }))
  const on = shown.filter(e => e.d < 0).sort((a, b) => a.s.depth - b.s.depth)[0]
  return (on ?? shown.filter(e => e.d < margin).sort((a, b) => a.d - b.d)[0])?.s.id
}
/**
 * The feel of the view under a finger. The finger moves an aim; what is shown follows the aim
 * on a critically damped spring, quick enough to stay under the finger (a frame or two) but
 * weighted. Let go and the aim coasts on, slowing the way a flicked list does on a phone. The
 * view's tilt has soft limits: past them a drag meets rising resistance, as iOS scrolling does
 * at the end of a page, and on release the aim springs back onto the limit without bouncing.
 * Everything is in closed form against real elapsed time: the aim's coast and spring back are
 * exact at any step, the view follows it within two milliradians whether at 30 frames a second or
 * 120, and one long frame after a stall cannot blow up.
 */
export const SWING = {
  /** How tightly the view follows the aim, radians per second: critically damped. */
  follow: 45,
  /** How fast a tilt past its limit springs back. */
  back: 11,
  /** Seconds for a coast to slow by e, about iOS's normal deceleration. */
  coast: 0.45,
  /** Most a tilt can be pulled past its limit (10 degrees), and iOS's resistance. */
  stretch: 10 * Math.PI / 180, resistance: 0.55,
  /** Below these the motion is over, and the lobby may go idle again. */
  rest: 1e-4, still: 1e-3,
} as const
/**
 * One step of a critically damped spring toward a target that starts at `target` and moves
 * at `speed` through the step. Exact for any dt, so a view following a coasting aim lags it
 * the same at 30 frames a second as at 120. Following a steady target it trails by 2 speed / omega.
 */
export function springStep(x: number, v: number, target: number, omega: number, dt: number, speed = 0): [number, number] {
  const trail = -2 * speed / omega, offset = x - target - trail, fade = Math.exp(-omega * dt), lead = v - speed + omega * offset
  return [target + speed * dt + trail + (offset + lead * dt) * fade, speed + (v - speed - omega * lead * dt) * fade]
}
/** How far past a limit a pull of `over` shows: iOS's rubber band, rising toward but never reaching `most`. */
export function rubberBand(over: number, most = SWING.stretch, resistance = SWING.resistance): number {
  return Math.sign(over) * (1 - 1 / (Math.abs(over) * resistance / most + 1)) * most
}
/** The pull that shows as `shown` past the limit: the band's inverse, for picking up a stretched view. */
export function rubberPull(shown: number, most = SWING.stretch, resistance = SWING.resistance): number {
  const t = Math.min(Math.abs(shown) / most, 0.999)
  return Math.sign(shown) * (most / resistance) * (1 / (1 - t) - 1)
}
/** A finger's position on an axis with soft limits: inside them as it is, past them stretched. */
export function softLimit(pull: number, low: number, high: number): number {
  return pull > high ? high + rubberBand(pull - high) : pull < low ? low + rubberBand(pull - low) : pull
}
/**
 * One axis of the view: aim and shown position, each with a velocity. While held, the finger
 * sets the aim and its speed; let go, the aim coasts, or springs back onto a limit it is past.
 */
export interface SwingAxis { aim: number; aimSpeed: number; view: number; viewSpeed: number }
export function swingStep(axis: SwingAxis, dt: number, held: boolean, low = -Infinity, high = Infinity): SwingAxis {
  let { aim, aimSpeed, view, viewSpeed } = axis
  const from = aim
  if (!held) {
    const limit = aim > high ? high : aim < low ? low : null
    if (limit !== null) {
      // Past a limit: back onto it. Critically damped, so it eases in and never crosses.
      ;[aim, aimSpeed] = springStep(aim, aimSpeed, limit, SWING.back, dt)
      if ((aim - limit) * (axis.aim - limit) <= 0 || (Math.abs(aim - limit) < SWING.rest && Math.abs(aimSpeed) < SWING.still)) { aim = limit; aimSpeed = 0 }
    } else if (aimSpeed !== 0) {
      // Coasting, slowing smoothly.
      const fade = Math.exp(-dt / SWING.coast), travel = aimSpeed * SWING.coast * (1 - fade), edge = aimSpeed > 0 ? high : low
      if ((aim + travel - edge) * Math.sign(aimSpeed) > 0) {
        // It reaches a limit within this step. Coast exactly to it, then let the spring back
        // take the rest of the step, keeping only the speed the spring can turn within the
        // stretch (it peaks at speed / (back e)). Solved at the crossing, not at the step's
        // end, so the stretch is the same at any frame rate.
        const into = -SWING.coast * Math.log(1 - (edge - aim) / (aimSpeed * SWING.coast)), most = SWING.stretch * SWING.back * Math.E
        const speed = Math.max(-most, Math.min(most, aimSpeed * Math.exp(-into / SWING.coast)))
        ;[aim, aimSpeed] = springStep(edge, speed, edge, SWING.back, dt - into)
      } else { aim += travel; aimSpeed *= fade }
      if (Math.abs(aimSpeed) < SWING.still && aim <= high && aim >= low) aimSpeed = 0
    }
  }
  // The view chases the aim as it moved through this step, not where it ended.
  ;[view, viewSpeed] = springStep(view, viewSpeed, from, SWING.follow, dt, dt > 0 ? (aim - from) / dt : 0)
  if (Math.abs(view - aim) < SWING.rest * 0.1 && Math.abs(viewSpeed) < SWING.still) { view = aim; viewSpeed = 0 }
  return { aim, aimSpeed, view, viewSpeed }
}
/**
 * The resting view. Left alone for a few seconds, the view tilts very slowly to look down on
 * the system from a little above its plane, where every orbit reads as an ellipse and no world
 * hides another for long. Any touch, key, wheel or stick ends it at once, from wherever it is.
 */
export const REST = {
  /** Seconds without input before the view starts to settle. */
  after: 4,
  /** The tilt it settles at: about twenty degrees above the orbital plane. */
  pitch: 20 * Math.PI / 180,
  /** Seconds for the remaining tilt to fall by e: slow enough to read as drifting, not moving. */
  ease: 5,
} as const
/** Low-end devices finish the tilt quickly and snap the final quarter degree before idling. */
export const REST_LOW = { ...REST, ease: 0.7, snap: Math.PI / 720 } as const
/**
 * The tilt after dt seconds, given how long the view has been left alone. Before REST.after it
 * is untouched; after, it closes on the resting tilt exponentially (exact at any frame rate)
 * and lands on it exactly, so the lobby can go idle.
 */
export function restStep(pitch: number, idle: number, dt: number, rest: { after: number; pitch: number; ease: number; snap?: number } = REST): number {
  if (idle < rest.after || pitch === rest.pitch) return pitch
  const next = rest.pitch + (pitch - rest.pitch) * Math.exp(-Math.max(0, dt) / rest.ease)
  return Math.abs(next - rest.pitch) < (rest.snap ?? 2e-4) ? rest.pitch : next
}
/** Nothing left moving on this axis. */
export const swingResting = (axis: SwingAxis) => axis.aimSpeed === 0 && axis.viewSpeed === 0 && axis.view === axis.aim
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
uniform vec2 uSize; uniform vec3 uFrame; uniform float uTime; uniform float uScale;
uniform vec2 uShed;                 // quality ladder: x sheds post effects, y shader cost
uniform float uAmbience;            // 1 keeps twinkle and drifting cloud, 0 sheds them
uniform float uDive;                // 0 in orbit, 1 through the atmosphere of the chosen world
uniform float uDim;                 // 1 as the lobby itself; lower behind an open panel
uniform float uMarkCrisp;           // 1 when the wordmark's letters are drawn by its own full-resolution pass
uniform vec4 uReveal;               // the opening (opening.ts): sun, shafts' front, stars, the point's swell
uniform float uOrbit[${MAX}];       // the opening: how much of each world's orbit line is drawn
uniform float uRevealMark;          // the opening: how far the wordmark's reveal has swept from the sun
uniform float uSunPoint;            // the opening: the sun's size as the point of light it starts as
uniform float uArrive[${MAX}];      // the opening: each world's arrival, 0 to 1
uniform vec3 uEye, uRight, uUp, uForward; uniform float uTan;
uniform int uCount; uniform int uOnly;
uniform float uPopulation[${MAX}];
uniform vec4 uWorld[${MAX}];        // xyz position, w radius
uniform vec3 uLand[${MAX}], uSea[${MAX}];
uniform vec4 uKind[${MAX}];         // x glow, y has map, z spin, w seed
uniform vec4 uAir[${MAX}];          // the limb's colour, and how deep the air is (0 none)
uniform vec4 uLook[${MAX}];         // x cloud cover, y ground gloss, z night glow (1 lava, 2 glowcaps), w land share
uniform vec3 uCloud[${MAX}];        // each world's cloud colour
uniform vec4 uPathN[${MAX}];        // each orbit's plane normal, and its long half axis (0: a moon, no line)
uniform vec4 uPathP[${MAX}];        // the direction of its nearest point to the sun, and its eccentricity
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
// The wordmark standing in space, when lobby.wordmark places it there (src/ui/brand/wordmarkScene.ts).
${WORDMARK_SCENE_GLSL}
// The glow round the world under the pointer (hoverGlow.ts).
${GLOW_GLSL}
uniform float uPulse[${MAX}];      // the lobby at rest: each world's breath of its own glow (idlePulse.ts)
uniform vec3 uPulseColour[${MAX}];
void main() {
  float minSide = min(uSize.x, uSize.y);
  vec2 q = (gl_FragCoord.xy - uFrame.xy * uSize) / (minSide * uFrame.z) * 2.0;           // -1..1 on the short side
  vec3 ray = normalize(uForward + (q.x * uRight + q.y * uUp) * uTan);
  // Where this ray meets the wordmark's plane. Its footprint is taken here, in uniform flow.
  vec3 markAt = uMarkMode > 0 ? markSurface(uEye, ray) : vec3(0.0, 0.0, -1.0);
  float markW = wordmarkFootprint(markAt.xy);
  vec3 c = SPACE;
  // Stars, fixed to the sky so they turn as the view does.
  vec3 cell = floor(ray * 420.0);
  float star = step(0.9965, hash(cell)), bright = step(0.99955, hash(floor(ray * 260.0) + 5.0));
  float twinkle = mix(0.8, 0.55 + 0.45 * sin(uTime * 1.3 + hash(cell + 2.0) * 40.0), uAmbience);
  vec3 sky = vec3(0.97, 0.98, 0.99) * (star * 0.5 + bright * 1.2) * twinkle;
  // A faint band of cloud along the orbital plane's far side, for depth.
#ifndef MARK_ONLY
  if (uAmbience > 0.0) sky += vec3(0.02, 0.06, 0.24) * smoothstep(0.38, 0.8, fbm(ray * 2.2 + 7.0)) * 0.5 * uAmbience;
#endif

  // The nearest world along this ray.
  // Where this ray meets the orbital plane, for the faint trace of each orbit. One line a
  // pixel wide however far off; it fades toward the horizon, where a pixel spans many orbits.
  float planeT = -uEye.y / (abs(ray.y) > 1e-4 ? ray.y : 1e-4), planeR = length((uEye + ray * planeT).xz), planeW = fwidth(planeR), trace = 0.0;
  // The opening draws the orbit lines round from the far side, both ways at once.
  vec3 planeAt = uEye + ray * planeT;
  float around = abs(mod(atan(planeAt.z, planeAt.x) - atan(-uEye.z, -uEye.x) + 3.14159265, 6.2831853) - 3.14159265) / 3.14159265;
  // (Each world's orbit line is drawn round from the far side, ahead of its world: uOrbit.)
  float nearest = 1e9; int found = -1; vec3 normal = vec3(0.0); float halo = 0.0; vec3 haloTint = vec3(0.0); float haloNear = 1e9; vec3 haloFront = vec3(0.0);
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount) break;
    if (uOnly >= 0 && i != uOnly) continue;
    vec3 oc = uEye - uWorld[i].xyz; float r = uWorld[i].w;
    if (uPathN[i].w > 0.0) {
      float pt = -dot(uEye, uPathN[i].xyz) / dot(ray, uPathN[i].xyz); vec3 pp = uEye + ray * pt; float pr = length(pp), e = uPathP[i].w;
      // The opening draws each orbit line round from the far side, ahead of its world (uOrbit).
      float roundFar = abs(mod(atan(pp.z, pp.x) - atan(-uEye.z, -uEye.x) + 3.14159265, 6.2831853) - 3.14159265) / 3.14159265;
      trace += step(0.0, pt) * (1.0 - smoothstep(0.0, fwidth(pr) * 1.5 + 1e-5, abs(pr - uPathN[i].w * (1.0 - e * e) / (1.0 + e * dot(pp / max(pr, 1e-5), uPathP[i].xyz)))))   // this orbit's own tilted, oval path
        * (1.0 - smoothstep(uOrbit[i] * 1.06 - 0.06, uOrbit[i] * 1.06, roundFar));
    }
    float b = dot(oc, ray), cc = dot(oc, oc) - r * r, disc = b * b - cc;
    if (disc > 0.0) { float t = -b - sqrt(disc); if (t > 0.0 && t < nearest) { nearest = t; found = i; normal = normalize(oc + ray * t); } }
    else if (b < 0.0) {
      // Just outside the limb: a thin shell of air, brighter toward the sun.
      float miss = sqrt(max(0.0, cc + r * r - b * b)) - r;          // how far the ray passes outside the limb
      vec3 air = uAir[i].rgb;
      float toward = 0.3 + 0.7 * clamp(dot(normalize(-uWorld[i].xyz), normalize(oc + ray * (-b))) * 0.5 + 0.5, 0.0, 1.0);
      // Tint and strength add up, so where two halos overlap the colour blends, not switches.
      float h = pow(clamp(1.0 - miss / (r * 0.14 * sqrt(uAir[i].w) + 1e-5), 0.0, 1.0), 2.5) * toward * 0.6 * min(uAir[i].w, 1.2); halo += h; haloTint += air * h;
      // The nearest halo on this ray is kept apart: it also shows over a world farther off.
      if (h > 0.0 && -b < haloNear) { haloNear = -b; haloFront = air * h; }
    }
  }
  // The sun at the centre, as a light in the sky: core, bloom and haze by angle from it.
  vec3 sunP = toScreen(vec3(0.0));
  vec2 toSun = q * 0.5 - sunP.xy * 0.5;
  float sunDistance = sunP.z > 0.0 ? length(toSun) : 9.0;
  vec2 sunDirection = toSun / max(length(toSun), 0.00001);
  // The opening (opening.ts): the sun grows from a point, flaring a little past itself.
  // As a point it matches the loading veil's point of light (index.html), in pixels.
  // Before ignition it gathers: swelling to twice its size and brightening (uReveal.w).
  float sunGrown = clamp(uReveal.x, 0.0, 1.0), sunSize = mix(uSunPoint * (1.0 + 1.1 * uReveal.w), 1.0, sunGrown), sunFlare = max(1.0, uReveal.x) * (1.0 + 0.7 * uReveal.w * (1.0 - sunGrown));
  vec3 sunLight = vec3(1.0, 0.98, 0.94) * exp(-sunDistance * 42.0 / sunSize) * 2.4 * sunFlare;
  sunLight += mix(WARM, vec3(1.0, 0.8, 0.55), 0.5) * exp(-sunDistance * 11.0 / sunSize) * 0.8 * sunGrown * sunFlare;
  // The wide haze and the shafts are kept apart from the sun itself: a world beyond the sun
  // still has the sun in front of it, but must not have the whole glow painted over it.
  vec3 sunHaze = mix(WARM, ACCENT_B, 0.35) * exp(-sunDistance * 2.8) * 0.22 * sunGrown;
  float shafts =
    pow(noise(vec3(sunDirection * 2.4, uTime * 0.09)), 2.0) * 0.9 +
    pow(noise(vec3(sunDirection * 6.5 + 3.0, uTime * 0.15)), 3.0) * 0.8 +
    pow(noise(vec3(sunDirection * 17.0 + 9.0, uTime * 0.24)), 4.0) * 0.6;
  float reach = exp(-sunDistance * 1.7) * smoothstep(0.015, 0.14, sunDistance) * sunFlare;
  // The shafts burst outward from the sun as the opening's front passes.
  reach *= 1.0 - smoothstep(uReveal.y - 0.35, uReveal.y, sunDistance);
  // Each world stands in the light: behind it, as seen from the sun, the shafts are cut.
  // Every edge of the cut is a ramp, never a switch: it starts across the world's limb along
  // the ray, its sides soften with distance, and it fades out as the world slides over the
  // sun, where the direction from the sun to the world means nothing and would flip.
  float shade = 1.0;
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount || uShed.x >= 1.0) break;
    if (uArrive[i] < 0.01) continue;                       // not yet arrived (the opening)
    vec3 w = toScreen(uWorld[i].xyz);
    if (w.z <= 0.0) continue;
    vec2 centre = w.xy * 0.5 - sunP.xy * 0.5;                // from the sun, on screen
    float along = dot(centre, sunDirection), size = uWorld[i].w / (w.z * uTan) * 0.5, past = length(toSun) - along;
    // Most pixels lie where every ramp below is exactly zero: skip them, as cheaply as the old
    // hard gate did, without making an edge (the skipped value is the computed one).
    bool far = dot(centre, centre) >= size * size * 2.56;
    if (far && (along <= 0.0 || past <= -size)) continue;
    // Distance from this pixel's ray (from the sun outward) to the world: the ray starts at
    // the sun, so on the far side of the sun it is the distance to the sun itself.
    float off = length(centre - sunDirection * max(along, 0.0));
    float behind = max(past, 0.0), soft = clamp(behind * 1.5, 0.0, 1.0);
    // The shadow widens a little with distance behind the world, and its sides soften.
    float spread = size * (1.0 + behind * 0.6);
    if (far && off >= spread * mix(1.25, 1.7, soft)) continue;
    float cut = (1.0 - smoothstep(spread * mix(0.7, 0.35, soft), spread * mix(1.25, 1.7, soft), off))
      * smoothstep(-size, size, past)                        // in across the limb, not at its centre line
      * smoothstep(0.0, size, along);                         // only on the world's side of the sun
    // Over the sun the cut gives way to an even dimming of every shaft, for a world in front.
    float clear = smoothstep(size * 0.5, size * 1.6, length(centre));
    cut = mix(0.45 * clamp((sunP.z - w.z) / uWorld[i].w * 0.5 + 0.5, 0.0, 1.0), cut, clear);
    // An arriving world's shadow comes in with it.
    shade *= 1.0 - cut * 0.85 * (1.0 - uShed.x) * smoothstep(0.3, 1.0, uArrive[i]);
  }
  vec3 sunShafts = mix(vec3(1.0, 0.86, 0.66), WARM, 0.3) * shafts * reach * 0.95 * shade;
  // Lens: a horizontal streak and three ghosts toward the centre. Post effects, shed first.
  vec3 flare = vec3(0.55, 0.75, 1.0) * exp(-abs(toSun.y) * 120.0) * exp(-abs(toSun.x) * 2.6) * 0.5;
  vec2 view = q * 0.5, sunView = sunP.xy * 0.5;
  float ghostA = 1.0 - smoothstep(0.035, 0.05, length(view - sunView * 0.45));
  float ghostB = 1.0 - smoothstep(0.012, 0.022, length(view + sunView * 0.25));
  float ghostC = (1.0 - smoothstep(0.07, 0.09, length(view + sunView * 0.8))) * smoothstep(0.045, 0.07, length(view + sunView * 0.8));
  flare += vec3(0.4, 0.7, 1.0) * ghostA * 0.07 + vec3(1.0, 0.6, 0.3) * ghostB * 0.12 + vec3(0.6, 1.0, 0.8) * ghostC * 0.035;
  flare *= (1.0 - uShed.x) * step(0.0, sunP.z) * sunGrown;

  vec3 orbitLines = vec3(0.0);
#ifdef MARK_ONLY
  // The wordmark's own pass (WordmarkCrisp) needs only what crosses the letters.
  if (found < 0 && planeT > 0.01 && uOnly < 0) orbitLines = vec3(0.45, 0.62, 0.9) * min(trace, 1.0) * clamp(1.0 - planeW * 2.5, 0.0, 1.0) * 0.1 * (1.0 - uShed.y) * (1.0 - uDive);
#else
  if (found >= 0) {
    vec3 at = uEye + ray * nearest, centre = uWorld[found].xyz;
    vec3 light = normalize(-centre);                         // the sun is at the origin
    float lit = clamp(dot(normal, light), 0.0, 1.0);
    // Turn the world on its tilted axis.
    float tilt = ${TILT}, ct = cos(tilt), st = sin(tilt); vec3 g = vec3(normal.x, ct * normal.y - st * normal.z, st * normal.y + ct * normal.z);
    float spin = uKind[found].z; g = vec3(cos(spin) * g.x + sin(spin) * g.z, g.y, -sin(spin) * g.x + cos(spin) * g.z);
    vec3 surface; float wet = 0.0; float molten = 0.0; vec4 look = uLook[found], airOf = uAir[found];
    if (uKind[found].x > 1.5) {
      // A world still forming: plates of dark crust drifting on magma, never the same twice.
      float plates = fbm(g * 2.4 + vec3(0.0, uTime * 0.05, uKind[found].w)), cracks = fbm(g * 6.0 + vec3(uTime * 0.11, 0.0, 3.0));
      molten = smoothstep(0.42, 0.6, plates * 0.65 + cracks * 0.5 + 0.08 * sin(uTime * 0.7 + plates * 9.0));
      surface = mix(vec3(0.07, 0.05, 0.06), vec3(1.0, 0.42, 0.08), molten) + vec3(1.0, 0.85, 0.5) * pow(molten, 6.0) * 0.6;
    } else if (uKind[found].y > 0.5) {
      // The painted map: colour, and in alpha how dry the ground is (0 sea, lake or river).
      vec4 m = mapAt(found, vec2(atan(g.x, g.z) / 6.2831853 + 0.5, 0.5 - asin(clamp(g.y, -1.0, 1.0)) / 3.1415927));
      surface = m.rgb; wet = 1.0 - m.a;
      // Close up, ground finer than the map: seeded grain that fades out before it can alias.
      float footprint = length(fwidth(g));
      if (footprint < 0.006) surface *= 1.0 + (fbm(g * 220.0 + uKind[found].w) - 0.5) * 0.22 * (1.0 - smoothstep(0.002, 0.006, footprint)) * (1.0 - wet);
    } else {
      // Until the map is painted: the biome's own palette as a soft ball, its land share true.
      float h = fbm(g * 2.1 + uKind[found].w), detail = fbm(g * 7.0);
      float land = smoothstep(-0.02, 0.02, h + (detail - 0.5) * 0.12 - (0.5 + (0.5 - look.w) * 0.42));
      surface = mix(uSea[found] * (0.85 + 0.3 * detail), uLand[found] * (0.75 + 0.5 * detail), land); wet = 1.0 - land;
    }
    // Weather: cloud only where the world has it, as much as it has, drifting slowly.
    float cover = look.x, cloud = 0.0;
    if (cover > 0.0 && uKind[found].x < 1.5) {
      float f = fbm(g * 3.2 + vec3(uTime * 0.02, 0.0, uTime * 0.013) + 9.0 + uKind[found].w);
      // Thin cloud on a clear world, a mottled, still translucent deck on a murky one.
      cloud = smoothstep(0.66 - cover * 0.32, 0.8 - cover * 0.3, f) * min(0.8, 0.35 + cover * 0.7) * mix(1.0, uAmbience, 0.5);
    }
    // Light. With air the terminator is a soft band; on an airless world it is a hard edge.
    float facing = dot(normal, light), soft = 0.06 * min(airOf.w, 1.5);
    float day = clamp((facing + soft) / (1.0 + soft), 0.0, 1.0);
    day = airOf.w > 0.0 ? pow(day, 0.85) : smoothstep(-0.01, 0.03, facing) * max(facing, 0.0);
    // Glints: water always, glassy or icy ground by its gloss. Lava is too rough to mirror the sun.
    vec3 halfway = normalize(light - ray);
    float shine = wet * (uKind[found].x > 0.5 ? 0.0 : 0.55) + look.y * (1.0 - wet) * 0.8;
    float glint = pow(max(dot(normal, halfway), 0.0), mix(40.0, 140.0, look.y)) * shine * step(0.0, facing);
    // A little fill, so a world seen from its night side is still a world and not a hole.
    vec3 ground = surface * (0.06 + 1.06 * day) + vec3(1.0, 0.96, 0.88) * glint * (1.0 - cloud);
    vec3 world = mix(ground, uCloud[found] * (0.04 + 1.0 * day), cloud);
    // Night side: lava glows through its crust; a wetland's glowcaps make a faint green shimmer.
    float dark = 1.0 - smoothstep(-0.05, 0.25, facing);
    if (look.z > 0.5 && look.z < 1.5) world += surface * wet * (0.35 + 0.55 * dark) * (1.0 - cloud * 0.6);
    if (look.z > 1.5 && uShed.y < 1.0) world += vec3(0.25, 0.9, 0.55) * pow(noise(g * 140.0), 6.0) * (1.0 - wet) * dark * 0.35 * (1.0 - cloud) * (1.0 - uShed.y);
    world += surface * molten * 0.9;                                              // and magma lights itself
    // The air at the limb, its depth and colour the world's own: none at all on an airless one.
    world += airOf.rgb * pow(1.0 - clamp(dot(normal, -ray), 0.0, 1.0), 3.0) * (0.1 + 0.75 * day) * min(airOf.w, 1.3);
    c = world;
    // The air of a nearer world, where its limb crosses this one: not cut off at this disc.
    if (haloNear < nearest) c += haloFront;
    // A world is solid. One in front of the sun hides it, all but a trace. One beyond the sun
    // has the sun and its near glow in front of it, but only a veil of the wide haze and
    // almost none of the shafts: painted on in full, they made a far world look like glass.
    // The change across the sun's depth is a ramp the width of the world, never a switch.
    // Judged at the world's centre, not at each point of its surface: the surface nearest the
    // eye and its limb lie at different depths, and judging each pixel drew the plane at the
    // sun's depth across the sphere as a disc inside it.
    float before = smoothstep(-2.0 * uWorld[found].w, 2.0 * uWorld[found].w, sunP.z - toScreen(uWorld[found].xyz).z);
    sunLight *= mix(1.0, 0.06, before); sunHaze *= mix(0.35, 0.06, before); sunShafts *= mix(0.12, 0.0, before);
  } else {
    c += sky * smoothstep(0.08, 0.5, sunDistance) * uReveal.z + haloTint;
    if (planeT > 0.01 && uOnly < 0) { orbitLines = vec3(0.45, 0.62, 0.9) * min(trace, 1.0) * clamp(1.0 - planeW * 2.5, 0.0, 1.0) * 0.1 * (1.0 - uShed.y) * (1.0 - uDive); c += orbitLines; }
  }
#endif
  vec3 markColour = vec3(0.0); float markCover = 0.0;
  // The wordmark in space: hidden by any world nearer than it, and over everything farther.
  if (uMarkMode > 0 && markAt.z > 0.0) {
    // Where one pixel spans a good part of a letter (toward the horizon of a surface lying in
    // the plane, or across the seam of a curved one) there is nothing legible to draw.
    // The opening reveals the letters as a front sweeping out from the sun.
    float resolved = (1.0 - smoothstep(0.03, 0.12, markW)) * (1.0 - smoothstep(uRevealMark - 0.3, uRevealMark, sunDistance));
    float d = wordmarkDistance(markAt.xy), cover = markAt.z < nearest ? wordmarkCoverage(d, markW) * uMarkOpacity * resolved : 0.0;
    vec3 at = uEye + ray * markAt.z;
    // A quiet cousin of the flat logo's plasma: a warm halo on the plane round the letters,
    // flowing slowly, so the letterforms hold against the sky when the shafts move off them.
    if (markAt.z < nearest && d > 0.0 && d < 0.3 && resolved > 0.0) {
      float flow = 0.6 + 0.4 * noise(vec3(markAt.xy * vec2(2.2, 3.1), uTime * 0.12));
      float halo = exp(-d / 0.06) * (1.0 - smoothstep(0.16, 0.29, d)) * flow * uMarkOpacity * resolved;
      c += mix(mix(vec3(1.0, 0.86, 0.66), WARM, 0.3), vec3(0.56, 0.89, 1.0), 0.15) * halo * (uMarkMode == 2 ? 0.5 : 0.38);
      if (uRevealMark < 50.0) { float k = uRevealMark - 0.1 - sunDistance; c += vec3(1.0, 0.86, 0.66) * halo * 1.6 * (k > 0.0 ? exp(-k / 0.25) : exp(-pow(k / 0.07, 2.0))); }
    }
    if (cover > 0.0) {
      vec3 mark = vec3(0.008, 0.016, 0.039), rimColour = mix(vec3(1.0, 0.86, 0.66), WARM, 0.3);
      float line = 1.0 - wordmarkCoverage(d + max(0.012, 1.5 * markW), markW), lineStrength = 0.85;
      if (uMarkMode != 2) {
        // Behind the sun: its face is lit by it, warmest nearest, and worlds between throw shadows.
        vec3 n = uMarkShape.x < 0.5 ? normalize(cross(uMarkRight, uMarkUp)) : normalize(vec3(at.x, 0.0, at.z));
        n *= -sign(dot(n, ray));
        float far = length(at); vec3 l = -at / far;
        float lit = max(0.0, dot(n, l)) * uMarkSun * uMarkSun / (far * far), shadow = 1.0;
        for (int i = 0; i < ${MAX}; i++) {
          if (i >= uCount) break;
          vec3 oc = uWorld[i].xyz - at; float along = dot(oc, l);
          if (along <= 0.0 || along >= far) continue;
          shadow *= smoothstep(uWorld[i].w * 0.85, uWorld[i].w * 1.25, length(oc - l * along));
        }
        // A dark face with a warm sheen, so the pale edge line carries the name. Lit by the
        // rays (3), the letters are a veil that catches the shafts and haze passing in front.
        if (uMarkMode >= 3) { mark += rimColour * 0.02 + sunShafts * 1.5 + sunHaze * 0.9 + rimColour * 0.12 * lit * shadow; lineStrength = 0.75; }
        else mark += rimColour * (0.025 + 0.22 * lit * shadow);
      } else {
        // In front of the sun: backlit, dark, with a rim of light on the edges facing it.
        vec2 sunAt = markHit(uEye, normalize(-uEye)).xy, toSun = sunAt - markAt.xy;
        float e = 0.004;
        vec2 g = vec2(wordmarkDistance(markAt.xy + vec2(e, 0.0)) - d, wordmarkDistance(markAt.xy + vec2(0.0, e)) - d);
        float facing = max(0.0, dot(g / max(length(g), 1e-6), toSun / max(length(toSun), 1e-6)));
        float rim = (1.0 - smoothstep(0.0, 0.03, -d)) * pow(facing, 2.0) * exp(-length(toSun) * 0.3);
        mark += rimColour * rim * 1.6 + rimColour * 0.03; lineStrength = 0.3;
      }
      mark = mix(mark, vec3(1.0, 0.93, 0.84), line * lineStrength);
      // The opening: the shafts' front lights the letters as it sweeps across them.
      // Each letter kindles as the front reaches it, then settles back to its resting glow.
      if (uRevealMark < 50.0) { float k = uRevealMark - 0.1 - sunDistance; mark += rimColour * 2.4 * (k > 0.0 ? exp(-k / 0.2) : exp(-pow(k / 0.05, 2.0))); }
      // Orbit lines nearer than the letters still cross them.
      if (planeT > 0.0 && planeT < markAt.z - 0.05) mark += orbitLines;
      markColour = mark; markCover = cover;
      // With the crisp pass on, the letters are drawn there, at the screen's full resolution.
      if (uMarkCrisp < 0.5) c = mix(c, mark, cover);
      // In front of the sun the letters hide it, its glow and its shafts. Behind it they are
      // only seen through the shafts, which are thinner over the letters than between them.
      // (With the crisp pass on, its opaque letters do this; dimming here at this pass's coarser
      // coverage would leave a dark fringe outside their edges.)
      float hide = cover * (1.0 - uMarkCrisp);
      if (uMarkMode == 2) { sunLight *= 1.0 - hide; sunHaze *= 1.0 - hide; sunShafts *= 1.0 - hide; flare *= 1.0 - hide; }
      else { sunShafts *= 1.0 - 0.55 * hide; sunHaze *= 1.0 - 0.35 * hide; }
    }
    // In front of the sun the letters also stop the shafts beyond them.
    if (uMarkMode == 2 && uShed.x < 1.0) {
      vec3 sunAt = markHit(uEye, normalize(-uEye));
      if (sunAt.z > 0.0 && sunAt.z < length(uEye)) {
        float cut = markShadow(sunAt.xy, markAt.xy) * uMarkOpacity * (1.0 - uShed.x);
        sunShafts *= 1.0 - 0.92 * cut; sunHaze *= 1.0 - 0.45 * cut; flare *= 1.0 - 0.6 * cut;
      }
    }
  }
  c += sunLight + sunHaze + sunShafts + flare * (found >= 0 ? 0.2 : 1.0);
  // The dive: streaks rushing outward, then the brightness of air as the world fills the view.
  if (uDive > 0.0) {
    float rush = pow(noise(vec3(normalize(q + 0.0001) * 11.0, uTime * 3.2)), 3.0) * smoothstep(0.15, 1.3, length(q));
    // Air, never a flat sheet: the streaks keep rushing through it to the last frame.
    c = mix(c, vec3(0.62, 0.8, 1.0), smoothstep(0.5, 1.0, uDive) * 0.68);
    c += vec3(0.8, 0.92, 1.0) * rush * uDive * 1.3;
  }
  // The glow round the world under the pointer, in focus or pressed: over the shafts, under the grade.
  vec4 glow = planetGlow(ray, nearest, found) * (1.0 - uDive);
  c = mix(c, glow.rgb * 1.25, clamp(glow.a * 0.7, 0.0, 0.85)) + glow.rgb * glow.a * 0.6;
  // The lobby at rest: worlds breathing their own glow, the same effect laid on the same way.
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount) break;
    if (uPulse[i] <= 0.001) continue;
    float a = glowAura(i, ray, nearest, found, 0.0, uGlow.y) * uPulse[i] * uGlow.w * (1.0 - uDive);
    c = mix(c, uPulseColour[i] * 1.25, clamp(a * 0.7, 0.0, 0.85)) + uPulseColour[i] * a * 0.6;
  }
  // Connected humans by recipe: at most twelve lights; the label carries the exact total.
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount) break;
    if (uPopulation[i] <= 0.0 || uOnly >= 0) continue;
    vec3 p = toScreen(uWorld[i].xyz);
    if (p.z <= 0.0 || (found >= 0 && found != i)) continue;
    float ring = uWorld[i].w / (p.z * uTan) * 1.28;
    vec2 d = q - p.xy;
    float count = min(12.0, uPopulation[i]);
    float angle = atan(d.y, d.x) + 3.14159265 - uTime * 0.08;
    float arc = (fract(angle / 6.2831853 * count + 0.5) - 0.5) * 6.2831853 / count * ring;
    float distanceToLight = length(vec2(length(d) - ring, arc));
    float size = 4.0 / (minSide * uFrame.z);
    c += vec3(0.3, 0.85, 1.0) * exp(-distanceToLight * distanceToLight / (size * size)) * (1.0 - uDive);
  }
#ifdef MARK_ONLY
  c = markColour;
#endif
  // Grade: roll the highlights off, a vignette to hold the eye in the middle, fine film grain.
  c = c / (1.0 + 0.3 * max(max(c.r, c.g), c.b));
  vec2 corner = gl_FragCoord.xy / uSize - 0.5;
  c *= 1.0 - dot(corner, corner) * 0.85;
  c += (hash(vec3(gl_FragCoord.xy, floor(uTime * 24.0))) - 0.5) * 0.028 * (1.0 - uShed.x);
  c += (hash(vec3(gl_FragCoord.xy, 7.0)) - 0.5) / 255.0;
#ifdef MARK_ONLY
  color = vec4(c * uDim, 1.0) * markCover;
#else
  color = vec4(c * uDim, 1.0);
#endif
}`
/**
 * Motion blur for the flight and the dive: the traced frame is smeared along the line to the
 * centre of the view, the way a fast zoom smears, in proportion to how fast the camera is
 * closing. Twelve taps, jittered per pixel so the smear has no steps. Off when nothing is
 * moving fast, when the frame is drawn straight to the screen.
 */
const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uScene; uniform float uBlur; uniform vec2 uSize;
out vec4 color;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize, d = (uv - 0.5) * uBlur;
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 c = vec3(0.0);
  for (int i = 0; i < 12; i++) c += texture(uScene, uv - d * ((float(i) + jitter) / 12.0)).rgb;
  color = vec4(c / 12.0, 1.0);
}`
/** Every uniform the galaxy's fragment shader reads, looked up once per context. */
const UNIFORMS = ['uShed', 'uAmbience', 'uDive', 'uDim', 'uFrame', 'uSize', 'uTime', 'uScale', 'uEye', 'uRight', 'uUp', 'uForward', 'uTan', 'uOnly', 'uPopulation', 'uCount', 'uWorld', 'uLand', 'uSea', 'uKind', 'uMaps', 'uClose', 'uCloseIndex', 'uMarkMode', 'uMarkCentre', 'uMarkRight', 'uMarkUp', 'uMarkOpacity', 'uMarkSun', 'uMarkShape', 'uMarkShape2', 'uMarkCrisp', 'uReveal', 'uRevealMark', 'uSunPoint', 'uArrive', 'uGlowIndex', 'uGlow', 'uGlowColour', 'uGlowTime', 'uPulse', 'uPulseColour', 'uOrbit', 'uField', 'uFieldBounds', 'uFieldDecode', 'uAir', 'uLook', 'uCloud', 'uPathN', 'uPathP'] as const
const smootherstep = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * t * (t * (t * 6 - 15) + 10) }
const rgb = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
type Vec = [number, number, number]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec): Vec => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const mix = (a: number, b: number, t: number) => a + (b - a) * t
/**
 * An easing written as a share per frame at thirty frames a second, for a step of dt seconds.
 * The galaxy draws every frame there is while it is being handled, and thirty a second while
 * idle; this keeps every ease the same speed at either rate, and exactly as it was at thirty.
 */
const perFrame = (share: number, dt: number) => 1 - Math.pow(1 - share, dt * 30)
/**
 * Whether a frame is due. Idle, thirty a second is plenty for a slow orbit. While the view is
 * being handled or is settling (a finger down, a drag, a coast or spring still moving, a flight
 * or arrival), every frame there is, so a 60 or 120 Hz screen shows the motion at its own rate.
 */
export function frameDue(sinceLast: number, busy: boolean): boolean { return busy || sinceLast >= 33 }
/**
 * The finger's speed at release, per second: the distance covered over about the last 60 ms,
 * measured from the newest sample at least that old. Robust to any pointer rate, from a 60 Hz
 * touch screen to a 1000 Hz mouse, and a finger that paused before letting go gives little or none.
 */
export function releaseSpeed(samples: readonly { t: number; value: number }[], at: number, window = 60): number {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  let base = samples[0]
  for (const sample of samples) if (sample.t <= at - window) base = sample
  const span = (at - base.t) / 1000
  return span > 0.008 ? (last.value - base.value) / span : 0
}
/** The shortest signed turn from angle a to angle b. */
const turn = (a: number, b: number) => { const d = (b - a) % (Math.PI * 2); return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d }
/**
 * Where the camera settles round a chosen world, as a bearing from the world and a tilt. `sun`
 * is the bearing of the sun from the world, `spin` the world's turn on its axis now, `from`
 * the camera's bearing now. The camera goes to the side the world's island is on, so the dive
 * falls as near the island as it can, but never to the night side: it stays between half a
 * radian off the sun (so the shafts stand behind the world, not the camera) and 1.35 radians
 * (the edge of the lit side). With the island on the night side it takes that limit on the
 * island's side. The world is not turned: the camera does all the moving.
 */
export function approach(sun: number, spin: number, from: number, keep?: 1 | -1): { facing: number; latitude: number; side: 1 | -1 } {
  const ct = Math.cos(TILT), st = Math.sin(TILT)
  // The island's direction from the world's centre for a spin s is (-sin s, st cos s, ct cos s).
  const island = Math.atan2(-Math.sin(spin), ct * Math.cos(spin)), off = turn(sun, island)
  // Dead behind the world the island favours neither side: keep to the side the camera is on.
  // Once a side is taken it is kept (`keep`), so the camera never swings across the sun to
  // chase an island that has turned round the back of its world.
  const side = keep ?? (Math.abs(Math.abs(off) - Math.PI) < 0.2 ? (turn(sun, from) >= 0 ? 1 : -1) : off >= 0 ? 1 : -1)
  const round = off * side >= 0 ? Math.abs(off) : Math.PI * 2 - Math.abs(off)   // the island's angle from the sun, going round by that side
  return { facing: sun + side * Math.min(1.35, Math.max(0.5, round)), latitude: Math.asin(st * Math.cos(spin)), side }
}

export class Galaxy {
  canvas = document.createElement('canvas')
  /** Frames drawn, for the checks. */
  frames = 0
  private readonly presence: PresenceFeed
  private population: Populations = new Map()
  private logo: LogoRenderer | null = null
  private logoSeen = false
  private gl: WebGL2RenderingContext | null = null
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  /** Painted maps keyed by world, recipe, seed, snapshot and size; kept across context loss. */
  private readonly maps = new Map<string, { data: Uint8ClampedArray; width: number; height: number }>()
  /** Which small map each texture array layer holds, and which map the close texture holds. */
  private layers: (string | undefined)[] = []
  private closeKey?: string
  private closeIndex = -1
  private array: WebGLTexture | null = null
  private program: WebGLProgram | null = null
  private blurProgram: WebGLProgram | null = null
  private readonly blurUniforms: Record<string, WebGLUniformLocation | null> = {}
  private fbo: WebGLFramebuffer | null = null
  /** The frame drawn off screen for the blur pass, the size of the canvas. */
  private target2: WebGLTexture | null = null
  private close: WebGLTexture | null = null
  private worker: Worker | null = null
  private readonly queue: { key: string; worldId: string; id: string; seed: number; width: number; height: number; overrides?: Record<string, ParamValue> }[] = []
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
  /** The first view is the resting view, so nothing has to move to reach it (reduced motion never moves by itself). */
  private pitch: number = REST.pitch
  private framed = false
  /**
   * How bright the galaxy is: 1 as the lobby, lower as the backdrop of an open panel, so
   * text on glass reads even where the browser's frost is weak (WebKit's is).
   */
  backdrop = 1
  /** Leave room for the Custom sliders without covering their planet. */
  editing = false
  private framing: Vec = [0.5, 0.5, 1]
  private dim = 1
  private distance = 13
  private target: Vec = [0, 0, 0]
  /** The view's turn and tilt under the finger: see SWING. this.yaw and this.pitch are what is shown. */
  private swingYaw: SwingAxis = { aim: 0.6, aimSpeed: 0, view: 0.6, viewSpeed: 0 }
  private swingPitch: SwingAxis = { aim: REST.pitch, aimSpeed: 0, view: REST.pitch, viewSpeed: 0 }
  /** When the view was last handled (a pointer, key, wheel or stick, or a world chosen or left), on the frame clock. */
  private handled = performance.now()
  /** True while the view is settling to its resting tilt: frames are still owed. */
  private resting = false
  /** The finger's unstretched tilt during a drag, and how fast it and the turn are moving. */
  private pull = { pitch: 0, yaw: 0 }
  /** The finger's recent unstretched turn and tilt, for its speed at release. */
  private trail: { t: number; yaw: number; pitch: number }[] = []
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
    // The first view frames every orbit.
    this.distance = this.reach = fitDistance(options.worlds.map(bodyOf))
    const recipes = [...new Set(options.worlds.filter(w => w.id !== 'custom').map(w => w.recipe ?? w.id))]
    this.presence = new PresenceFeed(recipes, values => { this.population = values; this.wake = 2; options.onPresence?.(values) })
    this.reduced.addEventListener('change', () => { this.wake = 2 }, { signal: this.abort.signal })
    addEventListener('keydown', event => this.key(event), { signal: this.abort.signal })
    // Any input ends the lobby's rest at once (idlePulse.ts).
    const input = () => { this.lastInput = performance.now() }
    for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'] as const) addEventListener(type, input, { signal: this.abort.signal, passive: true, capture: true })
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host)
    document.addEventListener('visibilitychange', () => { this.syncPresence(); cancelAnimationFrame(this.frame); if (this.active && !document.hidden) this.loop(0) }, { signal: this.abort.signal })
  }
  /** False when WebGL 2 is not available: the caller keeps the ordinary lobby. */
  static supported(): boolean { try { return Boolean(document.createElement('canvas').getContext('webgl2')) } catch { return false } }
  get live(): boolean { return this.gl !== null && !this.gl.isContextLost() }
  /** Worlds whose painted maps have arrived. */
  get painted(): number { return this.options.worlds.filter(world => this.maps.has(this.mapKey(world, SMALL))).length }
  private mapKey(world: GalaxyWorld, size: readonly [number, number]): string { return `${world.id}:${world.recipe ?? world.id}:${world.seed}:${world.mapVariant ?? ''}:${size[0]}` }
  /** Snapshot values have already passed the parameter registry's sanitizers. */
  updateCustom(recipe: string, seed: number, values: Record<string, ParamValue>): void {
    const world = this.options.worlds.find(w => w.id === 'custom')
    if (!world) return
    const overrides = Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))
    const variant = JSON.stringify(overrides)
    if (!world.forming && world.recipe === recipe && world.seed === seed && world.mapVariant === variant) return
    world.recipe = recipe; world.seed = seed; world.overrides = overrides; world.mapVariant = variant
    world.forming = false; world.glow = overrides['world.seaKind'] === 0
    // Keep only the latest pending slider snapshot. An older in-flight result is rejected below.
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].worldId === world.id) this.queue.splice(i, 1)
    for (const key of this.maps.keys()) if (key.startsWith('custom:')) this.maps.delete(key)
    this.wake = 2
    if (this.active) {
      this.request(world, SMALL, true)
      if (this.options.worlds[this.chosen] === world) this.request(world, CLOSE, true)
    }
  }
  /**
   * A world's seed changed (the host rolled it, or a guest's room did): repaint its sphere so
   * it is the world it now leads to. The old map stays until the new one arrives.
   */
  setSeed(id: string, seed: number): void {
    const index = this.options.worlds.findIndex(world => world.id === id), world = this.options.worlds[index]
    if (!world || world.forming || world.seed === seed || this.savedTarget) return
    world.seed = seed; this.wake = 2
    if (this.active) { this.request(world, SMALL, true); if (this.chosen === index) this.request(world, CLOSE, true) }
  }
  private savedTarget = false
  /** Borrow a recipe's existing slot for one saved-world flight. Custom is never touched. */
  savedWorldTarget(recipe: string, seed: number, values: Record<string, ParamValue>, identity: string): () => void {
    if (this.savedTarget) throw new Error('A saved-world flight is already active.')
    const index = this.options.worlds.findIndex(world => world.id === recipe)
    const world = this.options.worlds[index]
    if (!world) throw new Error('The saved recipe is unavailable.')
    const original = { ...world }
    const overrides = Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))
    Object.assign(world, { recipe, seed, overrides, forming: false, glow: overrides['world.seaKind'] === 0, mapVariant: `saved:${identity}:${JSON.stringify(overrides)}` })
    const keys = [this.mapKey(world, SMALL), this.mapKey(world, CLOSE)]
    this.savedTarget = true; this.layers[index] = ''; this.closeIndex = -1; this.wake = 2
    this.request(world, SMALL, true); this.request(world, CLOSE, true)
    let restored = false
    return () => {
      if (restored) return
      restored = true
      for (const key of Object.keys(world) as (keyof GalaxyWorld)[]) if (!(key in original)) delete world[key]
      Object.assign(world, original)
      for (let i = this.queue.length - 1; i >= 0; i--) if (keys.includes(this.queue[i].key)) this.queue.splice(i, 1)
      for (const key of keys) this.maps.delete(key)
      this.layers[index] = ''; this.closeIndex = -1
      if (this.closeKey && keys.includes(this.closeKey)) this.closeKey = ''
      this.savedTarget = false; this.home()
      if (this.active) this.request(world, SMALL, true)
    }
  }
  private syncPresence(): void { this.presence.setActive(this.active && !document.hidden && (this.options.presenceVisible?.() ?? true)) }
  set enabled(value: boolean) {
    if (value === this.active) return
    this.active = value
    this.syncPresence()
    // Each showing of the lobby fades the logo in afresh (a context restore, below, does not),
    // and counts as handling the view, so the resting tilt waits its few seconds again.
    if (value) { this.logoSeen = false; this.handled = performance.now(); this.acquire() } else this.release()
  }
  /** Back out to the whole system, for example after returning from a world's panel. */
  home(): void { this.handled = performance.now(); this.wake = 2; this.chosen = -1
    // Back in the lobby with the name gone (a choice cancelled, or the reverse flight out of a
    // world landing, perf/smooth-entry's ascend): it kindles again, once, from here.
    if (this.leaving !== null && !this.reduced?.matches) this.returning = performance.now()
    this.leaving = null; this.arriving = 0; this.arrived = false; this.diving = false; this.dive = 0; this.flight = undefined; this.flightDone = false; this.blur = 0 }
  /** The descent: fall toward a world until its air fills the view. Resolves when it has. `quick` for a player who has seen it. */
  descend(id: string, quick = false): Promise<void> {
    if (!this.gl) return Promise.resolve()
    this.choose(id); this.arrived = true; this.diving = true; this.wake = 2
    // One timed path from wherever the view is now, so a slow frame never makes it lurch:
    // across the system to the world, round to its lit side, and down into its air.
    this.flightDone = false
    this.flight = { start: performance.now(), duration: quick ? 1700 : 2400, from: [...this.target], reach: this.reach, yaw: this.yaw, pitch: this.pitch, last: this.reach, at: performance.now() }
    return new Promise(resolve => { const wait = () => { if (!this.active || !this.flight || this.flightDone) resolve(); else setTimeout(wait, 30) }; wait() })
  }
  /** The drop in progress: where it started and when. */
  private flight?: { start: number; duration: number; from: Vec; reach: number; yaw: number; pitch: number; last: number; at: number }
  private flightDone = false
  /** How hard the frame is smeared toward the centre this frame (0 for none). */
  private blur = 0

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
    for (const name of UNIFORMS) this.uniforms[name] = gl.getUniformLocation(program, name)
    // One array of small maps on unit 0, the close map on unit 1.
    const linear = (target: number) => { gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE) }
    gl.activeTexture(gl.TEXTURE0); this.array = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.array)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, SMALL[0], SMALL[1], MAX); linear(gl.TEXTURE_2D_ARRAY)
    gl.activeTexture(gl.TEXTURE1); this.close = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.close)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); linear(gl.TEXTURE_2D)
    gl.uniform1i(this.uniforms.uMaps, 0); gl.uniform1i(this.uniforms.uClose, 1)
    // The wordmark's field has its own unit; a sampler left on unit 0 would clash with the maps.
    gl.uniform1i(this.uniforms.uField, FIELD_UNIT)
    this.layers = []; this.closeKey = undefined; this.closeIndex = -1
    this.program = program; this.blurProgram = null
    const blur = gl.createProgram()!
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, BLUR]] as const) { const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(blur, shader) }
    gl.linkProgram(blur)
    if (gl.getProgramParameter(blur, gl.LINK_STATUS)) {
      this.blurProgram = blur
      for (const name of ['uScene', 'uBlur', 'uSize']) this.blurUniforms[name] = gl.getUniformLocation(blur, name)
      this.target2 = gl.createTexture(); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.target2)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      this.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.target2, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.useProgram(blur); gl.uniform1i(this.blurUniforms.uScene, 2); gl.useProgram(program)
    }
    this.gl = gl
    if (this.options.logo) {
      // The galaxy draws the glow; the mark itself is a vector over the canvas, at the
      // screen's full resolution (see WordmarkOverlay).
      this.logo = new LogoRenderer(gl, { particles: logoBudget(this.options.logo()?.level ?? 0).particles, drawMark: false })
      this.markOverlay = new WordmarkOverlay(); canvas.after(this.markOverlay.element)
      // The in-space letters' full-resolution pass, made only when a placement in space is chosen.
      this.markCrisp = null
      if (!this.logo.ok) { this.logo.dispose(); this.logo = null }
      else if (this.logoSeen || this.reduced.matches || this.options.still?.()) this.logo.skipIntro()
    }
    const signal = this.abort.signal, options = { signal }
    // The opening: the first showing after the page loads, unless motion is reduced. Any tap,
    // click, wheel or key goes straight to the settled lobby.
    const intro = Math.round(introMode.value)
    // The first load of a browser session plays it in full, later loads a short version
    // (openingPace). Coming back from a world: only the name, kindled again (returningMark).
    if (intro > 0 && !openingPlayed && !this.reduced.matches) { this.opening = { start: null, mode: intro as OpeningMode, pace: openingPace() }; openingPlayed = true }
    else if (openingPlayed && !this.reduced.matches) this.returning = performance.now()
    for (const type of ['pointerdown', 'keydown', 'wheel'] as const) window.addEventListener(type, () => { if (this.opening) { this.opening = null; this.chrome(null); this.wake = 2 } }, { capture: true, passive: true, signal })
    canvas.addEventListener('webglcontextlost', event => {
      if (this.canvas !== canvas || this.gl !== gl) return
      event.preventDefault(); cancelAnimationFrame(this.frame); this.options.onLogo?.(false); this.markOverlay?.hide()
      // Until the context comes back (then the name in the scene returns with it), the page's own SVG mark shows.
      startupTiming.wordmarkFallback = 'the lobby WebGL2 context was lost'
    }, options)
    canvas.addEventListener('webglcontextrestored', () => {
      if (!this.active || this.canvas !== canvas || this.gl !== gl) return
      const selected = this.options.worlds[this.chosen]?.id
      this.release(); this.acquire()
      if (startupTiming.wordmarkFallback === 'the lobby WebGL2 context was lost') startupTiming.wordmarkFallback = undefined
      if (selected) this.choose(selected)
    }, options)
    canvas.addEventListener('pointerdown', event => this.down(event), options)
    canvas.addEventListener('pointermove', event => { this.move(event); this.point(event) }, options)
    canvas.addEventListener('pointerleave', () => this.pointAt(undefined), options)
    // The planet glow follows the same pointing (point, below: one hit test for the glow and
    // the label), plus the pointer over a label and a label's keyboard focus.
    const label = (event: Event) => (event.target as Element | null)?.closest?.<HTMLElement>('.galaxy-label')?.dataset.world ?? null
    this.host.addEventListener('pointerover', event => { const id = label(event); if (id) this.wantGlow('hoverId', id) }, options)
    this.host.addEventListener('pointerout', event => { if (label(event) && !label({ target: (event as PointerEvent).relatedTarget } as Event)) this.wantGlow('hoverId', null) }, options)
    this.host.addEventListener('focusin', event => this.wantGlow('focusId', label(event)), options)
    this.host.addEventListener('focusout', () => this.wantGlow('focusId', null), options)
    for (const type of ['pointerup', 'pointercancel'] as const) canvas.addEventListener(type, event => this.up(event, type === 'pointerup'), options)
    canvas.addEventListener('wheel', event => { event.preventDefault(); this.handled = performance.now(); this.wake = 2; if (this.chosen < 0) this.distance = Math.min(this.farthest, Math.max(6, this.distance * Math.exp(event.deltaY * 0.0012))) }, { signal, passive: false })
    // Held upright, a phone has height to spare and no width: look down more steeply so the
    // orbits open out into the height. Only for the first view; after that the player's stands.
    if (!this.framed) {
      this.framed = true
      this.distance = this.reach = openingDistance(this.options.worlds.map(bodyOf), this.host.clientWidth, this.host.clientHeight)
      if (this.host.clientHeight > this.host.clientWidth * 1.2 && !this.reduced.matches) this.pitch = 0.85
    }
    this.paintMaps(); this.resize(); this.loop(0)
  }
  private release(): void {
    this.markStart = null; this.markRig.pose = null; this.leaving = null
    // An opening cut short here must not leave the lobby's controls held back.
    if (this.opening) { this.opening = null; this.chrome(null) }
    // A finished or abandoned drop does not outlive the context: the next showing starts clean.
    this.home()
    this.logo?.dispose(); this.logo = null; this.options.onLogo?.(false)
    this.markOverlay?.remove(); this.markOverlay = null
    this.markCrisp?.dispose(); this.markCrisp = null
    cancelAnimationFrame(this.frame); this.worker?.terminate(); this.worker = null; this.queue.length = 0; this.painting = false
    this.array = this.close = null; this.fbo = null; this.target2 = null; this.program = null; this.blurProgram = null
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
    const job = { key, worldId: world.id, id: world.recipe ?? world.id, seed: world.seed, width: size[0], height: size[1], overrides: world.overrides }
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
        worker.onmessage = event => {
          if (this.worker !== worker) return
          const { key, data, width, height } = event.data
          if (this.options.worlds.some(world => !world.forming && this.mapKey(world, [width, height]) === key)) this.maps.set(key, { data, width, height })
          this.painting = false; this.wake = 2; this.next()
        }
        worker.onerror = () => { if (this.worker !== worker) return; worker.terminate(); this.worker = null; this.painting = false; this.queue.length = 0 }
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
      if (!this.savedTarget) for (const old of closes.slice(0, Math.max(0, closes.length - 1))) this.maps.delete(old)
    }
    this.closeIndex = map && key === this.closeKey ? this.chosen : -1
  }
  private resize(): void {
    if (!this.gl) return
    // The ladder's render scale: whole steps, applied with the redraw so no blank frame shows.
    const scale = Math.min(devicePixelRatio || 1, 1.5) * qualityScale()
    this.shownScale = qualityScale(); this.wake = 2
    this.canvas.width = Math.max(1, Math.round(this.host.clientWidth * scale)); this.canvas.height = Math.max(1, Math.round(this.host.clientHeight * scale))
    if (this.target2) { const gl = this.gl; gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.target2); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null) }
  }
  /** How each world looks from space besides its map, by recipe, seed and snapshot. */
  private readonly looks = new Map<string, LobbyLook>()
  private lookOf(world: GalaxyWorld): LobbyLook {
    const key = this.mapKey(world, SMALL)
    let look = this.looks.get(key)
    if (!look) {
      // A world still forming has no recipe yet: molten, airless and cloudless.
      look = world.forming ? { land: world.land, sea: world.sea, landShare: 1, air: [1, 0.5, 0.2], airDepth: 0.3, cloud: 0, cloudTint: [1, 1, 1], gloss: 0, night: 0 } : lobbyLook(world.recipe ?? world.id.split('~')[0], world.overrides)
      this.looks.set(key, look)
    }
    return look
  }
  /** Where the worlds are now: see orbitLayout. */
  private places(time: number): OrbitPlace[] {
    return orbitLayout(this.options.worlds.map(bodyOf), time)
  }
  /** The farthest the view may pull back: far enough to see the whole system with room round it. */
  private get farthest(): number { return Math.max(26, fitDistance(this.options.worlds.map(bodyOf)) * 1.5) }
  private camera(places: OrbitPlace[]) {
    // Ease toward the chosen world; arriving is the camera settling close above it.
    const goal: Vec = this.chosen >= 0 ? places[this.chosen].position : [0, 0, 0]
    const ease = perFrame(this.chosen >= 0 ? 0.08 : 0.06, this.step)
    this.target = [mix(this.target[0], goal[0], ease), mix(this.target[1], goal[1], ease), mix(this.target[2], goal[2], ease)]
    const wantDistance = this.chosen >= 0 ? places[this.chosen].radius * (this.diving ? 1.03 : 3.1) : this.distance
    this.reach = mix(this.reach, wantDistance, perFrame(this.diving ? 0.075 : this.chosen >= 0 ? 0.05 : 0.12, this.step))
    const latitude = this.face()
    if (this.flight) {
      // The drop, by the clock: across to the world in the first three quarters, round to its
      // lit side on the way, and in toward its air the whole time, faster at the end. The
      // dive's light rises over the last third.
      const f = this.flight, now = performance.now(), t = Math.min(1, (now - f.start) / f.duration)
      const travel = smootherstep(t / 0.75), close = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
      this.target = [mix(f.from[0], goal[0], travel), mix(f.from[1], goal[1], travel), mix(f.from[2], goal[2], travel)]
      this.reach = Math.exp(mix(Math.log(f.reach), Math.log(wantDistance), close))
      this.yaw = f.yaw + turn(f.yaw, this.facing) * travel; this.pitch = mix(f.pitch, latitude, travel)
      this.dive = smootherstep((t - 0.66) / 0.34)
      // Smear in proportion to how fast the view is closing: the change in log distance per second.
      const seconds = Math.max(0.001, (now - f.at) / 1000)
      this.blur = mix(this.blur, Math.min(0.16, Math.abs(Math.log(f.last / this.reach)) / seconds * 0.05), 0.5)
      f.last = this.reach; f.at = now
      if (t >= 1) this.flightDone = true
    }
    // Close enough that a held-still view can stop drawing; it snaps the last step so the
    // frame left on screen is where the camera was going.
    this.settled = Math.abs(this.reach - wantDistance) < 0.01 * wantDistance && Math.hypot(...sub(this.target, goal)) < 0.01 * wantDistance
    if (this.settled && this.holding) { this.target = goal; this.reach = wantDistance }
    if (!this.flight) this.dive = Math.max(0, this.dive - 1.5 * this.step)
    const cp = Math.cos(this.pitch), eye: Vec = [this.target[0] + Math.sin(this.yaw) * cp * this.reach, this.target[1] + Math.sin(this.pitch) * this.reach, this.target[2] + Math.cos(this.yaw) * cp * this.reach]
    const forward = unit(sub(this.target, eye)), right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward)
    return { eye, forward, right, up, // The short side of the screen always spans the same slice of space, so the system fills
    // a phone held upright as well as it fills a wide monitor.
    tan: VIEW_TAN }
  }
  private reach = 13
  /** Seconds since the last drawn frame, for the eases. */
  private step = 1 / 30
  /** Where the camera settles round a chosen world: an angle, a quarter turn off the sun. */
  private facing = 0
  private facingSettled = true
  /** The side of the sun the camera took round the chosen world, kept until another is chosen. */
  private facingSide: 1 | -1 = 1
  /** Each world's slow turn on its axis. Nothing else turns a world. */
  private spin(i: number, time: number): number { return time * 0.05 + i * 2.1 }
  /**
   * Flying to a world, only the camera moves: the world keeps its own slow turn and is never
   * turned to meet the view. The camera swings round the world as it falls, a curving,
   * deorbiting approach, toward the side its island is on (the map's longitude 0, latitude 0,
   * where the game spawns), kept within the lit side: see approach.
   */
  private face(): number {
    this.facingSettled = true
    if (this.chosen < 0 || this.options.worlds[this.chosen].forming) return this.pitch
    // The island turns slowly with its world and the world moves along its orbit: follow both.
    const at = this.places(this.clock)[this.chosen].position
    const { facing, latitude } = approach(Math.atan2(-at[0], -at[2]), this.spin(this.chosen, this.clock), this.yaw, this.facingSide)
    // A flight keeps the bearing it set out for: the island moves a few degrees in that time,
    // and a bearing that changed under it would bend the fall.
    if (!this.flight) this.facing = facing
    const share = perFrame(0.07, this.step)
    if (!this.drag && !this.flight) { const y = turn(this.yaw, this.facing), p = latitude - this.pitch; this.yaw += y * share; this.pitch += p * share; this.facingSettled = Math.abs(y) < 0.003 && Math.abs(p) < 0.003 }
    return latitude
  }
  private loop = (now: number): void => {
    this.syncPresence()
    if (!this.active || document.hidden) return
    this.frame = requestAnimationFrame(this.loop)
    qualityFrame(now)
    const busy = this.opening !== null || !!this.flight || this.drag !== null || this.pointers.size > 0 || !this.swingResting || (this.chosen >= 0 && !this.arrived)
    if (!frameDue(now - this.last, busy)) return
    const elapsed = Math.min(0.1, Math.max(0, (now - this.last) / 1000))
    this.last = now; this.step = elapsed
    this.controller(elapsed)
    const gl = this.gl, u = this.uniforms
    if (!gl || gl.isContextLost()) return
    if (this.shownScale !== qualityScale()) this.resize()
    // Behind an open panel the galaxy is a backdrop: dimmed, and held still once it has dimmed.
    this.dim = Math.abs(this.dim - this.backdrop) < 0.01 ? this.backdrop : mix(this.dim, this.backdrop, perFrame(0.18, elapsed))
    const still = Boolean(this.options.still?.()) || this.reduced.matches || this.backdrop < 1, wall = performance.now()
    const wallElapsed = Math.max(0, (wall - this.lastClock) / 1000)
    if (!still && !this.clockHold) this.clock += Math.min(0.25, wallElapsed)
    this.lastClock = wall
    if (still !== this.holding) this.wake = 2
    const time = this.clock; this.holding = still
    // The view keeps a little of the last drag's swing, and drifts very slowly when left alone.
    this.swing(elapsed, !this.drag && this.chosen < 0 && !still && !this.clockHold, wallElapsed)
    const inset = Math.min(0.3, Math.max(0, this.options.topInset?.() ?? 0) / Math.max(1, this.host.clientHeight))
    // The short landscape layout (Shell, SHORT_LANDSCAPE) supplies its own frame.
    const frameGoal: Vec = this.editing ? (this.host.clientWidth <= 700 ? [0.5, 0.75, 0.55] : [0.28, 0.45, 0.8]) : (this.options.frame?.() as Vec | undefined) ?? [0.5, 0.5 - inset / 2, 1 - inset]
    const framingMoves = this.framing.some((v, i) => Math.abs(v - frameGoal[i]) > 0.001)
    this.framing = this.framing.map((v, i) => framingMoves ? mix(v, frameGoal[i], perFrame(0.18, elapsed)) : frameGoal[i]) as Vec
    const places = this.places(time), view = this.camera(places), worlds = this.options.worlds
    // The continuous opening (opening.ts): held at the point of light while loading, then by the clock.
    // The lowest graphics level holds the lobby still, as reduced motion does: no opening there.
    if (still && this.opening && this.openingAt === null) { this.opening = null; this.chrome(null) }
    // The planet glow: none while the opening plays or behind a panel; the chosen world keeps its own.
    const lobby = this.opening === null && this.backdrop >= 1 && hoverGlowIntensity.value > 0
    const glowChanging = this.glow.step(lobby ? glowTarget({ hovered: this.pointed ?? this.hoverId, focused: this.focusId, chosen: this.chosen >= 0 ? worlds[this.chosen]?.id : null }) : null, elapsed)
    const glowMoving = glowChanging || (this.glow.strength > 0 && !this.reduced.matches && hoverGlowSpeed.value > 0 && !this.glow.chosen)
    // The lobby at rest (idlePulse.ts): after a while with no input, each world breathes its own
    // glow. Not behind a panel, while flying, in a hidden tab (no frames), held still or under
    // reduced motion; any input fades it out and starts the wait again.
    const resting = lobby && !still && !this.reduced.matches && this.chosen < 0 && !this.flight && idleAfter.value > 0 && (performance.now() - this.lastInput) / 1000 >= idleAfter.value
    this.rest.fade(resting, elapsed)
    if (this.rest.envelope > 0) this.restClock += elapsed
    const glowing = this.glow.strength > 0 ? this.glow.id : null
    this.pulses = this.rest.envelope > 0 ? this.rest.at(this.restClock).map((v, i) => worlds[i]?.id === glowing ? 0 : v * this.rest.envelope * idlePeak.value) : this.pulses.fill(0)
    let reveal = this.stepOpening(places)
    // Reduced motion: the name goes at once rather than being swept away.
    if (this.leaving !== null) reveal = { ...reveal, ...leavingMark(this.reduced.matches ? 1e3 : (performance.now() - this.leaving) / 1000) }
    else if (this.returning !== null) {
      const t = (performance.now() - this.returning) / 1000
      if (t > RETURN_SECONDS) this.returning = null; else reveal = { ...reveal, ...returningMark(t) }
    }
    if (reveal.reach !== 1) view.eye = [this.target[0] + (view.eye[0] - this.target[0]) * reveal.reach, this.target[1] + (view.eye[1] - this.target[1]) * reveal.reach, this.target[2] + (view.eye[2] - this.target[2]) * reveal.reach]
    const arrival = places.map((_, i) => reveal.arrive[this.lanes(places)[i]] ?? 1)
    const mark = this.stepMark(elapsed, still)
    this.markView = view; this.markPlaced = mark.placement
    // Held still, draw only while something is moving; the last frame stays on the canvas.
    const moving = glowMoving || this.opening !== null || this.returning !== null || (this.leaving !== null && performance.now() - this.leaving < LEAVING_SECONDS * 1000 + 100) || mark.moving || this.resting || framingMoves || !this.facingSettled || this.dim !== this.backdrop || this.drag !== null || this.pointers.size > 0 || !this.swingResting || this.diving || this.dive > 0 || (this.chosen >= 0 && !this.arrived) || !this.settled
    if (still && !moving && this.wake <= 0) { this.idle++; return }
    this.wake = Math.max(0, this.wake - 1)
    // The wordmark's field is baked (first, and if drawn much larger) before the frame starts.
    if (mark.placement) this.logo!.distanceField!.ensure(mark.pixelsPerUnit, null)
    gl.useProgram(this.program); this.upload(gl)
    // The frame's uniforms, for this pass and the wordmark's own full-resolution one.
    const setFrame = (gl: WebGL2RenderingContext, u: Record<string, WebGLUniformLocation | null>, width: number, height: number, bindField: () => void, crisp: number) => {
      gl.uniform1i(u.uCloseIndex, this.closeIndex)
      gl.uniform1i(u.uMarkMode, mark.placement ? mark.mode : 0); gl.uniform1f(u.uMarkCrisp, crisp)
      if (mark.placement) {
        const p = mark.placement
        gl.uniform3f(u.uMarkCentre, ...p.centre); gl.uniform3f(u.uMarkRight, ...p.right); gl.uniform3f(u.uMarkUp, ...p.up)
        gl.uniform1f(u.uMarkOpacity, mark.opacity * reveal.mark * (1 - this.dive)); gl.uniform1f(u.uMarkSun, p.sunDistance)
        gl.uniform4f(u.uMarkShape, p.shape.kind, p.shape.radius, p.shape.bearing, p.shape.size); gl.uniform2f(u.uMarkShape2, p.shape.offset, p.shape.flip)
        bindField()
      }
      gl.uniform3f(u.uFrame, ...this.framing)
      gl.uniform2f(u.uSize, width, height); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uScale, width / Math.max(1, this.host.clientWidth))
      gl.uniform3f(u.uEye, ...view.eye); gl.uniform3f(u.uRight, ...view.right); gl.uniform3f(u.uUp, ...view.up); gl.uniform3f(u.uForward, ...view.forward); gl.uniform1f(u.uTan, view.tan)
      gl.uniform2f(u.uShed, qualityShed(2), qualityShed(3)); gl.uniform1f(u.uAmbience, 1 - qualityShed(1)); gl.uniform1f(u.uDive, this.dive); gl.uniform1f(u.uDim, this.dim)
      gl.uniform1i(u.uOnly, this.editing ? this.chosen : -1)
      gl.uniform1fv(u.uPopulation, worlds.slice(0, MAX).map(w => w.id === 'custom' || w.mapVariant?.startsWith('saved:') ? -1 : this.population.get(w.recipe ?? w.id)?.players ?? -1))
      gl.uniform1i(u.uCount, Math.min(MAX, worlds.length))
      gl.uniform4fv(u.uWorld, places.flatMap((p, i) => [...p.position, Math.max(1e-3, p.radius * arrival[i])]))
      const settled = reveal === SETTLED
      gl.uniform4f(u.uReveal, reveal.sun, settled ? 99 : reveal.front, reveal.stars, reveal.sun > 0 ? 0 : reveal.swell); gl.uniform1f(u.uRevealMark, settled ? 99 : reveal.markFront)
      gl.uniform1fv(u.uOrbit, places.length ? places.map((_, i) => reveal.orbits[this.lanes(places)[i]] ?? 1) : [1])
      gl.uniform1fv(u.uArrive, arrival.length ? arrival : [1])
      const glowAt = this.glow.id ? worlds.findIndex(w => w.id === this.glow.id) : -1, glowWorld = worlds[glowAt]
      gl.uniform1i(u.uGlowIndex, glowAt < MAX ? glowAt : -1); gl.uniform1f(u.uGlowTime, (performance.now() / 1000) % 1000)
      gl.uniform4f(u.uGlow, this.glow.strength, hoverGlowSpeed.value, this.reduced.matches ? 1 : this.glow.chosen ? 0.55 : 0, hoverGlowIntensity.value * (this.glow.chosen ? 1.25 : 1))
      if (glowWorld) gl.uniform3f(u.uGlowColour, ...glowColour(glowWorld.land, glowWorld.sea, glowWorld))
      gl.uniform1fv(u.uPulse, this.pulses.slice(0, MAX))
      if (this.pulses.some(v => v > 0)) gl.uniform3fv(u.uPulseColour, Array.from({ length: MAX }, (_, i) => worlds[i] ? glowColour(worlds[i].land, worlds[i].sea, worlds[i]) : [0, 0, 0]).flat())
      // The veil's point at full progress is about 6.6 CSS pixels in radius; the sun's core is
      // half its peak at 0.0374 of its size in units of the short side.
      gl.uniform1f(u.uSunPoint, Math.min(1, Math.max(0.02, 6.6 * (width / Math.max(1, this.host.clientWidth)) / (Math.min(width, height) * this.framing[2] * 0.0374))))
      const looks = worlds.slice(0, MAX).map(w => this.lookOf(w))
      gl.uniform3fv(u.uLand, looks.flatMap(l => rgb(l.land))); gl.uniform3fv(u.uSea, looks.flatMap(l => rgb(l.sea)))
      gl.uniform4fv(u.uAir, looks.flatMap(l => [...l.air, l.airDepth])); gl.uniform3fv(u.uCloud, looks.flatMap(l => l.cloudTint))
      gl.uniform4fv(u.uLook, looks.flatMap(l => [l.cloud, l.gloss, l.night, l.landShare]))
      gl.uniform4fv(u.uPathN, places.flatMap(p => p.path ? [...p.path.normal, p.orbit] : [0, 1, 0, 0])); gl.uniform4fv(u.uPathP, places.flatMap(p => p.path ? [...p.path.nearest, p.path.eccentricity] : [1, 0, 0, 0]))
      gl.uniform4fv(u.uKind, worlds.slice(0, MAX).flatMap((w, i) => [w.forming ? 2 : w.glow ? 1 : 0, this.layers[i] || i === this.closeIndex ? 1 : 0, this.spin(i, time), (w.seed % 97) + i * 3.1]))
    }
    // The letters at full device resolution, in their own pass, when the screen is finer than the galaxy's canvas.
    const crisp = this.markCrisp?.ok && mark.placement && wordmarkCrispPass.value && devicePixelRatio > this.canvas.width / Math.max(1, this.host.clientWidth) + 0.05 ? this.markCrisp : null
    setFrame(gl, u, this.canvas.width, this.canvas.height, () => { this.logo!.distanceField!.bind(name => u[name]); gl.useProgram(this.program) }, crisp ? 1 : 0)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    const smear = this.flight && this.blurProgram && this.blur > 0.003 && qualityShed(2) < 1
    if (smear) gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    if (smear) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(this.blurProgram)
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.target2)
      gl.uniform1f(this.blurUniforms.uBlur, this.blur); gl.uniform2f(this.blurUniforms.uSize, this.canvas.width, this.canvas.height)
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.useProgram(this.program)
    }
    if (this.markCrisp) {
      const box = crisp ? this.wordmarkScreenBox() : null
      this.markCrisp.draw(box, this.host.clientWidth, this.host.clientHeight, Math.min(3, devicePixelRatio || 1), mark.pixelsPerUnit, (g, l, w, h, bind) => setFrame(g, l, w, h, bind, 0))
    }
    const logo = this.logo, layout = this.options.logo?.()
    if (mark.placement) { this.options.onLogo?.(true); if (layout) this.markOverlay?.update(layout.box, 0) }
    else if (logo && layout) {
      const budget = logoBudget(layout.level), held = this.reduced.matches || budget.still || this.backdrop < 1
      if (held) logo.skipIntro()
      // Behind the loading veil the logo waits at nothing: its fade starts as the veil lifts.
      else if (document.documentElement.dataset.boot === 'loading') logo.replayIntro()
      logo.setLook({ particles: Math.round(budget.particles * (1 - qualityShed(1) * 0.65)), sway: held ? 0 : 0.07, opacity: (1 - this.dive) * reveal.mark })
      const sx = this.canvas.width / this.host.clientWidth, sy = this.canvas.height / this.host.clientHeight, box = layout.box
      logo.draw(held ? STILL_SECONDS : time, { x: box.x * sx, y: box.y * sy, width: box.width * sx, height: box.height * sy })
      this.markOverlay?.update(box, logo.markOpacity)
      this.logoSeen = true; this.options.onLogo?.(true)
    }
    this.frames++
    // Tell the labels where the worlds are, and notice arrival.
    const width = this.host.clientWidth, height = this.host.clientHeight, short = Math.min(width, height) * this.framing[2]
    this.screen = places.map((place, i) => {
      const d = sub(place.position, view.eye), z = dot(d, view.forward)
      return { id: worlds[i].id, x: width * this.framing[0] + (dot(d, view.right) / (Math.max(z, 0.001) * view.tan)) * short / 2, y: height * (1 - this.framing[1]) - (dot(d, view.up) / (Math.max(z, 0.001) * view.tan)) * short / 2, radius: (place.radius / (Math.max(z, 0.001) * view.tan)) * short / 2, visible: z > 0 && arrival[i] >= 0.6, labelled: reveal.labels[this.lanes(places)[i]] ?? true, depth: z }
    })
    // The sun's bright core, which labels keep clear of.
    const toSun = sub([0, 0, 0], view.eye), sunZ = Math.max(dot(toSun, view.forward), 0.001)
    this.sunScreen = { x: width * this.framing[0] + (dot(toSun, view.right) / (sunZ * view.tan)) * short / 2, y: height * (1 - this.framing[1]) - (dot(toSun, view.up) / (sunZ * view.tan)) * short / 2, radius: Math.max(6, short * 0.02), depth: sunZ }
    this.options.onLayout?.(this.screen, this.chosen >= 0 ? worlds[this.chosen].id : undefined)
    this.options.onRest?.(this.pulses)
    // Arrival: a second and a half after choosing, whatever the frame rate.
    if (this.chosen >= 0 && !this.arrived && (this.arriving += this.step) > 1.5) { this.arrived = true; this.options.onArrive(worlds[this.chosen].id) }
  }
  private screen: { id: string; x: number; y: number; radius: number; visible: boolean; depth: number; labelled?: boolean }[] = []
  /** Where the sun's core is on screen, as of the last frame drawn. */
  sunScreen: { x: number; y: number; radius: number; depth?: number } = { x: -1e4, y: -1e4, radius: 0 }
  private readonly markRig = new WordmarkRig()
  /** The planet glow (hoverGlow.ts), and what asks for it: the pointer, keyboard focus, a finger. */
  private readonly glow = new GlowState()
  /** The lobby at rest: each world's pulse this frame, 0 to idlePeak, and their clock and generator. */
  pulses: number[] = new Array(MAX).fill(0)
  private readonly rest = new IdlePulse(REST_SEED, MAX)
  private restClock = 0
  /** When the lobby last had any input: a pointer moving or pressed, a key, a wheel. */
  lastInput = performance.now()
  /** For screenshots only: holds the orbits where they are and the view's slow drift. */
  clockHold = false
  private hoverId: string | null = null
  private focusId: string | null = null
  private wantGlow(kind: 'hoverId' | 'focusId', id: string | null): void { if (this[kind] !== id) { this[kind] = id; this.wake = 2 } }
  /** performance.now() when a world was chosen, while the name un-reveals; null in the lobby. */
  private leaving: number | null = null
  /** performance.now() when the lobby came back from a world, while the name kindles again. */
  private returning: number | null = null
  /** The continuous opening, while it plays: started when loading ends (null until then). */
  private opening: { start: number | null; mode: OpeningMode; pace: number } | null = null
  /** For screenshots only: holds the opening at this many seconds in. */
  openingAt: number | null = null
  /** Plays the opening again now (for screenshots and checks). */
  replayOpening(mode: number, pace = 1): void { if (mode > 0 && !this.reduced.matches) { this.opening = { start: performance.now(), mode: mode as OpeningMode, pace }; this.wake = 2 } }
  /**
   * Holds the lobby's own controls (the hint, the links, the preview menu) while the opening
   * plays and fades them in as it settles: index.html's html[data-opening] rules. A skip
   * shows them at once.
   */
  private chrome(state: 'playing' | 'settling' | null): void {
    const root = document.documentElement
    clearTimeout(this.chromeTimer)
    if (state) { if (root.dataset.opening !== state) root.dataset.opening = state }
    else delete root.dataset.opening
  }
  private chromeTimer: ReturnType<typeof setTimeout> | undefined
  private stepOpening(places: readonly { orbit: number }[]): OpeningState {
    const o = this.opening
    if (!o) return SETTLED
    if (o.start === null && document.documentElement.dataset.boot !== 'loading') o.start = performance.now()
    const at = this.openingAt ?? (o.start === null ? -1 : (performance.now() - o.start) / 1000)
    const state = openingState(at, o.mode, places.length, o.pace)
    if (state.done) {
      this.opening = null
      // Let the controls' fade in finish, then drop the attribute.
      this.chromeTimer = setTimeout(() => this.chrome(null), 600)
      return SETTLED
    }
    if (state.chrome > 0) { if (document.documentElement.dataset.opening !== 'settling') this.chrome('settling') }
    else this.chrome('playing')
    return state
  }
  private laneCache: number[] = []
  /** Each world's lane, innermost first: the order the opening brings them in. */
  private lanes(places: readonly { orbit: number; parent?: number }[]): number[] {
    if (this.laneCache.length !== places.length) {
      // A moon shares its planet's orbit: it comes in just after its planet.
      const order = places.map((p, i) => i).sort((a, b) => places[a].orbit - places[b].orbit || (places[a].parent !== undefined ? 1 : 0) - (places[b].parent !== undefined ? 1 : 0))
      this.laneCache = []; order.forEach((index, lane) => { this.laneCache[index] = lane })
    }
    return this.laneCache
  }
  /** The flat wordmark, drawn by the browser over the canvas (see WordmarkOverlay). */
  private markOverlay: WordmarkOverlay | null = null
  private markCrisp: WordmarkCrisp | null = null
  /** performance.now() when the in-space wordmark was first drawn this showing, for its fade in. */
  private markStart: number | null = null
  private markMode = 0
  /**
   * The wordmark in space (lobby.wordmark above 0): where it stands this frame, seen from a
   * rig that trails the camera, how large it is on screen, and whether it is still moving
   * (the rig catching up, or the fade in), which keeps frames coming.
   */
  private stepMark(elapsed: number, still: boolean): { mode: number; placement: ReturnType<typeof placeWordmark> | null; pixelsPerUnit: number; opacity: number; moving: boolean } {
    const mode = placementOf(wordmarkPlacement.value), layout = this.options.logo?.()
    const none = { mode: 0, placement: null, pixelsPerUnit: 0, opacity: 0, moving: false }
    if (mode !== this.markMode) { this.markMode = mode; this.markStart = null; this.markRig.pose = null; this.wake = 2 }
    // The name in space needs only the field's shader to have built. Without it (the device's
    // WebGL2 cannot compile or link it) the flat vector mark stands in, and the reason is kept
    // in the startup diagnostics. Neither time nor precision decides this: an 8-bit field
    // draws the name as well (wordmarkField.ts), and a slow bake is a one-off cost.
    const field = this.logo?.distanceField
    if (mode > 0 && this.canvas && !field?.ok) noteWordmarkFallback(!this.logo ? 'the lobby logo could not start (WebGL2 shader failed)' : 'the wordmark field shader failed to build')
    if (mode <= 0 || !field?.ok || !layout || !this.canvas) return none
    const goal = { yaw: this.yaw, pitch: this.pitch, reach: this.reach, target: [...this.target] as [number, number, number] }
    const held = still || this.reduced.matches
    const rigMoving = this.markRig.step(goal, elapsed, held)
    // The HTML logo box, in the shader's q units.
    const sx = this.canvas.width / Math.max(1, this.host.clientWidth), sy = this.canvas.height / Math.max(1, this.host.clientHeight)
    const minSide = Math.min(this.canvas.width, this.canvas.height) * this.framing[2], box = layout.box
    const fx = (box.x + box.width / 2) * sx, fy = this.canvas.height - (box.y + box.height / 2) * sy
    const screen = { x: (fx - this.framing[0] * this.canvas.width) / minSide * 2, y: (fy - this.framing[1] * this.canvas.height) / minSide * 2, unit: box.height * sy / minSide * 2 }
    // The system's size, out to the far edge of the outermost world: what the in-system placements are sized by.
    const system = Math.max(...orbitLayout(this.options.worlds.map(bodyOf), 0).map(p => p.reach + p.radius), INNER)
    const placement = placeWordmark(mode, poseView(this.markRig.pose!, VIEW_TAN), screen, system)
    if (!this.markCrisp && wordmarkCrispPass.value && this.canvas) {
      this.markCrisp = new WordmarkCrisp(VERTEX, FRAGMENT, UNIFORMS)
      this.canvas.after(this.markCrisp.canvas)
    }
    const now = performance.now()
    if (this.markStart === null) this.markStart = held ? now - 1e6 : now
    const t = Math.min(1, (now - this.markStart) / 1500), opacity = t * t * (3 - 2 * t)
    return { mode, placement, pixelsPerUnit: box.height * sy * 1.1, opacity, moving: rigMoving || opacity < 1 }
  }
  /** For tests and screenshots: the in-space wordmark's state. */
  private markView: { eye: Vec; forward: Vec; right: Vec; up: Vec; tan: number } | null = null
  private markPlaced: ReturnType<typeof placeWordmark> | null = null
  /** Where the in-space wordmark is on screen now, in CSS pixels of the host (its bounding box), or null. */
  wordmarkScreenBox(): { x: number; y: number; width: number; height: number } | null {
    const p = this.markPlaced, v = this.markView
    if (!p || !v) return null
    const width = this.host.clientWidth, height = this.host.clientHeight, short = Math.min(width, height) * this.framing[2]
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 2; j++) {
      const w = surfacePoint(p, (i / 8 - 0.5) * ASPECT, j / 2 - 0.5), d = sub(w, v.eye), z = Math.max(0.001, dot(d, v.forward))
      const x = width * this.framing[0] + dot(d, v.right) / (z * v.tan) * short / 2, y = height * (1 - this.framing[1]) - dot(d, v.up) / (z * v.tan) * short / 2
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  }
  wordmarkStats() { const f = this.logo?.distanceField; return { mode: this.markMode, fieldDensity: f?.density ?? 0, fieldBakes: f?.bakes ?? 0, fieldBakeMs: f?.lastBakeMs ?? 0, rig: this.markRig.pose } }
  /** Fly to a world, as a tap on it does. */
  choose(id: string): void { this.handled = performance.now();
    this.wake = 2; const index = this.options.worlds.findIndex(world => world.id === id)
    if (index < 0 || index >= MAX) return
    // Without a context there is no flight to wait for: arrive at once.
    if (!this.gl) { this.options.onArrive(id); return }
    this.chosen = index; this.arriving = 0; this.arrived = false; this.settleTilt()
    // The name goes the way it came, from this instant: see leavingMark.
    this.leaving ??= performance.now(); this.returning = null; this.opening = null; this.chrome(null)
    // Settle on the lit side, a quarter turn off the sun, on whichever side the view is now.
    const at = this.places(this.clock)[index].position, sun = Math.atan2(-at[0], -at[2])
    const settle = approach(sun, this.spin(index, this.clock), this.yaw); this.facing = settle.facing; this.facingSide = settle.side
    // Its full-size map, ahead of anything else waiting, for the close view and the dive.
    const world = this.options.worlds[index]
    if (!world.forming) this.request(world, CLOSE, true)
  }
  private padButtons: boolean[] = []
  private focusIndex = -1
  /** The view controls are active only on the unobstructed galaxy. */
  private get controllable(): boolean { return this.active && this.backdrop === 1 && !this.flight && this.chosen < 0 }
  private orbit(x: number, y: number, zoom: number): void { this.handled = performance.now();
    // Keys and sticks move the aim; the view eases after it as it does after a finger.
    this.wake = 2; this.adopt()
    const yaw = this.swingYaw, pitch = this.swingPitch
    yaw.aim += x; yaw.aimSpeed = 0
    pitch.aim = Math.min(PITCH_HIGH, Math.max(PITCH_LOW, pitch.aim + y)); pitch.aimSpeed = 0
    this.distance = Math.min(this.farthest, Math.max(6, this.distance * Math.exp(zoom)))
  }
  /** Shown turn and tilt as last stepped: anything else that writes them is in control. */
  private shown = { yaw: NaN, pitch: NaN }
  /**
   * Take over the view as it is if something else moved it since the last step: a flight, the
   * settle round a chosen world, the first framing. Whatever was coasting stops, so the spring
   * never fights the camera's own moves.
   */
  private adopt(): void {
    if (this.yaw === this.shown.yaw && this.pitch === this.shown.pitch) return
    this.swingYaw = { aim: this.yaw, aimSpeed: 0, view: this.yaw, viewSpeed: 0 }
    this.swingPitch = { aim: this.pitch, aimSpeed: 0, view: this.pitch, viewSpeed: 0 }
    this.shown = { yaw: this.yaw, pitch: this.pitch }
  }
  /** Stop any coast; a tilt left past its limit still springs back onto it. */
  private settleTilt(): void { this.swingYaw.aimSpeed = 0; this.swingPitch.aimSpeed = 0 }
  private get swingResting(): boolean { return swingResting(this.swingYaw) && swingResting(this.swingPitch) }
  /** Step the view's spring and coast by the real time since the last frame. */
  private swing(elapsed: number, drift: boolean, restElapsed = elapsed): void {
    // A flight or the settle round a chosen world writes the view itself; adopt() hands it over.
    this.adopt()
    // Left alone, the view drifts very slowly round, aim and view together.
    if (drift) { const turn = 0.018 * Math.min(0.1, elapsed); this.swingYaw.aim += turn; this.swingYaw.view += turn }
    const dt = Math.min(0.25, elapsed), held = this.drag !== null
    // Left alone on the whole system, the tilt settles to the resting view: aim and view
    // together, as the drift moves them, so the spring stays at rest and nothing fights.
    // Never under reduced motion, never round a chosen world, never while anything else moves.
    this.resting = false
    if (!this.reduced.matches && this.chosen < 0 && !this.flight && !held && this.pointers.size === 0 && this.backdrop === 1 && this.swingResting) {
      const tilt = restStep(this.swingPitch.view, (performance.now() - this.handled) / 1000, restElapsed, this.options.still?.() ? REST_LOW : REST)
      if (tilt !== this.swingPitch.view) { this.swingPitch.aim = this.swingPitch.view = tilt; this.resting = true }
    }
    if (this.reduced.matches) {
      // No spring, coast or stretch: the view is where the finger or key put it, within limits.
      const pitch = Math.min(PITCH_HIGH, Math.max(PITCH_LOW, this.swingPitch.aim))
      this.swingYaw = { aim: this.swingYaw.aim, aimSpeed: 0, view: this.swingYaw.aim, viewSpeed: 0 }
      this.swingPitch = { aim: pitch, aimSpeed: 0, view: pitch, viewSpeed: 0 }
    } else if (!this.swingResting) {
      this.swingYaw = swingStep(this.swingYaw, dt, held)
      this.swingPitch = swingStep(this.swingPitch, dt, held, PITCH_LOW, PITCH_HIGH)
    }
    this.yaw = this.swingYaw.view; this.pitch = this.swingPitch.view
    this.shown = { yaw: this.yaw, pitch: this.pitch }
  }
  private key(event: KeyboardEvent): void {
    if (!this.controllable || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target
    if (target instanceof HTMLElement && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))) return
    const moves: Record<string, [number, number, number]> = {
      ArrowLeft: [-0.08, 0, 0], ArrowRight: [0.08, 0, 0],
      ArrowUp: [0, 0.06, 0], ArrowDown: [0, -0.06, 0],
      '+': [0, 0, -0.08], '=': [0, 0, -0.08], '-': [0, 0, 0.08],
    }
    const move = moves[event.key]
    if (move) { event.preventDefault(); this.orbit(...move) }
  }
  private controller(seconds: number): void {
    const pad = navigator.getGamepads?.().find(p => p?.connected && p.mapping === 'standard')
    if (!pad) { this.padButtons = []; return }
    const buttons = pad.buttons.map(button => button.pressed)
    const pressed = (index: number) => buttons[index] && !this.padButtons[index]
    if (this.controllable) {
      const axis = (index: number) => { const v = pad.axes[index] ?? 0; return Math.abs(v) > 0.18 ? v : 0 }
      const x = axis(0), y = axis(1), zoom = axis(3)
      if (x || y || zoom) this.orbit(x * seconds * 1.6, -y * seconds * 1.2, zoom * seconds)
      const count = Math.min(MAX, this.options.worlds.length)
      if (count && (pressed(14) || pressed(15) || pressed(4) || pressed(5))) {
        const next = pressed(15) || pressed(5)
        this.focusIndex = this.focusIndex < 0 ? (next ? 0 : count - 1) : (this.focusIndex + (next ? 1 : -1) + count) % count
        for (let tries = 0; tries < count - 1 && !this.screen.find(p => p.id === this.options.worlds[this.focusIndex].id)?.visible; tries++) this.focusIndex = (this.focusIndex + (next ? 1 : -1) + count) % count
        this.options.onFocus?.(this.options.worlds[this.focusIndex].id)
      }
      if (count && pressed(0)) {
        const index = this.focusIndex < 0 ? 0 : this.focusIndex, id = this.options.worlds[index].id
        if (!this.options.onTap?.(id)) this.choose(id)
      }
    }
    this.padButtons = buttons
  }
  /** Which world a pointer is over (on its disc, or just off it as a tap would pick), told to the labels when it changes. */
  private pointed: string | undefined
  private pointAt(id: string | undefined): void { if (id !== this.pointed) { this.pointed = id; this.wake = 2; this.options.onPoint?.(id) } }
  private point(event: PointerEvent): void {
    // A mouse hovers; a finger only points while it is down. A drag is not pointing.
    if (event.pointerType !== 'mouse' && event.type !== 'pointerdown' && !this.pointers.has(event.pointerId)) return
    if (this.drag?.moved) { this.pointAt(undefined); return }
    const box = this.canvas.getBoundingClientRect()
    this.pointAt(pickWorld(this.screen, event.clientX - box.left, event.clientY - box.top, event.pointerType === 'mouse' ? 6 : 16))
  }
  private down(event: PointerEvent): void { this.handled = performance.now(); this.point(event);
    this.canvas.setPointerCapture(event.pointerId); this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (this.pointers.size === 1) {
      // A finger stops a coast where it is, and picks up a stretched tilt where it shows.
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; this.adopt()
      const pitch = this.swingPitch; pitch.aim = pitch.view; pitch.aimSpeed = 0; this.swingYaw.aim = this.swingYaw.view; this.swingYaw.aimSpeed = 0
      const edge = pitch.aim > PITCH_HIGH ? PITCH_HIGH : pitch.aim < PITCH_LOW ? PITCH_LOW : pitch.aim
      this.pull = { pitch: edge + rubberPull(pitch.aim - edge), yaw: 0 }
      this.trail = [{ t: event.timeStamp, yaw: 0, pitch: this.pull.pitch }]
    }
    else if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = Math.hypot(a.x - b.x, a.y - b.y); this.drag = null; this.settleTilt() }
  }
  private move(event: PointerEvent): void {
    const point = this.pointers.get(event.pointerId); if (!point) return
    // A pointer that is down, not one merely passing over, counts as handling the view.
    this.wake = 2; this.handled = performance.now()
    const dx = event.clientX - point.x, dy = event.clientY - point.y; point.x = event.clientX; point.y = event.clientY
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()], gap = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.pinch > 0 && this.chosen < 0) this.distance = Math.min(this.farthest, Math.max(6, this.distance * this.pinch / Math.max(1, gap)))
      this.pinch = gap; return
    }
    if (!this.drag || this.drag.id !== event.pointerId) return
    if (Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) > 7) this.drag.moved = true
    if (!this.drag.moved) return
    this.adopt()
    const yaw = this.swingYaw, pitch = this.swingPitch, turn = -dx * 0.006, tilt = dy * 0.005
    this.pull.pitch += tilt; this.pull.yaw += turn; yaw.aim += turn
    // Where the finger has been lately, for its speed when it lets go.
    this.trail.push({ t: event.timeStamp, yaw: this.pull.yaw, pitch: this.pull.pitch })
    while (this.trail.length > 2 && this.trail[1].t < event.timeStamp - 150) this.trail.shift()
    if (this.reduced.matches) this.pull.pitch = Math.min(PITCH_HIGH, Math.max(PITCH_LOW, this.pull.pitch))
    pitch.aim = softLimit(this.pull.pitch, PITCH_LOW, PITCH_HIGH)
  }
  private up(event: PointerEvent, tap: boolean): void { this.handled = performance.now(); if (event.pointerType !== 'mouse') this.pointAt(undefined);
    this.pointers.delete(event.pointerId)
    const drag = this.drag; if (!drag || drag.id !== event.pointerId) return
    this.drag = null
    // Let go: the aim coasts at the finger's speed, faded if the finger had paused. Past a
    // tilt limit it springs back instead. Reduced motion has no coast.
    if (drag.moved && !this.reduced.matches) {
      const at = event.timeStamp, pitch = this.swingPitch
      const yawSpeed = releaseSpeed(this.trail.map(s => ({ t: s.t, value: s.yaw })), at), pitchSpeed = releaseSpeed(this.trail.map(s => ({ t: s.t, value: s.pitch })), at)
      this.swingYaw.aimSpeed = Math.max(-8, Math.min(8, yawSpeed * 0.7))
      const inside = pitch.aim <= PITCH_HIGH && pitch.aim >= PITCH_LOW
      pitch.aimSpeed = inside ? Math.max(-4, Math.min(4, pitchSpeed * 0.7)) : 0
    }
    if (drag.moved || !tap) return
    // A tap: the nearest world under the finger, with a generous margin on small screens.
    const box = this.canvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top
    const found = pickWorld(this.screen, x, y)
    if (found) { if (!this.options.onTap?.(found)) this.choose(found) } else if (this.chosen >= 0 && !this.flight) this.home()
  }
  dispose(): void { this.presence.dispose(); this.active = false; this.abort.abort(); this.resizeObserver.disconnect(); this.release() }
}
