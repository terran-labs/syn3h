/**
 * Entering a different world gives the player a vehicle in its fresh state; the same world
 * rebuilt, or a reconnect, changes nothing (src/core/worldEntry.ts). The owner, on v26.11.1711:
 * Zorb switched on in one world was still on after dropping into another.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { Input } from '../../src/core/Input'
import { params } from '../../shared/params'
import '../../src/world/terrain/settings'
import { applyPlanet } from '../../src/world/planets'
import { applyRoomWorld } from '../../src/net/params'
import { createWorldEntry, freshVehicle } from '../../src/core/worldEntry'
import { createVehicle, type VehicleKind } from '../../src/vehicles'
import { RemotePlayer } from '../../src/net/RemotePlayer'
import { harness } from './harness'

beforeAll(initPhysics)
const touched = ['terrain.planetSize', 'world.lavaAltitude', 'world.seed', 'gfx.level', 'hud.units', 'buggy.tyreSize']
afterEach(() => { applyPlanet('volcanic', 1, { nameSeed: 0 }); for (const id of touched) { const p = params.get(id); if (p) params.set(id, p.def.default) } })

describe('which rebuilds are a new world', () => {
  it('a different planet, from the galaxy or from the room, is entering a world', () => {
    applyPlanet('alpine', 11, { nameSeed: 5 })
    const entered = createWorldEntry()
    expect(entered()).toBe(false)
    applyPlanet('volcanic', 22, { nameSeed: 9 })
    expect(entered()).toBe(true)
    expect(entered()).toBe(false)
    // Another world of the same biome is another world too.
    applyPlanet('volcanic', 23, { nameSeed: 10 })
    expect(entered()).toBe(true)
    // The room moving everyone: its whole world arrives as one snapshot.
    const elsewhere = (() => { const keep = params.snapshot('world'); applyPlanet('archipelago', 40, { nameSeed: 3 }); const s = params.snapshot('world'); applyRoomWorld(keep); entered(); return s })()
    applyRoomWorld(elsewhere)
    expect(entered()).toBe(true)
  })

  it('the same world rebuilt by a setting, a seed nudge or a quality change is not', () => {
    applyPlanet('alpine', 11, { nameSeed: 5 })
    const entered = createWorldEntry()
    for (const [id, value] of [['terrain.planetSize', 0.5], ['world.lavaAltitude', 12], ['world.seed', 12], ['gfx.level', 0], ['hud.units', 1], ['buggy.tyreSize', 1.4]] as const) {
      params.set(id, value)
      expect(entered(), id).toBe(false)
    }
  })

  it('reconnecting to the same room changes nothing', () => {
    applyPlanet('desert', 31, { nameSeed: 7 })
    const entered = createWorldEntry()
    // The welcome on a reconnect carries the room's world, which is this one.
    applyRoomWorld(params.snapshot('world'))
    expect(entered()).toBe(false)
  })
})

/** A local vehicle with its modes on: Zorb grown, Space toggled (wings or flight mode). */
function modesOn(kind: VehicleKind) {
  const h = harness()
  const input = new Input(new EventTarget() as unknown as Window)
  ;(h.game as unknown as { input: Input }).input = input
  const v = createVehicle(h.game, h.terrain, kind, new THREE.Vector3(0, 3, 0))
  v.isLocal = true
  v.setColors('#ff2200', '#00ffcc'); v.name = 'Ada'; v.id = '7'
  input.state.zorb = true; input.state.special = true
  input.external.y = 1
  h.step(v, 600)
  expect(v.zorb.active).toBe(true)
  v.liquidState.heat = 0.8
  return { h, v, input, done() { v.dispose(); h.world.free() } }
}

const spawn = new THREE.Vector3(40, 3, 40)

describe('entering a world', () => {
  for (const kind of ['buggy', 'jet', 'hovercraft'] as VehicleKind[]) {
    it(`gives a fresh ${kind}: modes off, nothing held, identity kept`, () => {
      const { h, v, input, done } = modesOn(kind)
      try {
        const kept = { kind: v.kind, colors: { ...v.colors }, name: v.name, id: v.id, tyres: params.get('buggy.tyreSize')!.value }
        freshVehicle(v, input)
        v.teleport(spawn, 0)
        h.step(v, 30)
        expect(input.state).toMatchObject({ zorb: false, special: false, x: 0, y: 0, brakes: false, fire: false })
        expect(Object.keys(input.external)).toEqual([])
        expect(v.input.zorb || v.input.special).toBe(false)
        expect(v.zorb.active).toBe(false)
        expect(v.zorb.radius).toBe(0)
        expect(v.wingsOpen).toBe(false)
        expect(v.liquidState.heat).toBe(0)
        expect({ kind: v.kind, colors: v.colors, name: v.name, id: v.id, tyres: params.get('buggy.tyreSize')!.value }).toEqual(kept)
      } finally { done() }
    })
  }

  it('the same world rebuilt only re-seats the vehicle: Zorb and wings stay on', () => {
    const { h, v, input, done } = modesOn('buggy')
    try {
      v.teleport(spawn, 0)
      h.step(v, 30)
      expect(input.state.zorb && input.state.special).toBe(true)
      expect(v.zorb.active).toBe(true)
    } finally { done() }
  })

  it("other players' copy shows no ball once its owner enters a world, and keeps it otherwise", () => {
    for (const entered of [true, false]) {
      const h = harness()
      const v = createVehicle(h.game, h.terrain, 'buggy', new THREE.Vector3(0, 3, 0))
      const remote = new RemotePlayer({ id: 3, name: 'Bo' } as never, v)
      try {
        v.input.zorb = true; v.input.special = true
        h.step(v, 600)
        expect(v.zorb.active).toBe(true)
        remote.reseat(() => 0, entered)
        h.step(v, 1)
        expect(v.zorb.active).toBe(!entered)
        expect(v.input.special).toBe(!entered)
      } finally { v.dispose(); h.world.free() }
    }
  })
})
