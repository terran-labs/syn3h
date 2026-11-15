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
import { AttractMode, type CinematicCamera } from './AttractMode'
import { InviteView, inviteUrl, renderQr } from './InviteView'
import { Scoreboard, parseScoreRow } from './Scoreboard'
import { canEditWorld, hostControls } from './worldPermissions'
import type { ParamPanel } from './ParamPanel'
import { MatchHud, type MatchState } from './MatchHud'
import { creditsHtml } from './data/credits'
import { generateName } from './data/names'
import { Minimap, type MapEntity } from './Minimap'
import { bootLoading } from './LoadingScreen'
import { renderHelp, touchHelp } from './VehicleHelp'
import type { VehicleKind } from '../vehicles'
import './shell.css'

const back = '<button type="button" class="panel-back" data-goto="index">‹ Back</button>'
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
      <header class="lobby-brand"><img class="shell-logo" src="/brand/syn3h.png" alt="Syn3h" width="512" height="256"></header>
      <div class="lobby-panels">
        <section data-panel="index" class="lobby-index">
          <div class="lobby-message"><h1 tabindex="-1">Explore. Create. Connect.</h1><p>Choose your vehicle and explore a world together.</p><p class="lobby-room-label"></p><div class="invite-qr menu-qr"></div><p class="invite-link"></p><button class="shell-invite">Copy invite link</button><div class="lobby-links"><button data-goto="about">About</button><button data-goto="settings">Settings</button><button data-goto="multiplayer">Community</button></div></div>
          <nav class="lobby-destinations" aria-label="Lobby"><button data-goto="explore">Explore</button><button data-goto="vehicle">Vehicle</button><button data-goto="worlds">Worlds</button><button data-goto="multiplayer">Multiplayer</button><button data-join>Join by QR · J</button><button class="return-game" data-resume hidden>Return to Game</button></nav>
        </section>
        <section data-panel="explore">${heading('Prepare to Explore')}
          <form class="shell-form"><label for="shell-name">Player name</label><input id="shell-name" name="playerName" maxlength="24" autocomplete="nickname" placeholder="Explorer">
          <label for="shell-room">Room</label><div class="input-action"><input id="shell-room" name="room" maxlength="64" autocomplete="off"><button class="shell-invite" type="button">Copy invite</button></div>
          <div class="shell-controls"><span><b>WASD / arrows</b> Drive</span><span><b>Space</b> Wings</span><span><b>Shift</b> Brake</span><span><b>L / click</b> Fire</span></div><p class="shell-touch-hint">Left thumb to drive. Right thumb for wings, brake and fire.</p>
          <button class="shell-play" type="submit">Enter World ›</button></form>${back}
        </section>
        <section data-panel="vehicle">${heading('Your Vehicle')}
          <fieldset class="shell-vehicle"><legend>Vehicle</legend><div class="shell-vehicle-options"><label><input type="radio" name="vehicle" value="buggy-classic"> Classic</label><label><input type="radio" name="vehicle" value="buggy-syn3h"> Syn3h Buggy</label><label><input type="radio" name="vehicle" value="hovercraft"> Hovercraft</label><label><input type="radio" name="vehicle" value="jet"> Jet</label></div><div class="shell-vehicle-preview"></div><div class="shell-colors"><label>Body <input type="color" name="bodyColor" aria-label="Body colour"></label><label>Accent <input type="color" name="accentColor" aria-label="Accent colour"></label></div></fieldset>
          <div class="vehicle-help"></div><p class="vehicle-note">Your vehicle and colours are saved on this device.</p><button data-goto="explore">Continue ›</button>${back}
        </section>
        <section data-panel="worlds">${heading('Worlds to Explore')}
          <p>Procedural volcano</p><fieldset class="world-controls"><legend>World</legend><label for="world-seed">Seed</label><div class="input-action"><input id="world-seed" type="number" min="1" max="999999" step="1"><button id="new-world" type="button">New world</button></div><label class="bots-control" hidden>Bots <output></output><input id="bots-count" type="range" step="1"></label></fieldset>
          <fieldset class="world-controls"><legend>Sky</legend><div class="sky-presets">${SKY_PRESET_NAMES.map(name => `<button type="button" data-sky="${name}">${name}</button>`).join('')}</div><label for="sky-time">Time of day <output id="sky-time-value"></output></label><input id="sky-time" type="range" min="0" max="24" step="0.05"></fieldset>
          <p class="world-lock-note" hidden>Sliders locked by host.</p><button data-goto="explore">Explore this world ›</button>${back}
        </section>
        <section data-panel="settings">${heading('Settings')}<div class="settings-links"><button data-goto="music">Music & sound</button><button data-goto="worlds">World & sky</button><button data-goto="advanced">Advanced sliders</button><button class="presentation-toggle" aria-pressed="false">Presentation · P</button></div><fieldset class="host-controls"><legend>Host</legend><label class="host-lock" hidden><input type="checkbox" id="host-lock"> Lock shared sliders</label><p class="host-note"></p></fieldset>${back}</section>
        <section data-panel="music">${heading('Music & Sound')}<label for="shell-track">Music</label><select id="shell-track">${Object.entries(MUSIC_TRACKS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select><label for="music-volume">Music volume <output id="music-volume-value"></output></label><input id="music-volume" type="range" min="0" max="1" step="0.01">${[masterVolume,effectsVolume,engineVolume,dirtVolume,windVolume,worldVolume,remoteVolume,cuesVolume].map(p=>`<label>${p.def.label}<input data-audio-param="${p.def.id}" type="range" min="0" max="1" step="0.01" value="${p.value}"></label>`).join('')}<button class="shell-mute" aria-pressed="false">Mute all audio</button><p class="panel-note">Music starts with your first click or key press.</p>${back}</section>
        <section data-panel="multiplayer">${heading('Multiplayer')}<label class="mode-control" hidden>Game mode<select id="game-mode"><option value="0">Tag</option><option value="1">King of the Hill</option></select></label><p class="multiplayer-room"></p><div class="invite-qr"></div><p class="invite-link"></p><button class="shell-invite">Copy invite link</button><button data-join>Show on screen · J</button><div class="shell-scoreboard" aria-label="Player scores"></div>${back}</section>
        <section data-panel="advanced">${heading('Advanced Settings')}<p class="world-lock-note" hidden>Sliders locked by host.</p><div class="advanced-host"></div>${back}</section>
        <section data-panel="about">${heading('About Syn3h')}${creditsHtml}${back}</section>
      </div>
      <footer class="lobby-footer"><span>Syn3h</span><span class="shell-message" role="status" aria-live="polite"></span><span>Browser edition</span></footer>
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
    this.starfield = new Starfield(this.overlay)
    this.board = new Scoreboard(this.element.querySelector('.shell-scoreboard')!, text => {this.toast(text);if(/joined/i.test(text))audio.cue('join');else if(/left/i.test(text))audio.cue('leave');else if(/tagged| is it/i.test(text))audio.cue('tag')})
    this.hudBoard = new Scoreboard(this.element.querySelector('.hud-scoreboard')!, () => {})
    this.touch = new TouchControls(game.input); this.element.classList.toggle('has-touch', this.touch.available)
    const signal = this.abort.signal
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
    this.element.querySelector('form')!.addEventListener('submit', event => { event.preventDefault(); this.play() }, { signal })
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
    const url = inviteUrl(location.origin, this.room)
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
    this.lastMatch=state?{...state}:null
    this.matchHud.setState(state)
  }
  setTerrain(terrain: Terrain): void { this.minimap?.dispose(); this.minimap = new Minimap(terrain, this.element); this.attract?.dispose(); this.attract = new AttractMode(terrain, this.element) }
  setAttractCamera(camera: CinematicCamera, bots: () => readonly Vehicle[] = () => []): void { this.attract?.setCamera(camera, bots) }
  startAttract(): void { if (!this.started && !this.inviteOpen) this.attract?.start() }
  stopAttract(): void { this.attract?.stop(); this.lastActivity = performance.now(); this.requestedAttract = false }
  get attracting(): boolean { return this.attract?.active ?? false }
  setMapEntities(entities: readonly MapEntity[]): void { this.minimap?.setEntities(entities) }
  setMapSelf(entity: MapEntity): void { this.minimap?.setSelf(entity) }
  setLoadingMessages(messages: string[]): void { bootLoading?.setMessages(messages) }
  setParamPanel(panel: ParamPanel): void { this.paramPanel = panel }
  showPanel(id: string): void {
    if(id!==this.panels.active)this.audio.cue('click')
    this.lastActivity = performance.now()
    if (id === 'vehicle' && !this.preview) {
      this.preview = new VehiclePreview(this.element.querySelector('.shell-vehicle-preview')!); this.preview.setChoice(this.choice)
    }
    if (id === 'advanced') {
      const panel = this.paramPanel ?? (window as unknown as { syn3h?: { panel?: ParamPanel } }).syn3h?.panel
      panel?.show(this.element.querySelector('.advanced-host')!); this.paramPanel = panel
    } else this.paramPanel?.hide()
    void this.panels.show(id)
  }
  play(): void {
    this.stopAttract()
    if (this.started) { this.closeMenu(); return }
    void this.audio.unlock().then(async () => { await this.audio.ready(); this.audio.play('materialize') }).catch(() => this.toast('Audio is unavailable. You can still play.'))
    try { localStorage.setItem('syn3h.playerName', this.playerName) } catch { /* Playing does not require storage. */ }
    this.started = true; this.nameInput.disabled = true; this.roomInput.disabled = true
    this.element.querySelector<HTMLButtonElement>('.shell-play')!.textContent = 'Return to Game ›'
    this.element.querySelector<HTMLElement>('[data-resume]')!.hidden = false
    for (const input of this.element.querySelectorAll<HTMLInputElement>('.shell-vehicle input')) input.disabled = true
    this.element.querySelector('.vehicle-note')!.textContent = 'Vehicle selection is fixed for this session.'
    this.closeMenu(); this.showHelp(false); this.onPlay?.()
  }
  openMenu(panel = 'index'): void {
    if (!this.started) return
    this.menuVisible = true; this.overlay.hidden = false; this.overlay.inert = false; this.starfield.enabled = true
    this.game.input.suspended = true; this.game.input.mouseFire = false; this.game.input.poll(); this.touch.enabled = false
    this.audio.enabled = false; this.audio.setLobbyVisible(true); this.element.classList.remove('is-playing'); this.showPanel(panel)
  }
  closeMenu(): void {
    if (!this.started) return
    this.menuVisible = false; this.overlay.hidden = true; this.overlay.inert = true; this.starfield.enabled = false
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
    const url = new URL(inviteUrl(location.origin, this.room))
    try { await navigator.clipboard.writeText(url.href); this.toast('Invite link copied.'); this.invite.element.querySelector('.join-copy')!.textContent = 'Copied' }
    catch { this.element.querySelector('.shell-message')!.textContent = `Invite link: ${url.href}` }
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
    hint.classList.toggle('is-full', full)
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
    this.element.querySelector<HTMLElement>('.spawn-help')!.hidden = true
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
    for (const input of this.element.querySelectorAll<HTMLInputElement | HTMLButtonElement>('.world-controls input, .world-controls button')) input.disabled = !editable
    for (const note of this.element.querySelectorAll<HTMLElement>('.world-lock-note')) note.hidden = editable
    this.paramPanel?.setWorldEditable(editable)
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
    this.abort.abort(); clearTimeout(this.toastTimer); clearTimeout(this.helpTimer); this.helpInput?.abort(); this.preview?.dispose(); this.attract?.dispose(); this.matchHud.dispose(); this.invite.dispose(); this.minimap?.dispose(); this.panels.dispose(); this.starfield.dispose(); this.touch.dispose(); this.element.remove()
    document.body.classList.remove('has-game-shell'); this.game.input.suspended = this.previousSuspended; this.game.input.mouseFire = false
  }
}

/** Call after creating the player, before constructing ParamPanel. */
export function initGameShell(game: Game, player: Vehicle, terrain: Terrain): { shell: Shell; audio: GameAudio; setPlayer: (player: Vehicle) => void; dispose: () => void } {
  const audio = new GameAudio(game.camera), shell = game.add(new Shell(game, audio))
  shell.setVehicleKind(player.kind); shell.setTerrain(terrain); audio.setPlayer(player,terrain)
  let activePlayer = player
  const bridge = game.add({ update() {
    const v = activePlayer.body.linvel(), p = activePlayer.body.translation(), speed = Math.hypot(v.x, v.y, v.z)
    shell.setSpeed(speed)
    const q = activePlayer.body.rotation()
    const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y))
    shell.setMapSelf({ x: p.x, z: p.z, heading, color: activePlayer.colors.body, self: true })
    audio.motion = { speed, throttle: activePlayer.kind === 'jet' ? activePlayer.input.z : activePlayer.input.y, airborne: p.y - terrain.heightAt(p.x, p.z) > 2 }
  } })
  game.add(audio)
  return { shell, audio, setPlayer(next) { activePlayer = next; audio.setPlayer(next,terrain); shell.setVehicleKind(next.kind) }, dispose() { game.remove(bridge); game.remove(shell); game.remove(audio) } }
}
