import { describe, expect, it } from 'vitest'
import { formatStartup, recordStartupPhase, startupTiming, timeStartup } from '../../src/core/diagnostics'

describe('startup phase timing', () => {
  it('records phases in order with their durations', async () => {
    const before = startupTiming.phases.length
    const start = performance.now()
    recordStartupPhase('test phase', start - 5, 'detail')
    const value = await timeStartup('test async', async () => 42)
    expect(value).toBe(42)
    const added = startupTiming.phases.slice(before)
    expect(added.map(p => p.name)).toEqual(['test phase', 'test async'])
    expect(added[0].ms).toBeGreaterThanOrEqual(5)
    expect(added[0].detail).toBe('detail')
  })
  it('records a phase even when the step throws', async () => {
    await expect(timeStartup('test throws', () => Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(startupTiming.phases.at(-1)?.name).toBe('test throws')
  })
  it('formats one line per phase with navigation and pipelines', () => {
    const text = formatStartup({ phases: [{ name: 'a', startMs: 10, endMs: 30, ms: 20 }], navigation: { responseEndMs: 5, domContentLoadedMs: 9, loadEventMs: 0, scripts: 3, scriptBytes: 2048, lastScriptEndMs: 8 }, pipelines: { render: 2, compute: 0, vertexShaders: 1, fragmentShaders: 2 }, fallbackReason: 'stalled' })
    expect(text.split('\n')).toEqual([
      'html 5, 3 scripts 2 KB, last script 8, DOMContentLoaded 9',
      '    10 +   20  a',
      'pipelines 2 render, 0 compute, shaders 1 vertex / 2 fragment',
      'fallback: stalled',
    ])
  })
})
