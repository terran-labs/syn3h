/**
 * The contract between the vehicle lab (lab.ts) and the vehicles it shows. A vehicle lane adds
 * one file under exhibits/ that implements LabExhibit and one line in exhibits/index.ts; the lab
 * supplies the studio, camera, lights, detail switching, stats, paint, motion and capture.
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
  /** Designs to compare. Called once when the page opens. */
  designs(): Promise<LabDesignInfo[]>
  /** Builds one design. Called lazily, at most once per design, and again for stress copies only by cloning. */
  build(design: LabDesignInfo, ctx: LabContext): Promise<LabModel>
  /** Word for a group in buttons, for example 'Round'. Defaults to 'Group'. */
  groupLabel?: string
  /** Heading for a group, for example 'Syn3h buggy: round 2, built on Wide body'. Defaults to title. */
  heading?(group: string | undefined): string
  /** Designs shown when the page opens, by id. Defaults to the first design of the group. */
  defaultDesign?(group: string | undefined): string | undefined
}

/** What the lab hands an exhibit while it builds. */
export interface LabContext {
  /** Reports progress in the status line, for example 'Loading wheels'. */
  status(text: string): void
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
  /** -1 full reverse to 1 flat out. Cycles gently while `animate` is on, otherwise 0. */
  throttle: number
  /** -1 full left to 1 full right. Cycles gently while `animate` is on, otherwise 0. */
  steer: number
  /** Motion toggle: animate suspension, wheels, gear and so on. */
  animate: boolean
}

/**
 * A control a model adds to the bar. `id` ties the same control across designs: in side by side
 * mode the lab applies a change to every model that has a control with that id.
 */
export type LabControl =
  | { kind: 'toggle'; id: string; label: string; value: boolean; onChange(value: boolean): void }
  | { kind: 'cycle'; id: string; label: string; options: string[]; index: number; onChange(index: number): void }
  | { kind: 'slider'; id: string; label: string; min: number; max: number; step: number; value: number; onChange(value: number): void }

/** Triangles and draw calls the renderer is asked for, before frustum culling and shadow passes. */
export interface LabStats { triangles: number; drawCalls: number }
