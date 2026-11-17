/**
 * How often the buggy's tyre slip sound would play, measured in the headless physics. A report
 * for tuning the slip voice, not a gate:
 *
 *   tools/heavy.sh npx tsx tests/audio/slip-runs.ts
 *
 * Runs: a full-throttle straight run toward top speed, the same over rough ground, a fast sweeping turn (a third of the
 * steering at 60 m/s and up), a full-lock turn at 40 m/s, and a real slide (kicked 30 degrees off its line at 40 m/s, no
 * counter-steer). For each it logs what the audio sees (the largest lateral slip of a grounded
 * wheel, in m/s, with the speed) and how much of the time each slip voice sounds.
 */
import { initPhysics } from '../../src/core/physics'
import * as buggy from '../vehicles/syn3hScenarios'
import { slipVoice, followSlide, LEGACY_SLIP } from '../../src/audio/Engine'
import * as THREE from 'three/webgpu'

interface Sample { speed: number; slip: number; slide: number; lateral: number }
/** `slip` is what the squeal heard (the largest grounded wheel); `slide` what the scrub hears (the body's sideways speed, smoothed as Engine does). */
let held = 0
const sense = (b: Awaited<ReturnType<typeof buggy.spawn>>['b']): Sample => {
  const wheels = b.getWheelEffects()
  const v = b.body.linvel(), r = buggy.axis(b, 1, 0, 0), grounded = wheels.filter(w => w.grounded).length
  const lateral = grounded >= 2 ? Math.abs(v.x * r.x + v.y * r.y + v.z * r.z) : 0
  held = followSlide(held, lateral, 0.02)
  return { speed: buggy.speed(b), slip: Math.max(0, ...wheels.filter(w => w.grounded).map(w => w.slip)), slide: held, lateral }
}

async function straight(): Promise<Sample[]> {
  held = 0
  const { bed, b } = await buggy.spawn(); bed.run(1)
  const out: Sample[] = []
  b.input.y = 1
  bed.run(30, () => out.push(sense(b)))
  return out
}
/** Full throttle over rough ground: a bump under one side or the other every 0.6 s, once past 40 m/s. */
async function rough(): Promise<Sample[]> {
  held = 0
  const { bed, b } = await buggy.spawn(); bed.run(1)
  const out: Sample[] = []
  b.input.y = 1
  let t = 0, n = 0
  bed.run(30, () => {
    t += 0.02
    if (buggy.speed(b) > 40 && t > 0.6) { t = 0; const x = buggy.pos(b).x, side = n++ % 2 ? 1 : -1; buggy.ridge(bed, b, x + side * 0.2, x + side * 3, 0.35, 5) }
    if (buggy.speed(b) > 40) out.push(sense(b))
  })
  return out
}
async function sweep(): Promise<Sample[]> {
  held = 0
  const { bed, b } = await buggy.spawn(); bed.run(1)
  const out: Sample[] = []
  b.input.y = 1
  bed.run(14, () => { if (buggy.speed(b) > 60) { b.input.x = 0.33; out.push(sense(b)) } })
  bed.run(10, () => out.push(sense(b)))
  return out
}
/** Full lock at 40 m/s for three seconds: a hard turn that should slide. */
async function lock(): Promise<Sample[]> {
  held = 0
  const { bed, b } = await buggy.cruise(40)
  const out: Sample[] = []
  b.input.x = 1
  bed.run(3, () => out.push(sense(b)))
  return out
}
async function slide(): Promise<Sample[]> {
  held = 0
  const { bed, b } = await buggy.spawn(); bed.run(2)
  b.body.setLinvel({ x: 0, y: 0, z: -40 }, true); b.motorSpeed = 40; b.input.y = 1
  bed.run(1.5, () => { const v = b.body.linvel(); b.body.setLinvel({ x: 0, y: v.y, z: -40 }, true) })
  b.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 30 * Math.PI / 180).multiply(buggy.rot(b)), true)
  const out: Sample[] = []
  bed.run(2.5, () => out.push(sense(b)))
  return out
}

function report(name: string, samples: Sample[]) {
  const legacy = samples.map(s => LEGACY_SLIP(s.slip, false)), now = samples.map(s => slipVoice({ speed: s.speed, slide: s.slide, airborne: false }).level)
  const share = (v: number[]) => v.filter(x => x > 0.01).length / v.length
  const longest = (v: number[]) => { let run = 0, best = 0; for (const x of v) { run = x > 0.01 ? run + 1 : 0; best = Math.max(best, run) } return best * 0.02 }
  const q = (k: keyof Sample, p: number) => { const s = samples.map(x => x[k]).sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))] }
  console.log(`${name.padEnd(9)} speed ${q('speed', 0.5).toFixed(0)}..${q('speed', 1).toFixed(0)} m/s  largest wheel slip p90 ${q('slip', 0.9).toFixed(1)} max ${q('slip', 1).toFixed(1)}, body sideways p90 ${q('lateral', 0.9).toFixed(1)} max ${q('lateral', 1).toFixed(1)} m/s | before: sounds ${(100 * share(legacy)).toFixed(0)}% longest ${longest(legacy).toFixed(1)} s | after: sounds ${(100 * share(now)).toFixed(0)}% longest ${longest(now).toFixed(1)} s, peak level ${Math.max(...now).toFixed(2)}`)
}

await initPhysics()
buggy.resetParams()
report('straight', await straight())
report('rough', await rough())
report('sweep', await sweep())
report('full lock', await lock())
report('slide', await slide())
