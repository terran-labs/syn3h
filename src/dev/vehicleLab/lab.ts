/**
 * The vehicle lab (vehicle-lab.html): one studio page for previewing and judging every vehicle.
 *
 * A sidebar lists every exhibit (registry.ts finds them in exhibits/: the design studies and
 * every vehicle the game can build), with its groups and designs. Selecting a design shows it;
 * Compare shows a group side by side. Under the tree, the Options tree holds everything the lab
 * can do to the selection: view, lights, detail levels and stats, stress copies, paint, motion,
 * the exhibit's own controls and the game parameters that belong to the vehicle.
 *
 * Switching vehicle does not reload the page: the old models are disposed, the new ones built,
 * and the URL is rewritten so a link reproduces the view.
 *
 * Developer tool only: the production build has a single entry (index.html), so none of this
 * ships in the game. See docs/vehicle-lab.md for every control, parameter and API call.
 */
import * as THREE from 'three/webgpu'
import { Engine, type MotionAudio } from '../../audio/Engine'
import { SURFACES, synthImpact, type ImpactKind } from '../../audio/Impacts'
import { classifyDevice, SHADING_CAP, vehicleShading } from '../../core/quality'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { params as gameParams, type ParamDef } from '../../../shared/params'
import { countStats, FLOOR_NAMES, motorKind, parseLabParams, pickAutoLod, resolveLod, RollingAverage, STRESS_COUNTS, stressGrid, VIEW_NAMES, visibleBounds, type FloorName, type ViewName } from './logic'
import { exhibits, failures } from './registry'
import { Studio } from './studio'
import { buildTree, resolveSelection, selectionFromSearch, selectionToSearch, vehicleParams, type ListedExhibit, type Selection, type TreeSection, type Wanted } from './tree'
import type { LabControl, LabDesignInfo, LabExhibit, LabModel, LabState, LabStats } from './types'
import * as ui from './ui'

const params = parseLabParams(location.search)
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

/** What tools/lab-live.mjs writes to labs/live-status.json each time it rebuilds the live lab. */
interface LiveStatus { updated: string; trunk: string; branches: { name: string; head: string; subject: string; when: string; merged: boolean; error?: string }[] }

/**
 * Sidebar footer: where this lab's contents come from. On the live lab that is every vehicle
 * branch's latest commit; a branch that could not be merged and an exhibit file that failed to
 * load are named here, so a missing vehicle is explained instead of silently absent.
 */
async function showSources(): Promise<void> {
  const box = document.createElement('div')
  box.id = 'sources'
  box.style.cssText = 'margin:16px 12px 20px;padding:10px 12px;border:1px solid #263142;border-radius:8px;font-size:12px;line-height:1.5;color:#9fb0c3'
  const line = (text: string, color?: string) => { const d = document.createElement('div'); d.textContent = text; if (color) d.style.color = color; box.append(d) }
  let live: LiveStatus | null = null
  try {
    const res = await fetch('/labs/live-status.json', { cache: 'no-store' })
    if (res.ok && /json/.test(res.headers.get('content-type') ?? '')) live = await res.json() as LiveStatus
  } catch { live = null }
  if (live) {
    const title = document.createElement('div'); title.textContent = 'Live: every vehicle branch, latest commit'; title.style.cssText = 'color:#e6edf5;font-weight:600;margin-bottom:4px'; box.append(title)
    for (const b of live.branches) line(`${b.merged ? '●' : '✕'} ${b.name.replace(/^veh\//, '')}: ${b.subject.slice(0, 46)} (${b.when})${b.merged ? '' : ' — not shown: ' + (b.error ?? 'did not merge')}`, b.merged ? undefined : '#ffb37a')
    line(`Rebuilt ${new Date(live.updated).toLocaleTimeString()}`)
  } else line('Showing this checkout only (not the live lab).')
  for (const f of failures) line(`✕ ${f.file} failed to load: ${f.error.slice(0, 120)}`, '#ffb37a')
  $('side-scroll').append(box)
}

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
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

/** Narrow or portrait screens get a bottom sheet instead of the sidebar. Keep in step with the CSS. */
const SHEET = matchMedia('(max-width: 699px), (orientation: portrait) and (max-width: 1100px)')

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

/** What is loaded: one exhibit's group of designs. Replaced whole when the vehicle or group changes. */
interface Session { exhibit: LabExhibit; group?: string; designs: LabDesignInfo[]; entries: Entry[]; dead: boolean }

async function main(): Promise<void> {
  const status = $('status')
  document.body.classList.toggle('still', params.still)

  // ?webgl=1 forces three's WebGL 2 backend, as the game does (src/core/Game.ts).
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.webgl })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  renderer.shadowMap.enabled = true
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  $('view').append(renderer.domElement)
  await renderer.init()
  // The standalone studio has no game QualityController. Start at the same device cap,
  // while retaining the shading slider so reviewers can inspect every quality tier.
  const nav = navigator as Navigator & { deviceMemory?: number }
  const deviceLevel = classifyDevice({ userAgent: nav.userAgent, touchPoints: nav.maxTouchPoints, memoryGB: nav.deviceMemory })
  gameParams.set(vehicleShading.def.id, SHADING_CAP[deviceLevel])

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

  // Every exhibit's designs, for the tree. One failing exhibit is listed with its error.
  status.textContent = 'Listing vehicles…'
  void showSources()
  const listed: ListedExhibit[] = await Promise.all(exhibits.map(async exhibit => {
    try { return { exhibit, designs: await exhibit.designs() } } catch (error) { console.error(error); return { exhibit, designs: [], error: String(error) } }
  }))
  const tree: TreeSection[] = buildTree(listed)
  const ctx = { status: (text: string) => { status.textContent = text }, renderer, camera }

  // Lab state. `state` is what models see each frame.
  const state: LabState = { time: 0, night: false, headlights: false, braking: params.brake, throttle: 0, steer: 0, animate: params.motion ?? false }
  let session: Session | null = null
  // Motor sound: the game's own engine voice (src/audio/Engine.ts) for the vehicle on show, so
  // each vehicle's motor can be judged here without driving it. `revs` is 0 at idle, 1 flat out.
  // It plays the motor alone, as if the wheels were off the ground: no ground rumble, no tyre squeal.
  let sound: { context: AudioContext; out: GainNode } | null = null
  let motor: { engine: Engine } | null = null
  let revs = .5, force = .6, bumps = 0
  const motorMotion: MotionAudio = { speed: 0, throttle: 0, airborne: true, clearance: 2, wings: false }
  /** The lab's audio output, made on the first click that needs it (browsers allow audio only after a gesture). */
  function speaker() {
    if (!sound) {
      const context = new AudioContext(), out = context.createGain()
      // The game runs these sounds quietly under music and effects. Alone in the lab they need lifting.
      out.gain.value = 2.5; out.connect(context.destination)
      sound = { context, out }
    }
    void sound.context.resume()
    return sound
  }
  /** The game vehicle whose voice and hull the exhibit on show uses. */
  const hullKind = () => motorKind(session?.exhibit.family ?? session?.exhibit.id ?? '')
  function setMotor(on: boolean): void {
    if (on && !motor) motor = { engine: new Engine(speaker().context, speaker().out) }
    else if (!on && motor) { motor.engine.dispose(true); motor = null }
  }
  /** Bump sounds (src/audio/Impacts.ts): this vehicle running into another vehicle or into a kind of ground. */
  function bump(kind: ImpactKind): void {
    const { context, out } = speaker()
    synthImpact(context, out, { kind, strength: force, hull: hullKind(), seed: ++bumps })
  }
  let selection: Selection | null = null
  let entries: Entry[] = []
  let current = 0
  let side = false
  let lodChoice = -1
  let turntable = false
  let stress = 1
  let paint: [number, number] | null = params.color ? [params.color.body, params.color.accent ?? 0x15171a] : null
  let currentView: ViewName = params.view ?? 'Front'
  const visible = () => side ? entries : entries[current] ? [entries[current]] : []

  const ensure = (s: Session, e: Entry): Promise<LabModel> => {
    e.building ??= s.exhibit.build(e.info, ctx).then(model => {
      // Built after the vehicle was switched away: nobody wants it.
      if (s.dead) { model.dispose?.(); return model }
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

  function teardown() {
    if (!session) return
    session.dead = true
    copies.clear()
    for (const e of session.entries) {
      e.root.removeFromParent()
      e.model?.object.removeFromParent()
      e.model?.dispose?.()
    }
    session = null
    entries = []
  }

  // ---------------------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------------------

  /** Shows what `wanted` asks for, building a new session when the vehicle or group changes. */
  async function select(wanted: Wanted): Promise<void> {
    const next = resolveSelection(tree, exhibits, wanted)
    if (!next) { status.textContent = 'No vehicles found in src/dev/vehicleLab/exhibits.'; return }
    if (cockpit.on) await setCockpit(false)
    if (!session || session.exhibit.id !== next.vehicle || session.group !== next.group) {
      teardown()
      const exhibit = exhibits.find(e => e.id === next.vehicle)!
      const vehicle = tree.flatMap(s => s.vehicles).find(v => v.id === next.vehicle)!
      const designs = vehicle.groups.find(g => g.name === next.group)?.designs ?? vehicle.designs
      const s: Session = { exhibit, group: next.group, designs, entries: [], dead: false }
      s.entries = designs.map(info => ({ info, root: new THREE.Group(), size: new THREE.Vector3(1, 1, 1), centre: new THREE.Vector3(), level: 0, stats: { triangles: 0, drawCalls: 0 } }))
      for (const e of s.entries) { e.root.name = e.info.id; e.root.visible = false; stage.add(e.root) }
      session = s
      entries = s.entries
      stress = 1
    }
    selection = next
    const s = session!
    history.replaceState(null, '', selectionToSearch(next, location.search))
    renderTree()
    if (next.design === 'all') {
      side = true
      for (const e of entries) await ensure(s, e)
    } else {
      side = false
      current = Math.max(0, entries.findIndex(e => e.info.id === next.design))
      if (entries[current]) await ensure(s, entries[current])
    }
    if (s.dead) return
    status.textContent = ''
    layout(); frame(); renderOptions()
  }
  const show = (i: number) => select({ vehicle: selection?.vehicle, group: selection?.group, design: entries[i]?.info.id })
  const setSide = (on: boolean) => select({ vehicle: selection?.vehicle, group: selection?.group, design: on ? 'all' : entries[current]?.info.id })

  // ---------------------------------------------------------------------------------------
  // Sidebar: the vehicle tree
  // ---------------------------------------------------------------------------------------

  const sidebar = $('side')
  const scroller = $('side-scroll')
  const vehiclesSection = ui.section('opt:vehicles', 'Vehicles', true, 'sec tree-sec')
  const treeBox = $('tree')
  treeBox.before(vehiclesSection.root)
  vehiclesSection.body.append(treeBox)
  function renderTree() {
    const keep = scroller.scrollTop
    treeBox.replaceChildren()
    for (const sec of tree) {
      treeBox.append(ui.el('h3', 'tree-section', sec.name))
      for (const v of sec.vehicles) {
        const chosen = selection?.vehicle === v.id
        if (v.error) { treeBox.append(ui.el('div', 'tree-error', `${v.title}: could not list designs`)); continue }
        // A vehicle with one design is a leaf: selecting it shows that design.
        if (!v.groups.length && v.designs.length <= 1) {
          const b = ui.button(v.title, () => void select({ vehicle: v.id }), 'tree-item tree-leaf')
          if (chosen) b.setAttribute('aria-current', 'true')
          treeBox.append(b)
          continue
        }
        const veh = ui.section(`tree:${v.id}`, v.title, chosen, 'tree-veh')
        if (chosen) veh.root.open = true
        const list = (designs: LabDesignInfo[], group?: string) => {
          const box = ui.el('div', 'tree-list')
          const here = chosen && selection?.group === group
          if (designs.length > 1) {
            const c = ui.button(`Compare all ${designs.length}`, () => void select({ vehicle: v.id, group, design: 'all' }), 'tree-item tree-compare')
            if (here && selection?.design === 'all') c.setAttribute('aria-current', 'true')
            box.append(c)
          }
          for (const d of designs) {
            const b = ui.button(d.name, () => void select({ vehicle: v.id, group, design: d.id }), 'tree-item')
            if (d.group !== group && group !== undefined) b.append(ui.el('span', 'tag', 'pick'))
            if (here && selection?.design === d.id) b.setAttribute('aria-current', 'true')
            box.append(b)
          }
          return box
        }
        if (v.groups.length) {
          for (const g of [...v.groups].reverse()) {
            const grp = ui.section(`tree:${v.id}:${g.name}`, g.label, g.latest, 'tree-grp')
            if (chosen && selection?.group === g.name) grp.root.open = true
            if (!g.latest) grp.summary.append(ui.el('span', 'tag older', 'older'))
            grp.body.append(list(g.designs, g.name))
            veh.body.append(grp.root)
          }
        } else veh.body.append(list(v.designs))
        treeBox.append(veh.root)
      }
    }
    scroller.scrollTop = keep
  }

  // ---------------------------------------------------------------------------------------
  // Sidebar: info panel and Options tree
  // ---------------------------------------------------------------------------------------

  const optionsBox = $('options')
  /** Handles `refresh` updates when state changes from a button, the API or the URL. */
  const handles = {
    views: [] as HTMLButtonElement[],
    turntable: null as ReturnType<typeof ui.toggle> | null,
    cockpit: null as ReturnType<typeof ui.toggle> | null,
    floor: null as ReturnType<typeof ui.segmented> | null,
    night: null as ReturnType<typeof ui.toggle> | null,
    headlights: null as ReturnType<typeof ui.toggle> | null,
    brake: null as ReturnType<typeof ui.toggle> | null,
    detail: null as ReturnType<typeof ui.segmented> | null,
    stress: null as ReturnType<typeof ui.segmented> | null,
    motion: null as ReturnType<typeof ui.toggle> | null,
    motor: null as ReturnType<typeof ui.toggle> | null,
    revs: null as ReturnType<typeof ui.slider> | null,
    force: null as ReturnType<typeof ui.slider> | null,
    swatches: [] as HTMLButtonElement[],
    own: null as HTMLButtonElement | null,
    body: null as ReturnType<typeof ui.colour> | null,
    accent: null as ReturnType<typeof ui.colour> | null,
    params: new Map<string, { set(v: number | boolean): void; row: HTMLElement }>(),
    stats: [] as HTMLElement[],
    timing: null as HTMLElement | null,
  }

  function renderOptions() {
    const keep = scroller.scrollTop
    optionsBox.replaceChildren()
    handles.params.clear()
    handles.stats = []
    const s = session!
    const e = entries[current]
    const model = e?.model

    // Info panel.
    const info = ui.el('div', 'info')
    // A one design vehicle would repeat its name, so its section heads the panel instead.
    const single = entries.length === 1 && !s.group
    info.append(ui.el('div', 'info-title', single ? s.exhibit.section ?? 'Vehicles' : s.exhibit.heading?.(s.group) ?? s.exhibit.title))
    info.append(ui.el('div', 'info-name', side ? `Compare: ${entries.length} designs` : single ? s.exhibit.title : e?.info.name ?? ''))
    const notes = ui.el('ul', 'info-notes')
    for (const t of side ? entries.map((x, i) => `${i + 1}. ${x.info.name}`) : e?.info.notes ?? []) notes.append(ui.el('li', '', t))
    if (notes.childElementCount) info.append(notes)
    const stats = ui.el('div', 'stats')
    handles.stats.push(stats)
    info.append(stats)
    optionsBox.append(info)
    // On a phone the sheet's header names what is shown, so it reads even when closed.
    $('brand').textContent = SHEET.matches ? `${s.exhibit.title}${side ? ': compare' : entries.length > 1 && e ? `: ${e.info.name}` : ''}` : 'Syn3h vehicle lab'

    // View.
    const view = ui.section('opt:view', 'View')
    const presets = ui.el('div', 'row buttons')
    handles.views = VIEW_NAMES.map(name => { const b = ui.button(name, () => api.view(name), 'btn small'); presets.append(b); return b })
    handles.turntable = ui.toggle('Turntable', turntable, on => { turntable = on; refresh() })
    handles.cockpit = ui.toggle('Cockpit', cockpit.on, on => void setCockpit(on))
    handles.cockpit.root.hidden = side || stress > 1 || !model?.cockpit
    handles.floor = ui.segmented('Floor', FLOOR_NAMES, FLOOR_NAMES.indexOf(studio.floor), i => api.setFloor(FLOOR_NAMES[i]))
    view.body.append(presets, handles.turntable.root, handles.cockpit.root, handles.floor.root)
    optionsBox.append(view.root)

    // Lights.
    const lights = ui.section('opt:lights', 'Lights')
    handles.night = ui.toggle('Night', state.night, on => api.setNight(on))
    handles.headlights = ui.toggle('Headlights', state.headlights, on => api.setHeadlights(on))
    handles.brake = ui.toggle('Brake', state.braking, on => api.setBraking(on))
    handles.motor = ui.toggle('Motor sound', !!motor, on => api.setMotor(on))
    handles.revs = ui.slider('Revs', { min: 0, max: 1, step: .01, value: revs }, v => api.setRevs(v))
    lights.body.append(handles.night.root, handles.headlights.root, handles.brake.root, handles.motor.root, handles.revs.root,
      ui.el('div', 'note', 'Motor sound plays the game\u2019s engine voice for this vehicle. Revs runs from idle to flat out; with Motion on, the revs follow the throttle.'))
    optionsBox.append(lights.root)

    // Bumps: what this vehicle sounds like running into things.
    const bumpsBox = ui.section('opt:bumps', 'Bump sounds')
    const kinds = ui.el('div', 'row buttons')
    for (const kind of ['vehicle', ...SURFACES] as const) kinds.append(ui.button(kind === 'vehicle' ? 'Another vehicle' : kind[0].toUpperCase() + kind.slice(1), () => api.bump(kind), 'btn small'))
    handles.force = ui.slider('Force', { min: 0, max: 1, step: .01, value: force }, v => api.setForce(v))
    bumpsBox.body.append(kinds, handles.force.root, ui.el('div', 'note', 'This vehicle running into another vehicle, or into each kind of ground. Force runs from a touch to a wreck. The hull changes with the vehicle on show.'))
    optionsBox.append(bumpsBox.root)

    // Detail: levels, live counts, stress copies.
    const detail = ui.section('opt:detail', 'Detail')
    const levels = model?.lods ?? []
    if (levels.length > 1) {
      handles.detail = ui.segmented('Level', ['Auto', ...levels], lodChoice + 1, i => void api.setLod(i - 1))
      detail.body.append(handles.detail.root)
    } else handles.detail = null
    const counts = ui.el('div', 'stats')
    handles.stats.push(counts)
    handles.stress = ui.segmented('Stress copies', STRESS_COUNTS.map(n => `×${n}`), STRESS_COUNTS.indexOf(stress), i => void api.stress(STRESS_COUNTS[i]))
    handles.timing = ui.el('div', 'note')
    detail.body.append(counts, handles.stress.root, handles.timing)
    optionsBox.append(detail.root)

    // Paint.
    const paintSec = ui.section('opt:paint', 'Paint')
    const swatches = ui.el('div', 'row swatches')
    handles.own = ui.button('Own colours', () => { paint = null; for (const x of entries) x.model?.resetColors?.(); refresh() }, 'btn small')
    swatches.append(handles.own)
    handles.swatches = PAINTS.map(([label, body, accent]) => {
      const b = ui.button('', () => api.paint(body, accent), 'swatch')
      b.title = label; b.setAttribute('aria-label', label); b.style.background = hex(body)
      swatches.append(b)
      return b
    })
    handles.body = ui.colour('Body', hex(paint?.[0] ?? 0x1553c8), v => api.paint(parseInt(v.slice(1), 16), paint?.[1] ?? 0x15171a))
    handles.accent = ui.colour('Accent', hex(paint?.[1] ?? 0x15171a), v => api.paint(paint?.[0] ?? 0x1553c8, parseInt(v.slice(1), 16)))
    paintSec.body.append(swatches, handles.body.root, handles.accent.root)
    optionsBox.append(paintSec.root)

    // Motion.
    const motion = ui.section('opt:motion', 'Motion')
    handles.motion = ui.toggle('Motion', state.animate, on => api.setMotion(on))
    motion.body.append(handles.motion.root, ui.el('div', 'note', 'Throttle and steering cycle gently; the vehicle animates what it can.'))
    optionsBox.append(motion.root)

    // The exhibit's own controls, under the headings it names.
    const byGroup = new Map<string, LabControl[]>()
    for (const c of model?.controls ?? []) { const g = c.group ?? 'Vehicle'; byGroup.set(g, [...byGroup.get(g) ?? [], c]) }
    for (const [group, list] of byGroup) {
      const sec = ui.section(`ctl:${s.exhibit.id}:${group}`, group)
      for (const c of list) sec.body.append(controlRow(c))
      optionsBox.append(sec.root)
    }

    // Game parameters for this vehicle.
    const groups = vehicleParams(gameParams.all().map(p => p.def), s.exhibit.family ?? s.exhibit.id, s.exhibit.paramGroups)
    if (groups.length) {
      const sec = ui.section(`opt:params:${s.exhibit.id}`, 'Parameters', false)
      const all = groups.flatMap(g => g.defs)
      const resetAll = ui.button('Reset all', () => { for (const d of all) gameParams.set(d.id, d.default) }, 'btn small')
      const head = ui.el('div', 'row buttons')
      head.append(resetAll, ui.el('span', 'note', 'Live for this page only; most act on driving, not looks.'))
      sec.body.append(head)
      for (const g of groups) {
        if (groups.length > 1) sec.body.append(ui.el('h4', 'sub', g.group))
        for (const d of g.defs) sec.body.append(paramRow(d))
      }
      optionsBox.append(sec.root)
    }
    scroller.scrollTop = keep
    refresh()
    writeStats()
  }

  /** One exhibit control. A change applies to every built model with a control of that id. */
  function controlRow(c: LabControl): HTMLElement {
    const all = () => entries.flatMap(x => x.model?.controls?.filter(y => y.id === c.id && y.kind === c.kind) ?? [])
    if (c.kind === 'toggle') return ui.toggle(c.label, c.value, v => { for (const x of all()) if (x.kind === 'toggle') { x.value = v; x.onChange(v) } }).root
    if (c.kind === 'cycle') return ui.pick(c.label, c.options, c.index, i => { for (const x of all()) if (x.kind === 'cycle') { x.index = i; x.onChange(i) } }).root
    return ui.slider(c.label, c, v => { for (const x of all()) if (x.kind === 'slider') { x.value = v; x.onChange(v) } }).root
  }

  /** One game parameter with its reset; kept in step with the registry by the onChange below. */
  function paramRow(def: ParamDef): HTMLElement {
    const value = gameParams.get(def.id)!.value
    const reset = () => gameParams.set(def.id, def.default)
    let row: HTMLElement, set: (v: number | boolean) => void
    if (typeof def.default === 'boolean') {
      const t = ui.toggle(def.label, value as boolean, v => gameParams.set(def.id, v))
      // The reset sits before the switch, so switches line up with the sliders' right edge.
      t.input.before(ui.resetButton(def.label, reset))
      row = t.root; set = v => t.set(v as boolean)
    } else {
      const sl = ui.slider(def.label, { min: def.min ?? 0, max: def.max ?? 1, step: def.step ?? .01, value: value as number, reset }, v => gameParams.set(def.id, v))
      row = sl.root; set = v => sl.set(v as number)
    }
    row.classList.toggle('changed', value !== def.default)
    handles.params.set(def.id, { set, row })
    return row
  }
  const unsubscribe = gameParams.onChange((id, value) => {
    const h = handles.params.get(id)
    if (!h) return
    h.set(value)
    h.row.classList.toggle('changed', value !== gameParams.get(id)!.def.default)
  })

  const refresh = () => {
    const e = entries[current]
    handles.views.forEach((b, i) => b.setAttribute('aria-pressed', String(!cockpit.on && VIEW_NAMES[i] === currentView)))
    handles.turntable?.set(turntable)
    if (handles.cockpit) { handles.cockpit.set(cockpit.on); handles.cockpit.root.hidden = side || stress > 1 || !e?.model?.cockpit }
    handles.floor?.set(FLOOR_NAMES.indexOf(studio.floor))
    handles.night?.set(state.night); handles.headlights?.set(state.headlights); handles.brake?.set(state.braking)
    handles.motor?.set(!!motor); handles.revs?.set(revs); handles.force?.set(force)
    handles.detail?.set(lodChoice + 1)
    handles.stress?.set(STRESS_COUNTS.indexOf(stress))
    handles.motion?.set(state.animate)
    handles.own?.setAttribute('aria-pressed', String(!paint))
    handles.swatches.forEach((b, i) => b.setAttribute('aria-pressed', String(!!paint && PAINTS[i][1] === paint[0] && PAINTS[i][2] === paint[1])))
    if (paint) { handles.body?.set(hex(paint[0])); handles.accent?.set(hex(paint[1])) }
    writeStats()
  }

  // Stats, rewritten a few times a second from the frame loop.
  const frameTime = new RollingAverage(60), cpuTime = new RollingAverage(60)
  const total: LabStats = { triangles: 0, drawCalls: 0 }
  const n = (x: number) => x.toLocaleString('en-GB')
  let lastStats = ''
  function writeStats() {
    const e = entries[current]
    if (!e) return
    const levels = e.model?.lods
    let text: string
    if (stress > 1) {
      countStats(stage, total)
      text = `${n(total.triangles)} triangles, ${n(total.drawCalls)} draws (${stress} copies)`
    } else if (side) {
      total.triangles = total.drawCalls = 0
      for (const x of entries) { total.triangles += x.stats.triangles; total.drawCalls += x.stats.drawCalls }
      text = `All ${entries.length}: ${n(total.triangles)} triangles, ${n(total.drawCalls)} draws`
    } else text = `${levels?.length ? `${levels[e.level]}: ` : ''}${n(e.stats.triangles)} triangles, ${n(e.stats.drawCalls)} draws`
    if (text !== lastStats) { lastStats = text; for (const el of handles.stats) el.textContent = text }
    if (handles.timing) {
      const timing = stress > 1 ? `Frame ${frameTime.average.toFixed(1)} ms, render call ${cpuTime.average.toFixed(1)} ms, average of 60. A rough local measurement; frames are capped by the display rate.` : 'Copies of this design on a grid, to judge many at once.'
      if (handles.timing.textContent !== timing) handles.timing.textContent = timing
    }
  }

  // ---------------------------------------------------------------------------------------
  // Sidebar collapse, bottom sheet, and framing in the free area
  // ---------------------------------------------------------------------------------------

  const collapse = $<HTMLButtonElement>('collapse')
  const setCollapsed = (on: boolean) => {
    document.body.classList.toggle('collapsed', on)
    collapse.setAttribute('aria-expanded', String(!on))
    collapse.setAttribute('aria-label', on ? 'Show the sidebar' : 'Hide the sidebar')
    collapse.title = collapse.getAttribute('aria-label')!
    viewport()
    refit()
  }
  collapse.onclick = () => setCollapsed(!document.body.classList.contains('collapsed'))

  /**
   * The sidebar (or sheet) covers part of the screen, so the projection centre moves to the
   * middle of the free area: render a window of a virtual image that is wider by the sidebar and
   * taller by the sheet. Stills have no interface.
   */
  let coverLeft = 0, coverBottom = 0
  function viewport() {
    const r = sidebar.getBoundingClientRect()
    coverLeft = params.still || SHEET.matches ? 0 : Math.min(r.right, innerWidth * .5)
    coverBottom = params.still || !SHEET.matches ? 0 : Math.min(Math.max(0, innerHeight - r.top), innerHeight * .6)
    const fullW = innerWidth + coverLeft, fullH = innerHeight + coverBottom
    camera.aspect = fullW / fullH
    if (coverLeft || coverBottom) camera.setViewOffset(fullW, fullH, 0, coverBottom, innerWidth, innerHeight)
    else camera.clearViewOffset()
    camera.updateProjectionMatrix()
  }
  new ResizeObserver(() => viewport()).observe(sidebar)
  SHEET.addEventListener('change', () => viewport())
  // Phones start with the sheet closed so the vehicle shows first.
  setCollapsed(SHEET.matches)

  // ---------------------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------------------

  const scratch = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), dir: new THREE.Vector3(), q: new THREE.Quaternion(), box: new THREE.Box3() }
  /** Distance at which a sphere of this radius fills the narrower side of the free area. */
  const fitDistance = (radius: number) => {
    const perPixel = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / (innerHeight + coverBottom)
    const half = Math.min(innerHeight - coverBottom, innerWidth - coverLeft) / 2 * perPixel
    return radius / Math.sin(Math.atan(half)) * .95
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
    if (box.isEmpty()) box.setFromCenterAndSize(scratch.a.set(0, 1, 0), scratch.b.set(4, 2, 4))
    box.getCenter(centre)
    return box.getSize(scratch.a).length() / 2
  }
  /** Keeps the view direction and fits the distance again, after the free area changed size. */
  const refitDir = new THREE.Vector3()
  function refit() {
    if (!session || cockpit.on || !entries[current]?.model) return
    frame(refitDir.subVectors(camera.position, controls.target))
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
    hidden: [] as THREE.Object3D[], done: null as null | (() => void), model: null as LabModel | null,
  }
  const eyeWorld = (out: THREE.Vector3) => {
    const m = cockpit.model!
    return m.object.localToWorld(out.copy(m.cockpit!.eye))
  }
  const lookWorld = (out: THREE.Vector3) => {
    cockpit.model!.object.getWorldQuaternion(scratch.q)
    // Forward and a little down, so the nose shows as a driver sees it.
    return eyeWorld(out).add(scratch.c.set(0, -.0015, -.01).applyQuaternion(scratch.q))
  }
  function setCockpit(on: boolean): Promise<void> {
    const model = entries[current]?.model
    if (on === cockpit.on || (on && (!model?.cockpit || side || stress > 1))) return Promise.resolve()
    cockpit.on = on
    cockpit.fromPos.copy(camera.position); cockpit.fromTarget.copy(controls.target)
    cockpit.t = 0
    controls.enabled = false
    if (on) {
      cockpit.model = model!
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
      for (const o of cockpit.model?.cockpit?.hide ?? []) if (o.visible) { o.visible = false; cockpit.hidden.push(o) }
    }
    if (cockpit.t >= 1) {
      if (cockpit.on) {
        controls.minDistance = 0; controls.maxDistance = .02
        controls.minPolarAngle = .05; controls.maxPolarAngle = Math.PI - .05
        controls.enableZoom = controls.enablePan = false
        controls.rotateSpeed = -.35
        camera.near = .02; camera.updateProjectionMatrix()
      } else cockpit.model = null
      controls.enabled = true
      controls.update()
      cockpit.done?.(); cockpit.done = null
    }
  }

  // ---------------------------------------------------------------------------------------
  // Layout: one design, side by side, or stress copies of one design
  // ---------------------------------------------------------------------------------------

  function layout() {
    copies.clear()
    const e = entries[current]
    if (!e) return
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

  // ---------------------------------------------------------------------------------------
  // The scripted capture API: everything the sidebar does, plus stats and a frame wait
  // ---------------------------------------------------------------------------------------

  let frames = 0
  const waiters: { frame: number; resolve: () => void }[] = []
  const api = {
    ready: false,
    get exhibit() { return session?.exhibit.id },
    get designs() { return entries.map(e => e.info.id) },
    /** Every vehicle in the sidebar with its groups and designs. */
    vehicles() {
      return tree.flatMap(s => s.vehicles.map(v => ({ id: v.id, title: v.title, section: s.name, groups: v.groups.map(g => g.name), designs: v.designs.map(d => d.id) })))
    },
    /** Selects a vehicle and optionally a design (an id, a 1 based position or 'all') and group. */
    select(vehicle: string, design?: string, group?: string) { return select({ vehicle, design, group }) },
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
    setFloor(name: FloorName) { studio.setFloor(name); refresh() },
    setTurntable(on: boolean) { turntable = on; refresh() },
    /** Plays or stops the game's engine voice for the vehicle on show. Needs a click or key press first, as all browser audio does. */
    setMotor(on: boolean) { setMotor(on); refresh() },
    /** Engine revs for Motor sound: 0 idle to 1 flat out. Ignored while Motion is on. */
    setRevs(value: number) { revs = Math.min(1, Math.max(0, value)); refresh() },
    /** For checks: whether the motor is sounding, as what kind, and at what revs. */
    get motor() { return motor && sound ? { state: sound.context.state, kind: hullKind(), revs: motorMotion.throttle } : null },
    /** Plays a bump sound: 'vehicle' or a surface from src/audio/Impacts.ts. */
    bump(kind: ImpactKind) { bump(kind) },
    /** Force of the bump sounds: 0 a touch to 1 a wreck. */
    setForce(value: number) { force = Math.min(1, Math.max(0, value)); refresh() },
    /** For checks: bump sounds played so far. */
    get bumps() { return bumps },
    /** Shows or hides the sidebar (on a phone, opens or closes the sheet). */
    sidebar(open: boolean) { setCollapsed(!open) },
    /** Sets a game parameter by id, or resets it with no value. */
    param(id: string, value?: number | boolean) { const p = gameParams.get(id); if (p) gameParams.set(id, value ?? p.def.default) },
    /** -1 for Auto, else a level index. */
    async setLod(index: number) { lodChoice = index; applyLod(true); refresh() },
    paint(body: number, accent: number) { paint = [body, accent]; for (const e of entries) e.model?.setColors?.(body, accent); refresh() },
    cockpit: setCockpit,
    async stress(count: number) {
      if (cockpit.on) await setCockpit(false)
      stress = STRESS_COUNTS.includes(count) ? count : 1
      if (stress > 1 && side) await setSide(false)
      if (session && entries[current]) await ensure(session, entries[current])
      layout(); frame(); refresh()
    },
    stats() {
      const e = entries[current]
      if (stress > 1) countStats(stage, total)
      return {
        vehicle: session?.exhibit.id, group: session?.group,
        design: side ? 'all' : e?.info.id, detail: e?.model?.lods?.[e.level] ?? null, detailChoice: lodChoice < 0 ? 'Auto' : e?.model?.lods?.[lodChoice],
        triangles: e?.stats.triangles ?? 0, drawCalls: e?.stats.drawCalls ?? 0,
        designs: entries.map(x => ({ id: x.info.id, ...x.stats })),
        stress, stressTriangles: stress > 1 ? total.triangles : e?.stats.triangles, stressDrawCalls: stress > 1 ? total.drawCalls : e?.stats.drawCalls,
        frameMs: frameTime.average, renderCallMs: cpuTime.average, backend: (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl',
      }
    },
    /** Resolves after `count` more frames have rendered. */
    frames(count = 3) { return new Promise<void>(resolve => waiters.push({ frame: frames + count, resolve })) },
    camera, controls, scene,
  }
  Object.assign(window, { vehicleLab: api })

  // First selection, then the URL's initial state.
  viewport()
  await select(selectionFromSearch(location.search))
  if (params.night) api.setNight(true)
  if (params.headlights !== undefined) api.setHeadlights(params.headlights)
  if (params.floor) api.setFloor(params.floor)
  if (params.lod !== undefined) await api.setLod(resolveLod(params.lod, entries[current]?.model?.lods ?? []))
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
    if (motor) {
      const r = state.animate ? Math.abs(state.throttle) : revs
      motorMotion.kind = hullKind()
      motorMotion.speed = r * 55; motorMotion.throttle = r
      motor.engine.update(motorMotion)
    }
    stepCockpit(dt)
    if (controls.enabled) controls.update()
    if (lodChoice < 0) applyLod()
    // Per model stats are cheap tree walks; a few times a second is plenty for a readout.
    if (++statFrame % 15 === 1) { for (const e of entries) if (e.model) countStats(e.model.object, e.stats); writeStats() }
    const t0 = performance.now()
    renderer.render(scene, camera)
    cpuTime.push(performance.now() - t0)
    frames++
    if (frames > 3 && session && entries[current]?.model) api.ready = true
    for (let i = waiters.length - 1; i >= 0; i--) if (frames >= waiters[i].frame) { waiters[i].resolve(); waiters.splice(i, 1) }
  })
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); viewport(); refit() })
  addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null)
    setMotor(false); void sound?.context.close()
    unsubscribe()
    teardown()
    studio.dispose(); controls.dispose(); renderer.dispose()
  }, { once: true })
}

main().catch(error => { $('status').textContent = String(error); console.error(error) })
