/**
 * The wordmark as an object in the lobby galaxy's space, for the owner to choose between
 * (`lobby.wordmark`; 0, the flat mark over the scene, stays the default):
 *
 *   1. Behind: a large, distant panel standing behind the sun and above the orbital plane.
 *      The sun is between it and the camera, so its face is lit by the sun, warmest at the
 *      middle, and planets that pass between them throw their shadows across the letters.
 *      The shafts stream in front of it; over the letters they are thinner, so they read as
 *      passing between them.
 *   2. Front: where the flat mark is, but standing in space between the camera and the sun.
 *      Backlit: a dark face with a rim of light on the edges that face the sun, and the
 *      letters cut the shafts rising past them, so rays break round the silhouette.
 *   3. Lit by the rays: placed as Behind, but the letters are a thin veil that catches the
 *      shafts, so the name is drawn in the god rays themselves: brightest where a shaft
 *      falls, moving as they move, and crossed by the shadows worlds cut through them.
 *      (An eclipse, the sun behind the ring of the 3/H, was tried first: the letters round
 *      the sun blacked out most of the shafts and hid the inner worlds.)
 *
 * Drawn inside the galaxy's one ray-traced pass: the ray meets the wordmark's plane, and the
 * plane's coordinates sample the same distance field the flat mark uses (wordmarkField.ts),
 * so edges are antialiased the same way and the silhouette is exact. No extra pass, no mesh.
 *
 * Placement: at rest the plane projects exactly onto the HTML logo box, so the page layout decides where it
 * sits on every screen. It is placed from a camera rig that trails the real camera
 * (WordmarkRig), so while the player drags, the panel stays put in space and parallaxes
 * against the sun and worlds by its real depth, then drifts back to its place.
 */
import { defineParam } from '../../../shared/params'
import { FIELD_GLSL } from './wordmarkField'
import { wordmarkContours } from './wordmarkMesh'

export const wordmarkPlacement = defineParam({
  id: 'lobby.wordmark', label: 'Lobby wordmark: 7 along an orbit (the lobby); 0 flat, 1 behind the sun, 2 in front, 3 lit by the rays, 4 rays far, 6 standing', group: 'Graphics', scope: 'client',
  default: 7, min: 0, max: 7, step: 1,
})
/** The in-space letters drawn at the screen's full resolution by their own pass (WordmarkCrisp). */
export const wordmarkCrispPass = defineParam({ id: 'lobby.wordmarkCrisp', label: 'Lobby wordmark in space at full resolution', group: 'Graphics', scope: 'client', default: true })
/**
 * Placements' names, for the preview chooser, by value. 5 (lying on the plane) and 8 (inscribed
 * round the rim) were tried and removed: at the lobby's tilt, text lying in the plane is too
 * foreshortened to read. 5 now means 7.
 */
export const PLACEMENTS: readonly (readonly [number, string])[] = [[7, 'Along an orbit'], [0, 'Flat'], [1, 'Behind'], [2, 'Front'], [3, 'Rays'], [4, 'Rays, far'], [6, 'Standing']]
/** A value the lobby can draw: anything else is the default, Along an orbit. */
export const placementOf = (value: number) => PLACEMENTS.some(([v]) => v === Math.round(value)) ? Math.round(value) : 7
/**
 * The surface a placement draws on. 0: a flat panel (centre, right, up). 1: part of an upright
 * cylinder round the sun (letters along an orbit): its radius, the bearing of the letters'
 * middle, world units per wordmark unit, the middle's height, and which way along the arc
 * reads left to right.
 */
export interface Shape { kind: 0 | 1; radius: number; bearing: number; size: number; offset: number; flip: number }

export type Vec3 = [number, number, number]
export interface View { eye: Vec3; forward: Vec3; right: Vec3; up: Vec3; tan: number }
/** A box on screen in the galaxy shader's q units (-1 to 1 on the short side, y up). */
export interface ScreenBox { x: number; y: number; /** q units per wordmark unit (the box height). */ unit: number }
export interface Placement { centre: Vec3; right: Vec3; up: Vec3; /** Distance from the sun to the centre. */ sunDistance: number; shape: Shape }

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]

/**
 * Between the letters' feet and the underline bar, in wordmark units. The shafts' mask leaves
 * the bar out: it spans the whole mark, so with the sun below it would stop every ray and
 * none could break between the letters.
 */
export const BAR_LINE: number = (() => {
  const boxes = wordmarkContours().map(c => ({ low: Math.min(...c.points.map(p => p[1])), high: Math.max(...c.points.map(p => p[1])) }))
  const bar = boxes.reduce((a, b) => (b.low < a.low ? b : a))
  const feet = Math.min(...boxes.filter(b => b !== bar).map(b => b.low))
  return (bar.high + feet) / 2
})()

/** Where the wordmark stands for a placement, seen from `view` (the rig, not the live camera). */
export function placeWordmark(mode: number, view: View, box: ScreenBox, system = 10): Placement {
  if (mode >= 4) return placeInSystem(mode, view, system)
  const sunZ = Math.max(0.5, -dot(view.eye, view.forward))
  let z = sunZ, unit = box.unit
  const x = box.x, y = box.y
  if (mode === 2) z = sunZ * 0.6
  else { z = sunZ * 1.9; unit *= 1.1 }
  const ray = add(view.forward, add(scale(view.right, x), view.up, y), view.tan)
  const centre = add(view.eye, ray, z), size = unit * view.tan * z
  return { centre, right: scale(view.right, size), up: scale(view.up, size), sunDistance: Math.hypot(...centre), shape: FLAT }
}
const FLAT: Shape = { kind: 0, radius: 0, bearing: 0, size: 1, offset: 0, flip: 1 }

/**
 * The placements that belong to the solar system (4 and up), sized by its outer orbit
 * (`system`, world units) and set on its far side as seen from the rig, so the planets and
 * their orbit lines pass in front.
 */
function placeInSystem(mode: number, view: View, system: number): Placement {
  // Far is away from the camera, along the plane; side is the camera's right, on the plane.
  const flat = Math.hypot(view.eye[0], view.eye[2]) || 1
  const far: Vec3 = [-view.eye[0] / flat, 0, -view.eye[2] / flat], side: Vec3 = [-far[2], 0, far[0]]
  const sideways = dot(side, view.right) >= 0 ? side : scale(side, -1)
  const up: Vec3 = [0, 1, 0], bearing = Math.atan2(far[2], far[0])
  // Along increasing bearing, which way is the camera's right: the arc must read left to right.
  const flip = dot([-Math.sin(bearing), 0, Math.cos(bearing)], view.right) >= 0 ? 1 : -1
  // Which side of the plane the name stands on: the camera's. Seen from below, it floats down
  // below the planets. It glides through the plane over a band of the camera's elevation, so
  // there is no pop, and hovering near edge-on moves it only a little, never flips it.
  const level = planeSide(view)
  const panel = (centre: Vec3, size: number): Placement => ({ centre, right: scale(sideways, size), up: scale(up, size), sunDistance: Math.hypot(...centre), shape: FLAT })
  if (mode === 4) {
    // Rays, far: a distant structure well behind the sun, its foot a little off the plane.
    const size = system * 0.62
    return panel(add(scale(far, system * 2.6), up, size * 0.68 * level), size)
  }
  if (mode === 6) {
    // Standing: upright at the far edge of the system, its foot on the plane.
    const size = system * 0.72
    return panel(add(scale(far, system * 2.6), up, size * 0.5 * level), size)
  }
  // Along an orbit: upright on a circle beyond the outer orbit, following its curve.
  const size = system * 0.72
  // Below the plane it hangs a little lower than it stands above, clear of the labels, which
  // sit under their worlds there. Both are zero at edge-on, so the glide is continuous.
  const shape: Shape = { kind: 1, radius: system * 2.6, bearing, size, offset: size * (level >= 0 ? 0.52 : 0.8) * level, flip }
  return { centre: add(scale(far, shape.radius), up, shape.offset), right: scale(sideways, size), up: scale(up, size), sunDistance: Math.hypot(...add(scale(far, shape.radius), up, shape.offset)), shape }
}

/**
 * While a lobby panel is open the name moves up a little and grows a little smaller, so the
 * panel can stand beneath it on the same curved wall (LobbySheet.ts). `lift` runs 0 (at rest)
 * to 1 (a panel open); the rise is in the name's own heights.
 */
export const LIFT_SCALE = 0.55, LIFT_RISE = 0.66
export function liftPlacement(p: Placement, lift: number): Placement {
  if (!(lift > 0)) return p
  const k = 1 - (1 - LIFT_SCALE) * lift, height = Math.hypot(...p.up), rise = height * LIFT_RISE * lift
  if (p.shape.kind === 1) {
    const shape: Shape = { ...p.shape, size: p.shape.size * k, offset: p.shape.offset + rise }
    const centre: Vec3 = [p.centre[0], shape.offset, p.centre[2]]
    return { centre, right: scale(p.right, k), up: scale(p.up, k), sunDistance: Math.hypot(...centre), shape }
  }
  const centre = add(p.centre, scale(p.up, 1 / height), rise)
  return { centre, right: scale(p.right, k), up: scale(p.up, k), sunDistance: Math.hypot(...centre), shape: p.shape }
}

/** The band of the camera's elevation, in radians either side of edge-on, the name glides through the plane over. */
export const PLANE_BAND = 0.12
/** +1 with the camera above the plane, -1 below, eased through edge-on. */
export function planeSide(view: View): number {
  const elevation = Math.asin(Math.max(-1, Math.min(1, view.eye[1] / (Math.hypot(...view.eye) || 1))))
  const x = Math.max(0, Math.min(1, (elevation + PLANE_BAND) / (2 * PLANE_BAND)))
  return x * x * (3 - 2 * x) * 2 - 1
}

/** The point in space of a wordmark point (wordmark units) on a placement's surface. */
export function surfacePoint(p: Placement, x: number, y: number): Vec3 {
  const s = p.shape
  if (s.kind === 0) return add(add(p.centre, p.right, x), p.up, y)
  const bearing = s.bearing + x * s.size / s.radius * s.flip
  return [Math.cos(bearing) * s.radius, s.offset + y * s.size, Math.sin(bearing) * s.radius]
}

/** The camera's pose, as the galaxy keeps it. */
export interface Pose { yaw: number; pitch: number; reach: number; target: Vec3 }
/** Pose to view, the galaxy's own formula (Galaxy.camera). */
export function poseView(pose: Pose, tan: number): View {
  const cp = Math.cos(pose.pitch), eye: Vec3 = [pose.target[0] + Math.sin(pose.yaw) * cp * pose.reach, pose.target[1] + Math.sin(pose.pitch) * pose.reach, pose.target[2] + Math.cos(pose.yaw) * cp * pose.reach]
  const f = add(pose.target, eye, -1), fl = Math.hypot(...f), forward = scale(f, 1 / fl)
  const r: Vec3 = [-forward[2], 0, forward[0]], rl = Math.hypot(...r) || 1, right = scale(r, 1 / rl)
  const up: Vec3 = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]]
  return { eye, forward, right, up, tan }
}

/**
 * A copy of the camera's pose that eases after it: the wordmark is placed from this, so it
 * holds still in space while the view swings, then glides back to its place. It never falls
 * more than LAG radians behind on the turn, or TILT_LAG on the tilt, so it stays on screen.
 */
export class WordmarkRig {
  pose: Pose | null = null
  private static readonly SECONDS = 0.9
  private static readonly LAG = 0.18
  private static readonly TILT_LAG = 0.1
  /** Steps toward `goal`; returns true while it is still moving. `instant` (reduced motion, a first frame) jumps there. */
  step(goal: Pose, dt: number, instant: boolean): boolean {
    if (!this.pose || instant) { this.pose = { ...goal, target: [...goal.target] }; return false }
    const p = this.pose, k = 1 - Math.exp(-Math.max(0, dt) / WordmarkRig.SECONDS)
    let yaw = goal.yaw - p.yaw; yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw))
    yaw = Math.max(-WordmarkRig.LAG, Math.min(WordmarkRig.LAG, yaw * (1 - k)))
    p.yaw = goal.yaw - yaw
    p.pitch = goal.pitch - Math.max(-WordmarkRig.TILT_LAG, Math.min(WordmarkRig.TILT_LAG, (goal.pitch - p.pitch) * (1 - k))); p.reach += (goal.reach - p.reach) * k
    p.target = [p.target[0] + (goal.target[0] - p.target[0]) * k, p.target[1] + (goal.target[1] - p.target[1]) * k, p.target[2] + (goal.target[2] - p.target[2]) * k]
    const settled = Math.abs(yaw) < 1e-4 && Math.abs(goal.pitch - p.pitch) < 1e-4 && Math.abs(goal.reach - p.reach) < 1e-4 * goal.reach && Math.hypot(...add(goal.target, p.target, -1)) < 1e-4 * goal.reach
    if (settled) this.pose = { ...goal, target: [...goal.target] }
    return !settled
  }
}

/**
 * GLSL for the galaxy's fragment shader, before main: the field, the wordmark's uniforms, and
 * markHit (where a ray meets the plane, in wordmark units, and how far along the ray) and
 * markShadow (the share of the light from the sun's point on the plane to this one that the
 * letters stop).
 */
export const WORDMARK_SCENE_GLSL = `
${FIELD_GLSL}
uniform int uMarkMode; // 1 behind the sun, 2 in front of it, 3 and up lit by the shafts (see placeWordmark)
uniform vec4 uMarkShape; uniform vec2 uMarkShape2;  // Shape: kind, radius, bearing, size; offset, flip
uniform int uMarkModePad; uniform vec3 uMarkCentre, uMarkRight, uMarkUp; uniform float uMarkOpacity, uMarkSun;
vec3 markHit(vec3 eye, vec3 dir) {
  vec3 n = cross(uMarkRight, uMarkUp); float den = dot(dir, n);
  float t = abs(den) > 1e-9 ? dot(uMarkCentre - eye, n) / den : -1.0;
  vec3 p = eye + dir * t - uMarkCentre;
  return vec3(dot(p, uMarkRight) / dot(uMarkRight, uMarkRight), dot(p, uMarkUp) / dot(uMarkUp, uMarkUp), t);
}
// Where a ray meets the wordmark's surface, whichever shape it is: model x, y and the distance.
vec3 markSurface(vec3 eye, vec3 dir) {
  if (uMarkShape.x < 0.5) return markHit(eye, dir);
  float radius = uMarkShape.y, size = uMarkShape.w;
  // The far wall of an upright cylinder round the sun: the larger root.
  float a = dot(dir.xz, dir.xz), b = dot(eye.xz, dir.xz), c = dot(eye.xz, eye.xz) - radius * radius, disc = b * b - a * c;
  if (disc < 0.0 || a < 1e-9) return vec3(0.0, 0.0, -1.0);
  float t = (-b + sqrt(disc)) / a; vec3 p = eye + dir * t;
  float turn = atan(p.z, p.x) - uMarkShape.z; turn = mod(turn + 3.14159265, 6.2831853) - 3.14159265;
  float along = turn * radius / size * uMarkShape2.y;
  float across = (p.y - uMarkShape2.x) / size;
  return vec3(along, across, t);
}
float markShadow(vec2 from, vec2 to) {
  // Only the stretch of the line inside the field can be blocked: clip it to the field's
  // rectangle first, so every sample falls where letters can be.
  vec2 dir = to - from, lo = uFieldBounds.xy, hi = uFieldBounds.xy + uFieldBounds.zw;
  vec2 inv = 1.0 / (abs(dir) + 1e-7) * sign(dir + 1e-9);
  vec2 t0 = (lo - from) * inv, t1 = (hi - from) * inv;
  float enter = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), 0.0), leave = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), 1.0);
  if (leave <= enter) return 0.0;
  // A shaft is stopped by the first letter it crosses: the deepest cover along the line.
  // The shadow is sharp just past a letter and widens with distance beyond it, and the
  // samples are jittered per pixel so their spacing never shows as bands.
  float blocked = 0.0, span = length(dir), jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  for (int i = 0; i < 20; i++) {
    float t = mix(enter, leave, (float(i) + jitter) / 20.0), soft = 0.008 + 0.05 * (1.0 - t) * span;
    vec2 p = from + dir * t;
    if (p.y > ${BAR_LINE.toFixed(4)}) blocked = max(blocked, 1.0 - smoothstep(-soft, soft, wordmarkDistance(p)));
  }
  return blocked;
}`
