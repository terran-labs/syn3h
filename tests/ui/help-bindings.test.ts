/**
 * The help names only keys the game binds. Bug caught: a key changed in Input.ts or Jet.ts
 * while the help went on teaching the old one (the jet's E, Q and Space were the owner's
 * complaint, 25 November 2026).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { KEYS, keyLabel } from '../../src/ui/help/bindings'

const input = readFileSync('src/core/Input.ts', 'utf8'), jet = readFileSync('src/vehicles/Jet.ts', 'utf8')

describe('the help\'s key table', () => {
  it('names only keys the shared input binds', () => {
    for (const action of ['forward', 'back', 'left', 'right', 'special', 'brake', 'fire'] as const)
      for (const code of KEYS[action]) expect(input, `${action}: ${code}`).toContain(`'${code}'`)
  })
  it('names the keys the jet reads for lift and thrust, the right way round', () => {
    // Jet.ts reads its two keys directly in liftKeys; JET_LIFT_KEYS 1 means E up, Q down.
    const read = /held\.call\(this\.game\.input,'(\w+)'\),down=held\.call\(this\.game\.input,'(\w+)'\)/.exec(jet)
    expect(read, 'Jet.ts liftKeys still reads its keys').not.toBeNull()
    const flipped = /JET_LIFT_KEYS:\s*1\s*\|\s*-1\s*=\s*-1/.test(jet)
    expect([KEYS.jetUp[0], KEYS.jetDown[0]]).toEqual(flipped ? [read![2], read![1]] : [read![1], read![2]])
  })
  it('writes keys as they are printed', () => {
    expect(['KeyE', 'Space', 'ShiftLeft', 'ArrowUp', 'Digit3'].map(keyLabel)).toEqual(['E', 'Space', 'Shift', '↑', '3'])
  })
})
