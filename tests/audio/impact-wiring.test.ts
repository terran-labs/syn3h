import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GameAudio } from '../../src/audio'
import { CrashWatcher, synthImpact } from '../../src/audio/Impacts'

vi.mock('../../src/audio/Impacts', async (original) => ({
  ...await original<typeof import('../../src/audio/Impacts')>(),
  synthImpact: vi.fn(() => vi.fn()),
}))

// Exercise event routing without starting a browser's audio device or the score graph.
function fixture() {
  const position = { x: 0, y: 10, z: 0 }, velocity = { x: 20, y: 0, z: 0 }
  const vehicle = {
    kind: 'tank', zorbed: false, object: { position },
    body: { isValid: () => true, translation: () => position, linvel: () => velocity },
    wingsOpen: false, landedThisStep: false, landingImpact: 12, wheelsGrounded: 4,
  }
  const audio = Object.assign(Object.create(GameAudio.prototype), {
    context: { state: 'running', currentTime: 1 }, enabled: true, paused: false,
    local: vehicle, terrain: { surfaceAt: () => 'snow' }, crashes: new CrashWatcher(),
    cueStops: new Set(), events: new Map(), remote: new Map(), impactSeed: 0,
    output: () => ({ node: {}, dispose: vi.fn() }), cue: vi.fn(),
  }) as any
  return { audio, vehicle, velocity, position }
}

describe('production crash routing', () => {
  beforeEach(() => vi.clearAllMocks())
  it('uses the local hull for network contact and suppresses a duplicate terrain blow', () => {
    const { audio, velocity } = fixture()
    audio.fixedUpdate()
    audio.impact(15)
    velocity.x = 0
    audio.fixedUpdate()
    expect(synthImpact).toHaveBeenCalledTimes(1)
    expect(vi.mocked(synthImpact).mock.calls[0][2]).toMatchObject({ kind: 'vehicle', hull: 'tank' })
  })
  it('plays one snow landing rather than both a landing and a sudden-stop sound', () => {
    const { audio, vehicle, velocity } = fixture()
    audio.fixedUpdate()
    vehicle.landedThisStep = true; velocity.x = 0
    audio.fixedUpdate(); audio.fixedUpdate()
    expect(synthImpact).toHaveBeenCalledTimes(1)
    expect(vi.mocked(synthImpact).mock.calls[0][2]).toMatchObject({ kind: 'snow', hull: 'tank' })
  })
  it('hears a grounded terrain crash without a landing event', () => {
    const { audio, velocity } = fixture()
    audio.fixedUpdate(); velocity.x = 0; audio.fixedUpdate()
    expect(synthImpact).toHaveBeenCalledTimes(1)
    expect(vi.mocked(synthImpact).mock.calls[0][2].kind).toBe('snow')
  })
  it('stays quiet while zorbed, paused or in the lobby', () => {
    for (const state of ['zorb', 'paused', 'lobby']) {
      const { audio, vehicle, velocity } = fixture()
      audio.fixedUpdate()
      if (state === 'zorb') vehicle.zorbed = true
      if (state === 'paused') audio.paused = true
      if (state === 'lobby') audio.enabled = false
      velocity.x = 0; vehicle.landedThisStep = true
      audio.fixedUpdate(); audio.impact(20)
    }
    expect(synthImpact).not.toHaveBeenCalled()
  })
  it('resets its history when the player vehicle changes', () => {
    const { audio, vehicle, velocity } = fixture()
    audio.fixedUpdate(); velocity.x = 0
    audio.setPlayer(vehicle, audio.terrain); audio.fixedUpdate()
    expect(synthImpact).not.toHaveBeenCalled()
  })
  it('does not treat remote interpolation as a terrain collision', () => {
    const { audio, vehicle, velocity } = fixture()
    audio.local = undefined; audio.remote.set(vehicle, {})
    audio.fixedUpdate(); velocity.x = 0; audio.fixedUpdate()
    expect(synthImpact).not.toHaveBeenCalled()
  })
})
