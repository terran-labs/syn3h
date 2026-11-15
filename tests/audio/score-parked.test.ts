import { describe, expect, it } from 'vitest'
import { Score } from '../../src/audio/score/Score'

/**
 * A stand-in audio context that records which nodes are connected to which, and how many
 * automation calls are made, so the test can tell whether the score's graph reaches the output.
 */
function fakeAudio() {
  const links: [unknown, unknown][] = []
  const counts = { automation: 0 }
  const param = () => new Proxy({ value: 0 } as Record<string, unknown>, {
    get: (target, key) => key === 'value' ? target.value : () => { counts.automation++ },
  })
  const node = () => {
    const fields: Record<string | symbol, unknown> = {}
    const self: object = new Proxy(fields, {
      get(target, key) {
        if (key === 'connect') return (to: unknown) => { links.push([self, to]); return to }
        if (key === 'disconnect') return () => { for (let i = links.length - 1; i >= 0; i--) if (links[i][0] === self) links.splice(i, 1) }
        if (key === 'start' || key === 'stop') return () => {}
        return target[key] ??= param()
      },
      set(target, key, value) { target[key] = value; return true },
    })
    return self
  }
  const context = new Proxy({ currentTime: 0, sampleRate: 200 } as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key === 'createBuffer') return (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })
      if (typeof key === 'string' && key.startsWith('create')) return node
      return target[key]
    },
  }) as unknown as BaseAudioContext & { currentTime: number }
  const output = node() as unknown as AudioNode
  return { context, output, counts, reaches: () => links.filter(([, to]) => to === output).length }
}

const still = { playing: false, speed: 0, throttle: 0, airborne: false, clearance: 0, altitude: 0, submerged: 0, lava: 0 }

describe('the generated score when it is not heard', () => {
  it('is not connected to the output until it is selected', () => {
    const { context, output, counts, reaches } = fakeAudio()
    const score = new Score(context, output, 7)
    expect(reaches()).toBe(0)
    // Frames pass with a recording selected: still unplugged, and no automation is written.
    const before = counts.automation
    for (let i = 0; i < 10; i++) { context.currentTime += 1 / 60; score.update(still) }
    expect(reaches()).toBe(0)
    expect(counts.automation).toBe(before)
  })

  it('is connected when selected and unplugged again after it has faded out', () => {
    const { context, output, reaches } = fakeAudio()
    const score = new Score(context, output, 7)
    score.setActive(true, 2)
    expect(reaches()).toBe(1)
    context.currentTime += 1; score.update(still)
    expect(reaches()).toBe(1)

    score.setActive(false, 2)
    // Still plugged in while the fade is heard.
    context.currentTime += 1; score.update(still)
    expect(reaches()).toBe(1)
    context.currentTime += 5; score.update(still)
    expect(reaches()).toBe(0)

    // Selecting it again brings it back, once.
    score.setActive(true, 2)
    expect(reaches()).toBe(1)
    score.dispose()
    expect(reaches()).toBe(0)
  })
})
