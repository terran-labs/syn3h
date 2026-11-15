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
import { Starfield } from './Starfield'
import { wordmarkSvg } from './brand/logo'
import { PlanetPicker } from './planets/PlanetPicker'
import { planetOrbs } from './planets/PlanetOrbs'
import { Galaxy, type GalaxyWorld } from './galaxy/Galaxy'
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
  private readonly starfield: Starfield
  private readonly board: Scoreboard
  private readonly hudBoard: Scoreboard
  private paramPanel?: ParamPanel
  private readonly pickers: PlanetPicker[] = []
  /** Slider groups the advanced panel is limited to, when it was opened from the custom planet. */
  private advancedGroups?: readonly string[]
  private worldDirty = true
  /** The 3D galaxy lobby. On by default; ?galaxy=0 in the link keeps the panel lobby. */
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
          <nav class="lobby-destinations" aria-label="Worlds"><div class="planet-slot" data-compact></div><button class="return-game is-primary" data-resume hidden>Return to Game</button></nav>
          <div class="lobby-links"><button data-goto="vehicle">Vehicle</button><button data-goto="worlds">Worlds</button><button data-goto="multiplayer">Multiplayer</button><button data-join>Join by QR</button><button data-goto="settings">Settings</button><button data-goto="about">About</button></div>
        </section>
        <section data-panel="explore">${heading('Prepare to Explore')}
          <form class="shell-form"><label for="shell-name">Player name</label><input id="shell-name" name="playerName" maxlength="24" autocomplete="nickname" placeholder="Explorer">
          <label for="shell-room">Room</label><div class="input-action"><input id="shell-room" name="room" maxlength="64" autocomplete="off"><button class="shell-invite" type="button">Copy invite</button></div>
          <div class="shell-controls"><span><b>WASD / arrows</b> Drive</span><span><b>Space</b> Wings</span><span><b>Shift</b> Brake</span><span><b>L / click</b> Tag beam</span></div><p class="shell-touch-hint">Left thumb to drive. Right thumb for wings, brake and tag.</p>
          <button class="shell-play is-primary" type="submit">Enter World ›</button></form>${back}
        </section>
        <section data-panel="vehicle">${heading('Your Vehicle')}
          <fieldset class="shell-vehicle"><legend>Vehicle</legend><div class="shell-vehicle-options"><label><input type="radio" name="vehicle" value="buggy-classic"> Classic</label><label><input type="radio" name="vehicle" value="buggy-syn3h"> Syn3h Buggy</label><label><input type="radio" name="vehicle" value="hovercraft"> Hovercraft</label><label><input type="radio" name="vehicle" value="jet"> Jet</label></div><div class="shell-vehicle-preview"></div><div class="shell-colors"><label>Body <input type="color" name="bodyColor" aria-label="Body colour"></label><label>Accent <input type="color" name="accentColor" aria-label="Accent colour"></label></div></fieldset>
          <div class="vehicle-help"></div><p class="vehicle-note">Your vehicle and colours are saved on this device.</p><button data-goto="explore">Continue ›</button>${back}
        </section>
        <section data-panel="worlds">${heading('Worlds to Explore')}
          <div class="planet-slot"></div><p class="planet-current"></p><fieldset class="world-controls"><legend>World</legend><label for="world-seed">Seed</label><div class="input-action"><input id="world-seed" type="number" min="1" max="999999" step="1"><button id="new-world" type="button">New world</button></div><label class="bots-control" hidden>Bots <output></output><input id="bots-count" type="range" step="1"></label></fieldset>
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
    <nav class="hud-navigation" aria-label="Game menu" hidden><button class="shell-menu-button" aria-label="Open menu">☰<span class="nav-label"> Menu</span></button><button data-open="multiplayer">Players</button><button data-open="worlds">Create</button></nav>
    <aside class="spawn-help" role="status" hidden><strong>Controls</strong><div></div><small></small></aside>
    <div class="shell-toast" role="status" aria-live="polite" hidden></div>`
    document.body.append(this.element); document.body.classList.add('has-game-shell')
    this.invite = new InviteView(this.element, () => this.closeJoin(), () => { void this.copyInvite() })
    this.matchHud = new MatchHud(this.element, () => audio.cue('tick'))
    this.overlay = this.element.querySelector('.shell-overlay')!
    this.nameInput = this.element.querySelector('#shell-name')!; this.roomInput = this.element.querySelector('#shell-room')!
    this.speed = this.element.querySelector('.shell-speed strong')!
    this.panels = new SlidingPanels(this.element.querySelector('.lobby-panels')!)
    this.starfield = new Starfield(this.overlay, { seed: worldSeed.value }, () => levelNumber(graphicsLevel.value) === 0)
    this.board = new Scoreboard(this.element.querySelector('.shell-scoreboard')!, text => {this.toast(text);if(/joined/i.test(text))audio.cue('join');else if(/left/i.test(text))audio.cue('leave');else if(/tagged| is it/i.test(text))audio.cue('tag')})
    this.hudBoard = new Scoreboard(this.element.querySelector('.hud-scoreboard')!, () => {})
    this.touch = new TouchControls(game.input); this.element.classList.toggle('has-touch', this.touch.available)
    const signal = this.abort.signal
    this.followPointer(signal)
    // Planets: the index offers them as destinations, the Worlds panel describes them.
    for (const slot of this.element.querySelectorAll<HTMLElement>('.planet-slot')) {
      const compact = slot.hasAttribute('data-compact')
      this.pickers.push(new PlanetPicker(slot, { compact, onPick: id => this.pickPlanet(id, compact), onCustom: () => this.openCustomPlanet() }))
    }
    this.glass(signal)
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
      game.input.mouseFire = true; game.canvas.setPointerCapture(event.pointerId)
    }, { signal })
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
    this.menuVisible = true; this.overlay.hidden = false; this.overlay.inert = false; this.starfield.enabled = !this.galaxy; if (this.galaxy) this.galaxy.enabled = true
    this.game.input.suspended = true; this.game.input.mouseFire = false; this.game.input.poll(); this.touch.enabled = false
    this.audio.enabled = false; this.audio.setLobbyVisible(true); this.element.classList.remove('is-playing'); this.showPanel(panel)
  }
  private async descent(): Promise<void> {
    const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
    const game = document.getElementById('game'), root = this.element
    root.classList.add('is-descending'); this.overlay.inert = true
    // While the lobby still covers it, lift the game's camera high over the spawn point.
    const self = this.self, ground = this.ground, camera = this.cinematic
    const at = self ? new Vector3(self.x, ground?.heightAt(self.x, self.z) ?? 0, self.z) : null
    const ahead = self ? new Vector3(-Math.sin(self.heading), 0, -Math.cos(self.heading)) : null
    const pose = (t: number) => {
      if (!at || !ahead || !camera) return
      // From 520 m up and a little behind, looking down, to the chase position.
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
      const height = 520 * (1 - e) + 4.5 * e, back = 60 * (1 - e) + 10 * e
      camera.setCinematicPose(new Vector3(at.x - ahead.x * back, at.y + height, at.z - ahead.z * back), new Vector3(at.x + ahead.x * 8 * e, at.y + 1.5, at.z + ahead.z * 8 * e))
    }
    pose(0)
    await Promise.race([this.galaxy!.descend(currentPlanet().id), wait(2600)])
    // Through the air: the lobby fades off the top of the game, which arrives blurred and clears.
    if (game) { game.style.transition = 'none'; game.style.filter = 'blur(18px) brightness(1.5)' }
    this.overlay.style.transition = 'opacity 0.9s ease'; this.overlay.style.opacity = '0'
    await wait(60)
    if (game) { game.style.transition = 'filter 2.2s cubic-bezier(.2,.6,.2,1)'; game.style.filter = 'none' }
    const started = performance.now(), length = 2400
    await new Promise<void>(resolve => { const step = () => { const t = Math.min(1, (performance.now() - started) / length); pose(t); if (t < 1) requestAnimationFrame(step); else resolve() }; step() })
    camera?.clearCinematicPose()
    this.overlay.style.removeProperty('transition'); this.overlay.style.removeProperty('opacity'); root.classList.remove('is-descending')
    if (game) { game.style.removeProperty('transition'); game.style.removeProperty('filter') }
    this.closeMenu(); this.showHelp(false)
  }
  private ground?: Terrain
  private cinematic?: CinematicCamera
  private self?: MapEntity
  closeMenu(): void {
    if (!this.started) return
    this.menuVisible = false; this.overlay.hidden = true; this.overlay.inert = true; this.starfield.enabled = false; if (this.galaxy) this.galaxy.enabled = false
    // The game is about to be on screen: give the lobby's graphics contexts back at once.
    planetOrbs.release()
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
        this.starfield.setShift(x, -y)
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
   * The galaxy lobby, the default (?galaxy=0 turns it off): in place of the index panel, the worlds orbit a
   * sun in 3D. Drag to look around, tap a world to fly to it, and the name form follows. The
   * other panels open over it as before. Needs WebGL 2 and more than the lowest graphics
   * level; otherwise the ordinary lobby stays.
   */
  private startGalaxy(): void {
    if (new URLSearchParams(location.search).get('galaxy') === '0' || levelNumber(graphicsLevel.value) === 0 || !Galaxy.supported()) return
    const current = currentPlanet().id, labels = this.element.querySelector<HTMLElement>('.galaxy-labels')!
    const worlds: GalaxyWorld[] = PLANETS.slice(0, 3).map((recipe, i) => ({ id: recipe.id, label: recipe.label, land: recipe.swatch[0], sea: recipe.swatch[1], glow: recipe.values['world.seaKind'] === 0, seed: recipe.id === current ? worldSeed.value : i + 1 }))
    // The custom planet is a world still forming: tap it to shape it with the sliders.
    worlds.push({ id: 'custom', label: 'Custom', land: 0x31507a, sea: 0x0a1630, glow: false, seed: 7, forming: true })
    const chips = new Map<string, HTMLButtonElement>()
    for (const world of worlds) {
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'galaxy-label'; chip.dataset.world = world.id
      chip.innerHTML = '<strong></strong><small></small>'; chip.querySelector('strong')!.textContent = world.label
      chip.querySelector('small')!.textContent = world.forming ? 'Shape your own' : world.id === current ? planetName(world.seed) : ''
      chip.addEventListener('click', () => this.galaxy?.choose(world.id))
      labels.append(chip); chips.set(world.id, chip)
    }
    this.galaxy = new Galaxy(this.overlay, {
      worlds,
      onArrive: id => {
        if (id === 'custom') {
          if (!canEditWorld() || (this.invited && !this.started)) { this.say('This world is not yours to reshape yet.'); this.galaxy?.home(); return }
          this.openCustomPlanet(); return
        }
        if (this.invited && !this.started && id !== currentPlanet().id) { this.say('You were invited to another world. You can change it once you are in, if the host allows.'); this.galaxy?.home(); return }
        this.pickPlanet(id, true)
      },
      onLayout: places => { for (const place of places) { const chip = chips.get(place.id)!; chip.hidden = !place.visible; 
        // Under its world, but always wholly on the screen and clear of the links.
        const x = Math.min(innerWidth - 62, Math.max(62, place.x)), y = Math.min(innerHeight - 128, Math.max(8, place.y + place.radius + 10))
        chip.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px` } },
    })
    this.element.classList.add('is-galaxy'); this.starfield.enabled = false; this.galaxy.enabled = true
    this.galaxyFor(this.panels.active || 'index')
  }
  private stopGalaxy(): void {
    this.galaxy?.dispose(); this.galaxy = undefined
    this.element.classList.remove('is-galaxy', 'galaxy-open'); this.element.querySelector<HTMLElement>('.galaxy-ui')!.hidden = true
    this.starfield.enabled = this.menuVisible
  }
  /** The galaxy is the index; any other panel opens over it. */
  private galaxyFor(panel: string): void {
    if (!this.galaxy) return
    const open = panel === 'index'
    this.element.classList.toggle('galaxy-open', open)
    this.element.querySelector<HTMLElement>('.galaxy-ui')!.hidden = !open
    if (open) this.galaxy.home()
  }
  /** What the lobby's own graphics are doing, for the phone checks. */
  get graphics(): { starfieldFrames: number; starfieldLive: boolean; planetsLive: boolean; planetMaps: number } {
    return { starfieldFrames: this.starfield.frames, starfieldLive: this.starfield.generated, planetsLive: planetOrbs.active, planetMaps: planetOrbs.painted }
  }
  /**
   * Every button is terranlabs.com's glass button (.liquid-glass in shell.css), except the
   * quiet text links. This also carries that site's GlassShine: while the pointer is over a
   * glass button, the bright side of its one-pixel rim turns to face the pointer, and settles
   * back when the pointer leaves. Nothing is drawn on the face of the button.
   */
  private glass(signal: AbortSignal): void {
    const buttons = [...this.element.querySelectorAll<HTMLElement>('button'), ...this.touch.element.querySelectorAll<HTMLElement>('button')]
    for (const button of buttons) if (!button.matches('.link-button, .lobby-links *, .syn3h-advanced *')) button.classList.add('liquid-glass')
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
    // The stylesheet drops frost at the lowest graphics level.
    // Frost goes at the lowest graphics level, and when the quality ladder is shedding post effects.
    const gfx = qualityLevel() >= 2 ? '0' : String(levelNumber(graphicsLevel.value))
    if (document.documentElement.dataset.gfx !== gfx) document.documentElement.dataset.gfx = gfx
    // The lowest graphics level has no place for a traced galaxy: back to the panel lobby,
    // but never out from under someone who is looking at it.
    if (this.galaxy && levelNumber(graphicsLevel.value) === 0 && (!this.menuVisible || this.panels.active !== 'index')) this.stopGalaxy()
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
    for (const picker of this.pickers) picker.refresh(planet, worldSeed.value, editable && !invitedOnly)
    if (this.worldDirty) {
      this.worldDirty = false
      this.element.querySelector('.planet-current')!.textContent = `${planet.label} world ${planetName(worldSeed.value)}. ${planet.centre}.${invitedOnly ? ' You were invited to this world.' : ''}`
      this.updateInvite()
    }
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
    this.abort.abort(); clearTimeout(this.toastTimer); clearTimeout(this.helpTimer); this.helpInput?.abort(); for (const picker of this.pickers) picker.dispose(); this.galaxy?.dispose(); this.preview?.dispose(); this.attract?.dispose(); this.matchHud.dispose(); this.invite.dispose(); this.minimap?.dispose(); this.panels.dispose(); this.starfield.dispose(); this.touch.dispose(); this.element.remove()
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
    audio.motion = { speed, throttle: activePlayer.kind === 'jet' ? activePlayer.input.z : activePlayer.input.y, airborne: p.y - terrain.heightAt(p.x, p.z) > 2 }
    const input = activePlayer.input
    const hint = hints.update(dt, { kind: activePlayer.kind, touch: shell.touch.available, altitude: p.y - terrain.heightAt(p.x, p.z), speed, steer: input.x, pitch: input.y, throttle: input.z, hoverMode: !input.special, canLiftOut: activePlayer.canLiftOut })
    if (hint) shell.showHint(hint)
  } })
  game.add(audio)
  return { shell, audio, setPlayer(next) { activePlayer = next; hints.reset(); audio.setPlayer(next,terrain); shell.setVehicleKind(next.kind) }, dispose() { game.remove(bridge); game.remove(shell); game.remove(audio) } }
}
