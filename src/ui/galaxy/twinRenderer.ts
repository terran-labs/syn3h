import type { LabelPlace, ScreenDisc } from './labels'
import type { TwinPlace } from './twinProjection'

const VERTEX = `#version 300 es
layout(location = 0) in vec4 aDisc;
layout(location = 1) in float aRimX;
uniform vec2 uSize;
out vec2 vPixel;
flat out vec4 vDisc;
flat out float vRimX;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  float pad = aDisc.z + 2.0;
  vec2 lo = vec2(min(aDisc.x - pad, aRimX), aDisc.y - pad);
  vec2 hi = vec2(max(aDisc.x + pad, aRimX), aDisc.y + pad);
  vPixel = mix(lo, hi, corner);
  vDisc = aDisc;
  vRimX = aRimX;
  vec2 clip = vPixel / uSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vPixel;
flat in vec4 vDisc;
flat in float vRimX;
uniform vec4 uForeground[13];
uniform int uCount;
out vec4 colour;
void main() {
  for (int i = 0; i < uCount; i++) {
    vec4 body = uForeground[i];
    if (body.w < vDisc.w && distance(vPixel, body.xy) < body.z) discard;
  }
  vec2 at = vPixel - vDisc.xy;
  float radius = vDisc.z;
  float bandEnd = vDisc.x + sign(vRimX - vDisc.x) * radius;
  float inBand = step(min(vRimX, bandEnd), vPixel.x) * step(vPixel.x, max(vRimX, bandEnd));
  float band = inBand * (1.0 - smoothstep(0.25, 1.6, abs(at.y)));
  vec2 radial = at / max(0.001, length(at));
  float arc = 0.90 * (radial.x * radial.x - radial.y * radial.y) - 0.87 * radial.x * radial.y;
  float broken = smoothstep(0.02, 0.24, abs(arc));
  float rim = broken * (1.0 - smoothstep(0.35, 1.5, abs(length(at) - radius)));
  colour = vec4(0.69, 0.84, 1.0, max(rim * 0.76, band * 0.38));
}`

/** A texture-free batch with one screen-space quad per twin. */
export class TwinRenderer {
  private readonly program: WebGLProgram
  private readonly vao: WebGLVertexArrayObject
  private readonly buffer: WebGLBuffer
  private readonly size: WebGLUniformLocation | null
  private readonly foreground: WebGLUniformLocation | null
  private readonly count: WebGLUniformLocation | null

  static create(gl: WebGL2RenderingContext): TwinRenderer | undefined {
    const program = gl.createProgram()
    if (!program) return
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
      const shader = gl.createShader(type)
      if (!shader) { gl.deleteProgram(program); return }
      gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(program, shader); gl.deleteShader(shader)
    }
    gl.linkProgram(program)
    const vao = gl.createVertexArray(), buffer = gl.createBuffer()
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) || !vao || !buffer) {
      console.warn('Galaxy twin shader unavailable.', gl.getProgramInfoLog(program))
      gl.deleteVertexArray(vao); gl.deleteBuffer(buffer); gl.deleteProgram(program)
      return
    }
    return new TwinRenderer(gl, program, vao, buffer)
  }

  private constructor(private readonly gl: WebGL2RenderingContext, program: WebGLProgram, vao: WebGLVertexArrayObject, buffer: WebGLBuffer) {
    this.program = program; this.vao = vao; this.buffer = buffer
    this.size = gl.getUniformLocation(program, 'uSize')
    this.foreground = gl.getUniformLocation(program, 'uForeground')
    this.count = gl.getUniformLocation(program, 'uCount')
    const prior = gl.getParameter(gl.VERTEX_ARRAY_BINDING)
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0); gl.vertexAttribDivisor(0, 1)
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16); gl.vertexAttribDivisor(1, 1)
    gl.bindVertexArray(prior); gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  draw(twins: readonly TwinPlace[], places: readonly LabelPlace[], sun: ScreenDisc, width: number, height: number): void {
    const shown = twins.filter(twin => twin.visible).sort((a, b) => b.depth - a.depth)
    if (!shown.length) return
    const gl = this.gl
    const occluders = [...places.filter(place => place.visible), sun]
    const prior = gl.getParameter(gl.VERTEX_ARRAY_BINDING)
    gl.useProgram(this.program); gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(shown.flatMap(twin => [twin.x, twin.y, twin.radius, twin.depth, twin.rimX])), gl.DYNAMIC_DRAW)
    gl.uniform2f(this.size, width, height)
    gl.uniform4fv(this.foreground, occluders.flatMap(disc => [disc.x, disc.y, disc.radius, disc.depth ?? 1e6]))
    gl.uniform1i(this.count, occluders.length)
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, shown.length)
    gl.disable(gl.BLEND); gl.bindVertexArray(prior); gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  dispose(): void {
    this.gl.deleteProgram(this.program); this.gl.deleteVertexArray(this.vao); this.gl.deleteBuffer(this.buffer)
  }
}
