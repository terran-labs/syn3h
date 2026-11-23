import { describe, expect, it } from 'vitest'
import { cleanKind } from '../../shared/protocol'
import { announcedKind, needsRebuild } from '../../src/net/kinds'

describe('vehicle kinds across releases', () => {
  it('does not rebuild the copy of an older client that announces the retired buggy', () => {
    // The copy built for 'buggy-classic' is the Mira buggy and calls itself 'buggy'.
    expect(needsRebuild('buggy', 'buggy-classic')).toBe(false)
    // Nor between the two names of the Mira buggy.
    expect(needsRebuild('buggy', 'buggy-syn3h')).toBe(false)
    expect(needsRebuild('buggy-syn3h', 'buggy')).toBe(false)
  })

  it('still rebuilds when the vehicle really changes, in either direction', () => {
    expect(needsRebuild('buggy', 'jet')).toBe(true)
    expect(needsRebuild('jet', 'buggy-classic')).toBe(true)
    expect(needsRebuild('hovercraft', 'tank')).toBe(true)
    expect(needsRebuild('tank', 'tank')).toBe(false)
  })

  it('leaves a vehicle that does not say its kind alone', () => {
    expect(needsRebuild(undefined, 'jet')).toBe(false)
  })

  it('announces a retired choice as the vehicle actually driven, and others unchanged', () => {
    expect(announcedKind('buggy-classic')).toBe('buggy')
    for (const kind of ['buggy', 'buggy-syn3h', 'jet', 'hovercraft', 'tank']) expect(announcedKind(kind)).toBe(kind)
    expect(announcedKind(undefined)).toBeUndefined()
  })

  it('still accepts the retired name from an older client on the wire', () => {
    expect(cleanKind('buggy-classic')).toBe('buggy-classic')
  })
})
