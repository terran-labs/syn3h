import faceSource from './lobby.frag.glsl?raw'
import { glassBlurTaps } from './gaussianKernel'
import { GlassMotionClock } from './paintedSurface'
import type { GalaxyGlass } from '../ui/galaxy/glassAdapter'

const vertexSource = `#version 300 es
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0, 1);
}`
const blurSource = `#version 300 es
precision highp float;
uniform sampler2D source;
uniform vec2 targetSize, axis;
out vec4 color;
void main() {
  vec2 uv = gl_FragCoord.xy / targetSize;
  vec3 sum = vec3(0);
  ${glassBlurTaps.map(t => `sum += texture(source, uv + axis * ${t.offset.toFixed(8)}).rgb * ${t.weight.toFixed(10)};`).join('\n')}
  color = vec4(sum, 1);
}`
const surfaces = '.galaxy-ui > .lobby-gear-dock > .liquid-glass, #lobby-settings'
type Shape = { el: HTMLElement; x: number; y: number; w: number; h: number; radius: number; alpha: number; panel: boolean; pressed: boolean }

/** Render after the galaxy and logo. The scene is already display-encoded.
 * Texture units 6 and 7 belong to this pass. The galaxy uses 0 through 3. */
export function createLobbyGlass(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement, nativeInk: () => boolean, tuning: {
  face: { x: number; y: number; z: number; w: number }; panel: { x: number; y: number }; edges: { x: number; y: number; z: number }
  width(): number; growth(): number; dark(): boolean; revision(): number
}): GalaxyGlass {
  const dispose: (() => void)[] = []
  const program = (source: string) => {
    const p = gl.createProgram()!
    dispose.push(() => gl.deleteProgram(p))
    for (const [type, text] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, source]] as const) {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, text)
      gl.compileShader(shader)
      gl.attachShader(p, shader)
      gl.deleteShader(shader)
    }
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const messages = (gl.getAttachedShaders(p) ?? []).map(shader => gl.getShaderInfoLog(shader))
      throw Error([gl.getProgramInfoLog(p), ...messages].filter(Boolean).join('\n') || 'Lobby glass link failed')
    }
    return p
  }
  function uniforms<T extends string>(p: WebGLProgram, keys: T[]) {
    return Object.fromEntries(keys.map(k => [k, gl.getUniformLocation(p, k)])) as Record<T, WebGLUniformLocation | null>
  }
  const texture = () => {
    const t = gl.createTexture()!
    dispose.push(() => gl.deleteTexture(t))
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }
  const target = () => {
    const tex = texture(), fb = gl.createFramebuffer()!
    dispose.push(() => gl.deleteFramebuffer(fb))
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { tex, fb }
  }
  let blur: WebGLProgram, face: WebGLProgram
  try { blur = program(blurSource); face = program(faceSource) }
  catch (error) { for (const free of dispose) free(); throw error }
  const u = uniforms(face, ['scene','frost','pixels','points','box','radius','dark','panel','opacity','pressed','veil','faceTransfer','panelTransfer','edgeStrength'])
  const b = uniforms(blur, ['source','targetSize','axis'])
  const scene = texture(), horizontal = target(), vertical = target()
  const scope = canvas.closest('.syn3h-shell') ?? document.body
  const captions = scope.querySelector<HTMLElement>('.galaxy-ui')
  const clock = new GlassMotionClock()
  const events = new AbortController()
  const opts = { signal: events.signal, capture: true }
  const phone = matchMedia('(max-width: 700px), (max-height: 500px) and (pointer: coarse)')
  let revision = -1, growth = 0
  const reduced = matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)')
  let changed = true, registered: HTMLElement[] = [], shapes: Shape[] = []
  let width = 0, height = 0, pw = 1, ph = 1, tw = 1, th = 1, active = false
  const dirty = () => { changed = true }
  const size = new ResizeObserver(dirty)
  const attributes = new MutationObserver(records => {
    if (records.some(r => r.oldValue !== (r.target as Element).getAttribute(r.attributeName!))) dirty()
  })
  const membership = new MutationObserver(dirty)
  membership.observe(scope, { childList: true })
  const galaxyUI = scope.querySelector('.galaxy-ui')
  if (galaxyUI) membership.observe(galaxyUI, { childList: true })
  const resize = () => {
    width = canvas.width; height = canvas.height
    pw = Math.max(1, canvas.clientWidth); ph = Math.max(1, canvas.clientHeight)
    tw = Math.max(1, Math.ceil(pw/4)); th = Math.max(1, Math.ceil(ph/4))
    for (const [tex, w, h] of [[scene,width,height],[horizontal.tex,tw,th],[vertical.tex,tw,th]] as const) {
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, tex)
      // The galaxy requests an opaque default framebuffer. WebGL rejects a
      // subimage copy that would have to manufacture an alpha channel.
      const format = tex === scene ? gl.RGB : gl.RGBA
      gl.texImage2D(gl.TEXTURE_2D, 0, tex === scene ? gl.RGB8 : gl.RGBA8, w, h, 0, format, gl.UNSIGNED_BYTE, null)
    }
    changed = true
  }
  const clear = (el: HTMLElement) => {
    delete el.dataset.glassSurface
    el.removeAttribute('data-glass-native-ink')
  }
  const layout = (now: number) => {
    const next = [...scope.querySelectorAll<HTMLElement>(surfaces)]
    if (next.length !== registered.length || next.some((el,i) => el !== registered[i])) {
      for (const old of registered) if (!next.includes(old)) clear(old)
      size.disconnect(); size.observe(canvas); attributes.disconnect()
      const ancestors = new Set<Element>()
      for (const el of next) {
        size.observe(el)
        for (let p: Element | null = el; p; p = p.parentElement) ancestors.add(p)
      }
      for (const el of ancestors) attributes.observe(el, { attributes:true, attributeOldValue:true,
        attributeFilter:['class','style','hidden','aria-expanded','data-gfx','data-ui-frost'] })
      registered = next
    }
    const rect = canvas.getBoundingClientRect()
    pw = Math.max(1,rect.width); ph = Math.max(1,rect.height)
    shapes = []
    for (const el of registered) {
      if (!el.checkVisibility({visibilityProperty:true})) { clear(el); continue }
      let alpha = 1
      for (let p: Element | null=el; p; p=p.parentElement) {
        clock.follow(p,now); alpha *= Number(getComputedStyle(p).opacity)
      }
      const box = el.getBoundingClientRect(), style = getComputedStyle(el)
      if (!box.width || !box.height || box.right <= rect.left || box.left >= rect.right || box.bottom <= rect.top || box.top >= rect.bottom) { clear(el); continue }
      const half = Math.min(box.width,box.height)/2
      const r = style.borderTopLeftRadius
      shapes.push({el,x:box.x-rect.x+box.width/2,y:box.y-rect.y+box.height/2,w:box.width/2,h:box.height/2,
        radius:Math.min(half,r.endsWith('%') ? half*parseFloat(r)/50 : parseFloat(r)*box.width/(el.offsetWidth || box.width)),
        panel:el.id==='lobby-settings',alpha,pressed:el.matches(':active')})
    }
    // Captions and dock labels are DOM siblings of the galaxy. Cut the panel's
    // rounded outline out of that layer so it cannot write across the glass.
    const card = shapes.find(s => s.panel)
    if (captions && card) {
      const box = captions.getBoundingClientRect()
      const l = card.x - card.w + rect.left - box.left, t = card.y - card.h + rect.top - box.top
      const r = l + card.w * 2, b = t + card.h * 2, k = card.radius
      const corner = `a ${k} ${k} 0 0 1`
      captions.style.clipPath = `path(evenodd, "M0 0H${box.width}V${box.height}H0Z M${l+k} ${t}H${r-k}${corner} ${k} ${k}V${b-k}${corner} ${-k} ${k}H${l+k}${corner} ${-k} ${-k}V${t+k}${corner} ${k} ${-k}Z")`
    } else captions?.style.removeProperty('clip-path')
    changed = false
  }
  for (const type of ['scroll','resize','orientationchange']) window.addEventListener(type,dirty,opts)
  for (const type of ['pointerdown','pointerup','pointercancel','transitionrun','animationstart']) {
    scope.addEventListener(type,event=>{
      if (event.target instanceof Element && (event.target.closest(surfaces) || registered.some(el=>event.target instanceof Element && event.target.contains(el)))) dirty()
    },opts)
  }
  reduced.addEventListener('change',dirty,opts)
  // Prime the actual programs behind the same cover as the galaxy shader.
  // Use the allocated blur framebuffer while warming, preserving the screen.
  resize()
  gl.useProgram(blur); gl.uniform1i(b.source,6); gl.uniform2f(b.targetSize,tw,th)
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D,scene)
  gl.bindFramebuffer(gl.FRAMEBUFFER,horizontal.fb); gl.viewport(0,0,1,1); gl.drawArrays(gl.TRIANGLES,0,3)
  gl.useProgram(face); gl.uniform1i(u.scene,6); gl.uniform1i(u.frost,7)
  gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D,vertical.tex)
  gl.uniform2f(u.pixels,width,height); gl.uniform2f(u.points,pw,ph); gl.drawArrays(gl.TRIANGLES,0,3)
  gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,width,height)
  return {
    get available() { return !reduced.matches && document.documentElement.dataset.gfx !== '0' },
    get dirty() { return changed || clock.active || (active && shapes.length > 0 && revision !== tuning.revision()) },
    draw(enabled) {
      if (!enabled) {
        if (active) { captions?.style.removeProperty('clip-path'); scope.removeAttribute('data-lobby-glass'); clock.release(); for (const el of registered) clear(el) }
        active = false; changed = false
        return
      }
      if (canvas.width !== width || canvas.height !== height) resize()
      if (!active) scope.setAttribute('data-lobby-glass','')
      const now = performance.now()
      if (clock.advance(now) || changed || !active || growth !== tuning.growth()) layout(now)
      growth = tuning.growth()
      active = true
      if (!shapes.length) return
      const sx = width/pw, sy = height/ph
      if (phone.matches && shapes.some(s => s.panel)) {
        gl.useProgram(face); gl.uniform1f(u.veil,.78)
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA)
        gl.drawArrays(gl.TRIANGLES,0,3)
        gl.disable(gl.BLEND); gl.uniform1f(u.veil,0)
      }
      // Copy only the visible shapes plus their three-sigma sampling support.
      const pad = Math.max(64, 4 + 48 * tuning.width())
      const x0 = Math.max(0,Math.floor(Math.min(...shapes.map(s=>s.x-s.w-pad))*sx))
      const x1 = Math.min(width,Math.ceil(Math.max(...shapes.map(s=>s.x+s.w+pad))*sx))
      const y0 = Math.max(0,Math.floor(height-Math.max(...shapes.map(s=>s.y+s.h+pad))*sy))
      const y1 = Math.min(height,Math.ceil(height-Math.min(...shapes.map(s=>s.y-s.h-pad))*sy))
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D,scene)
      gl.copyTexSubImage2D(gl.TEXTURE_2D,0,x0,y0,x0,y0,x1-x0,y1-y0)
      gl.useProgram(blur); gl.uniform2f(b.targetSize,tw,th)
      gl.viewport(0,0,tw,th); gl.bindFramebuffer(gl.FRAMEBUFFER,horizontal.fb)
      gl.uniform2f(b.axis,tuning.width()/pw,0); gl.drawArrays(gl.TRIANGLES,0,3)
      gl.bindTexture(gl.TEXTURE_2D,horizontal.tex); gl.bindFramebuffer(gl.FRAMEBUFFER,vertical.fb)
      gl.uniform2f(b.axis,0,tuning.width()/ph); gl.drawArrays(gl.TRIANGLES,0,3)
      gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,width,height)
      gl.useProgram(face); gl.bindTexture(gl.TEXTURE_2D,scene)
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D,vertical.tex)
      gl.uniform2f(u.pixels,width,height); gl.uniform2f(u.points,pw,ph); gl.uniform1f(u.dark,Number(tuning.dark()))
      if (revision !== tuning.revision()) {
        revision = tuning.revision()
        const { face, panel, edges } = tuning
        gl.uniform4f(u.faceTransfer,face.x,face.y,face.z,face.w)
        gl.uniform2f(u.panelTransfer,panel.x,panel.y)
        gl.uniform3f(u.edgeStrength,edges.x,edges.y,edges.z)
      }
      gl.enable(gl.SCISSOR_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA)
      for (const s of shapes) {
        const x=Math.floor((s.x-s.w-14)*sx), y=Math.floor(height-(s.y+s.h+14)*sy)
        gl.scissor(x,y,Math.ceil((s.w*2+28)*sx)+1,Math.ceil((s.h*2+28)*sy)+1)
        gl.uniform4f(u.box,s.x,s.y,s.w,s.h); gl.uniform1f(u.radius,s.radius)
        gl.uniform1f(u.panel,Number(s.panel)); gl.uniform1f(u.opacity,s.alpha); gl.uniform1f(u.pressed,Number(s.pressed))
        gl.drawArrays(gl.TRIANGLES,0,3)
        if (s.el.dataset.glassSurface!=='shader') s.el.dataset.glassSurface='shader'
        if (s.panel) s.el.toggleAttribute('data-glass-native-ink',nativeInk())
      }
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND)
    },
    dispose() {
      captions?.style.removeProperty('clip-path')
      scope.removeAttribute('data-lobby-glass')
      clock.release(); size.disconnect(); membership.disconnect(); attributes.disconnect(); events.abort()
      for (const el of registered) clear(el)
      for (const free of dispose) free()
    }
  }
}
