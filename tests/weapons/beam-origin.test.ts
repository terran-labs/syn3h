/**
 * The drawn tag beam leaves from inside the firing vehicle. The owner's report: from the chase
 * camera the green began in the air behind the buggy and swept forward through it, because
 * the beam's 10 m tail was hung behind a head that started only 2.4 m ahead of the centre.
 *
 * Invariants, on a loop that runs physics steps and drawn frames at different rates so the
 * drawn vehicle is interpolated between steps, as in the game:
 * - while the beam is coming out, its drawn start is the vehicle's drawn centre;
 * - it never starts behind that centre, at rest or at speed, for a fresh shot or for another
 *   player's shot learnt of late while their vehicle is drawn in the past;
 * - its drawn end stays on the line the shot is simulated along, the line hits are judged on.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import type { ShotInfo } from '../../shared/protocol'
import type { Game } from '../../src/core/Game'
import { FIXED_DT, RAPIER, createWorld, initPhysics } from '../../src/core/physics'
import { Lasers } from '../../src/weapons/Lasers'

beforeAll(initPhysics)
afterEach(() => vi.unstubAllGlobals())

/** Drawn frames at 50 Hz against 60 Hz steps, so the blend between steps varies frame to frame. */
const FRAME = 1 / 50
/** How close the drawn start must be to the drawn centre, metres. */
const NEAR = 0.05

interface Run {
  /** Per drawn frame: drawn start and end, the shooter's drawn centre, and its heading. */
  frames: { tail: THREE.Vector3; head: THREE.Vector3; centre: THREE.Vector3; fwd: THREE.Vector3; tied: boolean }[]
  shot: ShotInfo
}

/**
 * A vehicle driving along -z at `speed`, firing once on the first step, then `frames` drawn
 * frames. `lagSteps` > 0 makes it another player's: the shot is learnt of `lateBy` seconds
 * late and the vehicle is drawn `lagSteps` steps in the past, as replicas are.
 */
function fly(speed: number, opts: { lagSteps?: number; lateBy?: number; dir?: [number, number, number]; frames?: number } = {}): Run {
  const world = createWorld(0)
  vi.stubGlobal('window', { performance })
  vi.stubGlobal('document', { pointerLockElement: null })
  const game = { world, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), canvas: {}, time: 0, renderer: { toneMappingExposure: 1 } } as unknown as Game
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0).setGravityScale(0))
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.5, 2), body)
  // Positions after each step, oldest first: the drawn vehicle blends two of them.
  const history: THREE.Vector3[] = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)]
  const lag = opts.lagSteps ?? 0
  let alphaNow = 0
  const drawn = (alpha: number, out: THREE.Vector3) => {
    const n = history.length
    const a = history[Math.max(0, n - 2 - lag)], b = history[Math.max(0, n - 1 - lag)]
    return out.lerpVectors(a, b, alpha)
  }
  const lasers = new Lasers(game, {
    bodyOf: (id) => (id === 7 ? body : undefined), judgedId: () => null, isVehicleBody: () => false, onHit: () => {},
    centreOf: (id, alpha, out) => { if (id !== 7) return false; drawn(alpha, out); return true },
  })
  const run: Run = { frames: [], shot: null as unknown as ShotInfo }
  try {
    let acc = 0, steps = 0
    const step = () => {
      body.setLinvel({ x: 0, y: 0, z: -speed }, true)
      if (steps === 0) {
        const shot = lasers.aim(body, 0)
        if (opts.dir) shot.d = opts.dir
        run.shot = shot
        lasers.spawn(7, shot, opts.lateBy ?? 0)
      }
      lasers.fixedUpdate(FIXED_DT)
      world.step()
      const t = body.translation()
      history.push(new THREE.Vector3(t.x, t.y, t.z))
      steps++
    }
    for (let f = 0; f < (opts.frames ?? 12); f++) {
      acc += FRAME
      while (acc >= FIXED_DT) { step(); acc -= FIXED_DT }
      alphaNow = acc / FIXED_DT
      lasers.update(FRAME, alphaNow)
      const span = lasers.drawnSpan(7, run.shot.id)
      if (!span) continue
      const p = (lasers as unknown as { shots: { tied: boolean }[] }).shots[0]
      run.frames.push({ ...span, centre: drawn(alphaNow, new THREE.Vector3()), fwd: new THREE.Vector3(0, 0, -1), tied: p.tied })
    }
  } finally {
    lasers.dispose()
    world.free()
  }
  return run
}

/** Distance from `p` to the line the shot flies along. */
function offLine(shot: ShotInfo, p: THREE.Vector3): number {
  return new THREE.Ray(new THREE.Vector3(...shot.o), new THREE.Vector3(...shot.d).normalize()).distanceToPoint(p)
}

describe('tag beam origin', () => {
  for (const speed of [0, 50, 100]) {
    it(`starts at the firing vehicle's drawn centre and never behind it, at ${speed} m/s`, () => {
      const run = fly(speed)
      expect(run.frames.length).toBeGreaterThan(5)
      // The first drawn frame always shows the beam leaving the vehicle.
      expect(run.frames[0].tail.distanceTo(run.frames[0].centre)).toBeLessThan(NEAR)
      for (const f of run.frames) {
        if (f.tied) expect(f.tail.distanceTo(f.centre)).toBeLessThan(NEAR)
        expect(f.tail.clone().sub(f.centre).dot(f.fwd)).toBeGreaterThan(-NEAR)
        expect(offLine(run.shot, f.head)).toBeLessThan(1e-3)
      }
      // And it does let go and fly free.
      expect(run.frames.at(-1)!.tied).toBe(false)
    })
  }

  it('starts at the centre when aimed off to the side and up, and ends on the aimed line', () => {
    const d = new THREE.Vector3(0.5, 0.2, -1).normalize()
    const run = fly(80, { dir: [d.x, d.y, d.z] })
    expect(run.frames[0].tail.distanceTo(run.frames[0].centre)).toBeLessThan(NEAR)
    for (const f of run.frames) expect(offLine(run.shot, f.head)).toBeLessThan(1e-3)
  })

  it("starts at the centre of another player's vehicle drawn in the past, for a shot learnt of late", () => {
    // Replica drawn 6 steps (0.1 s) behind; the shot arrives 0.12 s after it was fired.
    const run = fly(60, { lagSteps: 6, lateBy: 0.12 })
    expect(run.frames.length).toBeGreaterThan(3)
    expect(run.frames[0].tail.distanceTo(run.frames[0].centre)).toBeLessThan(NEAR)
    for (const f of run.frames) {
      if (f.tied) expect(f.tail.clone().sub(f.centre).dot(f.fwd)).toBeGreaterThan(-NEAR)
      expect(offLine(run.shot, f.head)).toBeLessThan(1e-3)
    }
  })
})
