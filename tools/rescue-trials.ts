/**
 * Grapple rescue success over many seeded trials, per scenario (tests/bots/rescue/scenarios.ts).
 *
 *   tools/heavy.sh npx tsx tools/rescue-trials.ts [trials] [scenario...]
 */
import { initPhysics } from '../src/core/physics'
import { allowGrapple, trial, type Scenario } from '../tests/bots/rescue/scenarios'

const trials = Number(process.argv[2] ?? 20)
const scenarios = (process.argv.slice(3).length ? process.argv.slice(3) : ['notch', 'flipped', 'shore']) as Scenario[]
;(globalThis as { window?: unknown }).window ??= { performance }
await initPhysics()
allowGrapple()
// 'pond:<depth>:<assist 0|1>:<rescuer>' runs the player-in-the-sea case, e.g. pond:2.2:0:hovercraft.
for (const spec of scenarios as string[]) {
  const [s, depth, assist, rescuer] = spec.split(':') as [Scenario, string?, string?, string?]
  const opts = { depth: depth ? Number(depth) : undefined, assist: assist === undefined ? undefined : assist === '1', rescuer: rescuer as 'buggy' | 'hovercraft' | 'jet' | undefined }
  const results = Array.from({ length: trials }, (_, i) => trial(s, i + 1, 75, 4, undefined, opts))
  const freed = results.filter((r) => r.freed)
  const times = freed.map((r) => r.seconds).sort((a, b) => a - b)
  const median = times.length ? times[Math.floor(times.length / 2)] : NaN
  const realStuck = results.filter((r) => r.stuckAlone).length
  console.log(`${spec.padEnd(24)} freed ${freed.length}/${trials}  median ${median} s  max ${times.at(-1) ?? '-'} s  first-pull ${freed.filter((r) => r.attempts === 1).length}/${freed.length}  stuck-alone ${realStuck}/${trials}`)
  for (const r of results.filter((x) => !x.freed).slice(0, 3)) console.log(`   failed seed ${r.seed}: ${r.phases.join(' > ')}`)
}
