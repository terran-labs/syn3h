/**
 * One way out when the WebGPU device or its instance goes away.
 *
 * A GPU process crash, a driver reset, sleep and wake or a phone reclaiming the GPU drops the
 * page's WebGPU instance. three.js wraps every pipeline creation in pushErrorScope and
 * popErrorScope().then(...) with no rejection handler, so each scope still open, and each one
 * opened later, rejects with "Instance dropped in popErrorScope" as an unhandled rejection: a
 * page error per pipeline, 2,580 in under a minute on a hosted Linux runner's software
 * WebGPU. And three only stops drawing when device.lost reports a reason other than
 * 'destroyed', so a device destroyed by anyone but the game left a frozen canvas and no notice.
 *
 * guardDevice makes every such sign one event: the renderer is marked lost (three's render,
 * compute and compile paths return early from then on), its onDeviceLost runs once with the
 * reason, and a rejected popErrorScope resolves as "no error" instead of escaping. The caller's
 * onDeviceLost shows the Reload notice (diagnostics.ts), the same path a lost WebGL context takes.
 * There is no live switch to WebGL 2: every material and target would have to be rebuilt.
 */

import { getConsoleFunction, setConsoleFunction } from 'three/webgpu'

// Three catches the native rejection, then logs the reason once for each material.
// Tag only rejections whose own device has been lost. Other renderers may be healthy.
const LOST_PIPELINE = 'Syn3h covered pipeline rejected on a lost device'
let filteringLostPipelines = false
function silenceLostPipelineDetails(): void {
  if (filteringLostPipelines) return
  filteringLostPipelines = true
  const previous = getConsoleFunction()
  setConsoleFunction((level, message, ...args) => {
    if (level === 'error' && message.startsWith('THREE.WebGPURenderer: Async render pipeline creation failed (') &&
        message.endsWith(': ' + LOST_PIPELINE)) return
    if (previous) previous(level, message, ...args)
    else {
      const trace = args[0] as { isStackTrace?: boolean; getError?(message: string): unknown } | undefined
      if (trace?.isStackTrace && trace.getError) console[level](trace.getError(message))
      else console[level](message, ...args)
    }
  })
}

/** What three's WebGPURenderer exposes that this needs. */
export interface GuardedRenderer {
  backend: unknown
  onDeviceLost: (info: DeviceLossInfo) => void
  dispose?: () => void
  _isDeviceLost?: boolean
}
export interface DeviceLossInfo { api: string; message: string; reason: string | null; originalEvent?: unknown }

interface GuardableDevice {
  lost: Promise<{ reason?: string; message?: string }>
  popErrorScope: () => Promise<unknown>
  createRenderPipelineAsync?: GPUDevice['createRenderPipelineAsync']
}

/**
 * Install the guard on a WebGPU renderer's device. Does nothing on the WebGL backend. Returns
 * true when installed. Safe to call once per renderer; a second call is ignored.
 */
export function guardDevice(renderer: GuardedRenderer): boolean {
  const backend = renderer.backend as { device?: GuardableDevice; __syn3hGuarded?: boolean } | undefined
  const device = backend?.device
  if (!backend || !device || backend.__syn3hGuarded) return false
  backend.__syn3hGuarded = true
  let disposing = false
  const lose = (reason: string | null, message: string, originalEvent?: unknown) => {
    if (renderer._isDeviceLost) return
    renderer.onDeviceLost({ api: 'WebGPU', message, reason, originalEvent })
    // three's own handler sets this; set it here too in case onDeviceLost was replaced.
    renderer._isDeviceLost = true
  }

  const create = device.createRenderPipelineAsync?.bind(device)
  if (create) {
    let reported = false
    device.createRenderPipelineAsync = async descriptor => {
      try { return await create(descriptor) } catch (error) {
        const message = errorMessage(error)
        if (!renderer._isDeviceLost && /a valid external instance reference no longer exists|instance dropped/i.test(message)) {
          lose('unknown', message, error)
        }
        if (!renderer._isDeviceLost) throw error
        if (!reported) {
          reported = true
          silenceLostPipelineDetails()
          console.warn('WebGPU device lost during pipeline preparation; outstanding render pipelines were cancelled.')
        }
        throw new Error(LOST_PIPELINE, { cause: error })
      }
    }
  }

  // A rejected scope means the instance is gone: report the loss once and answer three's
  // .then() with "no error", so nothing reaches the page as an unhandled rejection.
  const pop = device.popErrorScope.bind(device)
  device.popErrorScope = () => {
    let pending: Promise<unknown>
    try { pending = pop() } catch (error) { lose('unknown', errorMessage(error)); return Promise.resolve(null) }
    return pending.then(result => renderer._isDeviceLost ? null : result).catch(error => { lose('unknown', errorMessage(error)); return null })
  }

  // three ignores reason 'destroyed' (its own dispose destroys the device). Anything else that
  // destroys it leaves the game drawing into nothing, so count it as a loss unless the
  // renderer is being disposed.
  if (renderer.dispose) {
    const dispose = renderer.dispose.bind(renderer)
    renderer.dispose = () => { disposing = true; dispose() }
  }
  device.lost.then(info => {
    if (info?.reason === 'destroyed' && !disposing) lose('destroyed', info.message || 'The device was destroyed', info)
  }, () => { /* A lost promise never rejects; nothing to report if one does. */ })
  return true
}

/**
 * Run one frame's work (updates and drawing) so a lost device cannot throw into the page.
 *
 * Two windows matter. Once the renderer is marked lost, three's render, compute and compile
 * return early, and the game makes no other renderer calls in `work` (Game.frame skips its
 * draw), so the frame touches the GPU not at all. Before that, between the instance dropping and
 * device.lost resolving, three may still create a buffer for something drawn for the first
 * time, and Chrome then throws synchronously ("createBuffer failed, size (48) is too large for
 * the implementation when mappedAtCreation == true", v26.11.1901's hosted check): an uncaught
 * page error out of the animation frame. Such a throw from a WebGPU call is held here instead.
 * If the loss is reported within LOSS_CONFIRM_MS it was the loss and stays silent; if not, it
 * was a real error and is thrown then, so a genuine bug is never hidden.
 */
export function runGuarded(renderer: GuardedRenderer, work: () => void): void {
  if (!renderer._isDeviceLost) {
    try { work() } catch (error) { if (!holdGpuError(renderer, error)) throw error }
    return
  }
  try { work() } catch (error) {
    // Lost already: a WebGPU call failing now is the loss, not news.
    if (!isGpuCallError(error)) throw error
  }
}

/** How long a WebGPU call's error waits for the device loss that would explain it. */
export const LOSS_CONFIRM_MS = 2000
const held = new WeakSet<GuardedRenderer>()
function holdGpuError(renderer: GuardedRenderer, error: unknown): boolean {
  if (!isGpuCallError(error)) return false
  if (held.has(renderer)) return true
  held.add(renderer)
  setTimeout(() => {
    held.delete(renderer)
    if (!renderer._isDeviceLost) throw error
  }, LOSS_CONFIRM_MS)
  return true
}

/** An exception thrown by a WebGPU API call ("Failed to execute 'createBuffer' on 'GPUDevice': ..."). */
export function isGpuCallError(error: unknown): boolean {
  return /on 'GPU[A-Za-z]+'/.test(errorMessage(error))
}

function errorMessage(error: unknown): string {
  return (error as { message?: string } | null)?.message || String(error)
}
