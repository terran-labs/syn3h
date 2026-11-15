import type { Game, System } from '../core/Game'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Terrain } from '../world/Terrain'
import { params, worldSeed } from '../../shared/params'
import { GameAudio, MUSIC_TRACKS, type MusicTrack } from '../audio'
import { masterVolume, effectsVolume, engineVolume, windVolume, dirtVolume, worldVolume, cuesVolume, remoteVolume, musicVolume } from '../audio/params'
import { applySkyPreset, SKY_PRESET_NAMES, type SkyPresetName } from '../world/sky/presets'
import { TouchControls } from './TouchControls'
import { readVehicleChoice, saveVehicleChoice, VehiclePreview, type VehicleChoice } from './VehicleChoice'
import { SlidingPanels } from './SlidingPanels'
import { wordmarkSvg } from './brand/logo'
import { Galaxy, GALAXY_MAX, type GalaxyWorld } from './galaxy/Galaxy'
import { placeLabels } from './galaxy/labels'
import { createDaydreamControl } from '../bots/daydreamControl'
import { Inspector } from './inspector/Inspector'
import { FocusHud } from './inspector/FocusHud'
import { glassStyle } from './inspector/params'
import { RESUME_KEY } from '../core/resume'
import { qualityLevel } from './quality/ladder'
import { Vector3 } from 'three/webgpu'
import { PLANETS } from '../world/planets'
import { graphicsLevel, levelNumber } from '../core/quality'
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

const back = '<button type="button" class="panel-back link-button" data-goto="index">Back</button>'
/** `__SYN3H_BUILD__` is an optional build-time constant (a date or tag) from the bundler. */
declare const __SYN3H_BUILD__: string | undefined
const buildLine = typeof __SYN3H_BUILD__ === 'string' && __SYN3H_BUILD__ ? `build version : ${__SYN3H_BUILD__}` : 'browser edition'
const heading = (text: string) => `<h2 tabindex="-1">${text}</h2>`
/**
 * The vehicle paint sliders (src/vehicles/skins/showroom.ts), offered where a vehicle is
 * chosen. They are personal settings and live shader values, safe to drag. Built from the
 * registry, so a slider that is not defined is simply not shown.
 */
const PAINT_SLIDERS = ['paint.scaleSize', 'paint.scaleDepth', 'paint.seams', 'paint.flakes', 'paint.gloss']
const paintControls = (): string => {
  const sliders = PAINT_SLIDERS.map(id => params.get(id)).filter(p => p && typeof p.value === 'number')
  if (!sliders.length) return ''
  return `<fieldset class="paint-controls"><legend>Paint</legend>${sliders.map(p => `<label>${p!.def.label}<input data-param="${p!.def.id}" type="range" min="${p!.def.min ?? 0}" max="${p!.def.max ?? 1}" step="${p!.def.step ?? 0.01}" value="${p!.value}"></label>`).join('')}<p class="panel-note">Paint detail shows at higher vehicle shading, in Graphics. <button type="button" class="link-button" data-goto="advanced">All sliders</button></p></fieldset>`
}

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
  private preview?: VehiclePreview
  private readonly panels: SlidingPanels
  private readonly board: Scoreboard
  private readonly hudBoard: Scoreboard
  private paramPanel?: ParamPanel
  /** Slider groups the advanced panel is limited to, when it was opened from the custom planet. */
  private advancedGroups?: readonly string[]
  private worldDirty = true
  private readonly inspector: Inspector
  private readonly focusHud: FocusHud
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
    this.element.className = 'syn3h-shell'
    this.element.innerHTML = `<section class="shell-overlay" role="dialog" aria-modal="true" aria-label="Syn3h lobby">
      <div class="lobby-stage">
      <header class="lobby-brand">${wordmarkSvg('shell-logo')}</header>
      <div class="lobby-panels">
        <section data-panel="index" class="lobby-index">
          <h1 tabindex="-1">Welcome to the future.</h1>
          <div class="lobby-message"><p>You’ve discovered a community where all are welcome, and new ideas are celebrated.</p><p class="lobby-room-label"></p><div class="invite-qr menu-qr"></div><p class="invite-link"></p><button class="shell-invite link-button">Copy invite link</button></div>
          <p class="lobby-unsupported" hidden>Syn3h needs WebGL 2, which this browser does not offer. A current Safari, Chrome, Firefox or Edge will run it.</p><nav class="lobby-destinations" aria-label="Worlds"><button class="return-game is-primary" data-resume hidden>Return to Game</button></nav>
          <div class="lobby-links"><button data-goto="vehicle">Vehicle</button><button data-goto="worlds">Worlds</button><button data-goto="multiplayer">Multiplayer</button><button data-join>Join by QR</button><button data-goto="settings">Settings</button><button data-goto="about">About</button></div>
        </section>
        <section data-panel="explore">${heading('Prepare to Explore')}
          <form class="shell-form"><label for="shell-name">Player name</label><input id="shell-name" name="playerName" maxlength="24" autocomplete="nickname" placeholder="Explorer">
          <label for="shell-room">Room</label><div class="input-action"><input id="shell-room" name="room" maxlength="64" autocomplete="off"><button class="shell-invite" type="button">Copy invite</button></div>
          <div class="shell-controls"><span><b>WASD / arrows</b> Drive</span><span><b>Space</b> Wings</span><span><b>Shift</b> Brake</span><span><b>L / click</b> Tag beam</span></div><p class="shell-touch-hint">Left thumb to drive. Right thumb for wings, brake and tag.</p>
          <button class="shell-play is-primary" type="submit">Enter World ›</button></form>${back}
        </section>
        <section data-panel="vehicle">${heading('Your Vehicle')}
          <fieldset class="shell-vehicle"><legend>Vehicle</legend><div class="shell-vehicle-options"><label><input type="radio" name="vehicle" value="buggy-classic"> Classic</label><label><input type="radio" name="vehicle" value="buggy-syn3h"> Syn3h Buggy</label><label><input type="radio" name="vehicle" value="hovercraft"> Hovercraft</label><label><input type="radio" name="vehicle" value="jet"> Jet</label></div><div class="shell-vehicle-preview"></div><div class="shell-colors"><label>Body <input type="color" name="bodyColor" aria-label="Body colour"></label><label>Accent <input type="color" name="accentColor" aria-label="Accent colour"></label></div></fieldset>${paintControls()}
          <div class="vehicle-help"></div><p class="vehicle-note">Your vehicle and colours are saved on this device.</p><button data-goto="explore">Continue ›</button>${back}
        </section>
        <section data-panel="worlds">${heading('Worlds to Explore')}
          <p class="planet-current"></p><fieldset class="world-controls"><legend>World</legend><label for="world-seed">Seed</label><div class="input-action"><input id="world-seed" type="number" min="1" max="999999" step="1"><button id="new-world" type="button">New world</button></div><label class="bots-control" hidden>Bots <output></output><input id="bots-count" type="range" step="1"></label></fieldset>
          <fieldset class="world-controls"><legend>Sky</legend><div class="sky-presets">${SKY_PRESET_NAMES.map(name => `<button type="button" data-sky="${name}">${name}</button>`).join('')}</div><label for="sky-time">Time of day <output id="sky-time-value"></output></label><input id="sky-time" type="range" min="0" max="24" step="0.05"></fieldset>
          <p class="world-lock-note" hidden>Sliders locked by host.</p><button data-goto="explore">Explore this world ›</button>${back}
        </section>
        <section data-panel="settings">${heading('Settings')}<div class="settings-links"><button data-goto="music">Music & sound</button><button data-goto="worlds">World & sky</button><button data-goto="advanced">Advanced sliders</button><button class="presentation-toggle" aria-pressed="false">Presentation · P</button></div><fieldset class="host-controls"><legend>Host</legend><label class="host-lock" hidden><input type="checkbox" id="host-lock"> Lock shared sliders</label><p class="host-note"></p><button class="world-reset" type="button">Reset world to defaults</button></fieldset>${back}</section>
        <section data-panel="music">${heading('Music & Sound')}<label for="shell-track">Music</label><select id="shell-track">${Object.entries(MUSIC_TRACKS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select><label for="music-volume">Music volume <output id="music-volume-value"></output></label><input id="music-volume" type="range" min="0" max="1" step="0.01">${[masterVolume,effectsVolume,engineVolume,dirtVolume,windVolume,worldVolume,remoteVolume,cuesVolume].map(p=>`<label>${p.def.label}<input data-audio-param="${p.def.id}" type="range" min="0" max="1" step="0.01" value="${p.value}"></label>`).join('')}<button class="shell-mute" aria-pressed="false">Mute all audio</button><p class="panel-note">Music starts with your first click or key press.</p>${back}</section>
        <section data-panel="multiplayer">${heading('Multiplayer')}<label class="mode-control" hidden>Game mode<select id="game-mode"><option value="0">Tag</option><option value="1">King of the Hill</option></select></label><p class="multiplayer-room"></p><div class="invite-qr"></div><p class="invite-link"></p><button class="shell-invite">Copy invite link</button><button data-join>Show on screen · J</button><div class="shell-scoreboard" aria-label="Player scores"></div>${back}</section>
        <section data-panel="advanced">${heading('Advanced Settings')}<p class="world-lock-note" hidden>Sliders locked by host.</p><div class="advanced-host"></div>${back}</section>
        <section data-panel="about">${heading('About Syn3h')}${creditsHtml}${back}</section>
      </div>
      <footer class="lobby-footer"><span class="shell-message" role="status" aria-live="polite"></span><span class="build-line">${buildLine}</span></footer>
      </div>
      <div class="galaxy-ui" hidden><div class="galaxy-labels"></div><p class="galaxy-hint">Drag to look around. Tap a world to go there.</p><nav class="lobby-links galaxy-links" aria-label="Lobby"><button data-goto="vehicle">Vehicle</button><button data-goto="worlds">Worlds</button><button data-goto="multiplayer">Multiplayer</button><button data-join>Join by QR</button><button data-goto="settings">Settings</button><button data-goto="about">About</button></nav></div>
    </section>
    <aside class="shell-hud" hidden><div class="shell-speed"><strong>0</strong><span>MPH</span></div><div class="hud-scoreboard"></div></aside>
    <nav class="hud-navigation" aria-label="Game menu" hidden><button class="shell-menu-button" aria-label="Open menu">☰<span class="nav-label"> Menu</span></button><button data-open="multiplayer">Players</button><button class="inspector-toggle" type="button" aria-pressed="false">Create</button></nav>
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
      vehicles: () => ({ options: [...this.element.querySelectorAll<HTMLInputElement>('[name="vehicle"]')].map(radio => ({ id: radio.value, label: radio.parentElement!.textContent!.trim() })), current: this.activeVehicleKind === 'buggy' ? 'buggy-syn3h' : this.activeVehicleKind }),
      onVehicle: id => this.switchVehicle(id as VehicleKind),
    })
    // On a desktop the cards are there whenever the cursor is free; on touch they open from Create.
    this.inspector.open = !this.touch.available
    this.focusHud = new FocusHud(this.element)
    const toggle = this.element.querySelector<HTMLButtonElement>('.inspector-toggle')!
    toggle.addEventListener('click', () => { this.inspector.open = !this.inspector.open; toggle.setAttribute('aria-pressed', String(this.inspector.open)) }, { signal })
    toggle.setAttribute('aria-pressed', String(this.inspector.open))
    // Focus: the cursor is captured, so the player is driving. The full interface fades away.
    document.addEventListener('pointerlockchange', () => this.element.classList.toggle('is-focus', document.pointerLockElement === game.canvas), { signal })
    this.glass(signal)
    for (const slider of this.element.querySelectorAll<HTMLInputElement>('[data-param]')) slider.addEventListener('input', () => params.set(slider.dataset.param!, Number(slider.value)), { signal })
    this.startGalaxy()
    const unsubscribeWorld = params.onChange(id => { if (params.get(id)?.def.scope === 'world') this.worldDirty = true })
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
    for (const radio of this.element.querySelectorAll<HTMLInputElement>('[name="vehicle"]')) {
      radio.checked = radio.value === this.choice.vehicleKind
      radio.addEventListener('change', () => { this.choice.vehicleKind = radio.value as VehicleChoice['vehicleKind']; this.saveChoice() }, { signal })
    }
    for (const key of ['bodyColor', 'accentColor'] as const) {
      const input = this.element.querySelector<HTMLInputElement>(`[name="${key}"]`)!; input.value = this.choice[key]
      input.addEventListener('input', () => { this.choice[key] = input.value; this.saveChoice() }, { signal })
    }
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-goto]')) button.addEventListener('click', () => this.showPanel(button.dataset.goto!), { signal })
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-open]')) button.addEventListener('click', () => this.openMenu(button.dataset.open!), { signal })
    for (const button of this.element.querySelectorAll('[data-join]')) button.addEventListener('click', () => this.openJoin(), { signal })
    this.element.querySelector('.shell-menu-button')!.addEventListener('click', () => this.openMenu(), { signal })
    this.element.querySelector('[data-resume]')!.addEventListener('click', () => this.closeMenu(), { signal })
    this.element.querySelector('form')!.addEventListener('submit', event => { event.preventDefault(); this.play(true) }, { signal })
    for (const button of this.element.querySelectorAll('.shell-invite')) button.addEventListener('click', () => { void this.copyInvite() }, { signal })
    this.element.querySelector('.presentation-toggle')!.addEventListener('click', () => this.setPresentation(!this.presentation), { signal })
    for (const slider of this.element.querySelectorAll<HTMLInputElement>('[data-param]')) if (document.activeElement !== slider) slider.value = String(params.get(slider.dataset.param!)?.value ?? 0)
    for(const slider of this.element.querySelectorAll<HTMLInputElement>('[data-audio-param]'))slider.addEventListener('input',()=>params.set(slider.dataset.audioParam!,Number(slider.value)),{signal})
    this.element.querySelector('.shell-mute')!.addEventListener('click', () => { audio.setMuted(!audio.isMuted); this.update() }, { signal })
    this.element.querySelector('#shell-track')!.addEventListener('change', event => {
      void audio.setTrack((event.target as HTMLSelectElement).value as MusicTrack).catch(() => this.toast('Music could not start. Try selecting the track again.'))
    }, { signal })
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
    game.canvas.addEventListener('pointerdown', event => {
      if (!this.started || this.menuVisible || event.pointerType === 'touch' || event.button !== 0) return
      // The first click in play captures the cursor: from then on moving the mouse swings the
      // camera round the vehicle (ChaseCamera reads the locked pointer), and Escape lets the
      // cursor go again, which the browser does itself. That first click only captures.
      // (Networking also listens for clicks here, after this listener; stop it hearing this one.)
      if (this.capturesCursor && document.pointerLockElement !== game.canvas) { this.captureCursor(); event.stopImmediatePropagation(); return }
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
    if (this.inviteFromGame) this.openMenu()
    this.inviteOpen = true; this.overlay.inert = true; this.invite.show(); this.updateInvite()
  }
  closeJoin(): void {
    if (!this.inviteOpen) return
    this.inviteOpen = false; this.invite.hide(); this.overlay.inert = false
    if (this.inviteFromGame) this.closeMenu()
    else this.element.querySelector<HTMLButtonElement>('[data-join]')!.focus()
  }
  private saveChoice(): void { saveVehicleChoice(this.choice); this.preview?.setChoice(this.choice); this.updateHelp() }
  get vehicleKind(): VehicleChoice['vehicleKind'] { return this.choice.vehicleKind }
  get bodyColor(): string { return this.choice.bodyColor }
  get accentColor(): string { return this.choice.accentColor }
  get playerName(): string { return this.nameInput.value.trim().slice(0, 24) || 'Explorer' }
  get room(): string { return this.roomInput.value.trim().slice(0, 64) || 'lobby' }
  get playing(): boolean { return this.started }
  get menuOpen(): boolean { return this.menuVisible }
  get activePanel(): string { return this.panels.active }
  get presentation(): boolean { return this.element.classList.contains('is-presentation') }
  setPresentation(enabled: boolean): void { this.element.classList.toggle('is-presentation', enabled); this.element.querySelector('.presentation-toggle')!.setAttribute('aria-pressed', String(enabled)) }
  setPlayerCount(count: number): void { this.playerCount = Math.max(0, Math.floor(count)); this.updateInvite() }
  private lastMatch: MatchState | null = null
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
    if (id === 'vehicles') return this.element.querySelector<HTMLInputElement>(`[name="vehicle"][value="${this.activeVehicleKind === 'buggy' ? 'buggy-syn3h' : this.activeVehicleKind}"]`)?.parentElement?.textContent?.trim() ?? ''
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
    const url = new URL(location.href); url.searchParams.delete('vehicle'); url.searchParams.set('autoplay', '1')
    location.replace(url)
  }
  setLoadingMessages(messages: string[]): void { bootLoading?.setMessages(messages) }
  setParamPanel(panel: ParamPanel): void { this.paramPanel = panel }
  showPanel(id: string): void {
    if(id!==this.panels.active)this.audio.cue('click')
    this.lastActivity = performance.now()
    this.galaxyFor(id)
    if (id === 'vehicle' && !this.preview) {
      this.preview = new VehiclePreview(this.element.querySelector('.shell-vehicle-preview')!); this.preview.setChoice(this.choice)
    }
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
    void this.audio.unlock().then(async () => { await this.audio.ready(); this.audio.play('materialize') }).catch(() => this.toast('Audio is unavailable. You can still play.'))
    try { localStorage.setItem('syn3h.playerName', this.playerName) } catch { /* Playing does not require storage. */ }
    this.started = true; this.worldDirty = true; this.nameInput.disabled = true; this.roomInput.disabled = true
    this.element.querySelector<HTMLButtonElement>('.shell-play')!.textContent = 'Return to Game ›'
    this.element.querySelector<HTMLElement>('[data-resume]')!.hidden = false
    for (const input of this.element.querySelectorAll<HTMLInputElement>('.shell-vehicle input')) input.disabled = true
    this.element.querySelector('.vehicle-note')!.textContent = 'Vehicle selection is fixed for this session.'
    if (descend && this.galaxy?.live && this.menuVisible && !matchMedia('(prefers-reduced-motion: reduce)').matches) { this.onPlay?.(); void this.descent(); return }
    this.closeMenu(); this.showHelp(false); this.onPlay?.()
  }
  openMenu(panel = 'index'): void {
    if (!this.started) return
    this.menuVisible = true; this.overlay.hidden = false; this.overlay.inert = false; if (this.galaxy) this.galaxy.enabled = true
    this.releaseCursor()
    this.game.input.suspended = true; this.game.input.mouseFire = false; this.game.input.poll(); this.touch.enabled = false
    this.audio.enabled = false; this.audio.setLobbyVisible(true); this.element.classList.remove('is-playing'); this.showPanel(panel)
  }
  /**
   * The descent. The galaxy dives onto the island, holds in the light until the room has
   * answered (a slow join can rebuild the world and move the spawn point), then the game
   * arrives blurred, its camera falling from 520 m to its place behind the vehicle. A player
   * who has seen it before gets a shorter fall; a tap, click or key at any point lands at once.
   */
  private async descent(): Promise<void> {
    const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
    const game = document.getElementById('game'), root = this.element, camera = this.cinematic
    root.classList.add('is-descending'); this.overlay.inert = true
    let seen = 0
    try { seen = Number(localStorage.getItem('syn3h.descents')) || 0; localStorage.setItem('syn3h.descents', String(seen + 1)) } catch { /* Storage is optional. */ }
    let skip = false
    const skipping = new AbortController()
    for (const type of ['pointerdown', 'keydown'] as const) addEventListener(type, () => { skip = true }, { signal: skipping.signal, capture: true })
    const until = async (done: () => boolean, ms: number) => { const end = performance.now() + ms; while (!done() && !skip && performance.now() < end) await wait(50) }
    // While the lobby still covers it, lift the game's camera high over the spawn point.
    let pose = this.descentPose(); pose(0)
    let dived = false
    void this.galaxy!.descend(currentPlanet().id, seen > 0).then(() => { dived = true })
    await until(() => dived, 2600)
    await until(() => Boolean((window as { syn3hNet?: { connected?: boolean } }).syn3hNet?.connected), 5000)
    // The spawn point may have moved with the room's world: aim at where the player is now.
    pose = this.descentPose(); pose(0)
    // Through the air: the lobby fades off the top of the game, which arrives blurred and clears.
    const length = skip ? 0 : seen > 0 ? 1400 : 2400
    if (game) { game.style.transition = 'none'; game.style.filter = skip ? 'none' : 'blur(18px) brightness(1.5)' }
    this.overlay.style.transition = `opacity ${skip ? 0.2 : 0.9}s ease`; this.overlay.style.opacity = '0'
    await wait(60)
    if (game && !skip) { game.style.transition = `filter ${(length * 0.9 / 1000).toFixed(2)}s cubic-bezier(.2,.6,.2,1)`; game.style.filter = 'none' }
    const started = performance.now()
    await new Promise<void>(resolve => { const step = () => { const t = skip || length === 0 ? 1 : Math.min(1, (performance.now() - started) / length); pose(t); if (t < 1) requestAnimationFrame(step); else resolve() }; step() })
    if (skip) { await wait(200); if (game) game.style.filter = 'none' }
    skipping.abort()
    camera?.clearCinematicPose()
    this.overlay.style.removeProperty('transition'); this.overlay.style.removeProperty('opacity'); root.classList.remove('is-descending')
    if (game) { game.style.removeProperty('transition'); game.style.removeProperty('filter') }
    this.closeMenu(); this.showHelp(false)
  }
  /** The descent's camera path over where the player is now: t from 0 (520 m up) to 1 (behind the vehicle). */
  private descentPose(): (t: number) => void {
    const self = this.self, ground = this.ground, camera = this.cinematic
    if (!self || !camera) return () => {}
    const at = new Vector3(self.x, ground?.heightAt(self.x, self.z) ?? 0, self.z)
    const ahead = new Vector3(-Math.sin(self.heading), 0, -Math.cos(self.heading))
    return t => {
      // From 520 m up and a little behind, looking down, to the chase position.
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
      const height = 520 * (1 - e) + 4.5 * e, back = 60 * (1 - e) + 10 * e
      camera.setCinematicPose(new Vector3(at.x - ahead.x * back, at.y + height, at.z - ahead.z * back), new Vector3(at.x + ahead.x * 8 * e, at.y + 1.5, at.z + ahead.z * 8 * e))
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
    this.element.querySelector<HTMLButtonElement>('.shell-menu-button')!.focus({ preventScroll: true })
  }
  private keydown(event: KeyboardEvent): void {
    const editing = event.target instanceof HTMLElement && (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))
    if (!editing && !event.repeat && event.code === 'KeyP') { event.preventDefault(); event.stopImmediatePropagation(); this.setPresentation(!this.presentation); return }
    if (!editing && !event.repeat && event.code === 'KeyJ') { event.preventDefault(); event.stopImmediatePropagation(); this.inviteOpen ? this.closeJoin() : this.openJoin(); return }
    if (this.inviteOpen) {
      if (event.code === 'Escape') { event.preventDefault(); this.closeJoin() }
      if (event.key === 'Tab') { event.preventDefault(); const buttons = [...this.invite.element.querySelectorAll<HTMLButtonElement>('button')]; buttons[document.activeElement === buttons[0] ? 1 : 0].focus() }
      return
    }
    if (this.started && !this.menuVisible && !event.repeat && (event.code === 'KeyH' || event.key === '?')) { event.preventDefault(); this.toggleHelp(); return }
    if (event.code === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation()
      if (this.menuVisible && this.panels.active !== 'index') this.showPanel('index')
      else if (this.started) this.menuVisible ? this.closeMenu() : this.openMenu()
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
  /** Terraform mode: only the sliders that shape a world, opened. */
  private openCustomPlanet(): void {
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
      chip.addEventListener('click', () => this.galaxy?.choose(world.id))
      labels.append(chip); chips.set(world.id, chip)
    }
    this.galaxy = new Galaxy(this.overlay, {
      worlds,
      still: () => levelNumber(graphicsLevel.value) === 0,
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
    const open = panel === 'index'
    this.element.classList.toggle('galaxy-open', open)
    this.element.querySelector<HTMLElement>('.galaxy-ui')!.hidden = !open
    if (open) this.galaxy.home()
    // Behind a panel the galaxy dims and holds still; behind the name form a little less,
    // since the world just chosen is the picture there.
    this.galaxy.backdrop = open ? 1 : panel === 'explore' ? 0.7 : 0.35
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
  private captureCursor(): void {
    // Unadjusted movement where the browser offers it, so the swing is the same on every OS.
    try {
      const request = (this.game.canvas.requestPointerLock as (options?: { unadjustedMovement?: boolean }) => Promise<void> | void).call(this.game.canvas, { unadjustedMovement: true })
      if (request && typeof (request as Promise<void>).catch === 'function') (request as Promise<void>).catch(() => { try { void this.game.canvas.requestPointerLock() } catch { /* The cursor stays free; play carries on. */ } })
    } catch { /* The cursor stays free; play carries on. */ }
  }
  private releaseCursor(): void { if (document.pointerLockElement === this.game.canvas) document.exitPointerLock() }
  private updateHelp(): void {
    renderHelp(this.element.querySelector('.vehicle-help')!, this.choice.vehicleKind)
    this.element.querySelector('.shell-touch-hint')!.textContent = touchHelp(this.choice.vehicleKind)
    renderHelp(this.element.querySelector('.shell-controls')!, this.choice.vehicleKind)
  }
  /** Call after an actual spawn so query overrides and future respawns show the right controls. */
  setVehicleKind(kind: VehicleKind): void { this.activeVehicleKind = kind; this.touch.setVehicleKind(kind); if (this.started) this.showHelp(false) }
  /**
   * The controls card, in the lower left so it never covers the vehicle. After Play it is the
   * short version: it leaves after five seconds or on the first key, click or touch, but stays
   * at least a second and a half so an eager driver still gets to read it. H or ? opens the
   * full list, which stays for its whole time because the player asked for it.
   */
  showHelp(full = true): void {
    const hint = this.element.querySelector<HTMLElement>('.spawn-help')!, touch = this.touch.available
    renderHelp(hint.querySelector('div')!, this.activeVehicleKind, touch, !full)
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
  setStatus(lines: readonly string[]): void { this.board.setStatus(lines); this.hudBoard.setStatus(lines); const players = (window as unknown as {syn3hNet?:{players?:Map<number,{bot?:boolean}>}}).syn3hNet?.players; this.playerCount = players ? [...players.values()].filter(player => !player.bot).length : lines.filter(line => parseScoreRow(line)).length; this.updateInvite() }
  setSpeed(metresPerSecond: number): void { this.speed.textContent = String(Math.round(Math.abs(metresPerSecond) * 2.23694)) }
  update(dt = 0): void {
    if (this.attract && !this.attract.ready) {
      const debug = (window as unknown as { syn3h?: { camera?: CinematicCamera; bots?: { vehicles: readonly Vehicle[] } } }).syn3h
      if (debug?.camera?.setCinematicPose) this.setAttractCamera(debug.camera, () => debug.bots?.vehicles ?? [])
    }
    if (!this.started && !this.inviteOpen && !this.attract?.active && (this.requestedAttract || performance.now() - this.lastActivity > 20000)) this.startAttract()
    this.attract?.update(dt)
    this.touch.update(); if (!this.menuVisible) this.minimap?.update()
    if (this.started && !this.menuVisible) {
      const focus = this.element.classList.contains('is-focus')
      if (!focus && this.inspector.open) this.inspector.update()
      this.focusHud.update(focus, { speed: this.telemetry.speed, altitude: this.telemetry.altitude, heading: this.self?.heading ?? 0, world: `${currentPlanet().label} · ${planetName(worldSeed.value)}`, hour: Number(params.get('sun.timeOfDay')?.value ?? 0) })
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
    const track = this.element.querySelector<HTMLSelectElement>('#shell-track')!
    if (document.activeElement !== track) track.value = this.audio.track
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
    this.abort.abort(); clearTimeout(this.toastTimer); clearTimeout(this.helpTimer); this.helpInput?.abort(); this.inspector.dispose(); this.focusHud.dispose(); this.galaxy?.dispose(); this.preview?.dispose(); this.attract?.dispose(); this.matchHud.dispose(); this.invite.dispose(); this.minimap?.dispose(); this.panels.dispose(); this.touch.dispose(); this.element.remove()
    document.body.classList.remove('has-game-shell'); this.game.input.suspended = this.previousSuspended; this.game.input.mouseFire = false
  }
}

/** Call after creating the player, before constructing ParamPanel. */
export function initGameShell(game: Game, player: Vehicle, terrain: Terrain): { shell: Shell; audio: GameAudio; setPlayer: (player: Vehicle) => void; dispose: () => void } {
  const audio = new GameAudio(game.camera), shell = game.add(new Shell(game, audio))
  shell.setVehicleKind(player.kind); shell.setTerrain(terrain); audio.setPlayer(player,terrain)
  let activePlayer = player
  const hints = new PlayHints()
  const bridge = game.add({ update(dt = 0) {
    const v = activePlayer.body.linvel(), p = activePlayer.body.translation(), speed = Math.hypot(v.x, v.y, v.z)
    shell.setSpeed(speed)
    const q = activePlayer.body.rotation()
    const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y))
    shell.setMapSelf({ x: p.x, z: p.z, heading, color: activePlayer.colors.body, self: true })
    shell.setTelemetry(speed, p.y - terrain.heightAt(p.x, p.z))
    audio.motion = { speed, throttle: activePlayer.kind === 'jet' ? activePlayer.input.z : activePlayer.input.y, airborne: p.y - terrain.heightAt(p.x, p.z) > 2 }
    const input = activePlayer.input
    const hint = hints.update(dt, { kind: activePlayer.kind, touch: shell.touch.available, altitude: p.y - terrain.heightAt(p.x, p.z), speed, steer: input.x, pitch: input.y, throttle: input.z, hoverMode: !input.special, canLiftOut: activePlayer.canLiftOut })
    if (hint) shell.showHint(hint)
  } })
  game.add(audio)
  return { shell, audio, setPlayer(next) { activePlayer = next; hints.reset(); audio.setPlayer(next,terrain); shell.setVehicleKind(next.kind) }, dispose() { game.remove(bridge); game.remove(shell); game.remove(audio) } }
}
