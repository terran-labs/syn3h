/**
 * Generated buggy fit: the parts the game loads from buggy-boxarm.glb and buggy.glb, and a
 * code-generated candidate for the same parts, assembled the same way at rest so the two can be
 * orbited side by side or overlaid. Developer only, like the rest of the lab.
 *
 *   /vehicle-lab.html?vehicle=buggy-fit                          the reference parts
 *   /vehicle-lab.html?vehicle=buggy-fit&group=Parts&design=<module>  a candidate, by its path
 *                                                                under src/vehicles/buggygen/ without .ts
 *   /vehicle-lab.html?vehicle=buggy-fit&design=placeholder       tools/buggy-fit/placeholder.ts
 *   /vehicle-lab.html?vehicle=buggy-fit&design=all               reference and every candidate
 *
 * A candidate design has a Show control: Candidate, Reference, or Overlay (the candidate solid,
 * the reference as a cyan wireframe drawn over it). Detail levels pass through to the candidate's build().
 * The reference comes from tools/buggy-fit/glb.ts, the same extraction the comparison harness
 * measures, so what is seen here is what is measured. This page fetches the two model files; it
 * is a measuring tool and does not ship.
 *
 * The Skins group runs the real skin classes, as the game drives them: LoadedBuggySkin (two
 * model files) and GeneratedBuggySkin (no files), with wheels, steering, wings, motor glow,
 * brake lamps, paint and the game's three detail levels.
 *
 *   /vehicle-lab.html?vehicle=buggy-fit&group=Skins&design=all        both, side by side
 *   /vehicle-lab.html?vehicle=buggy-fit&group=Skins&design=generated  one of them (or loaded)
 */
import * as THREE from 'three/webgpu'
import { referenceParts, type Mesh, type PartName } from '../../../../tools/buggy-fit/glb'
import { smoothBuggyWheel } from '../../../vehicles/skins/buggyGeometry'
import { addLavaGlow } from '../../../vehicles/skins/lavaGlow'
import { addNightReadability } from '../../../vehicles/skins/nightReadability'
import { applyShowroom, setRole, type SurfaceRole } from '../../../vehicles/skins/showroom'
import type { LabContext, LabDesignInfo, LabExhibit, LabModel } from '../types'
import type { BuggySkin } from '../../../vehicles/skins/BuggySkin'
import type { VehicleDetail } from '../../../vehicles/skins/mergeStatic'

/** The candidate contract (tools/buggy-fit/README.md), declared structurally. */
interface CandidatePart { part: PartName; role: string; geometry: THREE.BufferGeometry }
interface Candidate { id: string; build(detail: 0 | 1 | 2): CandidatePart[]; numbers?: number }

// Rest layout, as LoadedBuggySkin: hubs at `rest` mirrored per wheel, struts to the AxelPos mounts.
const HUBS = [0, 1, 2, 3].map(i => new THREE.Vector3(i % 2 ? 1.1 : -1.1, -.2, i < 2 ? -1.3 : 1.3))
const MOUNTS = [0, 1, 2, 3].map(i => new THREE.Vector3(i % 2 ? .55 : -.55, .15, i < 2 ? -1.2 : 1.2))
/** Shock anchors from the Shock node's extras in buggy-boxarm.glb, used for the candidate too. */
const SHOCK_FOOT = new THREE.Vector3(0, .2, -.07)
const SHOCK_TOPS = [[-.7302, .4919, -1.2375], [.7302, .4919, -1.2375], [-.7271, .4880, 1.2364], [.7271, .4880, 1.2364]].map(v => new THREE.Vector3(...v))
/** Hub height less the tyre's 0.52 m radius. */
const GROUND_Y = -.72
const PAINT = 0x1768b4, ACCENT = 0x49e6ff

// Candidate modules; the generated skin's own files are not candidates.
const candidates = Object.fromEntries(Object.entries(import.meta.glob('../../../vehicles/buggygen/**/*.ts'))
  .filter(([path]) => !/\/(GeneratedBuggySkin|generatedParts|body)\.ts$/.test(path)))
const placeholder = () => import('../../../../tools/buggy-fit/placeholder')
/** Design id: the path under src/vehicles/buggygen without .ts, for example `parts/index`. */
const moduleName = (path: string) => path.split('/buggygen/').pop()!.replace(/\.ts$/, '')

/** LoadedBuggySkin.strutMatrix at rest: span from hub to mount, thickness toward body up. */
function strutMatrix(hub: THREE.Vector3, mount: THREE.Vector3): THREE.Matrix4 {
  const span = mount.clone().sub(hub).normalize(), up = new THREE.Vector3(0, 1, 0)
  const thick = up.clone().addScaledVector(span, -up.dot(span)).normalize().negate()
  return new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(span, thick), span, thick).setPosition(hub)
}
function shockMatrix(strut: THREE.Matrix4, top: THREE.Vector3): THREE.Matrix4 {
  const foot = SHOCK_FOOT.clone().applyMatrix4(strut), axis = top.clone().sub(foot)
  const side = new THREE.Vector3(0, 0, 1).cross(axis).normalize()
  return new THREE.Matrix4().makeBasis(side, axis, new THREE.Vector3().crossVectors(side, axis).normalize()).setPosition(foot)
}
/** Where each part goes: once in the vehicle frame, or once per wheel. */
function placements(part: PartName): THREE.Matrix4[] {
  if (part === 'stator') return HUBS.map(h => new THREE.Matrix4().makeTranslation(h.x, h.y, h.z))
  if (part === 'strut') return HUBS.map((h, i) => strutMatrix(h, MOUNTS[i]))
  if (part === 'shock') return HUBS.map((h, i) => shockMatrix(strutMatrix(h, MOUNTS[i]), SHOCK_TOPS[i]))
  return [new THREE.Matrix4()]
}

/** Material name in the model to a shading role, as LoadedBuggySkin assigns them. */
function roleOf(name: string, part: PartName): SurfaceRole {
  if (part === 'canopy') return 'canopy'
  if (part === 'wings') return 'glow'
  if (part === 'stator') return /chrome/i.test(name) ? 'chrome' : 'frame'
  if (/body|material/i.test(name)) return 'paint'
  if (/glow|accent/i.test(name)) return 'accent'
  if (/chrome/i.test(name)) return 'chrome'
  if (/light/i.test(name)) return 'lamp'
  if (/dark|strutmetal/i.test(name)) return 'frame'
  return 'trim'
}
const ROLES: SurfaceRole[] = ['paint', 'accent', 'chrome', 'frame', 'canopy', 'glass', 'glow', 'tyre', 'track', 'lamp', 'trim']
const asRole = (role: string): SurfaceRole => ROLES.includes(role as SurfaceRole) ? role as SurfaceRole : 'trim'

function material(role: SurfaceRole, paints: THREE.MeshStandardMaterial[]): THREE.MeshStandardMaterial {
  const color = role === 'paint' ? PAINT : role === 'accent' || role === 'glow' ? ACCENT : role === 'chrome' ? 0xc4ccd6 : role === 'canopy' ? 0x192c44 : role === 'lamp' ? 0xe8f0ff : role === 'frame' ? 0x23272d : 0x2a2d33
  const m = setRole(new THREE.MeshStandardMaterial({ color, roughness: .36, metalness: role === 'chrome' ? .75 : .3 }), role)
  if (role === 'paint' || role === 'accent' || role === 'glow') { m.userData.paintKind = role; paints.push(m) }
  if (role === 'canopy') m.userData.separate = true
  return m
}

/** Plain mesh to geometry, split by role. */
function referenceGeometries(mesh: Mesh, part: PartName): Map<SurfaceRole, THREE.BufferGeometry> {
  const byRole = new Map<SurfaceRole, number[]>()
  for (let t = 0; t < mesh.materials.length; t++) {
    const role = roleOf(mesh.materials[t], part), list = byRole.get(role) ?? []
    list.push(mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]); byRole.set(role, list)
  }
  const out = new Map<SurfaceRole, THREE.BufferGeometry>()
  for (const [role, indices] of byRole) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
    g.setIndex(indices); g.computeVertexNormals(); out.set(role, g)
  }
  return out
}

/** One assembled buggy from (part, role, geometry) entries; wings in their own group. */
function assemble(entries: { part: PartName; role: SurfaceRole; geometry: THREE.BufferGeometry }[], paints: THREE.MeshStandardMaterial[], overlay?: THREE.Material) {
  const root = new THREE.Group(), wings = new THREE.Group()
  root.add(wings)
  for (const e of entries) for (const m of placements(e.part)) {
    const mesh = new THREE.Mesh(e.geometry, overlay ?? material(e.role, paints))
    mesh.applyMatrix4(m); mesh.castShadow = mesh.receiveShadow = !overlay
    if (overlay) mesh.renderOrder = 10
    ;(e.part === 'wings' ? wings : root).add(mesh)
  }
  wings.visible = false
  return { root, wings }
}

let reference: Promise<ReturnType<typeof referenceParts>> | undefined
const loadReference = () => reference ??= Promise.all(['/models/buggy-boxarm.glb', '/models/buggy.glb'].map(async url => new Uint8Array(await (await fetch(url)).arrayBuffer())))
  .then(([boxarm, original]) => referenceParts(boxarm, original))

const PARTS: PartName[] = ['body', 'sockets', 'interior', 'canopy', 'strut', 'shock', 'stator', 'wings']

async function referenceEntries() {
  const ref = await loadReference()
  return PARTS.flatMap(part => [...referenceGeometries(ref[part], part)].map(([role, geometry]) => ({ part, role, geometry })))
}

async function loadCandidate(id: string): Promise<Candidate> {
  const path = Object.keys(candidates).find(p => moduleName(p) === id)
  const mod = (path ? await candidates[path]() : await placeholder()) as { default: Candidate }
  return mod.default
}

export const buggyFit: LabExhibit = {
  section: 'Design studies',
  id: 'buggy-fit',
  title: 'Generated buggy fit',
  paramGroups: [],
  async designs() {
    const found: LabDesignInfo[] = [{ id: 'reference', name: 'Loaded model', group: 'Parts', notes: ['The parts the game loads from buggy-boxarm.glb and buggy.glb, as the harness measures them.'] }]
    for (const [path, load] of Object.entries(candidates)) {
      const mod = await load().catch(() => undefined) as { default?: Partial<Candidate> } | undefined
      if (typeof mod?.default?.build === 'function') found.push({ id: moduleName(path), name: mod.default.id ?? moduleName(path), group: 'Parts', notes: [`src/vehicles/buggygen/${moduleName(path)}.ts`, `${mod.default.numbers ?? '?'} numbers in the design data.`] })
    }
    found.push({ id: 'placeholder', name: 'Placeholder boxes', group: 'Parts', notes: ['tools/buggy-fit/placeholder.ts: one box per part at the reference bounds.'] })
    found.push(
      { id: 'loaded', name: 'Loaded skin', group: 'Skins', notes: ['LoadedBuggySkin: the game today, two model files.'] },
      { id: 'generated', name: 'Generated skin', group: 'Skins', notes: ['GeneratedBuggySkin: every part generated in code, no model file.', 'Body from src/vehicles/buggygen/body.ts.'] },
    )
    return found
  },
  heading: group => group === 'Skins' ? 'Syn3h buggy: loaded and generated skins' : 'Generated buggy fit: parts',
  async build(info, ctx) {
    if (info.id === 'loaded' || info.id === 'generated') return skinModel(info.id, ctx)
    ctx.status('Reading the reference model')
    const object = new THREE.Group(), paints: THREE.MeshStandardMaterial[] = []
    const entries = await referenceEntries()
    const ref = assemble(entries, paints)
    const wire = new THREE.MeshBasicMaterial({ color: 0x50e6ff, wireframe: true, transparent: true, opacity: .35, depthWrite: false, depthTest: false })
    const refWire = assemble(entries, paints, wire)
    object.add(ref.root, refWire.root)
    // Generated tyres for context, shared by both (the harness does not measure them).
    const wheel = smoothBuggyWheel()
    for (const h of HUBS) { const w = wheel.clone(); w.position.copy(h); object.add(w) }
    let showWings = false
    // The shared shading, applied once every mesh is in place.
    const showroom = () => applyShowroom(object, root => { addNightReadability(root); addLavaGlow(root) })
    if (info.id === 'reference') {
      refWire.root.visible = false
      const detachShowroom = showroom()
      return {
        object, groundY: GROUND_Y,
        controls: [{ kind: 'toggle', id: 'fit.wings', label: 'Wings (open)', value: false, onChange: on => { ref.wings.visible = on } }],
        setColors(body, accent) { for (const m of paints) m.color.set(m.userData.paintKind === 'paint' ? body : accent) },
        resetColors() { for (const m of paints) m.color.set(m.userData.paintKind === 'paint' ? PAINT : ACCENT) },
        dispose() { detachShowroom() },
      }
    }
    ctx.status('Building the candidate')
    const candidate = await loadCandidate(info.id)
    const levels = ([0, 1, 2] as const).map(detail => {
      const built = assemble(candidate.build(detail).map(p => ({ part: p.part, role: asRole(p.role), geometry: p.geometry })), paints)
      built.root.visible = detail === 0
      object.add(built.root)
      return built
    })
    // Show: 0 candidate, 1 reference, 2 overlay (candidate solid, reference wireframe).
    let show = 0, lod = 0
    const apply = () => {
      levels.forEach((l, i) => { l.root.visible = show !== 1 && i === lod; l.wings.visible = showWings })
      ref.root.visible = show === 1; ref.wings.visible = showWings
      refWire.root.visible = show === 2; refWire.wings.visible = showWings
    }
    apply()
    const detachShowroom = showroom()
    return {
      object, groundY: GROUND_Y,
      lods: ['Detail 0', 'Detail 1', 'Detail 2'],
      lodDistances: [30, 120],
      setLod(index) { lod = index; apply() },
      controls: [
        { kind: 'cycle', id: 'fit.show', label: 'Show', options: ['Candidate', 'Reference', 'Overlay'], index: 0, onChange: i => { show = i; apply() } },
        { kind: 'toggle', id: 'fit.wings', label: 'Wings (open)', value: false, onChange: on => { showWings = on; apply() } },
      ],
      setColors(body, accent) { for (const m of paints) m.color.set(m.userData.paintKind === 'paint' ? body : accent) },
      resetColors() { for (const m of paints) m.color.set(m.userData.paintKind === 'paint' ? PAINT : ACCENT) },
      dispose() { detachShowroom(); wire.dispose() },
    }
  },
}

/** Wheel rest position as LoadedBuggySkin's LAYOUT; driver's eye as Syn3hBuggy's RIDE_HEIGHT. */
const REST = new THREE.Vector3(1.1, -.2, 1.3), RIDE_HEIGHT = .8
/** Time from construction to ready, per skin, for scripts (tools/buggy-fit/browser-measure.mjs). */
const timings: Record<string, number> = ((globalThis as { buggySkinReadyMs?: Record<string, number> }).buggySkinReadyMs ??= {})

/** A real skin class in the lab, driven as Syn3hBuggy drives it. */
async function skinModel(id: 'loaded' | 'generated', ctx: LabContext): Promise<LabModel> {
  ctx.status(id === 'loaded' ? 'Loading the buggy models' : 'Generating the buggy')
  const object = new THREE.Group(), callbacks = new Set<VehicleDetail>()
  object.userData.registerVehicleDetail = (fn: VehicleDetail) => { callbacks.add(fn); return () => callbacks.delete(fn) }
  // Module loading is not part of construction: import first, then time construction to ready.
  const Skin = id === 'loaded'
    ? (await import('../../../vehicles/skins/LoadedBuggySkin')).LoadedBuggySkin
    : (await import('../../../vehicles/buggygen/GeneratedBuggySkin')).GeneratedBuggySkin
  const started = performance.now()
  const skin: BuggySkin = new Skin()
  object.add(skin.object)
  await skin.ready
  timings[id] = performance.now() - started
  const body = 0x1768b4, accent = 0x49e6ff
  let lod = 0, wingsOn = false, wings = 0, spin = 0
  const distances = [0, 60, 300]
  const applyLod = () => callbacks.forEach(fn => fn(distances[lod], true, 2))
  const position = new THREE.Vector3()
  const wheel = (i: number, steer: number) => skin.setWheel(i, position.set(i % 2 ? REST.x : -REST.x, REST.y, i < 2 ? -REST.z : REST.z), i < 2 ? steer : 0, spin)
  for (let i = 0; i < 4; i++) wheel(i, 0)
  applyLod()
  return {
    object, groundY: -.72,
    lods: ['Near', 'Mid', 'Far'], lodDistances: [30, 120],
    setLod(i) { lod = i; applyLod() },
    setColors(b, a) { skin.setColors(b, a) },
    resetColors() { skin.setColors(body, accent) },
    cockpit: { eye: new THREE.Vector3(0, RIDE_HEIGHT, 0) },
    controls: [{ kind: 'toggle', id: 'fit.wings', label: 'Wings (open)', value: false, onChange: on => { wingsOn = on } }],
    update(dt, state) {
      const steer = -state.steer * .45
      spin += state.throttle * dt * 6
      for (let i = 0; i < 4; i++) { wheel(i, steer); skin.setDrive?.(i, Math.abs(state.throttle), state.throttle < 0) }
      skin.setLights?.(state.braking)
      // Half a second to open or fold, as the game's wing state. The skin rewrites every wing
      // vertex, so only while open or moving.
      // With time stopped (still=1 captures) they snap to the switch.
      const next = dt > 0 ? THREE.MathUtils.clamp(wings + (wingsOn ? 2 : -2) * dt, 0, 1) : wingsOn ? 1 : 0
      if (next > 0 || wings > 0) skin.setWings(next, state.steer, state.throttle)
      wings = next
    },
    dispose() { skin.dispose() },
  }
}
