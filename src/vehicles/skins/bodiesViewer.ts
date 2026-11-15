/**
 * Gallery for the buggy body variations (buggy-bodies.html). Loads the bodies that
 * tools/buggy-bodies/build.py exports to labs/buggy-bodies, puts the original wheels, inner
 * wheel wings and wing struts on them and lets the owner orbit each one, compare a round side
 * by side, change the paint and switch to night to judge the lights. Review tool only: nothing
 * here ships in the game. The models live in labs/, which the dev server serves from the
 * repository root but the production build does not copy.
 *
 * ?round=1 shows the first round; the default is the latest round plus the body it grew from.
 */
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

interface Variant { id: string; name: string; notes: string[]; file: string; triangles: number; round: number }

const MODELS = '/labs/buggy-bodies'
/** The round 1 body the owner picked as the base for round 2. */
const PICKED = 'v4-widebody'

const PAINTS: [string, number, number | null][] = [
  ['As built', -1, null], ['Navy', 0x0b1560, 0x101014], ['Blue', 0x1553c8, 0xd01818], ['Red', 0xb3140f, 0x101014], ['White', 0xe8ecf0, 0x1553c8], ['Black', 0x0c0d10, 0xff7a14],
]
/** Wheel positions at rest in the game frame (nose at -Z): Syn3hBuggy WHEEL_POS at ride height. */
const WHEELS = [[-1.1, -0.19, -1.3], [1.1, -0.19, -1.3], [-1.1, -0.19, 1.3], [1.1, -0.19, 1.3]]
/** Where each strut meets the body: the prefab's AxelPos, as LoadedBuggySkin's mounts. */
const MOUNTS = [[-0.55, 0.15, -1.2], [0.55, 0.15, -1.2], [-0.55, 0.15, 1.2], [0.55, 0.15, 1.2]]
const SPACING = 4

async function main() {
  const status = document.querySelector('#status')!
  const renderer = new THREE.WebGPURenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  renderer.shadowMap.enabled = true
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  document.body.prepend(renderer.domElement)
  await renderer.init()

  const scene = new THREE.Scene()
  const day = new THREE.Color(0x2a3644), night = new THREE.Color(0x05070b)
  scene.background = day.clone()
  // Something for the chrome and the clear coat to reflect.
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.9
  const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 200)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.maxPolarAngle = Math.PI * 0.52
  controls.minDistance = 2.5; controls.maxDistance = 40
  const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x4a4036, 1.2)
  const sun = new THREE.DirectionalLight(0xffe9cf, 3.2)
  sun.position.set(-5, 9, -6); sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = 0.03
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 8, bottom: -8 })
  scene.add(hemi, sun)
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: 0x1b222b, roughness: 0.55, metalness: 0.1 }))
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.72; ground.receiveShadow = true
  scene.add(ground)

  const loader = new GLTFLoader()
  const all: Variant[] = await (await fetch(`${MODELS}/index.json`)).json()
  const latest = Math.max(...all.map(v => v.round))
  const round = Number(new URLSearchParams(location.search).get('round')) || latest
  const variants = all.filter(v => v.round === round || (round > 1 && v.id === PICKED))
  if (round > 1) for (const v of variants) if (v.id === PICKED) v.name += ' (your pick)'
  document.querySelector('#title')!.textContent = round > 1 ? `Syn3h buggy: round ${round}, built on Wide body` : 'Syn3h buggy: five body variations'

  // Original wheels: tyre and rim ring, with the inner wing (the stator) inside.
  const parts = await loader.loadAsync('/models/buggy.glb')
  const bake = (name: string, material: THREE.Material, centre = true) => {
    const root = parts.scene.getObjectByName(name)!
    root.updateWorldMatrix(true, true)
    const group = new THREE.Group()
    root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld); g.computeVertexNormals()
      const m = new THREE.Mesh(g, material); m.castShadow = true; group.add(m)
    })
    if (centre) {
      const c = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3())
      group.children.forEach(m => (m as THREE.Mesh).geometry.translate(-c.x, -c.y, -c.z))
    }
    return group
  }
  const tyre = bake('Wheel_Template', new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.8 }))
  const stator = bake('Rim', new THREE.MeshStandardMaterial({ color: 0x9aa6b2, roughness: 0.2, metalness: 1 }))
  // The wing strut. Its narrow root is at the mesh origin and it spans along +Y.
  const strut = bake('Axle', new THREE.MeshStandardMaterial({ color: 0x59616c, roughness: 0.3, metalness: 0.55 }), false)
  const up = new THREE.Vector3(0, 1, 0)
  const wheelSet = () => {
    const g = new THREE.Group()
    WHEELS.forEach(([x, y, z], i) => {
      const w = new THREE.Group(); w.position.set(x, y, z)
      const t = tyre.clone(true); if (x < 0) t.rotation.y = Math.PI
      w.add(t, stator.clone(true)); g.add(w)
      // Same placement as LoadedBuggySkin.strutMatrix: span from the hub to the body mount,
      // thickness as near straight down as it can be, so the chord lies fore and aft.
      const hub = new THREE.Vector3(x, y, z), span = new THREE.Vector3(...MOUNTS[i]).sub(hub).normalize()
      const thick = up.clone().addScaledVector(span, -up.dot(span)).normalize().negate()
      const s = strut.clone(true)
      s.matrixAutoUpdate = false
      s.matrix.makeBasis(new THREE.Vector3().crossVectors(span, thick), span, thick).setPosition(hub)
      g.add(s)
    })
    return g
  }

  const bodyMats: THREE.MeshPhysicalMaterial[][] = [], accentMats: THREE.MeshPhysicalMaterial[][] = []
  const builtColours: [THREE.Color, THREE.Color][] = []
  const lightMats: THREE.MeshBasicMaterial[] = []
  const cars: THREE.Group[] = []
  for (const [i, v] of variants.entries()) {
    status.textContent = `Loading ${v.name}…`
    const gltf = await loader.loadAsync(`${MODELS}/${v.file}`)
    const car = new THREE.Group(); car.name = v.id
    bodyMats.push([]); accentMats.push([])
    const cache = new Map<THREE.Material, THREE.Material>()
    const convert = (src: THREE.MeshStandardMaterial): THREE.Material => {
      const n = src.name
      if (n === 'Headlights') { const m = new THREE.MeshBasicMaterial({ color: 0xf4f8ff, toneMapped: false }); lightMats.push(m); return m }
      if (n === 'TailLights') { const m = new THREE.MeshBasicMaterial({ color: 0xff1408, toneMapped: false }); lightMats.push(m); return m }
      if (n === 'Chrome') return new THREE.MeshPhysicalMaterial({ color: 0xdfe6ee, metalness: 1, roughness: 0.07 })
      if (n === 'Dark') return new THREE.MeshPhysicalMaterial({ color: 0x08090b, metalness: 0.3, roughness: 0.6 })
      if (n === 'Glass') {
        const clear = src.opacity < 1
        return new THREE.MeshPhysicalMaterial({ color: src.color, metalness: clear ? 0.1 : 0.85, roughness: 0.05, transparent: clear, opacity: clear ? src.opacity : 1, depthWrite: !clear, side: clear ? THREE.DoubleSide : THREE.FrontSide })
      }
      const m = new THREE.MeshPhysicalMaterial({ color: src.color, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 })
      ;(n === 'Accent' ? accentMats : bodyMats)[i].push(m)
      return m
    }
    gltf.scene.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      const src = o.material as THREE.MeshStandardMaterial
      if (!cache.has(src)) cache.set(src, convert(src))
      o.material = cache.get(src)!
      o.castShadow = true; o.receiveShadow = true
      if (src.name === 'Glass') o.renderOrder = 2
    })
    builtColours.push([bodyMats[i][0]?.color.clone() ?? new THREE.Color(), accentMats[i][0]?.color.clone() ?? new THREE.Color()])
    car.add(gltf.scene, wheelSet())
    scene.add(car); cars.push(car)
  }
  status.textContent = ''

  let current = 0, lineup = false
  const nameEl = document.querySelector('#name')!, notesEl = document.querySelector('#notes')!
  const variantButtons: HTMLButtonElement[] = []
  const lineupButton = document.querySelector<HTMLButtonElement>('#lineup')!
  const frame = (dir = new THREE.Vector3(3.2, 2.1, -4.6)) => {
    // The line-up reads best nearly head on: a three quarter view hides the far cars.
    if (lineup && Math.abs(dir.x) > 1 && Math.abs(dir.z) > 1) dir = new THREE.Vector3(Math.sign(dir.x) * 0.8, 2.4, Math.sign(dir.z) * 5)
    const centre = new THREE.Vector3(lineup ? 0 : cars[current].position.x, 0.1, 0)
    controls.target.copy(centre)
    camera.position.copy(centre).addScaledVector(dir.clone().normalize(), lineup ? 7.4 * cars.length / Math.min(1.6, Math.max(0.5, camera.aspect)) : (camera.aspect < 1 ? 11 : 8))
    controls.update()
  }
  const layout = () => {
    cars.forEach((c, i) => {
      c.visible = lineup || i === current
      c.position.x = lineup ? (i - (cars.length - 1) / 2) * -SPACING : 0
    })
    variantButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(!lineup && i === current)))
    lineupButton.setAttribute('aria-pressed', String(lineup))
    const v = variants[current]
    nameEl.textContent = lineup ? 'Side by side' : `${current + 1}. ${v.name}`
    notesEl.innerHTML = ''
    for (const n of lineup ? variants.map((x, i) => `${i + 1}. ${x.name} (left to right)`) : v.notes) { const li = document.createElement('li'); li.textContent = n; notesEl.append(li) }
  }
  const show = (i: number) => { current = i; lineup = false; layout(); frame() }
  variants.forEach((v, i) => {
    const b = document.createElement('button'); b.textContent = `${i + 1}. ${v.name}`; b.onclick = () => show(i)
    document.querySelector('#variants')!.append(b); variantButtons.push(b)
  })
  lineupButton.onclick = () => { lineup = !lineup; layout(); frame() }
  const VIEWS: [string, THREE.Vector3][] = [['Front', new THREE.Vector3(3.2, 2.1, -4.6)], ['Rear', new THREE.Vector3(-3.2, 2.2, 4.6)], ['Side', new THREE.Vector3(6, 0.9, 0)], ['Top', new THREE.Vector3(0.01, 7, 0.4)]]
  for (const [label, dir] of VIEWS) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => frame(dir); document.querySelector('#views')!.append(b) }
  const paint = (index: number) => {
    const [, body, accent] = PAINTS[index]
    cars.forEach((_, i) => {
      bodyMats[i].forEach(m => m.color.copy(body < 0 ? builtColours[i][0] : new THREE.Color(body)))
      accentMats[i].forEach(m => m.color.copy(accent === null ? builtColours[i][1] : new THREE.Color(accent)))
    })
  }
  PAINTS.forEach(([label, body], i) => {
    const b = document.createElement('button'); b.title = label
    if (body < 0) b.textContent = 'Paint'; else { b.className = 'swatch'; b.style.background = `#${body.toString(16).padStart(6, '0')}`; b.textContent = ' ' }
    b.onclick = () => paint(i); document.querySelector('#paints')!.append(b)
  })
  let dark = false
  const nightButton = document.querySelector<HTMLButtonElement>('#lights')!
  const setNight = (on: boolean) => {
    dark = on; nightButton.setAttribute('aria-pressed', String(on))
    ;(scene.background as THREE.Color).copy(on ? night : day)
    sun.intensity = on ? 0.15 : 3.2; hemi.intensity = on ? 0.12 : 1.2; scene.environmentIntensity = on ? 0.12 : 0.9
  }
  nightButton.onclick = () => setNight(!dark)

  layout(); frame()
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera) })
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) })
  // For scripted screenshots.
  Object.assign(window, { bodiesViewer: { ready: true, show, lineup(on = true) { lineup = on; layout(); frame() }, view(name: string) { frame(VIEWS.find(v => v[0] === name)![1]) }, look(p: number[], t: number[]) { camera.position.fromArray(p); controls.target.fromArray(t); controls.update() }, paint, setNight } })
}
main().catch(error => { document.querySelector('#status')!.textContent = String(error); console.error(error) })
