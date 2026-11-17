/**
 * Generated against loaded buggy skin, in Node: build time and code cost.
 *
 *   npx tsx tools/buggy-fit/skin-cost.ts
 *
 * Build: construction to ready, median of 9 after 2 warm-up builds. Code: esbuild bundles
 * (minified, three external, gzip -9) of each skin alone and of both together; what the
 * generated skin adds to a game that already has the loaded one's shared code is
 * both minus loaded alone.
 */
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import * as esbuild from 'esbuild'
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
console.log(JSON.stringify({
  generatedBuildMsMedian: Number(times[times.length >> 1].toFixed(1)),
  gzipBytes: { loadedSkinAlone: l, generatedSkinAlone: g, both, generatedAdds: both - l, modelFiles: 287689 },
}, null, 1))
