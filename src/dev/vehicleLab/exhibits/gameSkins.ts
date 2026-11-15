/**
 * The real in-game buggy skins (Syn3hBuggySkin and ClassicBuggySkin) through the lab interface,
 * exactly as the game builds them: their own materials, merges, instancing and detail levels.
 * Motion drives setWheel, setWings, setDrive and setLights as skins.html (viewer.ts) does.
 *
 * Detail reaches the skin's own near and far levels without editing it: the skin registers its
 * detail callback with the nearest ancestor that offers `userData.registerVehicleDetail` (see
 * mergeStatic.ts), which in the game is the vehicle. Here the wrapper group offers it, and the
 * Detail control calls the callbacks as the game would for a remote buggy near or far away.
 */
import * as THREE from 'three/webgpu'
import { params } from '../../../../shared/params'
import { vehicleShading } from '../../../core/quality'
import type { VehicleDetail } from '../../../vehicles/skins/mergeStatic'
import { ClassicBuggySkin, Syn3hBuggySkin, type BuggySkin } from '../../../vehicles/skins'
import { addHeadlightBeams } from '../materials'
import type { LabControl, LabExhibit, LabModel } from '../types'

/** Per skin: rest wheel position (front right), suspension travel, ground and colours. */
const KINDS = {
  syn3h: {
    make: () => new Syn3hBuggySkin(), rest: new THREE.Vector3(1.1, -.2, 1.3), travel: .12,
    // Hub at -0.2 with the template's 0.52 m tyre radius.
    groundY: -.72, body: 0x1768b4, accent: 0x49e6ff, eye: new THREE.Vector3(0, .95, 0),
  },
  classic: {
    make: () => new ClassicBuggySkin(), rest: new THREE.Vector3(.7, -.3, .8), travel: .035,
    groundY: -.6, body: 0x1768b4, accent: 0x49e6ff, eye: null,
  },
}
const SHADING = ['0 plain', '1 bump detail', '2 clear coat', '3 showroom']
/** Distance passed to the skin for its far level: beyond every threshold the skins use. */
const FAR = 1000

const scratch = new THREE.Vector3()

export const gameSkins: LabExhibit = {
  id: 'game-skins',
  title: 'Syn3h buggy: game skins',

  async designs() {
    return [
      { id: 'syn3h', name: 'Syn3h', notes: ['The in-game Syn3h buggy skin', 'Lamps are faces of the body; headlights always glow, tail lights brighten on braking', 'Far is what other players see beyond 30 m'] },
      { id: 'classic', name: 'Mars Explorer', notes: ['Recovered original classic buggy skin', 'Far wheels are a generated reduction'] },
    ]
  },

  async build(design, ctx): Promise<LabModel> {
    const kind = KINDS[design.id as keyof typeof KINDS]
    ctx.status(`Loading ${design.name}…`)
    // The skin registers its detail callbacks with this wrapper when it finishes loading, so
    // the wrapper must be its parent before `ready` resolves.
    const object = new THREE.Group()
    const detail = new Set<VehicleDetail>()
    object.userData.registerVehicleDetail = (fn: VehicleDetail) => { detail.add(fn); return () => detail.delete(fn) }
    const skin: BuggySkin = kind.make()
    object.add(skin.object)
    await skin.ready
    skin.setColors(kind.body, kind.accent)
    // Near: as the local player sees their own buggy. Far: a remote buggy beyond the threshold.
    const setLod = (level: number) => { for (const fn of detail) fn(level ? FAR : 0, level > 0, 1) }
    setLod(0)

    const box = new THREE.Box3().setFromObject(skin.object)
    const beams = addHeadlightBeams(object, [-1, 1].map(s => new THREE.Vector3(s * box.max.x * .55, box.min.y + (box.max.y - box.min.y) * .45, box.min.z + .15)))
    const canopy: THREE.Object3D[] = []
    skin.object.traverse(o => { if (o.userData.hideInRide) canopy.push(o) })

    let wings = 0, open = 0, spin = 0
    const controls: LabControl[] = [
      { kind: 'cycle', id: 'skins.wings', label: 'Wings', options: ['auto', 'open', 'closed'], index: 0, onChange(i) { wings = i } },
      {
        kind: 'cycle', id: 'skins.shading', label: 'Shading', options: SHADING, index: Math.round(vehicleShading.value),
        onChange(i) { params.set(vehicleShading.def.id, i) },
      },
    ]

    return {
      object,
      groundY: kind.groundY,
      lods: ['Near', 'Far'],
      lodDistances: [30],
      setLod,
      setColors: (body, accent) => skin.setColors(body, accent),
      resetColors: () => skin.setColors(kind.body, kind.accent),
      update(dt, state) {
        if (state.animate) spin -= dt * state.throttle * 9
        const r = kind.rest
        for (let i = 0; i < 4; i++) {
          const travel = state.animate ? Math.sin(state.time * 2 + i) * kind.travel : 0
          scratch.set(i % 2 ? r.x : -r.x, r.y + travel, i < 2 ? -r.z : r.z)
          skin.setWheel(i, scratch, i < 2 ? -state.steer * .3 : 0, spin)
          skin.setDrive?.(i, state.animate ? state.throttle : 0, state.braking)
        }
        skin.setLights?.(state.braking)
        // Wings: auto opens and closes every 4 s while Motion is on, as skins.html.
        const target = wings === 1 ? 1 : wings === 2 ? 0 : state.animate && Math.floor(state.time / 4) % 2 === 0 ? 1 : 0
        open = THREE.MathUtils.clamp(open + Math.sign(target - open) * Math.min(Math.abs(target - open), dt * 2), 0, 1)
        skin.setWings(open, state.steer * .7, state.animate ? Math.cos(state.time * .7) * .4 : 0)
        beams.update(state)
      },
      cockpit: kind.eye ? { eye: kind.eye, hide: canopy } : undefined,
      controls,
      dispose() { beams.dispose(); skin.dispose() },
    }
  },
}
