/**
 * Buggy body gallery exhibit: the body variations that tools/buggy-bodies/build.py exports to
 * labs/buggy-bodies, on the original wheels, hub stators and wing struts from buggy.glb.
 * Replaces the old buggy-bodies.html gallery (bodiesViewer.ts).
 *
 * The models live in labs/, which the dev server serves from the repository root and the
 * production build does not copy.
 *
 * Seams for the next rounds, in file order:
 * - MATERIAL MAP (`DesignMaterials.make`): glb material names to preview materials.
 * - WHEEL OPTIONS (`wheelOptions`): the tyre and stator choices behind the Wheels control.
 * - WHEEL SET (`WheelSet`): builds and animates four wheels, stators and struts for a design.
 * - DESIGN BUILD (`build`): loads a body, picks its strut, adds lamps, beams and the cockpit.
 *
 * Draw calls here are higher than the game's: the game instances stators and struts and merges
 * static parts (MiraBuggySkin), while this gallery keeps every part a separate mesh so bodies
 * can be swapped freely. Triangle counts match what the parts would ship at.
 */
import * as THREE from 'three/webgpu'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { accentPaint, addHeadlightBeams, carPaint, chrome, darkMetal, forceField, glass, lamp, rubber, updateLamps } from '../materials'
import type { LabControl, LabDesignInfo, LabExhibit, LabModel, LabState } from '../types'

const MODELS = '/labs/buggy-bodies'
const WHEEL_INDEX = '/labs/buggy-wheels/index.json'
/**
 * The round 1 body the owner picked as the base for round 2. Older index files mark no picks, so
 * it carries into later rounds by rule; see carryOver.
 */
const LEGACY_PICK = 'v4-widebody'

/** Wheel hubs at rest in the game frame (nose at -Z): MiraBuggy WHEEL_POS at ride height. */
const HUBS = [[-1.1, -.19, -1.3], [1.1, -.19, -1.3], [-1.1, -.19, 1.3], [1.1, -.19, 1.3]].map(p => new THREE.Vector3(...p))
/** Where each strut meets the body: the prefab's AxelPos, as MiraBuggySkin's mounts. */
const MOUNTS = [[-.55, .15, -1.2], [.55, .15, -1.2], [-.55, .15, 1.2], [.55, .15, 1.2]].map(p => new THREE.Vector3(...p))
/** Length of the strut mesh along its span (glb +Y, narrow root at the origin), as MiraBuggySkin. */
const STRUT_SPAN = .828
const STRUT_REST = HUBS[3].distanceTo(MOUNTS[3])
/** Tyre bottom: hub height less the original tyre's 0.52 m radius. */
const GROUND_Y = -.71
/** Driver's eye, in the vehicle frame. */
const EYE = new THREE.Vector3(0, .95, 0)
/** Suspension travel shown by Motion, metres either side of rest (the game allows 0.4 m in all). */
const TRAVEL = .12

export interface BodyEntry {
  id: string; name: string; notes: string[]; file: string; triangles: number; round: number; gameResolution?: boolean
  /** Later rounds this body also appears in, first in the list: the pick those rounds build on. */
  alsoIn?: (string | number)[]
  /** The body this one was built on, by id (or a plain name). Shown in the notes and the round heading. */
  basedOn?: string
}
interface WheelEntry { id: string; name: string; file: string; notes?: string[] }

const loader = new GLTFLoader()
const up = new THREE.Vector3(0, 1, 0)
/** 'Accent.001' and 'Tail Lights' become 'Accent' and 'TailLights'. Blender suffixes vary per file. */
const baseName = (name: string) => name.replace(/\.\d+$/, '').replace(/\s+/g, '')

// ---------------------------------------------------------------------------------------------
// MATERIAL MAP
// ---------------------------------------------------------------------------------------------

/**
 * Where a part sits decides what its 'Accent' means. On bodies, tyres (the beadlock ring) and a
 * design's own Strut it is the vehicle accent paint. On the original stator and Axle strut it is
 * the dark hub wing metal: VhiclBuggy.cs leaves the Rim out of MaterialAccents and the owner's
 * screenshots show the hub wing dark with a chrome sheen.
 */
type Role = 'body' | 'hub'

/** One design's materials, made once per glb material name so meshes share them. */
class DesignMaterials {
  readonly paints: THREE.MeshPhysicalMaterial[] = []
  readonly accents: THREE.MeshPhysicalMaterial[] = []
  readonly head: THREE.MeshStandardMaterial[] = []
  readonly tail: THREE.MeshStandardMaterial[] = []
  readonly glass = new Set<THREE.Material>()
  private readonly cache = new Map<string, THREE.Material>()

  get(src: THREE.Material, role: Role): THREE.Material {
    const name = baseName(src.name)
    // A tyre whose tread is a normal map is its own material, apart from plain rubber.
    const normalMap = (src as THREE.MeshStandardMaterial).normalMap
    const key = `${role}:${name}:${normalMap?.uuid ?? ''}`
    let m = this.cache.get(key)
    if (!m) { m = this.make(name, src as THREE.MeshStandardMaterial, role); this.cache.set(key, m) }
    return m
  }

  /** The map itself. Add a case here when a body file brings a new material name. */
  private make(name: string, src: THREE.MeshStandardMaterial, role: Role): THREE.Material {
    switch (name) {
      case 'Body': case 'Material': return this.paint(carPaint(src.color), this.paints)
      case 'Accent':
        if (role === 'hub') return new THREE.MeshStandardMaterial({ name: 'Hub wing metal', color: 0x59616c, roughness: .3, metalness: .55 })
        return this.paint(accentPaint(src.color), this.accents)
      case 'Chrome': return chrome()
      case 'Glass': { const g = glass({ color: src.color, opacity: src.opacity }); this.glass.add(g); return g }
      case 'Headlights': { const m = lamp('head'); this.head.push(m); return m }
      case 'TailLights': { const m = lamp('tail'); this.tail.push(m); return m }
      // Scoops and sockets: near black, slightly glossy.
      case 'Dark': return new THREE.MeshPhysicalMaterial({ name: 'Dark', color: 0x08090b, metalness: .3, roughness: .6 })
      case 'StrutMetal': return darkMetal()
      case 'Tire': case 'Tyre': case 'Rubber': {
        const m = rubber()
        // Tread as a texture (labs/buggy-wheels 'texture'): keep the map the file brought.
        if (src.normalMap) { m.normalMap = src.normalMap; m.normalScale.copy(src.normalScale); m.roughness = .7 }
        return m
      }
      default:
        console.warn(`Buggy exhibit: unmapped material "${src.name}", shown as body paint`)
        return this.paint(carPaint(src.color), this.paints)
    }
  }

  private paint<T extends THREE.MeshPhysicalMaterial>(m: T, list: T[]): T {
    m.userData.built = m.color.clone()
    list.push(m)
    return m
  }

  /** The canopy force field takes the accent colour, brightened so a dark accent still glows. */
  readonly field = forceField()
  private fieldColour(accent: THREE.Color): void {
    const hsl = { h: 0, s: 0, l: 0 }
    accent.getHSL(hsl)
    this.field.color.setHSL(hsl.h, Math.max(hsl.s, .55), THREE.MathUtils.clamp(hsl.l, .45, .62))
  }

  setColors(body: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void {
    for (const m of this.paints) m.color.set(body)
    for (const m of this.accents) m.color.set(accent)
    this.fieldColour(new THREE.Color(accent))
  }
  resetColors(): void {
    for (const m of [...this.paints, ...this.accents]) m.color.copy(m.userData.built as THREE.Color)
    this.fieldColour(this.accents[0]?.color ?? new THREE.Color(0x49e6ff))
  }
  dispose(): void { for (const m of this.cache.values()) m.dispose(); this.field.material.dispose() }
}

// ---------------------------------------------------------------------------------------------
// SHARED PARTS
// ---------------------------------------------------------------------------------------------

/** A mesh baked into its part's frame: geometry shared between designs, material by name. */
interface BakedPart { geometry: THREE.BufferGeometry; material: THREE.Material }

let original: Promise<GLTF> | undefined
const buggyGlb = () => original ??= loader.loadAsync('/tools/models/buggy.glb')

/**
 * Bakes every mesh under `root` into `root`'s own frame (or world, for buggy.glb parts whose
 * placement is part of their shape). `centre` moves the bounding box centre to the origin, which
 * is how the wheel template becomes a hub centred tyre.
 */
function bake(root: THREE.Object3D, o: { centre?: boolean; relative?: boolean } = {}): BakedPart[] {
  root.updateWorldMatrix(true, true)
  const toPart = o.relative ? root.matrixWorld.clone().invert() : new THREE.Matrix4()
  const parts: BakedPart[] = []
  root.traverse(x => {
    if (!(x instanceof THREE.Mesh)) return
    const geometry = (x.geometry as THREE.BufferGeometry).clone().applyMatrix4(toPart.clone().multiply(x.matrixWorld))
    geometry.computeVertexNormals()
    parts.push({ geometry, material: x.material as THREE.Material })
  })
  if (o.centre) {
    const box = new THREE.Box3()
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!) }
    const c = box.getCenter(new THREE.Vector3())
    for (const p of parts) p.geometry.translate(-c.x, -c.y, -c.z)
  }
  return parts
}

/** Meshes for baked parts, with this design's materials. */
function meshes(parts: BakedPart[], mats: DesignMaterials, role: Role, name: string): THREE.Group {
  const g = new THREE.Group()
  g.name = name
  for (const p of parts) {
    const m = new THREE.Mesh(p.geometry, mats.get(p.material, role))
    m.castShadow = m.receiveShadow = true
    g.add(m)
  }
  return g
}

// ---------------------------------------------------------------------------------------------
// WHEEL OPTIONS
// ---------------------------------------------------------------------------------------------

/** One choice for the Wheels control. Each level holds a hub centred tyre (axle along X) and the stator. */
interface WheelOption {
  id: string
  name: string
  notes: string[]
  /** Near and Far parts. Options without a far model use the near one for both. */
  load(): Promise<{ near: WheelParts; far: WheelParts }>
}
interface WheelParts { tyre: BakedPart[]; stator: BakedPart[] }

const originalWheels = async () => {
  const s = (await buggyGlb()).scene
  const part = (name: string) => bake(s.getObjectByName(name)!, { centre: true })
  return {
    near: { tyre: part('Wheel_Template'), stator: part('Rim') },
    far: { tyre: part('Wheel_Template_Simple'), stator: part('RimSimple') },
  }
}
const ORIGINAL: WheelOption = {
  id: 'original', name: 'Original', notes: ['Mira wheel template and hub stator from buggy.glb'],
  load: once(originalWheels),
}

let options: Promise<WheelOption[]> | undefined
/**
 * The original wheel plus anything listed in labs/buggy-wheels/index.json (`{ id, name, file,
 * notes }`). Each glb holds a node `Tyre`, centred on the hub with the axle along X, and
 * optionally `Stator`; without one the original stator is kept. A missing index means only the
 * original, and the Wheels control is not shown.
 */
function wheelOptions(): Promise<WheelOption[]> {
  options ??= (async () => {
    let extra: WheelEntry[] = []
    try {
      const res = await fetch(WHEEL_INDEX)
      // The dev server answers a missing file with the HTML page, so check the type too.
      if (res.ok && /json/.test(res.headers.get('content-type') ?? '')) extra = await res.json()
    } catch { extra = [] }
    return [ORIGINAL, ...extra.map((w): WheelOption => ({
      id: w.id, name: w.name, notes: w.notes ?? [],
      load: once(async () => {
        const [gltf, base] = await Promise.all([loader.loadAsync(`/labs/buggy-wheels/${w.file}`), ORIGINAL.load()])
        const tyreNode = gltf.scene.getObjectByName('Tyre')
        if (!tyreNode) throw new Error(`${w.file} has no Tyre node`)
        const statorNode = gltf.scene.getObjectByName('Stator')
        const level = { tyre: bake(tyreNode, { relative: true }), stator: statorNode ? bake(statorNode, { relative: true }) : base.near.stator }
        return { near: level, far: level }
      }),
    }))]
  })()
  return options
}

function once<T>(f: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined
  return () => p ??= f()
}

// ---------------------------------------------------------------------------------------------
// WHEEL SET
// ---------------------------------------------------------------------------------------------

/** Per frame scratch, so update allocates nothing. */
const scratch = { hub: new THREE.Vector3(), span: new THREE.Vector3(), thick: new THREE.Vector3(), chord: new THREE.Vector3() }

/**
 * Four wheels with stators and wing struts. Each wheel is a steered group at the hub holding the
 * stator (which steers and travels but does not spin, like the prefab's `Rim`) and a spinning
 * group holding the tyre (the prefab's `Roll`). Struts follow the hub, not the steering.
 */
class WheelSet {
  readonly group = new THREE.Group()
  private readonly steered: THREE.Group[] = []
  private readonly rolling: THREE.Group[] = []
  private readonly near: THREE.Object3D[] = []
  private readonly far: THREE.Object3D[] = []
  private readonly struts: THREE.Group[] = []
  private spin = 0

  constructor(parts: { near: WheelParts; far: WheelParts }, strut: { parts: BakedPart[]; role: Role }, mats: DesignMaterials) {
    this.group.name = 'Wheel set'
    HUBS.forEach((hub, i) => {
      const steer = new THREE.Group(), roll = new THREE.Group()
      steer.position.copy(hub)
      steer.add(roll)
      for (const [level, list] of [[parts.near, this.near], [parts.far, this.far]] as const) {
        const tyre = meshes(level.tyre, mats, 'body', 'Tyre')
        // Left tyres turn round so the outer face points outward on both sides.
        if (hub.x < 0) tyre.rotation.y = Math.PI
        const stator = meshes(level.stator, mats, 'hub', 'Stator')
        roll.add(tyre); steer.add(stator)
        list.push(tyre, stator)
      }
      const s = meshes(strut.parts, mats, strut.role, 'Strut')
      s.matrixAutoUpdate = false
      this.group.add(steer, s)
      this.steered.push(steer); this.rolling.push(roll); this.struts.push(s)
      this.place(i, hub)
    })
    this.setLod(0)
  }

  setLod(level: number): void {
    for (const o of this.near) o.visible = level === 0
    for (const o of this.far) o.visible = level !== 0
  }

  /** Motion: suspension travel, steering on the front pair and wheel spin from throttle. */
  update(dt: number, state: LabState): void {
    if (state.animate) this.spin -= dt * state.throttle * 9
    for (let i = 0; i < 4; i++) {
      const hub = scratch.hub.copy(HUBS[i])
      if (state.animate) hub.y += Math.sin(state.time * 2 + i * 1.7) * TRAVEL
      this.steered[i].position.copy(hub)
      this.steered[i].rotation.y = i < 2 ? -state.steer * .35 : 0
      this.rolling[i].rotation.x = this.spin
      this.place(i, hub)
    }
  }

  /**
   * MiraBuggySkin.strutMatrix: the span runs from the hub to the body mount, the thickness
   * points as near straight down as it can, so the chord lies fore and aft. The strut stretches
   * along its span only when the wheel droops past rest, so no gap opens at the body.
   */
  private place(i: number, hub: THREE.Vector3): void {
    const span = scratch.span.copy(MOUNTS[i]).sub(hub)
    const length = span.length()
    span.divideScalar(length)
    const thick = scratch.thick.copy(up).addScaledVector(span, -up.dot(span)).normalize().negate()
    const chord = scratch.chord.crossVectors(span, thick)
    const stretch = Math.max(1, (length + STRUT_SPAN - STRUT_REST) / STRUT_SPAN)
    const s = this.struts[i]
    s.matrix.makeBasis(chord, span.multiplyScalar(stretch), thick).setPosition(hub)
    s.matrixWorldNeedsUpdate = true
  }
}

// ---------------------------------------------------------------------------------------------
// EXHIBIT
// ---------------------------------------------------------------------------------------------

let index: Promise<BodyEntry[]> | undefined
const bodies = () => index ??= fetch(`${MODELS}/index.json`).then(r => r.json() as Promise<BodyEntry[]>)

/**
 * Which picks carry into which rounds, and what each round was built on. An entry's `alsoIn`
 * names the rounds it carries into. Without any marks the legacy pick (Wide body) carries into
 * every later round before the first round that has a marked pick of its own. A round's basis
 * is the name of the body its entries are `basedOn`, else the name of the pick carried into it.
 */
export function carryOver(entries: BodyEntry[]): { alsoIn: Map<string, string[]>; basis: Map<string, string> } {
  const alsoIn = new Map<string, string[]>()
  for (const e of entries) if (e.alsoIn?.length) alsoIn.set(e.id, e.alsoIn.map(String))
  const legacy = entries.find(e => e.id === LEGACY_PICK)
  if (legacy && !legacy.alsoIn) {
    const marked = [...alsoIn.values()].flat().map(Number).filter(Number.isFinite)
    const stop = marked.length ? Math.min(...marked) : Infinity
    const later = [...new Set(entries.map(e => e.round))].filter(r => r > legacy.round && r < stop).sort((a, b) => a - b)
    if (later.length) alsoIn.set(legacy.id, later.map(String))
  }
  const basis = new Map<string, string>()
  const nameOf = (id: string) => entries.find(e => e.id === id)?.name ?? id
  for (const e of entries) if (e.basedOn && !basis.has(String(e.round))) basis.set(String(e.round), nameOf(e.basedOn))
  for (const [id, rounds] of alsoIn) for (const r of rounds) if (!basis.has(r)) basis.set(r, nameOf(id))
  return { alsoIn, basis }
}

/** Set by designs(): the carry-over plan, for the heading and the default design. */
let plan: { entries: BodyEntry[]; basis: Map<string, string> } | undefined

/** Headlight centres left and right, from the lamp faces' vertices. */
function lampCentres(root: THREE.Object3D, materials: THREE.Material[]): THREE.Vector3[] {
  const sums = [new THREE.Vector3(), new THREE.Vector3()], counts = [0, 0], v = new THREE.Vector3()
  root.updateWorldMatrix(true, true)
  root.traverse(o => {
    if (!(o instanceof THREE.Mesh) || !materials.includes(o.material as THREE.Material)) return
    const p = o.geometry.attributes.position
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); const side = v.x < 0 ? 0 : 1; sums[side].add(v); counts[side]++ }
  })
  return sums.flatMap((s, i) => counts[i] ? [s.divideScalar(counts[i])] : [])
}

export const buggy: LabExhibit = {
  id: 'buggy',
  title: 'Next Mira buggy',
  section: 'Design studies',
  order: 1,
  groupLabel: 'Round',
  // Body studies, not the game's buggy: the in-game physics parameters do nothing here.
  paramGroups: [],
  heading(group) {
    const basis = group === undefined ? undefined : plan?.basis.get(group)
    return basis ? `Next Mira buggy: round ${group}, built on ${basis}` : `Next Mira buggy: round ${group ?? 1} body studies`
  },
  // A round opens on its first new design, not on the pick carried into it.
  defaultDesign: group => plan?.entries.find(e => String(e.round) === group)?.id,

  async designs(): Promise<LabDesignInfo[]> {
    const all = await bodies()
    const { alsoIn, basis } = carryOver(all)
    plan = { entries: all, basis }
    const nameOf = (id: string) => all.find(e => e.id === id)?.name ?? id
    return all.map(b => {
      const notes = [...b.notes]
      if (b.basedOn) notes.unshift(`Built on ${nameOf(b.basedOn)}`)
      if (b.gameResolution !== undefined) notes.push(`${b.triangles.toLocaleString('en-GB')} body triangles: ${b.gameResolution ? 'ships at this detail' : 'smoothed for review, not game detail'}`)
      const carried = alsoIn.get(b.id)
      if (carried) notes.unshift(`Your round ${b.round} pick; round ${carried.join(', ')} ${carried.length > 1 ? 'build' : 'builds'} on it`)
      return { id: b.id, name: b.name, notes, group: String(b.round), alsoIn: carried }
    })
  },

  async build(design, ctx): Promise<LabModel> {
    const entry = (await bodies()).find(b => b.id === design.id)!
    ctx.status(`Loading ${design.name}…`)
    const [gltf, wheelChoices, glb] = await Promise.all([loader.loadAsync(`${MODELS}/${entry.file}`), wheelOptions(), buggyGlb()])
    const mats = new DesignMaterials()
    const object = new THREE.Group()
    object.name = design.id

    // DESIGN BUILD. A body may bring its own strut, modelled in the Axle's frame; it replaces
    // the original for this design. Sockets and everything else stay part of the body.
    const strutNode = gltf.scene.getObjectByName('Strut')
    const strut = strutNode
      ? { parts: bake(strutNode, { relative: true }), role: 'body' as Role }
      : { parts: bake(glb.scene.getObjectByName('Axle')!), role: 'hub' as Role }
    strutNode?.removeFromParent()
    const canopy: THREE.Object3D[] = []
    const loaded = new Set<THREE.Material>()
    gltf.scene.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      const src = o.material as THREE.Material
      loaded.add(src)
      o.material = mats.get(src, 'body')
      o.castShadow = o.receiveShadow = true
      if (mats.glass.has(o.material)) { o.renderOrder = 2; canopy.push(o); o.userData.glass = o.material; o.castShadow = false }
    })
    // CANOPY. The owner's design is a force field, not glass; glass stays as a comparison.
    const setCanopy = (field: boolean) => { for (const o of canopy) (o as THREE.Mesh).material = field ? mats.field.material : o.userData.glass as THREE.Material }
    mats.resetColors()
    setCanopy(true)
    // The glb's own materials only lent their names and colours.
    for (const m of loaded) m.dispose()
    object.add(gltf.scene)

    const beams = addHeadlightBeams(object, lampCentres(gltf.scene, mats.head))
    let level = 0
    const wanted = new URLSearchParams(location.search).get('wheels')
    let choice = Math.max(0, wheelChoices.findIndex(w => w.id === wanted))
    let wheels = new WheelSet(await wheelChoices[choice].load(), strut, mats)
    object.add(wheels.group)
    let lastState: LabState | undefined

    const canopyControl: LabControl = {
      kind: 'cycle', id: 'buggy.canopy', label: 'Canopy', group: 'Canopy', options: ['Force field', 'Glass'], index: 0,
      onChange(i) { setCanopy(i === 0) },
    }
    const controls: LabControl[] = wheelChoices.length < 2 ? [canopyControl] : [canopyControl, {
      kind: 'cycle', id: 'buggy.wheels', label: 'Tyres', group: 'Wheels', options: wheelChoices.map(w => w.name), index: choice,
      onChange(i) {
        choice = i
        void wheelChoices[i].load().then(parts => {
          if (choice !== i) return
          wheels.group.removeFromParent()
          wheels = new WheelSet(parts, strut, mats)
          wheels.setLod(level)
          if (lastState) wheels.update(0, lastState)
          object.add(wheels.group)
        }, error => console.error(error))
      },
    }]

    return {
      object,
      groundY: GROUND_Y,
      lods: ['Near', 'Far'],
      lodDistances: [30],
      setLod(i) { level = i; wheels.setLod(i) },
      setColors: (body, accent) => mats.setColors(body, accent),
      resetColors: () => mats.resetColors(),
      update(dt, state) {
        lastState = state
        wheels.update(dt, state)
        updateLamps(state, mats.head, mats.tail)
        beams.update(state)
      },
      cockpit: { eye: EYE, hide: canopy },
      controls,
      dispose() {
        beams.dispose()
        // Wheel and strut geometry is shared between designs; only the body's is this design's.
        gltf.scene.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
        mats.dispose()
      },
    }
  },
}
