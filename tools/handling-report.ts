/**
 * Handling report: measured handling per vehicle, from the same headless scenarios the vehicle
 * tests use. It reports and never judges: the owner tunes these numbers by feel, so none of them
 * blocks a release. Paste the Markdown into release notes to make a surprising change visible.
 *
 *   npx tsx tools/handling-report.ts          Markdown to stdout
 *   npx tsx tools/handling-report.ts --json   JSON to stdout
 *   npx tsx tools/handling-report.ts --tyres  only the buggy tyre size table
 *
 * Each vehicle is measured once per handling preset (shared/presets.ts), the default first, so
 * the tables have a column per preset. Every figure uses that preset over the parameter defaults
 * unless its label says otherwise. To add a vehicle (the hovercraft), write its scenarios next to
 * its tests and add an entry to `vehicles` below. The tank is hidden from the game and left out.
 */
import * as THREE from 'three/webgpu'
import { params } from '../shared/params'
import type { HandlingPreset } from '../shared/presets'
// Registers world.atmosphere, which the jet and the buggy's wings read.
import '../src/world/terrain/settings'
import { FIXED_DT, initPhysics } from '../src/core/physics'
import { BUGGY_PRESETS } from '../src/vehicles/buggyParams'
import { JET_PRESETS } from '../src/vehicles/Jet'
import * as buggy from '../tests/vehicles/miraScenarios'
import * as jet from '../tests/vehicles2/jetScenarios'
import * as liquid from '../tests/vehicles/liquidScenarios'
import * as zorb from '../tests/vehicles2/zorbSkipScenarios'
import { harness } from '../tests/vehicles2/harness'
import { MiraBuggy } from '../src/vehicles/MiraBuggy'
import { HOVER_PRESETS, Hovercraft } from '../src/vehicles/Hovercraft'
import { makeBed } from '../tests/vehicles/harness'

/** One measured figure. `null` means the event never happened in the scenario's window. */
interface Figure { label: string; unit: string; value: number | null }
interface Summary { topSpeed: number | null; toTop: number | null; brakeDistance: number | null; turnRadius: number | null }
interface VehicleReport { summary: Summary; detail: Figure[] }

const finite = (x: number) => (Number.isFinite(x) ? x : null)
const fig = (label: string, unit: string, value: number): Figure => ({ label, unit, value: finite(value) })

/** The speed a trace settles at, and the seconds to reach 95% of it (null if it never settles). */
const settle = (trace: number[], dt: number) => {
  const top = trace[trace.length - 1]
  const steady = Math.abs(top - trace[Math.floor(trace.length * 0.9)]) < Math.max(top * 0.01, 0.05)
  const i = trace.findIndex((s) => s >= top * 0.95)
  return { top, toTop: steady && i >= 0 ? (i + 1) * dt : Infinity }
}

/** The preset being measured; its values are applied over the defaults before every scenario. */
let preset: HandlingPreset | undefined
/** Run a scenario with every parameter at its default plus the preset, after `setup` changes some. */
const atWorld = <T>(scenario: () => T | Promise<T>, setup?: () => void) => at(scenario, setup)
async function at<T>(scenario: () => T | Promise<T>, setup?: () => void): Promise<T> {
  buggy.resetParams()
  for (const [id, value] of Object.entries(preset?.values ?? {})) params.set(id, value)
  setup?.()
  try { return await scenario() } finally { buggy.resetParams() }
}

// ---- Mira buggy -----------------------------------------------------------------------

/** Full throttle from rest on the flat for 90 s (it settles after about a minute). */
const buggyTopSpeed = async () => {
  const { bed, b } = await buggy.spawn()
  bed.run(1)
  b.input.y = 1
  const trace: number[] = []
  bed.run(90, () => trace.push(buggy.speed(b)))
  return settle(trace, FIXED_DT)
}

/** Up to `v0` m/s under throttle, then brakes: metres and seconds to under 0.5 m/s. */
const buggyBrake = async (v0 = 25) => {
  const { bed, b } = await buggy.spawn()
  bed.run(1)
  b.input.y = 1
  for (let t = 0; buggy.speed(b) < v0 && t < 30; t += 0.02) bed.run(0.02)
  const start = buggy.speed(b), p0 = buggy.pos(b)
  b.input.y = 0
  b.input.brakes = true
  let t = 0
  while (buggy.speed(b) > 0.5 && t < 10) { bed.run(0.02); t += 0.02 }
  return { distance: buggy.pos(b).distanceTo(p0), seconds: t, g: start / t / buggy.G }
}

/** Full lock at `v` m/s with light throttle for 2 s: radius, lateral g and sideslip. */
const buggyTurn = async (v = 15) => {
  const { bed, b } = await buggy.spawn()
  bed.run(1)
  b.input.y = 1
  for (let t = 0; buggy.speed(b) < v && t < 30; t += 0.02) bed.run(0.02)
  b.input.y = 0.3
  b.input.x = 1
  bed.run(2)
  const l = b.body.linvel(), yaw = Math.abs(b.body.angvel().y), f = buggy.axis(b, 0, 0, -1)
  const sp = buggy.speed(b)
  const slip = Math.acos(Math.min(1, (f.x * l.x + f.z * l.z) / (Math.hypot(f.x, f.z) * Math.hypot(l.x, l.z)))) * 180 / Math.PI
  return { radius: sp / yaw, lateralG: (sp * yaw) / buggy.G, slip }
}

/** Speed lost in 2 s off throttle from 25 m/s, in g. */
const buggyCoast = async () => {
  const { bed, b } = await buggy.spawn()
  bed.run(1)
  b.input.y = 1
  while (buggy.speed(b) < 25) bed.run(0.02)
  b.input.y = 0
  const v0 = buggy.speed(b)
  bed.run(2)
  return (v0 - buggy.speed(b)) / 2 / buggy.G
}

/** Regen on the reverse key from 20 m/s: deceleration over one second, in g. */
const buggyRegen = async () => {
  const { bed, b } = await buggy.spawn()
  bed.run(1)
  b.input.y = 1
  while (buggy.speed(b) < 20) bed.run(0.02)
  b.input.y = -1
  bed.run(0.5)
  const v0 = -b.body.linvel().z
  bed.run(1)
  return (v0 + b.body.linvel().z) / buggy.G
}

/** Wings open at 35 m/s level: metres of height lost in 3 s. */
const buggyGlideSink = async () => {
  const { bed, b } = await buggy.flying()
  const y0 = buggy.pos(b).y
  bed.run(3)
  return { sink: y0 - buggy.pos(b).y, speed: buggy.speed(b) }
}

async function miraBuggy(): Promise<VehicleReport> {
  const top = await at(buggyTopSpeed)
  const brake = await at(() => buggyBrake())
  const turn = await at(() => buggyTurn())
  const detail: Figure[] = [
    fig('Braking from 25 m/s, time', 's', brake.seconds),
    fig('Braking from 25 m/s, average', 'g', brake.g),
    fig('Full lock at 15 m/s, lateral', 'g', turn.lateralG),
    fig('Full lock at 15 m/s, sideslip', 'deg', turn.slip),
    fig('Coast off throttle from 25 m/s', 'g', await at(buggyCoast)),
    fig(`Regen on reverse key (setting ${params.get('buggy.regen')!.def.default} g)`, 'g', await at(buggyRegen)),
  ]
  // Turn-in at speed: full lock held for two seconds from a steady cruise.
  const locks = new Map<number, Awaited<ReturnType<typeof buggy.fullLock>>>()
  for (const v of [25, 35, 45, 60]) locks.set(v, await at(() => buggy.fullLock(v)))
  for (const v of locks.keys()) detail.push(fig(`Full lock at ${v} m/s: course change in 1 s`, 'deg', locks.get(v)!.after1))
  for (const v of locks.keys()) detail.push(fig(`Full lock at ${v} m/s: turn radius after 2 s`, 'm', locks.get(v)!.radius))
  for (const v of locks.keys()) detail.push(fig(`Full lock at ${v} m/s: lateral after 2 s`, 'g', locks.get(v)!.lateralG))
  for (const v of [45, 60]) detail.push(fig(`Full lock at ${v} m/s for 2 s: largest slide angle`, 'deg', locks.get(v)!.worstSlip), fig(`Full lock at ${v} m/s for 2 s: least upright (1 level)`, '', locks.get(v)!.upright))
  const flick = await at(() => buggy.flick(45))
  detail.push(fig('Flick left-right at 45 m/s: largest slide angle', 'deg', flick.worstSlip), fig('Flick left-right at 45 m/s: slide angle 2 s after letting go', 'deg', flick.endSlip))
  detail.push(fig('In the air yawed 30 deg at 30 m/s: nose turned toward travel in 1 s', 'deg', await at(() => buggy.airStraighten())))
  for (const deg of [30, 40]) detail.push(fig(`Climbed in 4 s from rest, ${deg} degree slope`, 'm', (await at(() => buggy.climb(deg))).climbed))
  detail.push(
    fig('Hop off a 0.4 m bump at 42 m/s', 'm', (await at(() => buggy.bump())).hop),
    fig('Upright 6 s after the 0.4 m bump (1 level, below 0 on its roof)', '', (await at(() => buggy.bump())).upright),
    fig('Hop off a 0.4 m bump at 42 m/s, planted suspension', 'm', (await at(() => buggy.bump(), buggy.planted)).hop),
    fig('Roll off a one sided 0.4 m bump at 42 m/s', 'deg', (await at(() => buggy.bump(true))).roll),
    fig('Body strikes landing a 4 m drop at 30 m/s', '', (await at(buggy.drop)).strikes),
    fig('Body strikes landing a 4 m drop at 30 m/s, planted suspension', '', (await at(buggy.drop, buggy.planted)).strikes),
  )
  const broadside = await at(buggy.sideways)
  detail.push(
    fig('Broadside at 20 m/s: distance in 6 s', 'm', broadside.distance),
    fig('Broadside at 20 m/s: time to face travel', 's', broadside.faced),
    fig('Broadside at 20 m/s: time to stop', 's', broadside.stopped),
  )
  for (const [v, a] of [[30, 40], [45, 40], [60, 5], [45, 90]]) detail.push(fig(`Slide ${a} deg at ${v} m/s, counter-steer: recovered`, 's', (await at(() => buggy.kick(v, a, true))).recovered))
  for (const [v, a] of [[30, 40], [45, 90], [60, 70]]) detail.push(fig(`Slide ${a} deg at ${v} m/s, let go: recovered`, 's', (await at(() => buggy.kick(v, a, false))).recovered))
  // Ice (surface.grip.ice): a frozen lake.
  const onIce = async <T>(scenario: () => Promise<T>) => { buggy.ground.surface = 'ice'; try { return await at(scenario) } finally { buggy.ground.surface = undefined } }
  const iceBrake = await onIce(() => buggyBrake()), iceTurn = await onIce(() => buggyTurn())
  detail.push(
    fig('On ice: braking from 25 m/s', 'm', iceBrake.distance),
    fig('On ice: full lock at 15 m/s, lateral', 'g', iceTurn.lateralG),
    fig('On ice: full lock at 15 m/s, sideslip', 'deg', iceTurn.slip),
    fig('On ice: course change in 1 s at full lock, 25 m/s', 'deg', (await onIce(() => buggy.courseChange(25))).after1),
  )
  const glide = await at(buggyGlideSink)
  detail.push(fig('Wings open at 35 m/s: height lost in 3 s', 'm', glide.sink), fig('Wings open at 35 m/s: speed after 3 s', 'm/s', glide.speed))
  for (const [model, name] of [[0, 'Classic'], [1, 'Catch'], [2, 'Glide']] as const) {
    for (const s of [0.3, 0.8, 2.5]) detail.push(fig(`Wings open sideways at 30 m/s, ${name}: motion off nose at ${s} s`, 'deg', (await at(() => buggy.deploy(model, s))).off))
    detail.push(fig(`Wings open sideways at 30 m/s, ${name}: speed at 2.5 s`, 'm/s', (await at(() => buggy.deploy(model, 2.5))).speed))
  }
  for (const [model, name] of [[0, 'Classic'], [2, 'Glide']] as const) {
    const up = await at(() => buggy.pitchedGlide(model, 0.5)), down = await at(() => buggy.pitchedGlide(model, -0.5))
    detail.push(fig(`${name}: speed after 0.5 s, dive minus climb at 29 deg`, 'm/s', down.speed - up.speed))
  }
  return {
    summary: { topSpeed: finite(top.top), toTop: finite(top.toTop), brakeDistance: finite(brake.distance), turnRadius: finite(turn.radius) },
    detail,
  }
}

/**
 * The buggy at tyre sizes 1, 2 and 3 (buggy.tyreSize), default preset. Turn radius at 15 m/s is
 * from rest with light throttle, as the summary's; at 45 m/s it is full lock from a cruise.
 * "Least upright at full lock" is the roll-over tendency: 1 level, 0 on its side, below 0 over.
 */
const TYRE_SIZES = [1, 2, 3]
async function buggyTyreSizes(): Promise<Record<string, Figure[]>> {
  const out: Record<string, Figure[]> = {}
  for (const k of TYRE_SIZES) {
    const size = () => params.set('buggy.tyreSize', k)
    const top = await at(buggyTopSpeed, size)
    const turn = await at(() => buggyTurn(15), size)
    const lock15 = await at(() => buggy.fullLock(15), size)
    const lock45 = await at(() => buggy.fullLock(45), size)
    const lock30 = await at(() => buggy.fullLock(30), size)
    const bump = await at(() => buggy.bump(), size)
    out[k] = [
      fig('Top speed', 'm/s', top.top),
      fig('Turn radius at 15 m/s, full lock', 'm', turn.radius),
      fig('Turn radius at 45 m/s, full lock after 2 s', 'm', lock45.radius),
      fig('Hop off a 0.4 m bump at 42 m/s', 'm', bump.hop),
      fig('Upright 6 s after the 0.4 m bump', '', bump.upright),
      fig('Least upright at full lock, 15 m/s', '', lock15.upright),
      fig('Least upright at full lock, 30 m/s', '', lock30.upright),
      fig('Least upright at full lock, 45 m/s', '', lock45.upright),
    ]
  }
  return out
}

// ---- Jet -------------------------------------------------------------------------------

/** The Moon's sky and pull: no air, 1.62 m/s². */
const moon = () => { params.set('world.atmosphere', 0); params.set('world.gravity', 1.62) }

/** `world` sets the planet (air, gravity) before each scenario; left out, an Earthlike world. */
async function jetReport(world?: () => void): Promise<VehicleReport> {
  const at = <T>(scenario: () => T | Promise<T>, setup?: () => void) => atWorld(scenario, () => { world?.(); setup?.() })
  const top = settle(await at(() => jet.flightSpeedTrace()), FIXED_DT)
  const vector = Number(preset?.values['jet.vectorResponse'] ?? params.get('jet.vectorResponse')!.def.default)
  const hover = await at(jet.hoverClimb)
  const detail: Figure[] = [
    fig('Hover, full lift: climb after 1 s', 'm/s', hover.up),
    fig('Hover, full descend: sink after 1 s', 'm/s', -hover.down),
    fig(`Flight speed after ${(100 * FIXED_DT).toFixed(2)} s from rest, full thrust`, 'm/s', await at(() => jet.flightSpeedAfter(100))),
  ]
  detail.push(fig('Vectoring at 12 m/s: pitch rate', 'deg/s', await at(() => jet.vectorRate('y', vector))))
  detail.push(fig('Vectoring at 12 m/s: yaw rate', 'deg/s', await at(() => jet.vectorRate('w', vector))))
  return {
    summary: {
      topSpeed: finite(top.top), toTop: finite(top.toTop),
      brakeDistance: finite(await at(() => jet.flightBrakeDistance(60))),
      turnRadius: finite(await at(() => jet.loopRadius(60))),
    },
    detail,
  }
}

// ---- Liquids ---------------------------------------------------------------------------

/** Run a liquid scenario at defaults, freeing its world afterwards. */
const wet = async <T>(make: () => liquid.Run, read: (r: liquid.Run) => T): Promise<T> =>
  at(() => { const r = make(); try { return read(r) } finally { liquid.dispose(r) } })
const pool = (l: liquid.Liquid, depth = 1.5): liquid.Basin => ({ liquid: l, length: 30, depth, slope: 10 })

/** Lava and water for one vehicle kind. The buggy gets the full set; others the crossings. */
async function liquids(kind: liquid.Kind): Promise<Figure[]> {
  const out: Figure[] = []
  for (const l of ['lava', 'water'] as const) {
    out.push(fig(`${l}: cross a 30 m pool, full throttle from 10 m/s`, 's', (await wet(() => liquid.entry(kind, pool(l), 10), liquid.exitTime)) ?? Infinity))
    for (const [name, d] of [['wheel', 0.7], ['body', 1.3]] as const) {
      out.push(fig(`${l}: drive out from ${name}-deep (${d} m), 20 m to shore`, 's', (await wet(() => liquid.fromRest(kind, { liquid: l, length: 40, depth: d, slope: 15 }), liquid.exitTime)) ?? Infinity))
    }
  }
  if (kind !== 'buggy') return out
  const wallow = await wet(() => liquid.fromRest('buggy', { liquid: 'lava', length: 400, depth: 3, slope: 15 }, 12), (r) => {
    const t0 = r.trace[0].t
    const speed = r.trace.filter((s) => s.t > t0 + 4).reduce((a, s, _, all) => a + s.speed / all.length, 0)
    return { speed, pitch: liquid.rhythm(r.trace, 'pitch', t0 + 4, t0 + 12), roll: liquid.rhythm(r.trace, 'roll', t0 + 4, t0 + 12) }
  })
  out.push(
    fig('lava, deep, full throttle: speed', 'm/s', wallow.speed),
    fig('lava, deep, full throttle: pitch swing (porpoise), peak to peak', 'deg', wallow.pitch.amplitude),
    fig('lava, deep, full throttle: pitch rhythm', 's', wallow.pitch.period ?? Infinity),
    fig('lava, deep, full throttle: roll swing (waddle), peak to peak', 'deg', wallow.roll.amplitude),
    fig('lava, deep, full throttle: roll rhythm', 's', wallow.roll.period ?? Infinity),
  )
  for (const l of ['lava', 'water'] as const) {
    const r = await at(() => { const x = liquid.turn('buggy', l, 1, 1); liquid.dispose(x.run); return x })
    out.push(
      fig(`${l}, deep, full throttle and lock: yaw rate`, 'deg/s', r.yawRate),
      fig(`${l}, deep, full throttle and lock: turn radius`, 'm', r.radius),
      fig(`${l}, deep, full throttle and lock from rest: time to turn 180`, 's', r.to180 ?? Infinity),
    )
    const o = await at(() => { const x = liquid.turnOut(l); liquid.dispose(x.run); return x })
    out.push(fig(`${l}: facing away from a shore 10 m behind, time to turn round and get out`, 's', o.out ?? Infinity))
  }
  for (const [v0, brakes] of [[10, false], [20, false], [40, false], [0, false], [20, true]] as const) {
    const c = await at(() => { const x = liquid.coast('water', v0, 12, brakes); liquid.dispose(x.run); return x })
    const what = v0 ? `entering at ${v0} m/s${brakes ? ', brakes' : ''}` : 'paddling, then released'
    out.push(
      fig(`water, no throttle ${what}: time to rest`, 's', c.rest ?? Infinity),
      fig(`water, no throttle ${what}: distance to rest`, 'm', c.distance),
      fig(`water, no throttle ${what}: time until under the surface`, 's', c.under ?? Infinity),
    )
  }
  out.push(fig('water: speed 20 m past the shore after entering at 40 m/s', 'm/s', await wet(() => liquid.entry('buggy', { liquid: 'water', length: 400, depth: 3, slope: 10 }, 40, 8), (r) => r.trace.find((s) => s.z < -20)?.speed ?? NaN)))
  for (const [l, w] of [['water', 'sea'], ['water', 'inland'], ['lava', 'sea']] as const) {
    const bob = await wet(() => liquid.afloat('buggy', l, w, 20), (r) => {
      const t0 = r.trace[0].t
      return { heave: liquid.rhythm(r.trace, 'y', t0, t0 + 20), pitch: liquid.rhythm(r.trace, 'pitch', t0, t0 + 20), roll: liquid.rhythm(r.trace, 'roll', t0, t0 + 20) }
    })
    const where = w === 'sea' ? (l === 'lava' ? 'lava' : 'sea') : 'lake'
    out.push(
      fig(`afloat at rest on ${where} waves: bob, peak to peak`, 'm', bob.heave.amplitude),
      fig(`afloat at rest on ${where} waves: pitch, peak to peak`, 'deg', bob.pitch.amplitude),
      fig(`afloat at rest on ${where} waves: roll, peak to peak`, 'deg', bob.roll.amplitude),
    )
  }
  for (const l of ['water', 'lava'] as const) {
    const a = await at(() => { const r = liquid.wingAscent(l, 3); liquid.dispose(r.run); return r })
    out.push(
      fig(`${l}: wings opened at the bottom of a 3 m pool: time to surface`, 's', a.surfaced === null ? Infinity : a.surfaced - a.run.trace[0].t),
      fig(`${l}: wings, rise: peak pitch rate`, 'deg/s', a.peakPitchRate),
      fig(`${l}: wings, rise: peak roll rate`, 'deg/s', a.peakRollRate),
      fig(`${l}: wings, highest point of the body above the surface`, 'm', a.breach),
      fig(`${l}: wings, settled afloat at the surface after 20 s (1 yes)`, '', a.settled ? 1 : 0),
    )
    const tumble = await at(() => { const r = liquid.wingAscent(l, 3, -45, 0, 5); liquid.dispose(r.run); return r })
    out.push(
      fig(`${l}: wings, nose-first plunge at 5 m/s: time to surface`, 's', tumble.surfaced === null ? Infinity : tumble.surfaced - tumble.run.trace[0].t),
      fig(`${l}: wings, nose-first plunge: peak pitch rate`, 'deg/s', tumble.peakPitchRate),
    )
  }
  return out
}

// ---- Zorb on liquids ---------------------------------------------------------------------

/** A zorbed buggy launched across open liquid with no input (tests/vehicles2/zorbSkipScenarios.ts). */
async function zorbLiquids(): Promise<Figure[]> {
  const out: Figure[] = []
  const launch = (l: liquid.Liquid, speed: number, angle: number, seconds: number, setup?: (r: zorb.ZorbRun) => void) => at(() => {
    const r = zorb.zorbLaunch({ liquid: l, depth: 30 }, speed, angle)
    try { setup?.(r); zorb.coast(r, seconds); return { s: zorb.summary(r), trace: r.trace } } finally { r.dispose() }
  })
  for (const l of ['water', 'lava'] as const) {
    for (const [speed, angle] of [[5, 5], [10, 8], [20, 8], [30, 8], [20, 35]] as const) {
      const { s } = await launch(l, speed, angle, 12)
      const what = `${l}, ${speed} m/s at ${angle}°`
      out.push(
        fig(`${what}: skips`, '', s.skips),
        fig(`${what}: speed lost in the first second`, 'm/s', s.lossFirstSecond),
        fig(`${what}: distance to half speed`, 'm', s.halfSpeedDistance ?? Infinity),
        fig(`${what}: deepest the ball's base went`, 'm', s.deepest),
      )
    }
    const { trace } = await launch(l, 0, 0, 20, (r) => { r.v.zorbView = new THREE.Quaternion(); r.v.input.y = 1 })
    out.push(fig(`${l}: top speed in 20 s rolling forward from rest (uncapped)`, 'm/s', Math.max(...trace.map((t) => t.speed))))
  }
  out.push(fig('flat land: top speed in 20 s rolling forward from rest (uncapped)', 'm/s', await at(() => {
    const h = harness()
    const v = new MiraBuggy(h.game, h.terrain, new THREE.Vector3(0, 2, 0))
    try {
      v.isLocal = false; v.input.zorb = true
      h.step(v, 600)
      v.zorbView = new THREE.Quaternion(); v.input.y = 1
      let top = 0
      for (let i = 0; i < 20 / FIXED_DT; i++) { h.step(v); const l = v.body.linvel(); top = Math.max(top, Math.hypot(l.x, l.z)) }
      return top
    } finally { v.dispose(); h.world.free() }
  })))
  return out
}

// ---- Report ----------------------------------------------------------------------------

/** Each vehicle, its presets (the default first), and how its summary columns were measured. */
// ---- Hovercraft ----------------------------------------------------------------------

/**
 * Full throttle from rest on the flat for 60 s: the glide speed it settles at, and the body's mass.
 * Its glide is a constant thrust against linear drag, so it settles at hover.thrust / (mass *
 * hover.drag) (Hovercraft.ts); the instrument scale reads that relation (instrumentScales.ts).
 */
const hoverTopSpeed = async () => {
  const bed = await makeBed()
  const h = bed.add(new Hovercraft(bed.game, bed.terrain, new THREE.Vector3(0, 3, 0), 0))
  h.isLocal = false
  bed.run(2)
  h.input.y = 1
  const trace: number[] = []
  bed.run(60, () => { const v = h.body.linvel(); trace.push(Math.hypot(v.x, v.z)) })
  return { ...settle(trace, FIXED_DT), mass: h.body.mass() }
}
async function hovercraftReport(): Promise<VehicleReport> {
  const top = await at(hoverTopSpeed)
  return { summary: { ...NO_SUMMARY, topSpeed: finite(top.top), toTop: finite(top.toTop) }, detail: [fig('Body mass', 'kg', top.mass)] }
}

const vehicles: Record<string, { run: () => Promise<VehicleReport>; presets: readonly HandlingPreset[]; how: string }> = {
  buggy: {
    run: miraBuggy, presets: BUGGY_PRESETS,
    how: 'Top speed: full throttle on the flat. Braking: from 25 m/s. Turn radius: full lock at 15 m/s.',
  },
  'buggy liquids': {
    run: async () => ({ summary: NO_SUMMARY, detail: await liquids('buggy') }), presets: [BUGGY_PRESETS[0]],
    how: 'Lava and water (tests/vehicles/liquidScenarios.ts), default preset only. Lava and water have their own settings, not the handling presets.',
  },
  hovercraft: {
    run: hovercraftReport, presets: HOVER_PRESETS,
    how: 'Top speed: full throttle from rest on the flat, gliding (thrust against drag). Braking and turn radius are not measured yet.',
  },
  'hovercraft liquids': {
    run: async () => ({ summary: NO_SUMMARY, detail: await liquids('hovercraft') }), presets: [{ name: 'default', description: '', values: {} }],
    how: 'It rides above lava and water on its cushion.',
  },
  'zorb liquids': {
    run: async () => ({ summary: NO_SUMMARY, detail: await zorbLiquids() }), presets: [{ name: 'default', description: '', values: {} }],
    how: 'A zorbed buggy launched across open water or lava, coasting (tests/vehicles2/zorbSkipScenarios.ts). Skips are the times its base rose 0.15 m clear of the surface. Tune with zorb.skipSpeed, zorb.skipAngle, zorb.skipFriction and zorb.skipKeep.',
  },
  jet: {
    run: () => jetReport(), presets: JET_PRESETS,
    how: 'Liquids: none, it hovers over lava and water. Top speed: full flight thrust, level. Braking: brakes from 60 m/s in level flight to 1 m/s (60 s cap). Turn radius: full pitch-up at 60 m/s.',
  },
  'jet on the Moon': {
    run: () => jetReport(moon), presets: JET_PRESETS,
    how: 'As the jet, with no air (world.atmosphere 0) and the Moon\'s 1.62 m/s² gravity: no lift or drag, so it flies on thrust alone.',
  },
}

const NO_SUMMARY: Summary = { topSpeed: null, toTop: null, brakeDistance: null, turnRadius: null }
const num = (x: number | null, digits = 1) => (x === null ? 'never' : x.toFixed(digits))

await initPhysics()
/** Per vehicle, per preset name. */
const results: Record<string, Record<string, VehicleReport>> = {}
const tyresOnly = process.argv.includes('--tyres')
for (const [name, v] of Object.entries(vehicles)) {
  if (tyresOnly) break
  results[name] = {}
  for (const p of v.presets) { preset = p; results[name][p.name] = await v.run() }
  preset = undefined
}
const tyres = await buggyTyreSizes()

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ...results, buggyTyreSizes: tyres }, null, 2))
} else {
  const out = [
    '# Handling report',
    '',
    '| Vehicle | Preset | Top speed (m/s) | To 95% of top (s) | Braking distance (m) | Turn radius (m) |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
  ]
  for (const [name, byPreset] of Object.entries(results)) for (const [p, r] of Object.entries(byPreset)) {
    out.push(`| ${name} | ${p} | ${num(r.summary.topSpeed)} | ${num(r.summary.toTop)} | ${num(r.summary.brakeDistance)} | ${num(r.summary.turnRadius)} |`)
  }
  for (const [name, byPreset] of Object.entries(results)) {
    const names = Object.keys(byPreset), first = byPreset[names[0]]
    out.push('', `## ${name}`, '', vehicles[name].how, '', `| Figure | Unit | ${names.join(' | ')} |`, `| --- | --- | ${names.map(() => '---:').join(' | ')} |`)
    first.detail.forEach((f, i) => out.push(`| ${f.label} | ${f.unit} | ${names.map((p) => num(byPreset[p].detail[i].value, 2)).join(' | ')} |`))
  }
  const sizes = Object.keys(tyres), rows = tyres[sizes[0]]
  out.push('', '## buggy, tyre size', '', 'Default preset at each tyre size (buggy.tyreSize). Least upright: 1 level, 0 on its side, below 0 rolled over.', '',
    `| Figure | Unit | ${sizes.map((k) => `Size ${k}`).join(' | ')} |`, `| --- | --- | ${sizes.map(() => '---:').join(' | ')} |`)
  rows.forEach((f, i) => out.push(`| ${f.label} | ${f.unit} | ${sizes.map((k) => num(tyres[k][i].value, 2)).join(' | ')} |`))
  console.log(out.join('\n'))
}
