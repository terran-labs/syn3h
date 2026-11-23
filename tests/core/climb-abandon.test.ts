// A covered climb abandoned behind the Applying veil (the device could not prepare the level in
// time). The bug: a slow device retrying every minute pays the preparation behind every menu and
// never climbs. After an abandon the wait for that level grows; after the limit it stops trying.
// Numbers come from GOVERNOR, so retuning them moves the expectation with them.
import { expect, it } from 'vitest'
import { GOVERNOR, QualityGovernor, type QualityLevel } from '../../src/core/quality'

const at = (level: QualityLevel) => new QualityGovernor({ level, auto: true, levelPinned: false, devicePixelRatio: 1, resolution: 1 })

it('waits longer before climbing again to a level whose climb was abandoned', () => {
  const g = at(1), before = g.climbWaitMs()!
  g.noteAbandon(2)
  expect(g.climbWaitMs()).toBe(Math.min(GOVERNOR.maxClimbWaitMs, before * GOVERNOR.climbAbandonBackoff))
})

it('stops climbing to a level after the abandon limit, this session', () => {
  const g = at(1)
  for (let i = 0; i < GOVERNOR.climbAbandonLimit - 1; i++) g.noteAbandon(2)
  expect(g.climbWaitMs()).not.toBeNull()
  g.noteAbandon(2)
  expect(g.abandonsAt(2)).toBe(GOVERNOR.climbAbandonLimit)
  expect(g.climbWaitMs()).toBeNull()
  g.pendingLevel = 2
  expect(g.applyPendingClimb()).toBeNull()
})
