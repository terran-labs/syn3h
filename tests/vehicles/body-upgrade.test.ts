/**
 * A vehicle must never stay a primitive box. Players reported arriving as box buggies until
 * they reloaded the tab: one failed skin kept the buggy's stand in for the session.
 */
import * as THREE from 'three/webgpu'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Game } from '../../src/core/Game'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import type { BuggySkin } from '../../src/vehicles/skins/BuggySkin'
import { type Bed, makeBed } from './harness'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

/** A skin that becomes ready (or fails to build) when the test says. */
function controlledSkin() {
  let resolve!: () => void, reject!: (e: unknown) => void
  const ready = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  const skin: BuggySkin = {
    object: new THREE.Group(), ready,
    setWheel() {}, setWings() {}, setColors() {}, dispose: vi.fn(),
  }
  skin.object.visible = false
  ready.then(() => { skin.object.visible = true }, () => {})
  return { skin, resolve, reject }
}

describe('buggy body', () => {
  let bed: Bed
  beforeAll(async () => { bed = await makeBed() })
  const flush = () => new Promise(r => setTimeout(r, 0))

  it('is upgraded when a body that was not ready at construction arrives', async () => {
    const s = controlledSkin()
    const buggy = new Syn3hBuggy(bed.game as Game, bed.terrain, new THREE.Vector3(0, 1, 0), 0, 'buggy', () => s.skin)
    buggy.update(1 / 60, 1)
    expect(buggy.bodyReady).toBe(false)
    s.resolve()
    await flush()
    buggy.update(1 / 60, 1)
    expect(buggy.bodyReady).toBe(true)
    expect(s.skin.object.visible).toBe(true)
    expect(buggy.object.children.filter(c => c.visible && c !== s.skin.object && c.children.length > 0)).toHaveLength(0)
    buggy.dispose()
  })

  it('tries a fresh body after one fails, instead of keeping the box', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const skins = [controlledSkin(), controlledSkin()]
    let n = 0
    const buggy = new Syn3hBuggy(bed.game as Game, bed.terrain, new THREE.Vector3(0, 1, 0), 0, 'buggy', () => skins[n++].skin)
    skins[0].reject(new Error('broken'))
    await vi.runAllTimersAsync()
    expect(n).toBe(2)
    skins[1].resolve()
    await vi.runAllTimersAsync()
    buggy.update(1 / 60, 1)
    expect(buggy.bodyReady).toBe(true)
    expect(skins[0].skin.dispose).toHaveBeenCalled()
    buggy.dispose()
  })

  it('never brings the box back after the body loaded, even if stale visibility is restored', async () => {
    const s = controlledSkin()
    const buggy = new Syn3hBuggy(bed.game as Game, bed.terrain, new THREE.Vector3(0, 1, 0), 0, 'buggy', () => s.skin)
    // A warm-up saved visibility before the load and puts it back after it.
    const saved = buggy.object.children.map(c => [c, c.visible] as const)
    s.resolve()
    await flush()
    for (const [c, v] of saved) c.visible = v
    buggy.update(1 / 60, 1)
    expect(saved.filter(([c]) => c.visible && c !== s.skin.object && c.children.length > 0)).toHaveLength(0)
    buggy.dispose()
  })
})
