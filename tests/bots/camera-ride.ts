/**
 * How the chase camera behaves on a real drive, as numbers. A mind drives the real buggy
 * over the real generated terrain while the real ChaseCamera follows; each frame records
 * how far the lens is from the ground, whether any corner of the near plane is under it
 * (that is the white you see through the world), whether the ground hides the car, and how
 * steadily the view turns and rises. Used by the camera tests and for before and after
 * comparisons while tuning.
 */
import { PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three/webgpu'
import type { Game } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { ChaseCamera } from '../../src/core/ChaseCamera'
import { createWorld } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { DAYDREAM_PERSONALITY } from '../../src/bots/Daydream'
import { Mind } from '../../src/bots/mind/Mind'
import { createNavigator, pointsOfInterest } from '../../src/bots/nav'
import { createPilot } from '../../src/bots/pilot'
import { island } from './island'

const DT = 1 / 50

export function ride(seed: string, seconds: number, kind = 0) {
  const world = createWorld(9.81), terrain = island(world, 1, { kind })
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 20000)
  const game = { world, scene: new Scene(), tick: 0, camera, input: { state: emptyInput(), suspended: false } } as unknown as Game
  const spawn = terrain.spawnPoint(0), sights = pointsOfInterest(terrain)
  const buggy = new Syn3hBuggy(game, terrain, spawn.position, spawn.heading); buggy.isLocal = false
  const mind = new Mind(buggy, terrain, createPilot(buggy, terrain)!, { seed, personality: DAYDREAM_PERSONALITY, navigator: createNavigator(terrain), places: () => sights })
  const chase = new ChaseCamera(game, terrain); chase.setVehicle(buggy)
  const surface = (x: number, z: number) => Math.max(terrain.heightAt(x, z), terrain.liquidHeightAt?.(x, z) ?? -Infinity)
  const forward = new Vector3(), last = new Vector3(), corner = new Vector3(), q = new Quaternion(), toCar = new Vector3()
  let frames = 0, minClear = Infinity, clipped = 0, hidden = 0, sumJerk = 0, maxTurn = 0, lastTurn = 0, lastY = NaN, lastVy = 0, sumLift = 0, maxPop = 0, lastDistance = NaN
  const turns: number[] = []
  for (let i = 0; i < seconds / DT; i++) {
    mind.step(DT, buggy.input); buggy.fixedUpdate(DT); world.step(); buggy.postPhysics(DT); buggy.update(DT, 1)
    chase.update(DT)
    if (i < 100) { camera.getWorldDirection(last); lastY = camera.position.y; continue } // let it settle from the spawn drop
    frames++
    const c = camera.position
    // Lens to ground: the lowest clearance in a small ring round the camera.
    let clear = c.y - surface(c.x, c.z)
    for (let a = 0; a < 4; a++) clear = Math.min(clear, c.y - surface(c.x + Math.cos(a * Math.PI / 2) * 0.8, c.z + Math.sin(a * Math.PI / 2) * 0.8))
    minClear = Math.min(minClear, clear)
    // The four corners of the near plane: any of them under the ground shows the void.
    const h = Math.tan(camera.fov * Math.PI / 360) * camera.near, w = h * camera.aspect
    q.copy(camera.quaternion)
    let under = false
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      corner.set(sx * w, sy * h, -camera.near).applyQuaternion(q).add(c)
      if (corner.y < surface(corner.x, corner.z)) under = true
    }
    if (under) clipped++
    // Ground between the lens and the car.
    toCar.copy(buggy.object.position).sub(c)
    let blocked = false
    for (let t = 0.15; t < 0.9 && !blocked; t += 0.15) blocked = c.y + toCar.y * t < surface(c.x + toCar.x * t, c.z + toCar.z * t) - 0.3
    if (blocked) hidden++
    // How steadily the view turns: turn rate, and its change from frame to frame.
    camera.getWorldDirection(forward)
    const turn = Math.acos(Math.min(1, forward.dot(last))) * 180 / Math.PI / DT
    turns.push(turn); maxTurn = Math.max(maxTurn, turn)
    sumJerk += ((turn - lastTurn) / DT) ** 2; lastTurn = turn; last.copy(forward)
    // How steadily it rises and falls.
    const vy = (c.y - lastY) / DT
    sumLift += ((vy - lastVy) / DT) ** 2; lastVy = vy; lastY = c.y
    const distance = c.distanceTo(buggy.object.position)
    if (Number.isFinite(lastDistance)) maxPop = Math.max(maxPop, Math.abs(distance - lastDistance))
    if (process.env.CAMERA_VERBOSE && Number.isFinite(lastDistance) && Math.abs(distance - lastDistance) > 0.5) { const p = buggy.object.position, v = buggy.body.linvel(); require('node:fs').appendFileSync('/tmp/syn3h-camera-ride.log', `  pop ${(distance - lastDistance).toFixed(2)} at ${(i * DT).toFixed(1)}s car ${p.x.toFixed(0)},${p.y.toFixed(1)},${p.z.toFixed(0)} v ${Math.hypot(v.x, v.z).toFixed(1)},${v.y.toFixed(1)} cam y ${c.y.toFixed(1)} ground ${surface(c.x, c.z).toFixed(1)} act ${mind.activity.kind}\n`) }
    lastDistance = distance
  }
  turns.sort((a, b) => a - b)
  chase.dispose(); world.free()
  return {
    minClear, clippedShare: clipped / frames, hiddenShare: hidden / frames,
    turnP50: turns[Math.floor(turns.length * 0.5)], turnP99: turns[Math.floor(turns.length * 0.99)], maxTurn,
    /** RMS change in turn rate, degrees per second squared: the shake you feel. */
    turnJerk: Math.sqrt(sumJerk / frames),
    /** RMS vertical acceleration of the lens, m/s^2: the bounce. */
    bounce: Math.sqrt(sumLift / frames),
    /** Largest single-frame change in distance to the car, metres: the pop when the arm shortens. */
    maxPop,
  }
}
