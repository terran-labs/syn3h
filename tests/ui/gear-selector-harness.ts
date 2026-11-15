/**
 * Harness for tests/ui/gear-selector.mjs: the gear selector over a bright and a dark backdrop
 * with a fake rack and a fake controls() state machine for the Grapple and Yoink. On touch it
 * also mounts the shell's real touch controls and a stand-in minimap, to check clearances.
 *
 * Query: ?touch=1, ?bg=dark, ?focused=1, ?gear=bungee.
 */
import '../../src/ui/shell.css'
import '../../src/ui/exploration.css'
import { GearSelector, type GearAction, type GearControls, type GearSource } from '../../src/ui/gear/GearSelector'
import { TouchControls } from '../../src/ui/TouchControls'
import type { Input } from '../../src/core/Input'

const query = new URLSearchParams(location.search)
const touch = query.get('touch') === '1'
document.querySelector<HTMLElement>('.backdrop')!.dataset.bg = query.get('bg') ?? 'bright'
const shell = document.querySelector<HTMLElement>('.syn3h-shell')!
if (touch) shell.classList.add('has-touch')

const ORDER = ['beam', 'red', 'pester', 'bungee', 'yoink'] as const
const NAMES: Record<string, string> = { beam: 'Plasma Tag', red: 'Plasma Thunder', pester: 'Chaser', bungee: 'Grapple', yoink: 'Yoink' }
const DESCRIPTIONS: Record<string, string> = {
  beam: 'A quick beam that tags whoever it touches.',
  red: 'A slow, heavy tag that rolls out like thunder.',
  pester: 'Little drones that chase a vehicle and tag it.',
  bungee: 'Throw a cord, hook a vehicle or the ground, then reel in or let out.',
  yoink: 'Grab a nearby vehicle and fling it somewhere else.',
}

const log: string[] = []
let grapple: 'idle' | 'flying' | 'ground' | 'vehicle' = 'idle'
let yoink: 'idle' | 'holding' = 'idle'
let cord = 42
let liveLevel: number | null = null
let cache: GearControls | undefined
let cacheKey = ''

const act = (id: string, label: string, keys: string[], hold: boolean, then?: () => void): GearAction => ({
  id, label, keys, hold,
  start() { log.push(`start:${id}`); then?.() },
  stop: hold ? () => { log.push(`stop:${id}`) } : undefined,
})

function build(gear: string): GearControls {
  const base = { gear, name: NAMES[gear], description: DESCRIPTIONS[gear] }
  if (gear === 'bungee') {
    if (grapple === 'idle') return { ...base, state: 'idle', actions: [act('launch', 'Launch', ['Click', 'L'], false, () => { grapple = 'flying' })] }
    if (grapple === 'flying') return { ...base, state: 'flying', status: 'Cord flying', actions: [act('release', 'Let go', ['G', 'Double tap'], false, () => { grapple = 'idle' })] }
    // Like the real rack, `level` is a live getter on a frozen object.
    return Object.freeze(Object.defineProperty({
      ...base, state: grapple, status: `Cord ${cord} m`,
      actions: [
        act('reelIn', 'Reel in', ['Hold click'], true),
        act('payOut', 'Let out', ['V', 'Wheel down'], true),
        act('release', 'Let go', ['G', 'Double tap'], false, () => { grapple = 'idle' }),
      ],
    }, 'level', { enumerable: true, get: () => liveLevel ?? cord / 60 }) as GearControls)
  }
  if (gear === 'yoink') {
    if (yoink === 'idle') return { ...base, state: 'idle', actions: [act('grab', 'Grab', ['Hold click'], true, () => { yoink = 'holding' })] }
    return { ...base, state: 'holding', status: 'Holding', actions: [act('fling', 'Fling', ['Release click'], false, () => { yoink = 'idle' })] }
  }
  if (gear === 'red') return { ...base, state: 'idle', actions: [act('charge', 'Charge', ['Hold click'], true)] }
  if (gear === 'pester') return { ...base, state: 'idle', actions: [act('send', 'Send', ['Click', 'L'], false)] }
  return { ...base, state: 'idle', actions: [act('tag', 'Tag', ['Click', 'L'], true)] }
}

const rack = {
  allowed: [...ORDER] as string[],
  chosen: query.get('gear') ?? 'beam',
  selects: 0,
  // Like the real rack, a fresh array on every call.
  list(): string[] { return this.allowed.filter(() => true) },
  get current(): string { return this.allowed.includes(this.chosen) ? this.chosen : this.allowed[0] },
  select(id: string) { this.chosen = id; this.selects++ },
  next() { const l = this.list(); this.select(l[(l.indexOf(this.current) + 1) % l.length]) },
  labelOf(id: string) { return NAMES[id] },
  controls(): GearControls {
    const gear = this.current
    const key = `${gear}|${grapple}|${yoink}|${cord}`
    if (key !== cacheKey) { cacheKey = key; cache = build(gear) }
    return cache!
  },
}

let present = true
let focused = query.get('focused') === '1'
let running = true
const selected: string[] = []
const selector = new GearSelector(shell, () => (present ? (rack as GearSource) : undefined), { touch, onSelect: id => selected.push(id) })

if (touch) {
  const input = { external: { x: 0, y: 0, z: 0, brakes: false, fire: false }, state: { special: false, zorb: false }, suspended: false, toggleZorb() {}, poll() { return {} } }
  const controls = new TouchControls(input as unknown as Input, document.body)
  controls.enabled = true
  // The minimap's footprint, drawn where exploration.css puts it.
  const map = document.createElement('div')
  map.className = 'shell-minimap'
  map.style.borderRadius = '50%'
  map.style.border = '1px dashed rgb(255 255 255 / .35)'
  shell.append(map)
}

const frame = () => { if (running) selector.update(focused); requestAnimationFrame(frame) }
selector.update(focused)
requestAnimationFrame(frame)

const harness = {
  selector, rack, log, selected,
  get focused() { return focused },
  setFocused(value: boolean) { focused = value; selector.update(focused) },
  setPresent(value: boolean) { present = value; selector.update(focused) },
  setGrapple(state: typeof grapple) { grapple = state; selector.update(focused) },
  setYoink(state: typeof yoink) { yoink = state; selector.update(focused) },
  setLiveLevel(value: number | null) { liveLevel = value },
  setCord(metres: number) { cord = metres; selector.update(focused) },
  setAllowed(ids: string[]) { rack.allowed = ids; selector.update(focused) },
  setBackdrop(bg: 'bright' | 'dark') { document.querySelector<HTMLElement>('.backdrop')!.dataset.bg = bg },
  get state() { return { grapple, yoink, cord, current: rack.current } },
  /** Stop the frame loop and count DOM mutations over `frames` manual update() calls. */
  async idleMutations(frames: number): Promise<number> {
    running = false
    let count = 0
    const observer = new MutationObserver(records => { count += records.length })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
    for (let i = 0; i < frames; i++) selector.update(focused)
    await Promise.resolve()
    count += observer.takeRecords().length
    observer.disconnect()
    running = true
    return count
  },
}
;(window as unknown as { gearHarness: typeof harness }).gearHarness = harness
