import { describe, expect, it } from 'vitest'
import { motorKind } from '../../src/dev/vehicleLab/logic'

describe('motor sound', () => {
  it('gives each exhibit the engine voice of its vehicle', () => {
    expect(motorKind('buggy')).toBe('buggy')
    expect(motorKind('game-buggy')).toBe('buggy')
    expect(motorKind('game-buggy-classic')).toBe('buggy-classic')
    expect(motorKind('jet')).toBe('jet'); expect(motorKind('game-jet')).toBe('jet')
    expect(motorKind('hover')).toBe('hovercraft'); expect(motorKind('game-hovercraft')).toBe('hovercraft')
    expect(motorKind('tank')).toBe('tank'); expect(motorKind('tank-archive')).toBe('tank')
    expect(motorKind('')).toBe('buggy')
  })
})
