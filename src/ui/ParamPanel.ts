/**
 * Slider panel generated from the parameter registry. Nothing here knows about any
 * particular parameter: define one anywhere and it appears, grouped by `def.group`.
 */
import { Pane, type FolderApi } from 'tweakpane'
import { canEditWorld } from './worldPermissions'
import { params, type ParamValue } from '../../shared/params'

export class ParamPanel {
  readonly pane: Pane
  readonly element = document.createElement('div')
  private readonly bindings = new Map<string, { disabled: boolean }>()
  private readonly unsubscribe: () => void
  private readonly folders = new Map<string, FolderApi>()
  private readonly proxy: Record<string, ParamValue> = {}
  private readonly known = new Set<string>()

  constructor() {
    this.element.className = 'syn3h-advanced'; this.element.hidden = true; document.body.append(this.element)
    this.pane = new Pane({ title: 'Advanced settings', expanded: false, container: this.element })
    this.sync()
    // Reflect remote and preset changes in the UI.
    this.unsubscribe = params.onChange((id, value) => {
      this.proxy[id] = value
      this.pane.refresh()
    })
  }

  show(parent?: HTMLElement): void {
    if (parent) parent.append(this.element)
    this.sync(); this.setWorldEditable(canEditWorld()); this.element.hidden = false; this.pane.expanded = true
  }
  hide(): void { this.element.hidden = true }
  setWorldEditable(editable: boolean): void {
    for (const [id, binding] of this.bindings) binding.disabled = !editable && (params.get(id)?.def.scope === 'world' || id === 'sky.preset')
  }
  dispose(): void { this.unsubscribe(); this.pane.dispose(); this.element.remove() }

  /** Add controls for any parameters defined since the last call. */
  sync(): void {
    for (const p of params.all()) {
      const { id, group, label, min, max, step, deferred } = p.def
      if (this.known.has(id)) continue
      this.known.add(id)
      let folder = this.folders.get(group)
      if (!folder) {
        folder = this.pane.addFolder({ title: group, expanded: false })
        this.folders.set(group, folder)
      }
      this.proxy[id] = p.value
      const opts =
        typeof p.def.default === 'number' && min !== undefined && max !== undefined
          ? { label, min: Math.min(min, max), max: Math.max(min, max), step }
          : { label }
      const binding = folder.addBinding(this.proxy, id, opts).on('change', (ev) => {
        if (!canEditWorld() && (p.def.scope === 'world' || id === 'sky.preset')) { this.proxy[id] = p.value; this.pane.refresh(); return }
        // Deferred parameters apply on release, e.g. terrain regeneration.
        if (deferred && !ev.last) return
        params.set(id, ev.value, 'local')
      })
      this.bindings.set(id, binding)
    }
  }
}
