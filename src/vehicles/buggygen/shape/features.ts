import type { CageData } from '../cage/generator'
import type { HandleId } from './handles'

/**
 * The sculpted features of the cage body that the rig keeps rigid. Each is found in the cage
 * from its faces' roles: the connected pieces of a role whose centre lies in the feature's box
 * (half cage, millimetres, as the cage stores them). Finding them by role rather than by point
 * number keeps the rig working when the cage is refitted.
 */
export interface FeatureRule {
  id: FeatureId
  /** Roles whose connected pieces make up the feature. */
  roles: string[]
  /** Box the centre of a piece must lie in: [min x, max x, min y, max y, min z, max z], mm. */
  box: [number, number, number, number, number, number]
  /** Handle that scales the feature uniformly, if any. */
  size?: HandleId
  /** How far (m) the paint around the feature blends from rigid into the field. */
  blend: number
}

export type FeatureId = 'headlight' | 'scoop' | 'hoodScoop' | 'tailLamps' | 'cockpit'

export const FEATURE_RULES: readonly FeatureRule[] = [
  // Nose duct: its chrome bezel, the dark well and the lamp face in it.
  { id: 'headlight', roles: ['chrome', 'frame', 'lamp:head'], box: [450, 800, 200, 600, -1900, -1450], size: 'lampSize', blend: .16 },
  // Side intake behind the front wheel: chrome rim and dark throat.
  { id: 'scoop', roles: ['chrome', 'frame'], box: [650, 1000, 0, 700, -500, 200], size: 'scoopSize', blend: .2 },
  // Hood scoop: chrome rim, dark walls and the stripe inside it.
  { id: 'hoodScoop', roles: ['chrome', 'frame', 'accent'], box: [0, 450, 400, 600, -1500, -1200], blend: .14 },
  // The two tail lamp bars, kept together so their spacing holds.
  { id: 'tailLamps', roles: ['lamp:tail'], box: [200, 800, 400, 650, 1700, 2000], blend: .14 },
  // The cockpit rim and the small dark vent that shares points with its rear quarter: canopy
  // and tub follow it (parts.ts).
  { id: 'cockpit', roles: ['chrome', 'frame'], box: [0, 700, 600, 950, -500, 500], size: 'cockpitSize', blend: .18 },
]

export interface Feature extends FeatureRule {
  /** Half cage point indices. */
  points: number[]
  /** Whether the feature crosses the mirror plane (then it may only pitch, rise and slide). */
  centred: boolean
}

/** The features of a cage, each point in at most one (earlier rules win). */
export function findFeatures(cage: CageData): Feature[] {
  const n = cage.v.length / 3, taken = new Uint8Array(n)
  return FEATURE_RULES.map(rule => {
    const points = new Set<number>()
    for (const role of rule.roles) {
      const r = cage.roles.indexOf(role)
      if (r < 0) continue
      // Connected pieces of this role (faces sharing a point).
      const parent = new Map<number, number>()
      const find = (x: number): number => { while (parent.get(x) !== x) x = parent.get(x)!; return x }
      for (let f = 0; f < cage.t.length; f++) if (cage.t[f] === r) for (let k = 0; k < 3; k++) { const v = cage.f[f * 3 + k]; if (!parent.has(v)) parent.set(v, v) }
      for (let f = 0; f < cage.t.length; f++) if (cage.t[f] === r) {
        const a = find(cage.f[f * 3])
        for (let k = 1; k < 3; k++) { const b = find(cage.f[f * 3 + k]); if (a !== b) parent.set(b, a) }
      }
      const pieces = new Map<number, number[]>()
      for (const v of parent.keys()) { const k = find(v); let list = pieces.get(k); if (!list) pieces.set(k, list = []); list.push(v) }
      for (const list of pieces.values()) {
        const c = [0, 1, 2].map(k => list.reduce((s, v) => s + cage.v[v * 3 + k], 0) / list.length)
        const [x0, x1, y0, y1, z0, z1] = rule.box
        if (c[0] >= x0 && c[0] <= x1 && c[1] >= y0 && c[1] <= y1 && c[2] >= z0 && c[2] <= z1) for (const v of list) if (!taken[v]) points.add(v)
      }
    }
    const list = [...points].sort((a, b) => a - b)
    for (const v of list) taken[v] = 1
    return { ...rule, points: list, centred: list.some(v => cage.v[v * 3] === 0) }
  })
}
