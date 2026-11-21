/** Optional surface compositor on the galaxy's existing WebGL canvas. */
export interface GalaxyGlass {
  readonly available: boolean
  dirty: boolean
  draw(enabled: boolean): void
  dispose(): void
}
type Factory = (gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) => GalaxyGlass
export let createGalaxyGlass: Factory | undefined
export function installGalaxyGlass(factory: Factory) { createGalaxyGlass = factory }
