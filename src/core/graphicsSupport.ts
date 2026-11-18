/**
 * Whether this browser can draw Syn3h at all, and what to tell a player when the game cannot
 * start. A device with neither a working WebGPU adapter nor a WebGL 2 context used to reach
 * three.js anyway and fail inside it ("Cannot read properties of null (reading
 * 'getSupportedExtensions')"), shown raw with a Reload button that could not help. Now the
 * game checks first and says plainly what a person can do; any other failure gets a plain
 * sentence, with the technical detail kept behind Details and in the console.
 */
import type { AdapterProbe } from './renderOptions'
import { PhysicsLoadError } from './physicsWasm'

/** Thrown before three.js starts when there is nothing to draw with. */
export class NoGraphicsError extends Error {
  constructor(detail: string) { super(detail); this.name = 'NoGraphicsError' }
}

/**
 * Whether a WebGL 2 context can be created here. Made on a spare canvas and released at once,
 * so it holds no context slot. False when the browser has WebGL turned off or the GPU is
 * unavailable to it (hardware acceleration off with no software fallback, a blocklisted driver).
 */
export function canCreateWebGL2(doc: { createElement(tag: 'canvas'): HTMLCanvasElement } | undefined = typeof document !== 'undefined' ? document : undefined): boolean {
  if (!doc) return false
  try {
    const gl = doc.createElement('canvas').getContext('webgl2')
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

/** Whether the WebGPU adapter probe found an adapter three.js can start (real or the browser's fallback). */
export function webgpuUsable(probe: AdapterProbe): boolean {
  return probe === 'available' || probe === 'fallback'
}

/** What the start-failure notice says: a plain sentence, steps a person can take, whether a reload can help, and the technical detail. */
export interface StartFailure { kind: 'no-graphics' | 'failed'; text: string; steps: string[]; reload: boolean; details: string }

/**
 * The notice for a failed start. `rendererStarted` is whether a renderer came up before the
 * failure (then graphics are not the problem); `webgl2` whether a WebGL 2 context can be made.
 */
export function startFailure(error: unknown, graphics: { rendererStarted: boolean; webgl2: boolean }): StartFailure {
  const details = describe(error)
  if (error instanceof NoGraphicsError || (!graphics.rendererStarted && !graphics.webgl2)) {
    return {
      kind: 'no-graphics',
      text: 'Syn3h can’t draw on this browser or device: it has no 3D graphics the game can use.',
      steps: [
        'Turn on hardware acceleration (sometimes called graphics acceleration) in your browser’s settings, then open Syn3h again.',
        'Or try a current version of Chrome, Edge, Safari or Firefox.',
        'Or play on another device.',
      ],
      reload: false,
      details,
    }
  }
  // The physics engine's own failure is already written for the player (physicsWasm.ts).
  if (error instanceof PhysicsLoadError) return { kind: 'failed', text: error.message, steps: [], reload: true, details: `PhysicsLoadError: ${error.detail}` }
  return { kind: 'failed', text: 'Syn3h couldn’t start. Reloading the page often fixes this.', steps: [], reload: true, details }
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}
