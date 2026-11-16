/**
 * Generates a world's terrain off the main thread: 100 ms on a fast desktop, several times
 * that on a phone, which would otherwise be one frozen frame while entering a world.
 * Generation is pure (a seed and settings in, arrays out), so the result is the same as the
 * main thread's. One request at a time, answered with the arrays transferred.
 */
import { generateTerrain } from './generate'
import { sealSeam } from './sampler'
import type { TerrainSettings } from './settings'

interface Request { key: string; seed: number; settings: TerrainSettings }
const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void }
scope.onmessage = event => {
  const { key, seed, settings } = event.data
  try {
    const start = performance.now()
    const data = generateTerrain(seed, settings)
    const seam = sealSeam(data)
    const ms = performance.now() - start
    scope.postMessage({ key, data, seam, ms }, [data.heights.buffer, data.volcanic.buffer, data.roadDist.buffer, data.trees.buffer])
  } catch (error) {
    scope.postMessage({ key, error: String(error) })
  }
}
