/**
 * Composition root. Builds the world from the four seams and starts the loop.
 * Keep this file small: features belong behind the seams, not here.
 */
import { prepareResume, ResumeSession, RESUME_KEY } from './core/resume'
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
import { createTerrain } from './world'
import * as planets from './world/planets'
import { applyPlanet, decodeWorld } from './world/planets'

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
  game.add(createEnvironment(game, terrain))

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

  // Bots chase and ram the player. The 'bots.count' slider sets how many (0 by default).
  const bots = game.add(new BotManager(game, terrain, player))
  bots.setTargets([player])

  const camera = game.add(new ChaseCamera(game, terrain))
  camera.setVehicle(player)
  // A wrapping world carries the player, the camera and the bots across its seam.
  ;(terrain as { followSeam?: (f: unknown) => void }).followSeam?.({ player, camera, others: () => bots.vehicles })

  // The start screen collects the name and unlocks audio. Networking joins on Play so the
  // room sees the chosen name. ?autoplay=1 skips the screen for automated checks.
  const { shell, audio } = initGameShell(game, player, terrain)
  // An idle lobby turns into a cinematic tour of the volcano, following a bot if there is one.
  shell.setAttractCamera(camera, () => bots.vehicles)
  // Nearby bots are audible, positioned in space. Remote players join this list later.
  audio.setVehicles(() => bots.vehicles)
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

  // Handles for debugging and automated checks.
  Object.assign(window, { syn3h: { planets, game, terrain, player, params, panel, shell, audio, bots, camera } })
  game.start()
}

main().catch((err) => {
  console.error(err)
  const el = document.getElementById('fatal')!
  el.style.display = 'flex'
  el.textContent = `Syn3h failed to start: ${err?.message ?? err}`
})
