import { systemReportLines } from './diagnosticSystem'
import { shaderReportLines } from './diagnosticShaders'
import { startupReportLines } from './diagnostics'
import { longFrames } from './longFrames'
import type { PerformanceSnapshot } from './performance'
import type { VehicleKind } from '../vehicles'

/** Read existing session state synchronously so copying also works offline. */
export function diagnosticReport(snapshot: PerformanceSnapshot, vehicle: VehicleKind, bots: readonly string[], world: string, biome: string,
  network: string | undefined, transitions: readonly { from: number; to: number; by: string }[], music?: string): string {
  const levels = transitions.filter(change => change.by === 'governor')
    .map(change => `${change.from}>${change.to}`).join(', ')
  const counts = new Map<string, number>()
  for (const kind of bots) {
    const name = ['buggy', 'buggy-classic', 'buggy-syn3h', 'jet', 'hovercraft', 'tank'].includes(kind) ? kind : 'other'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const fleet = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([kind, n]) => kind + ' ' + n)
  const local = (time: number) => new Date(time).toLocaleString('sv-SE', { timeZoneName: 'shortOffset' })
  return [
    'Mira diagnostics v2',
    `Reported ${local(Date.now())}; session started ${local(performance.timeOrigin)}`,
    ...systemReportLines(snapshot),
    'Automatic transitions in recent level history: ' + (levels || 'none'),
    '', ...startupReportLines(), '', ...shaderReportLines(),
    '', `World: ${world}, biome ${biome}`, `Play: ${vehicle}, ${bots.length} bots${fleet.length ? ' (' + fleet.join(', ') + ')' : ''}`, ...longFrames.playReportLines(),
    '', network ?? 'Room connection: not joined, drops 0, rejoins 0, RTT unavailable',
    ...(music ? [music] : []),
  ].join('\n')
}
