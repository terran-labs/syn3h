import '../../src/ui/glass.css'
import { CanvasTexture, NoColorSpace, RenderPipeline, Vector4, WebGPURenderer } from 'three/webgpu'
import { float, texture, uniform, uniformArray, uv, vec4 } from 'three/tsl'
import { composeGlass } from '../../src/liquid-glass/compose'
import { createGlassGaussian } from '../../src/liquid-glass/gaussian'
import { mergeReferencePair } from './merge'

const q = new URLSearchParams(location.search)
const canvas = document.querySelector('canvas')!
const renderer = new WebGPURenderer({canvas, forceWebGL: q.has('webgl')})
await renderer.init()
const ratio = devicePixelRatio
renderer.setPixelRatio(ratio)
renderer.setSize(328, 160)
const source = document.createElement('canvas')
source.width = Math.round(328 * ratio); source.height = Math.round(160 * ratio)
const ctx = source.getContext('2d')!
ctx.fillStyle = '#193247'; ctx.fillRect(0, 0, source.width, source.height)
ctx.fillStyle = '#d2c569'
for (let x = 0; x < source.width; x += 12 * ratio) ctx.fillRect(x, 0, ratio, source.height)
const tex = new CanvasTexture(source)
tex.flipY = false; tex.colorSpace = NoColorSpace
const sample = (at: any) => texture(tex, at).rgb
const filtered = (at: any, width: any) => texture(tex, at).level(width.mul(ratio).max(1).log2()).rgb
const boxes = [new Vector4(), new Vector4()]
const vecs = (a: Vector4[]) => uniformArray(a, 'vec4')
const glass = { capacity: 2, viewport: uniform(new Vector4(328,160,Number(!q.has('light')),0)),
  boxes: vecs(boxes), radii: vecs([new Vector4().setScalar(30),new Vector4().setScalar(24)]),
  filters: vecs([new Vector4(),new Vector4()]), bodies: vecs([new Vector4(),new Vector4()]) }
const blur = createGlassGaussian(at => filtered(at, float(2)), glass.viewport)
blur.update(328,160,true)
const separate = composeGlass(vec4(sample(uv()),1), sample, glass, vec4(1.12,.53,1.5,.025),filtered,blur.sample)
const group = uniform(0)
const pipeline = new RenderPipeline(renderer,q.has('separate') ? separate : mergeReferencePair(separate,group,glass,sample,filtered,blur.sample))
pipeline.outputColorTransform = false
const circle = document.querySelector<HTMLElement>('#circle')!, pill = document.querySelector<HTMLElement>('#pill')!
const gap = document.querySelector<HTMLInputElement>('#gap')!
const transparency = matchMedia('(prefers-reduced-transparency: reduce), (forced-colors: active)')
function update() {
  circle.style.left = (82 - Number(gap.value)) + 'px'
  const panel = canvas.getBoundingClientRect()
  for (const [i, el] of [circle,pill].entries()) {
    const r = el.getBoundingClientRect()
    const eligible = r.width > 0 && r.height > 0 && !el.hidden && !transparency.matches
      && !el.closest('[data-ui-frost="off"]')
    boxes[i].set(r.x - panel.x + r.width/2, r.y - panel.y + r.height/2, eligible ? r.width/2 : 0, r.height/2)
  }
  const container = circle.closest('[data-glass-container]')
  group.value = boxes.every(b => b.z > 0) && container && container === pill.closest('[data-glass-container]') ? ratio : 0
  pipeline.render()
  for (const [i, el] of [circle,pill].entries()) {
    if (boxes[i].z > 0) el.dataset.glassSurface = 'shader'
    else delete el.dataset.glassSurface
  }
}
transparency.addEventListener('change', update)
gap.addEventListener('input', update)
document.querySelector<HTMLInputElement>('#image')!.onchange = async e => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const image = await createImageBitmap(file)
  ctx.drawImage(image,0,0,source.width,source.height); image.close()
  tex.needsUpdate = true; update()
  canvas.dataset.loaded = 'true'
}
update()
export { renderer, pipeline }
