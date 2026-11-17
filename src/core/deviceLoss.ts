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

  // A rejected scope means the instance is gone: report the loss once and answer three's
  // .then() with "no error", so nothing reaches the page as an unhandled rejection.
  const pop = device.popErrorScope.bind(device)
  device.popErrorScope = () => {
    let pending: Promise<unknown>
    try { pending = pop() } catch (error) { lose('unknown', errorMessage(error)); return Promise.resolve(null) }
    return pending.catch(error => { lose('unknown', errorMessage(error)); return null })
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

function errorMessage(error: unknown): string {
  return (error as { message?: string } | null)?.message || String(error)
}
