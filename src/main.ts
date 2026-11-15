/**
 * Composition root. Builds the world from the four seams and starts the loop.
 * Keep this file small: features belong behind the seams, not here.
 */
import { prepareResume, ResumeSession, RESUME_KEY } from './core/resume'
import { PageLifecycle } from './core/lifecycle'
import { PauseState, type PauseControl } from './core/pause'
import { params, worldSeed } from '../shared/params'
import { BotManager } from './bots/BotManager'
import { ChaseCamera } from './core/ChaseCamera'
import { Game } from './core/Game'
import { startNetworking } from './net'
import { ParamPanel } from './ui/ParamPanel'
import { generateName } from './ui/data/names'
import { initGameShell } from './ui/Shell'
import { readVehicleChoice, saveVehicleChoice } from './ui/VehicleChoice'
import { type VehicleKind, createVehicle } from './vehicles'
import { attachVehicleEffects } from './vehicles/effects'
import { createEnvironment } from './world/Environment'
import { createPostChain } from './fx/post/PostChain'
import { createTerrain } from './world'
import * as planets from './world/planets'
import { applyPlanet, decodeWorld } from './world/planets'
import { WaterEffects } from './world/water/WaterEffects'
import { WeatherSystem, applyWeatherQuery, setWeatherClock } from './world/weather'

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement
  const hud = document.getElementById('hud') as HTMLDivElement
  const query = new URLSearchParams(location.search)
  // ?world=... opens a shared world exactly; ?planet=alpine picks a kind (with ?seed= or a
  // fresh seed). Both go through the parameter registry, so the room shares them.
  const shared = query.get('world')
  if (shared && decodeWorld(shared)) { /* applied */ }
  else if (query.has('planet')) applyPlanet(query.get('planet')!, query.has('seed') ? Number(query.get('seed')) : undefined, { source: 'preset' })
  else if (query.has('seed')) params.set(worldSeed.def.id, query.get('seed'), 'preset')

  const saved = prepareResume(query)
  if (saved && !query.has('room')) {
    query.set('room', saved.room)
    const url = new URL(location.href)
    url.searchParams.set('room', saved.room)
    history.replaceState(null, '', url)
  }
  const game = new Game(canvas)
  await game.init()

  const terrain = createTerrain(game, worldSeed.value)
  // Graphics levels thin out distant terrain on weaker devices.
  game.quality.attachTerrain(terrain)
  const environment = game.add(createEnvironment(game, terrain))
  // Post effects follow the player's settings and the current rendering budget.
  game.setPostChain(createPostChain(game, environment, () => player))

  const spawn = terrain.spawnPoint(0)
  // The vehicle comes from ?vehicle=..., else the choice saved by the lobby, else the Syn3h buggy.
  const choice = saved ? { vehicleKind: saved.kind, bodyColor: saved.colors.body, accentColor: saved.colors.accent } : readVehicleChoice()
  if (saved) saveVehicleChoice(choice)
  const kind = (query.get('vehicle') ?? choice.vehicleKind ?? 'buggy') as VehicleKind
  const player = createVehicle(game, terrain, kind, spawn.position, spawn.heading)
  player.isLocal = true
  player.setColors?.(choice.bodyColor, choice.accentColor)
  game.add(player)
  // Tracks, dust, thrusters and lights. Only the local vehicle gets a real headlight.
  attachVehicleEffects(game, terrain, player, { local: true })
  // A new seed or terrain parameter rebuilds the ground in place: put the player back on it.
  terrain.onRegenerate?.(() => {
    const s = terrain.spawnPoint(0)
    player.teleport(s.position, s.heading)
  })

  // Bots chase and ram the player. The 'bots.count' slider sets the requested fleet size.
  const bots = game.add(new BotManager(game, terrain, player))
  bots.setTargets([player])

  const camera = game.add(new ChaseCamera(game, terrain))
  camera.setVehicle(player)
  // A wrapping world carries the player, the camera and the bots across its seam.
  ;(terrain as { followSeam?: (f: unknown) => void }).followSeam?.({ player, camera, others: () => bots.vehicles })
  // Wind: a force on the vehicles this client owns (the player and its bots), never on remote
  // copies, whose owners apply it themselves. `?weather=0.5` sets the storminess for a look.
  game.add(new WeatherSystem(() => terrain, () => [player, ...bots.vehicles]))
  applyWeatherQuery(location.search)
  // The round planet is drawn relative to the camera: place it after the camera has moved.
  game.add({ update: () => (terrain as { afterCamera?: () => void }).afterCamera?.() })

  // The start screen collects the name and unlocks audio. Networking joins on Play so the
  // room sees the chosen name. ?autoplay=1 skips the screen for automated checks.
  const { shell, audio } = initGameShell(game, player, terrain)
  shell.configurePerformance({
    getPerformanceSnapshot: () => game.quality.getPerformanceSnapshot(),
    subscribePerformance: listener => game.quality.subscribePerformance(listener),
    setDiagnosticsVisible: visible => game.quality.setDiagnosticsVisible(visible),
    ignoreRecommendation: () => game.quality.ignoreRecommendation(),
    lowerRecommendedTier: () => game.quality.lowerRecommendedTier(),
  })
  // An idle lobby turns into a cinematic tour of the volcano, following a bot if there is one.
  shell.setAttractCamera(camera, () => bots.vehicles)
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
  const join = () => {
    if (joined) return
    // The lobby may have changed the vehicle after this one spawned. Rebuilding every system
    // that holds the player is riskier than a reload this close to the demo, so reload.
    if (!query.has('vehicle') && shell.vehicleKind !== player.kind && !(shell.vehicleKind === 'buggy-syn3h' && player.kind === 'buggy')) {
      const url = new URL(location.href)
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
    const joinedRoom = shell.room || query.get('room') || 'lobby'
    const joinedUrl = new URL(location.href)
    joinedUrl.searchParams.set('room', joinedRoom)
    history.replaceState(null, '', joinedUrl)
    const connection = startNetworking({
      game, terrain, player, audio, bots,
      kind: player.kind,
      colors: { body: shell.bodyColor, accent: shell.accentColor },
      name: shell.playerName,
      room: shell.room || query.get('room') || 'lobby',
      setStatus: (lines) => { netStatus = lines; shell.setStatus(lines) },
      setMapEntities: (e) => shell.setMapEntities(e),
      setMatchState: (m) => shell.setMatchState(m),
      names: (seed, kind) => generateName(seed, kind),
    })
    connection.configureRaces({
      isDriving: () => shell.playing,
      setRace: (snapshot, roomNow, role) => shell.setRace(snapshot, roomNow, role),
    })
    shell.onRaceLeave = () => connection.leaveRace()
    shell.onRaceCancel = () => connection.cancelRace()
    // Every client reads the wind from the room's clock, so gusts agree between players.
    // Handed over by networking once that clock has synced (the sea gets it the same way).
    connection.onRoomClock((now) => setWeatherClock(now))
    // The room hears about a pause for either reason: the paused heartbeat (one message a
    // second) is the one thing that keeps running, so others see "paused", not a dropout.
    pause.subscribe((paused) => connection.setPaused(paused))
    connection.setPaused(pause.paused)
    // Remote players and bots are audible, positioned in space.
    audio.setVehicles(() => connection.audibleVehicles())
    game.add(new ResumeSession({ game, terrain, player, room: shell.room || query.get('room') || 'lobby', saved, network: connection }))
  }
  shell.onPlay = join
  if (query.has('autoplay')) shell.play()

  const panel = new ParamPanel()
  shell.setParamPanel(panel)
  game.add({
    update() {
      const v = player.body.linvel()
      const mph = Math.round(Math.hypot(v.x, v.y, v.z) * 2.23)
      hud.textContent = [`${mph} MPH   ${game.backend}   ${Math.round(game.fps)} fps`, ...netStatus].join('\n')
    },
  })

  // Water effects follow their normal-entry defaults and explicit player controls.
  game.add(new WaterEffects(game, terrain, player, bots))

  // Handles for debugging and automated checks.
  // The game does not run in a background tab: one controller, obeyed by the loop here. Audio
  // and the lobby follow the same controller from their own modules.
  Object.assign(window, { syn3h: { planets, game, terrain, player, params, panel, shell, audio, bots, camera, lifecycle, pause } })
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
