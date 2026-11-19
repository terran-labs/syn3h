import { describe, expect, it } from 'vitest'
import { emptyInput } from '../../src/core/Input'
import { ACCESSORIES, FLIGHT, FLIP, WINGS, ZORB, accessoriesOf, newAccessoryState } from '../../src/vehicles/accessories'
import { zorbSpeed } from '../../src/vehicles/zorb'

/** A stand-in for Input: the accessories switch `state` exactly as the keys do. */
const fakeInput = () => {
  const state = emptyInput()
  return { state, toggleZorb() { state.zorb = !state.zorb } } as unknown as import('../../src/core/Input').Input
}

describe('vehicle accessories', () => {
  it('lists what each vehicle has: wings on the buggy, a mode on the jet, Zorb on all', () => {
    for (const kind of ['buggy', 'buggy-syn3h', 'buggy-classic'] as const) expect(ACCESSORIES[kind]).toContain(WINGS)
    expect(ACCESSORIES.jet).toContain(FLIGHT)
    for (const kind of Object.keys(ACCESSORIES)) expect(accessoriesOf(kind)).toContain(ZORB)
    expect(accessoriesOf('hovercraft')).not.toContain(WINGS)
    expect(accessoriesOf('jet')).not.toContain(WINGS)
    // A kind added later without an entry still gets Zorb, and Flip upright.
    expect(accessoriesOf('submarine')).toEqual([ZORB, FLIP])
  })
  // Bug caught: a phone or desktop player on their roof in a metre of lava with no way to ask
  // for Flip upright, or a Flip row cluttering the column while it cannot act.
  it('offers Flip upright on every vehicle, only while it can act, and asks the input for it', () => {
    for (const kind of Object.keys(ACCESSORIES)) expect(accessoriesOf(kind)).toContain(FLIP)
    expect(FLIP.shown?.({ kind: 'buggy', canFlip: true })).toBe(true)
    expect(FLIP.shown?.({ kind: 'buggy', canFlip: false })).toBe(false)
    expect(FLIP.shown?.({ kind: 'buggy' })).toBe(false)
    let asked = 0
    FLIP.toggle({ requestFlip: () => { asked++ } } as unknown as import('../../src/core/Input').Input)
    expect(asked).toBe(1)
  })
  it('switches the same state its key does, and reads it back', () => {
    const input = fakeInput(), out = newAccessoryState()
    WINGS.toggle(input); expect(input.state.special).toBe(true)
    expect(WINGS.read({ kind: 'buggy', wingState: 1 }, input.state, out).on).toBe(true)
    FLIGHT.toggle(input); expect(input.state.special).toBe(false)
    expect(FLIGHT.read({ kind: 'jet' }, input.state, out).value).toBe('Hover')
    ZORB.toggle(input); expect(input.state.zorb).toBe(true)
    expect(ZORB.read({ kind: 'jet' }, input.state, out).on).toBe(true)
  })
  it('shows wings moving between folded and open', () => {
    const input = fakeInput(), out = newAccessoryState()
    input.state.special = true
    expect(WINGS.read({ kind: 'buggy', wingState: .4 }, input.state, out).moving).toBeCloseTo(.4)
    expect(WINGS.read({ kind: 'buggy', wingState: 1 }, input.state, out).moving).toBe(-1)
  })
  it('says why a switch cannot be used now', () => {
    const input = fakeInput(), out = newAccessoryState()
    expect(WINGS.read({ kind: 'buggy', zorbed: true }, input.state, out).unavailable).not.toBe('')
    expect(WINGS.reasons?.[out.unavailable]).toBeTruthy()
    const before = zorbSpeed.value
    try {
      (zorbSpeed as { value: number }).value = 0
      expect(ZORB.read({ kind: 'buggy' }, input.state, out).unavailable).not.toBe('')
    } finally { (zorbSpeed as { value: number }).value = before }
  })
})
