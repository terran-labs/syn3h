// Imported by the Performance button after a tap. All actors belong to this client.
import { Color, Vector3 } from 'three/webgpu'
import { MODE_KOTH, MODE_TAG } from '../../shared/protocol'
import type { Game } from '../core/Game'
import type { ChaseCamera } from '../core/ChaseCamera'
import { observeCheckDraws } from './checkDraws'
import { levelNumber } from '../core/quality'
import type { GuardedRenderer } from '../core/deviceLoss'
import type { BotManager } from '../bots/BotManager'
import type { Shell } from '../ui/Shell'
import type { Terrain } from '../world/Terrain'
import type { PlayerSlot } from '../vehicles/PlayerSlot'
import type { VehicleSwapper } from '../vehicles/swap'
import type { Materialize } from '../vehicles/effects/Materialize'
import { attachVehicleEffects } from '../vehicles/effects'
import type { VehicleKind } from '../vehicles'
import type { NetClient } from '../net'
import { Bungee } from '../weapons/bungee/Bungee'

interface Context {
  game: Game; terrain: Terrain; shell: Shell; bots: BotManager; camera: ChaseCamera
  slot: PlayerSlot; materialize: Materialize; swapper: VehicleSwapper; net?: NetClient
  glass(): string; diagnostics(): string
}

function unavailable({ shell, net, game }: Context): string {
  if (!shell.playing || shell.transitioning) return 'Enter a world before running the check.'
  if (document.hidden || game.isPaused) return 'Resume play in this tab before running the check.'
  if ((game.renderer as unknown as GuardedRenderer)._isDeviceLost) return 'Reload to restore graphics before running the check.'
  if (!net?.id) return 'Wait for the room connection before running the check.'
  if (net.race?.phase === 'running' || net.race?.phase === 'countdown') return 'Finish the race before running the check.'
  if (net.game.mode === MODE_TAG && net.game.it === net.id) return 'Pass Tag to another player before running the check.'
  if (net.game.mode === MODE_KOTH && net.game.koth.holder) return 'Wait until the hill is free before running the check.'
  return ''
}

export async function runInWorldCheck(ctx: Context, panel: AbortSignal): Promise<string> {
  const reason = unavailable(ctx)
  if (reason) throw new Error(reason)
  panel.throwIfAborted()
  const { game, terrain, shell, bots, camera, slot, materialize, swapper, net } = ctx
  const stop = new AbortController(), signal = stop.signal
  const cancel = () => stop.abort('Cancelled')
  const hidden = () => { if (document.hidden) stop.abort('Page hidden') }
  panel.addEventListener('abort', cancel, { once: true })
  document.addEventListener('visibilitychange', hidden, { signal })
  window.addEventListener('pagehide', cancel, { signal })
  const started = performance.now()
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel() }
  }, { capture: true, signal })
  const limit = setTimeout(() => stop.abort('Time limit'), 75_000)
  const banner = document.createElement('aside'), label = document.createElement('span')
  label.setAttribute('role', 'status')
  const button = document.createElement('button')
  button.type = 'button'; button.textContent = 'Cancel'
  button.onclick = cancel
  banner.style.cssText = 'position:fixed;z-index:2147483647;top:max(12px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);background:#182430;color:white;padding:8px 12px;border-radius:8px;display:flex;align-items:center;gap:12px;font:14px system-ui'
  banner.append(label, button); document.body.append(banner)
  const inspector = shell.element.querySelector<HTMLElement>('.world-inspector')
  const visibility = inspector?.style.visibility ?? ''
  if (inspector) inspector.style.visibility = 'hidden'
  const original = slot.current, input = game.input.suspended, pacing = bots.suspendDiagnosticPacing
  const roomBots = bots.remote ? [...net!.players.values()].filter(player => player.bot).length : bots.vehicles.length
  const initialGlass = ctx.glass()
  const startLevel = game.quality.governor.level
  const quality = game.quality, sweep = quality.beginDiagnosticSweep()
  shell.qualityCheckSignal = signal
  game.input.suspended = true; bots.suspendDiagnosticPacing = true
  const cleanups = new Set<() => void>()
  function own(fn: () => void) {
    const release = () => { if (cleanups.delete(release)) fn() }
    cleanups.add(release)
    return release
  }
  const rows: string[] = []
  let samples: number[] = [], raf = 0, previous = performance.now()
  function frame() {
    const t = performance.now()
    if (t > previous) samples.push(t - previous)
    previous = t
    const why = unavailable(ctx)
    if (why) stop.abort(why)
    else raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  const wait = (ms: number) => new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
  const level = () => quality.governor.level
  const draws = observeCheckDraws(game, () => Boolean(shell.element.querySelector('.quality-change-veil')))
  // Each sealed game interval belongs to the step in which it ended. The separate
  // animation callback above also sees gaps while the game loop is suspended.
  let frameCursor = game.readLongFrames(Number.MAX_SAFE_INTEGER).cursor
  function worstGameFrame() {
    const batch = game.readLongFrames(frameCursor)
    frameCursor = batch.cursor
    const worst = batch.frames.reduce<(typeof batch.frames)[number] | undefined>((max, frame) =>
      !max || frame.intervalMs > max.intervalMs ? frame : max, undefined)
    if (!worst) return '·'
    const spans = worst.spans.sort((a, b) => b.ms - a.ms).slice(0, 2)
    const work = spans.map(span => span.name + ' ' + Math.round(span.ms)).join(', ')
    return '#' + worst.frame + ' ' + Math.round(worst.intervalMs) + ' ' +
      (work || 'no spans') + ', gap ' + Math.round(worst.unaccountedMs) + (batch.lost ? ' (partial)' : '')
  }
  async function step(name: string, action: () => void | Promise<void | string>, ms = 800) {
    signal.throwIfAborted()
    label.textContent = name
    samples = []; previous = performance.now()
    const from = level()
    draws.start()
    let rowName = name
    try {
      const detail = await action()
      if (detail) rowName += ' (' + detail + ')'
      await wait(ms)
      // A timer can beat the next animation callback after a stall. Include its interval.
      await new Promise<void>((resolve, reject) => {
        signal.throwIfAborted()
        const abort = () => { cancelAnimationFrame(id); reject(signal.reason) }
        const id = requestAnimationFrame(() => { signal.removeEventListener('abort', abort); resolve() })
        signal.addEventListener('abort', abort, { once: true })
      })
    }
    finally {
      const sorted = samples.sort((a,b) => a-b)
      const q = (fraction: number) => sorted.length ? sorted[Math.ceil(sorted.length * fraction)-1].toFixed(1) : '?'
      rows.push([rowName, from === level() ? from : from+'>'+level(), samples.length, q(.5), q(.95), q(.99), q(1),
        ...draws.result(), worstGameFrame()].join(' | '))
    }
  }
  function place(index = 0) {
    const front = game.camera.getWorldDirection(new Vector3()); front.y = 0; front.normalize()
    const at = original.object.position.clone().addScaledVector(front, 12 + index * 4)
    at.x += (index % 2 ? 1 : -1) * 3
    at.y = Math.max(terrain.heightAt(at.x, at.z), terrain.liquidHeightAt?.(at.x, at.z) ?? -Infinity) + 2
    return at
  }
  function actor(kind: VehicleKind, index: number) {
    const bot = bots.acquireBotVehicle(kind, place(index), 0)
    bot.body.setEnabled(false); bot.isLocal = false
    const retire = own(() => { materialize.cancel(bot); if (!bots.releaseBotVehicle(bot)) bot.dispose() })
    const draw = game.add({ update: (dt: number, alpha: number) => bot.update(dt, alpha) })
    const removeDraw = own(() => game.remove(draw, false))
    const effects = own(attachVehicleEffects(game, terrain, bot, { local: false }))
    void materialize.begin(bot, { hold: false })
    return { bot, remove: () => { effects(); removeDraw(); retire() } }
  }
  let outcome = 'Complete'
  try {
    await step('Baseline', () => {}, 1500)
    const actors: ReturnType<typeof actor>[] = []
    for (const kind of ['buggy', 'hovercraft', 'buggy', 'jet'] as const) {
      await step('Join '+kind, () => { actors.push(actor(kind, actors.length)) }, 1300)
    }
    for (const member of actors.reverse()) {
      await step('Leave '+member.bot.kind, async () => {
        void materialize.depart(member.bot)
        await wait(1050); member.remove()
      }, 240)
    }
    const next = swapper.cached(original.kind === 'jet' ? 'hovercraft' : 'jet')
    if (next && next !== original && !next.object.parent) {
      await step('Swap local view', async () => {
        const visible = original.object.visible
        next.teleport(original.object.position.clone()); next.setParked(false); next.body.setEnabled(false)
        const reset = own(() => { materialize.cancel(next); camera.setVehicle(original); original.object.visible = visible; next.setParked(true) })
        const updater = game.add({ update: (dt: number, alpha: number) => next.update(dt, alpha) })
        const remove = own(() => game.remove(updater, false))
        try {
          camera.setVehicle(next); original.object.visible = false
          void materialize.begin(next, { hold: false }); await wait(1800)
        } finally { remove(); reset() }
      })
    } else rows.push('Swap local view | skipped: parked vehicle unavailable')
    await step('Thunder burst', () => {
      const at = place(); at.y += 6
      net!.lasers.fireworks.burst({ at, ground: terrain.heightAt(at.x, at.z), climb: 0,
        colors: [new Color(0xff8844), new Color(0x66ccff)], seed: 47 })
    }, 2500)
    await step('Laser hits', async () => {
      // A Tag and a Thunder hit on the ground, then on a vehicle (the player's own): every part of
      // a hit's look (src/weapons/impact), which must build nothing in play.
      const up = new Vector3(0, 1, 0)
      for (const red of [false, true]) {
        const at = place(red ? 1 : 0); at.y -= 2
        net!.lasers.showImpact(at, up, red, false)
        await wait(150)
      }
      for (const red of [false, true]) {
        net!.lasers.showImpact(original.object.position.clone().add(new Vector3(0, 1, 0)), up, red, true)
        await wait(150)
      }
    }, 1200)
    await step('Grapple', async () => {
      const cord = game.add(new Bungee(game, { self: () => 1, vehicleOf: () => original,
        idOfBody: () => null, owns: () => false, lagOf: () => 0, wrapSize: () => 0, now: () => game.time,
        inHand: () => false, control: () => ({ fire: false, direction: [0,0,1] }) }))
      const release = own(() => game.remove(cord))
      const at = place(), origin = original.object.position.clone(), d = at.clone().sub(origin).normalize()
      cord.applyRemote(2, { s: 'hook', o: origin.toArray(), d: d.toArray(), t: game.time })
      await wait(180)
      cord.applyRemote(2, { s: 'on', at: at.toArray(), r: at.distanceTo(origin), n: [0,1,0] })
      await wait(1250); cord.applyRemote(2, { s: 'off' }); await wait(400); release()
    })
    // Visit every adjacent edge in each direction, starting at the player's actual level.
    const startingLevel = level()
    for (const end of [0, 5, startingLevel]) {
      while (level() !== end) {
        const target = levelNumber(level() + Math.sign(end - level()))
        await step((target < level() ? 'Forced down ' : 'Forced up ')+target, () => sweep.step(target), 650)
      }
    }
    await step('Manual jump', async () => {
      quality.setLevel(startingLevel < 2 ? 3 : 0)
      while (shell.element.querySelector('.quality-change-veil')) await wait(40)
    }, 650)
    const head = shell.element.querySelector<HTMLButtonElement>('.wi-card[data-section="performance"] .wi-head')
    if (head && inspector) await step('Card frame window', async () => {
      inspector.style.visibility = visibility
      const toggle = () => {
        const action = head.getAttribute('aria-expanded') === 'true' ? 'close' : 'open'
        const start = performance.now()
        head.click()
        return action + ' ' + (performance.now() - start).toFixed(1) + ' ms'
      }
      const first = toggle()
      let second: string
      try { await wait(900) } finally {
        try { second = toggle() } finally { inspector.style.visibility = 'hidden' }
      }
      return 'click dispatch: ' + first + ', ' + second
    })
    else rows.push('Card frame window | skipped: unavailable')

  } catch (error) {
    outcome = signal.aborted ? String(signal.reason) : 'Interrupted'
    if (!signal.aborted) console.error('Performance check interrupted', error)
  } finally {
    stop.abort(); cancelAnimationFrame(raf); clearTimeout(limit); draws.dispose()
    panel.removeEventListener('abort', cancel)
    try { for (const release of [...cleanups].reverse()) release() }
    finally {
      try { sweep.restore() }
      finally {
        shell.qualityCheckSignal = undefined
        bots.suspendDiagnosticPacing = pacing; game.input.suspended = input
        if (inspector) inspector.style.visibility = visibility
        banner.remove()
      }
    }
  }
  const details = ctx.diagnostics().split('\n')
  const header = details.filter(line => /^(Device class:|Browser:|Renderer:|Screen:)/.test(line))
  const detail = details.filter(line => /^(Reported |Version:|Source commit:|OS:|Adapter:|Memory estimate:|Graphics quality:|World:|Play:|Room connection:|In play:|Last 60 s:|Before first overlay fade|After first overlay fade|Play to first playable|Covered entry precompile)/.test(line))
  return ['Syn3h performance check | '+outcome+' | '+Math.round((performance.now()-started)/1000)+' s',
    ...header, `Quality at entry: ${game.entryQualityLevel ?? 'unavailable'}; at check start: ${startLevel}; room bots at start: ${roomBots}`, initialGlass,
    'Local step | level | frames | p50 | p95 | p99 | max ms | draw G/P | proxy | veil | unmatched | worst game frame',
    ...rows, '', 'G/P = graph builds/pipeline requests. Draw = same-frame submission. Proxy = showroom warm. Unmatched = no same-frame draw identified. Steps force each boundary without the governor’s evidence delay or cold-climb gate. Worst game frame = interval over 33 ms ending in this step, two largest CPU spans and unaccounted gap (ms). Card window percentiles include waits between browser frames. Click dispatch measures synchronous handlers only. A gap has no identified cause.', ...detail].join('\n')
}
