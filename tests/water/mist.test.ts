import { Group, Mesh } from 'three/webgpu'
import { expect, it } from 'vitest'
import { WaterfallMist } from '../../src/world/water/mist'

it('keeps the submitted plume for unchanged falls and removes it when the last fall disappears', () => {
  const group = new Group(), mist = new WaterfallMist(group)
  const fall = { x: 4, y: 0, z: 1, height: 12 }
  mist.set([fall], 2048)
  const plume = group.children[0] as Mesh
  expect(plume.name).toBe('waterfall-mist')
  const material = plume.material
  mist.set([{ ...fall }], 2048)
  expect(group.children[0]).toBe(plume)
  expect(plume.material).toBe(material)
  mist.set([], 2048)
  expect(group.children).toHaveLength(0)
})
