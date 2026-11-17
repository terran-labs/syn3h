/**
 * Placeholder candidate: one box per part, sized to the reference part's bounds. It exists so
 * the harness and the vehicle lab exhibit have something to show before real candidates land.
 * Bounds copied from `npx tsx tools/buggy-fit/reference.ts` (min x, y, z, max x, y, z).
 */
import * as THREE from 'three'

const BOUNDS = {
  body: [-.945, -.078, -1.956, .945, 1.012, 2.053],
  sockets: [-.863, -.11, -1.8, .863, .63, 1.6],
  interior: [-.4, .325, -.64, .4, .826, .68],
  canopy: [-.518, .666, -.832, .518, 1.053, .9],
  strut: [-.3, -.04, -.11, .3, .83, .09],
  shock: [-.084, 0, -.088, .084, 1, .088],
  stator: [-.236, -.13, -.347, .236, .13, .347],
  wings: [-7.973, 0, -5.328, 7.973, .304, 5.213],
} as const

const ROLES: Record<keyof typeof BOUNDS, string> = { body: 'paint', sockets: 'frame', interior: 'trim', canopy: 'canopy', strut: 'frame', shock: 'chrome', stator: 'frame', wings: 'glow' }

function box([x0, y0, z0, x1, y1, z1]: readonly number[], segments: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0, segments, segments, segments).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
}

export default {
  id: 'placeholder-boxes',
  numbers: Object.keys(BOUNDS).length * 6,
  build(detail: 0 | 1 | 2) {
    return (Object.keys(BOUNDS) as (keyof typeof BOUNDS)[]).map(part => ({ part, role: ROLES[part], geometry: box(BOUNDS[part], detail ? 1 : 2) }))
  },
}
