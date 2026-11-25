/**
 * Composition root. Builds the world from the four seams and starts the loop.
 * Keep this file small: features belong behind the seams, not here.
 */
import './core/legacyWindowNames'
import { initializeFrozenResources } from './core/frozenResources'
import { ResumeSession, RESUME_KEY } from './core/resume'
import { applyStartWorld } from './core/startWorld'
import { createWorldEntry, freshVehicle, seatAfterRebuild } from './core/worldEntry'
import { currentPlanet, currentWorldName, encodeWorld, randomSeed } from './world/planets'
import { ParallelUniverses, gameOnScreen, holdVeil, moveVeilLine } from './ui/parallelUniverse'
import { PageLifecycle } from './core/lifecycle'
import { PauseState, type PauseControl } from './core/pause'
import { liquidEligible, liquidSelected, restoreGlassMaterial, liquidQualityHint, setGlassForVisit } from './ui/glassMaterial'
import { glassStyle } from './ui/inspector/params'
import { params, worldSeed } from '../shared/params'
import { BotManager } from './bots/BotManager'
import { botsKeepCount } from './bots/params'
import { ChaseCamera } from './core/ChaseCamera'
import { flashSwitches, sunShadowsLine } from './core/flashSwitches'
import { recordBlankFrames } from './core/blankFrames'
import { startFlashCounter } from './ui/flashCounter'
import { fieldSwitchLine, setFieldSwitchHooks } from './core/fieldSwitches'
import { diagnosticReport } from './core/diagnosticReport'
import { refractionState } from './world/water/refraction'
import { depthEffectsState } from './core/midPassCopy'
import { Game } from './core/Game'
import { showStartFailure, startupTiming } from './core/diagnostics'
import { canCreateWebGL2, startFailure } from './core/graphicsSupport'
import { botColors, startNetworking } from './net'
import { BOT_ID_BASE } from '../shared/protocol'
import { ChatCard } from './ui/chat/ChatCard'
import { HostBanter } from './bots/banter/HostBanter'
import { ParamPanel } from './ui/ParamPanel'
import { LobbyAddress } from './ui/LobbyAddress'
import { roomFromQuery } from './core/roomAddress'
import { botIdentity, generateName } from './ui/data/names'
import { initGameShell } from './ui/Shell'
import { readVehicleChoice, saveVehicleChoice } from './ui/VehicleChoice'
import { type VehicleKind, createVehicle } from './vehicles'
import { PlayerSlot } from './vehicles/PlayerSlot'
import { createVehicleSwapper } from './vehicles/swap'
import { Materialize } from './vehicles/effects/Materialize'
import { onZorbPulse, warmZorbShields } from './vehicles/zorb'
import type { Vehicle } from './vehicles/Vehicle'
import { createEnvironment } from './world/Environment'
import { PostChain } from './fx/post/PostChain'
import { createTerrain } from './world'
import * as planets from './world/planets'
import { WaterEffects } from './world/water/WaterEffects'
import { WeatherSystem, applyWeatherQuery, setWeatherClock } from './world/weather'
import { applyWordmarkQuery } from './ui/brand/wordmarkFlags'
import { setDayClock } from './world/sky/dayCycle'
import { screenEdgesLine } from './ui/screenEdges'
import { sessionStore } from './core/safeStorage'

async function main(): Promise<void> {
  initializeFrozenResources(location.href)
  const canvas = document.getElementById('game') as HTMLCanvasElement
  const hud = document.getElementById('hud') as HTMLDivElement
  const query = new URLSearchParams(location.search)
  // A link's world, else this tab's resumed session, else a fresh random planet. Automated
  // browsers (navigator.webdriver: the smoke tests, frame profiles and shot tools) keep the
  // old fixed seed 1, so their measurements compare from run to run.
  const { saved } = applyStartWorld(query, sessionStore(), navigator.webdriver ? () => 1 : randomSeed)
  // Keep the original entry/resume URL until all startup consumers have read it.
  const lobbyAddress = new LobbyAddress(location, history)
  // A full room sends the player to a parallel universe of the world they were entering, and the
  // Players & session card offers one (ui/parallelUniverse.ts). Read at start: why this page is here.
  const universes = new ParallelUniverses({
    room: () => shell.room || roomFromQuery(query),
    entryURL: () => lobbyAddress.playURL(),
    world: () => encodeWorld(),
    // The loading veil comes up at once with the move's line, so the descent hands straight over
    // to the same veil the next page holds until its game is on screen: one continuous entry.
    navigate: (url, move) => {
      holdVeil(moveVeilLine(move), () => false)
      location.replace(url)
    },
    notice: (text, actions) => shell.showRoomNotice(text, actions),
    setUniverse: state => shell.setUniverse(state),
    copyLink: () => shell.copyRoomLink(),
  })
  // Opened by a move: the veil stays up, saying why, until the game is on screen. Never the lobby between.
  // Also when the veil's inline script set the hold from a note this script now finds too old:
  // a ready game must never stay behind the veil (index.html owns the hold as well).
  if (universes.arrived || document.documentElement.hasAttribute('data-room-move')) holdVeil(universes.arrived ? moveVeilLine(universes.arrived) : null, () => gameOnScreen())
  const game = new Game(canvas)
  await game.init()

  const terrain = createTerrain(game, worldSeed.value)
  // Graphics levels thin out distant terrain on weaker devices.
  game.quality.attachTerrain(terrain)
  const environment = game.add(createEnvironment(game, terrain), 'Environment and sky')
  // Post effects follow the player's settings and the current rendering budget.
  const mode = query.get('glass')
  const stopMaterial = restoreGlassMaterial(mode === 'inline' || mode === 'target', flashSwitches.uiFlat)
  game.add({ dispose: stopMaterial }, 'Interface material preference')
  let glass: import('./fx/post/GlassPost').GlassPost | undefined
  let loading: Promise<void> | undefined
  const post = new PostChain(game, environment)
  const loadGlass = () => loading ??= import('./fx/post/GlassPost').then(({ GlassPost }) => {
    glass = new GlassPost(mode === 'target' ? 'target' : 'inline')
    post.attachGlass(glass)
  }).finally(() => { loading = undefined })
  if (liquidSelected()) {
    try { await loadGlass() } catch (error) { console.warn('Glass shader unavailable, using CSS', error) }
  }
  // ?post=off (core/flashSwitches.ts): the scene straight to the canvas, no post chain.
  game.setPostChain(flashSwitches.post === 'off' ? null : post)

  const spawn = terrain.spawnPoint(0)
  // The vehicle comes from ?vehicle=..., else the choice saved by the lobby, else the Mira buggy.
  const choice = saved ? { vehicleKind: saved.kind, bodyColor: saved.colors.body, accentColor: saved.colors.accent } : readVehicleChoice()
  if (saved) saveVehicleChoice(choice)
  const kind = (query.get('vehicle') ?? choice.vehicleKind ?? 'buggy') as VehicleKind
  const player = createVehicle(game, terrain, kind, spawn.position, spawn.heading)
  player.isLocal = true
  player.setColors?.(choice.bodyColor, choice.accentColor)
  game.add(player, 'Player vehicle')
  // Everything that follows the player reads it from this slot, so the vehicle can be changed
  // in place without rebuilding those systems. `player` is only the vehicle spawned first.
  const slot = new PlayerSlot(player)
  game.vehicleKind = () => slot.current.kind
  // Tracks, dust, thrusters and lights, with the real headlight a local vehicle gets. The
  // swapper owns them from here on: it moves them when the vehicle changes.
  const swapper = createVehicleSwapper(game, terrain, slot)
  // A new seed or terrain parameter rebuilds the ground in place: put the player back on it.
  // Entering a different world (another planet from the galaxy, or the room moving everyone
  // to one) gives the player a fresh vehicle on the spawn pad: modes off, nothing held,
  // nothing carried over. A rebuild of the same world (a slider, quality, the worker) keeps
  // the modes and re-seats the vehicle where it is (seatAfterRebuild).
  const enteredWorld = createWorldEntry()
  terrain.onRegenerate?.(() => {
    const entered = enteredWorld()
    if (entered) freshVehicle(slot.current, game.input, { daydream: bots.daydream, materialize })
    seatAfterRebuild(slot.current, terrain, entered, 0)
  })

  // Bots chase and ram the player. The 'bots.count' slider sets the requested fleet size.
  const bots = game.add(new BotManager(game, terrain, player), 'Bot manager')
  bots.setTargets([player])
  slot.onChange((next) => bots.setPlayer(next))

  const camera = game.add(new ChaseCamera(game, terrain), 'Chase camera')
  camera.setVehicle(player)
  slot.onChange((next) => camera.setVehicle(next))
  // A wrapping world carries the player, the camera and the bots across its seam.
  ;(terrain as { followSeam?: (f: unknown) => void }).followSeam?.({ get player() { return slot.current }, camera, others: () => bots.vehicles })
  // Wind: a force on the vehicles this client owns (the player and its bots), never on remote
  // copies, whose owners apply it themselves. `?weather=0.5` sets the storminess for a look.
  game.add(new WeatherSystem(() => terrain, () => [slot.current, ...bots.vehicles]), 'Weather')
  applyWeatherQuery(location.search)
  // ?wordmark= and ?intro=: silent developer overrides for the lobby's name and opening.
  applyWordmarkQuery(location.search)
  // The round planet is drawn relative to the camera: place it after the camera has moved.
  game.add({ update: () => (terrain as { afterCamera?: () => void }).afterCamera?.() }, 'Terrain after camera')

  // The start screen collects the name and unlocks audio. Networking joins on Play so the
  // room sees the chosen name. ?autoplay=1 skips the screen for automated checks.
  const { shell, audio, setPlayer } = initGameShell(game, player, terrain, query.get('name'))
  if (glass) shell.driveGlassFrame = glass.driveFrame
  let postCheckQueued = false
  const materialChanged = params.onChange((id) => {
    if (id.startsWith('post.') && glass && shell.playing && liquidSelected()) {
      // A preset writes several parameters synchronously. Inspect the final graph before the next draw.
      if (!postCheckQueued) {
        postCheckQueued = true
        queueMicrotask(() => {
          postCheckQueued = false
          if (shell.playing && liquidSelected() && !post.selectedGlassPrepared && !shell.transitioning) {
            shell.applyGlassMaterial(async () => {})
          }
        })
      }
      return
    }
    if (id !== glassStyle.def.id && id !== 'gfx.quality') return
    if (!liquidSelected()) {
      shell.driveGlassFrame = undefined
      glass?.release(glassStyle.value === 0 ? liquidQualityHint : 'CSS material selected')
      shell.refreshLobbyGlass()
      return
    }
    if (glass && (id === 'gfx.quality' || post.glassPrepared)) {
      shell.driveGlassFrame = glass.driveFrame
      shell.refreshLobbyGlass()
      return
    }
    void shell.applyGlassMaterial(async () => {
      if (!glass) await loadGlass()
      if (!liquidSelected()) return
      shell.driveGlassFrame = glass!.driveFrame
      shell.refreshLobbyGlass()
    })
  })
  game.add({ dispose: materialChanged }, 'Interface material changes')
  bots.daydream.setBlocker(() => shell.daydreamBlocked)
  // The HUD bridge, hints and the engine voice follow the slot.
  slot.onChange(setPlayer)
  // A vehicle arriving by a switch hangs in a small glowing cloud for a second, then drops.
  const materialize = game.add(new Materialize(game, terrain, { onCue: (cue, position, _hold, vehicle) => audio.materialize(cue, position, vehicle) }), 'Vehicle materialization')
  // Bots arrive one at a time once the player can drive (never while entering a world or in
  // the menus), each in the arrival cloud near the player, and leave in it.
  bots.setArrivalGate(() => shell.playing ? 'playing' : shell.transitioning ? 'closed' : 'idle')
  bots.setArrivalEffect(materialize)
  game.add(warmZorbShields(game), 'Zorb shields')
  const offZorbPulse = onZorbPulse((_ball, centre) => audio.zorbPulse(centre))
  game.add({ dispose: offZorbPulse }, 'Zorb audio')
  let sessionNetwork: ReturnType<typeof startNetworking> | undefined
  const glassDiagnostics = () => {
    if (glassStyle.value !== 0) return 'Glass: off, 0 surfaces'
    if (!liquidEligible()) return 'Glass: ' + liquidQualityHint
    if (!shell.playing && shell.lobbyGlassContextLost) return 'Glass: lobby graphics context lost, using Glass'
    return glass?.diagnosticLine() ?? 'Glass: shader unavailable, using Glass'
  }
  const copyDiagnostics = () => {
    const botKinds = bots.remote && sessionNetwork
      ? Array.from(sessionNetwork.players.values()).filter(player => player.bot).map(player => player.kind)
      : bots.vehicles.map(bot => bot.kind)
    return diagnosticReport(game.quality.getPerformanceSnapshot(), slot.current.kind, botKinds, currentWorldName(), currentPlanet().label,
      sessionNetwork?.diagnosticLine(), game.quality.levelChanges, audio.musicReportLine) + '\n' + glassDiagnostics() + '\n' + screenEdgesLine() +
      // Refraction copies the frame mid-pass; not yet measured on a phone (world/water/refraction.ts).
      '\nWater refraction: ' + refractionState(game.renderer) +
      // Copies taken in the middle of the scene pass (core/midPassCopy.ts), off where not yet proven.
      '\nForce field contact glow: ' + depthEffectsState() + '\nHeadlight beam soft edge: ' + depthEffectsState() +
      (game.blankFrames ? '\n' + game.blankFrames.reportLines().join('\n') : '') + '\n' + sunShadowsLine() + '\n' + fieldSwitchLine() +
      (game.frameCanary ? '\n' + game.frameCanary.reportLines().join('\n') : '') +
      (game.frameProbe ? '\n' + game.frameProbe.reportLines().join('\n') : '') +
      (flashSwitches.presentHold ? `\nPresent hold: ${game.presentHeldFrames} frames not drawn while the previous frame's GPU work ran` : '') +
      // Device loss: this page's and the last page's in this tab (core/lossRecord.ts).
      (game.lossRecorder ? game.lossRecorder.reportLines().map(line => '\n' + line).join('') : '')
  }
  // ?blank=1 (core/flashSwitches.ts): the recorder on from the link, its counter on screen in play.
  // ?frameCanary=1 and ?frameProbe=1 share the counter box (ui/flashCounter.ts); the blank switch shows or hides its
  // blank-frame part, live from Field switches (core/fieldSwitches.ts).
  let stopCounter: (() => void) | null = null
  const blankCounter = (blank: boolean) => {
    stopCounter?.(); stopCounter = null
    if (blank) params.set(recordBlankFrames.def.id, true)
    if (blank || game.frameCanary || game.frameProbe) stopCounter = startFlashCounter(() => game.blankFrames, () => shell.playing && !shell.transitioning, () => game.frameCanary, blank, () => game.frameProbe, () => shell.panelsOpen ? document.querySelector('.world-inspector:not([inert])') : null)
  }
  blankCounter(flashSwitches.blank)
  // ?canvasBackdrop=1 (core/flashSwitches.ts): magenta behind the canvas in play. Every frame we
  // draw is opaque over it, so magenta on screen is a frame the browser showed with nothing drawn
  // in it. Read four times a second, so the Field switches box applies it live.
  const backdropStyle = document.createElement('style')
  backdropStyle.textContent = 'html[data-flash-backdrop],html[data-flash-backdrop] body{background:#ff00ff!important}'
  document.head.append(backdropStyle)
  const backdrop = setInterval(() => document.documentElement.toggleAttribute('data-flash-backdrop', flashSwitches.canvasBackdrop && shell.playing && !shell.transitioning), 250)
  game.add({ dispose: () => { clearInterval(backdrop); document.documentElement.removeAttribute('data-flash-backdrop') } }, 'Canvas backdrop')
  game.add({ dispose: () => { stopCounter?.(); stopCounter = null } }, 'Blank frame counter')
  // The same switches, live from Performance, Diagnostics, Field switches (core/fieldSwitches.ts).
  setFieldSwitchHooks({
    refreshPins: ids => game.quality.refreshPins(ids),
    setPost: on => game.setPostChain(on ? post : null),
    setFlatGlass: on => setGlassForVisit(on),
    setBlankCounter: blankCounter,
  })
  shell.configurePerformance({
    runPerformanceCheck: async signal => (await import('./diagnostics/inWorldCheck')).runInWorldCheck({
      game, terrain, shell, bots, camera, slot, materialize, swapper, net: sessionNetwork,
      glass: glassDiagnostics,
      diagnostics: copyDiagnostics,
    }, signal),
    diagnosticReport: copyDiagnostics,
    blankFrameCounts: () => game.blankFrames?.counts() ?? null,
    getPerformanceSnapshot: () => game.quality.getPerformanceSnapshot(),
    subscribePerformance: listener => game.quality.subscribePerformance(listener),
    setDiagnosticsVisible: visible => {
      game.quality.setDiagnosticsVisible(visible)
      if (glass) glass.timing.visible = visible
    },
    ignoreRecommendation: () => game.quality.ignoreRecommendation(),
    lowerRecommendedTier: () => game.quality.lowerRecommendedTier(),
    fewerRecommendedBots: () => game.quality.fewerRecommendedBots(),
  })
  // The bots this client simulates are one of the quality system's steps (src/core/quality.ts
  // BotRelief): fewer bots before a coarser picture, when they measurably cost frames. A
  // guest simulates none: the host's device carries them.
  game.quality.attachBots({
    carried: () => bots.remote ? 0 : bots.vehicles.length,
    requested: () => bots.remote ? 0 : bots.requested,
    // A host keeping its count (bots.keepCount): bots are never the governor's to shed.
    costly: targetMs => !bots.remote && !botsKeepCount.value && bots.pacer.costly(bots.vehicles.length, targetMs),
    shed: byPlayer => !bots.remote && (byPlayer || !botsKeepCount.value) && bots.pacer.shed(bots.vehicles.length, byPlayer),
    climb: () => !bots.remote && bots.pacer.climb(bots.vehicles.length, bots.requested),
  })
  // The descent from the galaxy poses this camera.
  shell.setCinematicCamera(camera)
  // Nearby bots are audible, positioned in space. Remote players join this list later.
  audio.setVehicles(() => bots.vehicles)
  // Two triggers, one state (src/core/pause.ts): the page being hidden, and the player's own
  // pause from the shell. The loop stops while either holds.
  const pause = new PauseState()
  pause.subscribe((paused, reason) => {
    if (paused) game.pause()
    else game.resume()
    glass?.setPausedDraw(reason === 'user' ? () => game.redrawPaused() : undefined)
  })
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
    const name = shell.playerName
    player.name = name
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
      name,
      room: shell.room || roomFromQuery(query),
      // A full room: on to a parallel universe (or, failing every room, the local play
      // networking has already started). Any other status is shown as it is.
      onJoinStatus: message => { if (!universes.onJoinStatus(message)) shell.showRoomNotice(message, []) },
      onWelcome: () => universes.onWelcome(),
      setStatus: (lines) => { netStatus = lines; shell.setStatus(lines) },
      setMapEntities: (e) => shell.setMapEntities(e),
      setMatchState: (m) => shell.setMatchState(m),
      names: (seed, kind) => generateName(seed, kind),
      botRole: seed => botIdentity(seed).role,
    })
    // Seed the hello before the socket opens. Networking's legacy URL fallback can still
    // see the raw link name after showPlay, even when the player edited it in the lobby.
    connection.setName(name)
    sessionNetwork = connection
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
    pause.subscribe((paused, reason) => connection.setPaused(paused, reason))
    connection.setPaused(pause.paused, pause.reason)
    // Chat (src/ui/chat): the last card in the sidebar's stack, and a strip of new lines over
    // the game. Y, the card's header and the left column's Chat row open it.
    const chat = new ChatCard({
      element: shell.element,
      addCard: (id, title, body, summary) => shell.addCard(id, title, body, summary),
      showCard: (id) => shell.showCard(id),
      drive: () => shell.returnToDriving(),
      panelsOpen: () => shell.panelsOpen,
    }, {
      channel: connection.chat,
      input: game.input,
      canOpen: () => shell.playing && !game.input.suspended,
    })
    // Who is in the room as names are shown: the Players & session rows, the match board and
    // toasts mark each bot with the bot icon in its colour (src/ui/playerMarks.ts).
    shell.setPlayerRoster(() => [...connection.players.values()].map((p) => ({
      id: p.id, name: connection.displayName(p.id), bot: Boolean(p.bot),
      color: p.bot ? botColors(p.id - BOT_ID_BASE)[0] : p.colors[0],
    })))
    // Bot banter (src/bots/banter): the host's bots talk, and answer people's requests.
    const banter = game.add(new HostBanter(game, terrain, connection, bots, environment), 'Host banter')
    // For automated checks (tools/chat-check.mjs). Join can run before window.mira exists.
    Object.assign(window, { miraChat: { net: connection, panel: chat, banter } })
    // Remote players and bots are audible, positioned in space.
    audio.setVehicles(() => connection.audibleVehicles())
    game.add(new ResumeSession({ game, terrain, get player() { return slot.current }, room: shell.room || roomFromQuery(query), saved, network: connection, entrySearch: lobbyAddress.playURL().search }), 'Session resume')
  }
  shell.onPlay = join
  // The in-play vehicle selector calls this; the shell takes it if it has the hook.
  ;(shell as unknown as { setVehicleSwap?: (swap: (kind: VehicleKind) => Vehicle | null) => void }).setVehicleSwap?.(swapVehicle)
  // An automatic start: the cursor stays free and the panels open (Shell.requestEntryCursor).
  if (query.has('autoplay')) shell.play(false, true)

  const panel = new ParamPanel()
  shell.setParamPanel(panel)
  game.add({
    update() {
      const v = slot.current.body.linvel()
      const mph = Math.round(Math.hypot(v.x, v.y, v.z) * 2.23)
      hud.textContent = [`${mph} MPH   ${game.backend}   ${Math.round(game.fps)} fps`, ...netStatus].join('\n')
    },
  }, 'Driving HUD')

  // Water effects follow their normal-entry defaults and explicit player controls.
  game.add(new WaterEffects(game, terrain, slot, bots), 'Water effects')

  // Handles for debugging and automated checks.
  // The game does not run in a background tab: one controller, obeyed by the loop here. Audio
  // and the lobby follow the same controller from their own modules.
  Object.assign(window, { mira: { planets, game, terrain, get player() { return slot.current }, slot, swapVehicle, materialize, params, panel, shell, audio, bots, camera, lifecycle, pause } })
  // Shell has captured invite/room state; quality, weather, resume and all other
  // startup URL readers have finished. Clean only the visible lobby, not a room
  // whose name happens to be "lobby". Autoplay is already in its intentional URL.
  shell.setLobbyAddress(lobbyAddress)
  game.start()
}

main().catch((err) => {
  console.error(err)
  // The game never started, so nothing runs behind this. A device that cannot draw at all is
  // told what it can do instead (no Reload: it cannot help there); anything else gets a plain
  // sentence and a Reload, with the raw error behind Details (graphicsSupport.ts).
  showStartFailure(startFailure(err, { rendererStarted: Boolean(startupTiming.backend), webgl2: canCreateWebGL2() }))
})
