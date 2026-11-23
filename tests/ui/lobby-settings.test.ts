/** The lobby settings card's rules: what Sound shows, which version, where Tab goes. */
import { expect, it } from 'vitest'
import { cycleFocus, gearPath, soundRows, versionLabel } from '../../src/ui/LobbySettings'
import type { PropertyDef } from '../../src/ui/inspector/model'

const def = (id: string, group = 'Audio'): PropertyDef => ({ id, label: id, group, scope: 'client', default: 0.5, min: 0, max: 1, step: 0.01 })

it('shows music, master and mute, in that order, and no other audio setting', () => {
  const defs = [def('audio.master'), def('audio.effects'), def('audio.music'), def('audio.muted'), def('audio.wind'), def('camera.sensitivity', 'Camera')]
  // The other audio settings act only in a world; the in-game panel has them.
  expect(soundRows(defs).map(d => d.id)).toEqual(['audio.music', 'audio.master', 'audio.muted'])
})

it('shows the pinned version on a pinned page, else the build label', () => {
  expect(versionLabel('26.11.1603', 'https://mira.example/')).toBe('v26.11.1603')
  expect(versionLabel('v26.11.1603', 'https://mira.example/')).toBe('v26.11.1603')
  expect(versionLabel('26.11.1604', 'https://mira.example/?v=26.11.1601')).toBe('v26.11.1601')
  expect(versionLabel('26.11.1604', 'https://mira.example/v/26.11.1602/')).toBe('v26.11.1602')
  expect(versionLabel(undefined, 'https://mira.example/')).toBe('browser edition')
  expect(versionLabel('26.11.1604', 'https://mira.example/?v=nonsense')).toBe('v26.11.1604')
})

it('keeps Tab inside the panel, wrapping both ways', () => {
  const list = ['a', 'b', 'c']
  expect(cycleFocus(list, 'a', false)).toBe('b')
  expect(cycleFocus(list, 'c', false)).toBe('a')
  expect(cycleFocus(list, 'a', true)).toBe('c')
  expect(cycleFocus(list, 'elsewhere', false)).toBe('a')
  expect(cycleFocus(list, 'elsewhere', true)).toBe('c')
  expect(cycleFocus([], 'a', false)).toBeNull()
})

it('draws the gear as one finite path', () => {
  const path = gearPath()
  expect(path.startsWith('M')).toBe(true)
  expect(path).not.toMatch(/NaN|Infinity/)
})
