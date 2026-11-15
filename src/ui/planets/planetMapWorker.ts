/**
 * Paints planet maps off the main thread. Generating an island and painting its map takes
 * 65 to 84 ms on a desktop and several times that on a phone: here it can never hold up a
 * tap or a frame. One request at a time, answered with the pixels as a transferred buffer.
 */
import { paintPlanetMap } from '../../world/planetMap'

interface Request { key: string; id: string; seed: number; width: number; height: number }
const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void }
scope.onmessage = event => {
  const { key, id, seed, width, height } = event.data
  const map = paintPlanetMap(id, seed, width, height)
  scope.postMessage({ key, width: map.width, height: map.height, data: map.data }, [map.data.buffer])
}
