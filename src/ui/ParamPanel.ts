import { logSlider } from './logSlider'
import { scaleCaption } from '../../shared/paramScale'
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
  private readonly logControls = new Map<string, { input: HTMLInputElement; sync(value: number): void }>()
  private readonly known = new Set<string>()
  /** True while the panel is being refreshed from the registry; see the constructor. */
  private refreshing = false

  constructor() {
    this.element.className = 'syn3h-advanced'; this.element.hidden = true; document.body.append(this.element)
    this.pane = new Pane({ title: 'Advanced settings', expanded: false, container: this.element })
    this.sync()
    // Reflect remote and preset changes in the UI.
    this.unsubscribe = params.onChange((id, value) => {
      this.proxy[id] = value
      this.logControls.get(id)?.sync(Number(value))
      // Refreshing makes a slider re-emit its value, snapped to its own grid. That is the
      // panel repeating what it was just told, not a person moving a slider: without this
      // guard it came back as a local change with a slightly different value (120 as 121,
      // 0.2 as 0.19999999999999998), so a world taken from a room drifted on this client only.
      this.refreshing = true
      try { this.pane.refresh() } finally { this.refreshing = false }
    })
  }

  show(parent?: HTMLElement): void {
    if (parent) parent.append(this.element)
    this.sync(); this.setWorldEditable(canEditWorld()); this.element.hidden = false; this.pane.expanded = true
  }
  hide(): void { this.element.hidden = true }
  /**
   * Show only these slider groups, opened, or every group when called with nothing. The
   * custom planet uses it to offer just the sliders that shape a world.
   */
  setGroups(groups?: readonly string[]): void {
    for (const [title, folder] of this.folders) {
      folder.hidden = Boolean(groups) && !groups!.includes(title)
      folder.expanded = Boolean(groups) && groups!.includes(title)
    }
  }
  setWorldEditable(editable: boolean): void {
    for (const [id, binding] of this.bindings) {
      const disabled = !editable && (params.get(id)?.def.scope === 'world' || id === 'sky.preset')
      binding.disabled = disabled
      const log = this.logControls.get(id); if (log) log.input.disabled = disabled
    }
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
        p.def.scale !== 'log' && typeof p.def.default === 'number' && min !== undefined && max !== undefined
          ? { label, min: Math.min(min, max), max: Math.max(min, max), step }
          : { label }
      const binding = folder.addBinding(this.proxy, id, opts).on('change', (ev) => {
        if (this.refreshing) return
        if (!canEditWorld() && (p.def.scope === 'world' || id === 'sky.preset')) { this.proxy[id] = p.value; this.pane.refresh(); return }
        // Deferred parameters apply on release, e.g. terrain regeneration.
        if (deferred && !ev.last) return
        params.set(id, ev.value, 'local')
      })
      this.bindings.set(id, binding)
      if (p.def.scale === 'log') {
        // Keep the native exact-number field in seconds and add a mapped range below it.
        const wrap = document.createElement('div'); wrap.className = 'param-log-control'
        const input = document.createElement('input'); input.type = 'range'; input.setAttribute('aria-label', label)
        const caption = document.createElement('small'); caption.textContent = scaleCaption(p.def)
        wrap.append(input, caption); binding.element.append(wrap)
        const sync = logSlider(input, p.def, () => Number(p.value), value => { if (p.def.scope !== 'world' || canEditWorld()) params.set(id, value, 'local') }, deferred)
        this.logControls.set(id, { input, sync })
      }
    }
  }
}
