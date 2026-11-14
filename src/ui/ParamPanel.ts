/**
 * Slider panel generated from the parameter registry. Nothing here knows about any
 * particular parameter: define one anywhere and it appears, grouped by `def.group`.
 */
import { Pane, type FolderApi } from 'tweakpane'
import { params, type ParamValue } from '../../shared/params'

export class ParamPanel {
  readonly pane: Pane
  private readonly folders = new Map<string, FolderApi>()
  private readonly proxy: Record<string, ParamValue> = {}
  private readonly known = new Set<string>()

  constructor() {
    this.pane = new Pane({ title: 'World settings', expanded: false })
    this.pane.element.parentElement!.style.cssText += ';max-height:90vh;overflow-y:auto;width:300px;z-index:10'
    this.sync()
    // Reflect remote and preset changes in the UI.
    params.onChange((id, value, source) => {
      if (source === 'local') return
      this.proxy[id] = value
      this.pane.refresh()
    })
  }

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
      folder.addBinding(this.proxy, id, opts).on('change', (ev) => {
        // Deferred parameters apply on release, e.g. terrain regeneration.
        if (deferred && !ev.last) return
        params.set(id, ev.value, 'local')
      })
    }
  }
}
