import { expect, it } from 'vitest'
import { modeChoices, modeName, EXPLORE_AVAILABLE } from '../../src/ui/modeAvailability'
import { choicesOf } from '../../src/ui/inspector/Inspector'
it('offers the server-supported modes consistently in both selectors', () => {
  expect(modeChoices.some(mode => mode.value === 2)).toBe(EXPLORE_AVAILABLE)
  expect(choicesOf({ id: 'game.mode', label: 'Mode (0 tag, 1 hill, 2 explore)', default: 2, min: 0, max: 2, step: 1, group: 'Game', scope: 'world' })?.options).toEqual(modeChoices)
})
it('names each mode explicitly without calling unknown modes Tag', () => {
  expect([0, 1, 2, 9].map(modeName)).toEqual(['Tag game', 'King of the Hill', 'Explore', 'Unknown mode'])
})
