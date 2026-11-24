/**
 * Objects a rebuild throws away, freed in the renderer once nothing would be rebuilt for it.
 *
 * three keeps a render object for every (object, material, pass) it has drawn, holding the
 * object's uniform buffer, its bindings and a use of its node graph and pipeline. It frees one
 * only when the object, its material or the lights are disposed: disposing the geometry is not
 * enough (r187 RenderObject.onGeometryDispose only clears the vertex state). A mesh dropped by a
 * rebuild that keeps its shared material therefore stayed in the renderer for the life of the
 * page: about 170 uniform buffers per quality cycle at phone size (the volcanics water and lava,
 * the clipmap rings, ground cover, the vent sprites, the arrival ghosts).
 *
 * Those leaked render objects were also, by accident, the only thing keeping some graphs and
 * pipelines: three counts each by use and discards it with its last user, and a level left
 * behind (Minimal's water, say) has no live user until the player returns to it. Freeing them
 * all made every return to such a level build shaders in play. So a retired object is disposed
 * (Object3D.dispose, the 'dispose' event three listens for) only when none of its render objects
 * is the last user of a graph or pipeline; one that is stays retired and is looked at again with
 * the next batch, when a rebuild may have given its graph a new user. What stays is one object
 * per graph or pipeline that would otherwise be lost: bounded by the levels and passes, not by
 * how often the player changes level. A retired object also waits RETIRE_FRAMES drawn frames
 * first, so that its replacement has drawn and holds the same graph and pipeline. Geometry and
 * materials stay with the caller: shared materials must outlive their meshes.
 */
import type { Object3D } from 'three/webgpu'

/** Drawn frames a retired object waits, so its replacement has drawn in every pass first. */
export const RETIRE_FRAMES = 3

/** The parts of three's renderer this reads: its render objects, and their graph and pipeline. */
export interface RetireRenderer {
  _objects?: { _renderObjects?: Set<RenderObjectLike> } | null
  _nodes?: (UseMap<{ nodeBuilderState?: Used }> & { nodeBuilderCache?: Map<string, Used> }) | null
  _pipelines?: UseMap<{ pipeline?: Used }> | null
}
interface RenderObjectLike { object: Object3D }
interface Used { usedTimes: number }
interface UseMap<T> { has(o: object): boolean; get(o: object): T }

const pending: { objects: Object3D[]; frames: number }[] = []
/** Retired objects kept because one of their render objects is the last user of a graph or pipeline. */
let kept: Object3D[] = []

/** Queue these objects and all their descendants to be freed in the renderer. Call once they are out of the scene. */
export function retire(...roots: (Object3D | null | undefined)[]): void {
  const objects: Object3D[] = []
  for (const root of roots) root?.traverse(o => { objects.push(o) })
  if (objects.length) pending.push({ objects, frames: RETIRE_FRAMES })
}

/** Called once after each drawn frame (Game.step). */
export function freeRetired(renderer: RetireRenderer): void {
  let due: Object3D[] | null = null
  for (let i = pending.length - 1; i >= 0; i--) {
    const batch = pending[i]
    if (--batch.frames > 0) continue
    pending.splice(i, 1)
    ;(due ??= []).push(...batch.objects)
  }
  if (!due) return
  // The objects kept last time are looked at again: a rebuild may have given their graphs new users.
  due.push(...kept)
  kept = []
  const all = renderer._objects?._renderObjects
  const byObject = new Map<Object3D, RenderObjectLike[]>()
  if (all) for (const ro of all) { const list = byObject.get(ro.object); if (list) list.push(ro); else byObject.set(ro.object, [ro]) }
  // Only graphs in three's shared cache can be lost and rebuilt; one built for a single object never is.
  const shared = new Set<Used>(renderer._nodes?.nodeBuilderCache?.values() ?? [])
  for (const o of new Set(due)) {
    // An object put back into a scene in the meantime is in use again: leave it.
    if (inScene(o)) continue
    const ros = byObject.get(o)
    if (ros?.some(ro => lastUser(renderer, ro, shared))) kept.push(o)
    else o.dispose()
  }
}

/** Objects waiting to be freed and objects kept for their graphs, for tests and diagnostics. */
export function retiredCounts(): { pending: number; kept: number } {
  return { pending: pending.reduce((n, b) => n + b.objects.length, 0), kept: kept.length }
}

/** Whether this render object is the only user of its shared node graph or its pipeline. */
function lastUser(renderer: RetireRenderer, ro: RenderObjectLike, shared: Set<Used>): boolean {
  const nodes = renderer._nodes, pipelines = renderer._pipelines
  const graph = nodes?.has(ro) ? nodes.get(ro).nodeBuilderState : undefined
  const pipeline = pipelines?.has(ro) ? pipelines.get(ro).pipeline : undefined
  return (!!graph && shared.has(graph) && graph.usedTimes <= 1) || (!!pipeline && pipeline.usedTimes <= 1)
}

function inScene(o: Object3D): boolean {
  let p: Object3D | null = o
  while (p) { if ((p as { isScene?: boolean }).isScene) return true; p = p.parent }
  return false
}
