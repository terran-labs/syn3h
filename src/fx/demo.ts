import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Terrain } from '../world/Terrain'
import { params, worldLavaAltitude } from '../../shared/params'
import { LavaSurface } from './LavaSurface'
import { LavaFlow, traceDownhill } from './LavaFlow'
import { Emitters } from './Emitters'
const query = new URLSearchParams(location.search)
const renderer = new THREE.WebGPURenderer({ canvas: document.querySelector('canvas')!, antialias: true, forceWebGL: query.has('webgl') })
await renderer.init()
renderer.setPixelRatio(1); renderer.toneMapping = THREE.ACESFilmicToneMapping
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
camera.position.set(78, 95, 94)
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 2, 0); controls.update()
const terrain: Terrain = {
  size: 160,
  heightAt(x, z) { return -8 + (x * x + z * z) * 0.004 + Math.sin(x * 0.15) * Math.sin(z * 0.12) * 1.3 },
  normalAt(x, z, out) { return out.set(this.heightAt(x - 0.2, z) - this.heightAt(x + 0.2, z), 0.4, this.heightAt(x, z - 0.2) - this.heightAt(x, z + 0.2)).normalize() },
  spawnPoint() { return { position: new THREE.Vector3(30, this.heightAt(30, 0) + 2, 0), heading: 0 } },
  dispose() {},
}
const geometry = new THREE.PlaneGeometry(terrain.size, terrain.size, 120, 120); geometry.rotateX(-Math.PI / 2)
const positions = geometry.attributes.position
for (let i = 0; i < positions.count; i++) positions.setY(i, terrain.heightAt(positions.getX(i), positions.getZ(i)))
geometry.computeVertexNormals()
scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardNodeMaterial({ color: 0x573b36, roughness: 1 })))
const sun = new THREE.DirectionalLight(0xffc49a, 3); sun.position.set(30, 70, 40); scene.add(sun)
const ambient = new THREE.HemisphereLight(0xeac3ac, 0x241827, 1); scene.add(ambient)
params.set(worldLavaAltitude.def.id, -3)
const lake = new LavaSurface(scene, terrain)
const river = new LavaFlow(scene, terrain, traceDownhill(terrain, { x: -47, z: -27 }, { step: 1, stopHeight: -4 }), 3.5)
const emitters = new Emitters(scene)
const ventCount = query.has('stress') ? 50 : 9
for (let i = 0; i < ventCount; i++) {
  const angle = i * 2.399963, radius = 17 + (i % 3) * 7
  const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius
  emitters.addVent({ x, y: Math.max(-3, terrain.heightAt(x, z)) + 0.3, z }, { kind: (['flame', 'embers', 'smoke'] as const)[i % 3], radius: i % 3 === 1 ? 1 : 2.2, height: i % 3 === 2 ? 20 : 10, intensity: 1 })
}
let night = false
function setNight(value: boolean) { night = value; scene.background = new THREE.Color(night ? 0x03040b : 0x996e60); sun.intensity = night ? 0.025 : 3; ambient.intensity = night ? 0.06 : 1 }
setNight(query.has('night'))
document.getElementById('night')!.onclick = () => setNight(!night)
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix() }
addEventListener('resize', resize); resize()
const metrics = { backend: (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl', frames: 0, particles: 0, vents: ventCount, cpuMs: [] as number[], frameMs: [] as number[], calls: 0 }
Object.assign(window, { fxDemo: { metrics, setNight, emitters, params, scene, renderer, camera } })
let last = performance.now()
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000), frameMs = now - last; last = now
  const start = performance.now()
  lake.update(dt); river.update(dt); emitters.update(dt); renderer.render(scene, camera)
  metrics.frames++; metrics.particles = emitters.particleCount; metrics.calls = renderer.info.render.drawCalls
  if (metrics.frames > 90) { metrics.cpuMs.push(performance.now() - start); metrics.frameMs.push(frameMs); if (metrics.cpuMs.length > 300) { metrics.cpuMs.shift(); metrics.frameMs.shift() } }
  if (metrics.frames % 30 === 0) document.getElementById('stats')!.textContent = `${metrics.backend} / ${metrics.particles} particles / ${ventCount} vents`
})
