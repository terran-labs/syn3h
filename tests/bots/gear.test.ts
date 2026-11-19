import { describe, expect, it } from 'vitest'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { emptyInput } from '../../src/core/Input'
import { BotGearController, type BotGearHooks, type BotGearAction, type BotGearOption } from '../../src/bots/gear'

function setup(kind: BotGearOption['id'] = 'pester') {
  let valid = true, allowed = true, clear = true, safe = true
  const vehicle = { id: 'bot-0', kind: 'buggy', body: { isValid: () => true, translation: () => ({ x: 0, y: 0, z: 0 }), rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }), linvel: () => ({ x: 0, y: 0, z: -5 }) } } as unknown as Vehicle
  const target = { body: { isValid: () => valid, translation: () => ({ x: 0, y: 0, z: -20 }) } } as unknown as Vehicle
  const actions: BotGearAction[] = []
  let threats: ReturnType<BotGearHooks['threats']> = []
  const hooks: BotGearHooks = {
    available: () => allowed ? [{ id: kind, range: 40, cooldown: 2, chargeSeconds: 1 }] : [],
    threats: () => threats,
    act: (_v, action) => actions.push(action),
  }
  const controller = new BotGearController(vehicle, () => 128, () => clear, () => safe)
  const step = (seconds: number, fire = true) => {
    let input = emptyInput()
    for (let i = 0; i < Math.round(seconds / 0.02); i++) { input = { ...emptyInput(), y: 1 }; controller.step(0.02, target, input, fire, true) }
    return input
  }
  return { controller, hooks, actions, step, target, setValid: (v: boolean) => { valid = v }, setAllowed: (v: boolean) => { allowed = v }, setClear: (v: boolean) => { clear = v }, setSafe: (v: boolean) => { safe = v }, setThreats: (v: typeof threats) => { threats = v } }
}

describe('bot gear decisions', () => {
  it('picks Plasma Thunder against a target flying above it, when Thunder is in range', () => {
    // A jet 20 m up and 60 m ahead, inside a 30 degree cone; Grapple and Thunder both reach.
    const vehicle = { id: 'bot-1', kind: 'buggy', body: { isValid: () => true, translation: () => ({ x: 0, y: 0, z: 0 }), rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }), linvel: () => ({ x: 0, y: 0, z: -5 }) } } as unknown as Vehicle
    const jet = { body: { isValid: () => true, translation: () => ({ x: 0, y: 20, z: -60 }) } } as unknown as Vehicle
    const actions: BotGearAction[] = []
    const controller = new BotGearController(vehicle, () => 128, () => true, () => true)
    controller.setHooks({ available: () => [{ id: 'bungee', range: 120, cooldown: 2 }, { id: 'red', range: 250, cooldown: 2, chargeSeconds: 1 }], threats: () => [], act: (_v, a) => actions.push(a) })
    for (let i = 0; i < 200 && !actions.length; i++) controller.step(0.02, jet, emptyInput(), true, true)
    expect(actions[0]).toMatchObject({ gear: 'red', phase: 'press' })
  })
  it('does nothing without hooks, and waits before reacting', () => {
    const s = setup()
    s.step(3); expect(s.actions).toEqual([])
    s.controller.setHooks(s.hooks)
    s.step(0.3); expect(s.actions).toEqual([])
    s.step(2); expect(s.actions.map(a => a.phase)).toContain('press')
  })
  it.each(['red', 'yoink', 'bungee'] as const)('holds %s before releasing or letting go', kind => {
    const s = setup(kind); s.controller.setHooks(s.hooks)
    s.step(4)
    const phases = s.actions.map(a => a.phase)
    expect(phases[0]).toBe('press')
    expect(phases).toContain('hold')
    const end = phases.indexOf(kind === 'bungee' ? 'cancel' : 'release')
    expect(end).toBeGreaterThan(1)
    expect(phases.slice(1, end).every(p => p === 'hold')).toBe(true)
    if (kind === 'red') expect(end - 1).toBeGreaterThanOrEqual(52)
  })
  it.each(['disabled', 'invalid', 'removed', 'fire-off', 'blocked'] as const)('cancels an active hold when %s', reason => {
    const s = setup('red'); s.controller.setHooks(s.hooks)
    for (let i = 0; i < 100 && !s.actions.length; i++) s.step(0.02)
    expect(s.actions[0]?.phase).toBe('press')
    if (reason === 'disabled') s.setAllowed(false)
    if (reason === 'invalid') s.setValid(false)
    if (reason === 'removed') s.controller.setHooks(null)
    if (reason === 'blocked') s.setClear(false)
    s.step(0.02, reason !== 'fire-off')
    expect(s.actions.at(-1)?.phase).toBe('cancel')
  })
  it('repeats the same choices on the same simulation timeline', () => {
    const a = setup(), b = setup()
    a.controller.setHooks(a.hooks); b.controller.setHooks(b.hooks)
    a.step(12); b.step(12)
    expect(a.actions.map(x => [x.gear, x.phase])).toEqual(b.actions.map(x => [x.gear, x.phase]))
    expect(a.actions.filter(x => x.phase === 'press').length).toBeLessThan(6)
  })
  it('reacts late to approaching Pesters and refuses unsafe dodges', () => {
    const s = setup(); s.controller.setHooks(s.hooks)
    s.setThreats([{ id: 'orb-1', position: { x: 0, y: 0, z: -15 }, velocity: { x: 0, y: 0, z: 10 } }])
    expect(s.step(0.2).x).toBe(0)
    expect(Math.abs(s.step(1).x)).toBeGreaterThan(0)
    s.setSafe(false)
    expect(s.step(1).x).toBe(0)
  })
  it('ignores receding Pesters', () => {
    const s = setup(); s.controller.setHooks(s.hooks)
    s.setThreats([{ id: 'orb-1', position: { x: 0, y: 0, z: -15 }, velocity: { x: 0, y: 0, z: -20 } }])
    expect(s.step(2).x).toBe(0)
  })
})
