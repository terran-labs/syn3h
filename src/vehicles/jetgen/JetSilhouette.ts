import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Builder, bodyRings, loft, surfRings, type Mat } from './shapes'
import type { JetDesign } from './designs'
import { setRole } from '../skins/showroom'

/** Far-distance geometry uses the design's outline, without intakes, joints or moving parts. */
class SilhouetteBuilder extends Builder {
  constructor() { super(.1, true, true) }

  override body(mat: Mat, keys: number[][], o: Parameters<Builder['body']>[2] = {}): void {
    if (mat !== 'paint') return
    // Preserve the nose, widest station and nozzle exit instead of sampling a dense loft.
    const middle = keys.slice(1, -1).reduce((a, b) => b[1] > a[1] ? b : a, keys[1])
    const stations = [keys[0], middle, keys[keys.length - 1]]
    for (const mirror of o.mirror ? [false, true] : [false]) {
      this.add('paint', loft(bodyRings(stations, o.x ?? 0, 1, 4, mirror, true)))
    }
  }

  override fuselage(keys: number[][]): void { this.body('paint', keys) }
  override cockpit(): void {
    this.body('paint', [[-2.9, .01, .01, .01, .15, 2], [-1.6, .3, .38, .06, .2, 2], [-.7, .01, .01, .01, .4, 2]])
  }
  override port(): void {}
  override leg(): void {}

  override surf(keys: number[][], o: Parameters<Builder['surf']>[1] = {}): void {
    for (const mirror of o.mirror === false ? [false] : [false, true]) {
      // One four-point aerofoil on each authored station, including the drooped wingtip.
      const rings = surfRings(keys, 1, 4, mirror, false, true).rings.filter((_, i) => i % 2 === 0)
      const end = keys[keys.length - 1], before = keys[keys.length - 2]
      const dx = (end[0] - before[0]) * (mirror ? -1 : 1), dy = end[1] - before[1]
      if (o.mirror !== false && end[0] === 0 && Math.abs(dx) > 1e-6) {
        for (const p of rings[rings.length - 1]) { p.y -= dy / dx * p.x; p.x = 0 }
      }
      this.add('paint', loft(rings))
    }
  }
}

/** One opaque draw. Intended for the selected Mk2, beyond 120 metres. */
export function buildJetSilhouette(design: JetDesign): THREE.Mesh {
  const builder = new SilhouetteBuilder(); design.build(builder)
  const parts = builder.pieces.map(p => p.geometry)
  const geometry = mergeGeometries(parts); parts.forEach(g => g.dispose())
  // The same plain numbers as the closer levels' paint, so the jet does not turn pale when it
  // steps down to the outline at 120 metres.
  const mesh = new THREE.Mesh(geometry, setRole(new THREE.MeshStandardMaterial({ color: design.paint, metalness: .8, roughness: .3 }), 'paint'))
  mesh.name = 'jet-silhouette'
  return mesh
}
