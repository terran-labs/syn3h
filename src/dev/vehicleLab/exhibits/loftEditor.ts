/**
 * Loft body editor: the section-loft buggy body (src/vehicles/buggygen/sections) with a slider
 * per editor handle, grouped as a person would look for them (Stance, Hull lines, Cockpit,
 * Scoops, Lamps, Wing), regenerating as you drag. Proof of concept for a player-facing vehicle
 * designer built on a true generator.
 *
 *   vehicle-lab.html?vehicle=loft-editor                         the fitted buggy body
 *   vehicle-lab.html?vehicle=loft-editor&loft=<code>             a shared design
 *   vehicle-lab.html?vehicle=loft-editor&seed=<n>                a random design
 *   vehicle-lab.html?vehicle=loft-editor&design=crawler          a preset (streamliner, crawler, wedge)
 *   ...&full=1                                                   on the whole generated buggy
 *
 * "Body" regenerates the shell alone on every drag. "Whole buggy" rebuilds the game's skin (Syn3hBuggySkin)
 * (wheels, arms, shocks, canopy and fittings cast onto this body) and is slower.
 */
import * as THREE from 'three/webgpu'
import { previewMaterials, updateLamps } from '../materials'
import type { LabControl, LabExhibit, LabModel } from '../types'
import type { BuggySkin } from '../../../vehicles/skins/BuggySkin'
import type { VehicleDetail } from '../../../vehicles/skins/mergeStatic'
import { buildLoft } from '../../../vehicles/buggygen/sections/design'
import { EDITOR_HANDLES, PRESETS, applyHandles, clampHandles, decodeHandles, defaultHandles, encodeHandles, seedHandles, type Handles } from '../../../vehicles/buggygen/sections/editor'

const BODY = 0x1768b4, ACCENT = 0x49e6ff
/** Wheel rest position as the buggy skin's layout; driver's eye as Syn3hBuggy's RIDE_HEIGHT. */
const REST = new THREE.Vector3(1.1, -.2, 1.3), RIDE_HEIGHT = .8

export const loftEditor: LabExhibit = {
  section: 'Design studies',
  id: 'loft-editor',
  title: 'Loft body editor',
  async designs() {
    return [
      { id: 'buggy', name: 'Buggy (fitted)', notes: ['The loft body as fitted to the buggy.', 'Drag a slider: the body regenerates.', 'Seed picks a random design; the URL carries a share code.'] },
      ...Object.entries(PRESETS).map(([id, p]) => ({ id, name: p.name, notes: [p.notes, 'Handle values only, on the buggy\'s wheels and cockpit.'] })),
    ]
  },
  async build(info, ctx): Promise<LabModel> {
    const query = new URLSearchParams(location.search)
    let handles: Handles = info.id !== 'buggy' ? clampHandles(PRESETS[info.id].handles)
      : query.get('loft') ? decodeHandles(query.get('loft')!) : query.get('seed') ? seedHandles(Number(query.get('seed'))) : defaultHandles()
    let full = query.get('full') === '1'
    const m = previewMaterials(BODY, ACCENT)
    const byRole: Record<string, THREE.Material> = { paint: m.paint, accent: m.accent, chrome: m.chrome, lamp: m.headlight, frame: m.dark, trim: m.dark }
    const object = new THREE.Group(), callbacks = new Set<VehicleDetail>()
    object.userData.registerVehicleDetail = (fn: VehicleDetail) => { callbacks.add(fn); return () => callbacks.delete(fn) }
    let meshes: THREE.Mesh[] = [], skin: BuggySkin | undefined, building = 0
    const { Syn3hBuggySkin } = await import('../../../vehicles/skins/Syn3hBuggySkin')

    const readout = document.createElement('div')
    readout.style.cssText = 'position:fixed;left:12px;bottom:12px;padding:6px 10px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font:12px/1.4 system-ui,sans-serif;z-index:5;pointer-events:none'
    document.body.append(readout)
    const writeUrl = () => {
      const url = new URL(location.href); url.searchParams.set('loft', encodeHandles(handles)); url.searchParams.delete('seed')
      if (full) url.searchParams.set('full', '1'); else url.searchParams.delete('full')
      history.replaceState(history.state, '', url)
    }

    const regenerate = async () => {
      const ticket = ++building, design = applyHandles(handles), t0 = performance.now()
      const parts = buildLoft(design, 0), bodyMs = performance.now() - t0
      const bodyTris = parts.reduce((n, p) => n + (p.geometry.getIndex()?.count ?? p.geometry.getAttribute('position').count) / 3, 0)
      let text = `Body regenerated in ${bodyMs.toFixed(1)} ms, ${bodyTris} triangles`
      for (const old of meshes) { old.geometry.dispose(); object.remove(old) }
      meshes = []
      if (full) {
        ctx.status('Building the whole buggy')
        const t1 = performance.now(), next = new Syn3hBuggySkin({ build: d => buildLoft(design, d) })
        await next.ready
        if (ticket !== building) { next.dispose(); return }
        skin?.dispose(); if (skin) object.remove(skin.object)
        skin = next; object.add(skin.object)
        for (let i = 0; i < 4; i++) skin.setWheel(i, new THREE.Vector3(i % 2 ? REST.x : -REST.x, REST.y, i < 2 ? -REST.z : REST.z), 0, 0)
        callbacks.forEach(fn => fn(0, true, 2))
        let tris = 0
        skin.object.traverseVisible(o => { const g = (o as THREE.Mesh).geometry; if ((o as THREE.Mesh).isMesh && g) tris += ((g.getIndex()?.count ?? g.getAttribute('position').count) / 3) * ((o as THREE.InstancedMesh).count ?? 1) })
        text += `; whole buggy built in ${(performance.now() - t1).toFixed(0)} ms, ${Math.round(tris)} triangles`
      } else {
        if (skin) { object.remove(skin.object); skin.dispose(); skin = undefined }
        meshes = parts.map(p => { const mesh = new THREE.Mesh(p.geometry, byRole[p.role] ?? m.paint); mesh.castShadow = mesh.receiveShadow = true; object.add(mesh); return mesh })
      }
      readout.textContent = `${text}; share code ${encodeHandles(handles)}`
      writeUrl()
    }
    await regenerate()

    /** The lab draws each slider once; after a seed or reset, move the drawn sliders to match. */
    const syncSliders = () => {
      for (const h of EDITOR_HANDLES) {
        const c = controls.find(x => x.id === `loft.${h.id}`); if (c?.kind === 'slider') c.value = handles[h.id]
        for (const label of document.querySelectorAll('label')) if (label.textContent === h.label && label.htmlFor) {
          const input = document.getElementById(label.htmlFor) as HTMLInputElement | null
          if (!input) continue
          input.value = String(handles[h.id])
          const out = input.parentElement?.querySelector('output'); if (out) out.textContent = String(+handles[h.id].toFixed(3))
        }
      }
    }
    const set = (next: Handles) => { handles = next; syncSliders(); void regenerate() }
    const controls: LabControl[] = [
      { kind: 'cycle', id: 'loft.view', label: 'Show', group: 'Design', options: ['Body', 'Whole buggy'], index: full ? 1 : 0, onChange: i => { full = i === 1; void regenerate() } },
      { kind: 'slider', id: 'loft.seed', label: 'Random design (seed)', group: 'Design', min: 0, max: 999, step: 1, value: 0, onChange: v => set(v ? seedHandles(v) : defaultHandles()) },
      { kind: 'toggle', id: 'loft.reset', label: 'Fitted buggy (reset)', group: 'Design', value: false, onChange: () => set(defaultHandles()) },
      ...EDITOR_HANDLES.map((h): LabControl => ({ kind: 'slider', id: `loft.${h.id}`, label: h.label, group: h.group, min: h.min, max: h.max, step: h.step, value: handles[h.id], onChange: v => { handles = { ...handles, [h.id]: v }; void regenerate() } })),
    ]

    return {
      object,
      // Hub height less the tyre's 0.52 m radius; the body alone sits at the same height.
      groundY: -.72,
      setColors(body, accent) { m.paint.color.set(body); m.accent.color.set(accent); skin?.setColors(body, accent) },
      resetColors() { m.paint.color.set(BODY); m.accent.color.set(ACCENT); skin?.setColors(BODY, ACCENT) },
      update(_dt, state) { updateLamps(state, [m.headlight], [m.tail]); skin?.setLights?.(state.braking) },
      cockpit: { eye: new THREE.Vector3(0, RIDE_HEIGHT, 0) },
      controls,
      dispose() { readout.remove(); for (const mesh of meshes) mesh.geometry.dispose(); skin?.dispose(); Object.values(m).forEach(x => x.dispose()) },
    }
  },
}
