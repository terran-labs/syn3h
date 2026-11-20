import { describe, expect, it, vi } from 'vitest'
import { LongFrames } from '../../src/core/longFrames'

describe('long frame diagnostics', () => {
  it('assigns work between callbacks to the interval it delayed and discards hidden time', () => {
    const recorder = new LongFrames()
    recorder.begin(0, 7, 'webgpu', 2, 'buggy')
    recorder.finish(6)
    recorder.event('Swap')
    recorder.end('Vehicle creation', recorder.start())
    recorder.renderContext('playing', 'jet')
    recorder.begin(60, 8, 'webgpu', 2, 'jet')
    recorder.pause()
    recorder.begin(600, 9, 'webgpu', 2, 'jet')
    const { frames, cursor } = recorder.read()
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ frame: 7, intervalMs: 60, callbackMs: 6, events: ['Swap'],
      vehicle: 'buggy', warmVehicle: 'jet', spans: [{ name: 'Vehicle creation', calls: 1 }] })
    expect(recorder.read(cursor).frames).toEqual([])
  })

  it('counts overlapping spans once and separates overlay, background and returning frames', () => {
    const recorder = new LongFrames()
    const now = vi.spyOn(performance, 'now')
    try {
      recorder.begin(0, 1, 'webgpu', 3, 'buggy')
      recorder.renderContext('playing')
      recorder.finish(5)
      now.mockReturnValue(13)
      recorder.end('Nested draw', 10)
      now.mockReturnValue(20)
      recorder.end('Covered work', 8)
      recorder.begin(70, 2, 'webgpu', 3, 'buggy')
      recorder.renderContext('covered')
      recorder.begin(150, 3, 'webgpu', 3, 'buggy')
      recorder.renderContext('playing')
      recorder.focusChanged(false, 160)
      recorder.begin(250, 4, 'webgpu', 3, 'buggy')
      recorder.focusChanged(true, 260)
      recorder.renderContext('playing')
      recorder.begin(350, 5, 'webgpu', 3, 'buggy')
      const frames = recorder.read().frames
      expect(frames[0]).toMatchObject({ accountedMs: 17, unaccountedMs: 53 })
      expect(frames.slice(2).map(f => f.focus)).toEqual(['background', 'returning to foreground'])
      const report = recorder.playReportLines(350).join('\n')
      expect(report).toContain('In play: 1 frames')
      expect(report).toContain('Lobby or entry overlay: 1 frames')
      expect(report).toContain('Excluded background or focus-return long frames: 2')
    } finally { now.mockRestore() }
  })

  it('reports overwritten records to a slow probe without duplicating newer frames', () => {
    const recorder = new LongFrames()
    for (let i = 0; i <= 600; i++) recorder.begin(i * 50, i, 'webgl', 1, 'buggy')
    const report = recorder.read()
    expect(report.lost).toBeGreaterThan(0)
    expect(report.frames.length + report.lost).toBe(report.cursor)
    expect(recorder.read(599).frames.map(f => f.sequence)).toEqual([600])
  })
})
