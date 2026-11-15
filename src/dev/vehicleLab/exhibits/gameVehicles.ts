/**
 * Every vehicle the game can build, with no per-vehicle code: one exhibit per entry of
 * VEHICLE_KINDS (src/vehicles/index.ts), each built by the game's own `createVehicle`. A kind
 * added to the game's factory and that list appears here without anyone touching the lab.
 *
 * Each vehicle is the real thing: its physics body, its model or skin, its own materials and
 * detail levels. It gets a private Rapier world with a flat ground slab, as the headless tests
 * do (tests/vehicles/harness.ts). The body is dropped onto the slab with no input until it
 * settles, then made fixed, so it cannot fall or drive away. After that the lab keeps calling
 * the vehicle's fixed step and its visual update, which is what animates wheels, suspension,
 * wings, gear and lamps as far as they move without the body moving.
 *
 * The vehicle runs as a remote copy (`isLocal = false`): it then reads `vehicle.input`, which
 * the lab writes, rather than the keyboard, and its detail callbacks get the remote flag, so
 * Far shows what other players see.
 */
import * as THREE from 'three/webgpu'
import type { Game } from '../../../core/Game'
import { emptyInput } from '../../../core/Input'
import { FIXED_DT, GROUP_ALL, GROUP_TERRAIN, RAPIER, createWorld, groups, initPhysics } from '../../../core/physics'
import { graphicsLevel } from '../../../core/quality'
import { VEHICLE_KINDS, createVehicle, type VehicleKind } from '../../../vehicles'
import type { Vehicle } from '../../../vehicles/Vehicle'
import type { Terrain } from '../../../world/Terrain'
import { visibleBounds } from '../logic'
import { addHeadlightBeams } from '../materials'
import type { LabControl, LabExhibit, LabModel } from '../types'

/** Seconds of physics with no input before the body is fixed in place. */
const SETTLE = 3
/** Eye height above the vehicle origin when a vehicle has no ridePosition. */
const DEFAULT_EYE = .95
/** Distance handed to a vehicle's detail callbacks for Far: beyond every threshold in the game. */
const FAR = 1000
/** Most fixed steps run in one frame, so a slow frame does not snowball. */
const MAX_STEPS = 4

/** Flat ground everywhere, as the headless test bed. */
const flat: Terrain = {
  size: 40000,
  heightAt: () => 0,
  normalAt: (_x, _z, out) => out.set(0, 1, 0),
  spawnPoint: () => ({ position: new THREE.Vector3(0, 1, 0), heading: 0 }),
  dispose() {},
}

/**
 * Resolves when a vehicle's model has loaded. Vehicles expose it differently: `modelReady`
 * (jet, hovercraft, tank) or a skin's `ready` (the buggies keep the skin private, but it is
 * there at run time). Gives up after 20 s and shows whatever loaded.
 */
function loaded(vehicle: Vehicle): Promise<unknown> {
  const v = vehicle as unknown as { modelReady?: Promise<void>; skin?: { ready?: Promise<void> } | null; model?: { ready?: Promise<void> } }
  const waits = [v.modelReady, v.skin?.ready, v.model?.ready].filter((p): p is Promise<void> => !!p)
  return Promise.race([Promise.allSettled(waits), new Promise(resolve => setTimeout(resolve, 20000))])
}

/**
 * Loads still in flight on three's default loading manager, which GLTFLoader and TextureLoader
 * use unless given another. Counted by wrapping its itemStart and itemEnd once.
 */
let pending = 0
let counting = false
function countLoads(): void {
  if (counting) return
  counting = true
  const m = THREE.DefaultLoadingManager
  // Loaders call itemEnd after itemError too, so a failed load also stops counting.
  const start = m.itemStart.bind(m), end = m.itemEnd.bind(m)
  m.itemStart = url => { pending++; start(url) }
  m.itemEnd = url => { pending = Math.max(0, pending - 1); end(url) }
}
/**
 * Resolves once nothing is loading (or after 20 s). A vehicle can attach textures that are still
 * loading after its model is ready: the jet clones its armour texture before the image arrives,
 * and three throws if that clone is drawn first (see the report on Jet.ts). Waiting here keeps
 * the lab from drawing it early.
 */
async function idle(): Promise<void> {
  const until = performance.now() + 20000
  while (pending > 0 && performance.now() < until) await new Promise(resolve => setTimeout(resolve, 50))
}

function exhibitFor(entry: { kind: VehicleKind; name: string }, index: number): LabExhibit {
  const { kind, name } = entry
  return {
    id: `game-${kind}`,
    title: name,
    section: 'In the game',
    order: 10 + index,
    family: kind,
    // game-skins showed the Syn3h buggy by default.
    aliases: kind === 'buggy' ? ['game-skins'] : undefined,

    async designs() {
      return [{ id: 'game', name, notes: [`As the game builds it: createVehicle('${kind}')`, kind === 'buggy' ? 'Mid begins at 30 m; Far begins at 120 m for other players' : 'Far shows the distant model used for other players'] }]
    },

    async build(_design, ctx): Promise<LabModel> {
      ctx.status(`Loading ${name}…`)
      await initPhysics()
      const world = createWorld(9.81)
      world.createCollider(RAPIER.ColliderDesc.cuboid(200, 1, 200).setTranslation(0, -1, 0).setFriction(1).setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL)))
      // The vehicle measures detail distance from game.camera; the lab moves this stand-in.
      const eye = new THREE.Object3D()
      const game = { world, scene: new THREE.Scene(), input: { state: emptyInput() }, camera: eye, renderer: ctx.renderer } as unknown as Game
      countLoads()
      const vehicle = createVehicle(game, flat, kind, new THREE.Vector3(0, 2, 0), 0)
      vehicle.isLocal = false
      await loaded(vehicle)
      await idle()

      // Settle onto the slab, then pin the body where it came to rest, square to the world.
      const step = () => { vehicle.fixedUpdate(FIXED_DT); world.step(); vehicle.postPhysics(FIXED_DT) }
      for (let i = 0; i < SETTLE / FIXED_DT; i++) step()
      const rest = vehicle.body.translation()
      vehicle.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
      vehicle.teleport(new THREE.Vector3(0, rest.y, 0), 0)
      step(); step()
      vehicle.update(0, 1)

      // The lab's frame: the vehicle origin at x = z = 0 on the slab (y = 0).
      const object = new THREE.Group()
      object.name = kind
      vehicle.object.removeFromParent()
      object.add(vehicle.object)
      object.updateMatrixWorld(true)
      const box = visibleBounds(object)
      const colors = { ...vehicle.colors }

      const ride = (vehicle as { ridePosition?: THREE.Object3D }).ridePosition
      const eyePoint = ride ? ride.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, rest.y + DEFAULT_EYE, 0)
      const hide: THREE.Object3D[] = []
      object.traverse(o => { if (o.userData.hideInRide === true) hide.push(o) })
      const beams = addHeadlightBeams(object, [-1, 1].map(s => new THREE.Vector3(s * box.max.x * .55, box.min.y + (box.max.y - box.min.y) * .45, box.min.z + .15)))

      // Detail: -1 lets the lab camera's distance decide, as in the game; 0 and 1 force it.
      let forced = -1
      let special = 0, time = 0, accumulator = 0
      const controls: LabControl[] = [{
        kind: 'cycle', id: 'game.special', label: 'Special (wings, flight mode)', group: 'Input', options: ['Auto', 'On', 'Off'], index: 0,
        onChange(i) { special = i },
      }]

      return {
        object,
        groundY: box.min.y,
        lods: kind === 'buggy' ? ['Near', 'Mid', 'Far'] : ['Near', 'Far'],
        lodDistances: kind === 'buggy' ? [30, 120] : [graphicsLevel.value >= 2 ? 60 : 30],
        setLod(i) { forced = i },
        setColors: (body, accent) => vehicle.setColors(body, accent),
        resetColors: () => vehicle.setColors(colors.body, colors.accent),
        update(dt, state) {
          const input = vehicle.input
          time += state.animate ? dt : 0
          input.x = state.animate ? state.steer : 0
          input.y = state.animate ? state.throttle : 0
          input.z = input.y
          input.brakes = state.braking
          input.special = special === 1 || (special === 0 && state.animate && Math.floor(time / 6) % 2 === 1)
          accumulator = Math.min(accumulator + dt, FIXED_DT * MAX_STEPS)
          while (accumulator >= FIXED_DT) { step(); accumulator -= FIXED_DT }
          // The stand-in camera sits where the detail choice needs it, in the vehicle's frame.
          if (forced === 0) eye.position.copy(vehicle.object.position)
          else if (forced > 0) eye.position.copy(vehicle.object.position).setX(kind === 'buggy' && forced === 1 ? 60 : FAR)
          else object.worldToLocal(ctx.camera.getWorldPosition(eye.position))
          vehicle.update(dt, accumulator / FIXED_DT)
          beams.update(state)
        },
        cockpit: { eye: eyePoint, hide },
        controls,
        dispose() {
          beams.dispose()
          vehicle.dispose()
          world.free()
        },
      }
    },
  }
}

export const gameVehicles: LabExhibit[] = VEHICLE_KINDS.map(exhibitFor)
