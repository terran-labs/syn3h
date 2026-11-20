import { describe, expect, it } from 'vitest'
import { DRIVE_KEYS, pausedKeyAction, shotFileName } from '../../src/ui/screenshot'

// The bug this catches: S is reverse and brake while driving. If the screenshot shortcut ever
// answered outside the pause screen, braking would save pictures instead of stopping the car.
describe('the pause screen keys', () => {
  const playing = { paused: false, repeat: false, typing: false }
  const paused = { paused: true, repeat: false, typing: false }

  it('S does nothing here unless the game is paused', () => {
    expect(pausedKeyAction('KeyS', playing)).toBeNull()
    for (const code of DRIVE_KEYS) expect(pausedKeyAction(code, playing)).toBeNull()
  })
  it('S saves a screenshot while paused and does not resume', () => {
    expect(pausedKeyAction('KeyS', paused)).toBe('shot')
  })
  it('the other drive keys still resume', () => {
    for (const code of DRIVE_KEYS) if (code !== 'KeyS') expect(pausedKeyAction(code, paused)).toBe('resume')
  })
  it('a held key or one typed into a field does neither', () => {
    expect(pausedKeyAction('KeyS', { ...paused, repeat: true })).toBeNull()
    expect(pausedKeyAction('KeyS', { ...paused, typing: true })).toBeNull()
    expect(pausedKeyAction('KeyW', { ...paused, typing: true })).toBeNull()
  })
})

describe('the screenshot file name', () => {
  it('names the world, its planet and the local minute', () => {
    expect(shotFileName('Zansaeth', 'Badlands', new Date(2026, 10, 19, 20, 10))).toBe('syn3h-zansaeth-badlands-20261119-2010.png')
    expect(shotFileName('Ōra Vé', 'Ice  shelf', new Date(2026, 0, 2, 3, 4))).toBe('syn3h-ora-ve-ice-shelf-20260102-0304.png')
    expect(shotFileName('', '', new Date(2026, 0, 2, 3, 4))).toBe('syn3h-20260102-0304.png')
  })
})
