import type { WebGPURenderer } from 'three/webgpu'
import { longFrames } from './longFrames'
import { beginShaderTiming, endShaderTiming, type ShaderSource } from './diagnosticShaders'

// Three's public renderer types omit these backend and builder methods.
type Builder = ShaderSource & { build?: () => unknown }
type BufferSource = {
  array?: { byteLength: number; BYTES_PER_ELEMENT: number }
  updateRanges?: readonly { count: number }[]
}
type Attribute = BufferSource & {
  isInterleavedBufferAttribute?: boolean
  data?: BufferSource
}
type AttributeUtils = {
  createAttribute?: (attribute: Attribute, usage: number) => unknown
  updateAttribute?: (attribute: Attribute) => unknown
}
type Texture = {
  isRenderTargetTexture?: boolean
  layerUpdates?: { size: number }
}
type TextureOptions = {
  width?: number
  height?: number
  depth?: number
  image?: { data?: { byteLength: number } }
}
type Backend = {
  createNodeBuilder?: (object: unknown, renderer: WebGPURenderer) => Builder | undefined
  createRenderPipeline?: (object: ShaderSource, promises?: unknown) => unknown
  createComputePipeline?: (pipeline: unknown, bindings: unknown, promises?: unknown) => unknown
  updateTexture?: (texture: Texture, options?: TextureOptions) => unknown
  attributeUtils?: AttributeUtils
  has?: (key: object) => boolean
  get?: (key: object) => { buffer?: unknown; bufferGPU?: unknown }
}

const installed = new WeakSet<Backend>()
const bufferThreshold = 64 * 1024
const textureThreshold = 128 * 128

function bufferSource(attribute: Attribute): BufferSource {
  return attribute.isInterleavedBufferAttribute && attribute.data ? attribute.data : attribute
}

function hasLargeUpdate(source: BufferSource): boolean {
  const array = source.array
  if (!array || array.byteLength < bufferThreshold) return false
  const ranges = source.updateRanges
  if (!ranges?.length) return true

  // Ranges are in source elements. Backend padding and alignment can add bytes.
  let elements = 0
  for (let i = 0; i < ranges.length; i++) {
    elements += ranges[i].count
    if (elements * array.BYTES_PER_ELEMENT >= bufferThreshold) return true
  }
  return false
}

function instrumentBuffers(backend: Backend): void {
  const utils = backend.attributeUtils
  if (!utils) return

  const create = utils.createAttribute
  if (typeof create === 'function') {
    utils.createAttribute = function (this: AttributeUtils, attribute, usage) {
      const source = bufferSource(attribute)
      if ((source.array?.byteLength ?? 0) < bufferThreshold) return create.call(this, attribute, usage)

      // Several vertex attributes can share one GPU buffer. Match Three's reuse check
      // without creating a backend data record just to inspect it.
      const existing = backend.has?.(source) ? backend.get?.(source) : undefined
      if (existing?.buffer !== undefined || existing?.bufferGPU !== undefined) {
        return create.call(this, attribute, usage)
      }

      const start = longFrames.start()
      try { return create.call(this, attribute, usage) }
      finally { longFrames.end('renderer.bufferUploadCpu', start) }
    }
  }

  const update = utils.updateAttribute
  if (typeof update === 'function') {
    utils.updateAttribute = function (this: AttributeUtils, attribute) {
      if (!hasLargeUpdate(bufferSource(attribute))) return update.call(this, attribute)
      const start = longFrames.start()
      try { return update.call(this, attribute) }
      finally { longFrames.end('renderer.bufferUploadCpu', start) }
    }
  }
}

/**
 * Install after renderer initialization, when Three has selected WebGPU or WebGL2.
 * Times the calling thread, including synchronous driver stalls. GPU execution and
 * asynchronous compiler completion are outside these intervals.
 */
export function installLongFrameRenderer(renderer: WebGPURenderer): void {
  const backend = renderer.backend as unknown as Backend | null | undefined
  if (!backend || installed.has(backend)) return
  installed.add(backend)

  const createBuilder = backend.createNodeBuilder
  if (typeof createBuilder === 'function') {
    backend.createNodeBuilder = function (this: Backend, object, owner) {
      const builder = createBuilder.call(this, object, owner)
      const build = builder?.build
      if (builder && typeof build === 'function') {
        builder.build = function (this: Builder) {
          const phase = beginShaderTiming()
          const start = longFrames.start()
          try { return build.call(this) }
          finally {
            const end = performance.now()
            longFrames.end('renderer.nodeBuildCpu', start)
            endShaderTiming('Node build', phase, start, end, this)
          }
        }
      }
      return builder
    }
  }

  const renderPipeline = backend.createRenderPipeline
  if (typeof renderPipeline === 'function') {
    backend.createRenderPipeline = function (this: Backend, object, promises) {
      const phase = beginShaderTiming()
      const start = longFrames.start()
      try { return renderPipeline.call(this, object, promises) }
      finally {
        const end = performance.now()
        longFrames.end('renderer.renderPipelineCpu', start)
        endShaderTiming('Render pipeline', phase, start, end, object)
      }
    }
  }

  const computePipeline = backend.createComputePipeline
  if (typeof computePipeline === 'function') {
    backend.createComputePipeline = function (this: Backend, pipeline, bindings, promises) {
      const phase = beginShaderTiming()
      const start = longFrames.start()
      try { return computePipeline.call(this, pipeline, bindings, promises) }
      finally {
        const end = performance.now()
        longFrames.end('renderer.computePipelineCpu', start)
        endShaderTiming('Compute pipeline', phase, start, end)
      }
    }
  }

  const updateTexture = backend.updateTexture
  if (typeof updateTexture === 'function') {
    backend.updateTexture = function (this: Backend, texture, options) {
      // Sized by known source bytes or texels. Formats and mip chains vary, and
      // Three's texture options may describe just the base level.
      const updatedLayers = texture.layerUpdates?.size
      const layers = updatedLayers || options?.depth || 1
      const texels = (options?.width ?? 0) * (options?.height ?? 0) * layers
      const sourceBytes = updatedLayers ? 0 : options?.image?.data?.byteLength ?? 0
      if (texture.isRenderTargetTexture || (texels < textureThreshold && sourceBytes < bufferThreshold)) {
        return updateTexture.call(this, texture, options)
      }

      const start = longFrames.start()
      try { return updateTexture.call(this, texture, options) }
      finally { longFrames.end('renderer.textureUploadCpu', start) }
    }
  }

  instrumentBuffers(backend)
}
