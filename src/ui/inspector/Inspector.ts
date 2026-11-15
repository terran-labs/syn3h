/**
 * The world inspector: every property of the world and of your own settings, in play, as a
 * stack of frosted glass cards down the right edge. One card per logical section; inside an
 * open card the groups are an accordion; touching a property shows what it is for, its
 * limits and whether it is shared. A world can be copied as JSON and pasted back in.
 *
 * It is built from the parameter registry and knows no particular property: define one
 * anywhere and it appears. The data side is model.ts, which has no DOM and is tested alone.
 */
import { params, type ParamValue } from '../../../shared/params'
import { canEditWorld, resetWorld } from '../worldPermissions'
import { buildTree, describe, exportSection, exportWorld, fraction, limits, parseWorld, pasteSummary, show, type PropertyDef, type SectionNode } from './model'
import './params'
import './inspector.css'

export interface InspectorOptions {
  /** One line for a closed card, for example "Alpine · Harimos". Empty hides it. */
  summary(sectionId: string): string
  /** The vehicles on offer and which is in use, for the switcher in the Vehicles card. */
  vehicles(): { options: readonly { id: string; label: string }[]; current: string }
  onVehicle(id: string): void
  /** Capture a local bookmark. The caller owns storage and success or failure feedback. */
  onSaveWorld?(): void
}
/** "Mode (0 tag, 1 hill)" or "Glass: 0 Clear, 1 Frosted" gives a name and named choices. */
export function choicesOf(def: PropertyDef): { name: string; options: { value: number; label: string }[] } | null {
  if (typeof def.default !== 'number' || def.min === undefined || def.max === undefined || def.step !== 1) return null
  const found = [...def.label.matchAll(/(\d+)\s+([A-Za-z][A-Za-z ]*?)(?=\s*(?:,|\)|$|\d+\s))/g)].map(m => ({ value: Number(m[1]), label: m[2].trim() }))
  const lo = Math.min(def.min, def.max), hi = Math.max(def.min, def.max)
  if (found.length < 2 || found.length !== hi - lo + 1 || found.some((option, i) => option.value !== lo + i)) return null
  const name = def.label.slice(0, def.label.search(/\d/)).replace(/[\s:(]+$/, '')
  return { name: name || def.group, options: found.map(option => ({ value: option.value, label: option.label[0].toUpperCase() + option.label.slice(1) })) }
}

export class Inspector {
  readonly element = document.createElement('aside')
  private tree: SectionNode[] = []
  private known = 0
  private selected = ''
  private tooltip!: HTMLElement
  private tooltipTimer?: ReturnType<typeof setTimeout>
  private readonly abort = new AbortController()
  private readonly rows = new Map<string, { row: HTMLElement; sync(value: ParamValue): void; def: PropertyDef }>()
  private readonly unsubscribe: () => void
  private editable = true
  private armed?: ReturnType<typeof setTimeout>
  private pasteTarget: string | null = null
  private beforeSearch?: { cards: boolean[]; folds: boolean[] }

  constructor(parent: HTMLElement, private readonly options: InspectorOptions) {
    this.element.className = 'world-inspector'; this.element.setAttribute('aria-label', 'World inspector')
    this.element.innerHTML = `<div class="wi-top wi-glass"><input class="wi-search" type="search" placeholder="Find a setting" aria-label="Find a setting" autocomplete="off" spellcheck="false">
      <div class="wi-actions"><button type="button" data-wi="copy-world">Copy world</button><button type="button" data-wi="paste-world">Paste world</button><button type="button" data-wi="reset">Reset</button></div></div>
      <div class="wi-cards"></div>
      <div class="wi-detail wi-glass" hidden></div>
      <div class="wi-sheet wi-glass" hidden><strong></strong><textarea spellcheck="false" aria-label="World as JSON"></textarea><div class="wi-actions"><button type="button" data-wi="apply">Paste it in</button><button type="button" data-wi="close">Close</button></div></div>
      <p class="wi-status" role="status" aria-live="polite"></p>`
    parent.append(this.element)
    this.tooltip = this.element.querySelector<HTMLElement>('.wi-detail')!
    this.tooltip.classList.add('wi-tooltip'); this.tooltip.id = 'setting-tooltip'; this.tooltip.setAttribute('role', 'tooltip')
    parent.append(this.tooltip)
    const signal = this.abort.signal
    this.tooltip.addEventListener('pointerenter', () => clearTimeout(this.tooltipTimer), { signal })
    this.tooltip.addEventListener('pointerleave', () => this.hideTooltip(), { signal })
    this.tooltip.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') this.hideTooltip() }, { signal })
    this.element.addEventListener('scroll', () => this.hideTooltip(), { capture: true, signal })
    window.addEventListener('resize', () => this.hideTooltip(), { signal })
    document.addEventListener('pointerdown', event => { if (!(event.target as Element).closest('.wi-row, .wi-tooltip')) this.hideTooltip() }, { signal })
    this.build()
    this.unsubscribe = params.onChange((id, value) => this.rows.get(id)?.sync(value))
    this.element.addEventListener('click', event => this.click(event))
    this.element.querySelector<HTMLInputElement>('.wi-search')!.addEventListener('input', event => this.search((event.target as HTMLInputElement).value))
    // Typing here must not drive the vehicle.
    for (const type of ['keydown', 'keyup'] as const) this.element.addEventListener(type, event => { if ((event.target as Element).matches('input[type=search], textarea, input[type=number]')) event.stopPropagation() })
  }
  get open(): boolean { return !this.element.hidden }
  set open(value: boolean) { this.element.hidden = !value; if (!value) this.hideTooltip() }

  /** Rebuild if properties have been defined since the last look; refresh summaries and locks. */
  update(): void {
    if (params.all().length !== this.known) this.build()
    const editable = canEditWorld()
    if (editable !== this.editable) { this.editable = editable; for (const { row, def } of this.rows.values()) if (def.scope === 'world') for (const control of row.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) control.disabled = !editable; this.element.classList.toggle('is-locked', !editable) }
    for (const card of this.element.querySelectorAll<HTMLElement>('.wi-card')) card.querySelector('.wi-sum')!.textContent = this.options.summary(card.dataset.section!) || `${this.tree.find(s => s.id === card.dataset.section)?.count ?? 0} properties`
    const vehicles = this.options.vehicles()
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-vehicle]')) button.classList.toggle('is-on', button.dataset.vehicle === vehicles.current)
  }
  private build(): void {
    const all = params.all(); this.known = all.length
    const open = new Set([...this.element.querySelectorAll<HTMLElement>('.wi-card.is-open')].map(card => card.dataset.section))
    this.tree = buildTree(all.map(p => p.def as PropertyDef))
    this.rows.clear()
    const cards = this.element.querySelector('.wi-cards')!; cards.replaceChildren()
    for (const section of this.tree) {
      const card = document.createElement('section'); card.className = 'wi-card wi-glass'; card.dataset.section = section.id
      const head = document.createElement('button'); head.type = 'button'; head.className = 'wi-head'; head.dataset.wi = 'toggle'; head.setAttribute('aria-expanded', 'false')
      head.innerHTML = '<h3></h3><span class="wi-sum"></span><span class="wi-chev" aria-hidden="true"></span>'; head.querySelector('h3')!.textContent = section.title
      const body = document.createElement('div'); body.className = 'wi-body'; body.hidden = true
      const blurb = document.createElement('p'); blurb.className = 'wi-blurb'; blurb.textContent = section.blurb; body.append(blurb)
      if (section.id === 'vehicles') body.append(this.vehicleSwitch())
      section.tree.forEach((group, index) => {
        const fold = document.createElement('details'); fold.className = 'wi-group'; fold.open = index === 0
        const summary = document.createElement('summary'); summary.innerHTML = '<span></span><small></small>'
        summary.querySelector('span')!.textContent = group.name; summary.querySelector('small')!.textContent = String(group.properties.length)
        fold.append(summary); for (const def of group.properties) fold.append(this.row(def)); body.append(fold)
      })
      const foot = document.createElement('div'); foot.className = 'wi-actions wi-foot'
      foot.innerHTML = '<button type="button" data-wi="copy-section">Copy JSON</button><button type="button" data-wi="paste-section">Paste</button>'
      if (section.id === 'world' && this.options.onSaveWorld) {
        const save = document.createElement('button'); save.type = 'button'; save.dataset.wi = 'save-world'; save.textContent = 'Save current world'
        // Saving a local copy does not edit the shared world, even for a locked guest.
        foot.append(save)
      }
      body.append(foot); card.append(head, body); cards.append(card)
      if (open.has(section.id)) this.toggle(card, true)
    }
    this.editable = !canEditWorld(); this.update()
  }
  private vehicleSwitch(): HTMLElement {
    const wrap = document.createElement('div'); wrap.className = 'wi-switch'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', 'Your vehicle')
    for (const option of this.options.vehicles().options) { const button = document.createElement('button'); button.type = 'button'; button.dataset.vehicle = option.id; button.textContent = option.label; wrap.append(button) }
    return wrap
  }
  private row(def: PropertyDef): HTMLElement {
    const row = document.createElement('div'); row.className = 'wi-row'; row.dataset.id = def.id
    const label = document.createElement('span'); label.className = 'wi-label'
    const output = document.createElement('output')
    const param = params.get(def.id)!, choices = choicesOf(def)
    let sync: (value: ParamValue) => void
    if (choices) {
      label.textContent = choices.name
      const seg = document.createElement('div'); seg.className = 'wi-seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', choices.name)
      for (const option of choices.options) { const button = document.createElement('button'); button.type = 'button'; button.dataset.value = String(option.value); button.textContent = option.label; button.addEventListener('click', () => params.set(def.id, option.value, 'local')); seg.append(button) }
      row.classList.add('is-choice'); row.append(label, seg)
      sync = value => { for (const button of seg.querySelectorAll<HTMLElement>('button')) button.classList.toggle('is-on', Number(button.dataset.value) === Math.round(Number(value))) }
    } else if (typeof def.default === 'boolean') {
      label.textContent = def.label
      const box = document.createElement('input'); box.type = 'checkbox'; box.setAttribute('aria-label', def.label)
      box.addEventListener('change', () => params.set(def.id, box.checked, 'local'))
      row.append(label, box, output)
      sync = value => { box.checked = Boolean(value); output.textContent = show(Boolean(value)) }
    } else {
      label.textContent = def.label
      const ranged = def.min !== undefined && def.max !== undefined
      const input = document.createElement('input'); input.type = ranged ? 'range' : 'number'; input.setAttribute('aria-label', def.label)
      if (ranged) { input.min = String(Math.min(def.min!, def.max!)); input.max = String(Math.max(def.min!, def.max!)) }
      input.step = String(def.step ?? 'any')
      // A property marked deferred (the terrain rebuilds) applies when the slider is let go.
      input.addEventListener(def.deferred ? 'change' : 'input', () => params.set(def.id, Number(input.value), 'local'))
      if (def.deferred) input.addEventListener('input', () => { output.textContent = show(Number(input.value), def) })
      row.append(label, input, output)
      sync = value => { if (document.activeElement !== input) input.value = String(value); output.textContent = show(value, def) }
    }
    sync(param.value)
    row.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') this.detail(def) })
    row.addEventListener('focusin', () => this.detail(def))
    row.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') this.detail(def) })
    row.addEventListener('pointerleave', () => { this.tooltipTimer = setTimeout(() => this.hideTooltip(), 160) })
    row.addEventListener('focusout', event => { if (!row.contains(event.relatedTarget as Node)) this.hideTooltip() })
    for (const control of row.querySelectorAll('input, button')) control.setAttribute('aria-describedby', 'setting-tooltip')
    this.rows.set(def.id, { row, sync, def })
    return row
  }
  hideTooltip(): void {
    clearTimeout(this.tooltipTimer); this.tooltip.hidden = true; this.selected = ''
    for (const { row } of this.rows.values()) row.classList.remove('is-selected')
  }
  /** A contextual tooltip beside the control, or above it when the viewport is narrow. */
  private detail(def: PropertyDef): void {
    clearTimeout(this.tooltipTimer)
    if (this.selected === def.id && !this.tooltip.hidden) return
    this.selected = def.id
    for (const { row } of this.rows.values()) row.classList.toggle('is-selected', row.dataset.id === def.id)
    const pane = this.tooltip, value = params.get(def.id)?.value ?? def.default, at = fraction(def, value), home = fraction(def, def.default)
    const choices = choicesOf(def)
    pane.replaceChildren()
    const head = document.createElement('div'); head.className = 'wi-detail-head'
    const name = document.createElement('strong'); name.textContent = choices?.name ?? def.label
    const scope = document.createElement('span'); scope.className = `wi-chip${def.scope === 'world' ? ' is-shared' : ''}`; scope.textContent = def.scope === 'world' ? 'shared with the room' : 'yours only'
    const id = document.createElement('code'); id.textContent = def.id
    head.append(name, scope, id); pane.append(head)
    const text = describe(def)
    if (text) { const p = document.createElement('p'); p.textContent = text; pane.append(p) }
    if (at !== null) {
      const bar = document.createElement('div'); bar.className = 'wi-guard'; bar.innerHTML = '<i></i><u></u><b></b>'
      bar.querySelector<HTMLElement>('i')!.style.width = `${at * 100}%`; bar.querySelector<HTMLElement>('b')!.style.left = `${at * 100}%`
      if (home !== null) bar.querySelector<HTMLElement>('u')!.style.left = `${home * 100}%`
      pane.append(bar)
    }
    const small = document.createElement('small'); small.textContent = limits(def); pane.append(small)
    pane.hidden = false
    const row = this.rows.get(def.id)!.row.getBoundingClientRect()
    const width = Math.min(280, innerWidth - 24)
    pane.style.width = `${width}px`
    const height = pane.getBoundingClientRect().height
    const fitsLeft = row.left > width + 24
    pane.style.left = `${fitsLeft ? row.left - width - 16 : Math.max(12, Math.min(innerWidth - width - 12, row.left))}px`
    pane.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, fitsLeft ? row.top : row.top - height - 12))}px`
  }
  private toggle(card: HTMLElement, open = !card.classList.contains('is-open')): void {
    card.classList.toggle('is-open', open); card.querySelector<HTMLElement>('.wi-body')!.hidden = !open; card.querySelector('.wi-head')!.setAttribute('aria-expanded', String(open))
  }
  private search(query: string): void {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    // A search opens whatever holds a match. Remember how things were, and put them back after.
    const cards = [...this.element.querySelectorAll<HTMLElement>('.wi-card')], folds = [...this.element.querySelectorAll<HTMLDetailsElement>('.wi-group')]
    if (words.length && !this.beforeSearch) this.beforeSearch = { cards: cards.map(card => card.classList.contains('is-open')), folds: folds.map(fold => fold.open) }
    this.element.classList.toggle('is-searching', words.length > 0)
    for (const card of this.element.querySelectorAll<HTMLElement>('.wi-card')) {
      let cardHits = 0
      for (const fold of card.querySelectorAll<HTMLDetailsElement>('.wi-group')) {
        let hits = 0
        for (const row of fold.querySelectorAll<HTMLElement>('.wi-row')) {
          const def = this.rows.get(row.dataset.id!)!.def, hay = `${def.label} ${def.group} ${def.id} ${describe(def)}`.toLowerCase()
          const hit = words.every(word => hay.includes(word)); row.hidden = words.length > 0 && !hit; if (hit) hits++
        }
        fold.hidden = words.length > 0 && hits === 0; if (words.length) fold.open = hits > 0
        cardHits += hits
      }
      card.hidden = words.length > 0 && cardHits === 0
      if (words.length) this.toggle(card, cardHits > 0)
    }
    if (!words.length && this.beforeSearch) {
      const before = this.beforeSearch; this.beforeSearch = undefined
      cards.forEach((card, i) => this.toggle(card, before.cards[i] ?? false)); folds.forEach((fold, i) => { fold.open = before.folds[i] ?? false })
    }
    this.say(words.length ? `${[...this.rows.values()].filter(r => !r.row.hidden).length} found` : '')
  }
  private say(text: string): void { this.element.querySelector('.wi-status')!.textContent = text }
  private async click(event: Event): Promise<void> {
    const target = event.target as Element, vehicle = target.closest<HTMLElement>('[data-vehicle]')
    if (vehicle) { this.options.onVehicle(vehicle.dataset.vehicle!); return }
    const button = target.closest<HTMLElement>('[data-wi]'); if (!button) return
    const card = button.closest<HTMLElement>('.wi-card'), section = card ? this.tree.find(s => s.id === card.dataset.section) : undefined
    const valueOf = (id: string) => params.get(id)?.value
    switch (button.dataset.wi) {
      case 'toggle': if (card) this.toggle(card); break
      case 'save-world': this.options.onSaveWorld?.(); break
      case 'copy-world': await this.copy(JSON.stringify(exportWorld(params.all().map(p => p.def as PropertyDef), valueOf), null, 2), 'This world'); break
      case 'copy-section': if (section) await this.copy(JSON.stringify(exportSection(section, valueOf), null, 2), section.title); break
      case 'paste-world': await this.sheet('Paste a world', null); break
      case 'paste-section': if (section) await this.sheet(`Paste into ${section.title}`, section.id); break
      case 'apply': this.apply(this.element.querySelector<HTMLTextAreaElement>('.wi-sheet textarea')!.value); break
      case 'close': this.element.querySelector<HTMLElement>('.wi-sheet')!.hidden = true; break
      case 'reset': {
        // Two presses: the first asks, the second (within four seconds) does it.
        if (!canEditWorld()) { this.say('The host has locked this world.'); break }
        if (!this.armed) { button.textContent = 'Press again to reset'; button.classList.add('is-warning'); this.armed = setTimeout(() => { this.armed = undefined; button.textContent = 'Reset'; button.classList.remove('is-warning') }, 4000); break }
        clearTimeout(this.armed); this.armed = undefined; button.textContent = 'Reset'; button.classList.remove('is-warning')
        this.say(resetWorld() ? 'World reset to its defaults.' : 'The host has locked this world.'); break
      }
    }
  }
  private async copy(json: string, what: string): Promise<void> {
    try { await navigator.clipboard.writeText(json); this.say(`${what} copied as JSON.`) }
    catch {
      // No clipboard access: show it, selected, to copy by hand.
      const sheet = this.element.querySelector<HTMLElement>('.wi-sheet')!, area = sheet.querySelector('textarea')!
      sheet.querySelector('strong')!.textContent = `${what} as JSON`; area.value = json; sheet.hidden = false; sheet.classList.add('is-copy'); area.focus(); area.select()
    }
  }
  private async sheet(title: string, sectionId: string | null): Promise<void> {
    const sheet = this.element.querySelector<HTMLElement>('.wi-sheet')!, area = sheet.querySelector('textarea')!
    this.pasteTarget = sectionId; sheet.querySelector('strong')!.textContent = title; sheet.classList.remove('is-copy'); area.value = ''
    // Fill it from the clipboard when the browser allows; otherwise the player pastes by hand.
    try { const text = await navigator.clipboard.readText(); if (text.trim().startsWith('{')) area.value = text } catch { /* Paste by hand. */ }
    sheet.hidden = false; area.focus()
  }
  /** Check pasted JSON and apply what is allowed. Returns the line shown to the player. */
  apply(text: string): string {
    const defs = params.all().map(p => p.def as PropertyDef)
    const result = parseWorld(text, defs, { personal: this.pasteTarget === 'you' })
    if (!result.ok) { this.say(result.why); return result.why }
    const world = result.entries.filter(entry => params.get(entry.id)?.def.scope === 'world')
    if (world.length && !canEditWorld()) { const why = 'The host has locked this world, so nothing was pasted.'; this.say(why); return why }
    params.applySnapshot(Object.fromEntries(result.entries.map(entry => [entry.id, entry.value])), 'local')
    this.element.querySelector<HTMLElement>('.wi-sheet')!.hidden = true
    const line = pasteSummary(result); this.say(line); return line
  }
  dispose(): void { this.unsubscribe(); this.abort.abort(); clearTimeout(this.armed); clearTimeout(this.tooltipTimer); this.tooltip.remove(); this.element.remove() }
}
