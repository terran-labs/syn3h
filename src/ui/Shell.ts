import type { Game, System } from '../core/Game'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Terrain } from '../world/Terrain'
import { GameAudio, type MusicTrack } from '../audio'
import { TouchControls } from './TouchControls'
import './shell.css'

export class Shell implements System {
  readonly element = document.createElement('div')
  readonly room = new URL(location.href).searchParams.get('room')?.trim().slice(0, 64) || 'lobby'
  onPlay?: () => void
  private readonly abort = new AbortController()
  private readonly nameInput: HTMLInputElement
  private readonly overlay: HTMLElement
  private readonly speed: HTMLElement
  private readonly status: HTMLElement
  private readonly mute: HTMLButtonElement
  private started = false
  private readonly previousSuspended: boolean
  readonly touch: TouchControls

  constructor(private readonly game: Game, readonly audio: GameAudio) {
    this.previousSuspended = game.input.suspended
    game.input.suspended = true
    this.element.className = 'syn3h-shell'
    this.element.innerHTML = `<section class="shell-start" aria-labelledby="shell-title"><div class="shell-card">
      <img class="shell-logo" src="/brand/syn3h.png" alt="Syn3h" width="512" height="256">
      <div class="shell-origin"><img src="/brand/marsxplr.png" alt="Mars Explorer"><span>BACK ON MARS</span></div>
      <h1 id="shell-title">Take the long way home.</h1>
      <p class="shell-intro">A familiar world. A fresh set of tracks.</p>
      <form class="shell-form"><label for="shell-name">PLAYER NAME</label><input id="shell-name" name="playerName" maxlength="24" autocomplete="nickname" placeholder="Explorer">
      <div class="shell-room"><span>ROOM <strong></strong></span><button class="shell-invite" type="button">Copy invite link</button></div>
      <div class="shell-controls"><span><b>WASD / ↑↓←→</b> Drive</span><span><b>SPACE</b> Wings</span><span><b>SHIFT</b> Brake</span><span><b>L / CLICK</b> Fire</span></div>
      <p class="shell-touch-hint">Left thumb to drive. Right thumb for wings, brake and fire.</p>
      <button class="shell-play" type="submit">PLAY <span aria-hidden="true">↗</span></button></form>
      <p class="shell-message" role="status" aria-live="polite"></p>
    </div></section>
    <div class="shell-hud" hidden><div class="shell-speed"><strong>0</strong><span>MPH</span></div><div class="shell-status" role="status"></div></div>
    <div class="shell-audio"><label for="shell-track">MUSIC</label><select id="shell-track" aria-label="Music track"><option value="SpaceStation">Space Station</option><option>Classic</option><option>Ambient</option><option>Carefree</option></select><button type="button" class="shell-mute" aria-pressed="false">Mute</button></div>`
    document.body.append(this.element)
    document.body.classList.add('has-game-shell')
    this.overlay = this.element.querySelector('.shell-start')!
    this.nameInput = this.element.querySelector('input')!
    this.speed = this.element.querySelector('.shell-speed strong')!
    this.status = this.element.querySelector('.shell-status')!
    this.mute = this.element.querySelector('.shell-mute')!
    const signal = this.abort.signal
    try { this.nameInput.value = localStorage.getItem('syn3h.playerName') || '' } catch { /* Storage can be disabled in private browsing. */ }
    this.element.querySelector('.shell-room strong')!.textContent = this.room
    this.element.querySelector('form')!.addEventListener('submit', (event) => { event.preventDefault(); this.play() }, { signal })
    this.element.querySelector('.shell-invite')!.addEventListener('click', () => { void this.copyInvite() }, { signal })
    this.mute.addEventListener('click', () => { audio.setMuted(!audio.isMuted); this.update() }, { signal })
    this.element.querySelector('select')!.addEventListener('change', (event) => {
      void audio.setTrack((event.target as HTMLSelectElement).value as MusicTrack).catch(() => this.message('Music could not start. Try selecting the track again.'))
    }, { signal })
    this.touch = new TouchControls(game.input)
    this.element.classList.toggle('has-touch', this.touch.available)
    game.canvas.addEventListener('pointerdown', (event) => {
      if (!this.started || event.pointerType === 'touch' || event.button !== 0) return
      game.input.mouseFire = true; game.canvas.setPointerCapture(event.pointerId)
    }, { signal })
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      game.canvas.addEventListener(name, () => { game.input.mouseFire = false }, { signal })
    }
    window.addEventListener('blur', () => { game.input.mouseFire = false }, { signal })
  }
  get playerName(): string { return this.nameInput.value.trim().slice(0, 24) || 'Explorer' }
  get playing(): boolean { return this.started }
  play(): void {
    if (this.started) return
    // Unlock immediately in the event handler; loading sounds must not delay joining the room.
    void this.audio.unlock().then(async () => {
      await this.audio.ready(); this.audio.play('materialize')
    }).catch(() => this.message('Audio is unavailable. You can still play.'))
    try { localStorage.setItem('syn3h.playerName', this.playerName) } catch { /* Playing does not require storage. */ }
    this.started = true; this.overlay.hidden = true
    this.element.querySelector<HTMLElement>('.shell-hud')!.hidden = false
    this.game.input.suspended = false; this.touch.enabled = true; this.audio.enabled = true
    this.onPlay?.()
  }
  private message(text: string): void {
    this.element.querySelector('.shell-message')!.textContent = text
    if (this.started) this.setStatus([text])
  }
  private async copyInvite(): Promise<void> {
    const url = new URL(location.href); url.searchParams.set('room', this.room)
    try { await navigator.clipboard.writeText(url.href); this.message('Invite link copied.') }
    catch { this.message(`Invite link: ${url.href}`) }
  }
  setStatus(lines: readonly string[]): void { this.status.textContent = lines.join('\n') }
  setSpeed(metresPerSecond: number): void { this.speed.textContent = String(Math.round(Math.abs(metresPerSecond) * 2.23694)) }
  update(): void {
    this.touch.update()
    this.mute.textContent = this.audio.isMuted ? 'Unmute' : 'Mute'
    this.mute.setAttribute('aria-pressed', String(this.audio.isMuted))
  }
  dispose(): void {
    this.abort.abort(); this.touch.dispose(); this.element.remove()
    document.body.classList.remove('has-game-shell'); this.game.input.suspended = this.previousSuspended; this.game.input.mouseFire = false
  }
}

/** Call after creating the player, before constructing ParamPanel. */
export function initGameShell(game: Game, player: Vehicle, terrain: Terrain): { shell: Shell; audio: GameAudio; dispose: () => void } {
  const audio = new GameAudio(game.camera), shell = game.add(new Shell(game, audio))
  const bridge = game.add({ update() {
    const v = player.body.linvel(), p = player.body.translation()
    const speed = Math.hypot(v.x, v.y, v.z)
    shell.setSpeed(speed)
    // Until vehicles expose wheel contacts, height above terrain is a conservative fallback.
    audio.motion = { speed, throttle: player.input.y, airborne: p.y - terrain.heightAt(p.x, p.z) > 2 }
  } })
  game.add(audio)
  return { shell, audio, dispose() { game.remove(bridge); game.remove(shell); game.remove(audio) } }
}
