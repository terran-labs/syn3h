import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { JET_DESIGNS } from './designs'
import { NextJet } from './NextJet'
import { GROUND_Y } from './shapes'

/** A grey studio sphere, generated: the backdrop and, blurred, the reflections on the metal. */
function studio(withLights: boolean): THREE.Scene {
  const scene = new THREE.Scene(), g = new THREE.SphereGeometry(60, 48, 24), p = g.getAttribute('position'), colors: number[] = []
  for (let i = 0; i < p.count; i++) { const h = p.getY(i) / 60, v = withLights ? (h > 0 ? .16 + .1 * h : .16 + .55 * -h) : (h > 0 ? .34 - .16 * h : .34 + .4 * -h); colors.push(v, v, v * 1.01) }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })))
  if (withLights) {
    // Soft boxes: these are what make the long highlights along the hull.
    const box = (x: number, y: number, z: number, w: number, h: number, power: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power, power), side: THREE.DoubleSide }))
      m.position.set(x, y, z); m.lookAt(0, 0, 0); scene.add(m)
    }
    box(0, 30, 0, 46, 12, 4.5); box(-34, 14, -18, 20, 10, 3.5); box(30, 12, 24, 18, 10, 3); box(0, 6, -40, 30, 6, 2.5); box(8, -30, 4, 60, 60, .55)
  }
  return scene
}

async function main() {
  const renderer = new THREE.WebGPURenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight)
  renderer.shadowMap.enabled = true; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .95
  document.body.append(renderer.domElement)
  await renderer.init()
  const scene = studio(false)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(studio(true), .03).texture
  const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, .1, 200)
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-5, 12, -4); sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096); sun.shadow.normalBias = .03; sun.shadow.bias = -.0003
  Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 16, bottom: -16 }); scene.add(sun)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.ShadowNodeMaterial({ opacity: .38 }))
  floor.rotation.x = -Math.PI / 2; floor.position.y = GROUND_Y; floor.receiveShadow = true; scene.add(floor)

  const jets = JET_DESIGNS.map(d => new NextJet(d)), spacing = 9.5
  jets.forEach((j, i) => { j.object.position.x = (i - (jets.length - 1) / 2) * -spacing; scene.add(j.object) })
  let current = 0, all = false, gearTarget = 0, gear = 0, autoGear = true, hoverLift = 1
  const name = document.querySelector('#name')!, blurb = document.querySelector('#blurb')!, nav = document.querySelector('#nav')!
  const buttons: HTMLButtonElement[] = []
  const view = (direction: THREE.Vector3, distance: number, target: THREE.Vector3) => { controls.target.copy(target); camera.position.copy(target).addScaledVector(direction.normalize(), distance); controls.update() }
  const show = (index: number) => {
    all = index < 0; current = Math.max(0, index)
    jets.forEach((j, i) => { j.object.visible = all || i === current })
    buttons.forEach((b, i) => b.classList.toggle('on', all ? i === jets.length : i === current))
    name.textContent = all ? 'Five next-generation jets' : `${current + 1}. ${jets[current].design.name}`
    blurb.textContent = all ? 'Generated from parameters, no model files. Pick one to look closer.' : jets[current].design.blurb
    if (all) view(new THREE.Vector3(-.25, .5, -1), 52, new THREE.Vector3(0, 0, 0))
    else view(new THREE.Vector3(-.62, .42, -.8), 12, jets[current].object.position.clone().setY(-.1))
  }
  jets.forEach((j, i) => { const b = document.createElement('button'); b.textContent = `${i + 1} ${j.design.name}`; b.onclick = () => show(i); nav.append(b); buttons.push(b) })
  const allButton = document.createElement('button'); allButton.textContent = 'All five'; allButton.onclick = () => show(-1); nav.append(allButton); buttons.push(allButton)
  const gearButton = document.createElement('button'); gearButton.textContent = 'Landing gear: auto'; nav.append(gearButton)
  gearButton.onclick = () => { if (autoGear) { autoGear = false; gearTarget = 1 } else if (gearTarget === 1) gearTarget = 0; else autoGear = true; gearButton.textContent = `Landing gear: ${autoGear ? 'auto' : gearTarget ? 'down' : 'up'}` }
  const picker = document.createElement('label'); picker.innerHTML = 'Paint <input type="color">'; nav.append(picker)
  const input = picker.querySelector('input')!; input.oninput = () => jets[current].setColors(input.value, jets[current].design.accent)
  document.querySelector('#status')!.textContent = ''
  show(Number(new URLSearchParams(location.search).get('design') ?? 1) - 1)

  let elapsed = 0; const timer = new THREE.Timer()
  const api = {
    ready: true, jets, show, renderer,
    /** For captures: fix the gear, the height above the floor and the camera. */
    pose(g: number, lift: number, dir: [number, number, number], distance: number) {
      autoGear = false; gear = gearTarget = g; hoverLift = lift
      const target = all ? new THREE.Vector3(0, lift * .5, 0) : jets[current].object.position.clone().setY(lift - .1)
      jets.forEach(j => { j.object.position.y = lift }); view(new THREE.Vector3(...dir), distance, target)
    },
  }
  Object.assign(window, { jetLab: api })
  renderer.setAnimationLoop(() => {
    timer.update(); const dt = Math.min(timer.getDelta(), .05); elapsed += dt
    if (autoGear) { gearTarget = Math.floor(elapsed / 5) % 2; hoverLift = 1 }
    gear += Math.sign(gearTarget - gear) * Math.min(Math.abs(gearTarget - gear), dt * .7)
    jets.forEach(j => { j.setGear(gear); j.setThrottle(1 - gear * .7); if (autoGear || gearTarget !== gear) j.object.position.y = hoverLift * (1 - gear) * 1.6 })
    controls.update(); renderer.render(scene, camera)
  })
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) })
  addEventListener('pagehide', () => { renderer.setAnimationLoop(null); jets.forEach(j => j.dispose()); controls.dispose(); pmrem.dispose(); renderer.dispose() }, { once: true })
}
main().catch(error => { document.querySelector('#status')!.textContent = String(error); console.error(error) })
