import { expect, it } from 'vitest'
import { readGlassTint } from '../../src/fx/post/GlassButton'

it('keeps shader ownership when the CSS build shortens a glass tint to hex', () => {
  const tint = readGlassTint('rgb(17 34 51 / 0.2)')
  expect(readGlassTint('#11223333')).toEqual(tint)
  expect(readGlassTint('#1233')).toEqual(tint)
  expect(readGlassTint('#ffffff0f')).toEqual([1, 1, 1, 15 / 255])
})
