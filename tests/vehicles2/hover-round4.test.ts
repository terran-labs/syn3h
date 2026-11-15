import { describe, expect, it } from 'vitest'
import * as T from 'three/webgpu'
import { BUGGY_GROUND_SIZE } from '../../src/vehicles/hovergen/heritage'
import { R3_EYE, floating, round3Hull } from '../../src/vehicles/hovergen/round3'
import { R4_DESIGNS, buildRound4, round4Far } from '../../src/vehicles/hovergen/round4'
import { R3_BUDGET, Round3Hover, type HoverSpec } from '../../src/vehicles/hovergen/Round3Hover'
import { hover } from '../../src/dev/vehicleLab/exhibits/hover'
import { filterDesigns, countStats } from '../../src/dev/vehicleLab/logic'

const specOf = (d: typeof R4_DESIGNS[number]): HoverSpec => ({ id: d.id, paint: d.paint, accent: d.accent, build: detail => buildRound4(d, detail), far: () => round4Far(d) })

describe('hovercraft round four', () => {
  it('opens by default in the lab and keeps the earlier rounds', async () => {
    const designs = await hover.designs()
    expect(filterDesigns(designs).group).toBe('4')
    expect(filterDesigns(designs).designs).toHaveLength(5)
    for (const [group, n] of [['3', 10], ['2', 5], ['1', 5]] as const) expect(filterDesigns(designs, group).designs).toHaveLength(n)
    expect(new Set(R4_DESIGNS.map(d => [d.head, d.duct, d.wing, d.nose, d.shoulder, d.blade].join())).size).toBe(5)
  })
  for (const design of R4_DESIGNS) {
    it(`${design.name}: fittings attached, thruster closed, budgets, scale and cockpit`, () => {
      const hull = round3Hull(design)
      expect(hull[2][1]).toBeGreaterThan(hull[4][1] * 1.2)
      expect(hull[6][1]).toBeGreaterThan(hull[4][1] * 1.2)
      for (const detail of [.55, .4, .16]) {
        const build = buildRound4(design, detail)
        expect(floating(build)).toEqual([])
        // From astern, a ray down the duct's axis stops on something solid inside the cowl.
        const solids = build.builder.pieces.filter(p => p.mat === 'dark').map(p => new T.Mesh(p.geometry, new T.MeshBasicMaterial()))
        const y = build.builder.gimbal!.y, hit = new T.Raycaster(new T.Vector3(0, y, 3), new T.Vector3(0, 0, -1)).intersectObjects(solids)[0]
        expect(hit?.point.z).toBeGreaterThan(1.85)
        expect(hit?.face!.normal.z).toBeGreaterThan(.9)
        for (const g of [...build.builder.pieces.map(p => p.geometry), ...build.head, ...build.tail]) g.dispose()
      }
      for (const level of [0, 1, 2] as const) {
        const craft = new Round3Hover(specOf(design), level)
        try {
          craft.object.updateMatrixWorld(true)
          const box = new T.Box3().setFromObject(craft.object), size = box.getSize(new T.Vector3())
          expect(size.x / BUGGY_GROUND_SIZE.width).toBeGreaterThan(.9)
          expect(size.x / BUGGY_GROUND_SIZE.width).toBeLessThan(1.1)
          expect(size.z / BUGGY_GROUND_SIZE.length).toBeGreaterThan(.9)
          expect(size.z / BUGGY_GROUND_SIZE.length).toBeLessThan(1.1)
          expect(craft.triangles()).toBeLessThanOrEqual(R3_BUDGET[level])
          craft.object.traverse(o => {
            if (!(o instanceof T.Mesh)) return
            const p = o.geometry.attributes.position
            for (let i = 0; i < p.count; i++) expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true)
          })
          expect(countStats(craft.object).drawCalls).toBeLessThanOrEqual([6, 3, 1][level])
          if (level === 0) {
            expect(craft.ports).toHaveLength(4)
            expect(craft.cockpitClearance).toBeGreaterThanOrEqual(.25)
            expect(box.containsPoint(new T.Vector3(...R3_EYE))).toBe(true)
            // Central duct, so rudder vanes steer in the exhaust (merged into one draw).
            expect(craft.thruster.children.length).toBeGreaterThanOrEqual(1)
          }
        } finally { craft.dispose() }
      }
    })
  }
})
