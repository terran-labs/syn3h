/**
 * The in-space wordmark's letters at the screen's full resolution. The lobby galaxy renders
 * at most 1.5 times CSS pixels; this is a second, transparent canvas over it that runs the
 * galaxy's own fragment shader compiled with MARK_ONLY, which keeps the camera, the worlds
 * that hide the letters, and the shafts that light them, and writes only the letters, with
 * their coverage as alpha. It draws only inside the letters' box on screen (a scissor), and
 * only on frames the galaxy draws, so an idle lobby stays idle. The galaxy keeps the halo.
 */
import { WordmarkField } from './wordmarkField'
import { FIELD_UNIT } from './logoRenderer'

export interface CssBox { x: number; y: number; width: number; height: number }

export class WordmarkCrisp {
  readonly canvas: HTMLCanvasElement
  readonly ok: boolean
  private readonly gl: WebGL2RenderingContext | null
  private program: WebGLProgram | null = null
  private field: WordmarkField | null = null
  private readonly locations: Record<string, WebGLUniformLocation | null> = {}
  private shown = false

  constructor(vertex: string, fragment: string, names: readonly string[]) {
    const canvas = this.canvas = document.createElement('canvas')
    canvas.className = 'wordmark-crisp'; canvas.setAttribute('aria-hidden', 'true')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;visibility:hidden'
    const gl = this.gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false })
    if (!gl) { this.ok = false; return }
    const compile = (v: string, f: string) => {
      const program = gl.createProgram()!
      for (const [type, source] of [[gl.VERTEX_SHADER, v], [gl.FRAGMENT_SHADER, f]] as const) { const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(program, shader); gl.deleteShader(shader) }
      gl.linkProgram(program)
      if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program
      console.warn('Syn3h wordmark pass failed; the galaxy draws the letters.', gl.getProgramInfoLog(program)); gl.deleteProgram(program); return null
    }
    this.program = compile(vertex, fragment.replace('#version 300 es\n', '#version 300 es\n#define MARK_ONLY\n'))
    this.field = new WordmarkField(gl, compile, FIELD_UNIT)
    if (!this.program || !this.field.ok) { this.ok = false; return }
    gl.useProgram(this.program)
    for (const name of names) this.locations[name] = gl.getUniformLocation(this.program, name)
    // Samplers the pass never reads, kept off the field's unit and off each other's.
    gl.uniform1i(this.locations.uMaps, 0); gl.uniform1i(this.locations.uClose, 1)
    gl.bindVertexArray(gl.createVertexArray())
    this.ok = true
  }

  /**
   * Draws the letters inside `box` (CSS pixels of the host), or clears and hides when it is
   * null. `set` sets the galaxy's frame uniforms on this context for a target of the given
   * size; `pixelsPerUnit` is how large the letters are on screen, for the field's bake.
   */
  draw(box: CssBox | null, hostWidth: number, hostHeight: number, ratio: number, pixelsPerUnit: number, set: (gl: WebGL2RenderingContext, u: Record<string, WebGLUniformLocation | null>, width: number, height: number, bind: () => void) => void): void {
    const gl = this.gl
    if (!this.ok || !gl || gl.isContextLost()) return
    if (!box) { if (this.shown) { this.canvas.style.visibility = 'hidden'; this.shown = false } return }
    const width = Math.max(1, Math.round(hostWidth * ratio)), height = Math.max(1, Math.round(hostHeight * ratio))
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height }
    this.field!.ensure(pixelsPerUnit * ratio, null)
    gl.viewport(0, 0, width, height)
    gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    // Only the letters' box, and a few pixels round it, runs the shader.
    const x0 = Math.max(0, Math.floor((box.x - 4) * ratio)), x1 = Math.min(width, Math.ceil((box.x + box.width + 4) * ratio))
    const y0 = Math.max(0, Math.floor(height - (box.y + box.height + 4) * ratio)), y1 = Math.min(height, Math.ceil(height - (box.y - 4) * ratio))
    if (x1 > x0 && y1 > y0) {
      gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, y0, x1 - x0, y1 - y0)
      gl.useProgram(this.program)
      set(gl, this.locations, width, height, () => { this.field!.bind(name => this.locations[name] ?? null); gl.useProgram(this.program) })
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    if (!this.shown) { this.canvas.style.visibility = 'visible'; this.shown = true }
  }

  /** The last bake of this pass's own field, in milliseconds. */
  get bakeMs(): number { return this.field?.lastBakeMs ?? 0 }

  dispose(): void {
    this.field?.dispose(); if (this.program) this.gl?.deleteProgram(this.program)
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext()
    this.canvas.remove()
  }
}
