/**
 * Buggy shape editor: the generated cage body with a slider per named shape handle
 * (src/vehicles/buggygen/shape), regenerating as you drag. A seed slider picks a random
 * in-range buggy, a switch resets to the fitted body, and the shape rides in the URL as a
 * share code: vehicle-lab.html?vehicle=buggy-shape&shape=<code> (or &seed=<n>).
 * Proof of concept for the in-game vehicle editor; R&D, not the game's buggy.
 */
import * as THREE from 'three/webgpu'
import { previewMaterials, updateLamps } from '../materials'
import type { LabControl, LabExhibit } from '../types'
import { HANDLES, defaultShape, shapedBody, seedShape, encodeShape, decodeShape, type Shape } from '../../../vehicles/buggygen/shape'

const BODY = 0xb3140f, ACCENT = 0xf0c020

export const buggyShape: LabExhibit = {
  section: 'Design studies',
  id: 'buggy-shape',
  title: 'Syn3h buggy shape editor',
  async designs() {
    return [{ id: 'editable', name: 'Editable body', notes: ['The cage body with 15 named handles', 'Drag a slider; the body regenerates', 'Seed picks a random buggy; the URL carries a share code', 'Body only: no wheels, arms or canopy'] }]
  },
  async build() {
    const m = previewMaterials(BODY, ACCENT)
    const byRole: Record<string, THREE.Material> = { paint: m.paint, accent: m.accent, chrome: m.chrome, lamp: m.headlight, frame: m.dark }
    const object = new THREE.Group()
    const query = new URLSearchParams(location.search)
    let shape: Shape = query.get('shape') ? decodeShape(query.get('shape')!) : query.get('seed') ? seedShape(Number(query.get('seed'))) : defaultShape()
    let detail: 0 | 1 | 2 = 0, meshes: THREE.Mesh[] = []

    // Live readout over the stage: regeneration time, triangles and the share code.
    const readout = document.createElement('div')
    readout.style.cssText = 'position:fixed;left:12px;bottom:12px;padding:6px 10px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font:12px/1.4 system-ui,sans-serif;z-index:5;pointer-events:none'
    document.body.append(readout)

    const regenerate = () => {
      const t0 = performance.now()
      const parts = shapedBody(shape, detail)
      const ms = performance.now() - t0
      for (const old of meshes) { old.geometry.dispose(); object.remove(old) }
      meshes = parts.map(p => { const mesh = new THREE.Mesh(p.geometry, byRole[p.role] ?? m.paint); mesh.castShadow = mesh.receiveShadow = true; object.add(mesh); return mesh })
      const triangles = parts.reduce((n, p) => n + p.geometry.getAttribute('position').count / 3, 0)
      const code = encodeShape(shape)
      readout.textContent = `Regenerated in ${ms.toFixed(1)} ms, ${triangles} triangles, share code ${code}`
      const url = new URL(location.href); url.searchParams.set('shape', code); url.searchParams.delete('seed')
      history.replaceState(history.state, '', url)
    }
    regenerate()

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
      ...HANDLES.map((h): LabControl => ({ kind: 'slider', id: `shape.${h.id}`, label: h.label, group: 'Shape', min: h.min, max: h.max, step: h.step, value: shape[h.id], onChange: v => { shape = { ...shape, [h.id]: v }; regenerate() } })),
      { kind: 'slider', id: 'shape.seed', label: 'Random buggy (seed)', group: 'Shape tools', min: 0, max: 999, step: 1, value: 0, onChange: v => { shape = v ? seedShape(v) : defaultShape(); regenerate(); syncSliders() } },
      { kind: 'toggle', id: 'shape.reset', label: 'Fitted buggy (reset)', group: 'Shape tools', value: false, onChange: () => { shape = defaultShape(); regenerate(); syncSliders() } },
    ]

    return {
      object,
      // The cage body's floor is at about -0.08 m; the wheels are not part of this exhibit.
      groundY: -.1,
      lods: ['Near', 'Mid'],
      lodDistances: [30],
      setLod(index) { detail = index ? 1 : 0; regenerate() },
      setColors(body, accent) { m.paint.color.set(body); m.accent.color.set(accent) },
      resetColors() { m.paint.color.set(BODY); m.accent.color.set(ACCENT) },
      update(_dt, state) { updateLamps(state, [m.headlight], [m.tail]) },
      controls,
      dispose() { readout.remove(); for (const mesh of meshes) mesh.geometry.dispose(); Object.values(m).forEach(x => x.dispose()) },
    }
  },
}
