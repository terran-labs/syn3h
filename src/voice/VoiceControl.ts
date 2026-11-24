import './voice.css'
import type { ClientMessage, ServerMessage } from '../../shared/protocol'
import { params } from '../../shared/params'
import { DEFAULT_VOICE_CHANNEL, voiceOn, type VoiceChannel } from '../../shared/voice'
import type { GameAudio, Position } from '../audio'
import { VoiceSession } from './VoiceSession'
import { describeFailure, failureName } from './captureFailure'
import { VoiceReadout } from './VoiceReadout'
import { masterVolume, muted } from '../audio/params'

interface Host {
  elementVoice: boolean
  listenOnly: boolean
  name(id: number): string
  otherHumans(): number
  echoCancellation: boolean
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
  private readonly channels = document.createElement('div')
  private readonly roster = document.createElement('div')
  private channel: VoiceChannel = DEFAULT_VOICE_CHANNEL
  private readonly remoteChannels = new Map<number, VoiceChannel>()
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
    this.readout = new VoiceReadout(() => host.audio.voiceContext, host.listenOnly, host.otherHumans)
    this.panel.setAttribute('role', 'group')
    this.panel.setAttribute('aria-label', 'Room voice')
    this.panel.style.cssText = 'position:fixed;top:max(env(safe-area-inset-top),8px);left:50%;transform:translateX(-50%);z-index:100;width:max-content;max-width:96vw;text-align:center'
    this.panel.hidden = true
    this.panel.append(this.mic, this.leave, this.room, this.channels, this.roster)
    for (const channel of ['spatial', 'global'] as const) {
      const button = document.createElement('button')
      button.textContent = channel === 'spatial' ? 'Spatial voice' : 'Global voice'
      button.dataset.channel = channel
      button.onclick = () => {
        if (this.session?.state.status === 'live') host.send({ type: 'voice-channel', channel })
      }
      this.channels.append(button)
    }
    this.channels.className = 'voice-channels'
    this.roster.style.cssText = 'background:#171c23;color:white;font:13px system-ui;overflow-wrap:anywhere'
    this.disclosure.textContent = 'Direct voice shares your network address with the other caller.'
    this.disclosure.style.cssText = 'display:block;white-space:normal;text-align:center;background:#171c23;color:white;padding:2px 5px'
    this.panel.append(this.disclosure)
    this.readout.element.querySelector('summary')!.textContent = host.elementVoice ? 'Voice diagnostics · element' : 'Voice diagnostics · game mix'
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
      this.session?.dispose()
      const session = this.session = new VoiceSession({
        localId: this.host.id,
        listenOnly: this.host.listenOnly,
        echoCancellation: this.host.echoCancellation,
        audioContext: this.host.audio.voiceContext,
        sendReadiness: message => this.host.send(message),
        sendSignal: (to, signal) => this.host.send({ type: 'voice-signal', to, signal }),
        onRemoteAudio: (id, stream) => {
          this.speakers.get(id)?.dispose()
          this.speakers.delete(id)
          const speaker = stream && (this.host.elementVoice ? this.elementSpeaker(id, stream) : this.host.audio.attachSpeech(stream))
          if (speaker) this.speakers.set(id, speaker)
          this.render()
        },
        onState: state => {
          if (state.status === 'error') {
            this.peers.clear()
            this.error = describeFailure(state.failure ?? 'UnknownError')
            this.readout.setFailure(this.error)
          }
          this.render()
        },
      })
      this.readout.beforeCapture()
      if (await session.enable() && epoch === this.epoch) {
        this.readout.afterCapture(session)
        try {
          await this.host.audio.unlock()
        } catch (error) {
          if (epoch !== this.epoch || session.state.status !== 'live') return
          this.error = `Game audio unavailable (${failureName(error)})`
          this.readout.setFailure(this.error)
          this.stop()
          return
        }
        if (epoch !== this.epoch || session.state.status !== 'live') return
        if (!this.host.audio.voiceContext) {
          this.error = describeFailure('Game audio unavailable')
          this.readout.setFailure(this.error)
          this.stop()
          return
        }
        this.host.send({ type: 'voice-ready', enabled: true })
      }
    } catch (error) {
      if (epoch !== this.epoch) return
      this.error = describeFailure(failureName(error))
      this.readout.setFailure(this.error)
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
      else {
        this.peers.delete(msg.from)
        this.remoteChannels.delete(msg.from)
      }
      this.session.setPeers(this.peers)
      this.render()
    } else if (msg.type === 'voice-channel') {
      if (msg.from === this.host.id) this.channel = msg.channel
      else if (this.peers.has(msg.from)) this.remoteChannels.set(msg.from, msg.channel)
      this.positionSpeakers()
      this.render()
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
      speaker.position(this.host.position(id), this.remoteChannels.get(id), this.host.muted(id))
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
    let label = this.host.listenOnly ? 'Listen only' : 'Turn voice on'
    if (!voiceOn.value) label = 'Room voice off'
    else if (s?.status === 'live') {
      if (this.host.listenOnly) label = 'Listening · Mic off'
      else if (s.muted) label = 'Mic muted · Unmute'
      else label = s.speaking ? 'Speaking · Mute' : 'Mic live · Mute'
    } else if (this.error) label = this.error
    else if (this.starting) label = this.host.listenOnly ? 'Joining…' : 'Opening mic…'
    if (this.mic.textContent !== label) this.mic.textContent = label
    this.mic.disabled = !voiceOn.value || this.starting || (this.host.listenOnly && s?.status === 'live')
    this.channels.hidden = s?.status !== 'live' || this.host.listenOnly
    for (const button of this.channels.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.channel === this.channel))
    }
    this.roster.textContent = [...this.speakers.keys()].map(id =>
      this.host.name(id) + ' · ' + (this.remoteChannels.get(id) === 'global' ? 'Global' : 'Spatial')
    ).join(' / ')
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
    if (participating) this.readout.afterLeave()
    this.session = undefined
    this.leave.textContent = 'Leave voice'
    this.peers.clear()
    this.remoteChannels.clear()
    this.channel = DEFAULT_VOICE_CHANNEL
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
