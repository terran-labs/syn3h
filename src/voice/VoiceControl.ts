import type { ClientMessage, ServerMessage } from '../../shared/protocol'
import { params } from '../../shared/params'
import { voiceOn } from '../../shared/voice'
import type { GameAudio, Position } from '../audio'
import { VoiceSession } from './VoiceSession'
import { VoiceReadout } from './VoiceReadout'
import { masterVolume, muted } from '../audio/params'

interface Host {
  elementVoice: boolean
  id: number
  audio: Pick<GameAudio, 'attachSpeech' | 'voiceContext' | 'unlock'>
  send(message: ClientMessage): void
  position(id: number): Position | undefined
  muted(id: number): boolean
  onMuteChange(callback: () => void): () => void
  isHost(): boolean
}

export class VoiceControl {
  private readonly panel = document.createElement('div')
  private readonly mic = document.createElement('button')
  private readonly leave = document.createElement('button')
  private readonly room = document.createElement('button')
  private readonly disclosure = document.createElement('small')
  private session?: VoiceSession
  private readonly peers = new Set<number>()
  private readonly speakers = new Map<number, NonNullable<ReturnType<GameAudio['attachSpeech']>>>()
  private active = false
  private starting = false
  private epoch = 0
  private lastHost?: boolean
  private lastAllowed?: boolean
  private error = ''
  private readonly unsubscribe: () => void
  private readonly pageExit = () => this.stop()
  private readonly readout: VoiceReadout

  constructor(private readonly host: Host) {
    this.readout = new VoiceReadout(() => host.audio.voiceContext)
    this.panel.setAttribute('role', 'group')
    this.panel.setAttribute('aria-label', 'Room voice')
    this.panel.style.cssText = 'position:fixed;top:max(env(safe-area-inset-top),8px);left:50%;transform:translateX(-50%);z-index:100;width:max-content;max-width:96vw;text-align:center'
    this.panel.hidden = true
    this.panel.append(this.mic, this.leave, this.room)
    this.disclosure.textContent = 'Direct voice shares your network address with the other caller.'
    this.disclosure.style.cssText = 'display:block;white-space:normal;text-align:center;background:#171c23;color:white;padding:2px 5px'
    this.panel.append(this.disclosure)
    this.readout.element.querySelector('summary')!.textContent = host.elementVoice ? 'Voice diagnostics · element' : 'Voice diagnostics · spatial'
    this.panel.append(this.readout.element)
    this.leave.textContent = 'Leave voice'
    this.leave.onclick = () => this.stop()
    this.room.onclick = () => { if (host.isHost()) params.set(voiceOn.def.id, !voiceOn.value) }
    this.mic.onclick = () => {
      if (this.session?.state.status === 'live') this.session.setMuted(!this.session.state.muted)
      else void this.start()
    }
    document.body.append(this.panel)
    this.unsubscribe = host.onMuteChange(() => this.positionSpeakers())
    window.addEventListener('pagehide', this.pageExit)
  }

  private async start() {
    if (!this.active || !voiceOn.value || this.starting) return
    const epoch = ++this.epoch
    this.starting = true
    this.error = ''
    this.mic.disabled = true
    try {
      await this.host.audio.unlock()
      if (epoch !== this.epoch) return
      if (!this.host.audio.voiceContext) throw new Error('Game audio unavailable')
      this.session?.dispose()
      const session = this.session = new VoiceSession({
        localId: this.host.id,
        audioContext: this.host.audio.voiceContext,
        sendSignal: (to, signal) => this.host.send({ type: 'voice-signal', to, signal }),
        onRemoteAudio: (id, stream) => {
          this.speakers.get(id)?.dispose()
          this.speakers.delete(id)
          const speaker = stream && (this.host.elementVoice ? this.elementSpeaker(id, stream) : this.host.audio.attachSpeech(stream))
          if (speaker) this.speakers.set(id, speaker)
        },
        onState: state => {
          if (state.status === 'error') {
            this.peers.clear()
            this.host.send({ type: 'voice-ready', enabled: false })
          }
          this.render()
        },
      })
      this.readout.beforeCapture()
      if (await session.enable() && epoch === this.epoch) {
        this.readout.afterCapture(session)
        this.host.send({ type: 'voice-ready', enabled: true })
      }
    } catch {
      if (epoch !== this.epoch) return
      this.error = 'Audio unavailable. Retry voice'
      this.stop()
    } finally {
      if (epoch === this.epoch) { this.starting = false; this.render() }
    }
  }

  receive(msg: ServerMessage) {
    if (!this.session || !this.active || !voiceOn.value) return
    if (msg.type === 'voice-full') {
      this.error = 'Voice is full · Retry'
      this.stop()
    } else if (msg.type === 'voice-ready') {
      if (msg.enabled) this.peers.add(msg.from)
      else this.peers.delete(msg.from)
      this.session.setPeers(this.peers)
    } else if (msg.type === 'voice-signal') void this.session.receiveSignal(msg.from, msg.signal)
  }

  update(driving: boolean) {
    if ((!driving || !voiceOn.value) && (this.session || this.starting)) this.stop()
    this.active = driving
    this.readout.frame(driving, this.session?.state.status === 'live')
    if (this.panel.hidden === driving) this.panel.hidden = !driving
    if (this.lastHost !== this.host.isHost() || this.lastAllowed !== voiceOn.value) this.render()
    this.positionSpeakers()
  }

  private positionSpeakers() {
    for (const [id, speaker] of this.speakers)
      speaker.position(this.host.muted(id) ? undefined : this.host.position(id))
  }

  /** The comparison route plays the original received stream at a fixed distance. */
  private elementSpeaker(id: number, stream: MediaStream) {
    const element = new Audio()
    let disposed = false
    const position = () => {
      const silent = this.host.muted(id) || muted.value || masterVolume.value === 0
      if (element.muted !== silent) element.muted = silent
      const volume = Math.min(1, Math.max(0, masterVolume.value))
      if (element.volume !== volume) element.volume = volume
    }
    position()
    element.srcObject = stream
    void element.play().catch(() => {
      if (!disposed) {
        this.leave.textContent = 'Playback blocked · Leave voice'
      }
    })
    return {
      position,
      dispose() {
        disposed = true
        element.pause()
        element.srcObject = null
      },
    }
  }

  private render() {
    this.lastHost = this.host.isHost()
    this.lastAllowed = voiceOn.value
    const s = this.session?.state
    const label = !voiceOn.value ? 'Room voice off' : s?.status === 'live'
      ? s.muted ? 'Mic muted · Unmute' : s.speaking ? 'Speaking · Mute' : 'Mic live · Mute'
      : this.error || (s?.status === 'error' ? 'Mic unavailable · Retry' : this.starting ? 'Opening mic…' : 'Turn voice on')
    if (this.mic.textContent !== label) this.mic.textContent = label
    this.mic.disabled = !voiceOn.value || this.starting
    this.leave.hidden = !this.session && !this.starting
    this.room.hidden = !this.host.isHost()
    this.disclosure.style.display = voiceOn.value && !this.session ? 'block' : 'none'
    const roomLabel = voiceOn.value ? 'Disable room voice' : 'Allow room voice'
    if (this.room.textContent !== roomLabel) this.room.textContent = roomLabel
  }

  private stop() {
    const participating = !!this.session || this.starting
    this.epoch++
    this.starting = false
    if (participating) this.host.send({ type: 'voice-ready', enabled: false })
    this.session?.dispose()
    this.session = undefined
    this.leave.textContent = 'Leave voice'
    this.peers.clear()
    for (const speaker of this.speakers.values()) speaker.dispose()
    this.speakers.clear()
    this.render()
  }

  dispose() {
    this.active = false
    this.unsubscribe()
    window.removeEventListener('pagehide', this.pageExit)
    this.stop()
    this.readout.dispose()
    this.panel.remove()
  }
}
