import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import {
  countStats, filterDesigns, groupsOf, parseLabParams, pickAutoLod, resolveDesign, resolveLod, RollingAverage, stressGrid,
} from '../../src/dev/vehicleLab/logic'
import type { LabDesignInfo } from '../../src/dev/vehicleLab/types'

const mat = () => new THREE.MeshBasicMaterial()

describe('countStats', () => {
  it('counts indexed and non indexed triangles and one draw per mesh', () => {
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), mat())) // indexed: 12 triangles
    root.add(new THREE.Mesh(new THREE.BoxGeometry().toNonIndexed(), mat())) // 36 vertices: 12 triangles
    expect(countStats(root)).toEqual({ triangles: 24, drawCalls: 2 })
  })

  it('multiplies instanced triangles by the instance count but counts one draw', () => {
    const root = new THREE.Group()
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), mat(), 4)
    root.add(instanced)
    expect(countStats(root)).toEqual({ triangles: 48, drawCalls: 1 })
    instanced.count = 2
    expect(countStats(root)).toEqual({ triangles: 24, drawCalls: 1 })
  })

  it('skips hidden subtrees and hidden materials', () => {
    const root = new THREE.Group(), hidden = new THREE.Group()
    hidden.visible = false
    hidden.add(new THREE.Mesh(new THREE.BoxGeometry(), mat()))
    const invisible = mat(); invisible.visible = false
    root.add(hidden, new THREE.Mesh(new THREE.BoxGeometry(), invisible), new THREE.Mesh(new THREE.BoxGeometry(), mat()))
    expect(countStats(root)).toEqual({ triangles: 12, drawCalls: 1 })
  })

  it('counts one draw per material group and two for transparent double sided', () => {
    const box = new THREE.BoxGeometry() // six groups of two triangles
    const glass = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide })
    const root = new THREE.Group()
    root.add(new THREE.Mesh(box, [mat(), mat(), mat(), mat(), mat(), mat()]))
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), glass))
    expect(countStats(root)).toEqual({ triangles: 24, drawCalls: 8 })
  })

  it('reuses the output object', () => {
    const out = { triangles: 99, drawCalls: 99 }
    expect(countStats(new THREE.Group(), out)).toBe(out)
    expect(out).toEqual({ triangles: 0, drawCalls: 0 })
  })
})

describe('design groups', () => {
  const designs: LabDesignInfo[] = [
    { id: 'a', name: 'A', notes: [], group: '1' },
    { id: 'b', name: 'B', notes: [], group: '1', alsoIn: ['2', '3'] },
    { id: 'c', name: 'C', notes: [], group: '2' },
    { id: 'd', name: 'D', notes: [], group: '3' },
  ]
  it('lists groups in order of appearance', () => expect(groupsOf(designs)).toEqual(['1', '2', '3']))
  it('defaults to the last group, with designs carried into it', () => {
    const r = filterDesigns(designs)
    expect(r.group).toBe('3')
    expect(r.designs.map(d => d.id)).toEqual(['b', 'd'])
  })
  it('picks a named group and falls back on an unknown one', () => {
    expect(filterDesigns(designs, '1').designs.map(d => d.id)).toEqual(['a', 'b'])
    expect(filterDesigns(designs, '2').designs.map(d => d.id)).toEqual(['b', 'c'])
    expect(filterDesigns(designs, 'nine').group).toBe('3')
  })
  it('shows everything when designs have no groups', () => {
    const plain = [{ id: 'x', name: 'X', notes: [] }]
    expect(filterDesigns(plain, '2')).toEqual({ group: undefined, designs: plain })
  })
  it('resolves the design parameter by id, position or all', () => {
    expect(resolveDesign('c', designs)).toBe(2)
    expect(resolveDesign('2', designs)).toBe(1)
    expect(resolveDesign('all', designs)).toBe(-1)
    expect(resolveDesign('zzz', designs, 3)).toBe(3)
    expect(resolveDesign(undefined, designs, 1)).toBe(1)
  })
})

describe('parseLabParams', () => {
  it('reads every parameter', () => {
    const p = parseLabParams('?vehicle=tank&design=all&group=2&view=low&az=40&el=12&dist=9&lod=Far&night=1&still=1&floor=shadow&color=ff0000,00ff00&headlights=0&brake=1&motion=1&cockpit=1&stress=24&webgl=1')
    expect(p).toEqual({
      vehicle: 'tank', design: 'all', group: '2', view: 'Low', az: 40, el: 12, dist: 9, lod: 'Far', night: true, still: true,
      floor: 'Shadow', color: { body: 0xff0000, accent: 0x00ff00 }, headlights: false, brake: true, motion: true, cockpit: true, stress: 25, webgl: true,
    })
  })
  it('defaults and ignores malformed values', () => {
    const p = parseLabParams('?az=north&color=blue&view=Sideways&floor=lava')
    expect(p.vehicle).toBe('buggy')
    expect(p.az).toBeUndefined()
    expect(p.color).toBeUndefined()
    expect(p.view).toBeUndefined()
    expect(p.floor).toBeUndefined()
    expect(p.night).toBe(false)
    expect(p.headlights).toBeUndefined()
    expect(p.motion).toBeUndefined()
  })
  it('takes a body colour without an accent', () => expect(parseLabParams('?color=%23123456').color).toEqual({ body: 0x123456, accent: undefined }))
})

describe('detail levels', () => {
  it('picks levels by distance with supplied thresholds', () => {
    expect(pickAutoLod(5, 2, [30])).toBe(0)
    expect(pickAutoLod(30, 2, [30])).toBe(1)
    expect(pickAutoLod(100, 3, [20, 50])).toBe(2)
    expect(pickAutoLod(40, 3, [20, 50])).toBe(1)
  })
  it('defaults to 30 m steps and never exceeds the last level', () => {
    expect(pickAutoLod(29, 3)).toBe(0)
    expect(pickAutoLod(61, 3)).toBe(2)
    expect(pickAutoLod(1000, 2)).toBe(1)
    expect(pickAutoLod(1000, 1)).toBe(0)
  })
  it('resolves the lod parameter', () => {
    const levels = ['Near', 'Far']
    expect(resolveLod(undefined, levels)).toBe(-1)
    expect(resolveLod('auto', levels)).toBe(-1)
    expect(resolveLod('far', levels)).toBe(1)
    expect(resolveLod('0', levels)).toBe(0)
    expect(resolveLod('7', levels)).toBe(-1)
  })
})

describe('helpers', () => {
  it('averages the last samples only', () => {
    const a = new RollingAverage(3)
    expect(a.average).toBe(0)
    a.push(10); a.push(20)
    expect(a.average).toBe(15)
    a.push(30); a.push(40)
    expect(a.average).toBe(30)
  })
  it('lays stress copies on a centred grid', () => {
    const slots = stressGrid(10, 2, 3)
    expect(slots).toHaveLength(10)
    const xs = slots.map(s => s[0]), zs = slots.map(s => s[1])
    expect(Math.min(...xs)).toBe(-3); expect(Math.max(...xs)).toBe(3)
    expect(Math.min(...zs)).toBe(-3); expect(Math.max(...zs)).toBe(3)
    expect(stressGrid(1, 5, 5)).toEqual([[0, 0]])
  })
})

describe('motor sound', () => {
  it('gives each exhibit the engine voice of its vehicle', async () => {
    const { motorKind } = await import('../../src/dev/vehicleLab/logic')
    expect(motorKind('buggy')).toBe('buggy')
    expect(motorKind('game-buggy')).toBe('buggy')
    expect(motorKind('game-buggy-classic')).toBe('buggy-classic')
    expect(motorKind('jet')).toBe('jet'); expect(motorKind('game-jet')).toBe('jet')
    expect(motorKind('hover')).toBe('hovercraft'); expect(motorKind('game-hovercraft')).toBe('hovercraft')
    expect(motorKind('tank')).toBe('tank'); expect(motorKind('tank-archive')).toBe('tank')
    expect(motorKind('')).toBe('buggy')
  })
})
