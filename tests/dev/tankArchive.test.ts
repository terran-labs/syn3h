import { expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { tankArchive } from '../../src/dev/vehicleLab/exhibits/tankArchive'
import type { LabContext } from '../../src/dev/vehicleLab/types'

it('restores every committed early tank design with unique links and working geometry', async () => {
  const designs = await tankArchive.designs()
  expect(designs).toHaveLength(10)
  expect(new Set(designs.map(d => d.id)).size).toBe(10)
  expect(new Set(designs.map(d => d.group))).toEqual(new Set(['2', '3']))
  for (const design of designs) {
    const model = await tankArchive.build(design, {} as LabContext)
    const bounds = new THREE.Box3().setFromObject(model.object)
    expect(bounds.isEmpty()).toBe(false)
    expect(bounds.getSize(new THREE.Vector3()).length()).toBeGreaterThan(5)
    model.setColors?.(0x123456, 0xabcdef)
    model.resetColors?.()
    model.dispose?.()
  }
})
