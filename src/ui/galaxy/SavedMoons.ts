import { planetById, planetName } from '../../world/planets'
import type { SavedWorld } from './savedWorlds'
interface Place { id: string; x: number; y: number; radius: number; visible: boolean }
/** Small procedural buttons follow the recipe orbits; the Worlds list remains fully accessible. */
export class SavedMoons {
  readonly element = document.createElement('div')
  private entries: SavedWorld[] = []
  private buttons: HTMLButtonElement[] = []
  constructor(host: HTMLElement, private readonly enter: (entry: SavedWorld) => void) {
    this.element.className = 'saved-moons'; this.element.setAttribute('aria-label', 'Saved worlds')
    this.element.style.cssText = 'position:absolute;inset:0;pointer-events:none'
    host.append(this.element)
  }
  set(entries: SavedWorld[]): void {
    this.entries = entries; this.element.replaceChildren()
    this.buttons = entries.map(entry => {
      const button = document.createElement('button'), recipe = planetById(entry.recipeId)!
      const title = `${planetName(entry.seed)} · ${recipe.label} · Saved on this device`
      button.type = 'button'; button.className = 'saved-world-moon'; button.dataset.savedWorld = entry.id
      button.title = title; button.setAttribute('aria-label', `Enter ${title}`)
      button.style.cssText = 'position:absolute;width:44px;height:44px;padding:10px;box-sizing:border-box;border:0;border-radius:50%;background:transparent;pointer-events:auto;cursor:pointer'
      const orb = document.createElement('span')
      const color = `#${recipe.swatch[0].toString(16).padStart(6, '0')}`
      orb.style.cssText = `display:block;margin:auto;width:20px;height:20px;border-radius:50%;border:1px solid #9de5ff88;background:radial-gradient(circle at 30% 25%,#d5f5ff 0%,${color} 35%,#07121d 85%);box-shadow:0 0 10px #7de4ff55;pointer-events:none`
      button.append(orb); button.hidden = true
      button.addEventListener('click', () => this.enter(entry)); this.element.append(button)
      return button
    })
  }
  layout(places: readonly Place[], bounds: { width: number; top: number; bottom: number }, hidden: boolean): void {
    this.element.hidden = hidden
    if (hidden) return
    const occupied: { x: number; y: number }[] = []
    this.entries.forEach((entry, i) => {
      const button = this.buttons[i], parent = places.find(place => place.id === entry.recipeId)
      button.hidden = true
      if (!parent?.visible) return
      for (let attempt = 0; attempt < 24; attempt++) {
        const angle = ((entry.seed % 360) / 180 * Math.PI) + attempt * Math.PI / 6
        const radius = parent.radius + 32 + Math.floor(attempt / 12) * 48
        const x = parent.x + Math.cos(angle) * radius, y = parent.y + Math.sin(angle) * radius
        if (x < 24 || x > bounds.width - 24 || y < bounds.top + 24 || y > bounds.bottom - 24) continue
        if (occupied.some(p => Math.hypot(p.x - x, p.y - y) < 48)) continue
        if (places.some(p => p.visible && p.id !== parent.id && Math.hypot(p.x - x, p.y - y) < p.radius + 24)) continue
        // Recipe captions generally sit above or below the globe. Leave their central band clear.
        if (places.some(p => p.visible && Math.abs(p.x - x) < 100 && Math.abs(p.y - y) > p.radius && Math.abs(p.y - y) < p.radius + 65)) continue
        button.style.left = `${x - 22}px`; button.style.top = `${y - 22}px`; button.hidden = false
        occupied.push({ x, y }); break
      }
    })
  }
  dispose(): void { this.element.remove() }
}
