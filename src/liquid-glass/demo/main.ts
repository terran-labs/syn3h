import { CanvasTexture, NoColorSpace, RenderPipeline, Vector4, WebGPURenderer } from 'three/webgpu'
import { texture, uniform, uniformArray, uv, vec4 } from 'three/tsl'
import { composeGlass } from '../compose'

const width = 328
const height = 160
const ratio = devicePixelRatio
const canvas = document.querySelector('canvas')!
const renderer = new WebGPURenderer({ canvas, forceWebGL: new URLSearchParams(location.search).has('webgl') })
await renderer.init()
renderer.setPixelRatio(ratio)
renderer.setSize(width, height)

const chart = document.createElement('canvas')
chart.width = Math.round(width * ratio)
chart.height = Math.round(height * ratio)
const context = chart.getContext('2d')!
context.scale(ratio, ratio)
context.fillStyle = '#172941'
context.fillRect(0, 0, width, height)
context.fillStyle = '#45cce2'
for (let x = 0; x < width; x += 8) context.fillRect(x, 0, 1, height)
for (let y = 0; y < height; y += 8) context.fillRect(0, y, width, 1)

const backdrop = new CanvasTexture(chart)
backdrop.flipY = false
backdrop.colorSpace = NoColorSpace
const sample = (at: ReturnType<typeof uv>) => texture(backdrop, at).rgb
const surfaces = {
  capacity: 2,
  viewport: uniform(new Vector4(width, height, 0, 0)),
  boxes: uniformArray([new Vector4(80, 80, 30, 30), new Vector4(212, 80, 70, 24)], 'vec4'),
  radii: uniformArray([new Vector4().setScalar(30), new Vector4().setScalar(24)], 'vec4'),
  filters: uniformArray([new Vector4(2, 1.2, 0, 0), new Vector4(3, 1.2, 0, 0)], 'vec4'),
  bodies: uniformArray([new Vector4(1, 1, 1, .06), new Vector4(1, 1, 1, .06)], 'vec4'),
}
const pipeline = new RenderPipeline(renderer, composeGlass(vec4(sample(uv()), 1), sample, surfaces, vec4(1.12, .53, 1.5, .025)))
pipeline.outputColorTransform = false
pipeline.render()

document.querySelector('input')!.addEventListener('change', async event => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const image = await createImageBitmap(file)
  context.drawImage(image, 0, 0, width, height)
  image.close()
  backdrop.needsUpdate = true
  pipeline.render()
})
