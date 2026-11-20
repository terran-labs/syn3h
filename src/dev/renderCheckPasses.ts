import {
  DepthStencilFormat, DepthTexture, FloatType, RenderTarget, UnsignedInt248Type, Vector4,
  type Camera, type Object3D, type Scene, type Texture, type WebGPURenderer,
} from 'three/webgpu'

export type PassResult = {
  name: string
  ms: number | null
  method: string
  fit?: number
  crossCheckMs?: number | null
  note?: string
}

// Three r187 does not expose these backend boundaries or render contexts in its public types.
type Context = {
  width: number
  height: number
  renderTarget: RenderTarget | null
  textures: Texture[] | null
  depthTexture: DepthTexture | null
  depth: boolean
  stencil: boolean
  clearColor: boolean
  clearDepth: boolean
  clearStencil: boolean
  clearColorValue: { r: number; g: number; b: number; a: number }
  fullscreenPass: boolean
  viewportValue: Vector4
  scissorValue: Vector4
  activeCubeFace: number
  activeMipmapLevel: number
  occlusionQueryCount: number
  camera: Camera
}

type DrawObject = {
  context: Context
  object: Object3D
  material: { name: string }
  getBindings(): { bindings: { isSampledTexture?: boolean; texture?: Texture }[] }[]
}
type Backend = {
  isWebGPUBackend?: boolean
  device?: GPUDevice
  bufferRenderer?: { info: unknown }
  gl?: WebGL2RenderingContext
  trackTimestamp: boolean
  beginRender(context: Context): void
  finishRender(context: Context): void
  draw(object: DrawObject, info: unknown): void
  beginCompute?: (group: object) => void
  copyTextureToTexture?: (source: Texture, target: Texture, ...options: unknown[]) => void
  copyFramebufferToTexture?: (texture: Texture, context: Context, rectangle: Vector4) => void
  addBundle?: (context: Context, bundle: object) => void
  get(key: object): { texture?: GPUTexture; textureGPU?: WebGLTexture }
  state?: { bindFramebuffer(target: number, framebuffer: WebGLFramebuffer | null): void }
  utils?: { getPreferredCanvasFormat?(): string }
}

// The runtime WebGPU globals are missing from this project's DOM type library.
const queryResolveUsage = 0x0200
const copySrcUsage = 0x0004
const copyDstUsage = 0x0008
const mapReadUsage = 0x0001
const mapReadMode = 0x0001

type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
type CapturedPass = {
  name: string
  sceneName: string
  context: Context
  snapshot: Context
  draws: DrawObject[]
  reads: Map<Texture, number>
  glQueries: WebGLQuery[]
  gpuQueries: number[]
  samples: number
  canvasDepthBits?: number
  partial?: string
}

const replayInfo = { update() {} }
const repeats = [1, 2, 4, 8]
const maxTimestampCount = 256
const reservePerPassMs = 60

class TimeLimit extends Error {}

function until<T>(promise: Promise<T>, deadline: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new TimeLimit('Measurement deadline reached.')), Math.max(0, deadline - performance.now()))
    promise.then(resolve, reject).finally(() => clearTimeout(timeout))
  })
}

function restoreAfter<T extends object, K extends keyof T>(
  rest: (() => void)[], owner: T, key: K, value: T[K],
): void {
  const owned = Object.prototype.hasOwnProperty.call(owner, key)
  const previous = owner[key]
  owner[key] = value
  rest.push(() => {
    if (owned) owner[key] = previous
    else delete owner[key]
  })
}

function passName(pass: CapturedPass): string {
  const { snapshot: ctx, sceneName } = pass
  const names = ctx.textures?.map(texture => texture.name).filter(Boolean) ?? []
  if (sceneName.startsWith('Shadow Map')) return sceneName
  if (sceneName === 'Indirect light source' || sceneName === 'Occlusion normals and depth') return sceneName
  if (ctx.fullscreenPass && (sceneName === 'Render Pipeline' || pass.draws[0]?.material.name === 'RenderPipeline')) return 'Final composite (fused)'
  if (ctx.fullscreenPass && !ctx.renderTarget) return 'Display output'
  if (!ctx.fullscreenPass && (!ctx.renderTarget || names.includes('output'))) return 'Scene color'
  if (!names.length && sceneName === 'RTT') return `RTT (${ctx.width} × ${ctx.height})`
  return names.join(' + ') || sceneName || pass.draws[0]?.material.name || 'Unnamed offscreen pass'
}

function fitSlope(samples: number[]): { slope: number; fit: number } {
  const average = samples.reduce((sum, sample) => sum + sample, 0) / samples.length
  const center = repeats.reduce((sum, k) => sum + k, 0) / repeats.length
  let xy = 0, xx = 0, yy = 0
  for (const [index, k] of repeats.entries()) {
    const x = k - center, y = samples[index] - average
    xy += x * y
    xx += x * x
    yy += y * y
  }
  return { slope: xy / xx, fit: yy > 0 ? Math.min(1, xy * xy / (xx * yy)) : 0 }
}

function canvasScope(pass: CapturedPass): string | undefined {
  return pass.snapshot.renderTarget ? undefined : 'Canvas GPU commands only. Browser composition and presentation are outside the measurement.'
}

function unavailable(name: string, note: string): PassResult {
  return { name, ms: null, method: 'unavailable', note }
}

/**
 * Capture one warmed production render. Call on a fresh animation frame so Three runs
 * its once-per-frame nodes. The synchronous draw should render only, with other draws
 * paused until the promise settles.
 */
export class RenderCheckPasses {
  private measuring = false

  constructor(private readonly renderer: WebGPURenderer, private readonly forceFallback = false) {}

  async measure(draw: () => void, deadline: number): Promise<PassResult[]> {
    if (this.measuring) return [unavailable('Frame', 'A pass measurement is already running.')]
    if (!Number.isFinite(deadline) || performance.now() >= deadline) {
      return [unavailable('Frame', 'Measurement deadline reached.')]
    }
    this.measuring = true
    try {
      const b = this.renderer.backend as unknown as Backend
      const ext = !this.forceFallback && b.gl
        ? b.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null : null
      const native = !this.forceFallback && Boolean(ext || b.device?.features.has('timestamp-query'))
      const results = await this.capture(draw, deadline, native, ext)
      if (!native || results.some(result => result.ms !== null)) return results
      const reason = results[0]?.note ?? 'Hardware timing yielded no usable passes.'
      if (deadline - performance.now() < 10) {
        return results.map(result => ({ ...result, note: `${result.note ?? reason} No time remained for offscreen replay.` }))
      }
      // Frame-scoped PassNode and RTTNode updates may have run in the native capture.
      // Wait for Three's animation frame before asking the caller for another production draw.
      let frame = 0
      try {
        await until(new Promise<number>(resolve => { frame = requestAnimationFrame(resolve) }), deadline)
      } catch (error) {
        if (!(error instanceof TimeLimit)) throw error
        return results.map(result => ({ ...result, note: `${result.note ?? reason} A fresh frame for replay missed the deadline.` }))
      } finally {
        cancelAnimationFrame(frame)
      }
      const fallback = await this.capture(draw, deadline, false, null)
      return fallback.map(result => ({ ...result, note: `${reason} ${result.note ?? ''}`.trim() }))
    } finally {
      this.measuring = false
    }
  }

  private async capture(draw: () => void, deadline: number, native: boolean, ext: TimerExtension | null): Promise<PassResult[]> {
    const b = this.renderer.backend as unknown as Backend
    const device = b.isWebGPUBackend ? b.device : undefined
    const gl = b.gl
    const querySet = native && device?.features.has('timestamp-query')
      ? device.createQuerySet({ type: 'timestamp', count: maxTimestampCount }) : undefined
    const passes: CapturedPass[] = [], active: CapturedPass[] = [], sceneStack: string[] = []
    const contextPass = new Map<Context, CapturedPass>()
    const restore: (() => void)[] = []
    let glQueryActive = false, nextQuery = 0, step = 0
    const writes = new Map<Texture, number>()
    let capturesCompute = false, capturesCopies = false, results: PassResult[] = []
    const startGlQuery = (pass: CapturedPass | undefined) => {
      if (!pass || !gl || !ext || glQueryActive) return
      const query = gl.createQuery()
      if (!query) return
      pass.glQueries.push(query)
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
      glQueryActive = true
    }
    const finishGlQuery = () => {
      if (gl && ext && glQueryActive) gl.endQuery(ext.TIME_ELAPSED_EXT)
      glQueryActive = false
    }

    try {
      try {
        // Use private queries so the production recorder's existing pool keeps its own samples.
        restoreAfter(restore, b, 'trackTimestamp', false)
        const inspector = this.renderer.inspector
        const inspectBegin = inspector.beginRender, inspectEnd = inspector.finishRender
        restoreAfter(restore, inspector, 'beginRender', function (uid: string, scene: Scene, camera: Camera, target: RenderTarget) {
          sceneStack.push(scene.name)
          return inspectBegin.call(inspector, uid, scene, camera, target)
        })
        restoreAfter(restore, inspector, 'finishRender', function (uid) {
          sceneStack.pop()
          return inspectEnd.call(inspector, uid)
        })

        if (device && querySet) {
          const createEncoder = device.createCommandEncoder
          restoreAfter(restore, device, 'createCommandEncoder', function (descriptor) {
            const encoder = createEncoder.call(device, descriptor)
            const begin = encoder.beginRenderPass
            encoder.beginRenderPass = function (description) {
              const pass = active.at(-1)
              if (!pass) return begin.call(this, description)
              if (nextQuery + 2 > maxTimestampCount) {
                pass.partial = 'The native timestamp query budget was exhausted.'
                return begin.call(this, description)
              }
              const index = nextQuery
              nextQuery += 2
              pass.gpuQueries.push(index)
              return begin.call(this, {
                ...description,
                timestampWrites: { querySet, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 },
              })
            }
            return encoder
          })
        }
        const begin = b.beginRender, end = b.finishRender, renderObject = b.draw
        restoreAfter(restore, b, 'beginRender', function (context) {
          finishGlQuery()
          const pass: CapturedPass = {
            name: '', sceneName: sceneStack.at(-1) ?? '', context,
            snapshot: { ...context, clearColorValue: { ...context.clearColorValue },
              viewportValue: context.viewportValue.clone(), scissorValue: context.scissorValue.clone() },
            draws: [], reads: new Map(), glQueries: [], gpuQueries: [], samples: context.renderTarget?.samples ?? 0,
          }
          passes.push(pass)
          active.push(pass)
          contextPass.set(context, pass)
          startGlQuery(pass)
          begin.call(b, context)
          if (gl && !ext) {
            pass.samples = gl.getParameter(gl.SAMPLES) as number
            if (!context.renderTarget && context.depth) pass.canvasDepthBits = gl.getParameter(gl.DEPTH_BITS) as number
          }
        })
        restoreAfter(restore, b, 'finishRender', function (context) {
          try { end.call(b, context) }
          finally {
            finishGlQuery()
            if (!native) {
              const pass = contextPass.get(context)
              for (const texture of pass?.snapshot.textures ?? []) writes.set(texture, ++step)
              if (pass?.snapshot.depthTexture) writes.set(pass.snapshot.depthTexture, ++step)
            }
            active.pop()
            contextPass.delete(context)
            startGlQuery(active.at(-1))
          }
        })
        restoreAfter(restore, b, 'draw', function (object, info) {
          const pass = contextPass.get(object.context)
          if (pass) {
            pass.draws.push(object)
            if (!native) {
              for (const group of object.getBindings()) {
                for (const binding of group.bindings) {
                  if (binding.isSampledTexture && binding.texture && !pass.reads.has(binding.texture)) {
                    pass.reads.set(binding.texture, ++step)
                  }
                }
              }
            }
          }
          renderObject.call(b, object, info)
        })
        const compute = b.beginCompute
        if (compute) restoreAfter(restore, b, 'beginCompute', function (group) {
          capturesCompute = true
          compute.call(b, group)
        })
        const copyTexture = b.copyTextureToTexture
        if (copyTexture) restoreAfter(restore, b, 'copyTextureToTexture', function (source, target, ...options) {
          capturesCopies = true
          if (!native) writes.set(target, ++step)
          copyTexture.call(b, source, target, ...options)
        })
        const copy = b.copyFramebufferToTexture
        if (copy) restoreAfter(restore, b, 'copyFramebufferToTexture', function (texture, context, rectangle) {
          const pass = contextPass.get(context)
          if (pass) pass.partial = 'The pass copies its framebuffer between draws.'
          capturesCopies = true
          if (!native) writes.set(texture, ++step)
          copy.call(b, texture, context, rectangle)
        })
        const addBundle = b.addBundle
        if (addBundle) restoreAfter(restore, b, 'addBundle', function (context, bundle) {
          const pass = contextPass.get(context)
          if (pass && !querySet && !ext) pass.partial = 'This pass submits a render bundle outside the captured draw list.'
          addBundle.call(b, context, bundle)
        })
        draw()
      } finally {
        finishGlQuery()
        for (const undo of restore.reverse()) undo()
      }

      const names = new Map<string, number>()
      for (const pass of passes) {
        const name = passName(pass)
        const count = (names.get(name) ?? 0) + 1
        names.set(name, count)
        pass.name = count === 1 ? name : `${name} #${count}`
        for (const [texture, readAt] of pass.reads) {
          if ((writes.get(texture) ?? 0) > readAt) {
            pass.partial ??= 'A sampled texture was overwritten later in the frame.'
            break
          }
        }
      }

      if (!passes.length) return [unavailable('Frame', 'The draw submitted no Three render passes.')]
      if (device && querySet) results = await this.gpuTimestamps(device, querySet, nextQuery, passes, deadline)
      else if (gl && ext) results = await this.glTimestamps(gl, ext, passes, deadline)
      else {
        // The capture's production work must finish before the first fit sample.
        if (device) await until(device.queue.onSubmittedWorkDone(), deadline)
        const ordered = passes.filter(pass => !this.replayLimit(pass))
        const priority = (pass: CapturedPass) => pass.name === 'Scene color' ? 0 : pass.name === 'Final composite (fused)' ? 1 : 2
        ordered.sort((a, b) => priority(a) - priority(b))
        const replayed = new Map<CapturedPass, PassResult>()
        for (const [index, pass] of ordered.entries()) {
          const remaining = Math.max(0, deadline - performance.now())
          const pending = ordered.length - index - 1
          const reserve = Math.min(reservePerPassMs * pending, remaining * .55)
          replayed.set(pass, await this.replay(b, pass, deadline - reserve))
        }
        results = passes.map(pass => replayed.get(pass) ?? unavailable(pass.name, this.replayLimit(pass) ?? 'Replay deadline reached.'))
      }
      if (capturesCompute) results.push(unavailable('Compute work', 'Compute commands are outside these render-pass timings.'))
      if (capturesCopies) results.push(unavailable('Texture copies', 'Standalone texture copies and copy gaps are outside these render-pass timings.'))
      return results
    } catch (error) {
      if (!(error instanceof TimeLimit)) throw error
      return passes.map(pass => unavailable(pass.name || passName(pass), error.message))
    } finally {
      querySet?.destroy()
      for (const pass of passes) for (const query of pass.glQueries) gl?.deleteQuery(query)
    }
  }

  private async gpuTimestamps(device: GPUDevice, queries: GPUQuerySet, count: number,
    passes: CapturedPass[], deadline: number): Promise<PassResult[]> {
    if (!count) return passes.map(pass => unavailable(pass.name, 'No hardware queries were written.'))
    const size = count * 8
    const resolve = device.createBuffer({ size, usage: queryResolveUsage | copySrcUsage })
    const read = device.createBuffer({ size, usage: copyDstUsage | mapReadUsage })
    try {
      const encoder = device.createCommandEncoder()
      encoder.resolveQuerySet(queries, 0, count, resolve, 0)
      encoder.copyBufferToBuffer(resolve, 0, read, 0, size)
      device.queue.submit([encoder.finish()])
      await until(read.mapAsync(mapReadMode), deadline)
      const values = new BigUint64Array(read.getMappedRange())
      return passes.map(pass => {
        if (pass.partial || !pass.gpuQueries.length) {
          return unavailable(pass.name, pass.partial ?? 'No hardware query was written for this pass.')
        }
        let total = 0n
        for (const index of pass.gpuQueries) {
          if (values[index + 1] < values[index]) return unavailable(pass.name, 'Hardware timestamps were invalid.')
          total += values[index + 1] - values[index]
        }
        if (total === 0n) return unavailable(pass.name, 'The pass was below the WebGPU timestamp resolution.')
        return { name: pass.name, ms: Number(total) / 1e6, method: 'WebGPU pass timestamps',
          note: canvasScope(pass) }
      })
    } finally {
      read.destroy()
      resolve.destroy()
    }
  }

  private async glTimestamps(gl: WebGL2RenderingContext, ext: TimerExtension,
    passes: CapturedPass[], deadline: number): Promise<PassResult[]> {
    gl.flush()
    const queries = passes.flatMap(pass => pass.glQueries)
    while (performance.now() < deadline) {
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        return passes.map(pass => unavailable(pass.name, 'The WebGL timer became disjoint.'))
      }
      if (queries.every(query => gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))) {
        return passes.map(pass => {
          if (pass.partial || !pass.glQueries.length) {
            return unavailable(pass.name, pass.partial ?? 'No WebGL query was issued for this pass.')
          }
          const ns = pass.glQueries.reduce<number>((sum, query) => sum + Number(gl.getQueryParameter(query, gl.QUERY_RESULT)), 0)
          if (!Number.isFinite(ns) || ns <= 0) return unavailable(pass.name, 'The pass was below the WebGL timestamp resolution or returned an invalid query.')
          return { name: pass.name, ms: ns / 1e6, method: 'WebGL elapsed query',
            note: canvasScope(pass) }
        })
      }
      await new Promise<void>(resolve => setTimeout(resolve, 4))
    }
    throw new TimeLimit('GPU timestamp results missed the deadline.')
  }

  private replayLimit(pass: CapturedPass): string | undefined {
    const ctx = pass.snapshot
    const source = ctx.renderTarget
    if (pass.partial) return pass.partial
    if (!pass.draws.length) return 'No independently repeatable draw was captured.'
    if (ctx.activeCubeFace || ctx.activeMipmapLevel || ctx.occlusionQueryCount
      || (ctx.camera as Camera & { isArrayCamera?: boolean }).isArrayCamera
      || (source && (source.depth !== 1 || source.multiview || (source as RenderTarget & { isXRRenderTarget?: boolean }).isXRRenderTarget))) {
      return 'Layered targets, occlusion queries and XR are outside the replay.'
    }
    if (!ctx.clearColor || (ctx.depth && !ctx.clearDepth) || (ctx.stencil && !ctx.clearStencil)) {
      return 'The pass loads an attachment from earlier work.'
    }
    if (ctx.textures?.length === 0 || (source && source.samples > 0 && source.resolveColorBuffer === false)) {
      return 'The pass has no resolved color attachment for the one-pixel readback.'
    }
    if (pass.canvasDepthBits !== undefined && pass.canvasDepthBits !== 24) {
      return `The WebGL canvas uses ${pass.canvasDepthBits}-bit depth. A matching offscreen depth attachment could not be verified.`
    }
    return undefined
  }

  private async replay(b: Backend, pass: CapturedPass, end: number): Promise<PassResult> {
    const source = pass.snapshot.renderTarget
    if (performance.now() >= end) return unavailable(pass.name, 'The tier deadline left no time for replay.')
    const device = b.device
    let targetToDispose: RenderTarget | undefined, errorScopeOpen = false
    let reader: () => Promise<void> | void, disposeReader = () => {}
    const samples: number[] = []
    try {
      if (device) {
        device.pushErrorScope('validation')
        errorScopeOpen = true
      }
      const target = targetToDispose = this.makeTarget(b, pass)
      this.renderer.initRenderTarget(target)
      if (b.gl) {
        const pixel = this.glPixelReader(b, target)
        reader = pixel.read
        disposeReader = pixel.dispose
      } else {
        reader = async () => { await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1) }
      }

      // Warm the scratch surface and drain pre-existing work outside the regression.
      const warm = this.submitReplay(b, pass, target, 1, end)
      if (warm && device) device.queue.submit(warm)
      await until(Promise.resolve(reader()), end)
      for (const k of repeats) {
        const start = performance.now()
        const last = samples.at(-1), prior = samples.at(-2)
        const projected = last === undefined ? 0
          : prior === undefined ? last * 1.5 : last + 2 * Math.max(0, last - prior)
        if (start + projected >= end) {
          throw new TimeLimit(`The remaining tier budget could not fit K=${k}.`)
        }
        // WebGPU command encoding is outside the slope. WebGL has no such command buffer.
        const commands = this.submitReplay(b, pass, target, k, end)
        const clock = device ? performance.now() : start
        if (commands && device) device.queue.submit(commands)
        await until(Promise.resolve(reader()), end)
        const finish = performance.now()
        if (finish > end) throw new TimeLimit(`Replay passed its tier budget at K=${k}.`)
        samples.push(finish - clock)
      }
      const glError = b.gl?.getError() ?? 0
      if (glError) throw new Error(`WebGL reported error ${glError} during replay.`)
      if (device) {
        errorScopeOpen = false
        const error = await until(device.popErrorScope(), end)
        if (error) throw new Error(error.message)
      }
    } catch (error) {
      const note = error instanceof Error ? error.message : String(error)
      const completed = samples.length ? ` Completed ${samples.length}/4 K samples.` : ''
      return unavailable(pass.name, note + completed)
    } finally {
      if (device && errorScopeOpen) void device.popErrorScope().catch(() => {})
      disposeReader()
      targetToDispose?.dispose()
    }
    const { slope, fit } = fitSlope(samples)
    const details = `K=1/2/4/8 elapsed ${samples.map(ms => ms.toFixed(2)).join('/')} ms. Inputs and bind data come from the captured frame. `
      + (b.gl ? 'Includes draw submission CPU and GPU wait.' : 'Measures WebGPU queue submit through readback.')
      + (!source ? ' Uses matched offscreen attachments without presentation.' : '')
    return {
      name: pass.name, ms: slope > 0 && fit >= 0.85 ? slope : null, fit,
      method: b.gl ? 'WebGL offscreen readback slope' : 'WebGPU offscreen readback slope',
      note: (slope <= 0 || fit < 0.85 ? 'Fit rejected. ' : '') + details,
    }
  }

  private makeTarget(b: Backend, pass: CapturedPass): RenderTarget {
    const ctx = pass.snapshot
    if (ctx.renderTarget) {
      const scratch = ctx.renderTarget.clone()
      // Some real targets share a depth image. Match its format without sharing its contents.
      if (ctx.depthTexture) {
        scratch.depthTexture = ctx.depthTexture.clone()
        scratch.depthTexture.renderTarget = scratch
      }
      if (b.gl) scratch.samples = pass.samples > 1 ? pass.samples : 0
      return scratch
    }
    const canvasDepth = (this.renderer.getCanvasTarget() as unknown as { depthTexture?: DepthTexture }).depthTexture
    const depthTexture = ctx.depth || ctx.stencil
      ? b.device && canvasDepth ? canvasDepth.clone() : new DepthTexture(ctx.width, ctx.height)
      : null
    if (depthTexture && !b.device && ctx.stencil) {
      depthTexture.format = DepthStencilFormat
      depthTexture.type = this.renderer.reversedDepthBuffer ? FloatType : UnsignedInt248Type
    }
    return new RenderTarget(ctx.width, ctx.height, {
      samples: b.device ? this.renderer.currentSamples : pass.samples > 1 ? pass.samples : 0,
      internalFormat: (b.utils?.getPreferredCanvasFormat?.() ?? null) as Texture['internalFormat'],
      depthBuffer: ctx.depth, stencilBuffer: ctx.stencil, depthTexture,
      resolveDepthBuffer: false,
    })
  }

  private submitReplay(b: Backend, pass: CapturedPass, target: RenderTarget, k: number, deadline: number): GPUCommandBuffer[] | undefined {
    const context = pass.context
    const prior = { ...context }
    const restore: (() => void)[] = []
    const queue = b.device?.queue
    const commands: GPUCommandBuffer[] = []
    const track = b.trackTimestamp
    try {
      b.trackTimestamp = false
      if (queue) restoreAfter(restore, queue, 'submit', list => { commands.push(...list) })
      if (b.bufferRenderer) restoreAfter(restore, b.bufferRenderer, 'info', replayInfo)
      Object.assign(context, pass.snapshot, { renderTarget: target, textures: target.textures, depthTexture: target.depthTexture })
      for (let i = 0; i < k; i++) {
        if (performance.now() >= deadline) throw new TimeLimit('Replay encoding reached its deadline.')
        b.beginRender(context)
        try {
          for (const [index, object] of pass.draws.entries()) {
            if (index % 64 === 0 && performance.now() >= deadline) {
              throw new TimeLimit('Replay encoding reached its deadline.')
            }
            b.draw(object, replayInfo)
          }
        } finally {
          b.finishRender(context)
        }
      }
    } finally {
      for (const undo of restore.reverse()) undo()
      Object.assign(context, prior)
      b.trackTimestamp = track
    }
    return queue ? commands : undefined
  }

  private glPixelReader(b: Backend, target: RenderTarget): { read(): void; dispose(): void } {
    const gl = b.gl!, state = b.state!
    const framebuffer = gl.createFramebuffer()
    if (!framebuffer) throw new Error('Could not allocate a one-pixel readback framebuffer.')
    const texture = b.get(target.texture).textureGPU
    let format: number, type: number
    try {
      if (!texture) throw new Error('The scratch color texture was not initialized.')
      state.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('The matched offscreen readback framebuffer is incomplete.')
      }
      format = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) as number
      type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) as number
    } catch (error) {
      gl.deleteFramebuffer(framebuffer)
      throw error
    } finally {
      state.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    }
    const pixel = type === gl.FLOAT ? new Float32Array(4)
      : type === gl.UNSIGNED_BYTE ? new Uint8Array(4)
        : type === gl.HALF_FLOAT || type === gl.UNSIGNED_SHORT ? new Uint16Array(4)
          : type === gl.INT ? new Int32Array(4) : new Uint32Array(4)
    return {
      read() {
        state.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer)
        try { gl.readPixels(0, 0, 1, 1, format, type, pixel) }
        finally { state.bindFramebuffer(gl.READ_FRAMEBUFFER, null) }
      },
      dispose() { gl.deleteFramebuffer(framebuffer) },
    }
  }
}
