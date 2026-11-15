import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GameAudio } from '../../src/audio'
import { synthMaterialize, synthZorbPulse } from '../../src/audio/VehicleCues'

vi.mock('../../src/audio/VehicleCues', () => ({ synthMaterialize: vi.fn(), synthZorbPulse: vi.fn(() => vi.fn()) }))
function fixture() {
  const audio = Object.assign(Object.create(GameAudio.prototype), {
    context: { state: 'running' }, enabled: true, paused: false, disposed: false,
    materializing: new Map(), cueStops: new Set(), engine: { noise: {} },
    output: vi.fn(() => ({ node: {}, dispose: vi.fn() })),
  }) as any
  vi.mocked(synthMaterialize).mockImplementation((_context, _output, _noise, end) => {
    let ended = false
    return { release: vi.fn(), stop: vi.fn(() => { if (!ended) { ended = true; end?.() } }) }
  })
  const vehicle = {}, position = { x: 1, y: 2, z: 3 }
  return { audio, vehicle, position }
}
describe('switch sound lifecycle', () => {
  beforeEach(() => vi.clearAllMocks())
  it('holds until release and cancels by vehicle identity', () => {
    const { audio, vehicle, position } = fixture()
    audio.materialize('materializeStart', position, vehicle)
    const voice = audio.materializing.get(vehicle)
    expect(voice.release).not.toHaveBeenCalled()
    audio.materialize('materializeRelease', position, {})
    expect(voice.release).not.toHaveBeenCalled()
    audio.materialize('materializeRelease', position, vehicle)
    expect(voice.release).toHaveBeenCalledOnce()
    audio.materialize('materializeCancel', position, vehicle)
    expect(voice.stop).toHaveBeenCalledOnce()
    expect(audio.materializing.size).toBe(0)
    expect(audio.cueStops.size).toBe(0)
  })
  it('stops the old voice before restarting a hold', () => {
    const { audio, vehicle, position } = fixture()
    audio.materialize('materializeStart', position, vehicle)
    const first = audio.materializing.get(vehicle)
    audio.materialize('materializeStart', position, vehicle)
    expect(first.stop).toHaveBeenCalledOnce()
    expect(audio.materializing.size).toBe(1)
    expect(audio.cueStops.size).toBe(1)
    expect(audio.materializing.get(vehicle)).not.toBe(first)
  })
  it('does not start sounds while paused, locked, disposed or outside play', () => {
    for (const state of ['paused', 'locked', 'disposed', 'lobby']) {
      const { audio, vehicle, position } = fixture()
      if (state === 'locked') audio.context.state = 'suspended'
      if (state === 'lobby') audio.enabled = false
      if (state === 'paused' || state === 'disposed') audio[state] = true
      audio.materialize('materializeStart', position, vehicle)
    }
    expect(synthMaterialize).not.toHaveBeenCalled()
  })
  it('allows cancellation even while paused', () => {
    const { audio, vehicle, position } = fixture()
    audio.materialize('materializeStart', position, vehicle)
    audio.paused = true
    audio.materialize('materializeCancel', position, vehicle)
    expect(audio.cueStops.size).toBe(0)
  })
})

describe('hop pulse routing', () => {
  beforeEach(() => vi.clearAllMocks())
  it('allows the pulse while the local engine is zorbed and tracks cleanup', () => {
    const { audio, position } = fixture()
    audio.local = { zorbed: true }
    audio.zorbPulse(position)
    expect(synthZorbPulse).toHaveBeenCalledOnce()
    expect(audio.cueStops.size).toBe(1)
    vi.mocked(synthZorbPulse).mock.calls[0][2]?.()
    expect(audio.cueStops.size).toBe(0)
  })
  it('suppresses pulses during pause and outside play', () => {
    const { audio, position } = fixture()
    audio.paused = true; audio.zorbPulse(position)
    audio.paused = false; audio.enabled = false; audio.zorbPulse(position)
    expect(synthZorbPulse).not.toHaveBeenCalled()
  })
})
