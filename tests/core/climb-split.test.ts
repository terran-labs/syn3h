// Which covered climbs run as the sliced job (src/core/coveredClimb.ts). The bug: a climb to
// Ultra or Cinematic prepared in slices builds a bot jet's materials during play (see
// SLICED_CLIMB_TOP); those climbs must keep the single-frame preparation.
import { expect, it } from 'vitest'
import { SLICED_CLIMB_TOP, slicedClimbTo } from '../../src/core/coveredClimb'
import { LEVELS } from '../../src/core/quality'

it('never starts the sliced job for a pending climb to Ultra or above', () => {
  const ultra = LEVELS.findIndex(l => l.name === 'Ultra')
  expect(ultra).toBeGreaterThan(SLICED_CLIMB_TOP)
  for (let level = ultra; level < LEVELS.length; level++) expect(slicedClimbTo(level)).toBe(false)
})

it('runs the sliced job for a pending climb to High and below, and for none without a pending climb', () => {
  const high = LEVELS.findIndex(l => l.name === 'High')
  expect(high).toBe(SLICED_CLIMB_TOP)
  for (let level = 1; level <= high; level++) expect(slicedClimbTo(level)).toBe(true)
  expect(slicedClimbTo(null)).toBe(false)
})
