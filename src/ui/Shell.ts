import { GEAR_LABELS, type GearRack, type GearId } from '../weapons/Gear'
import { postTier } from '../fx/post/gate'
import { PerformancePanel } from './PerformancePanel'
import type { PauseControl } from './pauseControl'
import { HeightAboveGround } from './heightAboveGround'
import type { PerformanceSource } from '../core/performance'
import { SavedWorldStore, SAVED_WORLDS_KEY, savedWorldPlan, worldIdentity, type SavedWorld } from './galaxy/savedWorlds'
import { SavedMoons } from './galaxy/SavedMoons'
import type { Game, System } from '../core/Game'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Terrain } from '../world/Terrain'
import { params, worldSeed } from '../../shared/params'
import { GameAudio } from '../audio'
import { masterVolume, effectsVolume, engineVolume, windVolume, dirtVolume, worldVolume, cuesVolume, remoteVolume, musicVolume } from '../audio/params'
import { applySkyPreset, SKY_PRESET_NAMES, type SkyPresetName } from '../world/sky/presets'
import { TouchControls } from './TouchControls'
import { readVehicleChoice, saveVehicleChoice, PLAY_VEHICLES, type VehicleChoice } from './VehicleChoice'
import { SlidingPanels } from './SlidingPanels'
import { populationLabel } from './galaxy/presence'
import { wordmarkSvg } from './brand/logo'
import { Galaxy, GALAXY_MAX, type GalaxyWorld } from './galaxy/Galaxy'
import { placeLabels } from './galaxy/labels'
import { createDaydreamControl } from '../bots/daydreamControl'
import { Inspector } from './inspector/Inspector'
import { FocusHud } from './inspector/FocusHud'
import { RaceHud, type RaceRole } from './RaceHud'
import type { RaceState } from '../../shared/protocol'
import { glassStyle, diagnostics } from './inspector/params'
import { RESUME_KEY } from '../core/resume'
import { qualityLevel } from './quality/ladder'
import { Vector3 } from 'three/webgpu'
import { PLANETS } from '../world/planets'
import { graphicsLevel, levelNumber } from '../core/quality'
import { camDistance, camFov, camHeight, camOffset } from '../core/ChaseCamera'
import { applyPlanet, currentPlanet, encodeWorld, planetName } from '../world/planets'
import { AttractMode, type CinematicCamera } from './AttractMode'
import { InviteView, inviteUrl, renderQr } from './InviteView'
import { Scoreboard, parseScoreRow } from './Scoreboard'
import { canEditWorld, hostControls, resetWorld } from './worldPermissions'
import type { ParamPanel } from './ParamPanel'
import { MatchHud, type MatchState } from './MatchHud'
import { creditsHtml } from './data/credits'
import { generateName } from './data/names'
import { Minimap, type MapEntity } from './Minimap'
import { bootLoading } from './LoadingScreen'
import { renderHelp, touchHelp } from './VehicleHelp'
import { PlayHints, type Hint } from './PlayHints'
import type { VehicleKind } from '../vehicles'
import './shell.css'
import './exploration.css'
import './theme-halo.css'

/** Keys that mean "I want to drive": they resume a pause and capture the cursor. */
const DRIVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
const back = '<button type="button" class="panel-back link-button" data-goto="index">Back</button>'
/** `__SYN3H_BUILD__` is an optional build-time constant (a date or tag) from the bundler. */
declare const __SYN3H_BUILD__: string | undefined
const buildLine = typeof __SYN3H_BUILD__ === 'string' && __SYN3H_BUILD__ ? `build version : ${__SYN3H_BUILD__}` : 'browser edition'
const heading = (text: string) => `<h2 tabindex="-1">${text}</h2>`

export class Shell implements System {
  readonly element = document.createElement('div')
  onPlay?: () => void
  private readonly abort = new AbortController()
  private readonly nameInput: HTMLInputElement
  private readonly roomInput: HTMLInputElement
  private readonly overlay: HTMLElement
  private readonly speed: HTMLElement
  private readonly choice: VehicleChoice = readVehicleChoice()
  private attract?: AttractMode
  private lastActivity = performance.now()
  private requestedAttract = new URL(location.href).searchParams.get('attract') === '1'
  private readonly invite: InviteView
  private inviteOpen = false
  private inviteFromGame = false
  private playerCount = 0
  private lastInviteUrl = ''
  private readonly matchHud: MatchHud
  private minimap?: Minimap
  private readonly panels: SlidingPanels
  private readonly board: Scoreboard
  private readonly hudBoard: Scoreboard
  private paramPanel?: ParamPanel
  /** Slider groups the advanced panel is limited to, when it was opened from the custom planet. */
  private advancedGroups?: readonly string[]
  private worldDirty = true
  private readonly inspector: Inspector
  private readonly focusHud: FocusHud
  private readonly raceHud: RaceHud
  onRaceLeave?: () => void
  onRaceCancel?: () => void
  private telemetry = { speed: 0, altitude: 0 }
  /** The 3D galaxy: the lobby. Absent only where WebGL 2 is, and then the game cannot draw either. */
  private galaxy?: Galaxy
  /** Arrived by an invite link that names a world: that world is the one to enter. */
  private readonly invited = (() => { const query = new URLSearchParams(location.search); return query.has('room') && query.has('world') })()
  private started = false
  private menuVisible = true
  private readonly previousSuspended: boolean
  private helpTimer?: ReturnType<typeof setTimeout>
  /** Listeners that dismiss the short controls card on the player's first input. */
  private helpInput?: AbortController
  private activeVehicleKind: VehicleKind = this.choice.vehicleKind
  private toastTimer?: ReturnType<typeof setTimeout>
  readonly touch: TouchControls

  constructor(private readonly game: Game, readonly audio: GameAudio) {
    this.previousSuspended = game.input.suspended; game.input.suspended = true
    this.element.className = 'syn3h-shell exploration-ui'
    this.element.innerHTML = `<section class="shell-overlay" role="dialog" aria-modal="true" aria-label="Syn3h lobby">
      <div class="lobby-stage">
      <header class="lobby-brand">${wordmarkSvg('shell-logo')}</header>
      <div class="lobby-panels">
        <section data-panel="index" class="lobby-index">
          <h1 tabindex="-1">Welcome to the future.</h1>
          <div class="lobby-message"><p>You’ve discovered a community where all are welcome, and new ideas are celebrated.</p><p class="lobby-room-label"></p><div class="invite-qr menu-qr"></div><p class="invite-link"></p><button class="shell-invite link-button">Copy invite link</button></div>
          <p class="lobby-unsupported" hidden>Syn3h needs WebGL 2, which this browser does not offer. A current Safari, Chrome, Firefox or Edge will run it.</p><nav class="lobby-destinations" aria-label="Worlds"><button class="return-game is-primary" data-resume hidden>Return to Game</button></nav>
          <div class="lobby-links"><button data-goto="worlds">Worlds</button><button data-goto="multiplayer">Multiplayer</button><button data-join>Join by QR</button><button data-goto="settings">Settings</button><button data-goto="about">About</button></div>
        </section>
        <section data-panel="explore">${heading('Prepare to Explore')}
          <form class="shell-form"><label for="shell-name">Player name</label><input id="shell-name" name="playerName" maxlength="24" autocomplete="nickname" placeholder="Explorer">
          <label for="shell-room">Room</label><div class="input-action"><input id="shell-room" name="room" maxlength="64" autocomplete="off"><button class="shell-invite" type="button">Copy invite</button></div>
          <div class="shell-controls"><span><b>WASD / arrows</b> Drive</span><span><b>Space</b> Wings</span><span><b>Shift</b> Brake</span><span><b>L / click</b> Plasma Tag</span></div><p class="shell-touch-hint">Left thumb to drive. Right thumb for wings, brake and tag.</p>
          <button class="shell-play is-primary" type="submit">Enter World ›</button></form>${back}
        </section>
        <section data-panel="worlds">${heading('Worlds to Explore')}
          <p class="planet-current"></p><fieldset class="world-controls"><legend>World</legend><label for="world-seed">Seed</label><div class="input-action"><input id="world-seed" type="number" min="1" max="999999" step="1"><button id="new-world" type="button">New world</button></div><label class="bots-control" hidden>Bots <output></output><input id="bots-count" type="range" step="1"></label></fieldset>
          <fieldset class="world-controls"><legend>Sky</legend><div class="sky-presets">${SKY_PRESET_NAMES.map(name => `<button type="button" data-sky="${name}">${name}</button>`).join('')}</div><label for="sky-time">Time of day <output id="sky-time-value"></output></label><input id="sky-time" type="range" min="0" max="24" step="0.05"></fieldset>
          <p class="world-lock-note" hidden>Sliders locked by host.</p><button data-goto="explore">Explore this world ›</button>${back}
        </section>
        <section data-panel="settings">${heading('Settings')}<div class="settings-links"><button data-goto="music">Music & sound</button><button data-goto="worlds">World & sky</button><button data-goto="advanced">Advanced sliders</button><button class="presentation-toggle" aria-pressed="false">Presentation · P</button></div><fieldset class="host-controls"><legend>Host</legend><label class="host-lock" hidden><input type="checkbox" id="host-lock"> Lock shared sliders</label><p class="host-note"></p><button class="world-reset" type="button">Reset world to defaults</button></fieldset>${back}</section>
        <section data-panel="music">${heading('Music & Sound')}<label for="music-volume">Music volume <output id="music-volume-value"></output></label><input id="music-volume" type="range" min="0" max="1" step="0.01">${[masterVolume,effectsVolume,engineVolume,dirtVolume,windVolume,worldVolume,remoteVolume,cuesVolume].map(p=>`<label>${p.def.label}<input data-audio-param="${p.def.id}" type="range" min="0" max="1" step="0.01" value="${p.value}"></label>`).join('')}<button class="shell-mute" aria-pressed="false">Mute all audio</button><p class="panel-note">The music is generated as you play and follows what you do. It starts with your first click or key press.</p>${back}</section>
        <section data-panel="multiplayer">${heading('Multiplayer')}<label class="mode-control" hidden>Game mode<select id="game-mode"><option value="0">Tag</option><option value="1">King of the Hill</option></select></label><p class="multiplayer-room"></p><div class="invite-qr"></div><p class="invite-link"></p><button class="shell-invite">Copy invite link</button><button data-join>Show on screen · J</button><div class="shell-scoreboard" aria-label="Player scores"></div>${back}</section>
        <section data-panel="advanced">${heading('Advanced Settings')}<p class="world-lock-note" hidden>Sliders locked by host.</p><div class="advanced-host"></div>${back}</section>
        <section data-panel="about">${heading('About Syn3h')}${creditsHtml}${back}</section>
      </div>
      <footer class="lobby-footer"><span class="shell-message" role="status" aria-live="polite"></span><span class="build-line">${buildLine}</span></footer>
      </div>
      <div class="galaxy-ui" hidden><div class="galaxy-labels"></div><p class="galaxy-hint">Drag to look around. Tap a world to go there.</p><nav class="lobby-links galaxy-links" aria-label="Lobby"><button data-goto="worlds">Worlds</button><button data-goto="multiplayer">Multiplayer</button><button data-join>Join by QR</button><button data-goto="settings">Settings</button><button data-goto="about">About</button></nav></div>
    </section>
    <aside class="shell-hud" hidden><div class="shell-speed"><strong>0</strong><span>MPH</span></div><div class="hud-scoreboard"></div></aside>
    <nav class="hud-navigation" aria-label="Game menu" hidden><button class="shell-menu-button inspector-toggle" type="button" aria-label="Open the panels" aria-pressed="false"><span aria-hidden="true">≡</span><span class="nav-label"> Panels</span></button></nav>
    <button type="button" class="pause-veil" hidden><strong>Paused</strong><span class="pause-how">Click to resume</span><small hidden>The world carries on without you.</small></button>
    <aside class="spawn-help" role="status" hidden><strong>Controls</strong><div></div><small></small></aside>
    <div class="shell-toast" role="status" aria-live="polite" hidden></div>`
    document.body.append(this.element); document.body.classList.add('has-game-shell')
    this.invite = new InviteView(this.element, () => this.closeJoin(), () => { void this.copyInvite() })
    this.matchHud = new MatchHud(this.element, () => audio.cue('tick'))
    this.overlay = this.element.querySelector('.shell-overlay')!
    this.nameInput = this.element.querySelector('#shell-name')!; this.roomInput = this.element.querySelector('#shell-room')!
    this.speed = this.element.querySelector('.shell-speed strong')!
    this.panels = new SlidingPanels(this.element.querySelector('.lobby-panels')!)
    this.board = new Scoreboard(this.element.querySelector('.shell-scoreboard')!, text => {this.toast(text);if(/joined/i.test(text))audio.cue('join');else if(/left/i.test(text))audio.cue('leave');else if(/tagged| is it/i.test(text))audio.cue('tag')})
    this.hudBoard = new Scoreboard(this.element.querySelector('.hud-scoreboard')!, () => {})
    this.touch = new TouchControls(game.input); this.element.classList.toggle('has-touch', this.touch.available)
    const signal = this.abort.signal
    this.followPointer(signal)
    this.menuVisible = true; this.overlay.hidden = false; this.overlay.inert = false; if (this.galaxy) this.galaxy.enabled = true
    this.releaseCursor()
    // Daydream: how long the game waits, left alone, before it starts driving itself. The
    // control and its parameter are the Bots lane's; it sits with the first settings.
    const daydream = createDaydreamControl()
    this.element.querySelector('.settings-links')!.after(daydream); signal.addEventListener('abort', () => daydream.dispose())
    // The world inspector and the display for when the cursor is captured (inspector/).
    this.inspector = new Inspector(this.element, {
      summary: id => this.inspectorSummary(id),
      // Vehicles are chosen in play only (the lobby offers planets). Four, one design each.
      vehicles: () => ({ options: PLAY_VEHICLES, current: this.activeVehicleKind === 'buggy' ? 'buggy-syn3h' : this.activeVehicleKind }),
      onVehicle: id => this.switchVehicle(id as VehicleKind),
      onSaveWorld: () => this.saveWorld(),
    })
    // The owner's rule, 15 November 2026: "Panels being open or closed should be a simple
    // function of cursor locking." With the cursor captured you are driving and only the
    // display shows; with it free the panels are open. There is no stored open or closed
    // state: `syncPanels` derives it from the real lock, every frame and on every lock event.
    this.inspector.open = false
    const railTop = this.inspector.element.querySelector('.wi-top')!
    const navigation = document.createElement('div'); navigation.className = 'rail-navigation'
    navigation.innerHTML = '<button type="button" class="exit-world">↗ Exit world</button><button type="button" class="rail-pause">Pause</button><button type="button" class="rail-close" aria-label="Return to driving">×</button>'
    railTop.prepend(navigation)
    const players = document.createElement('details'); players.className = 'rail-players'
    players.innerHTML = '<summary>Players & session <span>↗</span></summary><div class="rail-player-body"><button type="button" class="rail-invite">Invite players</button><label class="rail-diagnostics"><input type="checkbox"> Connection diagnostics</label></div>'
    players.querySelector('.rail-player-body')!.prepend(this.element.querySelector('.hud-scoreboard')!)
    railTop.after(players)
    this.performancePanel = new PerformancePanel(this.element, () => this.showPanels())
    railTop.querySelector('.wi-actions')!.append(this.performancePanel.toggle)
    players.after(this.performancePanel.element)
    const gear = document.createElement('select'); gear.className = 'gear-select'; gear.setAttribute('aria-label', 'Gear'); gear.disabled = true
    this.inspector.element.querySelector('.wi-gear-slot')!.append(gear)
    gear.addEventListener('change', () => {
      const rack = (window as unknown as { syn3hNet?: { gear?: GearRack } }).syn3hNet?.gear
      if (rack?.list().includes(gear.value as GearId)) { rack.select(gear.value as GearId); this.audio.cue('click') }
    }, { signal })
    navigation.querySelector('.exit-world')!.addEventListener('click', () => this.openMenu(), { signal })
    players.querySelector('.rail-invite')!.addEventListener('click', () => this.openJoin(), { signal })
    players.querySelector('input')!.addEventListener('change', event => params.set(diagnostics.def.id, (event.target as HTMLInputElement).checked), { signal })
    const music = document.createElement('div'); music.className = 'rail-music'
    music.innerHTML = `<span>Sound</span><button type="button" class="rail-mute">Mute</button>`
    players.querySelector('.rail-player-body')!.append(music)
    music.querySelector('button')!.addEventListener('click', () => this.audio.setMuted(!this.audio.isMuted), { signal })
    this.focusHud = new FocusHud(this.element)
    this.raceHud = new RaceHud(this.element, { leave: () => this.onRaceLeave?.(), cancel: () => this.onRaceCancel?.() })
    // Touch has no cursor to capture, so one control switches between driving and the panels.
    const toggle = this.element.querySelector<HTMLButtonElement>('.inspector-toggle')!
    toggle.addEventListener('click', () => { this.touchPanels = !this.touchPanels; this.syncPanels() }, { signal })
    // Returning to driving is capturing the cursor; this click is the gesture that allows it.
    navigation.querySelector('.rail-close')!.addEventListener('click', () => this.drive(), { signal })
    navigation.querySelector('.rail-pause')!.addEventListener('click', () => this.requestPause(), { signal })
    this.element.querySelector('.pause-veil')!.addEventListener('click', () => this.requestResume(), { signal })
    // Follow the lock itself, not what was asked for: the browser can drop it on its own
    // (Escape, a switch of window, a system dialog) and can refuse a request.
    document.addEventListener('pointerlockchange', () => this.syncPanels(), { signal })
    document.addEventListener('pointerlockerror', () => this.syncPanels(), { signal })
    this.glass(signal)
    for (const slider of this.element.querySelectorAll<HTMLInputElement>('[data-param]')) slider.addEventListener('input', () => params.set(slider.dataset.param!, Number(slider.value)), { signal })
    this.startGalaxy()
    this.mountSavedWorlds()
    window.addEventListener('storage', event => { if (event.key === SAVED_WORLDS_KEY || event.key === null) this.refreshSavedWorlds() }, { signal })
    const unsubscribeWorld = params.onChange(id => { if (params.get(id)?.def.scope === 'world') { this.worldDirty = true; this.refreshCustomPlanet() } })
    signal.addEventListener('abort', unsubscribeWorld)
    try { this.nameInput.value = localStorage.getItem('syn3h.playerName') || '' } catch { /* Storage is optional. */ }
    if (!this.nameInput.value.trim()) {
      let seed = ''
      try { seed = localStorage.getItem('syn3h.nameSeed') || '' } catch { /* Storage is optional. */ }
      if (!seed) { seed = String(crypto.getRandomValues(new Uint32Array(1))[0]); try { localStorage.setItem('syn3h.nameSeed', seed) } catch { /* Storage is optional. */ } }
      this.nameInput.value = generateName(seed, 'player')
    }
    this.roomInput.value = new URL(location.href).searchParams.get('room')?.trim().slice(0, 64) || 'lobby'
    this.roomInput.addEventListener('input', () => this.updateRoomLabels(), { signal }); this.updateRoomLabels()
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-goto]')) button.addEventListener('click', () => this.showPanel(button.dataset.goto!), { signal })
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-open]')) button.addEventListener('click', () => this.openMenu(button.dataset.open!), { signal })
    for (const button of this.element.querySelectorAll('[data-join]')) button.addEventListener('click', () => this.openJoin(), { signal })
    this.element.querySelector('[data-resume]')!.addEventListener('click', () => this.closeMenu(), { signal })
    this.element.querySelector('form')!.addEventListener('submit', event => { event.preventDefault(); this.play(true) }, { signal })
    for (const button of this.element.querySelectorAll('.shell-invite')) button.addEventListener('click', () => { void this.copyInvite() }, { signal })
    this.element.querySelector('.presentation-toggle')!.addEventListener('click', () => this.setPresentation(!this.presentation), { signal })
    for (const slider of this.element.querySelectorAll<HTMLInputElement>('[data-param]')) if (document.activeElement !== slider) slider.value = String(params.get(slider.dataset.param!)?.value ?? 0)
    for(const slider of this.element.querySelectorAll<HTMLInputElement>('[data-audio-param]'))slider.addEventListener('input',()=>params.set(slider.dataset.audioParam!,Number(slider.value)),{signal})
    this.element.querySelector('.shell-mute')!.addEventListener('click', () => { audio.setMuted(!audio.isMuted); this.update() }, { signal })
    this.element.querySelector('#music-volume')!.addEventListener('input', event => params.set(musicVolume.def.id, (event.target as HTMLInputElement).value), { signal })
    this.element.querySelector('#world-seed')!.setAttribute('value', String(worldSeed.value))
    this.element.querySelector('#world-seed')!.addEventListener('input', event => { (event.target as HTMLInputElement).dataset.dirty = 'true' }, { signal })
    this.element.querySelector('#new-world')!.addEventListener('click', () => {
      if (!canEditWorld()) return
      const input = this.element.querySelector<HTMLInputElement>('#world-seed')!
      const seed = Number(input.value)
      if (!Number.isInteger(seed) || seed < 1 || seed > 999999) { this.toast('Choose a seed from 1 to 999999.'); return }
      params.set(worldSeed.def.id, seed); delete input.dataset.dirty
    }, { signal })
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-sky]')) button.addEventListener('click', () => { if (canEditWorld()) applySkyPreset(button.dataset.sky as SkyPresetName) }, { signal })
    this.element.querySelector('#sky-time')!.addEventListener('input', event => { if (canEditWorld()) params.set('sun.timeOfDay', (event.target as HTMLInputElement).value) }, { signal })
    this.element.querySelector('#bots-count')!.addEventListener('input', event => { if (canEditWorld()) params.set('bots.count', (event.target as HTMLInputElement).value) }, { signal })
    this.element.querySelector('#game-mode')!.addEventListener('change', event => { if (canEditWorld() && params.get('game.mode')) params.set('game.mode', Number((event.target as HTMLSelectElement).value)) }, { signal })
    // Two presses: the first asks, the second (within four seconds) does it. No modal dialog.
    const reset = this.element.querySelector<HTMLButtonElement>('.world-reset')!
    let resetArmed: ReturnType<typeof setTimeout> | undefined
    const disarm = () => { clearTimeout(resetArmed); resetArmed = undefined; reset.textContent = 'Reset world to defaults'; reset.classList.remove('is-confirming') }
    reset.addEventListener('click', () => {
      if (!canEditWorld()) return
      if (!resetArmed) {
        reset.textContent = hostControls() ? 'Press again to reset for everyone' : 'Press again to reset this world'
        reset.classList.add('is-confirming'); resetArmed = setTimeout(disarm, 4000); return
      }
      disarm(); this.toast(resetWorld() ? 'World reset to defaults.' : 'Sliders locked by host.')
    }, { signal })
    signal.addEventListener('abort', () => clearTimeout(resetArmed))
    this.element.querySelector('#host-lock')!.addEventListener('change', event => { const net = hostControls(); if (net?.isHost) net.setLocked((event.target as HTMLInputElement).checked) }, { signal })
    const activity = (event: Event) => {
      this.lastActivity = performance.now()
      if (this.attract?.active && event.type !== 'pointermove') { this.stopAttract(); event.preventDefault(); event.stopImmediatePropagation() }
    }
    for (const type of ['keydown', 'pointerdown', 'wheel', 'pointermove']) window.addEventListener(type, activity, { capture: true, signal, passive: false })
    window.addEventListener('keydown', event => this.keydown(event), { capture: true, signal })
    // Native controls keep their defaults and local handlers, but must not drive or fire.
    // Let keyup reach Input even when focus moved while a driving key was held.
    this.element.addEventListener('keydown', event => {
      if (event.target instanceof Element && event.target.closest('button, input, select, textarea, summary, [contenteditable=true]')) event.stopPropagation()
    }, { signal })
    game.canvas.addEventListener('pointerdown', event => {
      if (!this.started || this.menuVisible || game.input.suspended || event.pointerType === 'touch' || event.button !== 0) return
      // The first click in play captures the cursor: from then on moving the mouse swings the
      // camera round the vehicle (ChaseCamera reads the locked pointer), and Escape lets the
      // cursor go again, which the browser does itself. That first click only captures.
      // (Networking also listens for clicks here, after this listener; stop it hearing this one.)
      if (this.userPaused) return
      if (this.capturesCursor && document.pointerLockElement !== game.canvas) { void this.captureCursor(); event.stopImmediatePropagation(); return }
      game.input.mouseFire = true
      if (document.pointerLockElement !== game.canvas) game.canvas.setPointerCapture(event.pointerId)
    }, { signal })
    // Losing the capture (Escape, a switch of window) must not leave a beam held down.
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== game.canvas) game.input.mouseFire = false }, { signal })
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) game.canvas.addEventListener(name, () => { game.input.mouseFire = false }, { signal })
    window.addEventListener('blur', () => { game.input.mouseFire = false }, { signal })
    this.updateHelp(); bootLoading?.finish()
    void this.panels.show('index', true); this.update()
  }
  private updateRoomLabels(): void {
    this.element.querySelector('.lobby-room-label')!.textContent = `Room: ${this.room}`
    this.element.querySelector('.multiplayer-room')!.textContent = `Room: ${this.room}`
    this.updateInvite()
  }
  private updateInvite(): void {
    const url = inviteUrl(location.origin, this.room, encodeWorld())
    if (url !== this.lastInviteUrl) {
      this.lastInviteUrl = url
      for (const host of this.overlay.querySelectorAll('.invite-qr')) renderQr(host, url)
      for (const text of this.overlay.querySelectorAll('.invite-link')) text.textContent = url
    }
    this.invite.update(url, this.room, this.playerCount)
  }
  openJoin(): void {
    this.stopAttract()
    if (this.inviteOpen) return
    this.inviteFromGame = this.started && !this.menuVisible
    if (this.inviteFromGame) { this.releaseCursor(); this.game.input.suspended = true; this.game.input.mouseFire = false; this.touch.enabled = false }
    this.inviteOpen = true; this.overlay.inert = true; this.invite.show(); this.updateInvite()
  }
  closeJoin(): void {
    if (!this.inviteOpen) return
    this.inviteOpen = false; this.invite.hide(); this.overlay.inert = false
    if (this.inviteFromGame) this.closeMenu()
    else this.element.querySelector<HTMLButtonElement>('[data-join]')!.focus()
  }
  get vehicleKind(): VehicleChoice['vehicleKind'] { return this.choice.vehicleKind }
  get bodyColor(): string { return this.choice.bodyColor }
  get accentColor(): string { return this.choice.accentColor }
  get playerName(): string { return this.nameInput.value.trim().slice(0, 24) || 'Explorer' }
  get room(): string { return this.roomInput.value.trim().slice(0, 64) || 'lobby' }
  get playing(): boolean { return this.started && !this.menuVisible }
  get menuOpen(): boolean { return this.menuVisible }
  get activePanel(): string { return this.panels.active }
  get presentation(): boolean { return this.element.classList.contains('is-presentation') }
  setPresentation(enabled: boolean): void { this.element.classList.toggle('is-presentation', enabled); this.element.querySelector('.presentation-toggle')!.setAttribute('aria-pressed', String(enabled)) }
  setPlayerCount(count: number): void { this.playerCount = Math.max(0, Math.floor(count)); this.updateInvite() }
  private lastMatch: MatchState | null = null
  setRace(snapshot: Readonly<RaceState> | null, roomNow: () => number, role: Readonly<RaceRole>): void {
    this.raceHud.setState(snapshot, roomNow, role)
  }
  setMatchState(state: MatchState | null): void {
    const prev=this.lastMatch
    if(state?.mode==='koth'){
      if(state.winner && state.winner!==prev?.winner)this.audio.cue('win')
      else if(state.contested&&!prev?.contested)this.audio.cue('contested')
      else if(state.holderIsYou&&!state.contested&&(!prev?.holderIsYou||prev.contested))this.audio.cue('capture')
      else if(prev?.holderIsYou&&!state.holderIsYou)this.audio.cue('lost')
      else if(state.holderName&&state.holderName!==prev?.holderName&&!state.contested)this.audio.cue('capture')
    }
    // The adaptive score follows the match: your share of the target, and whether you hold the hill.
    const mine=state?.scores.find(score=>score.you)
    this.audio.setMatch(state&&!state.winner?{holding:state.holderIsYou&&!state.contested,contested:state.contested&&state.holderIsYou,progress:mine&&state.target>0?mine.score/state.target:0}:null)
    this.lastMatch=state?{...state}:null
    this.matchHud.setState(state)
  }
  setTerrain(terrain: Terrain): void { this.ground = terrain; this.minimap?.dispose(); this.minimap = new Minimap(terrain, this.element); this.attract?.dispose(); this.attract = new AttractMode(terrain, this.element) }
  setAttractCamera(camera: CinematicCamera, bots: () => readonly Vehicle[] = () => []): void { this.cinematic = camera; this.attract?.setCamera(camera, bots) }
  startAttract(): void { if (!this.started && !this.inviteOpen) this.attract?.start() }
  stopAttract(): void { this.attract?.stop(); this.lastActivity = performance.now(); this.requestedAttract = false }
  get attracting(): boolean { return this.attract?.active ?? false }
  setMapEntities(entities: readonly MapEntity[]): void { this.minimap?.setEntities(entities) }
  setMapSelf(entity: MapEntity): void { this.self = entity; this.minimap?.setSelf(entity) }
  /** The player's speed (m/s) and height above the ground (m), for the focus display. */
  setTelemetry(speed: number, altitude: number): void { this.telemetry.speed = speed; this.telemetry.altitude = altitude }
  private inspectorSummary(id: string): string {
    if (id === 'world') return `${currentPlanet().label} · ${planetName(worldSeed.value)}`
    if (id === 'sky') { const hour = Number(params.get('sun.timeOfDay')?.value ?? 0); return `${String(Math.floor(hour) % 24).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}` }
    if (id === 'game') { const bots = Number(params.get('bots.count')?.value ?? 0); return `${Number(params.get('game.mode')?.value ?? 0) === 1 ? 'King of the Hill' : 'Tag'}${bots ? ` · ${bots} ${bots === 1 ? 'bot' : 'bots'}` : ''}` }
    if (id === 'vehicles') { const current = this.activeVehicleKind === 'buggy' ? 'buggy-syn3h' : this.activeVehicleKind; return PLAY_VEHICLES.find(vehicle => vehicle.id === current)?.label ?? '' }
    return id === 'you' ? 'yours only' : ''
  }
  /**
   * Change vehicle in play. The game builds its vehicle once at start, so this saves the
   * choice and reloads straight back into the same room, as the lobby does. The player
   * starts again from a spawn pad.
   */
  private switchVehicle(kind: VehicleKind): void {
    if (kind === this.activeVehicleKind || (kind === 'buggy-syn3h' && this.activeVehicleKind === 'buggy')) return
    saveVehicleChoice({ ...this.choice, vehicleKind: kind })
    try { sessionStorage.removeItem(RESUME_KEY) } catch { /* Storage is optional. */ }
    // The resume session saves the old vehicle again while the page unloads (pagehide, then
    // visibilitychange), which would undo this choice. These listeners are registered after
    // its own, so each runs after that save and clears it. The URL stays free of ?vehicle=,
    // which would otherwise override later lobby choices.
    const forget = () => { try { sessionStorage.removeItem(RESUME_KEY) } catch { /* Storage is optional. */ } }
    window.addEventListener('pagehide', forget); document.addEventListener('visibilitychange', forget)
    const url = new URL(location.href); url.searchParams.delete('vehicle'); url.searchParams.set('autoplay', '1')
    location.replace(url)
  }
  setLoadingMessages(messages: string[]): void { bootLoading?.setMessages(messages) }
  setParamPanel(panel: ParamPanel): void { this.paramPanel = panel }
  showPanel(id: string): void {
    if(id!==this.panels.active)this.audio.cue('click')
    this.lastActivity = performance.now()
    this.galaxyFor(id)
    if (id !== 'advanced') this.advancedGroups = undefined
    if (id === 'advanced') {
      const panel = this.paramPanel ?? (window as unknown as { syn3h?: { panel?: ParamPanel } }).syn3h?.panel
      panel?.show(this.element.querySelector('.advanced-host')!); panel?.setGroups(this.advancedGroups); this.paramPanel = panel
    } else this.paramPanel?.hide()
    void this.panels.show(id)
  }
  /**
   * Enter the world. From the lobby's own button (`descend`), with the galaxy up, the entry is
   * a descent: the view falls toward the chosen world until its air fills the screen, then
   * the game's camera comes down out of that brightness from high above the spawn point to
   * its place behind the vehicle, and the blur clears. The room is joined at the start, so
   * the wait is spent falling. Called from code (tests, autoplay, Return to Game) it is
   * immediate, and so it is for anyone who asks for reduced motion.
   */
  play(descend = false): void {
    this.stopAttract()
    if (this.started) { this.closeMenu(); return }
    this.unlockAudio(); this.begin()
    if (descend && this.galaxy?.live && this.menuVisible && !matchMedia('(prefers-reduced-motion: reduce)').matches) { this.onPlay?.(); void this.descent(currentPlanet().id); return }
    this.closeMenu(); this.showHelp(false); this.onPlay?.()
  }
  /** Audio may only start inside a tap or a key press: call this from one. */
  private unlockAudio(): void {
    void this.audio.unlock().then(async () => { await this.audio.ready(); this.audio.play('materialize') }).catch(() => this.toast('Audio is unavailable. You can still play.'))
  }
  /** The session starts: the name is kept and the choices that cannot change in play are fixed. */
  private begin(): void {
    // Entering a world is the start of driving, by whichever route (Play, a world in the
    // galaxy, a saved world). Ask for the cursor now, while the click or key press that got
    // here still counts as a gesture; a refusal just leaves the cursor free and the panels open.
    // An automatic start (a reload after switching vehicle, ?autoplay=1) has no gesture. Some
    // browsers would grant the cursor anyway and others refuse, so it is not asked for: such
    // a start always arrives with the cursor free and the panels open.
    const gesture = (navigator as { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? true
    if (!this.started && this.capturesCursor && gesture) void this.captureCursor(true)
    try { localStorage.setItem('syn3h.playerName', this.playerName) } catch { /* Playing does not require storage. */ }
    this.started = true; this.worldDirty = true; this.nameInput.disabled = true; this.roomInput.disabled = true
    this.element.querySelector<HTMLButtonElement>('.shell-play')!.textContent = 'Return to Game ›'
    this.element.querySelector<HTMLElement>('[data-resume]')!.hidden = false
  }
  /**
   * A world tapped in the galaxy. Any world but Custom is a drop, straight from the tap: no
   * form, no pause. Returns true when the tap is dealt with here (a drop, or a refusal).
   */
  private tapWorld(galaxyId: string): boolean {
    const id = galaxyId.split('~')[0], current = currentPlanet().id
    if (this.dropping) return true
    if (id === 'custom') return false
    if (this.invited && !this.started && id !== current) { this.say('You were invited to another world. You can change it once you are in, if the host allows.'); return true }
    if (!canEditWorld() && id !== current) { this.say('The host has locked this world.'); return true }
    this.stopAttract()
    // No galaxy to fly through (or no motion wanted): straight in.
    if (!this.galaxy?.live || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (id !== current) applyPlanet(id)
      if (this.started) this.closeMenu(); else this.play()
      return true
    }
    if (!this.started) this.unlockAudio()
    void this.descent(galaxyId, () => {
      // Under the light, where a hitch cannot be seen: the world is built and the room joined.
      if (id !== currentPlanet().id) applyPlanet(id)
      if (!this.started) { this.begin(); this.onPlay?.() }
    })
    return true
  }
  /** True from a drop's tap until the player is on the ground. */
  private dropping = false
  openMenu(panel = 'index'): void {
    if (!this.started) return
    this.menuVisible = true; this.overlay.hidden = false; this.overlay.inert = false; if (this.galaxy) this.galaxy.enabled = true
    this.releaseCursor()
    this.game.input.suspended = true; this.game.input.mouseFire = false; this.game.input.poll(); this.touch.enabled = false
    this.audio.enabled = false; this.audio.setLobbyVisible(true); this.element.classList.remove('is-playing'); this.showPanel(panel)
  }
  /**
   * The drop, one unbroken motion. The galaxy flies across the system to the world and down
   * into its air, with motion blur (Galaxy.descend). Under the light at the bottom of the
   * dive `underLight` builds the world and joins the room, and the drop holds there only as
   * long as the room takes to answer (a slow join can rebuild the world and move the spawn
   * point). Then the game shows through, blurred, its camera falling from 520 m and easing
   * into the follow camera's own place behind the vehicle, which takes over from there. A
   * player who has seen it before gets a quicker drop; a tap, click or key lands at once.
   */
  private async descent(galaxyId: string, underLight?: () => void): Promise<void> {
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const game = document.getElementById('game'), root = this.element, camera = this.cinematic
    this.dropping = true; root.classList.add('is-descending'); this.overlay.inert = true
    const skipping = new AbortController()
    let landed = false
    try {
      let seen = 0
      try { seen = Number(localStorage.getItem('syn3h.descents')) || 0; localStorage.setItem('syn3h.descents', String(seen + 1)) } catch { /* Storage is optional. */ }
      let skip = false
      // Listen from the next frame, so the tap that started the drop does not also end it.
      requestAnimationFrame(() => { for (const type of ['pointerdown', 'keydown'] as const) addEventListener(type, () => { skip = true }, { signal: skipping.signal, capture: true }) })
      const until = async (done: () => boolean, ms: number) => { const end = performance.now() + ms; while (!done() && !skip && performance.now() < end) await frame() }
      // While the lobby still covers it, put the game's camera high over the spawn point.
      const view = (this.game as unknown as { camera?: { position: Vector3 } }).camera
      const lift = () => { pose(0); if (view && this.descentTop) view.position.copy(this.descentTop) }
      let pose = this.descentPose(); lift()
      let dived = false
      void this.galaxy!.descend(galaxyId, seen > 0).then(() => { dived = true })
      await until(() => dived, 4000)
      underLight?.()
      await until(() => Boolean((window as { syn3hNet?: { connected?: boolean } }).syn3hNet?.connected), 5000)
      // The spawn point may have moved with the room's world: start from over where the player is now.
      pose = this.descentPose(); lift()
      // Through the air: the lobby fades off the top of the game, which arrives blurred and clears.
      const length = skip ? 0 : seen > 0 ? 1700 : 2400
      if (game) { game.style.transition = 'none'; game.style.filter = skip ? 'none' : 'blur(12px) brightness(1.3)' }
      this.overlay.style.transition = `opacity ${skip ? 0.2 : 0.6}s ease-out`; this.overlay.style.opacity = '0'
      await frame()
      if (game && !skip) { game.style.transition = `filter ${(length * 0.7 / 1000).toFixed(2)}s cubic-bezier(.1,.6,.3,1)`; game.style.filter = 'none' }
      const started = performance.now()
      await new Promise<void>((resolve, reject) => { const step = () => { try { const t = skip || length === 0 ? 1 : Math.min(1, (performance.now() - started) / length); pose(t); if (t < 1) requestAnimationFrame(step); else resolve() } catch (error) { reject(error) } }; step() })
      // The camera eases along the path a little behind it: let it settle into the follow
      // camera's place, then hand over with a blend (an instant cut where that is not offered).
      const end = this.descentEnd
      if (view && end && !skip) await until(() => view.position.distanceTo(end) < 0.15, 1200)
      if (camera) (camera.clearCinematicPose as (blendSeconds?: number) => void).call(camera, skip ? 0 : 0.8)
      landed = true
    } catch (error) {
      console.warn('World descent failed', error)
      this.say('The flight was interrupted. You can continue playing or choose a world again.')
    } finally {
      // Whatever happened on the way (a world that failed to build, say), never leave the
      // lobby inert, blurred or half faded: put everything back and let the player in.
      skipping.abort()
      if (!landed) camera?.clearCinematicPose()
      this.overlay.style.removeProperty('transition'); this.overlay.style.removeProperty('opacity'); root.classList.remove('is-descending')
      if (game) { game.style.removeProperty('transition'); game.style.removeProperty('filter') }
      this.dropping = false
      if (this.started) { this.closeMenu(); this.showHelp(false) } else { this.releaseCursor(); this.overlay.inert = false; this.galaxy?.home() }
    }
  }
  /** The first and last points of the descent's camera path, for waiting on the camera. */
  private descentTop?: Vector3
  private descentEnd?: Vector3
  /**
   * The descent's camera path over where the player is now: t from 0 (520 m up, looking down
   * at the spawn point) to 1 (where the follow camera sits: behind the vehicle by its arm,
   * raised by its height ratio, looking level along the vehicle's heading). It falls fast at
   * first, carrying on the dive's speed, and slows into place.
   */
  private descentPose(): (t: number) => void {
    const self = this.self, ground = this.ground, camera = this.cinematic
    if (!self || !camera) { this.descentTop = this.descentEnd = undefined; return () => {} }
    const floor = ground?.heightAt(self.x, self.z) ?? 0, at = new Vector3(self.x, floor, self.z)
    const ahead = new Vector3(-Math.sin(self.heading), 0, -Math.cos(self.heading))
    const arm = camOffset.value + camDistance.value, body = floor + Math.max(0.5, this.telemetry.altitude)
    const end = new Vector3(at.x - ahead.x * arm, body + arm * camHeight.value, at.z - ahead.z * arm)
    const endLook = end.clone().addScaledVector(ahead, 60)
    const startHeight = 520, endHeight = Math.max(1.5, end.y - floor)
    this.descentTop = new Vector3(at.x - ahead.x * 40, floor + startHeight, at.z - ahead.z * 40); this.descentEnd = end
    const position = new Vector3(), look = new Vector3()
    return t => {
      const fall = 1 - (1 - t) ** 2.4, turnTo = t * t * t * (t * (t * 6 - 15) + 10)
      const height = Math.exp(Math.log(startHeight) + (Math.log(endHeight) - Math.log(startHeight)) * fall), back = 40 + (arm - 40) * fall
      position.set(at.x - ahead.x * back, floor + height, at.z - ahead.z * back)
      look.copy(at).lerp(endLook, turnTo)
      // The field of view goes from about the galaxy's (64 degrees) to the follow camera's own.
      ;(camera.setCinematicPose as (position: Vector3, target: Vector3, fov?: number) => void).call(camera, position.clone(), look.clone(), 64 + (camFov.value - 64) * fall)
    }
  }
  private ground?: Terrain
  private cinematic?: CinematicCamera
  private self?: MapEntity
  closeMenu(): void {
    if (!this.started) return
    this.menuVisible = false; this.overlay.hidden = true; this.overlay.inert = true; if (this.galaxy) this.galaxy.enabled = false
    this.game.input.suspended = false; this.touch.enabled = true; this.audio.enabled = true; this.audio.setLobbyVisible(false); this.paramPanel?.hide()
    this.element.classList.add('is-playing')
    this.element.querySelector<HTMLElement>('.shell-hud')!.hidden = false
    this.element.querySelector<HTMLElement>('.hud-navigation')!.hidden = false
    this.touchPanels = false; this.syncPanels()
  }
  private performancePanel!: PerformancePanel
  configurePerformance(source: PerformanceSource): void { this.performancePanel.configure(source) }
  /** Touch only: the panels are showing rather than the driving view. Never stored. */
  private touchPanels = false
  /** Panels are wanted exactly when the cursor is free (or, on touch, when the menu state is on). */
  private get panelsWanted(): boolean {
    if (!this.started || this.menuVisible) return false
    return this.capturesCursor ? document.pointerLockElement !== this.game.canvas : this.touchPanels
  }
  private syncPanels(): void {
    const wanted = this.panelsWanted
    if (this.inspector.open !== wanted) {
      this.inspector.hideTooltip(); this.inspector.open = wanted
      this.element.querySelector('.inspector-toggle')!.setAttribute('aria-pressed', String(wanted))
    }
    const locked = this.started && !this.menuVisible && !this.game.input.suspended && document.pointerLockElement === this.game.canvas
    if (this.element.classList.contains('is-focus') !== locked) this.element.classList.toggle('is-focus', locked)
  }
  /** Show the panels: on a desktop that is letting the cursor go. */
  private showPanels(): void { if (this.capturesCursor) this.releaseCursor(); else this.touchPanels = true; this.syncPanels() }
  /** Return to driving: on a desktop that is capturing the cursor, which needs a gesture. */
  private drive(): void { if (this.capturesCursor) void this.captureCursor(); else this.touchPanels = false; this.syncPanels() }

  // Pause. One state shared with the page lifecycle (src/core/pause.ts, the integrator's):
  // 'user' is a second Escape or the Pause button, 'hidden' is a background tab. Audio fades
  // and stops for both; the message shows for the player's own pause only. The game loop is
  // stopped while paused, so nothing here relies on frames.
  private pauseControl?: PauseControl
  private pauseUnsubscribe?: () => void
  private userPaused = false
  setPauseControl(control: PauseControl): void {
    this.pauseUnsubscribe?.(); this.pauseControl = control
    this.pauseUnsubscribe = control.subscribe((paused, reason) => this.applyPause(paused, reason))
    if (control.paused) this.applyPause(true, control.reason)
  }
  private requestPause(): void {
    if (!this.started || this.menuVisible || this.inviteOpen) return
    this.releaseCursor()
    if (this.pauseControl) this.pauseControl.pause('user'); else this.applyPause(true, 'user')
  }
  private requestResume(): void {
    if (!this.userPaused) return
    if (this.pauseControl) this.pauseControl.resume('user'); else this.applyPause(false, null)
    // The click, tap or key that resumes is a gesture: go straight back to driving.
    if (this.capturesCursor) void this.captureCursor(); else { this.touchPanels = false; this.syncPanels() }
  }
  private applyPause(paused: boolean, reason: 'user' | 'hidden' | null): void {
    if (paused) this.audio.pause(0.5); else this.audio.resume(0.3)
    const user = paused && reason === 'user'
    if (user === this.userPaused) return
    this.userPaused = user
    const veil = this.element.querySelector<HTMLButtonElement>('.pause-veil')!
    veil.hidden = !user; this.element.classList.toggle('is-paused', user)
    this.game.input.suspended = user || this.menuVisible || this.inviteOpen
    if (user) {
      this.game.input.mouseFire = false
      veil.querySelector('.pause-how')!.textContent = this.touch.available ? 'Tap to resume' : 'Click to resume'
      veil.querySelector('small')!.hidden = this.playerCount < 2
      veil.focus({ preventScroll: true })
    }
    this.syncPanels()
  }
  private keydown(event: KeyboardEvent): void {
    const editing = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY)$/.test(event.target.tagName))
    if (!editing && !event.repeat && event.code === 'KeyP') { event.preventDefault(); event.stopImmediatePropagation(); this.setPresentation(!this.presentation); return }
    if (!editing && !event.repeat && event.code === 'KeyJ') { event.preventDefault(); event.stopImmediatePropagation(); this.inviteOpen ? this.closeJoin() : this.openJoin(); return }
    if (this.inviteOpen) {
      if (event.code === 'Escape') { event.preventDefault(); this.closeJoin() }
      if (event.key === 'Tab') { event.preventDefault(); const buttons = [...this.invite.element.querySelectorAll<HTMLButtonElement>('button')]; buttons[document.activeElement === buttons[0] ? 1 : 0].focus() }
      return
    }
    if (!editing && this.started && !this.menuVisible && !event.repeat && (event.code === 'KeyH' || event.key === '?')) { event.preventDefault(); this.toggleHelp(); return }
    // A drive key outside any field means the player wants to drive: resume if paused, and
    // capture the cursor (a key press is a gesture). This is also the keyboard-only way back.
    // While paused, focus rests on the pause message, which is a button, so a drive key
    // counts wherever focus is: it resumes. That press does not also drive.
    if (this.userPaused && !event.repeat && DRIVE_KEYS.has(event.code)) { event.preventDefault(); this.requestResume(); return }
    if (!editing && !event.repeat && this.started && !this.menuVisible && DRIVE_KEYS.has(event.code) && this.capturesCursor && document.pointerLockElement !== this.game.canvas) void this.captureCursor()
    if (event.code === 'Escape') {
      if (event.target instanceof HTMLSelectElement) return
      // Escape in a text field only leaves the field; it takes another to pause.
      const target = event.target
      if (this.started && !this.menuVisible && !this.userPaused && target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && !/^(range|checkbox|radio|button|color)$/.test(target.type)))) { target.blur(); return }
      event.preventDefault(); event.stopImmediatePropagation()
      // Escape with the cursor captured frees it, which shows the panels. Escape again pauses.
      // Escape while paused resumes. There is no panel-closing step in between.
      if (this.userPaused) { this.requestResume(); return }
      if (document.pointerLockElement === this.game.canvas) { this.releaseCursor(); return }
      if (this.menuVisible && this.panels.active !== 'index') this.showPanel('index')
      else if (this.started) {
        if (this.menuVisible) this.closeMenu()
        else this.requestPause()
      }
    } else if (this.menuVisible && event.key === 'Tab') {
      const targets = [...this.overlay.querySelectorAll<HTMLElement>('button, input, select, summary, a[href], [tabindex="0"]')].filter(el => !el.closest('[hidden], [inert]') && !(el as HTMLInputElement).disabled)
      const first = targets[0], last = targets[targets.length - 1]
      if (event.shiftKey && (document.activeElement === first || !targets.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !targets.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first?.focus() }
    }
  }
  private toast(text: string): void {
    const element = this.element.querySelector<HTMLElement>('.shell-toast')!
    element.textContent = text; element.hidden = false; clearTimeout(this.toastTimer)
    this.element.querySelector('.shell-message')!.textContent = text
    this.toastTimer = setTimeout(() => { element.hidden = true; this.element.querySelector('.shell-message')!.textContent = '' }, 4500)
  }
  private async copyInvite(): Promise<void> {
    const url = new URL(inviteUrl(location.origin, this.room, encodeWorld()))
    try { await navigator.clipboard.writeText(url.href); this.toast('Invite link copied.'); this.invite.element.querySelector('.join-copy')!.textContent = 'Copied' }
    catch { this.element.querySelector('.shell-message')!.textContent = `Invite link: ${url.href}` }
  }
  /**
   * The 2017 lobby hung in 3D and leaned toward the cursor. Here the pointer sets two CSS
   * variables that tilt the stage a degree or two and slides the star depths against each
   * other. Mouse only, and not at all for people who ask for reduced motion.
   */
  private followPointer(signal: AbortSignal): void {
    const stage = this.element.querySelector<HTMLElement>('.lobby-stage')!
    let frame = 0, x = 0, y = 0
    this.overlay.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
      x = event.clientX / innerWidth * 2 - 1; y = event.clientY / innerHeight * 2 - 1
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        stage.style.setProperty('--tilt-y', `${(x * 1.6).toFixed(2)}deg`); stage.style.setProperty('--tilt-x', `${(-y * 1.2).toFixed(2)}deg`)
      })
    }, { signal, passive: true })
  }
  /**
   * Choosing a planet. A different kind becomes the world for everyone in the room, with a
   * fresh seed, through the shared sliders; the kind already in play is left as it is. From
   * the index either choice leads on to the name and room form.
   */
  private pickPlanet(id: string, thenExplore: boolean): void {
    if (id !== currentPlanet().id) {
      if (!canEditWorld()) { this.say('The host has locked this world.'); return }
      applyPlanet(id)
    }
    if (thenExplore) this.showPanel('explore')
  }
  /** True after Custom is first opened; later world edits keep its preview current. */
  private shapingCustom = false
  private suspendCustomRefresh = false
  private customMapTimer?: ReturnType<typeof setTimeout>
  private refreshCustomPlanet(): void {
    if (!this.shapingCustom || this.suspendCustomRefresh) return
    clearTimeout(this.customMapTimer)
    this.customMapTimer = setTimeout(() => this.galaxy?.updateCustom(currentPlanet().id, worldSeed.value, params.snapshot('world')), 120)
  }
  /** Terraform mode: only the sliders that shape a world, opened. */
  private openCustomPlanet(): void {
    this.suspendCustomRefresh = false
    this.shapingCustom = true
    this.refreshCustomPlanet()
    this.advancedGroups = ['Terrain', 'World', 'Sky', 'Sun', 'Weather', 'Lava']
    this.showPanel('advanced')
  }
  /** A short notice that shows in the lobby and, while playing, as a toast. */
  private say(text: string): void { this.toast(text) }
  /**
   * The galaxy lobby: in place of the index panel, the worlds orbit a
   * sun in 3D. Drag to look around, tap a world to fly to it, and the name form follows. The
   * other panels open over it as before. Needs WebGL 2. At the lowest graphics level the system
   * is held still and redrawn only while it moves, so weak devices keep it at almost no cost.
   */
  private readonly savedWorlds = new SavedWorldStore(() => params.all().map(p => p.def))
  private savedMoons?: SavedMoons
  private savedList?: HTMLElement
  private saveWorld(): void {
    try {
      const result = this.savedWorlds.save(params.snapshot('world'))
      this.refreshSavedWorlds()
      this.inspector.setStatus(result.duplicate ? 'This world is already saved on this device.' : 'World saved on this device.')
    } catch (error) { this.inspector.setStatus(`World was not saved. ${error instanceof Error ? error.message : 'Storage is unavailable.'}`) }
  }
  private mountSavedWorlds(): void {
    const section = document.createElement('section'); section.className = 'saved-worlds'
    const title = document.createElement('h3'); title.textContent = 'Saved on this device'
    this.savedList = document.createElement('div'); this.savedList.setAttribute('aria-label', 'Saved worlds')
    section.append(title, this.savedList)
    this.element.querySelector('[data-panel="worlds"]')!.append(section)
    this.savedMoons = new SavedMoons(this.element.querySelector('.galaxy-ui')!, entry => { void this.enterSavedWorld(entry) })
    this.refreshSavedWorlds()
  }
  private refreshSavedWorlds(): void {
    if (!this.savedList) return
    this.savedList.replaceChildren()
    try {
      const library = this.savedWorlds.read()
      this.savedMoons?.set(library.entries)
      if (!library.entries.length || library.notice) {
        const note = document.createElement('p'); note.textContent = library.notice ?? 'Use Save current world in the World card.'
        this.savedList.append(note)
      }
      for (const entry of library.entries) {
        const row = document.createElement('div'); row.className = 'input-action'
        const enter = document.createElement('button'); enter.type = 'button'; enter.dataset.savedWorld = entry.id
        enter.textContent = `${planetName(entry.seed)} · ${entry.recipeId}`
        enter.addEventListener('click', () => { void this.enterSavedWorld(entry) })
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete'
        remove.setAttribute('aria-label', `Delete saved ${planetName(entry.seed)}`)
        remove.addEventListener('click', () => {
          try { this.savedWorlds.remove(entry.id); this.refreshSavedWorlds(); this.say('Saved world deleted from this device.') }
          catch { this.say('The saved world could not be deleted. Storage is unavailable.') }
        })
        row.append(enter, remove); this.savedList.append(row)
      }
    } catch {
      this.savedMoons?.set([])
      this.savedList.textContent = 'Saved worlds could not be read. Existing storage has been left unchanged.'
    }
    if (this.galaxy && !this.dropping && !this.savedEntering) this.galaxy.home()
  }
  private savedEntering = false
  private async enterSavedWorld(entry: SavedWorld): Promise<void> {
    if (this.dropping || this.savedEntering) return
    this.savedEntering = true
    this.savedOutcomeStop?.()
    let applied = false, release: (() => void) | undefined
    try {
      // Read again: another tab may have deleted or changed the record after rendering it.
      const latest = this.savedWorlds.read().entries.find(saved => saved.id === entry.id)
      if (!latest) { this.say('That saved world is no longer available.'); this.refreshSavedWorlds(); return }
      const plan = savedWorldPlan(latest, params.all().map(p => p.def))
      const allowed = () => worldIdentity(plan) === worldIdentity(params.snapshot('world')) || (canEditWorld() && !(this.invited && !this.started))
      if (!allowed()) { this.say('This room controls its world settings. The saved world was not applied.'); return }
      this.stopAttract()
      this.suspendCustomRefresh = true; clearTimeout(this.customMapTimer)
      const apply = () => {
        if (!allowed()) throw new Error('The room no longer allows changing this world.')
        params.applySnapshot(plan, 'local'); applied = true
        if (!this.started) { this.begin(); this.onPlay?.() }
      }
      if (!this.galaxy?.live || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        apply(); this.closeMenu()
      } else {
        if (!this.started) this.unlockAudio()
        release = this.galaxy.savedWorldTarget(latest.recipeId, latest.seed, plan, latest.id)
        await this.panels.show('index', true); this.galaxyFor('index')
        await this.descent(latest.recipeId, apply)
      }
      if (applied) this.reportSavedOutcome(plan)
    } catch (error) { this.say(`Saved world was not entered. ${error instanceof Error ? error.message : 'Please try again.'}`) }
    finally { release?.(); this.savedEntering = false }
  }
  /** A room welcome can replace a local plan. Never claim a restore until authority settles. */
  private savedOutcomeStop?: () => void
  private reportSavedOutcome(plan: Record<string, import('../../shared/params').ParamValue>): void {
    const report = () => {
      const net = (window as { syn3hNet?: { connected?: boolean } }).syn3hNet
      if (!net?.connected) return false
      this.say(worldIdentity(params.snapshot('world')) === worldIdentity(plan)
        ? 'Saved world settings applied.' : 'The current room’s settings replaced the saved world settings.')
      return true
    }
    if (report()) return
    this.say('Saved settings applied locally. Waiting for the room’s settings.')
    const stop = () => { clearInterval(timer); this.abort.signal.removeEventListener('abort', stop); this.savedOutcomeStop = undefined }
    const timer = setInterval(() => { if (report()) stop() }, 500)
    this.savedOutcomeStop = stop
    this.abort.signal.addEventListener('abort', stop, { once: true })
  }
  private startGalaxy(): void {
    // No WebGL 2: the game cannot draw here either, so the index says so plainly.
    if (!Galaxy.supported()) { this.element.querySelector<HTMLElement>('.lobby-unsupported')!.hidden = false; return }
    const current = currentPlanet().id, labels = this.element.querySelector<HTMLElement>('.galaxy-labels')!
    // Every planet recipe, up to the galaxy's limit with room for Custom. In development,
    // ?worlds=N repeats the recipes to rehearse a crowded system before new ones land.
    const rehearse = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('worlds')) || 0 : 0
    const recipes = Array.from({ length: Math.max(PLANETS.length, rehearse - 1) }, (_, i) => ({ recipe: PLANETS[i % PLANETS.length], copy: Math.floor(i / PLANETS.length) })).slice(0, GALAXY_MAX - 1)
    const worlds: GalaxyWorld[] = recipes.map(({ recipe, copy }, i) => ({ id: copy ? `${recipe.id}~${copy}` : recipe.id, recipe: recipe.id, label: copy ? `${recipe.label} ${copy + 1}` : recipe.label, land: recipe.swatch[0], sea: recipe.swatch[1], glow: recipe.values['world.seaKind'] === 0, seed: recipe.id === current && !copy ? worldSeed.value : i + 1 }))
    // The custom planet is a world still forming: tap it to shape it with the sliders.
    worlds.push({ id: 'custom', label: 'Custom', land: 0x31507a, sea: 0x0a1630, glow: false, seed: 7, forming: true })
    const chips = this.galaxyChips
    for (const world of worlds) {
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'galaxy-label'; chip.dataset.world = world.id
      chip.innerHTML = '<strong></strong><small></small>'; chip.querySelector('strong')!.textContent = world.label
      chip.querySelector('small')!.textContent = world.forming ? 'Shape your own' : world.id === current ? planetName(world.seed) : ''
      if (world.id !== 'custom') { const count = document.createElement('small'); count.className = 'galaxy-population'; count.textContent = 'Population unknown'; chip.append(count) }
      chip.addEventListener('click', () => { if (!this.tapWorld(world.id)) this.galaxy?.choose(world.id) })
      labels.append(chip); chips.set(world.id, chip)
    }
    this.galaxy = new Galaxy(this.overlay, {
      worlds,
      logo: () => {
        const mark = this.element.querySelector<SVGElement>('.shell-logo')!, box = mark.getBoundingClientRect(), host = this.overlay.getBoundingClientRect()
        return { box: { x: box.x - host.x, y: box.y - host.y, width: box.width, height: box.height }, level: levelNumber(graphicsLevel.value) }
      },
      presenceVisible: () => this.menuVisible && !this.attracting && !this.inviteOpen && !this.dropping,
      onPresence: values => {
        for (const world of worlds) {
          if (world.id === 'custom') continue
          const chip = chips.get(world.id)!, text = populationLabel(values.get(world.recipe ?? world.id) ?? null)
          const count = chip.querySelector('.galaxy-population')!
          if (count.textContent !== text) { count.textContent = text; this.labelSizes.delete(world.id) }
          chip.title = `${text}. Counts span separate rooms; choosing this planet uses your current room.`
          chip.setAttribute('aria-label', `${world.label}: ${chip.title}`)
        }
      },
      onLogo: drawn => this.element.classList.toggle('has-animated-logo', drawn),
      still: () => levelNumber(graphicsLevel.value) === 0,
      onTap: chosen => this.tapWorld(chosen),
      onFocus: id => chips.get(id)?.focus({ preventScroll: true }),
      onArrive: chosen => {
        const id = chosen.split('~')[0]
        if (id === 'custom') {
          if (!canEditWorld() || (this.invited && !this.started)) { this.say('This world is not yours to reshape yet.'); this.galaxy?.home(); return }
          this.openCustomPlanet(); return
        }
        if (this.invited && !this.started && id !== currentPlanet().id) { this.say('You were invited to another world. You can change it once you are in, if the host allows.'); this.galaxy?.home(); return }
        if (!canEditWorld() && id !== currentPlanet().id) { this.say('The host has locked this world.'); this.galaxy?.home(); return }
        this.pickPlanet(id, true)
      },
      onLayout: (places, chosen) => {
        this.savedMoons?.layout(places, { width: innerWidth, top: this.brandBottom ?? 220, bottom: this.linksTop ?? innerHeight - 128 }, !!chosen || this.dropping || this.panels.active !== 'index')
        // Each label near its world, on the screen, clear of the links and of each other.
        for (const [id, chip] of chips) if (!this.labelSizes.has(id) && !chip.hidden) this.labelSizes.set(id, { width: chip.offsetWidth, height: chip.offsetHeight })
        // Clear of the wordmark too. While flying to a world, only its label stays.
        if (!this.brandBottom) {
          this.brandBottom = this.element.querySelector('.lobby-brand')?.getBoundingClientRect().bottom ?? 0
          const hint = this.element.querySelector('.galaxy-hint')?.getBoundingClientRect().top ?? 0
          this.linksTop = hint > innerHeight / 2 ? hint - 4 : innerHeight - 128
        }
        const shown = chosen ? places.filter(place => place.id === chosen) : places
        const spots = placeLabels(shown, this.labelSizes, { width: innerWidth, height: innerHeight, bottom: this.linksTop, top: this.brandBottom + 4 }, { first: chosen ?? currentPlanet().id, previous: this.labelSpots })
        if (chosen) for (const place of places) if (place.id !== chosen) chips.get(place.id)!.classList.add('is-crowded')
        for (const place of places) chips.get(place.id)!.hidden = !place.visible
        for (const spot of spots) {
          const chip = chips.get(spot.id)!; this.labelSpots.set(spot.id, spot.spot)
          chip.style.translate = `${spot.x.toFixed(1)}px ${spot.y.toFixed(1)}px`; chip.classList.toggle('is-crowded', spot.crowded)
        }
      },
    })
    addEventListener('resize', () => { this.brandBottom = undefined }, { signal: this.abort.signal })
    this.element.classList.add('is-galaxy'); this.galaxy.enabled = true
    // WebGL 2 exists but the galaxy would not start (a shader the driver refuses): the world
    // names stay, as a row of buttons, so a visitor can still choose one and play.
    this.element.classList.toggle('galaxy-flat', !this.galaxy.live)
    this.galaxyFor(this.panels.active || 'index')
  }
  /** The galaxy's world labels, by world id, with their measured sizes and last spots. */
  private readonly galaxyChips = new Map<string, HTMLButtonElement>()
  private readonly labelSizes = new Map<string, { width: number; height: number }>()
  private readonly labelSpots = new Map<string, number>()
  /** Where the wordmark ends, measured once per window size. */
  private brandBottom?: number
  private linksTop = 0
  /** Labels follow the world in play: its generated name, and which worlds can be chosen now. */
  private refreshGalaxyLabels(open: boolean): void {
    const current = currentPlanet().id
    for (const [id, chip] of this.galaxyChips) {
      const small = chip.querySelector('small')!, text = id === 'custom' ? small.textContent : id === current ? planetName(worldSeed.value) : ''
      if (small.textContent !== text) { small.textContent = text; this.labelSizes.delete(id) }
      chip.classList.toggle('is-current', id === current)
      chip.classList.toggle('is-locked', !open && id !== current)
    }
  }
  /** The galaxy is the index; any other panel opens over it. */
  private galaxyFor(panel: string): void {
    if (!this.galaxy) return
    const open = panel === 'index', editing = panel === 'advanced' && this.shapingCustom && this.advancedGroups !== undefined
    this.element.classList.toggle('is-shaping-world', editing)
    this.galaxy.editing = editing
    this.element.classList.toggle('galaxy-open', open)
    this.element.querySelector<HTMLElement>('.galaxy-ui')!.hidden = !open
    if (open) this.galaxy.home()
    // Behind a panel the galaxy dims and holds still; behind the name form a little less,
    // since the world just chosen is the picture there.
    this.galaxy.backdrop = open ? 1 : editing ? 0.85 : panel === 'explore' ? 0.7 : 0.35
  }
  /** What the lobby's own graphics are doing, for the phone checks. */
  get graphics(): { galaxyLive: boolean; galaxyFrames: number; planetMaps: number } {
    return { galaxyLive: this.galaxy?.live ?? false, galaxyFrames: this.galaxy?.frames ?? 0, planetMaps: this.galaxy?.painted ?? 0 }
  }
  /**
   * Every button is terranlabs.com's glass button (.liquid-glass in shell.css), except the
   * quiet text links. This also carries that site's GlassShine: while the pointer is over a
   * glass button, the bright side of its one-pixel rim turns to face the pointer, and settles
   * back when the pointer leaves. Nothing is drawn on the face of the button.
   */
  private glass(signal: AbortSignal): void {
    const buttons = [...this.element.querySelectorAll<HTMLElement>('button'), ...this.touch.element.querySelectorAll<HTMLElement>('button')]
    for (const button of buttons) if (!button.matches('.link-button, .lobby-links *, .syn3h-advanced *, .world-inspector *')) button.classList.add('liquid-glass')
    // Touch screens have no hover, so there is nothing to face.
    if (!matchMedia('(hover: hover)').matches) return
    const REST = 205
    let current: HTMLElement | null = null
    // Kept unwrapped (it may pass 360) so the CSS transition always takes the short way round.
    let angle = REST
    document.addEventListener('pointermove', event => {
      const target = event.target instanceof Element ? event.target : null
      const button = target?.closest<HTMLElement>('.liquid-glass') ?? null
      if (button !== current) { current?.style.removeProperty('--rim-angle'); current = button; angle = REST }
      if (!button) return
      const box = button.getBoundingClientRect()
      const dx = event.clientX - (box.left + box.width / 2), dy = event.clientY - (box.top + box.height / 2)
      // CSS conic angles start at the top and run clockwise.
      const facing = (Math.atan2(dx, -dy) * 180) / Math.PI
      angle += ((((facing - angle) % 360) + 540) % 360) - 180
      button.style.setProperty('--rim-angle', `${angle.toFixed(1)}deg`)
    }, { signal, passive: true })
  }
  /** Desktop with a mouse only: phones and tablets have their thumb controls. */
  private get capturesCursor(): boolean { return !this.touch.available && typeof this.game.canvas.requestPointerLock === 'function' }
  private cursorRequest = 0
  private cursorPending = false
  private async captureCursor(entering = false): Promise<void> {
    if (this.cursorPending) return
    this.cursorPending = true
    const requestId = ++this.cursorRequest
    // While entering a world the menu is still up and the descent is running: started is enough.
    const active = () => requestId === this.cursorRequest && !this.abort.signal.aborted && this.started && (entering ? !this.userPaused : !this.menuVisible && !this.game.input.suspended)
    try {
      try {
        await (this.game.canvas.requestPointerLock as (options?: { unadjustedMovement?: boolean }) => Promise<void> | void).call(this.game.canvas, { unadjustedMovement: true })
      } catch {
        // Some browsers reject raw motion. A denied fallback must not reject unhandled.
        if (active()) await this.game.canvas.requestPointerLock()
      }
    } catch { /* A denied capture leaves the native cursor available. */ }
    finally {
      this.cursorPending = false
      if (!active() && document.pointerLockElement === this.game.canvas) document.exitPointerLock()
    }
  }
  private releaseCursor(): void {
    ++this.cursorRequest
    this.game.input.mouseFire = false
    if (document.pointerLockElement === this.game.canvas) document.exitPointerLock()
  }
  private updateHelp(): void {
    this.element.querySelector('.shell-touch-hint')!.textContent = touchHelp(this.choice.vehicleKind)
    renderHelp(this.element.querySelector('.shell-controls')!, this.choice.vehicleKind)
  }
  /** Call after an actual spawn so query overrides and future respawns show the right controls. */
  private muteShown: boolean | undefined
  private gearSelect?: HTMLSelectElement
  private gearWired = false
  private gearShown = ''
  /**
   * The rail selector shows the available gear and the current choice.
   * Tapping it (or T) moves to the next. The rack and the Bungee are the Weapons lane's.
   */
  private updateGear(): void {
    const net = (window as unknown as { syn3hNet?: { gear?: GearRack; bungee?: { attached: boolean; letGo(): void } } }).syn3hNet
    const select = this.gearSelect ??= this.element.querySelector<HTMLSelectElement>('.gear-select')!
    if (!net?.gear) { if (!select.disabled) select.disabled = true; return }
    if (!this.gearWired && net.bungee) {
      this.gearWired = true
      this.touch.setGear({ attached: () => net.bungee!.attached, letGo: () => net.bungee!.letGo() })
    }
    const list = net.gear.list(), signature = list.join(',')
    if (signature !== this.gearShown) {
      this.gearShown = signature; select.replaceChildren()
      for (const id of list) { const option = document.createElement('option'); option.value = id; option.textContent = GEAR_LABELS[id]; select.append(option) }
    }
    if (select.value !== net.gear.current && document.activeElement !== select) select.value = net.gear.current
    this.hasSeveralGear = list.length > 1; if (select.disabled === this.hasSeveralGear) select.disabled = !this.hasSeveralGear
  }
  private updateGI(): void {
    const value = Number(params.get('post.gi')?.value ?? 0)
    const on = Boolean(params.get('post.on')?.value), tablets = Boolean(params.get('post.tablets')?.value)
    const budget = Math.min(1, Math.max(0, this.game.quality.postBudget))
    const tier = postTier({ on, level: graphicsLevel.value, deviceLevel: this.game.quality.deviceLevel, tablets, shed: 1 - budget })
    let status: string
    if (!on) status = 'GI inactive: post effects are off. Enable Post effects in You > Post.'
    else if (this.game.quality.deviceLevel < 2 && !tablets) status = 'GI inactive: post effects are disabled for this device.'
    else if (graphicsLevel.value < 2) status = 'GI inactive: requires Desktop render tier. Change Graphics in You or Performance.'
    else if (tier !== 'full') status = 'GI temporarily inactive: automatic quality has reduced the post-effects budget.'
    else if (value === 0) status = 'GI is off. Raise this strength to enable indirect light from visible surfaces.'
    else status = budget < .99 ? 'GI active at reduced strength while automatic quality adjusts.' : 'GI active: indirect light from visible surfaces.'
    this.inspector.setGIStatus(status, tier === 'full')
  }
  private hasSeveralGear = false
  setVehicleKind(kind: VehicleKind): void { this.activeVehicleKind = kind; this.touch.setVehicleKind(kind); if (this.started) this.showHelp(false) }
  /**
   * The controls card, in the lower left so it never covers the vehicle. After Play it is the
   * short version: it leaves after five seconds or on the first key, click or touch, but stays
   * at least a second and a half so an eager driver still gets to read it. H or ? opens the
   * full list, which stays for its whole time because the player asked for it.
   */
  showHelp(full = true): void {
    const hint = this.element.querySelector<HTMLElement>('.spawn-help')!, touch = this.touch.available
    renderHelp(hint.querySelector('div')!, this.activeVehicleKind, touch, !full, this.hasSeveralGear)
    hint.classList.toggle('is-full', full); hint.classList.remove('is-hint'); this.touch.highlight(null)
    hint.querySelector('small')!.textContent = touch ? '' : full ? 'H or ? to hide' : 'H: all controls'
    hint.hidden = false; clearTimeout(this.helpTimer); this.helpInput?.abort(); this.helpInput = undefined
    const hide = () => this.hideHelp()
    this.helpTimer = setTimeout(hide, full ? 8500 : 5000)
    if (full) return
    const shown = performance.now(), input = this.helpInput = new AbortController()
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent && (event.repeat || event.code === 'KeyH' || event.key === '?')) return
      input.abort(); clearTimeout(this.helpTimer)
      this.helpTimer = setTimeout(hide, Math.max(0, 1500 - (performance.now() - shown)))
    }
    for (const type of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(type, dismiss, { capture: true, passive: true, signal: input.signal })
  }
  private hideHelp(): void {
    clearTimeout(this.helpTimer); this.helpInput?.abort(); this.helpInput = undefined
    this.touch.highlight(null)
    this.element.querySelector<HTMLElement>('.spawn-help')!.hidden = true
  }
  /**
   * One line in the controls card for a player who seems stuck, for example pushing W on a
   * parked jet. On touch the button it names pulses. Stays out of the way of the full list.
   */
  showHint(hint: Hint): void {
    const card = this.element.querySelector<HTMLElement>('.spawn-help')!
    if (!this.started || this.menuVisible || (!card.hidden && card.classList.contains('is-full'))) return
    const line = document.createElement('div'); line.textContent = hint.text
    card.querySelector('div')!.replaceChildren(line); card.querySelector('small')!.textContent = ''
    card.classList.remove('is-full'); card.classList.add('is-hint'); card.hidden = false
    this.touch.highlight(hint.touchAction ?? null)
    clearTimeout(this.helpTimer); this.helpInput?.abort(); this.helpInput = undefined
    this.helpTimer = setTimeout(() => this.hideHelp(), 5000)
  }
  private toggleHelp(): void {
    const hint = this.element.querySelector<HTMLElement>('.spawn-help')!
    if (!hint.hidden && hint.classList.contains('is-full')) this.hideHelp(); else this.showHelp()
  }
  setStatus(lines: readonly string[]): void { this.board.setStatus(lines); this.hudBoard.setStatus(lines); const players = (window as unknown as {syn3hNet?:{players?:Map<number,{bot?:boolean}>}}).syn3hNet?.players; const count = players ? [...players.values()].filter(player => !player.bot).length : lines.filter(line => parseScoreRow(line)).length
    // The status arrives every frame; the invite only depends on it through the player count.
    if (count !== this.playerCount) { this.playerCount = count; this.updateInvite() } }
  setSpeed(metresPerSecond: number): void { this.speed.textContent = String(Math.round(Math.abs(metresPerSecond) * 2.23694)) }
  update(dt = 0): void {
    if (this.attract && !this.attract.ready) {
      const debug = (window as unknown as { syn3h?: { camera?: CinematicCamera; bots?: { vehicles: readonly Vehicle[] } } }).syn3h
      if (debug?.camera?.setCinematicPose) this.setAttractCamera(debug.camera, () => debug.bots?.vehicles ?? [])
    }
    if (!this.started && !this.inviteOpen && !this.attract?.active && (this.requestedAttract || performance.now() - this.lastActivity > 20000)) this.startAttract()
    this.attract?.update(dt)
    this.touch.update(); if (!this.menuVisible) this.minimap?.update()
    // A captured cursor alone is insufficient while a menu or another flow suspends input.
    this.syncPanels()
    this.performancePanel.setContext(this.started && !this.menuVisible && !this.game.input.suspended, this.element.classList.contains('is-focus'))
    this.raceHud.update(this.started && !this.menuVisible && !this.game.input.suspended, this.element.classList.contains('is-focus'), this.self, this.ground?.size)
    this.element.classList.toggle('show-diagnostics', diagnostics.value)
    this.element.querySelector<HTMLInputElement>('.rail-diagnostics input')!.checked = diagnostics.value
    // Per-frame: touch the DOM only when the label changes.
    if (this.audio.isMuted !== this.muteShown) { this.muteShown = this.audio.isMuted; this.element.querySelector('.rail-mute')!.textContent = this.muteShown ? 'Unmute' : 'Mute' }
    this.updateGear()
    if (this.inspector.open) this.updateGI()
    if (this.started && !this.menuVisible) {
      const focus = this.element.classList.contains('is-focus')
      if (!focus && this.inspector.open) this.inspector.update()
      this.focusHud.update(true, { speed: this.telemetry.speed, altitude: this.telemetry.altitude, heading: this.self?.heading ?? 0, world: `${currentPlanet().label} · ${planetName(worldSeed.value)}`, hour: Number(params.get('sun.timeOfDay')?.value ?? 0) })
      const glass = String(Math.round(glassStyle.value)); if (this.element.dataset.glass !== glass) this.element.dataset.glass = glass
    }
    // The stylesheet drops frost at the lowest graphics level.
    // Frost goes at the lowest graphics level, and when the quality ladder is shedding post effects.
    const gfx = qualityLevel() >= 2 ? '0' : String(levelNumber(graphicsLevel.value))
    if (document.documentElement.dataset.gfx !== gfx) document.documentElement.dataset.gfx = gfx
    if (!this.menuVisible) return
    const mute = this.element.querySelector<HTMLButtonElement>('.shell-mute')!
    mute.textContent = this.audio.isMuted ? 'Unmute audio' : 'Mute all audio'; mute.setAttribute('aria-pressed', String(this.audio.isMuted))
    for(const slider of this.element.querySelectorAll<HTMLInputElement>('[data-audio-param]'))if(document.activeElement!==slider)slider.value=String(params.get(slider.dataset.audioParam!)?.value??0)
    const volume = this.element.querySelector<HTMLInputElement>('#music-volume')!; volume.value = String(musicVolume.value)
    this.element.querySelector('#music-volume-value')!.textContent = `${Math.round(musicVolume.value * 100)}%`
    const seed = this.element.querySelector<HTMLInputElement>('#world-seed')!
    if (document.activeElement !== seed && seed.dataset.dirty !== 'true') seed.value = String(worldSeed.value)
    const time = Number(params.get('sun.timeOfDay')?.value ?? 16.5)
    this.element.querySelector<HTMLInputElement>('#sky-time')!.value = String(time)
    this.element.querySelector('#sky-time-value')!.textContent = `${String(Math.floor(time) % 24).padStart(2, '0')}:${String(Math.floor((time % 1) * 60)).padStart(2, '0')}`
    const editable = canEditWorld(), net = hostControls()
    const planet = currentPlanet()
    // A guest who came by an invite link is shown that world and no other until they are in
    // the room, where the host's lock decides.
    const invitedOnly = this.invited && !this.started
    if (this.worldDirty) {
      this.worldDirty = false
      this.element.querySelector('.planet-current')!.textContent = `${planet.label} world ${planetName(worldSeed.value)}. ${planet.centre}.${invitedOnly ? ' You were invited to this world.' : ''}`
      this.updateInvite()
    }
    this.refreshGalaxyLabels(editable && !invitedOnly)
    for (const input of this.element.querySelectorAll<HTMLInputElement | HTMLButtonElement>('.world-controls input, .world-controls button')) input.disabled = !editable || invitedOnly
    for (const note of this.element.querySelectorAll<HTMLElement>('.world-lock-note')) note.hidden = editable
    this.paramPanel?.setWorldEditable(editable)
    this.element.querySelector<HTMLButtonElement>('.world-reset')!.disabled = !editable
    const lock = this.element.querySelector<HTMLInputElement>('#host-lock')!; lock.checked = net?.locked ?? false
    this.element.querySelector<HTMLElement>('.host-lock')!.hidden = !net?.isHost
    this.element.querySelector('.host-note')!.textContent = !net ? 'Join a room to manage shared settings.' : !editable ? 'Sliders locked by host.' : net.isHost ? 'You are the host.' : 'Shared sliders are open.'
    const mode = params.get('game.mode'), modeSelect = this.element.querySelector<HTMLSelectElement>('#game-mode')!
    this.element.querySelector<HTMLElement>('.mode-control')!.hidden = !mode
    modeSelect.disabled = !editable; if (mode) modeSelect.value = String(mode.value)
    const bots = params.get('bots.count'), botsRow = this.element.querySelector<HTMLElement>('.bots-control')!
    botsRow.hidden = !bots
    if (bots) { const input = this.element.querySelector<HTMLInputElement>('#bots-count')!; input.min = String(bots.def.min ?? 0); input.max = String(bots.def.max ?? 16); input.value = String(bots.value); botsRow.querySelector('output')!.textContent = String(bots.value) }
  }
  dispose(): void {
    this.abort.abort(); this.releaseCursor(); this.pauseUnsubscribe?.(); this.performancePanel.dispose(); clearTimeout(this.customMapTimer); clearTimeout(this.toastTimer); clearTimeout(this.helpTimer); this.helpInput?.abort(); this.inspector.dispose(); this.focusHud.dispose(); this.raceHud.dispose(); this.savedMoons?.dispose(); this.galaxy?.dispose();  this.attract?.dispose(); this.matchHud.dispose(); this.invite.dispose(); this.minimap?.dispose(); this.panels.dispose(); this.touch.dispose(); this.element.remove()
    document.body.classList.remove('has-game-shell'); this.game.input.suspended = this.previousSuspended; this.game.input.mouseFire = false
  }
}

/** Call after creating the player, before constructing ParamPanel. */
export function initGameShell(game: Game, player: Vehicle, terrain: Terrain): { shell: Shell; audio: GameAudio; setPlayer: (player: Vehicle) => void; dispose: () => void } {
  const audio = new GameAudio(game.camera), shell = game.add(new Shell(game, audio))
  shell.setVehicleKind(player.kind); shell.setTerrain(terrain); audio.setPlayer(player,terrain)
  let activePlayer = player
  const hints = new PlayHints(), height = new HeightAboveGround()
  const bridge = game.add({ update(dt = 0) {
    const v = activePlayer.body.linvel(), p = activePlayer.body.translation(), speed = Math.hypot(v.x, v.y, v.z)
    shell.setSpeed(speed)
    const q = activePlayer.body.rotation()
    const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y))
    shell.setMapSelf({ x: p.x, z: p.z, heading, color: activePlayer.colors.body, self: true })
    // Shown as metres above ground: measured from the contact surfaces, 0 when resting.
    shell.setTelemetry(speed, height.read(activePlayer, p.y, terrain.heightAt(p.x, p.z)))
    audio.motion = { speed, throttle: activePlayer.kind === 'jet' ? activePlayer.input.z : activePlayer.input.y, airborne: p.y - terrain.heightAt(p.x, p.z) > 2 }
    const input = activePlayer.input
    const hint = hints.update(dt, { kind: activePlayer.kind, touch: shell.touch.available, altitude: p.y - terrain.heightAt(p.x, p.z), speed, steer: input.x, pitch: input.y, throttle: input.z, hoverMode: !input.special, canLiftOut: activePlayer.canLiftOut })
    if (hint) shell.showHint(hint)
  } })
  game.add(audio)
  return { shell, audio, setPlayer(next) { activePlayer = next; hints.reset(); audio.setPlayer(next,terrain); shell.setVehicleKind(next.kind) }, dispose() { game.remove(bridge); game.remove(shell); game.remove(audio) } }
}
