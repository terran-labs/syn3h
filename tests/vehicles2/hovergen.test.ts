import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { ENVELOPE, EYE, HOVER_DESIGNS, THRUSTER } from '../../src/vehicles/hovergen/designs'
import { BUDGET, hoverLevels, NextHover } from '../../src/vehicles/hovergen/NextHover'

describe('generated next-generation hovercraft', () => {
  it('offers five distinct designs', () => {
    expect(HOVER_DESIGNS).toHaveLength(5)
    expect(new Set(HOVER_DESIGNS.map(d => d.id)).size).toBe(5)
  })
  for (const design of HOVER_DESIGNS) {
    it(`${design.name} builds, fits the current collision hull and keeps the body's functions`, () => {
      const craft = new NextHover(design)
      craft.object.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return
        const p = o.geometry.getAttribute('position'), n = o.geometry.getAttribute('normal')
        for (let i = 0; i < p.count; i++) expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i) + n.getX(i) + n.getY(i) + n.getZ(i))).toBe(true)
      })
      // Everything, the straight thruster included, stays inside Hovercraft.ts's assisted collider.
      const box = craft.bounds(), slack = .005
      expect(box.min.x).toBeGreaterThanOrEqual(ENVELOPE.minX - slack); expect(box.max.x).toBeLessThanOrEqual(ENVELOPE.maxX + slack)
      expect(box.min.y).toBeGreaterThanOrEqual(ENVELOPE.minY - slack); expect(box.max.y).toBeLessThanOrEqual(ENVELOPE.maxY + slack)
      expect(box.min.z).toBeGreaterThanOrEqual(ENVELOPE.minZ - slack); expect(box.max.z).toBeLessThanOrEqual(ENVELOPE.maxZ + slack)
      // And it is a full size body, not a toy inside the collider.
      expect(box.max.x - box.min.x).toBeGreaterThan(2.3); expect(box.max.z - box.min.z).toBeGreaterThan(2.9)
      // One lift port in each quadrant of the hover footprint (ground samples at x +-1, z +-1.3).
      expect(craft.ports).toHaveLength(4)
      for (const sx of [1, -1]) for (const sz of [1, -1]) expect(craft.ports.filter(([x, , z]) => Math.sign(x) === sx && Math.sign(z) === sz)).toHaveLength(1)
      // The main thruster is on the centreline at the stern, near the prefab's glow, and swivels.
      const main = craft.nozzles.find(n => n.x === 0)!
      expect(main).toBeDefined(); expect(main.z).toBeGreaterThan(1); expect(Math.abs(main.y - THRUSTER[1])).toBeLessThan(.2)
      expect(craft.thruster.children.length).toBeGreaterThan(0)
      craft.setVector(.3); expect(craft.thruster.rotation.y).toBeCloseTo(-.3)
      // Black glass covers the ride camera: the eye is inside the canopy's plan and under its top.
      const glass = craft.object.getObjectByName('hover-glass') as THREE.Mesh
      glass.geometry.computeBoundingBox(); const g = glass.geometry.boundingBox!
      expect(g.min.z).toBeLessThan(EYE[2]); expect(g.max.z).toBeGreaterThan(EYE[2]); expect(g.max.y).toBeGreaterThan(EYE[1])
      craft.dispose()
      // Both generated detail levels meet the vehicle pattern's triangle budgets and keep every function.
      const [near, mid] = hoverLevels(design)
      expect(near.triangles()).toBeLessThanOrEqual(BUDGET.near); expect(mid.triangles()).toBeLessThanOrEqual(BUDGET.mid)
      for (const level of [near, mid]) {
        expect(level.ports).toHaveLength(4); expect(level.thruster.children.length).toBeGreaterThan(0)
        const b = level.bounds()
        expect(b.max.x).toBeLessThanOrEqual(ENVELOPE.maxX + slack); expect(b.max.y).toBeLessThanOrEqual(ENVELOPE.maxY + slack); expect(b.max.z).toBeLessThanOrEqual(ENVELOPE.maxZ + slack)
        level.dispose()
      }
    })
  }
})
