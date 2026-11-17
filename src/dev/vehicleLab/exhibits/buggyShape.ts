/**
 * Buggy shape editor: the generated buggy with a slider per named shape handle
 * (src/vehicles/buggygen/shape), regenerating as you drag. By default it shows the whole buggy
 * as the game builds it (Syn3hBuggySkin with the shaped body and the parts that follow it:
 * lenses in their ducts, canopy and tub on the cockpit rim; wheels, arms and shocks fixed); a
 * switch shows the body alone. A seed slider picks a random in-range buggy, a switch resets to
 * the fitted body, and the shape rides in the URL as a share code:
 * vehicle-lab.html?vehicle=buggy-shape&shape=<code> (or &seed=<n>, &body=1 for the body alone).
 * R&D for the in-game vehicle editor, not the game's buggy.
 */
import * as THREE from 'three/webgpu'
import { previewMaterials, updateLamps } from '../materials'
import type { LabControl, LabExhibit } from '../types'
import type { VehicleDetail } from '../../../vehicles/skins/mergeStatic'
import type { BuggySkin } from '../../../vehicles/skins/BuggySkin'
import { HANDLES, clampShape, defaultShape, shapedBody, shapedSource, seedShape, encodeShape, decodeShape, type Shape } from '../../../vehicles/buggygen/shape'

const BODY = 0xb3140f, ACCENT = 0xf0c020
/** Wheel rest position as Syn3hBuggySkin's LAYOUT. */
const REST = new THREE.Vector3(1.1, -.2, 1.3)

/** Triangles drawn by the visible meshes under `root` (instanced meshes count every copy). */
function visibleTriangles(root: THREE.Object3D): number {
  let n = 0
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return
    const m = o as THREE.Mesh
    if (m.isMesh) {
      const g = m.geometry, count = (g.index ? g.index.count : g.attributes.position.count) / 3
      n += count * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1)
    }
    o.children.forEach(walk)
  }
  walk(root)
  return n
}

export const buggyShape: LabExhibit = {
  section: 'Design studies',
  id: 'buggy-shape',
  title: 'Syn3h buggy shape editor',
  async designs() {
    return [{ id: 'editable', name: 'Editable buggy', notes: [`The cage body with ${HANDLES.length} named handles; sculpted features move rigidly`, 'Drag a slider; the buggy regenerates', 'Seed picks a random buggy; the URL carries a share code', 'Whole buggy by default; a switch shows the body alone'] }]
  },
  async build() {
    const { Syn3hBuggySkin } = await import('../../../vehicles/skins/Syn3hBuggySkin')
    const m = previewMaterials(BODY, ACCENT)
    const byRole: Record<string, THREE.Material> = { paint: m.paint, accent: m.accent, chrome: m.chrome, lamp: m.headlight, frame: m.dark }
    const object = new THREE.Group(), callbacks = new Set<VehicleDetail>()
    object.userData.registerVehicleDetail = (fn: VehicleDetail) => { callbacks.add(fn); return () => callbacks.delete(fn) }
    const query = new URLSearchParams(location.search)
    let shape: Shape = query.get('shape') ? decodeShape(query.get('shape')!) : query.get('seed') ? seedShape(Number(query.get('seed'))) : defaultShape()
    let bodyOnly = query.get('body') === '1', detail: 0 | 1 = 0, meshes: THREE.Mesh[] = [], skin: BuggySkin | undefined
    let colours: [THREE.ColorRepresentation, THREE.ColorRepresentation] = [BODY, ACCENT]

    // Live readout over the stage: regeneration time, triangles and the share code.
    const readout = document.createElement('div')
    readout.style.cssText = 'position:fixed;left:12px;bottom:12px;padding:6px 10px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font:12px/1.4 system-ui,sans-serif;z-index:5;pointer-events:none'
    document.body.append(readout)
    const clear = () => {
      for (const old of meshes) { old.geometry.dispose(); object.remove(old) }
      meshes = []
      if (skin) { object.remove(skin.object); skin.dispose(); skin = undefined }
    }
    const report = (text: string) => {
      const code = encodeShape(shape)
      readout.textContent = `${text}, share code ${code}`
      const url = new URL(location.href); url.searchParams.set('shape', code); url.searchParams.delete('seed')
      history.replaceState(history.state, '', url)
    }

    // Edits arrive faster than a whole buggy builds: keep only the latest.
    let pending: Promise<void> = Promise.resolve(), wanted = 0
    const regenerate = (): Promise<void> => {
      const ticket = ++wanted
      pending = pending.then(async () => {
        if (ticket !== wanted) return
        if (bodyOnly) {
          const t0 = performance.now()
          const parts = shapedBody(shape, detail)
          const ms = performance.now() - t0
          clear()
          meshes = parts.map(p => { const mesh = new THREE.Mesh(p.geometry, byRole[p.role] ?? m.paint); mesh.castShadow = mesh.receiveShadow = true; object.add(mesh); return mesh })
          const triangles = parts.reduce((n, p) => n + p.geometry.getAttribute('position').count / 3, 0)
          report(`Body regenerated in ${ms.toFixed(1)} ms, ${triangles} triangles`)
          return
        }
        const t0 = performance.now()
        const next = new Syn3hBuggySkin(shapedSource(shape))
        clear()
        skin = next
        object.add(next.object)
        await next.ready
        const ms = performance.now() - t0
        const position = new THREE.Vector3()
        for (let i = 0; i < 4; i++) next.setWheel(i, position.set(i % 2 ? REST.x : -REST.x, REST.y, i < 2 ? -REST.z : REST.z), 0, 0)
        next.setColors(colours[0], colours[1])
        callbacks.forEach(fn => fn(detail ? 60 : 0, true, 2))
        report(`Buggy regenerated in ${ms.toFixed(1)} ms, ${visibleTriangles(next.object)} triangles`)
      })
      return pending
    }
    await regenerate()
    // For scripts (tools/buggy-fit/shape/lab-sheet.mjs): resolves when the latest edit is built.
    Object.assign(window, { buggyShapeSettled: () => pending })

    /** The lab draws each slider once; after a seed or reset, move the drawn sliders to match. */
    const syncSliders = () => {
      for (const h of HANDLES) {
        const c = controls.find(x => x.id === `shape.${h.id}`); if (c?.kind === 'slider') c.value = shape[h.id]
        for (const label of document.querySelectorAll('label')) if (label.textContent === h.label && label.htmlFor) {
          const input = document.getElementById(label.htmlFor) as HTMLInputElement | null
          if (!input) continue
          input.value = String(shape[h.id])
          const out = input.parentElement?.querySelector('output'); if (out) out.textContent = String(+shape[h.id].toFixed(3))
        }
      }
    }

    const controls: LabControl[] = [
      ...HANDLES.map((h): LabControl => ({ kind: 'slider', id: `shape.${h.id}`, label: h.label, group: 'Shape', min: h.min, max: h.max, step: h.step, value: shape[h.id], onChange: v => { shape = clampShape({ ...shape, [h.id]: v }); void regenerate() } })),
      { kind: 'slider', id: 'shape.seed', label: 'Random buggy (seed)', group: 'Shape tools', min: 0, max: 999, step: 1, value: 0, onChange: v => { shape = v ? seedShape(v) : defaultShape(); void regenerate(); syncSliders() } },
      { kind: 'toggle', id: 'shape.body', label: 'Body only', group: 'Shape tools', value: bodyOnly, onChange: on => { bodyOnly = on; void regenerate() } },
      // The lab has no button control, so the reset is a switch that acts when turned on and
      // then turns itself off, ready for the next reset.
      { kind: 'toggle', id: 'shape.reset', label: 'Fitted buggy (reset)', group: 'Shape tools', value: false, onChange: on => {
        if (!on) return
        shape = defaultShape(); void regenerate(); syncSliders()
        const reset = controls.find(x => x.id === 'shape.reset'); if (reset?.kind === 'toggle') reset.value = false
        for (const label of document.querySelectorAll('label.toggle')) if (label.querySelector('.label')?.textContent === 'Fitted buggy (reset)') {
          const input = label.querySelector('input'); if (input) input.checked = false
        }
      } },
    ]

    return {
      object,
      // The wheels stand on the floor at about -0.72 m; the body alone floats at the same height.
      groundY: -.72,
      lods: ['Near', 'Mid'],
      lodDistances: [30],
      setLod(index) { detail = index ? 1 : 0; void regenerate() },
      setColors(body, accent) { colours = [body, accent]; m.paint.color.set(body); m.accent.color.set(accent); skin?.setColors(body, accent) },
      resetColors() { colours = [BODY, ACCENT]; m.paint.color.set(BODY); m.accent.color.set(ACCENT); skin?.setColors(BODY, ACCENT) },
      update(_dt, state) { updateLamps(state, [m.headlight], [m.tail]); skin?.setLights?.(state.braking) },
      controls,
      dispose() { readout.remove(); clear(); Object.values(m).forEach(x => x.dispose()) },
    }
  },
}
