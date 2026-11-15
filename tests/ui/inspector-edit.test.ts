import { describe, expect, it } from 'vitest'
import { parseEdit } from '../../src/ui/inspector/Inspector'

const gravity = { min: 0.81, max: 18.81, step: 0.01 }
const budget = { min: 0, max: 4800, step: 48 }
const volume = { min: 0, max: 1, step: 0.01 }
const reversed = { min: 10, max: -10, step: 0.5 }

describe('typing a number into the inspector', () => {
  it('reads plain numbers, units, signs and decimal commas', () => {
    expect(parseEdit('9.5', gravity)).toBe(9.5)
    expect(parseEdit(' 12.34 m/s² ', gravity)).toBe(12.34)
    expect(parseEdit('2400 m', budget)).toBe(2400)
    expect(parseEdit('1,5', gravity)).toBe(1.5)
    expect(parseEdit('2,400.5', { min: 0, max: 5000 })).toBe(2400.5)
    expect(parseEdit('−3', reversed)).toBe(-3)
    expect(parseEdit('.5', volume)).toBe(0.5)
  })
  it('clamps to the limits, either way round, and snaps to the step', () => {
    expect(parseEdit('99999', gravity)).toBe(18.81)
    expect(parseEdit('-4', gravity)).toBe(0.81)
    expect(parseEdit('1000', budget)).toBe(1008)
    expect(parseEdit('20', reversed)).toBe(10)
    expect(parseEdit('-3.3', reversed)).toBe(-3.5)
    expect(parseEdit('0.1 + 0.2', { step: 0.1 })).toBeNull()
    expect(parseEdit('0.30000000004', { min: 0, max: 1, step: 0.1 })).toBe(0.3)
  })
  it('treats a percentage of a 0 to 1 property as a fraction', () => {
    expect(parseEdit('85%', volume)).toBe(0.85)
    expect(parseEdit('85%', budget)).toBe(96)
  })
  it('leaves unbounded numbers alone', () => {
    expect(parseEdit('123456.789', {})).toBe(123456.789)
    expect(parseEdit('-0', {})).toBe(0)
  })
  it('refuses text with no number in it', () => {
    for (const junk of ['', '   ', 'abc', 'm 12', '--4', '.', '1e999', '12abc34']) expect(parseEdit(junk, gravity), junk).toBeNull()
  })
})
