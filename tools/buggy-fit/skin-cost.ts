/**
 * Generated against loaded buggy skin, in Node: build time and code cost.
 *
 *   npx tsx tools/buggy-fit/skin-cost.ts
 *
 * Build: construction to ready, median of 9 after 2 warm-up builds. Code: esbuild bundles
 * (minified, three external, gzip -9) of each skin alone and of both together; what the
 * generated skin adds to a game that already has the loaded one's shared code is
 * both minus loaded alone. Counts: triangles and draws of visible meshes at 0, 60 and 300 m,
 * as the vehicle lab counts them (an InstancedMesh is one draw, its triangles per instance).
 */
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import * as esbuild from 'esbuild'
import * as THREE from 'three/webgpu'
import type { VehicleDetail } from '../../src/vehicles/skins/mergeStatic'
import { GeneratedBuggySkin } from '../../src/vehicles/buggygen/GeneratedBuggySkin'

const root = resolve(import.meta.dirname, '../..')
async function gzip(contents: string): Promise<number> {
  const r = await esbuild.build({ stdin: { contents, resolveDir: root, loader: 'ts' }, bundle: true, minify: true, format: 'esm', platform: 'browser', write: false, external: ['three', 'three/*'], logLevel: 'silent' })
  return gzipSync(r.outputFiles[0].contents, { level: 9 }).length
}
const loaded = "export { LoadedBuggySkin } from './src/vehicles/skins/LoadedBuggySkin'"
const generated = "export { GeneratedBuggySkin } from './src/vehicles/buggygen/GeneratedBuggySkin'"
const [l, g, both] = await Promise.all([gzip(loaded), gzip(generated), gzip(`${loaded}\n${generated}`)])

const times: number[] = []
for (let i = 0; i < 11; i++) {
  const t = performance.now()
  const skin = new GeneratedBuggySkin()
  await skin.ready
  if (i >= 2) times.push(performance.now() - t)
  skin.dispose()
}
times.sort((a, b) => a - b)

const scene = new THREE.Group(), callbacks = new Set<VehicleDetail>()
scene.userData.registerVehicleDetail = (fn: VehicleDetail) => { callbacks.add(fn); return () => callbacks.delete(fn) }
const skin = new GeneratedBuggySkin(); scene.add(skin.object)
await skin.ready
const counts: Record<string, { triangles: number; draws: number }> = {}
for (const [name, distance] of [['near', 0], ['mid', 60], ['far', 300]] as const) {
  callbacks.forEach(fn => fn(distance, true, 2))
  let triangles = 0, draws = 0
  scene.traverseVisible(o => {
    if (!(o instanceof THREE.Mesh)) return
    triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o instanceof THREE.InstancedMesh ? o.count : 1)
    draws += Array.isArray(o.material) ? o.geometry.groups.length : 1
  })
  counts[name] = { triangles, draws }
}
skin.dispose()
console.log(JSON.stringify({
  generatedBuildMsMedian: Number(times[times.length >> 1].toFixed(1)),
  generatedCounts: counts,
  gzipBytes: { loadedSkinAlone: l, generatedSkinAlone: g, both, generatedAdds: both - l, modelFiles: 287689 },
}, null, 1))
