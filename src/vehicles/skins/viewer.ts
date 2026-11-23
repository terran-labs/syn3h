import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { MiraBuggySkin } from './index'
import { params } from '../../../shared/params'
import { vehicleShading } from '../../core/quality'
import { motorSparkLoad, sparkLevel } from './motorDrive'

async function main() {
  const renderer = new THREE.WebGPURenderer({antialias: true})
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  renderer.shadowMap.enabled = true
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  document.body.append(renderer.domElement)
  await renderer.init()
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x101925)
  scene.fog = new THREE.Fog(0x101925, 25, 70)
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, .1, 100)
  camera.position.set(3, 10, -17)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, .5, 0)
  controls.update()
  // A neutral studio map so the paint and glass have something to reflect.
  const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(room, .04).texture; scene.environmentIntensity = .5
  room.dispose(); pmrem.dispose()
  scene.add(new THREE.HemisphereLight(0xb8dcff, 0x50463a, 2.2))
  const sun = new THREE.DirectionalLight(0xffdfbc, 4)
  sun.position.set(-4, 10, -6); sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.normalBias = .03
  sun.shadow.bias = -.0002
  Object.assign(sun.shadow.camera, {left: -14, right: 14, top: 10, bottom: -10})
  scene.add(sun)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({color: 0x283441, roughness: .85}))
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground)
  // The viewer has no frame governor, so ask for the full showroom shading here.
  params.set(vehicleShading.def.id, 3)
  const skins = [new MiraBuggySkin()]
  // Camera faces +Z, so positive X appears on the left of the comparison.
  skins.forEach((skin, i) => { skin.object.position.set(0, .65, 0); skin.setColors(0xe96d26, 0xffb94a); scene.add(skin.object) })
  await Promise.all(skins.map(s => s.ready))
  document.querySelector('#status')!.textContent = ''
  let auto = true, open = 0
  const button = document.querySelector<HTMLButtonElement>('#toggle')!
  button.onclick = () => { auto = !auto; button.textContent = `Auto wings: ${auto ? 'on' : 'off'}` }
  let elapsed = 0
  // Hub motor demo: effort ramps up (glow), holds flat out (sparks), then brakes (regen glow
  // and brake lamps) and rests, on a 10 s loop. `drive` and `braking` override it for checks.
  let drive: number | null = null, braking: boolean | null = null
  const timer = new THREE.Timer()
  // Wheel rest position: Mira WheelPos (1.1, 0.1, 1.3) with the
  // tyre's 0.5 m radius under the ray, as MiraBuggy places them at rest.
  const rest = [new THREE.Vector3(1.1, -.2, 1.3)]
  const api = {skins, renderer, camera, controls, ready: true,
    focus(index: number) { const p = skins[index].object.position; controls.target.copy(p); camera.position.copy(p).add(new THREE.Vector3(3, 2.5, -4.5)); controls.update() },
    /** Free camera for screenshots: offsets relative to skin `index`. */
    view(index: number, eye: [number, number, number], target: [number, number, number]) { const p = skins[index].object.position; controls.target.copy(p).add(new THREE.Vector3(...target)); camera.position.copy(p).add(new THREE.Vector3(...eye)); controls.update() },
    setOpen(value: number) {auto = false; open = value; skins.forEach(s => s.setWings(value, 0, 0))},
    setDrive(value: number | null) { drive = value },
    setBraking(value: boolean | null) { braking = value }}
  Object.assign(window, {skinViewer: api})
  renderer.setAnimationLoop(() => {
    timer.update(); const dt = Math.min(timer.getDelta(), .05); elapsed += dt
    const target = auto && Math.floor(elapsed / 4) % 2 === 0 ? 1 : 0
    if (auto) open = THREE.MathUtils.clamp(open + Math.sign(target - open) * Math.min(Math.abs(target-open), dt*2), 0, 1)
    const phase = elapsed % 10
    const demo = phase < 3 ? phase / 3 : phase < 5 ? 1 : phase < 7 ? (7 - phase) / 2 * .6 : 0
    const effort = drive ?? demo, regen = drive === null && phase >= 5 && phase < 7
    const brake = braking ?? regen
    skins.forEach((skin, k) => {
      const r = rest[k]
      for (let i=0; i<4; i++) {
        // Mira travel is larger (0.4 m suspension range), so it shows the struts working.
        const travel = k ? .12 : .035
        skin.setWheel(i, new THREE.Vector3(i%2 ? r.x : -r.x, r.y + Math.sin(elapsed*2+i)*travel, i<2 ? -r.z : r.z), i<2 ? Math.sin(elapsed)*.2 : 0, -elapsed*3)
        skin.setDrive?.(i, effort, regen, regen ? 0 : sparkLevel(effort, motorSparkLoad.value))
      }
      skin.setLights?.(brake)
      skin.setWings(open, Math.sin(elapsed)*.7, Math.cos(elapsed*.7)*.4)
    })
    controls.update(); renderer.render(scene, camera)
  })
  addEventListener('resize', () => {camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight)})
  addEventListener('pagehide', () => { renderer.setAnimationLoop(null); skins.forEach(s => s.dispose()); controls.dispose(); renderer.dispose() }, {once:true})
}
main().catch(error => {document.querySelector('#status')!.textContent = String(error); console.error(error)})
