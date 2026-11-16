/**
 * Reuse Scene.onBeforeRender: Three calls it after all game-system updates, for the final
 * scene camera. Queue once from Net.update; shadow/compile/extra passes cannot redraw tags.
 * This avoids a new Game phase and covers vehicles appended or swapped after Net started.
 */
export function afterCameraFrame<C, A extends unknown[]>(scene: { onBeforeRender: (...args: A) => void }, camera: () => C,
  cameraOf: (args: A) => C, draw: () => void): { queue(): void; dispose(): void } {
  const previous = scene.onBeforeRender
  let pending = false, active = true
  const hook = function(this: unknown, ...args: A): void {
    previous.apply(this, args)
    if (active && pending && cameraOf(args) === camera()) { pending = false; draw() }
  }
  scene.onBeforeRender = hook
  return {
    queue: () => { pending = true },
    dispose: () => { active = false; pending = false; if (scene.onBeforeRender === hook) scene.onBeforeRender = previous },
  }
}
