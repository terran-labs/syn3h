import { describe, expect, it } from 'vitest'
import * as T from 'three/webgpu'
import { BUGGY_GROUND_SIZE, HERITAGE_DESIGNS } from '../../src/vehicles/hovergen/heritage'
import { HOVER_DESIGNS } from '../../src/vehicles/hovergen/designs'
import { R3_DESIGNS, R3_EYE, buildRound3, floating, round3Hull } from '../../src/vehicles/hovergen/round3'
import { R3_BUDGET, Round3Hover } from '../../src/vehicles/hovergen/Round3Hover'
import { hover } from '../../src/dev/vehicleLab/exhibits/hover'
import { filterDesigns, countStats } from '../../src/dev/vehicleLab/logic'

describe('hovercraft round three', () => {
  it('stays selectable in the lab and keeps rounds one and two', async () => {
    const designs = await hover.designs()
    expect(filterDesigns(designs, '3').designs).toHaveLength(10)
    expect(filterDesigns(designs, '2').designs).toHaveLength(5)
    expect(filterDesigns(designs, '1').designs).toHaveLength(5)
    expect(new Set([...HOVER_DESIGNS, ...HERITAGE_DESIGNS, ...R3_DESIGNS].map(d => d.id)).size).toBe(20)
  })
  it('explores ten different combinations', () => {
    expect(R3_DESIGNS).toHaveLength(10)
    const recipe = (d: typeof R3_DESIGNS[number]) => [d.head, d.lamps, d.thruster, d.spoiler, d.vents, d.stripe, d.chine].join()
    expect(new Set(R3_DESIGNS.map(recipe)).size).toBe(10)
    for (const key of ['head', 'lamps', 'thruster', 'spoiler'] as const) expect(new Set(R3_DESIGNS.map(d => d[key])).size).toBeGreaterThan(1)
  })
  for (const design of R3_DESIGNS) {
    it(`${design.name}: no fitting floats free of the hull`, () => {
      for (const detail of [.55, .4, .16]) {
        const build = buildRound3(design, detail)
        expect(build.anchors.length).toBeGreaterThanOrEqual(4)
        expect(floating(build)).toEqual([])
        // Every lamp touches the hull or a part that does: its box reaches inside the body's outline.
        const hullBox = new T.Box3()
        for (const piece of build.builder.pieces) if (piece.mat === 'paint' || piece.mat === 'dark') { piece.geometry.computeBoundingBox(); hullBox.union(piece.geometry.boundingBox!) }
        for (const lamp of [...build.head, ...build.tail]) {
          lamp.computeBoundingBox()
          const box = lamp.boundingBox!, centre = box.getCenter(new T.Vector3())
          expect(Number.isFinite(centre.length())).toBe(true)
          // Within 13 cm of solid body along the craft's length, at its own height and width.
          const reach = [0, .05, .09, .13].some(d => [-1, 1].some(s => build.inside(centre.x, centre.y, centre.z + s * d)) ) || build.inside(centre.x * .9, centre.y, centre.z)
          const band = box.max.x - box.min.x > 1
          expect(reach || band).toBe(true)
          expect(hullBox.intersectsBox(box)).toBe(true)
        }
        for (const g of [...build.builder.pieces.map(p => p.geometry), ...build.head, ...build.tail]) g.dispose()
      }
    })
    it(`${design.name}: original proportions, buggy scale, budgets and a usable cockpit`, () => {
      const hull = round3Hull(design)
      expect(hull[2][1]).toBeGreaterThan(hull[4][1] * 1.2)
      expect(hull[6][1]).toBeGreaterThan(hull[4][1] * 1.2)
      for (const level of [0, 1, 2] as const) {
        const craft = new Round3Hover(design, level)
        try {
          craft.object.updateMatrixWorld(true)
          const box = new T.Box3().setFromObject(craft.object), size = box.getSize(new T.Vector3())
          expect(size.x / BUGGY_GROUND_SIZE.width).toBeGreaterThan(.9)
          expect(size.x / BUGGY_GROUND_SIZE.width).toBeLessThan(1.1)
          expect(size.z / BUGGY_GROUND_SIZE.length).toBeGreaterThan(.9)
          expect(size.z / BUGGY_GROUND_SIZE.length).toBeLessThan(1.1)
          expect(size.y).toBeGreaterThan(.7)
          expect(craft.triangles()).toBeLessThanOrEqual(R3_BUDGET[level])
          craft.object.traverse(o => {
            if (!(o instanceof T.Mesh)) return
            const p = o.geometry.attributes.position
            for (let i = 0; i < p.count; i++) expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true)
          })
          expect(countStats(craft.object).drawCalls).toBeLessThanOrEqual([6, 3, 1][level])
          if (level === 0) {
            expect(craft.ports).toHaveLength(4)
            expect(craft.beams.length).toBeGreaterThanOrEqual(2)
            expect(craft.cockpitClearance).toBeGreaterThanOrEqual(.25)
            expect(box.containsPoint(new T.Vector3(...R3_EYE))).toBe(true)
          }
        } finally { craft.dispose() }
      }
    })
  }
})
