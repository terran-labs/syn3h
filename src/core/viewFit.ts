import type { Vector2 } from 'three/webgpu'

/**
 * Keeps the drawing buffer and the camera's aspect on the canvas's real laid-out size.
 *
 * Sizing on the window's resize event alone could stick. On an iPhone turning between
 * portrait and landscape, Safari can fire its last resize while the window still reports a
 * half-turned size (the owner's v26.11.2201 screenshot: the world drawn for a square, aspect
 * 1, stretched 2.17 times over a landscape screen), and no later event follows to correct
 * it. The size is now measured from the canvas itself, by the resize event and by a
 * ResizeObserver that reports the settled layout, and checked again before every drawn
 * frame. Whatever order the events arrive in, the next frame converges on the true size.
 * The post chain's targets and the temporal pass follow the drawing buffer by themselves.
 *
 * Applying a size clears the canvas, so outside the resize event the change is made only
 * just before a frame is drawn: a frame in between shows the old picture, never black.
 */
export const ASPECT_SLACK = 0.01

/** The renderer's part: three's WebGPURenderer. */
export interface SizedRenderer {
  getSize(target: Vector2): Vector2
  setSize(width: number, height: number, updateStyle?: boolean): void
}

/** The camera's part: a PerspectiveCamera. */
export interface AspectCamera {
  aspect: number
  updateProjectionMatrix(): void
}

export class ViewFit {
  /** The canvas's size in CSS pixels, as last measured. Zero until measured. */
  width = 0
  height = 0
  constructor(private readonly renderer: SizedRenderer, private readonly camera: AspectCamera, private readonly scratch: Vector2) {}

  /** Record the canvas's size. A hidden or unlaid-out canvas (zero) is ignored. */
  measure(width: number, height: number): void {
    const w = Math.round(width), h = Math.round(height)
    if (w > 0 && h > 0) { this.width = w; this.height = h }
  }

  /** Whether the renderer or the camera disagrees with the measured size. No allocation. */
  get stale(): boolean {
    const { width, height } = this
    if (!width || !height) return false
    const size = this.renderer.getSize(this.scratch)
    return size.x !== width || size.y !== height || Math.abs(this.camera.aspect * height / width - 1) > ASPECT_SLACK
  }

  /**
   * Bring the renderer and the camera to the measured size. Returns whether anything changed.
   * The aspect is compared with slack: the temporal pass sets it from the whole-pixel buffer,
   * a fraction of a per cent off the CSS ratio, and that must not count as a change.
   */
  fit(): boolean {
    if (!this.stale) return false
    const { width, height } = this, size = this.renderer.getSize(this.scratch)
    if (size.x !== width || size.y !== height) this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    return true
  }
}
