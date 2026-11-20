import type { PassResult } from './renderCheckPasses'

export interface TierResult {
  name: string
  intervals: number[]
  cpu: number[]
  passes: PassResult[]
  checks: string[]
  resolution?: string
  status?: string
}

export function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * fraction) - 1]
}

const ms = (n: number) => n.toFixed(1) + ' ms'

export function formatTier(tier: TierResult, refreshMs: number, detailed = true): string {
  const { intervals, cpu, passes } = tier
  const usable = passes.filter(p => p.ms !== null && Number.isFinite(p.ms) && p.ms >= 0)
  const largest = usable.sort((a, b) => b.ms! - a.ms!)[0]
  // An interval over 1.5 measured refresh periods missed at least one callback opportunity.
  const holds = intervals.filter(n => n <= refreshMs * 1.5).length >= .95 * intervals.length
  const verdict = intervals.length < 12 || !Number.isFinite(refreshMs) ? 'refresh unmeasured'
    : (holds ? 'holds ' : 'misses ') + Math.round(1000 / refreshMs) + ' Hz'
  const headline = tier.name + ' · ' + verdict + ' · ' + (largest
    ? 'largest measured pass: ' + largest.name + ' ' + ms(largest.ms!) + ' (' + largest.method + (largest.fit === undefined ? '' : ', R² ' + largest.fit.toFixed(2)) + ')' : 'largest pass unmeasured')
  const lines = [headline]
  if (tier.resolution) lines.push('  ' + tier.resolution)
  if (intervals.length) lines.push('  Frame median ' + ms(percentile(intervals, .5)) + ', p95 ' +
    ms(percentile(intervals, .95)) + ', CPU submission median ' + ms(percentile(cpu, .5)) +
    ' (' + intervals.length + ' intervals)')
  if (!detailed) {
    if (tier.status) lines.push('  ' + tier.status)
    return lines.join('\n')
  }
  for (const p of passes) lines.push('  ' + p.name + ': ' + (p.ms === null ? 'unresolved' : ms(p.ms)) +
    ' (' + p.method + (p.fit === undefined ? '' : ', R² ' + p.fit.toFixed(2)) + ')' + (p.note ? ' · ' + p.note : ''))
  for (const check of tier.checks) lines.push('  ' + check)
  if (tier.status) lines.push('  ' + tier.status)
  return lines.join('\n')
}
