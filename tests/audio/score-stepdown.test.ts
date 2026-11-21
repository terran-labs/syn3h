// The score's step-down to its lighter tier under audio strain (Score.pollUnderruns), read from
// Chrome's AudioContext.playbackStats. Bug it catches: a player on a strained device keeps the
// full score and hears crackle, or a single glitch costs every player the full score.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { params } from '../../shared/params'

// The instruments are not under test: a stand-in that remembers its tier and ignores every call.
vi.mock('../../src/audio/score/ScoreSynth', () => ({
  ScoreSynth: function (_c: unknown, _o: unknown, lite = false, network = lite) {
    return new Proxy({ lite, network }, { get: (target, key) => key in target ? target[key as 'lite'] : () => {} })
  },
  applySubmerge: () => {},
}))
const { Score, scoreLite, scoreReportLine } = await import('../../src/audio/score/Score')

/** A context with a playbackStats counter the test advances, polled every two seconds. */
function setup(stats: { underrunEvents: number } | undefined) {
  const context = { currentTime: 0, ...(stats ? { playbackStats: stats } : {}) } as unknown as BaseAudioContext & { currentTime: number }
  const score = new Score(context, {} as AudioNode, 1)
  score.setActive(true)
  const poll = (newEvents: number) => {
    if (stats) stats.underrunEvents += newEvents
    ;(score as unknown as { pollUnderruns(now: number): void }).pollUnderruns(context.currentTime)
    context.currentTime += 2
  }
  poll(0) // the first reading only sets the baseline
  return { score, poll }
}

describe('score step-down from playbackStats', () => {
  beforeEach(() => params.set(scoreLite.def.id, false))

  it('steps down after two strained polls in a row, not after one', () => {
    const { poll } = setup({ underrunEvents: 0 })
    poll(5)
    expect(scoreLite.value).toBe(false)
    poll(0) // a quiet poll resets the count
    poll(5)
    expect(scoreLite.value).toBe(false)
    poll(5)
    expect(scoreLite.value).toBe(true)
  })

  it('does not step back up when the strain clears', () => {
    const { poll } = setup({ underrunEvents: 0 })
    poll(5); poll(5)
    for (let i = 0; i < 10; i++) poll(0)
    expect(scoreLite.value).toBe(true)
  })

  it('changes nothing on a context with neither playbackStats nor renderCapacity', () => {
    const { score, poll } = setup(undefined)
    for (let i = 0; i < 10; i++) poll(0)
    expect(scoreLite.value).toBe(false)
    expect(score.underruns).toBeNull()
    expect(scoreReportLine(score)).toContain('underruns not reported')
  })

  it('reports the tier, the step-down and the underrun count in diagnostics', () => {
    const { score, poll } = setup({ underrunEvents: 3 })
    poll(4); poll(4)
    score.update({ playing: false } as never)
    expect(scoreReportLine(score)).toBe('Music: lighter score, stepped down this session under audio strain; 11 underrun events')
  })
})
