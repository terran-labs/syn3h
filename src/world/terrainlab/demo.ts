/**
 * Terrain Lab viewer: renders the island prototype (or a reference heightmap extracted from
 * the old Unity projects) with a liquid sea to the horizon, so shapes can be judged from
 * pictures before anything touches the game's generator.
 *
 *   /terrainlab.html?seed=7&view=coast&liquid=lava&clean=1
 *   /terrainlab.html?ref=Freestyle      (needs public/terrainlab-ref/Freestyle.f32 + .json)
 *
 * `window.terrainLab` exposes build(seed, overrides), setView(name) and the current data.
 */
import * as THREE from 'three/webgpu'
import {
  Fn, attribute, color, float, mix, mx_noise_float, normalGeometry, cameraPosition, positionWorld, positionWorldDirection, sin, smoothstep, time, uniform, vec2, vec3,
} from 'three/tsl'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { DEFAULT_ISLAND, type IslandData, type IslandSettings, generateIsland } from './island'

const query = new URLSearchParams(location.search)
if (query.has('clean')) document.body.classList.add('clean')
const canvas = document.querySelector('canvas')!
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: query.has('webgl') })
await renderer.init()
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 40000)
const controls = new OrbitControls(camera, canvas)

const water = query.get('liquid') === 'water'
const night = query.has('night')
// Dusty, dark red sky like Tholus; the horizon haze matches so the sea fades into it.
const horizon = new THREE.Color(night ? 0x120607 : water ? 0x9fb4c4 : 0x6b2a1c)
const zenith = new THREE.Color(night ? 0x04040a : water ? 0x2f5f9a : 0x34110f)
scene.background = horizon
// Sky gradient: haze at the horizon rising into a darker zenith.
scene.backgroundNode = mix(color(horizon), color(zenith), smoothstep(0.0, 0.8, positionWorldDirection.y))
scene.fog = new THREE.FogExp2(horizon, night ? 0.00022 : 0.00016)
const sun = new THREE.DirectionalLight(night ? 0x8fa4ff : 0xffd9b0, night ? 0.3 : 3.4)
sun.position.set(-0.5, 0.5, 0.6)
scene.add(sun)
// Fill from the far side, the colour of lava light, so faces turned from the sun are not black.
const fill = new THREE.DirectionalLight(night ? 0xff5a1e : 0xff8a50, night ? 0.5 : 0.9)
fill.position.set(0.6, 0.25, -0.5)
scene.add(fill)
scene.add(new THREE.HemisphereLight(night ? 0x20223a : 0xf0b090, night ? 0x3a1206 : 0x7a2a12, night ? 0.6 : 1.5))

// ---------------------------------------------------------------------------------------
// Ground material: saturated rust plains, dark banded rock on steep faces, basalt on the
// volcano, scorched and glowing ground next to lava.
// ---------------------------------------------------------------------------------------
const lakeLevel = uniform(1000)
const lakeRadius = uniform(0)
const glow = uniform(water ? 0 : 1)

function groundMaterial(): THREE.MeshStandardNodeMaterial {
  const p = positionWorld
  const volcanic = attribute<'float'>('volcanic', 'float')
  const big = mx_noise_float(p.mul(0.006))
  const mid = mx_noise_float(p.mul(0.05))
  const fine = mx_noise_float(p.mul(0.45))
  const slope = float(1).sub(normalGeometry.y)

  let col = mix(color(0xa5351a), color(0xd9602c), smoothstep(-0.9, 0.9, big.mul(0.8).add(mid.mul(0.35))))
  // Steep faces: darker rock with strata.
  const strata = sin(p.y.mul(0.3).add(big.mul(7)).add(mid.mul(2.5))).mul(0.5).add(0.5)
  const rock = mix(color(0x7a2a14), color(0xa8431f), strata.mul(0.22).add(mid.mul(0.45).add(0.35)))
  const cliff = smoothstep(0.16, 0.38, slope.add(mid.mul(0.05)))
  col = mix(col, rock, cliff)
  // Basalt on the volcano and crag tops.
  const basalt = mix(color(0x1d1412), color(0x3b211a), smoothstep(-0.5, 0.5, mid))
  col = mix(col, basalt, volcanic.mul(float(0.5).add(cliff.mul(0.4))).clamp(0, 1))
  // Scorched shore: ground just above the liquid is burnt black (lava) or wet (water).
  const shore = smoothstep(8, 2, p.y)
  col = mix(col, water ? color(0xcbb38a) : color(0x140a08), shore.mul(water ? 0.8 : 0.9))
  col = col.mul(fine.mul(0.1).add(0.95))

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 })
  material.colorNode = col
  // Heat glow: the sea lights the shoreline, the lake lights the inside of the caldera.
  const seaGlow = smoothstep(1.4, -1.5, p.y)
  const r = vec2(p.x, p.z).length()
  const lakeGlow = smoothstep(lakeRadius.mul(1.3), lakeRadius.mul(0.95), r).mul(smoothstep(lakeLevel.add(16), lakeLevel.sub(2), p.y))
  material.emissiveNode = vec3(1.0, 0.2, 0.02).mul(seaGlow.mul(0.7).add(lakeGlow.mul(0.5))).mul(glow)
  return material
}

function liquidMaterial(hot = false): THREE.MeshBasicNodeMaterial {
  const p = positionWorld
  const material = new THREE.MeshBasicNodeMaterial()
  if (water) {
    material.colorNode = mix(color(0x0d3550), color(0x2f7c95), mx_noise_float(vec3(p.x.mul(0.01), p.z.mul(0.01), time.mul(0.2))).mul(0.5).add(0.5))
    return material
  }
  material.colorNode = Fn(() => {
    // Dark crust plates drifting on the melt, bright cracks between them. Two scales so it
    // reads from a buggy and from the air; far away it settles into a dull even glow.
    const drift = time.mul(hot ? 0.12 : 0.03)
    const f = hot ? 0.09 : 0.045
    const a = mx_noise_float(vec3(p.x.mul(f), p.z.mul(f), drift))
    const b = mx_noise_float(vec3(p.x.mul(0.011).add(40), p.z.mul(0.011), drift.mul(0.5)))
    const plates = a.mul(0.7).add(b)
    if (hot) {
      // Freshly erupted: mostly molten, thin dark skin.
      return mix(vec3(2.4, 0.6, 0.06), vec3(0.5, 0.06, 0.01), smoothstep(0.15, 0.75, plates.abs()))
    }
    const crack = smoothstep(0.07, 0.0, plates.abs())
    const crust = mix(color(0x1c0602), color(0x6a1604), smoothstep(-0.7, 0.9, plates))
    const near = mix(crust, vec3(2.2, 0.6, 0.08), crack)
    const dist = p.sub(cameraPosition).length()
    return mix(near, vec3(0.6, 0.12, 0.02), smoothstep(400, 3200, dist))
  })()
  return material
}

const ground = groundMaterial()
const liquid = liquidMaterial()
const hotLiquid = water ? liquid : liquidMaterial(true)
const sea = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2), liquid)
scene.add(sea)
const lake = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), hotLiquid)
scene.add(lake)

let terrainMesh: THREE.Mesh | null = null
let channelMesh: THREE.Mesh | null = null
let current: { n: number; size: number; heights: Float32Array; data: IslandData | null } | null = null

function heightAt(x: number, z: number): number {
  if (!current) return 0
  const { n, size, heights } = current
  const cell = size / (n - 1)
  const gx = Math.min(n - 1.001, Math.max(0, (x + size / 2) / cell))
  const gz = Math.min(n - 1.001, Math.max(0, (z + size / 2) / cell))
  const ix = Math.floor(gx), iz = Math.floor(gz)
  const fx = gx - ix, fz = gz - iz
  const a = heights[iz * n + ix], b = heights[iz * n + ix + 1]
  const c = heights[(iz + 1) * n + ix], d = heights[(iz + 1) * n + ix + 1]
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz
}

function setTerrain(n: number, size: number, heights: Float32Array, volcanic: Float32Array | null) {
  if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose() }
  const geometry = new THREE.PlaneGeometry(size, size, n - 1, n - 1)
  geometry.rotateX(-Math.PI / 2)
  const pos = geometry.attributes.position as THREE.BufferAttribute
  // PlaneGeometry rows run along +z after the rotation, matching heights[iz * n + ix].
  for (let i = 0; i < pos.count; i++) pos.setY(i, heights[i])
  geometry.setAttribute('volcanic', new THREE.BufferAttribute(volcanic ?? new Float32Array(n * n), 1))
  geometry.computeVertexNormals()
  terrainMesh = new THREE.Mesh(geometry, ground)
  scene.add(terrainMesh)
}

function build(seed: number, overrides: Partial<IslandSettings> = {}): IslandData {
  const settings = { ...DEFAULT_ISLAND, ...overrides }
  const t = performance.now()
  const data = generateIsland(seed, settings)
  const ms = performance.now() - t
  current = { n: data.resolution, size: data.size, heights: data.heights, data }
  setTerrain(data.resolution, data.size, data.heights, data.volcanic)
  const L = data.layout
  lake.visible = true
  lake.scale.setScalar(L.lakeRadius * 1.12)
  lake.position.set(0, L.lakeLevel, 0)
  lakeLevel.value = L.lakeLevel
  lakeRadius.value = L.lakeRadius

  // Lava channel ribbon: a strip following the trench centre line, a little above its floor.
  if (channelMesh) { scene.remove(channelMesh); channelMesh.geometry.dispose(); channelMesh = null }
  const pts = L.channel
  const count = pts.length / 2
  const verts: number[] = []
  const index: number[] = []
  for (let i = 0; i < count; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1]
    const j = Math.min(count - 1, i + 1), k = Math.max(0, i - 1)
    let tx = pts[j * 2] - pts[k * 2], tz = pts[j * 2 + 1] - pts[k * 2 + 1]
    const len = Math.hypot(tx, tz) || 1
    tx /= len; tz /= len
    const w = 7
    // Lava surface: the trench floor plus a couple of metres, never below the sea.
    const y = Math.max(0.3, Math.min(heightAt(x, z) + 2.5, L.lakeLevel))
    verts.push(x - tz * w, y, z + tx * w, x + tz * w, y, z - tx * w)
    if (i < count - 1) index.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3)
  }
  const ribbon = new THREE.BufferGeometry()
  ribbon.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  ribbon.setIndex(index)
  channelMesh = new THREE.Mesh(ribbon, hotLiquid)
  channelMesh.visible = !water
  scene.add(channelMesh)

  let lo = Infinity, hi = -Infinity
  for (const h of data.heights) { if (h < lo) lo = h; if (h > hi) hi = h }
  document.getElementById('stats')!.textContent =
    `seed ${data.seed}  ${data.resolution}x${data.resolution}  ${ms.toFixed(0)} ms\nheights ${lo.toFixed(0)} to ${hi.toFixed(0)} m`
  Object.assign(lab, { data, generateMs: ms, min: lo, max: hi })
  return data
}

/** Show a heightmap extracted from one of the old Unity terrains, on an island of sea. */
async function loadReference(name: string) {
  const meta = await (await fetch(`/terrainlab-ref/${name}.json`)).json()
  const raw = new Float32Array(await (await fetch(`/terrainlab-ref/${name}.f32`)).arrayBuffer())
  const n0: number = meta.n
  const step = Math.max(1, Math.round((n0 - 1) / 512))
  const n = (n0 - 1) / step + 1
  const size = Number(query.get('size') ?? 2048)
  const heightScale = Number(query.get('height') ?? 500) * (size / 1000)
  const sink = Number(query.get('sink') ?? 0.05)
  const heights = new Float32Array(n * n)
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) heights[z * n + x] = (raw[z * step * n0 + x * step] - sink) * heightScale
  current = { n, size, heights, data: null }
  setTerrain(n, size, heights, null)
  lake.visible = false
  document.getElementById('stats')!.textContent = `reference ${name}  ${n0}x${n0}`
}

const views: Record<string, () => void> = {
  aerial() { look([-1050, 620, 950], [0, 90, 0]) },
  top() { look([0, 3300, 1], [0, 0, 0]) },
  low() { look([-1150, 90, 820], [0, 150, 0]) },
  coast() {
    const s = current?.data?.layout.spawns[0]
    if (!s) return views.low()
    look([s.x * 1.02, s.y + 2.6, s.z * 1.02], [0, 170, 0])
  },
  crater() {
    const L = current?.data?.layout
    if (!L) return views.aerial()
    look([-L.breachX * 190, L.rimHeight + 130, -L.breachZ * 190], [L.breachX * 60, L.lakeLevel - 20, L.breachZ * 60])
  },
  breach() {
    const L = current?.data?.layout
    if (!L) return views.aerial()
    const d = 620
    look([L.breachX * d + L.breachZ * 150, heightAt(L.breachX * d + L.breachZ * 150, L.breachZ * d - L.breachX * 150) + 14, L.breachZ * d - L.breachX * 150], [0, L.rimHeight * 0.7, 0])
  },
  crags() {
    const s = current?.data?.layout.spawns[2]
    if (!s) return views.low()
    const x = s.x * 0.8, z = s.z * 0.8
    look([x, heightAt(x, z) + 3, z], [s.z * 0.5, 60, -s.x * 0.5])
  },
  rim() {
    const L = current?.data?.layout
    if (!L) return views.aerial()
    const r = L.lakeRadius / 0.86
    look([-L.breachX * r * 1.02, heightAt(-L.breachX * r * 1.02, -L.breachZ * r * 1.02) + 5, -L.breachZ * r * 1.02], [L.breachX * 700, 0, L.breachZ * 700])
  },
}
function look(eye: number[], at: number[]) {
  camera.position.set(eye[0], eye[1], eye[2])
  controls.target.set(at[0], at[1], at[2])
  controls.update()
}
function setView(name: string) { (views[name] ?? views.aerial)() }

const lab: Record<string, unknown> = { build, setView, heightAt, views: Object.keys(views), frames: 0 }
Object.assign(window, { terrainLab: lab })

const viewBox = document.getElementById('views')!
for (const name of Object.keys(views)) {
  const b = document.createElement('button')
  b.textContent = name
  b.onclick = () => setView(name)
  viewBox.append(b)
}
const seedInput = document.getElementById('seed') as HTMLInputElement
document.getElementById('go')!.onclick = () => build(Number(seedInput.value) || 1)

const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix() }
addEventListener('resize', resize)
resize()

const ref = query.get('ref')
if (ref) await loadReference(ref)
else { seedInput.value = query.get('seed') ?? '1'; build(Number(seedInput.value) || 1) }
setView(query.get('view') ?? 'aerial')
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); (lab.frames as number)++ })
