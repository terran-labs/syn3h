/**
 * Handling report: measured handling per vehicle, from the same headless scenarios the vehicle
 * tests use. It reports and never judges: the owner tunes these numbers by feel, so none of them
 * blocks a release. Paste the Markdown into release notes to make a surprising change visible.
 *
 *   npx tsx tools/handling-report.ts          Markdown to stdout
 *   npx tsx tools/handling-report.ts --json   JSON to stdout
 *
 * Every figure uses current parameter defaults (shared/params.ts) unless its label says otherwise.
 * To add a vehicle (tank, hovercraft), write its scenarios next to its tests and add an entry to
 * `vehicles` below.
 */
import { params } from '../shared/params'
import { FIXED_DT, initPhysics } from '../src/core/physics'
import { buggyNextGen } from '../src/vehicles/buggyParams'
import { jetFlightThrust } from '../src/vehicles/Jet'
import * as buggy from '../tests/vehicles/syn3hScenarios'
import * as jet from '../tests/vehicles2/jetScenarios'
import * as liquid from '../tests/vehicles/liquidScenarios'

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

/** Run a scenario with every parameter at its default, after `setup` changes some. */
async function at<T>(scenario: () => T | Promise<T>, setup?: () => void): Promise<T> {
  buggy.resetParams()
  setup?.()
  try { return await scenario() } finally { buggy.resetParams() }
}
const classic = () => params.set(buggyNextGen.def.id, false)
const tyresOnly = (sideGrip?: number) => () => {
  for (const id of ['buggy.fin', 'buggy.steerFollow', 'buggy.sideHold']) params.set(id, 0)
  if (sideGrip !== undefined) params.set('buggy.sideGrip', sideGrip)
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
  const classicBrake = await at(() => buggyBrake(), classic)
  const turn = await at(() => buggyTurn())
  const detail: Figure[] = [
    fig('Braking from 25 m/s, time', 's', brake.seconds),
    fig('Braking from 25 m/s, average', 'g', brake.g),
    fig('Braking from 25 m/s, classic', 'm', classicBrake.distance),
    fig('Full lock at 15 m/s, lateral', 'g', turn.lateralG),
    fig('Full lock at 15 m/s, sideslip', 'deg', turn.slip),
    fig('Coast off throttle from 25 m/s', 'g', await at(buggyCoast)),
    fig(`Regen on reverse key (setting ${params.get('buggy.regen')!.def.default} g)`, 'g', await at(buggyRegen)),
  ]
  for (const v of [25, 35, 45]) {
    detail.push(fig(`Course change in 1 s at full lock, ${v} m/s`, 'deg', (await at(() => buggy.courseChange(v))).after1))
    detail.push(fig(`Course change in 1 s at full lock, ${v} m/s, classic`, 'deg', (await at(() => buggy.courseChange(v), classic)).after1))
  }
  for (const deg of [30, 40]) detail.push(fig(`Climbed in 4 s from rest, ${deg} degree slope`, 'm', (await at(() => buggy.climb(deg))).climbed))
  detail.push(
    fig('Hop off a 0.4 m bump at 42 m/s', 'm', (await at(() => buggy.bump())).hop),
    fig('Hop off a 0.4 m bump at 42 m/s, planted', 'm', (await at(() => buggy.bump(), buggy.planted)).hop),
    fig('Roll off a one sided 0.4 m bump at 42 m/s', 'deg', (await at(() => buggy.bump(true))).roll),
    fig('Body strikes landing a 4 m drop at 30 m/s', '', (await at(buggy.drop)).strikes),
    fig('Body strikes landing a 4 m drop at 30 m/s, planted', '', (await at(buggy.drop, buggy.planted)).strikes),
  )
  const broadside = await at(buggy.sideways)
  const slides = await at(buggy.sideways, tyresOnly())
  const bites = await at(buggy.sideways, tyresOnly(4))
  detail.push(
    fig('Broadside at 20 m/s: distance in 6 s', 'm', broadside.distance),
    fig('Broadside at 20 m/s: time to face travel', 's', broadside.faced),
    fig('Broadside at 20 m/s: time to stop', 's', broadside.stopped),
    fig('Broadside, tyres only: time to stop', 's', slides.stopped),
    fig('Broadside, tyres only, side grip 4: time to stop', 's', bites.stopped),
  )
  for (const [v, a] of [[30, 40], [45, 40], [60, 5], [45, 90]]) detail.push(fig(`Slide ${a} deg at ${v} m/s, counter-steer: recovered`, 's', (await at(() => buggy.kick(v, a, true))).recovered))
  for (const [v, a] of [[30, 40], [45, 90], [60, 70]]) detail.push(fig(`Slide ${a} deg at ${v} m/s, let go: recovered`, 's', (await at(() => buggy.kick(v, a, false))).recovered))
  detail.push(fig('Slide 40 deg at 30 m/s, counter-steer, no fin or assists: recovered', 's', (await at(() => buggy.kick(30, 40, true), () => {
    tyresOnly()(); params.set('buggy.rearSteerFast', 1)
  })).recovered))
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
  detail.push(...await liquids('buggy'))
  return {
    summary: { topSpeed: finite(top.top), toTop: finite(top.toTop), brakeDistance: finite(brake.distance), turnRadius: finite(turn.radius) },
    detail,
  }
}

// ---- Jet -------------------------------------------------------------------------------

async function jetReport(): Promise<VehicleReport> {
  const top = settle(await at(() => jet.flightSpeedTrace()), FIXED_DT)
  const thrust = jetFlightThrust.def.default as number
  const hover = await at(jet.hoverClimb)
  const detail: Figure[] = [
    fig('Hover, full lift: climb after 1 s', 'm/s', hover.up),
    fig('Hover, full descend: sink after 1 s', 'm/s', -hover.down),
    fig(`Flight speed after ${(100 * FIXED_DT).toFixed(2)} s from rest, thrust ${thrust}`, 'm/s', await at(() => jet.flightSpeedAfter(100))),
    fig(`Flight speed after ${(100 * FIXED_DT).toFixed(2)} s from rest, thrust ${thrust / 2}`, 'm/s', await at(() => jet.flightSpeedAfter(100), () => { jetFlightThrust.value = thrust / 2 })),
  ]
  for (const vector of [0.3, 1]) {
    detail.push(fig(`Vectoring at 12 m/s, slider ${vector}: pitch rate`, 'deg/s', await at(() => jet.vectorRate('y', vector))))
    detail.push(fig(`Vectoring at 12 m/s, slider ${vector}: yaw rate`, 'deg/s', await at(() => jet.vectorRate('w', vector))))
  }
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

// ---- Report ----------------------------------------------------------------------------

/** Each vehicle, and how its summary columns were measured. */
const vehicles: Record<string, { run: () => Promise<VehicleReport>; how: string }> = {
  buggy: {
    run: syn3hBuggy,
    how: 'Top speed: full throttle on the flat. Braking: from 25 m/s. Turn radius: full lock at 15 m/s.',
  },
  hovercraft: {
    run: async () => ({ summary: { topSpeed: null, toTop: null, brakeDistance: null, turnRadius: null }, detail: await liquids('hovercraft') }),
    how: 'Liquids only so far: it rides above lava and water on its cushion.',
  },
  jet: {
    run: jetReport,
    how: 'Liquids: none, it hovers over lava and water. Top speed: full flight thrust, level. Braking: brakes from 60 m/s in level flight to 1 m/s (60 s cap). Turn radius: full pitch-up at 60 m/s.',
  },
}

const num = (x: number | null, digits = 1) => (x === null ? 'never' : x.toFixed(digits))

await initPhysics()
const results: Record<string, VehicleReport> = {}
for (const [name, v] of Object.entries(vehicles)) results[name] = await v.run()

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2))
} else {
  const out = [
    '# Handling report',
    '',
    '| Vehicle | Top speed (m/s) | To 95% of top (s) | Braking distance (m) | Turn radius (m) |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...Object.entries(results).map(([name, r]) =>
      `| ${name} | ${num(r.summary.topSpeed)} | ${num(r.summary.toTop)} | ${num(r.summary.brakeDistance)} | ${num(r.summary.turnRadius)} |`),
  ]
  for (const [name, r] of Object.entries(results)) {
    out.push('', `## ${name}`, '', vehicles[name].how, '', '| Figure | Value | Unit |', '| --- | ---: | --- |')
    for (const f of r.detail) out.push(`| ${f.label} | ${num(f.value, 2)} | ${f.unit} |`)
  }
  console.log(out.join('\n'))
}
