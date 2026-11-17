import type { LoftDesign } from './design'
import type { Arches, HullKeys, HullParam } from './hull'
import { HULL } from './dataHull'
import { FEATURES, type Features } from './dataFeatures'

/**
 * Editor handles for the loft body: the proof of concept for a player-facing vehicle designer.
 *
 * Each handle is a named, bounded change to the fitted design (dataHull.ts, dataFeatures.ts),
 * applied by `applyHandles`. All at 0 is the fitted buggy. The buggy's mechanical layout does
 * not move (wheel hubs, arm mounts, shock tops, the parts' lamp lens and the driver's eye), so
 * the ranges stop where a body would collide with it; tools/buggy-fit/sections/editorCheck.ts
 * tests every range end and random settings. Units are metres unless the help says otherwise.
 */
export interface EditorHandle { id: string; label: string; group: string; help: string; min: number; max: number; step: number }

export const EDITOR_HANDLES = [
  // Stance
  { id: 'noseLength', label: 'Nose length', group: 'Stance', help: 'Stretches the body ahead of the front axle.', min: -.12, max: .12, step: .01 },
  { id: 'tailLength', label: 'Tail length', group: 'Stance', help: 'Stretches the body behind the rear axle.', min: -.15, max: .3, step: .01 },
  { id: 'width', label: 'Width', group: 'Stance', help: 'Scales the body\'s width (fraction).', min: -.04, max: .1, step: .01 },
  { id: 'ride', label: 'Floor height', group: 'Stance', help: 'Raises or lowers the floor between the axles.', min: -.04, max: .1, step: .01 },
  // Hull lines
  { id: 'deck', label: 'Deck height', group: 'Hull lines', help: 'Raises the whole deck: shoulders, valley and crown.', min: -.08, max: .2, step: .01 },
  { id: 'fender', label: 'Fender height', group: 'Hull lines', help: 'Raises the fender line over the deck.', min: -.06, max: .14, step: .01 },
  { id: 'crown', label: 'Crown', group: 'Hull lines', help: 'Raises the centre of the deck against its sides.', min: -.08, max: .14, step: .01 },
  { id: 'belt', label: 'Belt line', group: 'Hull lines', help: 'Moves the widest line up or down the side.', min: -.08, max: .06, step: .01 },
  { id: 'tumble', label: 'Tumblehome', group: 'Hull lines', help: 'Narrows the floor against the widest line (fraction).', min: -.2, max: .25, step: .05 },
  { id: 'noseDrop', label: 'Nose drop', group: 'Hull lines', help: 'Lowers the deck toward the nose.', min: -.08, max: .14, step: .01 },
  { id: 'tailKick', label: 'Tail kick', group: 'Hull lines', help: 'Raises the deck and fins toward the tail.', min: -.08, max: .16, step: .01 },
  { id: 'archFront', label: 'Front arches', group: 'Hull lines', help: 'Swells the fenders over the front wheels.', min: -.02, max: .12, step: .01 },
  { id: 'archRear', label: 'Rear arches', group: 'Hull lines', help: 'Swells the haunches over the rear wheels.', min: -.03, max: .12, step: .01 },
  { id: 'flank', label: 'Flanks', group: 'Hull lines', help: 'Swells or pinches the sides between the wheels.', min: -.1, max: .06, step: .01 },
  // Cockpit
  { id: 'cockpitLength', label: 'Opening length', group: 'Cockpit', help: 'Lengthens the cockpit opening (fraction).', min: -.1, max: .2, step: .02 },
  { id: 'cockpitWidth', label: 'Opening width', group: 'Cockpit', help: 'Widens the cockpit opening (fraction).', min: -.06, max: .12, step: .02 },
  // Scoops
  { id: 'scoopSize', label: 'Scoop size', group: 'Scoops', help: 'Scales the side scoops (fraction).', min: -.4, max: .3, step: .05 },
  { id: 'scoopTilt', label: 'Scoop lean', group: 'Scoops', help: 'Leans the scoops back (degrees).', min: -30, max: 30, step: 5 },
  { id: 'scoopZ', label: 'Scoop position', group: 'Scoops', help: 'Moves the scoops along the body.', min: -.2, max: .2, step: .02 },
  // Lamps
  { id: 'ductSize', label: 'Headlight duct', group: 'Lamps', help: 'Grows the duct round each headlight (fraction).', min: -.1, max: .3, step: .05 },
  { id: 'tailLamp', label: 'Tail lamp length', group: 'Lamps', help: 'Lengthens the tail lamp bars (fraction).', min: -.5, max: .5, step: .1 },
  // Wing
  { id: 'wingHeight', label: 'Wing height', group: 'Wing', help: 'Raises the rear wing on its plates.', min: -.1, max: .25, step: .01 },
  { id: 'wingSpan', label: 'Wing span', group: 'Wing', help: 'Widens the rear wing (fraction).', min: -.25, max: .15, step: .05 },
  { id: 'wingChord', label: 'Wing chord', group: 'Wing', help: 'Deepens the wing front to back (fraction).', min: -.4, max: .3, step: .05 },
] as const satisfies readonly EditorHandle[]

export type EditorId = typeof EDITOR_HANDLES[number]['id']
export type Handles = Record<EditorId, number>
export const defaultHandles = (): Handles => Object.fromEntries(EDITOR_HANDLES.map(h => [h.id, 0])) as Handles
export function clampHandles(s: Partial<Handles>): Handles {
  const out = defaultHandles()
  for (const h of EDITOR_HANDLES) { const v = Number(s[h.id] ?? 0); out[h.id] = Number.isFinite(v) ? Math.min(h.max, Math.max(h.min, Math.round(v / h.step) * h.step)) : 0 }
  return out
}

const AXLE = 1.24
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** The design these handles describe. */
export function applyHandles(h: Handles, base: { hull: HullKeys; features: Features } = { hull: HULL, features: FEATURES }): LoftDesign {
  const v = base.hull.values, zs = base.hull.z, z0 = zs[0], z1 = zs[zs.length - 1]
  // Stretch beyond the axles only, so the wheelbase stays.
  const stretch = (z: number) => z < -AXLE ? z - h.noseLength * (z + AXLE) / (z0 + AXLE) : z > AXLE ? z + h.tailLength * (z - AXLE) / (z1 - AXLE) : z
  const values = {} as Record<HullParam, number[]>
  const per = (p: HullParam, f: (x: number, k: number, z: number) => number) => { values[p] = v[p].map((x, k) => f(x, k, zs[k])) }
  const w = 1 + h.width
  const between = (z: number) => 1 - smooth(.9, 1.5, Math.abs(z))
  const front = (z: number) => smooth(-.6, z0, z), rear = (z: number) => smooth(.6, z1, z)
  const lift = (z: number) => h.deck - h.noseDrop * front(z) + h.tailKick * rear(z)
  per('floorY', (x, _k, z) => x + h.ride * between(z))
  per('floorW', x => x * w * (1 - h.tumble * .5))
  per('width', x => x * w)
  // Height changes keep each section in order: lowering scales the section toward its floor
  // (so the small sections at the nose and tail shrink in proportion instead of folding), and
  // raising lifts each point in proportion to its height above the floor.
  const up = (x: number, k: number, dy: number) => {
    const f = values.floorY[k], tall = Math.max(v.crownY[k], v.shoulderY[k]) - v.floorY[k]
    return dy < 0 ? f + (x - v.floorY[k]) * Math.max(.35, 1 + dy / Math.max(tall, .05)) : x + (f - v.floorY[k]) + dy * Math.min(1, (x - v.floorY[k]) / .45)
  }
  per('widestY', (x, k, z) => up(x, k, h.belt + lift(z) * .3))
  per('shoulderX', x => x * w)
  per('shoulderY', (x, k, z) => up(x, k, lift(z) + h.fender))
  per('valleyX', x => x * w)
  per('valleyY', (x, k, z) => up(x, k, lift(z) + h.fender * .3))
  per('crownY', (x, k, z) => up(x, k, lift(z) + h.crown))
  // Keep the named points in order up the side, whatever the handles did.
  zs.forEach((_, k) => {
    values.widestY[k] = Math.max(values.widestY[k], values.floorY[k] + .03)
    values.shoulderY[k] = Math.max(values.shoulderY[k], values.widestY[k] + .02)
    values.valleyY[k] = Math.max(values.valleyY[k], values.widestY[k] + .01)
    values.crownY[k] = Math.max(values.crownY[k], values.widestY[k] + .01)
  })
  const a0 = base.hull.arches ?? { front: 0, rear: 0, flank: 0, frontZ: -AXLE, rearZ: AXLE, flankZ: .15, length: .5, flankLength: .45 }
  const arches: Arches = { ...a0, front: a0.front + h.archFront, rear: a0.rear + h.archRear, flank: a0.flank + h.flank }
  const hull: HullKeys = { z: zs.map(stretch), values, arches }

  const F = base.features, rows = (r: number[][], f: (row: number[], i: number) => number[]) => r.map(f)
  const tailZ = stretch(z1) - z1
  const wingLead = F.wing[0][0]
  const features: Features = {
    ...F,
    cockpit: { ...F.cockpit, halfLength: F.cockpit.halfLength * (1 + h.cockpitLength), halfWidth: F.cockpit.halfWidth * (1 + h.cockpitWidth) },
    scoop: { ...F.scoop, z: F.scoop.z + h.scoopZ, halfLength: F.scoop.halfLength * (1 + h.scoopSize), halfHeight: F.scoop.halfHeight * (1 + h.scoopSize), tilt: F.scoop.tilt - h.scoopTilt * Math.PI / 180 },
    head: { ...F.head, scale: F.head.scale * (1 + h.ductSize) },
    tail: { ...F.tail, halfLength: F.tail.halfLength * (1 + h.tailLamp) },
    stripeStart: stretch(F.stripeStart),
    wing: rows(F.wing, ([z, hw, t, b, y, e]) => [wingLead + tailZ + (z - wingLead) * (1 + h.wingChord), hw * (1 + h.wingSpan) * w, t, b, y + h.wingHeight + h.deck + h.tailKick, e]),
    plate: rows(F.plate, ([z, hw, t, b, y, e], i) => {
      // The plates reach from the fin to the wing whatever the wing's height and chord.
      const zz = i === 0 ? z + tailZ : wingLead + tailZ + (z - wingLead) * (1 + h.wingChord), up = h.wingHeight / 2
      return [zz, hw, t + Math.max(0, up), b + Math.max(0, up), y + h.deck + h.tailKick + up, e]
    }),
  }
  return { hull, features }
}

/** Share codes: a version character, then one URL-safe base64 character per handle (step count from its minimum). */
export const EDITOR_CODE_VERSION = 1
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
export const encodeHandles = (s: Handles) => B64[EDITOR_CODE_VERSION] + EDITOR_HANDLES.map(h => B64[Math.round((Math.min(h.max, Math.max(h.min, s[h.id])) - h.min) / h.step)]).join('')
export function decodeHandles(code: string): Handles {
  const d = [...code].map(ch => B64.indexOf(ch))
  if (d[0] !== EDITOR_CODE_VERSION || d.length !== EDITOR_HANDLES.length + 1 || d.some(x => x < 0)) return defaultHandles()
  const s: Partial<Handles> = {}
  EDITOR_HANDLES.forEach((h, i) => { s[h.id] = h.min + d[i + 1] * h.step })
  return clampHandles(s)
}

/** mulberry32, as in LoadedBuggySkin.ts. */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** One integer to an in-range setting; each handle favours the middle of its range. */
export function seedHandles(seed: number): Handles {
  const r = mulberry32(seed >>> 0), s: Partial<Handles> = {}
  for (const h of EDITOR_HANDLES) s[h.id] = h.min + (h.max - h.min) * (r() + r()) / 2
  return clampHandles(s)
}

/**
 * Vehicles that are deliberately not this buggy, as handle values only. They keep the buggy's
 * wheels, arms, shocks, lamp lenses and cockpit, which is what holds them back (see the README).
 */
export const PRESETS: Record<string, { name: string; notes: string; handles: Partial<Handles> }> = {
  streamliner: { name: 'Streamliner', notes: 'Long and low: stretched nose and tail, a flat deck, small arches, a low wing.', handles: { noseLength: .12, tailLength: .3, deck: -.08, fender: -.06, crown: -.02, belt: -.04, noseDrop: .1, tailKick: -.04, archFront: -.03, archRear: -.03, flank: .04, cockpitLength: .2, cockpitWidth: -.06, scoopSize: -.2, scoopTilt: -30, wingHeight: -.1, wingSpan: -.25, wingChord: .3, tumble: .2 } },
  crawler: { name: 'Rock crawler', notes: 'Short and tall: cut back nose and tail, a high boxy deck, big arches, pinched flanks.', handles: { noseLength: -.12, tailLength: -.15, ride: .1, deck: .2, fender: .14, crown: -.06, belt: .06, tumble: -.2, noseDrop: -.08, tailKick: -.06, archFront: .12, archRear: .12, flank: -.1, cockpitLength: -.1, cockpitWidth: .12, scoopSize: .3, scoopTilt: 10, ductSize: .3, wingHeight: .25, wingSpan: -.15, wingChord: -.4 } },
  wedge: { name: 'Wedge', notes: 'Wide and flat: a nose dropped to a point, a tail kicked high, wide flanks and a tall wing.', handles: { width: .1, noseLength: .06, tailLength: .1, deck: -.04, crown: -.08, fender: -.04, noseDrop: .14, tailKick: .16, belt: -.06, tumble: .2, archFront: -.03, archRear: .06, flank: .06, scoopTilt: 30, scoopSize: .1, tailLamp: .5, wingHeight: .15, wingSpan: .15, wingChord: .1 } },
}
