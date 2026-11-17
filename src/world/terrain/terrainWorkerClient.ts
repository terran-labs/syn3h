/**
 * Asking the terrain worker (terrainWorker.ts) for one world's heights, with every way it can
 * fail ending in null, so the caller generates on the main thread instead. A world must never
 * wait on a worker that did not load (blocked, 404 in a built site), threw, or never answers:
 * the dive into it would hold in the air for nothing.
 */
import type { TerrainData } from './generate'
import type { TerrainSettings } from './settings'

export interface TerrainResult { data: TerrainData; seam: number; ms: number }
/** What the worker is to this module: something to post to and hear from. */
export interface TerrainWorkerLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: Event) => void): void
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: Event) => void): void
}
type Reply = { key: string; data?: TerrainData; seam?: number; ms?: number; error?: string }

/**
 * Long enough for a slow phone to generate a world (several times the 100 ms of a fast
 * desktop), short enough that a silent worker does not hold the dive to its own ceiling.
 */
export const WORKER_TIMEOUT_MS = 6000

/**
 * Ask for one world. Resolves with the result, or with `{ failed }` when the worker answered
 * with an error (it still works for later worlds), or `{ broken }` when it could not run or
 * never answered (do not use it again). Never rejects.
 */
export function requestTerrain(worker: TerrainWorkerLike, key: string, seed: number, settings: TerrainSettings, timeoutMs = WORKER_TIMEOUT_MS): Promise<TerrainResult | { failed: string } | { broken: string }> {
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: TerrainResult | { failed: string } | { broken: string }) => {
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage); worker.removeEventListener('error', onError); worker.removeEventListener('messageerror', onError)
      resolve(result)
    }
    const onMessage = (event: Event) => {
      const reply = (event as MessageEvent<Reply>).data
      if (!reply || reply.key !== key) return
      if (reply.data) finish({ data: reply.data, seam: reply.seam ?? 0, ms: reply.ms ?? 0 })
      else finish({ failed: reply.error ?? 'no data' })
    }
    const onError = (event: Event) => finish({ broken: (event as ErrorEvent).message || event.type })
    worker.addEventListener('message', onMessage); worker.addEventListener('error', onError); worker.addEventListener('messageerror', onError)
    timer = setTimeout(() => finish({ broken: `no answer in ${timeoutMs} ms` }), timeoutMs)
    try { worker.postMessage({ key, seed: seed | 0, settings }) } catch (error) { finish({ broken: String(error) }) }
  })
}
