import { describe, expect, it } from 'vitest'
import * as T from 'three/webgpu'
import { HERITAGE_DESIGNS, HERITAGE_EYE, BUGGY_GROUND_SIZE, heritageHull } from '../../src/vehicles/hovergen/heritage'
import { HeritageHover } from '../../src/vehicles/hovergen/HeritageHover'
import { HOVER_DESIGNS } from '../../src/vehicles/hovergen/designs'
import { hover } from '../../src/dev/vehicleLab/exhibits/hover'
import { filterDesigns, countStats } from '../../src/dev/vehicleLab/logic'

describe('hovercraft studies based on the original', () => {
  it('opens round two through ordinary lab selection and preserves round one', async () => {
    const designs = await hover.designs()
    expect(filterDesigns(designs).group).toBe('2')
    expect(filterDesigns(designs, '1').designs).toHaveLength(5)
  })
  it('adds five distinct studies without replacing round one', () => {
    expect(HERITAGE_DESIGNS).toHaveLength(5)
    expect(HOVER_DESIGNS).toHaveLength(5)
    expect(new Set([...HOVER_DESIGNS, ...HERITAGE_DESIGNS].map(d => d.id)).size).toBe(10)
  })
  for (const design of HERITAGE_DESIGNS) {
    it(`${design.name} keeps the shoulders, waist, rear blades and buggy scale at all distances`, () => {
      const hull = heritageHull(design)
      expect(hull[2][1]).toBeGreaterThan(hull[4][1] * 1.2)
      expect(hull[6][1]).toBeGreaterThan(hull[4][1] * 1.2)
      for (const level of [0, 1, 2] as const) {
        const craft = new HeritageHover(design, level)
        try {
          craft.object.updateMatrixWorld(true)
          const box = new T.Box3().setFromObject(craft.object), size = box.getSize(new T.Vector3())
          expect(size.x / BUGGY_GROUND_SIZE.width).toBeGreaterThan(.9)
          expect(size.x / BUGGY_GROUND_SIZE.width).toBeLessThan(1.1)
          expect(size.z / BUGGY_GROUND_SIZE.length).toBeGreaterThan(.9)
          expect(size.z / BUGGY_GROUND_SIZE.length).toBeLessThan(1.1)
          expect(craft.triangles()).toBeLessThanOrEqual([12000, 2500, 500][level])
          let draws = 0, highRearLeft = false, highRearRight = false
          craft.object.traverse(o => {
            if (!(o instanceof T.Mesh)) return
            draws++
            const p = o.geometry.attributes.position, point = new T.Vector3()
            for (let i = 0; i < p.count; i++) {
              point.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld)
              expect(Number.isFinite(point.x + point.y + point.z)).toBe(true)
              if (point.y > 1.1 && point.z > 1.3) {
                if (point.x < -.4) highRearLeft = true
                if (point.x > .4) highRearRight = true
              }
            }
          })
          expect(draws).toBeLessThanOrEqual([6, 3, 1][level])
          expect(countStats(craft.object).drawCalls).toBeLessThanOrEqual([6, 3, 1][level])
          expect(highRearLeft && highRearRight).toBe(true)
          // A wing must span the supports, not merely leave two disconnected fins.
          const wingHits = new T.Raycaster(new T.Vector3(0, 3, 1.68), new T.Vector3(0, -1, 0)).intersectObject(craft.object, true)
          expect(wingHits[0]?.point.y).toBeGreaterThan(1.1)
          if (level === 0) {
            expect(craft.ports).toHaveLength(4)
            expect(craft.cockpitClearance).toBeGreaterThanOrEqual(.25)
            expect(box.containsPoint(new T.Vector3(...HERITAGE_EYE))).toBe(true)
            craft.setVector(.3)
            expect(craft.thruster.rotation.y).toBeCloseTo(-.3)
          }
        } finally { craft.dispose() }
      }
    })
  }
})
