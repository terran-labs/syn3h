/**
 * Composition root. Builds the world from the four seams and starts the loop.
 * Keep this file small: features belong behind the seams, not here.
 */
import { params, worldSeed } from '../shared/params'
import { ChaseCamera } from './core/ChaseCamera'
import { Game } from './core/Game'
import { startNetworking } from './net'
import { ParamPanel } from './ui/ParamPanel'
import { initGameShell } from './ui/Shell'
import { createVehicle } from './vehicles'
import { createEnvironment } from './world/Environment'
import { createTerrain } from './world'

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement
  const hud = document.getElementById('hud') as HTMLDivElement
  const query = new URLSearchParams(location.search)
  if (query.has('seed')) params.set(worldSeed.def.id, query.get('seed'), 'preset')

  const game = new Game(canvas)
  await game.init()

  const terrain = createTerrain(game, worldSeed.value)
  game.add(createEnvironment(game, terrain))

  const spawn = terrain.spawnPoint(0)
  const player = createVehicle(game, terrain, 'buggy', spawn.position, spawn.heading)
  player.isLocal = true
  game.add(player)
  // A new seed or terrain parameter rebuilds the ground in place: put the player back on it.
  terrain.onRegenerate?.(() => {
    const s = terrain.spawnPoint(0)
    player.teleport(s.position, s.heading)
  })

  const camera = game.add(new ChaseCamera(game, terrain))
  camera.target = player.object

  // The start screen collects the name and unlocks audio. Networking joins on Play so the
  // room sees the chosen name. ?autoplay=1 skips the screen for automated checks.
  const { shell, audio } = initGameShell(game, player, terrain)
  let netStatus: string[] = []
  let joined = false
  const join = () => {
    if (joined) return
    joined = true
    player.name = shell.playerName
    startNetworking({
      game, terrain, player,
      name: shell.playerName,
      room: shell.room || query.get('room') || 'lobby',
      setStatus: (lines) => { netStatus = lines; shell.setStatus(lines) },
    })
  }
  shell.onPlay = join
  if (query.has('autoplay')) join()

  const panel = new ParamPanel()
  game.add({
    update() {
      const v = player.body.linvel()
      const mph = Math.round(Math.hypot(v.x, v.y, v.z) * 2.23)
      hud.textContent = [`${mph} MPH   ${game.backend}   ${Math.round(game.fps)} fps`, ...netStatus].join('\n')
    },
  })

  // Handles for debugging and automated checks.
  Object.assign(window, { syn3h: { game, terrain, player, params, panel, shell, audio } })
  game.start()
}

main().catch((err) => {
  console.error(err)
  const el = document.getElementById('fatal')!
  el.style.display = 'flex'
  el.textContent = `Syn3h failed to start: ${err?.message ?? err}`
})
