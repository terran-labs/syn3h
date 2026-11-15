/**
 * The vehicle lab (vehicle-lab.html): one studio page every vehicle lane uses to preview and
 * judge its models. The vehicle comes from ?vehicle=<id>, looked up in exhibits/index.ts; the
 * exhibit supplies designs and models through the LabExhibit interface (types.ts) and the lab
 * supplies everything else: studio and floors, camera and cockpit view, lamps, detail levels,
 * stats and stress copies, paint, motion and the capture parameters and API.
 *
 * Developer tool only: the production build has a single entry (index.html), so none of this
 * ships in the game. See docs/vehicle-lab.md for every control, parameter and API call.
 */
import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { exhibits } from './exhibits'
import {
  countStats, filterDesigns, FLOOR_NAMES, groupsOf, parseLabParams, pickAutoLod, resolveDesign, resolveLod,
  RollingAverage, STRESS_COUNTS, stressGrid, VIEW_NAMES, type ViewName,
} from './logic'
import { Studio } from './studio'
import type { LabControl, LabDesignInfo, LabModel, LabState, LabStats } from './types'

const params = parseLabParams(location.search)
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

/**
 * View presets as directions from the vehicle, in the stage frame (nose toward -Z). Front and
 * Rear are three quarter views, which read a car's shape better than straight on.
 */
const VIEWS: Record<ViewName, THREE.Vector3> = {
  Front: new THREE.Vector3(.55, .32, -.77),
  Rear: new THREE.Vector3(-.55, .34, .77),
  Side: new THREE.Vector3(1, .14, 0),
  Top: new THREE.Vector3(.001, 1, .08),
  Low: new THREE.Vector3(.62, .045, -.78),
}

/** Paint swatches: [label, body, accent]. Own colours restores what each design was built with. */
const PAINTS: [string, number, number][] = [
  ['Navy', 0x0b1560, 0x101014], ['Blue', 0x1553c8, 0xd01818], ['Red', 0xb3140f, 0x101014], ['Orange', 0xd4560f, 0x15171a],
  ['Violet', 0x45209a, 0x49e6ff], ['Green', 0x08783f, 0x15171a], ['Graphite', 0x2a2d33, 0xff7a14], ['White', 0xe8ecf0, 0x1553c8], ['Black', 0x0c0d10, 0xff7a14],
]

/** One design on the stage. `root` places it; the model's own object hangs inside, lifted onto the floor. */
interface Entry {
  info: LabDesignInfo
  root: THREE.Group
  model?: LabModel
  building?: Promise<LabModel>
  /** Bounding box size and centre in the root's frame, measured once when built. */
  size: THREE.Vector3
  centre: THREE.Vector3
  /** Detail level currently shown. */
  level: number
  stats: LabStats
}

/** Bounds of the visible meshes only: hidden detail levels and idle effects do not count. */
function visibleBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3(), part = new THREE.Box3()
  root.updateWorldMatrix(true, true)
  root.traverseVisible(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).computeBoundingBox()
    else mesh.geometry.computeBoundingBox()
    const local = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).boundingBox! : mesh.geometry.boundingBox!
    box.union(part.copy(local).applyMatrix4(mesh.matrixWorld))
  })
  // Into the root's parent frame, where the lab places it.
  if (root.parent) box.applyMatrix4(root.parent.matrixWorld.clone().invert())
  return box
}

async function main(): Promise<void> {
  const status = $('status')
  const exhibit = exhibits[params.vehicle]
  if (!exhibit) {
    status.textContent = `No vehicle "${params.vehicle}". Try: ${Object.keys(exhibits).join(', ')}`
    return
  }
  document.body.classList.toggle('still', params.still)
  document.title = `${exhibit.title}: vehicle lab`

  // ?webgl=1 forces three's WebGL 2 backend, as the game does (src/core/Game.ts).
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.webgl })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  renderer.shadowMap.enabled = true
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  document.body.prepend(renderer.domElement)
  await renderer.init()

  const scene = new THREE.Scene()
  // Stills get a full resolution mirror; interactive use keeps it at half for speed.
  const studio = new Studio(scene, renderer, { reflectionScale: params.still ? 1 : .5 })
  const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, .1, 300)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  const orbitLimits = () => {
    controls.minDistance = 1.5; controls.maxDistance = 150
    controls.maxPolarAngle = Math.PI / 2 - .02; controls.minPolarAngle = 0
    controls.enableZoom = controls.enablePan = true
    controls.rotateSpeed = 1
    camera.near = .1; camera.updateProjectionMatrix()
  }
  orbitLimits()

  /** The turntable spins this; every design and stress copy hangs from it. */
  const stage = new THREE.Group()
  const copies = new THREE.Group()
  copies.name = 'Stress copies'
  stage.add(copies)
  scene.add(stage)

  // Designs and groups.
  const allDesigns = await exhibit.designs()
  const { group, designs } = filterDesigns(allDesigns, params.group)
  const groups = groupsOf(allDesigns)
  $('title').textContent = exhibit.heading?.(group) ?? exhibit.title
  const entries: Entry[] = designs.map(info => ({ info, root: new THREE.Group(), size: new THREE.Vector3(1, 1, 1), centre: new THREE.Vector3(), level: 0, stats: { triangles: 0, drawCalls: 0 } }))
  for (const e of entries) { e.root.name = e.info.id; e.root.visible = false; stage.add(e.root) }
  const ctx = { status: (text: string) => { status.textContent = text } }

  const ensure = (e: Entry): Promise<LabModel> => {
    e.building ??= exhibit.build(e.info, ctx).then(model => {
      e.model = model
      e.root.add(model.object)
      // Lift the vehicle so its ground contact sits on the floor (y = 0).
      model.object.position.y -= model.groundY
      const box = visibleBounds(model.object)
      box.getSize(e.size); box.getCenter(e.centre)
      if (paint) model.setColors?.(paint[0], paint[1])
      if (model.lods?.length) { e.level = lodChoice >= 0 ? Math.min(lodChoice, model.lods.length - 1) : 0; model.setLod?.(e.level) }
      return model
    })
    return e.building
  }

  // Lab state. `state` is what models see each frame.
  const state: LabState = { time: 0, night: false, headlights: false, braking: params.brake, throttle: 0, steer: 0, animate: params.motion ?? false }
  let current = Math.max(0, resolveDesign(params.design, designs, Math.max(0, designs.findIndex(d => d.id === exhibit.defaultDesign?.(group)))))
  let side = params.design === 'all'
  let lodChoice = -1
  let turntable = false
  let stress = 1
  let paint: [number, number] | null = params.color ? [params.color.body, params.color.accent ?? 0x15171a] : null
  let currentView: ViewName = params.view ?? 'Front'
  const visible = () => side ? entries : [entries[current]]

  // Interface. Buttons are created once; `refresh` sets their pressed state and labels.
  const bar = $('bar')
  const panels = new Map<string, HTMLElement>()
  const tabs = $('tabs')
  const panel = (name: string) => {
    let p = panels.get(name)
    if (!p) {
      p = document.createElement('div'); p.className = 'panel'; p.dataset.name = name; bar.append(p); panels.set(name, p)
      const tab = button(name, () => openPanel(name), tabs); tab.dataset.tab = name
    }
    return p
  }
  const openPanel = (name: string) => {
    for (const [n, p] of panels) p.classList.toggle('open', n === name)
    for (const t of tabs.querySelectorAll<HTMLButtonElement>('button')) t.setAttribute('aria-pressed', String(t.dataset.tab === name))
  }
  function button(label: string, onClick: () => void, parent: HTMLElement): HTMLButtonElement {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = onClick; parent.append(b); return b
  }
  const press = (b: HTMLButtonElement, on: boolean) => b.setAttribute('aria-pressed', String(on))

  const designButtons = designs.length > 1 ? designs.map((d, i) => button(`${i + 1}. ${d.name}`, () => show(i), panel('Designs'))) : []
  const sideButton = designs.length > 1 ? button('Side by side', () => setSide(!side), panel('Designs')) : null
  if (groups.length > 1) {
    const label = exhibit.groupLabel ?? 'Group'
    for (const g of groups) {
      const b = button(`${label} ${g}`, () => { const q = new URLSearchParams(location.search); q.set('group', g); q.delete('design'); location.search = q.toString() }, panel('Designs'))
      press(b, g === group)
    }
  }
  const viewButtons = VIEW_NAMES.map(name => button(name, () => api.view(name), panel('Camera')))
  const turnButton = button('Turntable', () => { turntable = !turntable; refresh() }, panel('Camera'))
  const cockpitButton = button('Cockpit', () => void setCockpit(!cockpit.on), panel('Camera'))
  const nightButton = button('Night', () => api.setNight(!state.night), panel('Lights'))
  const headButton = button('Headlights', () => api.setHeadlights(!state.headlights), panel('Lights'))
  const brakeButton = button('Brake', () => api.setBraking(!state.braking), panel('Lights'))
  const floorButton = button('Floor', () => api.setFloor(FLOOR_NAMES[(FLOOR_NAMES.indexOf(studio.floor) + 1) % FLOOR_NAMES.length]), panel('Lights'))
  const motionButton = button('Motion', () => { state.animate = !state.animate; refresh() }, panel('Motion'))
  const detailButton = button('Detail', () => {
    const levels = entries[current].model?.lods ?? []
    void api.setLod(lodChoice + 1 >= levels.length ? -1 : lodChoice + 1)
  }, panel('Motion'))
  const stressButton = button('×1', () => void api.stress(STRESS_COUNTS[(STRESS_COUNTS.indexOf(stress) + 1) % STRESS_COUNTS.length]), panel('Motion'))
  stressButton.title = 'Copies of this design on a grid, to judge many on screen at once'
  const controlsBox = document.createElement('span'); controlsBox.style.display = 'contents'; panel('Motion').append(controlsBox)
  const ownButton = button('Own colours', () => { paint = null; for (const e of entries) e.model?.resetColors?.(); refresh() }, panel('Paint'))
  const swatchButtons = PAINTS.map(([label, body, accent]) => {
    const b = button('', () => api.paint(body, accent), panel('Paint'))
    b.className = 'swatch'; b.title = label; b.setAttribute('aria-label', label); b.style.background = `#${body.toString(16).padStart(6, '0')}`
    return b
  })
  const picker = document.createElement('label'); picker.className = 'picker'; picker.textContent = 'Pick '
  const pickerInput = document.createElement('input'); pickerInput.type = 'color'; pickerInput.value = '#1553c8'
  pickerInput.oninput = () => api.paint(parseInt(pickerInput.value.slice(1), 16), paint?.[1] ?? 0x15171a)
  picker.append(pickerInput); panel('Paint').append(picker)
  openPanel(panels.has('Designs') ? 'Designs' : 'Camera')
  // Phones put the notes card just above the bar, whose height depends on the open panel.
  new ResizeObserver(() => { document.body.style.setProperty('--bar', `${bar.offsetHeight}px`); viewport() }).observe(bar)

  /** Exhibit controls for the current model. A change applies to every built model with that control id. */
  let shownControls: LabControl[] | undefined
  const renderControls = () => {
    const list = entries[current].model?.controls
    if (list === shownControls) return
    shownControls = list
    controlsBox.replaceChildren()
    for (const c of list ?? []) {
      const all = () => entries.flatMap(e => e.model?.controls?.filter(x => x.id === c.id) ?? [])
      if (c.kind === 'toggle') {
        const b = button(c.label, () => { const v = !c.value; for (const x of all()) if (x.kind === 'toggle') { x.value = v; x.onChange(v) } press(b, v) }, controlsBox)
        press(b, c.value)
      } else if (c.kind === 'cycle') {
        const label = () => `${c.label}: ${c.options[c.index]}`
        const b = button(label(), () => { const i = (c.index + 1) % c.options.length; for (const x of all()) if (x.kind === 'cycle') { x.index = i; x.onChange(i) } b.textContent = label() }, controlsBox)
      } else {
        const l = document.createElement('label'); l.className = 'slider'; l.textContent = `${c.label} `
        const input = document.createElement('input'); input.type = 'range'
        Object.assign(input, { min: String(c.min), max: String(c.max), step: String(c.step), value: String(c.value) })
        input.oninput = () => { const v = Number(input.value); for (const x of all()) if (x.kind === 'slider') { x.value = v; x.onChange(v) } }
        l.append(input); controlsBox.append(l)
      }
    }
  }

  const refresh = () => {
    designButtons.forEach((b, i) => press(b, !side && stress === 1 && i === current))
    if (sideButton) press(sideButton, side)
    viewButtons.forEach((b, i) => press(b, !cockpit.on && VIEW_NAMES[i] === currentView))
    press(turnButton, turntable)
    const e = entries[current]
    cockpitButton.hidden = side || stress > 1 || !e.model?.cockpit
    press(cockpitButton, cockpit.on)
    press(nightButton, state.night); press(headButton, state.headlights); press(brakeButton, state.braking)
    floorButton.textContent = `Floor: ${studio.floor}`
    press(motionButton, state.animate)
    const levels = e.model?.lods ?? []
    detailButton.hidden = levels.length < 2
    detailButton.textContent = `Detail: ${lodChoice < 0 ? `Auto (${levels[e.level] ?? ''})` : levels[lodChoice]}`
    stressButton.textContent = `×${stress}`
    press(stressButton, stress > 1)
    press(ownButton, !paint)
    swatchButtons.forEach((b, i) => press(b, !!paint && PAINTS[i][1] === paint[0]))
    renderControls()
    writeCard()
  }

  // The notes card. Stats are rewritten a few times a second from the frame loop.
  $('card').onclick = () => $('card').classList.toggle('expanded')
  const nameEl = $('name'), groupEl = $('group'), notesEl = $('notes'), statsEl = $('stats')
  const frameTime = new RollingAverage(60), cpuTime = new RollingAverage(60)
  const total: LabStats = { triangles: 0, drawCalls: 0 }
  const n = (x: number) => x.toLocaleString('en-GB')
  let cardKey = ''
  function writeCard() {
    const e = entries[current]
    const key = `${side}|${current}|${stress}`
    if (key !== cardKey) {
      cardKey = key
      nameEl.textContent = stress > 1 ? `${e.info.name} ×${stress}` : side ? 'Side by side' : `${designs.length > 1 ? `${current + 1}. ` : ''}${e.info.name}`
      groupEl.textContent = group === undefined ? '' : `${exhibit!.groupLabel ?? 'Group'} ${group}${e.info.group !== group && !side ? ` (from ${exhibit!.groupLabel ?? 'group'} ${e.info.group})` : ''}`
      const lines = side ? entries.map((x, i) => `${i + 1}. ${x.info.name}`) : e.info.notes
      notesEl.replaceChildren(...lines.map(t => { const li = document.createElement('li'); li.textContent = t; return li }))
    }
    writeStats()
  }
  function writeStats() {
    const e = entries[current]
    const levels = e.model?.lods
    const lines: string[] = []
    if (stress > 1) {
      countStats(stage, total)
      lines.push(`${n(total.triangles)} triangles, ${n(total.drawCalls)} draws for ${stress} copies`)
      lines.push(`Frame ${frameTime.average.toFixed(1)} ms, render call ${cpuTime.average.toFixed(1)} ms (average of 60)`)
      lines.push('Rough local measurement on this machine; frame time is capped by the display rate.')
    } else if (side) {
      total.triangles = total.drawCalls = 0
      entries.forEach((x, i) => { total.triangles += x.stats.triangles; total.drawCalls += x.stats.drawCalls; lines.push(`${i + 1}. ${n(x.stats.triangles)} triangles, ${x.stats.drawCalls} draws`) })
      lines.push(`All: ${n(total.triangles)} triangles, ${n(total.drawCalls)} draws`)
    } else {
      lines.push(`${levels?.length ? `${levels[e.level]}: ` : ''}${n(e.stats.triangles)} triangles, ${e.stats.drawCalls} draws`)
    }
    const text = lines.join('\n')
    if (statsEl.textContent !== text) statsEl.textContent = text
  }

  // Camera.
  const scratch = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), dir: new THREE.Vector3(), q: new THREE.Quaternion(), box: new THREE.Box3() }
  /**
   * The bar covers the bottom of the screen, so the projection centre moves up to the middle of
   * the free area: render a window of a virtual image that is `covered` pixels taller. Stills
   * have no bar.
   */
  let covered = 0
  function viewport() {
    // The cockpit view stays centred: the driver looks straight ahead, not over the bar.
    covered = params.still || cockpit.on ? 0 : Math.min(bar.offsetHeight, innerHeight * .45)
    camera.aspect = innerWidth / innerHeight
    if (covered) camera.setViewOffset(innerWidth, innerHeight + covered, 0, covered, innerWidth, innerHeight)
    else camera.clearViewOffset()
    camera.updateProjectionMatrix()
  }
  /** Distance at which a sphere of this radius fills the narrower side of the free area. */
  const fitDistance = (radius: number) => {
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const full = innerHeight + covered
    const vertical = tan * (innerHeight - covered) / full, horizontal = tan * innerWidth / full
    return radius / Math.sin(Math.atan(Math.min(vertical, horizontal))) * .95
  }
  /** Centre and radius of what is on stage, in world space. */
  const stageBounds = (centre: THREE.Vector3) => {
    const box = scratch.box.makeEmpty()
    for (const e of visible()) {
      const half = scratch.a.copy(e.size).multiplyScalar(.5)
      const c = scratch.b.copy(e.centre).add(e.root.position)
      box.expandByPoint(scratch.c.copy(c).sub(half)).expandByPoint(scratch.c.copy(c).add(half))
    }
    if (stress > 1) for (const c of copies.children) box.expandByPoint(c.position)
    box.getCenter(centre)
    return box.getSize(scratch.a).length() / 2
  }
  function frame(dir = VIEWS[currentView], distance?: number) {
    stage.rotation.y = 0
    // A line of designs reads best nearly head on: a three quarter view hides the far ones.
    dir = scratch.dir.copy(dir)
    if (side && stress === 1 && Math.abs(dir.x) > .2 && Math.abs(dir.z) > .2) dir.set(Math.sign(dir.x) * .16, .42, Math.sign(dir.z))
    // A grid of copies reads best from higher up.
    if (stress > 1 && dir.y < .5) dir.y = .75
    dir.normalize()
    const centre = new THREE.Vector3()
    const radius = stageBounds(centre)
    const d = distance ?? fitDistance(radius)
    controls.target.copy(centre)
    camera.position.copy(centre).addScaledVector(dir, d)
    studio.fitFog(d)
    controls.update()
  }
  /** Azimuth from the nose toward +X, elevation above the floor, both in degrees. */
  const direction = (az: number, el: number) => {
    const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el)
    return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e))
  }

  /**
   * Cockpit view: eases the camera to the driver's eye, looking forward, and back to where it
   * was. Inside, the orbit pivots on a point 1 cm ahead of the camera, so dragging turns the head
   * without leaving the seat, and the drag direction is reversed to feel like grabbing the world.
   */
  const cockpit = {
    on: false, t: 1, duration: .7,
    fromPos: new THREE.Vector3(), fromTarget: new THREE.Vector3(),
    savedPos: new THREE.Vector3(), savedTarget: new THREE.Vector3(), savedTurntable: false,
    hidden: [] as THREE.Object3D[], done: null as null | (() => void),
  }
  const eyeWorld = (out: THREE.Vector3) => {
    const m = entries[current].model!
    return m.object.localToWorld(out.copy(m.cockpit!.eye))
  }
  const lookWorld = (out: THREE.Vector3) => {
    const m = entries[current].model!
    m.object.getWorldQuaternion(scratch.q)
    // Forward and a little down, so the nose shows as a driver sees it.
    return eyeWorld(out).add(scratch.c.set(0, -.0015, -.01).applyQuaternion(scratch.q))
  }
  function setCockpit(on: boolean): Promise<void> {
    const model = entries[current].model
    if (on === cockpit.on || (on && (!model?.cockpit || side || stress > 1))) return Promise.resolve()
    cockpit.on = on
    document.body.classList.toggle('inside', on)
    viewport()
    cockpit.fromPos.copy(camera.position); cockpit.fromTarget.copy(controls.target)
    cockpit.t = 0
    controls.enabled = false
    if (on) {
      cockpit.savedPos.copy(camera.position); cockpit.savedTarget.copy(controls.target)
      cockpit.savedTurntable = turntable
      turntable = false
      stage.rotation.y = 0
    } else {
      for (const o of cockpit.hidden) o.visible = true
      cockpit.hidden = []
      orbitLimits()
      turntable = cockpit.savedTurntable
    }
    refresh()
    return new Promise(resolve => { cockpit.done = resolve })
  }
  function stepCockpit(dt: number) {
    if (cockpit.t >= 1) return
    cockpit.t = Math.min(1, cockpit.t + dt / cockpit.duration)
    const k = THREE.MathUtils.smootherstep(cockpit.t, 0, 1)
    const toPos = cockpit.on ? eyeWorld(scratch.a) : cockpit.savedPos
    const toTarget = cockpit.on ? lookWorld(scratch.b) : cockpit.savedTarget
    camera.position.lerpVectors(cockpit.fromPos, toPos, k)
    controls.target.lerpVectors(cockpit.fromTarget, toTarget, k)
    camera.lookAt(controls.target)
    // Hide the canopy once the camera is nearly through it.
    if (cockpit.on && k > .7 && !cockpit.hidden.length) {
      for (const o of entries[current].model?.cockpit?.hide ?? []) if (o.visible) { o.visible = false; cockpit.hidden.push(o) }
    }
    if (cockpit.t >= 1) {
      if (cockpit.on) {
        controls.minDistance = 0; controls.maxDistance = .02
        controls.minPolarAngle = .05; controls.maxPolarAngle = Math.PI - .05
        controls.enableZoom = controls.enablePan = false
        controls.rotateSpeed = -.35
        camera.near = .02; camera.updateProjectionMatrix()
      }
      controls.enabled = true
      controls.update()
      cockpit.done?.(); cockpit.done = null
    }
  }

  // Layout: one design, side by side, or stress copies of one design.
  function layout() {
    copies.clear()
    const e = entries[current]
    const spacing = Math.max(...visible().map(x => x.size.x)) + 1.4
    entries.forEach((x, i) => {
      x.root.visible = side ? true : i === current
      x.root.position.set(side ? (i - (entries.length - 1) / 2) * -spacing : 0, 0, 0)
    })
    if (stress > 1 && e.model) {
      const slots = stressGrid(stress, e.size.x + 1.2, e.size.z + 1.2)
      e.root.position.set(slots[0][0], 0, slots[0][1])
      for (let i = 1; i < slots.length; i++) {
        const copy = e.root.clone(true)
        // Copies share geometry and materials with the original but carry no lights: forty
        // pairs of beams would measure the light count, not the vehicle.
        const lights: THREE.Object3D[] = []
        copy.traverse(o => { if ((o as THREE.Light).isLight) lights.push(o) })
        for (const l of lights) l.removeFromParent()
        copy.position.set(slots[i][0], 0, slots[i][1])
        copies.add(copy)
      }
    }
    studio.fitShadow(stress > 1 ? Math.sqrt(stress) * (e.size.z + 1.2) : side ? entries.length * spacing / 2 + 2 : Math.max(e.size.x, e.size.z) + 2)
    frameTime.reset(); cpuTime.reset()
  }

  async function show(i: number) {
    if (cockpit.on) await setCockpit(false)
    current = THREE.MathUtils.clamp(i, 0, entries.length - 1)
    side = false
    await ensure(entries[current])
    status.textContent = ''
    layout(); frame(); refresh()
  }
  async function setSide(on: boolean) {
    if (cockpit.on) await setCockpit(false)
    side = on
    if (on) { stress = 1; for (const e of entries) await ensure(e) }
    status.textContent = ''
    layout(); frame(); refresh()
  }

  /** Applies the Detail choice to every built model; Auto picks per model from camera distance. */
  function applyLod(force = false) {
    let changed = false
    for (const e of entries) {
      const m = e.model
      if (!m?.lods || m.lods.length < 2 || !e.root.visible) continue
      let level = lodChoice
      if (level < 0) level = pickAutoLod(camera.position.distanceTo(e.root.getWorldPosition(scratch.a)), m.lods.length, m.lodDistances)
      level = Math.min(level, m.lods.length - 1)
      if (level !== e.level || force) { e.level = level; m.setLod?.(level); changed = true }
    }
    // Stress copies are clones made at one level; remake them when the level changes.
    if (changed && stress > 1) layout()
    if (changed) refresh()
  }

  // The scripted capture API. Everything the buttons do, plus stats and a frame wait.
  let frames = 0
  const waiters: { frame: number; resolve: () => void }[] = []
  const api = {
    ready: false,
    exhibit: exhibit.id,
    designs: designs.map(d => d.id),
    show,
    sideBySide: setSide,
    view(name: ViewName) { if (cockpit.on) void setCockpit(false); currentView = name; frame(VIEWS[name]); refresh() },
    /** Camera by azimuth and elevation (degrees) and distance (metres, default fits the stage). */
    orbit(az: number, el: number, dist?: number) { frame(direction(az, el), dist); refresh() },
    look(position: number[], target: number[]) { camera.position.fromArray(position); controls.target.fromArray(target); controls.update() },
    setNight(on: boolean) { studio.setNight(on); state.night = on; state.headlights = on; refresh() },
    setHeadlights(on: boolean) { state.headlights = on; refresh() },
    setBraking(on: boolean) { state.braking = on; refresh() },
    setMotion(on: boolean) { state.animate = on; refresh() },
    setFloor(name: (typeof FLOOR_NAMES)[number]) { studio.setFloor(name); refresh() },
    setTurntable(on: boolean) { turntable = on; refresh() },
    /** -1 for Auto, else a level index. */
    async setLod(index: number) { lodChoice = index; applyLod(true) },
    paint(body: number, accent: number) { paint = [body, accent]; for (const e of entries) e.model?.setColors?.(body, accent); refresh() },
    cockpit: setCockpit,
    async stress(count: number) {
      if (cockpit.on) await setCockpit(false)
      stress = STRESS_COUNTS.includes(count) ? count : 1
      if (stress > 1) side = false
      await ensure(entries[current])
      layout(); frame(); refresh()
    },
    stats() {
      const e = entries[current]
      if (stress > 1) countStats(stage, total)
      return {
        design: side ? 'all' : e.info.id, detail: e.model?.lods?.[e.level] ?? null, detailChoice: lodChoice < 0 ? 'Auto' : e.model?.lods?.[lodChoice],
        triangles: e.stats.triangles, drawCalls: e.stats.drawCalls,
        designs: entries.map(x => ({ id: x.info.id, ...x.stats })),
        stress, stressTriangles: stress > 1 ? total.triangles : e.stats.triangles, stressDrawCalls: stress > 1 ? total.drawCalls : e.stats.drawCalls,
        frameMs: frameTime.average, renderCallMs: cpuTime.average, backend: (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl',
      }
    },
    /** Resolves after `count` more frames have rendered. */
    frames(count = 3) { return new Promise<void>(resolve => waiters.push({ frame: frames + count, resolve })) },
    camera, controls, scene,
  }
  Object.assign(window, { vehicleLab: api })

  // First design, then the URL's initial state.
  viewport()
  await (side ? setSide(true) : show(current))
  if (params.night) api.setNight(true)
  if (params.headlights !== undefined) api.setHeadlights(params.headlights)
  if (params.floor) api.setFloor(params.floor)
  if (params.lod !== undefined) await api.setLod(resolveLod(params.lod, entries[current].model?.lods ?? []))
  if (params.stress && params.stress > 1) await api.stress(params.stress)
  if (params.az !== undefined || params.el !== undefined || params.dist !== undefined) api.orbit(params.az ?? 36, params.el ?? 16, params.dist)
  else if (params.view) api.view(params.view)
  // Not awaited: the move eases over frames, and the render loop has not started yet.
  if (params.cockpit) void setCockpit(true)
  if (params.still) state.animate = false
  refresh()

  // Frame loop. Nothing in here allocates: scratch vectors, a fixed ring for timings.
  const timer = new THREE.Timer()
  let last = performance.now(), statFrame = 0
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    frameTime.push(now - last); last = now
    timer.update()
    const dt = Math.min(timer.getDelta(), .05)
    if (state.animate) {
      state.time += dt
      state.throttle = .55 + .45 * Math.sin(state.time * .45)
      state.steer = .8 * Math.sin(state.time * .7)
    } else { state.throttle = 0; state.steer = 0 }
    if (turntable && !cockpit.on && !params.still) stage.rotation.y += dt * .35
    for (const e of entries) if (e.model && e.root.visible) e.model.update?.(dt, state)
    stepCockpit(dt)
    if (controls.enabled) controls.update()
    if (lodChoice < 0) applyLod()
    // Per model stats are cheap tree walks; a few times a second is plenty for a readout.
    if (++statFrame % 15 === 1) { for (const e of entries) if (e.model) countStats(e.model.object, e.stats); writeStats() }
    const t0 = performance.now()
    renderer.render(scene, camera)
    cpuTime.push(performance.now() - t0)
    frames++
    if (frames > 3) api.ready = true
    for (let i = waiters.length - 1; i >= 0; i--) if (frames >= waiters[i].frame) { waiters[i].resolve(); waiters.splice(i, 1) }
  })
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); viewport() })
  addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null)
    copies.clear()
    for (const e of entries) { e.model?.object.removeFromParent(); e.model?.dispose?.() }
    studio.dispose(); controls.dispose(); renderer.dispose()
  }, { once: true })
}

main().catch(error => { $('status').textContent = String(error); console.error(error) })
