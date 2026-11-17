/**
 * Composition root. Builds the world from the four seams and starts the loop.
 * Keep this file small: features belong behind the seams, not here.
 */
import { initializeFrozenResources } from './core/frozenResources'
import { ResumeSession, RESUME_KEY } from './core/resume'
import { applyStartWorld } from './core/startWorld'
import { randomSeed } from './world/planets'
import { PageLifecycle } from './core/lifecycle'
import { PauseState, type PauseControl } from './core/pause'
import { params, worldSeed } from '../shared/params'
import { BotManager } from './bots/BotManager'
import { ChaseCamera } from './core/ChaseCamera'
import { Game } from './core/Game'
import { botColors, startNetworking } from './net'
import { ChatPanel } from './ui/chat/ChatPanel'
import { HostBanter } from './bots/banter/HostBanter'
import { BOT_ID_BASE } from '../shared/protocol'
import { ParamPanel } from './ui/ParamPanel'
import { LobbyAddress } from './ui/LobbyAddress'
import { roomFromQuery } from './core/roomAddress'
import { botIdentity, generateName, uniqueBotName } from './ui/data/names'
import { initGameShell } from './ui/Shell'
import { readVehicleChoice, saveVehicleChoice } from './ui/VehicleChoice'
import { type VehicleKind, createVehicle } from './vehicles'
import { PlayerSlot } from './vehicles/PlayerSlot'
import { createVehicleSwapper } from './vehicles/swap'
import { Materialize } from './vehicles/effects/Materialize'
import { onZorbPulse } from './vehicles/zorb'
import type { Vehicle } from './vehicles/Vehicle'
import { createEnvironment } from './world/Environment'
import { createPostChain } from './fx/post/PostChain'
import { createTerrain } from './world'
import * as planets from './world/planets'
import { WaterEffects } from './world/water/WaterEffects'
import { WeatherSystem, applyWeatherQuery, setWeatherClock } from './world/weather'
import { applyWordmarkQuery } from './ui/brand/wordmarkFlags'
import { setDayClock } from './world/sky/dayCycle'

async function main(): Promise<void> {
  initializeFrozenResources(location.href)
  const canvas = document.getElementById('game') as HTMLCanvasElement
  const hud = document.getElementById('hud') as HTMLDivElement
  const query = new URLSearchParams(location.search)
  // A link's world, else this tab's resumed session, else a fresh random planet. Automated
  // browsers (navigator.webdriver: the smoke tests, frame profiles and shot tools) keep the
  // old fixed seed 1, so their measurements compare from run to run.
  const { saved } = applyStartWorld(query, sessionStorage, navigator.webdriver ? () => 1 : randomSeed)
  // Keep the original entry/resume URL until all startup consumers have read it.
  const lobbyAddress = new LobbyAddress(location, history)
  const game = new Game(canvas)
  await game.init()

  const terrain = createTerrain(game, worldSeed.value)
  // Graphics levels thin out distant terrain on weaker devices.
  game.quality.attachTerrain(terrain)
  const environment = game.add(createEnvironment(game, terrain))
  // Post effects follow the player's settings and the current rendering budget.
  game.setPostChain(createPostChain(game, environment))

  const spawn = terrain.spawnPoint(0)
  // The vehicle comes from ?vehicle=..., else the choice saved by the lobby, else the Syn3h buggy.
  const choice = saved ? { vehicleKind: saved.kind, bodyColor: saved.colors.body, accentColor: saved.colors.accent } : readVehicleChoice()
  if (saved) saveVehicleChoice(choice)
  const kind = (query.get('vehicle') ?? choice.vehicleKind ?? 'buggy') as VehicleKind
  const player = createVehicle(game, terrain, kind, spawn.position, spawn.heading)
  player.isLocal = true
  player.setColors?.(choice.bodyColor, choice.accentColor)
  game.add(player)
  // Everything that follows the player reads it from this slot, so the vehicle can be changed
  // in place without rebuilding those systems. `player` is only the vehicle spawned first.
  const slot = new PlayerSlot(player)
  // Tracks, dust, thrusters and lights, with the real headlight a local vehicle gets. The
  // swapper owns them from here on: it moves them when the vehicle changes.
  const swapper = createVehicleSwapper(game, terrain, slot)
  // A new seed or terrain parameter rebuilds the ground in place: put the player back on it.
  terrain.onRegenerate?.(() => {
    const s = terrain.spawnPoint(0)
    slot.current.teleport(s.position, s.heading)
  })

  // Bots chase and ram the player. The 'bots.count' slider sets the requested fleet size.
  const bots = game.add(new BotManager(game, terrain, player))
  bots.setTargets([player])
  slot.onChange((next) => bots.setPlayer(next))

  const camera = game.add(new ChaseCamera(game, terrain))
  camera.setVehicle(player)
  slot.onChange((next) => camera.setVehicle(next))
  // A wrapping world carries the player, the camera and the bots across its seam.
  ;(terrain as { followSeam?: (f: unknown) => void }).followSeam?.({ get player() { return slot.current }, camera, others: () => bots.vehicles })
  // Wind: a force on the vehicles this client owns (the player and its bots), never on remote
  // copies, whose owners apply it themselves. `?weather=0.5` sets the storminess for a look.
  game.add(new WeatherSystem(() => terrain, () => [slot.current, ...bots.vehicles]))
  applyWeatherQuery(location.search)
  // ?wordmark= and ?intro=: silent developer overrides for the lobby's name and opening.
  applyWordmarkQuery(location.search)
  // The round planet is drawn relative to the camera: place it after the camera has moved.
  game.add({ update: () => (terrain as { afterCamera?: () => void }).afterCamera?.() })

  // The start screen collects the name and unlocks audio. Networking joins on Play so the
  // room sees the chosen name. ?autoplay=1 skips the screen for automated checks.
  const { shell, audio, setPlayer } = initGameShell(game, player, terrain)
  bots.daydream.setBlocker(() => shell.daydreamBlocked)
  // The HUD bridge, hints and the engine voice follow the slot.
  slot.onChange(setPlayer)
  // A vehicle arriving by a switch hangs in a small glowing cloud for a second, then drops.
  const materialize = game.add(new Materialize(game, terrain, { onCue: (cue, position, _hold, vehicle) => audio.materialize(cue, position, vehicle) }))
  void materialize.prewarm()
  const offZorbPulse = onZorbPulse((_ball, centre) => audio.zorbPulse(centre))
  game.add({ dispose: offZorbPulse })
  shell.configurePerformance({
    getPerformanceSnapshot: () => game.quality.getPerformanceSnapshot(),
    subscribePerformance: listener => game.quality.subscribePerformance(listener),
    setDiagnosticsVisible: visible => game.quality.setDiagnosticsVisible(visible),
    ignoreRecommendation: () => game.quality.ignoreRecommendation(),
    lowerRecommendedTier: () => game.quality.lowerRecommendedTier(),
  })
  // The descent from the galaxy poses this camera.
  shell.setCinematicCamera(camera)
  // Nearby bots are audible, positioned in space. Remote players join this list later.
  audio.setVehicles(() => bots.vehicles)
  // Two triggers, one state (src/core/pause.ts): the page being hidden, and the player's own
  // pause from the shell. The loop stops while either holds.
  const pause = new PauseState()
  pause.subscribe((paused) => { if (paused) game.pause(); else game.resume() })
  const lifecycle = new PageLifecycle()
  lifecycle.onChange((state) => { if (state === 'hidden') pause.pause('hidden'); else pause.resume('hidden') })
  if (lifecycle.hidden) pause.pause('hidden')
  // The shell owns the Escape trigger, the overlay and the audio fade, all from this control.
  ;(shell as unknown as { setPauseControl?: (control: PauseControl) => void }).setPauseControl?.(pause)
  let netStatus: string[] = []
  let joined = false
  /**
   * Change the player's vehicle where they are, without a reload: the one entry point for the
   * in-play vehicle selector.
   *
   * Returns the vehicle now being driven: a new one, or the current one when it is already
   * that kind. Returns null, having changed nothing, if the new vehicle could not be built;
   * the caller may fall back to a reload then.
   *
   * Everything that holds the player follows through the slot, while the old vehicle is still
   * intact: the camera, HUD and audio (above), the bots (their chase target and the daydream
   * pilot), and, once a room is joined, networking, which lets go of the player's gear, rebinds
   * the tag marker, pad guard and lava rescue, and announces the new kind to the room.
   */
  const swapVehicle = (kind: VehicleKind): Vehicle | null => {
    const previous = slot.current
    try {
      const next = swapper.swap(kind)
      // The new one arrives where the old one was, moving as it moved (swapPlacement in
      // vehicles/swap.ts). The arrival holds it there in its cloud, then lets it go with that
      // same velocity: a switch at speed carries on, one in mid-air falls from where it was.
      if (next !== previous) {
        // Restore the parked body's dynamic type before it is reused. Selecting the same
        // kind leaves its existing hold alone.
        materialize.cancel(previous)
        const linvel = next.body.linvel(), angvel = next.body.angvel()
        void materialize.begin(next, { carry: { linvel: { ...linvel }, angvel: { ...angvel } } })
      }
      return next
    } catch (error) {
      console.error('swapVehicle', error)
      // A follower failed after the change: the new vehicle is in place, so report it.
      return slot.current === previous ? null : slot.current
    }
  }
  const join = () => {
    // Also restore after returning from an already joined galaxy menu.
    lobbyAddress.showPlay(shell.room || roomFromQuery(query))
    if (joined) return
    const player = slot.current
    // The lobby may have changed the vehicle after this one spawned. Rebuilding every system
    // that holds the player is riskier than a reload this close to the demo, so reload.
    if (!query.has('vehicle') && shell.vehicleKind !== player.kind && !(shell.vehicleKind === 'buggy-syn3h' && player.kind === 'buggy')) {
      // The entry intent, not the cleaned bar: it may hold the world the player was invited to.
      const url = lobbyAddress.playURL()
      url.searchParams.set('autoplay', '1')
      // An explicit lobby vehicle change starts a new session.
      try { sessionStorage.removeItem(RESUME_KEY) } catch {}
      // ResumeSession saves on both unload signals. Clear after its older listeners,
      // including a visibilitychange delivered after pagehide.
      const clearPreviousResume = () => {
        try { sessionStorage.removeItem(RESUME_KEY) } catch {}
      }
      window.addEventListener('pagehide', clearPreviousResume)
      document.addEventListener('visibilitychange', clearPreviousResume)
      location.replace(url)
      return
    }
    joined = true
    player.name = shell.playerName
    player.setColors?.(shell.bodyColor, shell.accentColor)
    const connection = startNetworking({
      game, terrain, player, audio, bots,
      nameplates: {
        shell: shell.element,
        visible: () => shell.vehicleLabelsVisible,
        presentation: () => shell.presentation,
      },
      // The sender owns the hold; snapshots carry its motion. This is cosmetic only.
      onRemoteVehicleChanged: vehicle => { void materialize.begin(vehicle, { hold: false }) },
      // A player or bot who leaves goes in the arrival cloud played in reverse.
      onRemoteVehicleLeaving: vehicle => materialize.depart(vehicle),
      cancelRemoteDeparture: vehicle => materialize.cancel(vehicle),
      kind: player.kind,
      colors: { body: shell.bodyColor, accent: shell.accentColor },
      name: shell.playerName,
      room: shell.room || roomFromQuery(query),
      setStatus: (lines) => { netStatus = lines; shell.setStatus(lines) },
      setMapEntities: (e) => shell.setMapEntities(e),
      setMatchState: (m) => shell.setMatchState(m),
      names: (seed, kind) => generateName(seed, kind),
      botName: (seed, taken) => uniqueBotName(seed, taken),
      botRole: seed => botIdentity(seed).role,
    })
    // Opening the in-play guide drops gear in hand without firing it: a Big Red charge is
    // discarded, a Yoink carry is set down (no fling), a reel stops and the tag control lets
    // go. The Grapple cord stays attached; the world keeps running.
    shell.setActionCancellation(() => {
      connection.bigRed.cancel(); connection.yoink.cancel(); connection.bungee.setReel(0)
      game.input.external.fire = false; game.input.mouseFire = false
    })
    connection.configureRaces({
      isDriving: () => shell.playing,
      setRace: (snapshot, roomNow, role) => shell.setRace(snapshot, roomNow, role),
    })
    // Networking keeps its own reference to the player and changes it in setPlayer.
    slot.onChange((next) => connection.setPlayer(next))
    shell.onRaceLeave = () => connection.leaveRace()
    shell.onRaceCancel = () => connection.cancelRace()
    // Every client reads the wind from the room's clock, so gusts agree between players.
    // Handed over by networking once that clock has synced (the sea gets it the same way).
    connection.onRoomClock((now) => { setWeatherClock(now); setDayClock(now) })
    // The room hears about a pause for either reason: the paused heartbeat (one message a
    // second) is the one thing that keeps running, so others see "paused", not a dropout.
    pause.subscribe((paused) => connection.setPaused(paused))
    connection.setPaused(pause.paused)
    // Chat (src/ui/chat): the pill, strip and log, inside the shell so it shows only in play.
    const chat = new ChatPanel(shell.element, {
      channel: connection.chat,
      input: game.input,
      canOpen: () => shell.playing && !game.input.suspended,
      releaseCursor: () => { if (document.pointerLockElement) document.exitPointerLock() },
      roster: () => [...connection.players.values()].filter((p) => p.id !== connection.id).map((p) => ({
        id: p.id, name: connection.displayName(p.id), bot: Boolean(p.bot),
        color: p.bot ? botColors(p.id - BOT_ID_BASE)[0] : p.colors[0],
      })),
    })
    // Bot banter (src/bots/banter): the host's bots talk, and answer people's requests.
    const banter = game.add(new HostBanter(game, terrain, connection, bots, environment))
    // For automated checks (tools/chat-check.mjs). Join can run before window.syn3h exists.
    Object.assign(window, { syn3hChat: { net: connection, panel: chat, banter } })
    // Remote players and bots are audible, positioned in space.
    audio.setVehicles(() => connection.audibleVehicles())
    game.add(new ResumeSession({ game, terrain, get player() { return slot.current }, room: shell.room || roomFromQuery(query), saved, network: connection, entrySearch: lobbyAddress.playURL().search }))
  }
  shell.onPlay = join
  // The in-play vehicle selector calls this; the shell takes it if it has the hook.
  ;(shell as unknown as { setVehicleSwap?: (swap: (kind: VehicleKind) => Vehicle | null) => void }).setVehicleSwap?.(swapVehicle)
  if (query.has('autoplay')) shell.play()

  const panel = new ParamPanel()
  shell.setParamPanel(panel)
  game.add({
    update() {
      const v = slot.current.body.linvel()
      const mph = Math.round(Math.hypot(v.x, v.y, v.z) * 2.23)
      hud.textContent = [`${mph} MPH   ${game.backend}   ${Math.round(game.fps)} fps`, ...netStatus].join('\n')
    },
  })

  // Water effects follow their normal-entry defaults and explicit player controls.
  game.add(new WaterEffects(game, terrain, slot, bots))

  // Handles for debugging and automated checks.
  // The game does not run in a background tab: one controller, obeyed by the loop here. Audio
  // and the lobby follow the same controller from their own modules.
  Object.assign(window, { syn3h: { planets, game, terrain, get player() { return slot.current }, slot, swapVehicle, materialize, params, panel, shell, audio, bots, camera, lifecycle, pause } })
  // Shell has captured invite/room state; quality, weather, resume and all other
  // startup URL readers have finished. Clean only the visible lobby, not a room
  // whose name happens to be "lobby". Autoplay is already in its intentional URL.
  shell.setLobbyAddress(lobbyAddress)
  game.start()
}

main().catch((err) => {
  console.error(err)
  const el = document.getElementById('fatal')!
  el.style.display = 'flex'
  el.style.flexDirection = 'column'
  el.style.gap = '16px'
  // The game never started, so nothing runs behind this: the only way on is a reload.
  el.textContent = `Syn3h failed to start: ${err?.message ?? err}`
  const reload = document.createElement('button')
  reload.type = 'button'
  reload.textContent = 'Reload'
  reload.style.cssText = 'font: inherit; padding: 10px 22px; border-radius: 8px; border: 1px solid #e8e6e3; background: transparent; color: inherit; cursor: pointer;'
  reload.addEventListener('click', () => location.reload())
  el.append(reload)
})
