/**
 * The contract between the vehicle lab (lab.ts) and the vehicles it shows. A vehicle lane drops
 * one file under exhibits/ that exports a LabExhibit (registry.ts finds it); the lab supplies the studio, camera, lights, detail switching, stats, paint, motion and capture.
 *
 * Frame convention for every model: nose toward -Z, Y up, metres, origin at the vehicle origin
 * (where the game places the vehicle). The lab lifts the model so its ground contact sits on the
 * studio floor, using LabModel.groundY.
 */
import type * as THREE from 'three/webgpu'

/** One design to compare: a variation of the vehicle, or the only one. */
export interface LabDesignInfo {
  id: string
  name: string
  /** Short lines shown in the notes card. */
  notes: string[]
  /** Optional group, for example a review round. The lab shows one group at a time. */
  group?: string
  /** Further groups this design also appears in, for example the pick a round was built on. */
  alsoIn?: string[]
}

export interface LabExhibit {
  /** URL id: vehicle-lab.html?vehicle=<id>. */
  id: string
  title: string
  /** Sidebar heading this vehicle is listed under, for example 'In the game'. Defaults to 'Vehicles'. */
  section?: string
  /** Sort key in the sidebar, lowest first; then by title. Defaults to 100. */
  order?: number
  /** Older URL ids that should open this exhibit. */
  aliases?: string[]
  /**
   * Vehicle family for the Parameters section: parameters whose id prefix or group matches it
   * belong to this vehicle (see vehicleParams in tree.ts). Defaults to the id.
   */
  family?: string
  /** Overrides the family match: parameter groups or id prefixes to list. [] lists none. */
  paramGroups?: string[]
  /** Designs to compare. Called once when the page opens. */
  designs(): Promise<LabDesignInfo[]>
  /** Builds one design. Called lazily, at most once per design, and again for stress copies only by cloning. */
  build(design: LabDesignInfo, ctx: LabContext): Promise<LabModel>
  /** Word for a group in buttons, for example 'Round'. Defaults to 'Group'. */
  groupLabel?: string
  /** Heading for a group, for example 'Mira buggy: round 2, built on Wide body'. Defaults to title. */
  heading?(group: string | undefined): string
  /** Design shown when the page opens, by id, or 'all' to open side by side. Defaults to the first design of the group. */
  defaultDesign?(group: string | undefined): string | undefined
}

/** What the lab hands an exhibit while it builds. */
export interface LabContext {
  /** Reports progress in the status line, for example 'Loading wheels'. */
  status(text: string): void
  /** The lab's renderer and camera, for models that read exposure or camera distance. */
  renderer: THREE.WebGPURenderer
  camera: THREE.PerspectiveCamera
}

export interface LabModel {
  /** The vehicle, nose toward -Z, Y up, origin at the vehicle origin. */
  object: THREE.Object3D
  /** Height of the ground contact relative to the origin (negative when the origin is above the ground). */
  groundY: number
  /** Detail levels this model can show, nearest first, for example ['Near', 'Far']. */
  lods?: string[]
  /** Shows level `index` of `lods`. */
  setLod?(index: number): void
  /**
   * Camera distances (metres) at which Auto detail switches to the next level: entry i is where
   * level i + 1 begins. Defaults to 30 m steps.
   */
  lodDistances?: number[]
  setColors?(body: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void
  /** Back to the colours the design was built with ('Own colours'). */
  resetColors?(): void
  /** Called every frame with the lab state the model may react to. Must not allocate. */
  update?(dt: number, state: LabState): void
  /** Driver's eye point in the model's frame, and meshes to hide while the camera is inside. */
  cockpit?: { eye: THREE.Vector3; hide?: THREE.Object3D[] }
  /** Extra controls this vehicle wants in the bar (landing gear, wings, suspension...). */
  controls?: LabControl[]
  /** Frees GPU resources. The lab removes `object` from the scene itself. */
  dispose?(): void
}

/** Lab state shared with every model each frame. */
export interface LabState {
  /** Seconds since the page opened, frozen while Motion is off. */
  time: number
  night: boolean
  headlights: boolean
  braking: boolean
  /** -1 full reverse to 1 flat out. Cycles gently while `animate` is on, or follows the keys or gamepad. */
  throttle: number
  /** -1 full left to 1 full right. Cycles gently while `animate` is on, or follows the keys or gamepad. */
  steer: number
  /**
   * -1 stick back (nose up) to 1 stick forward, as the game's input.y. Aircraft read this where
   * ground vehicles read `throttle`. Cycles gently while `animate` is on, otherwise 0.
   */
  pitch: number
  /** -1 yaw left to 1 yaw right, as the game's input.w. Cycles gently while `animate` is on, otherwise 0. */
  yaw: number
  /**
   * True while anything is moving the controls: the Motion toggle, a key or gamepad held by a
   * person, or the lab running by itself after a spell without input.
   */
  animate: boolean
}

/**
 * A control a model adds to the Options tree, under the heading `group` (default 'Vehicle').
 * `id` ties the same control across designs: in side by side mode the lab applies a change to
 * every model that has a control with that id.
 */
export type LabControl = { id: string; label: string; group?: string } & (
  | { kind: 'toggle'; value: boolean; onChange(value: boolean): void }
  | { kind: 'cycle'; options: string[]; index: number; onChange(index: number): void }
  | { kind: 'slider'; min: number; max: number; step: number; value: number; onChange(value: number): void }
)

/** Triangles and draw calls the renderer is asked for, before frustum culling and shadow passes. */
export interface LabStats { triangles: number; drawCalls: number }
