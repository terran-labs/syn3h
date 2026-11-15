/**
 * Studio viewer for the tank design studies: one design on a glossy floor, or all five in a row.
 * URL: ?d=<0-4|all> picks the view, ?still=1 hides the interface and stops the turntable,
 * ?az=<degrees>&el=<degrees> set the camera for stills, ?color=<hex> repaints every design.
 */
import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { designs } from './designs'
import { makeMats, type Mats } from './kit'

const query = new URLSearchParams(location.search)
const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>('#' + id)!

/** A dark room with a few long softboxes, so paint and chrome pick up studio style streaks. */
function studio() {
  const env = new THREE.Scene()
  env.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.MeshBasicMaterial({ color: 0x2b2d32, side: THREE.BackSide })))
  const box = (w: number, h: number, x: number, y: number, z: number, power: number, color = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }))
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m)
  }
  box(4, 34, -6, 24, 1, 9); box(3, 34, 8, 24, 1, 6); box(8, 26, -24, 10, -6, 3.2); box(8, 26, 24, 10, 8, 2.4, 0xdfe8ff); box(26, 5, 0, 8, 28, 2.2); box(22, 4, 0, 6, -30, 2.6, 0xfff0dd)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: 0x17181b })); floor.rotation.x = -Math.PI / 2; floor.position.y = -6; env.add(floor)
  return env
}

async function main() {
  const still = query.get('still') === '1'
  document.body.classList.toggle('still', still)
  const renderer = new THREE.WebGPURenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight)
  renderer.shadowMap.enabled = true; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05
  document.body.prepend(renderer.domElement)
  await renderer.init()
  const scene = new THREE.Scene(), bg = new THREE.Color(0x8d9096)
  scene.background = bg; scene.fog = new THREE.Fog(bg, 30, 85)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(studio(), .03).texture
  const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, .1, 200)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - .03; controls.minDistance = 5; controls.maxDistance = 60
  const key = new THREE.DirectionalLight(0xfff3e4, 2.6); key.position.set(-7, 14, -6); key.castShadow = true
  key.shadow.mapSize.set(2048, 2048); key.shadow.normalBias = .03; key.shadow.bias = -.0003
  Object.assign(key.shadow.camera, { left: -20, right: 20, top: 9, bottom: -9, near: 1, far: 40 })
  scene.add(key, new THREE.HemisphereLight(0xdde6f5, 0x2a2b30, .5))
  // Glossy dark floor. A mirrored copy of each model under it gives the reflection in the owner's renders.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshStandardMaterial({ color: 0x1b1c20, metalness: .2, roughness: .28, transparent: true, opacity: .86 }))
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.renderOrder = 1; scene.add(floor)

  const stage = new THREE.Group(); scene.add(stage)
  const built = designs.map(d => {
    const mats = makeMats(query.get('color') ? parseInt(query.get('color')!, 16) : d.color), model = d.build(mats); model.position.y = .05
    const mirror = model.clone(); mirror.scale.y = -1; mirror.position.y = -.05; mirror.traverse(o => { o.castShadow = false; o.receiveShadow = false })
    const root = new THREE.Group(); root.add(model, mirror); stage.add(root)
    return { d, mats, root }
  })
  $('status').textContent = ''

  let current = -2, spin = !still
  function frame(az: number, el: number, dist: number, target: THREE.Vector3) {
    const a = az * Math.PI / 180, e = el * Math.PI / 180
    controls.target.copy(target); camera.position.set(target.x + Math.sin(a) * Math.cos(e) * dist, target.y + Math.sin(e) * dist, target.z - Math.cos(a) * Math.cos(e) * dist); controls.update()
  }
  function show(index: number) {
    current = index; stage.rotation.y = 0
    const all = index < 0, narrow = innerWidth / innerHeight < 1
    built.forEach((b, i) => { b.root.visible = all || i === index; b.root.position.x = all ? (2 - i) * 6.6 : 0; b.root.rotation.y = all ? .5 : 0 })
    $('name').textContent = all ? 'All five' : `${index + 1}. ${built[index].d.name}`
    $('tagline').textContent = all ? 'Tap a name to look closer' : built[index].d.tagline
    document.querySelectorAll('#tabs button').forEach((b, i) => b.classList.toggle('on', i === index + 1))
    const az = Number(query.get('az') ?? (all ? 0 : 36)), el = Number(query.get('el') ?? (all ? 22 : 14))
    frame(az, el, all ? (narrow ? 80 : 38) : (narrow ? 25 : 14), new THREE.Vector3(0, all ? .4 : .7, 0))
  }
  const tabs = $('tabs')
  ;[{ name: 'All', n: '' }, ...designs.map((d, i) => ({ name: d.name, n: String(i + 1) }))].forEach((t, i) => {
    const b = document.createElement('button'); b.innerHTML = `<b>${t.n || '★'}</b>${t.name}`; b.onclick = () => show(i - 1); tabs.append(b)
  })
  const colors = $('colors')
  ;[['Own', -1], ['White', 0xeceef0], ['Grey', 0xa9b0b8], ['Orange', 0xd4560f], ['Blue', 0x0d1cae], ['Violet', 0x45209a], ['Green', 0x08783f], ['Graphite', 0x2a2d33]].forEach(([label, hex]) => {
    const b = document.createElement('button'); b.title = String(label)
    if (hex === -1) b.textContent = 'Own colours'; else { b.className = 'sw'; b.style.background = '#' + (hex as number).toString(16).padStart(6, '0') }
    b.onclick = () => built.forEach(x => x.mats.paintU.value.setHex(hex === -1 ? x.d.color : hex as number)); colors.append(b)
  })
  const turn = document.createElement('button'); turn.textContent = 'Turntable: on'; turn.onclick = () => { spin = !spin; turn.textContent = `Turntable: ${spin ? 'on' : 'off'}` }; colors.append(turn)
  const d = query.get('d'); show(d === null || d === 'all' ? -1 : Math.max(0, Math.min(designs.length - 1, Number(d))))

  const timer = new THREE.Timer(), arms: THREE.Object3D[] = []
  let elapsed = 0
  stage.traverse(o => { if (o.userData.arm) arms.push(o) })
  let frames = 0
  renderer.setAnimationLoop(() => {
    timer.update(); const dt = Math.min(timer.getDelta(), .05)
    if (spin && current >= 0) stage.rotation.y += dt * .35
    // Suspension demo: each arm swings on its boss and the pod stays level on the arm's end.
    elapsed += dt
    for (const arm of arms) {
      const swing = arm.userData.arm + (still ? 0 : Math.sin(elapsed * 1.5 + arm.userData.phase) * .13)
      arm.rotation.x = swing
      for (const c of arm.children) if (c.userData.pod) c.rotation.x = -swing + (still ? 0 : Math.sin(elapsed * 1.1 + arm.userData.phase * 2) * .05)
    }
    controls.update(); renderer.render(scene, camera); frames++
    Object.assign(window, { tankDesigns: { ready: frames > 3, show, frame, built } })
  })
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) })
}
main().catch(error => { $('status').textContent = String(error); console.error(error) })
export type { Mats }
