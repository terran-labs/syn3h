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
import { params } from '../shared/params'
import type { HandlingPreset } from '../shared/presets'
import { FIXED_DT, initPhysics } from '../src/core/physics'
import { BUGGY_PRESETS } from '../src/vehicles/buggyParams'
import { JET_PRESETS } from '../src/vehicles/Jet'
import * as buggy from '../tests/vehicles/syn3hScenarios'
import * as jet from '../tests/vehicles2/jetScenarios'

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
async function at<T>(scenario: () => T | Promise<T>, setup?: () => void): Promise<T> {
  buggy.resetParams()
  for (const [id, value] of Object.entries(preset?.values ?? {})) params.set(id, value)
  setup?.()
  try { return await scenario() } finally { buggy.resetParams() }
}

// ---- Syn3h buggy -----------------------------------------------------------------------

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

async function syn3hBuggy(): Promise<VehicleReport> {
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
  detail.push(fig('Lava 0.6 m deep: time to drive out', 's', (await at(() => buggy.lavaEscape(0.6))).seconds))
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

async function jetReport(): Promise<VehicleReport> {
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

// ---- Report ----------------------------------------------------------------------------

/** Each vehicle, its presets (the default first), and how its summary columns were measured. */
const vehicles: Record<string, { run: () => Promise<VehicleReport>; presets: readonly HandlingPreset[]; how: string }> = {
  buggy: {
    run: syn3hBuggy, presets: BUGGY_PRESETS,
    how: 'Top speed: full throttle on the flat. Braking: from 25 m/s. Turn radius: full lock at 15 m/s.',
  },
  jet: {
    run: jetReport, presets: JET_PRESETS,
    how: 'Top speed: full flight thrust, level. Braking: brakes from 60 m/s in level flight to 1 m/s (60 s cap). Turn radius: full pitch-up at 60 m/s.',
  },
}

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
