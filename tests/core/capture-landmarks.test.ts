import { expect, it } from 'vitest'
// @ts-expect-error The browser capture helper is deliberately dependency-free JavaScript.
import { resolveCaptureTeleport } from '../../tools/capture-landmarks.mjs'
const terrain = {
  size: 1000, heightAt: (x: number) => x > 400 ? -10 : 10,
  liquidHeightAt: () => 12,
  spawnPoint: () => ({ position: {x: 1,y: 14,z: 2}, heading: 1 }),
  summit: () => ({x: 0,z: 0,rimRadius: 30,rimHeight: 10,lake: {radius: 20,surface: 12}}),
}
it('rejects unknown landmarks and invalid explicit or resolved coordinates', () => {
  expect(() => resolveCaptureTeleport(terrain,{landmark:'seaa'})).toThrow('Unknown')
  expect(() => resolveCaptureTeleport(terrain,{x:NaN,z:0})).toThrow('finite')
  expect(() => resolveCaptureTeleport({...terrain,liquidHeightAt:()=>NaN},{landmark:'lava'})).toThrow('non-finite')
})
it('resolves pad, summit, lake and exposed sea from public terrain data', () => {
  expect(resolveCaptureTeleport(terrain,{landmark:'pad'})).toEqual({x:1,y:14,z:2,heading:1})
  expect(resolveCaptureTeleport(terrain,{landmark:'summit'}).x).toBe(30)
  expect(resolveCaptureTeleport(terrain,{landmark:'lava lake'}).y).toBe(14)
  expect(resolveCaptureTeleport(terrain,{landmark:'sea'})).toMatchObject({x:470,y:14,z:0})
  expect(() => resolveCaptureTeleport({...terrain,summit:()=>null},{landmark:'summit'})).toThrow('No summit')
  expect(() => resolveCaptureTeleport({...terrain,heightAt:()=>20},{landmark:'sea'})).toThrow('No exposed sea')
})
