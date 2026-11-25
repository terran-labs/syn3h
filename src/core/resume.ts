/** Tab-local recovery. Read before building terrain; restore only after room welcome. */
import { Vector3, Quaternion } from 'three/webgpu'
import { params, worldSeed, type ParamValue } from '../../shared/params'
import type { Game, System } from './Game'
import type { Vehicle } from '../vehicles/Vehicle'
import type { VehicleKind } from '../vehicles'
import type { Terrain } from '../world/Terrain'
import { currentHour } from '../world/sky/dayCycle'

export const RESUME_KEY = 'mira.resume.v1'
export const RESUME_MAX_AGE = 10 * 60 * 1000
export interface ResumeSnapshot {
  version: 1; savedAt: number; room: string; seed: number; wasHost: boolean
  /** Seed in the page URL when saved, which may predate a host slider edit. */
  entrySeed?: number | null
  world: Record<string, ParamValue>
  kind: VehicleKind; colors: { body: string; accent: string }
  p: number[]; q: number[]; v: number[]; w: number[]
  wingsOpen: boolean; special: boolean; cameraMode: number; timeOfDay: number
}
import { canonicalRoom, isDefaultRoom, roomFromQuery } from './roomAddress'
import { sessionStore } from './safeStorage'
export { canonicalRoom }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const vector = (v: unknown, count: number, max: number): v is number[] => Array.isArray(v) && v.length === count && v.every(n => finite(n) && Math.abs(n) <= max)
const color = (s: unknown) => typeof s === 'string' && /^#[a-f0-9]{6}$/i.test(s)

/** Treat storage as untrusted input, including clocks that have moved backwards. */
export function parseResume(raw: string | null, room?: string, seed?: number, now = Date.now()): ResumeSnapshot | null {
  try {
    const s = JSON.parse(raw || 'null') as ResumeSnapshot
    if (!s || s.version !== 1 || !finite(s.savedAt) || now < s.savedAt || now - s.savedAt >= RESUME_MAX_AGE) return null
    // Public rooms are one place in an address (no ?room=): a saved planet's public room matches.
    if (typeof s.room !== 'string' || canonicalRoom(s.room) !== s.room || (room !== undefined && canonicalRoom(room) !== s.room && !(isDefaultRoom(room) && isDefaultRoom(s.room)))) return null
    if (!Number.isInteger(s.seed) || s.seed < 1 || s.seed > 999999 || (seed !== undefined && s.seed !== seed)) return null
    if (!['buggy', 'buggy-syn3h', 'buggy-classic', 'jet', 'hovercraft', 'tank'].includes(s.kind)) return null
    if (!s.colors || !color(s.colors.body) || !color(s.colors.accent)) return null
    if (!vector(s.p, 3, 1e6) || !vector(s.q, 4, 1) || Math.abs(Math.hypot(...s.q) - 1) > 0.01 || !vector(s.v, 3, 500) || !vector(s.w, 3, 100)) return null
    if (typeof s.wasHost !== 'boolean' || typeof s.wingsOpen !== 'boolean' || typeof s.special !== 'boolean') return null
    if (!finite(s.cameraMode) || s.cameraMode < 0 || s.cameraMode > 4 || !finite(s.timeOfDay) || s.timeOfDay < 0 || s.timeOfDay > 24) return null
    if (s.entrySeed !== undefined && s.entrySeed !== null && !finite(s.entrySeed)) return null
    if (!s.world || typeof s.world !== 'object' || Array.isArray(s.world) || Object.keys(s.world).length > 1000) return null
    if (Object.values(s.world).some(v => typeof v !== 'boolean' && !finite(v))) return null
    return s
  } catch { return null }
}

/**
 * An explicit room, seed or different vehicle in the URL wins over the saved session. No ?room=
 * is the public room, explicitly: a clean link never resumes a private room saved in this tab.
 */
export function prepareResume(query: URLSearchParams, storage: Pick<Storage, 'getItem'> | null = sessionStore()): ResumeSnapshot | null {
  if (!storage) return null
  let saved: ResumeSnapshot | null
  try { saved = parseResume(storage.getItem(RESUME_KEY), roomFromQuery(query)) } catch { return null }
  if (!saved) return null
  // The unchanged URL can still contain the seed from before a host edited it. A link to a
  // different seed (?seed= or ?world=recipe.seed) is a new destination and wins.
  const link = linkSeed(query)
  if (link !== null && link !== saved.seed && link !== saved.entrySeed) return null
  const kind = query.get('vehicle')
  if (kind && normalizeKind(kind) !== normalizeKind(saved.kind)) return null
  // Before terrain creation and hello. Existing rooms still override these in welcome.
  if (saved.wasHost) for (const [id, value] of Object.entries(saved.world)) {
    if (params.get(id)?.def.scope === 'world') params.set(id, value, 'preset')
  }
  params.set('world.seed', saved.seed, 'preset')
  if (saved.wasHost) params.set('sun.timeOfDay', saved.timeOfDay, 'preset')
  params.set('camera.mode', saved.cameraMode)
  return saved
}
/** The seed an address names, by ?seed= or inside ?world=recipe.seed, or null if none. */
export function linkSeed(query: URLSearchParams): number | null {
  if (query.has('seed')) return Number(query.get('seed'))
  const world = /^[a-z]+\.(\d+)/.exec(query.get('world')?.trim() ?? '')
  return world ? Number(world[1]) : null
}
/** 'buggy-syn3h' is an alias, and the retired 'buggy-classic' now resumes as the Mira buggy. */
const normalizeKind = (kind: string) => kind === 'buggy-syn3h' || kind === 'buggy-classic' ? 'buggy' : kind

/**
 * Whether a saved position can be restored as it is. Only a broken pose is refused: not a
 * number, outside the world, under the ground or absurdly high. A vehicle saved in lava or
 * deep water resumes there (the owner's rule of 18 November 2026: the game never moves a
 * player for where they drove; see AGENTS.md).
 */
export function safeResumePosition(saved: ResumeSnapshot, terrain: Pick<Terrain, 'size' | 'heightAt'>): boolean {
  const [x, y, z] = saved.p
  if (![x, y, z].every(Number.isFinite)) return false
  if (Math.abs(x) > terrain.size / 2 + 2 || Math.abs(z) > terrain.size / 2 + 2) return false
  const ground = terrain.heightAt(x, z)
  return Number.isFinite(ground) && y >= ground + 0.2 && y <= ground + 10000
}
interface ResumeNetwork { connected: boolean; isHost: boolean; setProfile?(profile: { colors: { body: string; accent: string } }): void }
interface ResumeOptions {
  game: Game; terrain: Terrain; player: Vehicle; room: string; saved: ResumeSnapshot | null
  /** Omit for offline play. A connected client has received and applied welcome. */
  network?: ResumeNetwork
  storage?: Pick<Storage, 'setItem'>
  /** Original play entry query, retained even while the lobby hides the address. */
  entrySearch?: string
  toast?: (message: string) => void
}

/** Install after startNetworking in the Play callback, not while sitting in the lobby. */
export class ResumeSession implements System {
  private settled = false
  private elapsed = 0
  private world: Record<string, ParamValue>
  private readonly unsubscribe: () => void
  private readonly onHide = () => this.save()
  private readonly room: string
  constructor(private readonly options: ResumeOptions) {
    this.room = canonicalRoom(options.room)
    this.world = { ...(options.saved?.world ?? {}) }
    this.unsubscribe = params.onChange((id, value, source) => {
      if (source !== 'remote' && (!options.network || options.network.isHost) && params.get(id)?.def.scope === 'world') this.world[id] = value
    })
    window.addEventListener('pagehide', this.onHide)
    document.addEventListener('visibilitychange', this.onHide)
  }
  update(dt: number): void {
    const o = this.options
    if (!this.settled) {
      if (o.network && !o.network.connected) return
      this.settled = true
      const s = o.saved
      if (s && Date.now() - s.savedAt < RESUME_MAX_AGE && s.room === this.room && s.seed === worldSeed.value && normalizeKind(s.kind) === normalizeKind(o.player.kind)) {
        if (safeResumePosition(s, o.terrain)) {
          o.player.teleport(new Vector3(...s.p))
          const q = new Quaternion(...s.q).normalize()
          o.player.body.setRotation(q, true)
          o.player.body.setLinvel(new Vector3(...s.v), true)
          o.player.body.setAngvel(new Vector3(...s.w), true)
          // Reset both interpolation endpoints to the restored pose.
          o.player.postPhysics(0); o.player.postPhysics(0)
          o.game.input.state.special = s.special
          o.player.input.special = s.special
          o.player.wingsOpen = s.wingsOpen
          o.player.setColors(s.colors.body, s.colors.accent)
          o.network?.setProfile?.({ colors: s.colors })
          params.set('camera.mode', s.cameraMode)
          ;(o.toast ?? resumedToast)('Resumed where you left off')
        } else {
          const spawn = o.terrain.spawnPoint(o.player.spawnSlot)
          o.player.teleport(spawn.position, spawn.heading)
        }
      }
    }
    this.elapsed += dt
    if (this.elapsed >= 1.5) { this.elapsed = 0; this.save() }
  }
  save(): void {
    if (!this.settled) return
    const o = this.options, state = o.player.getState()
    const entry = new URLSearchParams(o.entrySearch ?? (typeof location !== 'undefined' ? new URL(location.href).search : ''))
    const saved: ResumeSnapshot = {
      version: 1, savedAt: Date.now(), room: this.room, seed: worldSeed.value,
      entrySeed: linkSeed(entry),
      wasHost: !o.network || o.network.isHost, world: { ...this.world },
      kind: o.player.kind, colors: { ...o.player.colors }, p: state.p, q: state.q, v: state.v, w: state.w,
      wingsOpen: o.player.wingsOpen, special: o.game.input.state.special,
      cameraMode: Number(params.get('camera.mode')?.value ?? 0), timeOfDay: currentHour(),
    }
    try { (o.storage ?? sessionStorage).setItem(RESUME_KEY, JSON.stringify(saved)) } catch { /* Private browsing and full storage must not stop play. */ }
  }
  dispose(): void {
    this.save(); this.unsubscribe()
    window.removeEventListener('pagehide', this.onHide)
    document.removeEventListener('visibilitychange', this.onHide)
  }
}
function resumedToast(message: string): void {
  const toast = document.createElement('div')
  toast.role = 'status'; toast.textContent = message
  toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#172633;color:white;padding:10px 16px;border-radius:8px;z-index:1000;pointer-events:none'
  document.body.append(toast); setTimeout(() => toast.remove(), 3000)
}
