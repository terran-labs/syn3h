/**
 * The game's buggy skin (generated), in Node: build time, code cost and counts.
 *
 *   npx tsx tools/buggy-fit/skin-cost.ts
 *
 * Build: construction to ready, median of 9 after 2 warm-up builds. Code: an esbuild bundle of
 * the skin (minified, three external, gzip -9), which includes the code it shares with other
 * vehicles. Counts: triangles and draws of visible meshes at 0, 60 and 300 m, as the vehicle
 * lab counts them (an InstancedMesh is one draw, its triangles per instance).
 */
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import * as esbuild from 'esbuild'
import * as THREE from 'three/webgpu'
import type { VehicleDetail } from '../../src/vehicles/skins/mergeStatic'
import { MiraBuggySkin } from '../../src/vehicles/skins/MiraBuggySkin'

const root = resolve(import.meta.dirname, '../..')
async function gzip(contents: string): Promise<number> {
  const r = await esbuild.build({ stdin: { contents, resolveDir: root, loader: 'ts' }, bundle: true, minify: true, format: 'esm', platform: 'browser', write: false, external: ['three', 'three/*'], logLevel: 'silent' })
  return gzipSync(r.outputFiles[0].contents, { level: 9 }).length
}
const g = await gzip("export { MiraBuggySkin } from './src/vehicles/skins/MiraBuggySkin'")

const times: number[] = []
for (let i = 0; i < 11; i++) {
  const t = performance.now()
  const skin = new MiraBuggySkin()
  await skin.ready
  if (i >= 2) times.push(performance.now() - t)
  skin.dispose()
}
times.sort((a, b) => a - b)

const scene = new THREE.Group(), callbacks = new Set<VehicleDetail>()
scene.userData.registerVehicleDetail = (fn: VehicleDetail) => { callbacks.add(fn); return () => callbacks.delete(fn) }
const skin = new MiraBuggySkin(); scene.add(skin.object)
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
  buildMsMedian: Number(times[times.length >> 1].toFixed(1)),
  counts,
  gzipBytes: { skin: g, modelFilesNoLongerLoaded: 287689 },
}, null, 1))
