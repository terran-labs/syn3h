/**
 * Demo page (planets.html): one slowly turning sphere per planet recipe, each textured
 * with the real island for its seed by paintPlanetMap.
 */
import * as THREE from 'three/webgpu'
import { paintPlanetMap, planetCard } from './planetMap'
import { PLANETS, randomSeed } from './planets'

const query = new URLSearchParams(location.search)
const renderer = new THREE.WebGPURenderer({ canvas: document.querySelector('canvas')!, antialias: true, forceWebGL: query.has('webgl') })
await renderer.init()
renderer.setPixelRatio(Math.min(2, devicePixelRatio))
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x04050a)
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
camera.position.set(0, 0, 11)
const sun = new THREE.DirectionalLight(0xffffff, 3.2)
sun.position.set(-4, 3, 6)
scene.add(sun, new THREE.AmbientLight(0x8090b0, 0.35))

/** The painter's rows run north to south; texture row 0 is the bottom of the sphere. */
function texture(map: { width: number; height: number; data: Uint8ClampedArray }, glowOnly = false): THREE.DataTexture {
  const flipped = new Uint8Array(map.data.length), row = map.width * 4
  for (let y = 0; y < map.height; y++) flipped.set(map.data.subarray(y * row, (y + 1) * row), (map.height - 1 - y) * row)
  // Emissive copy: keep only hot orange pixels (lava cracks, shore glow, lakes), black elsewhere.
  if (glowOnly) for (let i = 0; i < flipped.length; i += 4) {
    const r = flipped[i], g = flipped[i + 1], b = flipped[i + 2]
    if (!(r > 170 && r - b > 120 && g > 50)) flipped[i] = flipped[i + 1] = flipped[i + 2] = 0
  }
  const t = new THREE.DataTexture(flipped, map.width, map.height, THREE.RGBAFormat)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

const geometry = new THREE.SphereGeometry(1.5, 96, 64)
const globes = PLANETS.map((recipe, i) => {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.x = (i - (PLANETS.length - 1) / 2) * 3.7
  scene.add(mesh)
  return { recipe, mesh, material }
})
const labels = document.getElementById('labels')!
const stats = document.getElementById('stats')!

function paint(seeds: number[]): void {
  labels.textContent = ''
  let ms = 0
  globes.forEach((g, i) => {
    const t0 = performance.now()
    const map = paintPlanetMap(g.recipe.id, seeds[i])
    ms += performance.now() - t0
    const card = planetCard(g.recipe.id, seeds[i])
    g.material.map?.dispose(); g.material.emissiveMap?.dispose()
    g.material.map = texture(map)
    // Lava glows a little, so the night side shows its cracks. Land rust does not glow.
    const lava = card.sea === 'lava' || g.recipe.values['terrain.kind'] === 0
    g.material.emissiveMap = lava ? texture(map, true) : null
    g.material.emissive = new THREE.Color(lava ? 0xffffff : 0x000000)
    g.material.emissiveIntensity = lava ? 0.6 : 0
    g.material.needsUpdate = true
    // The island faces the camera at the start: SphereGeometry puts u = 0.5 at +x.
    g.mesh.rotation.set(0.25, -Math.PI / 2, 0)
    const el = document.createElement('div')
    el.innerHTML = `<strong></strong><span></span>`
    el.querySelector('strong')!.textContent = card.name
    el.querySelector('span')!.textContent = `${card.label} · seed ${card.seed}`
    labels.append(el)
  })
  stats.textContent = `painted 3 maps in ${ms.toFixed(0)} ms`
  Object.assign(window, { planetsDemo: { paintMs: ms, seeds, ready: true } })
}

const fixed = query.get('seeds')?.split(',').map(Number)
paint(fixed?.length === PLANETS.length ? fixed : PLANETS.map(() => randomSeed()))
document.getElementById('reseed')!.onclick = () => paint(PLANETS.map(() => randomSeed()))

const spin = query.has('still') ? 0 : 0.08
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix() }
addEventListener('resize', resize); resize()
let last = performance.now()
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now
  for (const g of globes) g.mesh.rotation.y += spin * dt
  renderer.render(scene, camera)
})
