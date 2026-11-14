/**
 * Lava and vent feature data. Filled by later passes.
 */
export interface LavaLake {
  x: number
  z: number
  radius: number
  surface: number
  floor: number
}

export interface LavaPool {
  x: number
  z: number
  radius: number
  surface: number
}

export interface LavaRiverPoint {
  x: number
  y: number
  z: number
}

export interface LavaRiver {
  points: LavaRiverPoint[]
  width: number
  pool: LavaPool
}

export interface LavaFeatures {
  lake: LavaLake | null
  rivers: LavaRiver[]
  pools: LavaPool[]
}

export type VentKind = 'flame' | 'embers' | 'smoke'

export interface Vent {
  x: number
  y: number
  z: number
  kind: VentKind
  size: number
}
