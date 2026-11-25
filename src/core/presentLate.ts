/**
 * ?presentLate=1 (flashSwitches.ts): take the canvas's texture only at the end of the frame.
 *
 * Three.js takes the canvas texture first in a frame and opens its render pass on it, then
 * submits the sun shadow cascades and the scene, each on its own, and submits the canvas pass
 * last: the browser's surface is held across the whole frame (traced in Chrome, 24 November
 * 2026). This switch hands three a texture of our own in its place, and at the end of the task
 * that drew the frame takes the real canvas texture and fills it with one copy, in a submit of
 * its own. The surface is then held for one copy only. It tests whether the empty frames on
 * iPhone Safari depend on how long the surface is held (WebKit 323834@main and 326465@main
 * changed how a surface still in use is handled). One extra full-screen copy per frame.
 *
 * Installed on the canvas before three makes its renderer, and only for WebGPU.
 */
/** GPUTextureUsage bits (the constants are not in this project's type library). */
const T = { COPY_SRC: 0x01, COPY_DST: 0x02, TEXTURE_BINDING: 0x04, RENDER_ATTACHMENT: 0x10 }

export function installPresentLate(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null
  if (!context) return false
  const configure = context.configure.bind(context)
  const canvasTexture = context.getCurrentTexture.bind(context)
  let device: GPUDevice | null = null, format: GPUTextureFormat = 'bgra8unorm'
  let own: GPUTexture | null = null, pending = false
  context.configure = config => {
    device = config.device; format = config.format
    own?.destroy(); own = null
    configure({ ...config, usage: (config.usage ?? T.RENDER_ATTACHMENT) | T.COPY_DST })
  }
  // The frame is drawn in one task (three's render is synchronous): the copy follows its last submit.
  const present = () => {
    pending = false
    if (!device || !own) return
    const target = canvasTexture()
    if (target.width !== own.width || target.height !== own.height) return
    const encoder = device.createCommandEncoder({ label: 'presentLate copy' })
    encoder.copyTextureToTexture({ texture: own }, { texture: target }, [own.width, own.height])
    device.queue.submit([encoder.finish()])
  }
  context.getCurrentTexture = () => {
    if (!device) return canvasTexture()
    if (!own || own.width !== canvas.width || own.height !== canvas.height) {
      own?.destroy()
      own = device.createTexture({ label: 'presentLate frame', size: [canvas.width, canvas.height], format, usage: T.RENDER_ATTACHMENT | T.COPY_SRC | T.TEXTURE_BINDING })
    }
    if (!pending) { pending = true; queueMicrotask(present) }
    return own
  }
  return true
}
