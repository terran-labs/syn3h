/**
 * Grapple rescue success over many seeded trials, per scenario (tests/bots/rescue/scenarios.ts).
 *
 *   tools/heavy.sh npx tsx tools/rescue-trials.ts [trials] [scenario...]
 *   esc:<farbog|heavy|rescuerstuck|notch|shore> runs a whole coordinated rescue (escalation.ts)
 */
import { initPhysics } from '../src/core/physics'
import { allowGrapple, trial, type Scenario } from '../tests/bots/rescue/scenarios'
import { escalationTrial, type Hard } from '../tests/bots/rescue/escalation'

const trials = Number(process.argv[2] ?? 20)
const scenarios = (process.argv.slice(3).length ? process.argv.slice(3) : ['notch', 'flipped', 'shore']) as Scenario[]
;(globalThis as { window?: unknown }).window ??= { performance }
await initPhysics()
allowGrapple()
// 'pond:<depth>:<assist 0|1>:<rescuer>' runs the player-in-the-sea case, e.g. pond:2.2:0:hovercraft.
for (const spec of scenarios as string[]) {
  if (spec.startsWith('esc:')) {
    // A whole coordinated rescue (HostRescue, several bots): time to free and attempts.
    const name = spec.slice(4) as Hard
    const results = Array.from({ length: trials }, (_, i) => escalationTrial(name, i + 1, 600, process.env.LOG ? (l) => console.log(`   ${l}`) : undefined))
    const freed = results.filter((r) => r.freed)
    const times = freed.map((r) => r.seconds).sort((a, b) => a - b), tries = freed.map((r) => r.attempts).sort((a, b) => a - b)
    const mid = <T,>(a: T[]) => a.length ? a[Math.floor(a.length / 2)] : '-'
    console.log(`${spec.padEnd(24)} freed ${freed.length}/${trials}  median ${mid(times)} s  max ${times.at(-1) ?? '-'} s  attempts median ${mid(tries)} max ${tries.at(-1) ?? '-'}  rescuers ${[...new Set(results.map((r) => r.rescuers))].sort().join('/')}`)
    for (const r of results.filter((x) => !x.freed).slice(0, 2)) console.log(`   failed seed ${r.seed}: ${r.events.slice(-4).join(' | ').slice(0, 400)}`)
    continue
  }
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
