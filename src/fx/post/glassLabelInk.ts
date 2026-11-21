import { DataUtils, type RenderTarget, type WebGPURenderer } from 'three/webgpu'
import type { GlassButton } from './GlassButton'

const linear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4

/** Use a texel from the finished frost behind each label. A single pending
 * asynchronous pixel copy bounds the work even on a crowded desktop. */
export class GlassLabelInk {
  private next = 0
  private index = 0
  private pending = false

  update(renderer: WebGPURenderer, controls: GlassButton, target: RenderTarget) {
    if (this.pending || performance.now() < this.next) return
    const label = controls.nextLabel(this.index)
    if (!label) return
    this.index = label.index + 1
    this.next = performance.now() + 65
    const px = (v: number, size: number) => Math.max(0, Math.min(size - 1, Math.floor(v * size)))
    const gl = 'isWebGLBackend' in renderer.backend
    const x = px(label.u, target.width), y = px(gl ? 1 - label.v : label.v, target.height)
    this.pending = true
    void renderer.readRenderTargetPixelsAsync(target, x, y, 1, 1).then(pixel => {
      if (label.element.dataset.glassSurface !== 'shader') return
      const channel = (i: number) => pixel instanceof Uint16Array ? DataUtils.fromHalfFloat(pixel[i]) : pixel[i]
      const rgb = [channel(0), channel(1), channel(2)]
      if (rgb.some(c => !Number.isFinite(c))) return
      const luma = (c: number[]) => .2126 * c[0] + .7152 * c[1] + .0722 * c[2]
      const l = luma(rgb)
      const tone = label.dark ? -.39 * l * l + .99 * l + 32 / 255 : -.034 * l * l + .506 * l + 133 / 255
      const face = rgb.map(c => {
        const value = label.clear ? c : tone + c - l
        return linear(Math.min(1, Math.max(0, value + (1 - value) * .405 * label.lift)))
      })
      // Black and white give equal WCAG contrast at this luminance.
      const ink = luma(face) >= Math.sqrt(.0525) - .05 ? 'black' : 'white'
      if (label.element.dataset.glassLabel !== ink) label.element.dataset.glassLabel = ink
    }).catch(() => { this.next = performance.now() + 1000 }).finally(() => { this.pending = false })
  }
}
