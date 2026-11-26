import { describe, expect, it } from 'vitest'
import { entryOffset, fallbackLabel, hintModel, hintSignature, keyHint, levelStep, releaseHint, ringOffset, slotPose, touchActions, type GearAction, type GearControls } from '../../src/ui/gear/GearSelector'

const action = (id: string, hold = false, keys = ['Click']): GearAction => ({ id, label: id, keys, hold, start() {} })
const controls = (actions: GearAction[]): GearControls => ({ gear: 'bungee', name: 'Grapple', description: '', state: 'vehicle', actions })

describe('gear drum ring maths', () => {
  it('places every item on the nearest side of the ring', () => {
    expect([0, 1, 2, 3, 4].map(i => ringOffset(i, 0, 5))).toEqual([0, 1, 2, -2, -1])
    expect([0, 1, 2, 3, 4].map(i => ringOffset(i, 4, 5))).toEqual([1, 2, -2, -1, 0])
    expect([0, 1].map(i => ringOffset(i, 0, 2))).toEqual([0, 1])
    expect([0, 1, 2, 3].map(i => ringOffset(i, 1, 4))).toEqual([-1, 0, 1, 2])
    expect(ringOffset(0, 0, 0)).toBe(0)
  })
  it('makes items crossing the back of the ring enter from beyond the far edge', () => {
    // Next on five: the item at the top (-2) wraps to the bottom (2) and enters from 3.
    expect(entryOffset(-2, 2, -1, 5)).toBe(3)
    // Back one: the bottom item wraps to the top and enters from -3.
    expect(entryOffset(2, -2, 1, 5)).toBe(-3)
    // Ordinary moves ease directly.
    expect(entryOffset(1, 0, -1, 5)).toBeNull()
    expect(entryOffset(2, 0, -2, 5)).toBeNull()
  })
  it('fades and shrinks towards the edges and hides beyond them', () => {
    const poses = [0, 1, 2, 3].map(slotPose)
    expect(poses[0]).toEqual({ scale: 1, opacity: 1 })
    for (let i = 1; i < 4; i++) {
      expect(poses[i].opacity).toBeLessThan(poses[i - 1].opacity)
      expect(poses[i].scale).toBeLessThan(poses[i - 1].scale)
    }
    expect(poses[3].opacity).toBe(0)
    expect(slotPose(-1)).toEqual(slotPose(1))
  })
  it('quantises the live level and hides it when absent', () => {
    expect(levelStep(undefined)).toBe(-1)
    expect(levelStep(NaN)).toBe(-1)
    expect(levelStep(-0.2)).toBe(0)
    expect(levelStep(1.4)).toBe(1)
    expect(levelStep(0.4201)).toBe(levelStep(0.4199))
    expect(levelStep(0.7)).toBe(0.7)
  })
})

describe('gear hints', () => {
  it('lists every action of the current state with its keys', () => {
    const c = controls([action('reelIn', true, ['Hold click']), action('payOut', true, ['V', 'Wheel down']), action('release', false, ['G', 'Double tap'])])
    expect(hintModel(c).map(h => `${h.keys.join('/')} ${h.label}`)).toEqual(['Hold click reelIn', 'V/Wheel down payOut', 'G/Double tap release'])
    expect(hintModel(undefined)).toEqual([])
  })
  it('gives touch buttons to every action but the primary', () => {
    expect(touchActions(controls([action('launch')])).map(a => a.id)).toEqual([])
    expect(touchActions(controls([action('reelIn', true), action('payOut', true), action('release')])).map(a => a.id)).toEqual(['payOut', 'release'])
    expect(touchActions(undefined)).toEqual([])
  })
  it('only rebuilds hint lines when the hints themselves change', () => {
    const a = hintModel(controls([action('reelIn', true, ['Hold click'])]))
    const b = hintModel({ ...controls([action('reelIn', true, ['Hold click'])]), status: 'Cord 30 m' })
    expect(hintSignature(a)).toBe(hintSignature(b))
    expect(hintSignature(a)).not.toBe(hintSignature(hintModel(controls([action('reelIn', false, ['Hold click'])]))))
  })
  it('words the key reminder for the size of the rack', () => {
    expect(keyHint(5)).toBe('1 to 5')
    expect(keyHint(2)).toBe('1 or 2')
    expect(keyHint(12)).toBe('1 to 9')
    expect(keyHint(1)).toBe('')
    expect(fallbackLabel('pester')).toBe('Pester')
  })
})

describe('the release hint beside the status', () => {
  const release: GearAction = { id: 'release', label: 'Let go', keys: ['G', 'Double tap'], hold: false, start() {} }
  const fling: GearAction = { id: 'fling', label: 'Fling', keys: ['Let go of click'], hold: false, start() {} }
  const held = (a: GearAction, status?: string): GearControls => ({ gear: 'bungee', name: 'Grapple', description: '', state: 'ground', status, actions: [a] })
  it('shows the key from the action while the gear holds something, and nothing otherwise', () => {
    expect(releaseHint(held(release, 'Cord 13 m'), false)).toEqual({ key: 'G', text: 'or double-click to let go' })
    expect(releaseHint(held(release), false)).toBeNull()
    expect(releaseHint(undefined, false)).toBeNull()
    expect(releaseHint(held(action('launch'), 'Cord 13 m'), false)).toBeNull()
  })
  it('on touch says nothing while a thumb button lets go, and names the gesture if none does', () => {
    const withButton: GearControls = { ...held(release, 'Cord 13 m'), actions: [action('reelIn'), release] }
    expect(releaseHint(withButton, true)).toBeNull()
    expect(releaseHint(held(release, 'Cord 13 m'), true)).toEqual({ text: 'double-tap to let go' })
    expect(releaseHint(held(fling, 'Holding Bot 3'), true)).toBeNull()
  })
  it('says how to let go of a grab that is let go of with the mouse', () => {
    expect(releaseHint(held(fling, 'Holding Bot 3'), false)).toEqual({ text: 'let go to fling' })
  })
})
