import { PLANETS, planetName, type PlanetRecipe } from '../../world/planets'
import { paintPlanetMap } from '../../world/planetMap'
import { planetOrbs, type OrbLook } from './PlanetOrbs'

/**
 * Each card shows the island the generator really makes for that kind and seed. Painting a
 * map takes tens of milliseconds, so it waits for an idle moment; the card shows its swatch
 * colours until then. One map is kept per kind: a new seed replaces the old one.
 */
const shown = new Map<string, string>()
function planetMapKey(id: string, seed: number): string {
  const key = `${id}:${seed}`, previous = shown.get(id)
  if (previous === key) return key
  if (previous) planetOrbs.dropMap(previous)
  shown.set(id, key)
  const paint = () => { if (shown.get(id) !== key) return; const map = paintPlanetMap(id, seed, 512, 256); planetOrbs.setMap(key, map.data, map.width, map.height) }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(paint, { timeout: 1500 }); else setTimeout(paint, 80)
  return key
}

export interface PlanetPickerOptions {
  /** Small cards for the lobby index; full cards with a line of description elsewhere. */
  compact?: boolean
  onPick(id: string): void
  /** The "shape your own" planet. */
  onCustom(): void
}

/**
 * A row of planets, one per kind of world, plus one to shape yourself. Each is a real button
 * with the planet drawn beside its name. The kind in play is marked and carries the name of
 * its seed. New recipes in `PLANETS` appear here without any change to this file.
 */
export class PlanetPicker {
  readonly element = document.createElement('div')
  private readonly orbs: ReturnType<typeof planetOrbs.add>[] = []
  private signature = ''
  constructor(host: Element, private readonly options: PlanetPickerOptions) {
    this.element.className = `planet-picker${options.compact ? ' is-compact' : ''}`
    this.element.setAttribute('role', 'group'); this.element.setAttribute('aria-label', 'Choose a world')
    for (const recipe of PLANETS) this.card(recipe.id, recipe.label, recipe.blurb, { land: recipe.swatch[0], sea: recipe.swatch[1], glow: recipe.values['world.seaKind'] === 0, cloud: Number(recipe.values['weather.cloudCoverage'] ?? 0.15), seed: 1 })
    this.card('custom', 'Custom', 'Shape your own with every slider, while everyone watches.', { land: 0x31507a, sea: 0x0a1630, glow: false, seed: 7, grid: true })
    this.element.addEventListener('click', event => {
      const id = (event.target as Element).closest<HTMLElement>('[data-planet]')?.dataset.planet
      if (id === 'custom') options.onCustom(); else if (id) options.onPick(id)
    })
    host.append(this.element)
  }
  private card(id: string, label: string, blurb: string, look: OrbLook): void {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'planet-card'; button.dataset.planet = id
    const canvas = document.createElement('canvas'); canvas.className = 'planet-orb'; canvas.setAttribute('aria-hidden', 'true')
    const text = document.createElement('span'); text.className = 'planet-text'
    const name = document.createElement('strong'); name.textContent = label
    const detail = document.createElement('small'); detail.textContent = blurb; detail.dataset.blurb = blurb
    text.append(name, detail); button.append(canvas, text); this.element.append(button)
    this.orbs.push(planetOrbs.add(canvas, look))
  }
  /** Mark the kind in play, name it from its seed, and lock the others when the host has. */
  refresh(current: PlanetRecipe, seed: number, editable: boolean): void {
    const signature = `${current.id}:${seed}:${editable}`
    if (signature === this.signature) return
    this.signature = signature
    // The kind in play shows its own seed's island; the others show a sample one.
    this.orbs.forEach((orb, i) => {
      const recipe = PLANETS[i]
      if (!recipe) return
      orb.look.seed = recipe.id === current.id ? seed : i + 1
      orb.look.map = planetMapKey(recipe.id, orb.look.seed)
    })
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('.planet-card')) {
      const id = button.dataset.planet!, active = id === current.id, detail = button.querySelector('small')!
      button.classList.toggle('is-primary', active); button.setAttribute('aria-pressed', String(active))
      button.disabled = !editable && !active
      detail.textContent = active ? planetName(seed) : this.options.compact ? '' : detail.dataset.blurb!
    }
  }
  dispose(): void { for (const orb of this.orbs) planetOrbs.remove(orb); this.element.remove() }
}
