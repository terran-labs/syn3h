import { beginMicrophoneSession } from '../audio/audioSession'
import { failureName, type CaptureFailure } from './captureFailure'
import type { VoiceSignal } from '../../shared/voice'

export interface VoiceState {
  readonly status: 'off' | 'requesting' | 'live' | 'error'
  readonly failure?: CaptureFailure
  readonly muted: boolean
  readonly speaking: boolean
}

export interface VoiceSessionOptions {
  echoCancellation?: boolean
  listenOnly?: boolean
  localId: number
  sendSignal(peerId: number, signal: VoiceSignal): void
  onRemoteAudio(peerId: number, stream: MediaStream | null): void
  sendReadiness?(message: { type: 'voice-ready'; enabled: false }): void
  onState(state: VoiceState): void
  audioContext?: AudioContext
}

export interface VoiceMicSettings {
  echoCancellation?: boolean | 'all' | 'remote-only'
  noiseSuppression?: boolean
  autoGainControl?: boolean
  sampleRate?: number
}

type CandidateType = 'host' | 'srflx' | 'prflx' | 'relay'

export interface VoiceCandidateTypes {
  local?: CandidateType
  remote?: CandidateType
}

function candidateType(value: unknown): CandidateType | undefined {
  if (value === 'host' || value === 'srflx' || value === 'prflx' || value === 'relay') return value
}

interface Peer {
  connection: RTCPeerConnection
  signals: Promise<void>
  candidates: RTCIceCandidateInit[]
  hasAudio: boolean
}

type PeerRole = 'offerer' | 'answerer'
type PeerFailure = 'creation' | 'negotiation' | 'connection'

const connectionStates = ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed']
const iceStates = ['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed']
const signalingStates = ['stable', 'have-local-offer', 'have-remote-offer', 'have-local-pranswer', 'have-remote-pranswer', 'closed']
const gatheringStates = ['new', 'gathering', 'complete']
const directions = ['sendrecv', 'sendonly', 'recvonly', 'inactive', 'stopped']

function label(value: string | null | undefined, allowed: readonly string[]): string {
  return value && allowed.includes(value) ? value : 'unavailable'
}

function describePeer(role: PeerRole, connection?: RTCPeerConnection): string {
  if (!connection) return role
  const audio = connection.getTransceivers?.().find(transceiver => transceiver.receiver.track.kind === 'audio')
  const requested = label(audio?.direction, directions)
  const negotiated = label(audio?.currentDirection, directions)
  return [
    role,
    `connection ${label(connection.connectionState, connectionStates)}`,
    `ICE ${label(connection.iceConnectionState, iceStates)}`,
    `signaling ${label(connection.signalingState, signalingStates)}`,
    `gathering ${label(connection.iceGatheringState, gatheringStates)}`,
    `audio ${requested} · negotiated ${negotiated}`,
  ].join(' · ')
}

const stun = 'stun:stun.cloudflare.com:3478'
const maxPendingCandidates = 64

/** One session per room connection. Only enable() requests microphone access. */
export class VoiceSession {
  private current: VoiceState = { status: 'off', muted: false, speaking: false }
  private disposed = false
  private generation = 0
  private pending?: Promise<boolean>
  private active = false
  private stream?: MediaStream
  private peerIds = new Set<number>()
  private peers = new Map<number, Peer>()
  private releaseAudioSession?: () => void
  private stopMeter?: () => void
  private readonly sent = { offer: 0, answer: 0, candidate: 0 }
  private readonly received = { offer: 0, answer: 0, candidate: 0 }
  private readonly failures = { creation: 0, negotiation: 0, connection: 0 }
  private lastFailure?: string

  constructor(private readonly options: VoiceSessionOptions) {}

  get state(): VoiceState { return this.current }

  connectionSummary(): string {
    let offerers = 0
    for (const id of this.peerIds) if (this.role(id) === 'offerer') offerers++
    const flow = ({ offer, answer, candidate }: typeof this.sent) =>
      `offers ${offer} · answers ${answer} · ICE ${candidate}`
    return [
      `Ready others ${this.peerIds.size} · offerer ${offerers} · answerer ${this.peerIds.size - offerers}`,
      `Sent ${flow(this.sent)}`,
      `Received ${flow(this.received)}`,
      `Failures · creation ${this.failures.creation} · negotiation ${this.failures.negotiation} · connection ${this.failures.connection}`,
      ...[...this.peers].map(([id, peer]) => describePeer(this.role(id), peer.connection)),
      ...(this.lastFailure ? [this.lastFailure] : []),
    ].join('\n')
  }

  micSettings(): VoiceMicSettings | undefined {
    const settings = this.stream?.getAudioTracks().find(track => track.readyState === 'live')?.getSettings?.()
    if (!settings) return
    const { noiseSuppression, autoGainControl, sampleRate } = settings
    const echoCancellation: unknown = settings.echoCancellation
    return {
      echoCancellation: typeof echoCancellation === 'boolean' ||
        echoCancellation === 'all' || echoCancellation === 'remote-only' ? echoCancellation : undefined,
      noiseSuppression: typeof noiseSuppression === 'boolean' ? noiseSuppression : undefined,
      autoGainControl: typeof autoGainControl === 'boolean' ? autoGainControl : undefined,
      sampleRate: typeof sampleRate === 'number' && Number.isFinite(sampleRate) && sampleRate > 0
        ? sampleRate : undefined,
    }
  }

  async selectedCandidateTypes(): Promise<VoiceCandidateTypes[]> {
    const pairs = await Promise.all([...this.peers].map(async ([id, peer]) => {
      try {
        const stats = await peer.connection.getStats()
        if (!this.isCurrent(id, peer)) return []
        const selected: VoiceCandidateTypes[] = []
        const addPair = (pair: { localCandidateId: string; remoteCandidateId: string }) => {
          const local = candidateType(stats.get(pair.localCandidateId)?.candidateType)
          const remote = candidateType(stats.get(pair.remoteCandidateId)?.candidateType)
          if (local || remote) selected.push({ local, remote })
        }
        stats.forEach(report => {
          if (report.type !== 'transport' || !report.selectedCandidatePairId) return
          const pair = stats.get(report.selectedCandidatePairId)
          if (pair?.type === 'candidate-pair') addPair(pair)
        })
        if (!selected.length) {
          // Older implementations can mark the selected pair directly.
          stats.forEach(pair => {
            if (pair.type === 'candidate-pair' && pair.selected === true) addPair(pair)
          })
        }
        return selected
      } catch {
        return []
      }
    }))
    return pairs.flat()
  }

  enable(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    if (this.active) return Promise.resolve(true)
    if (this.pending) return this.pending

    const generation = ++this.generation
    if (this.options.listenOnly) {
      if (typeof RTCPeerConnection !== 'function') return Promise.resolve(this.fail('WebRTC unavailable'))
      return Promise.resolve(this.goLive(generation))
    }
    this.update({ status: 'requesting', failure: undefined })
    // Invoke capture in the click handler's stack, before any promise continuation.
    const request = this.capture(generation)
    if (generation === this.generation) this.pending = request
    return request
  }

  disable(): void {
    this.reset('off')
  }

  dispose(): void {
    this.disposed = true
    this.disable()
  }

  setMuted(muted: boolean): void {
    if (this.disposed || this.options.listenOnly) return
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !muted
    this.update({ muted, speaking: muted ? false : this.current.speaking })
  }

  /** Supply the room's current set of eligible, opted-in remote players. */
  setPeers(ids: Iterable<number>): void {
    if (this.disposed) return
    this.peerIds = new Set(ids)
    this.peerIds.delete(this.options.localId)
    this.syncPeers()
  }

  receiveSignal(id: number, signal: VoiceSignal): Promise<void> {
    if (!this.active || !this.peerIds.has(id)) return Promise.resolve()
    this.received[signal.type]++
    const initiator = this.role(id) === 'offerer'
    if (signal.type === (initiator ? 'offer' : 'answer')) return Promise.resolve()
    const peer = this.peers.get(id) ?? (!initiator ? this.createPeer(id) : undefined)
    if (!peer) return Promise.resolve()

    return this.queue(id, peer, async () => {
      const { connection } = peer
      if (signal.type === 'candidate') {
        const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = signal
        const init = { candidate, sdpMid, sdpMLineIndex, usernameFragment }
        if (connection.remoteDescription) await this.addCandidate(connection, init)
        else if (peer.candidates.length < maxPendingCandidates) peer.candidates.push(init)
        return
      }

      const expectedState = initiator ? 'have-local-offer' : 'stable'
      if (connection.remoteDescription || connection.signalingState !== expectedState) return
      await connection.setRemoteDescription({ type: signal.type, sdp: signal.sdp })
      if (!this.isCurrent(id, peer)) return
      if (signal.type === 'offer' && this.options.listenOnly) {
        // The offer associates an audio transceiver. A separately created one would not answer its m-line.
        for (const transceiver of connection.getTransceivers()) {
          if (transceiver.receiver.track.kind === 'audio' && transceiver.direction !== 'stopped') {
            transceiver.direction = 'recvonly'
          }
        }
      }
      for (const candidate of peer.candidates.splice(0)) {
        if (!this.isCurrent(id, peer)) return
        await this.addCandidate(connection, candidate)
      }
      if (signal.type === 'offer' && this.isCurrent(id, peer)) {
        await this.sendDescription(id, peer, 'answer')
      }
    })
  }

  private async capture(generation: number): Promise<boolean> {
    if (generation !== this.generation) return false
    try {
      if (typeof navigator.mediaDevices?.getUserMedia !== 'function') return this.fail('Capture API unavailable')
      if (typeof RTCPeerConnection !== 'function') return this.fail('WebRTC unavailable')
      this.releaseAudioSession = beginMicrophoneSession()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: this.options.echoCancellation ?? true, noiseSuppression: true, autoGainControl: true },
      })
      if (generation !== this.generation) {
        for (const track of stream.getTracks()) track.stop()
        return false
      }

      this.stream = stream
      const tracks = stream.getAudioTracks()
      if (!tracks.some(track => track.readyState === 'live')) return this.fail('No live track')
      for (const track of tracks) {
        track.enabled = !this.current.muted
        track.addEventListener('ended', () => {
          if (this.stream === stream && tracks.every(track => track.readyState === 'ended')) {
            this.fail('Track ended')
          }
        }, { once: true })
      }

      this.startMeter(stream)
      return this.goLive(generation)
    } catch (error) {
      if (generation === this.generation) this.fail(failureName(error))
      return false
    }
  }

  private goLive(generation: number): boolean {
    this.pending = undefined
    this.active = true
    this.update({ status: 'live', failure: undefined })
    this.syncPeers()
    return generation === this.generation
  }

  private fail(failure: CaptureFailure): false {
    this.reset('error', failure)
    this.options.sendReadiness?.({ type: 'voice-ready', enabled: false })
    return false
  }

  private reset(status: 'off' | 'error', failure?: CaptureFailure): void {
    ++this.generation
    this.active = false
    this.pending = undefined
    const stream = this.stream
    this.stream = undefined
    this.peerIds.clear()
    for (const track of stream?.getTracks() ?? []) track.stop()
    this.releaseAudioSession?.()
    this.releaseAudioSession = undefined
    this.stopMeter?.()
    this.stopMeter = undefined
    for (const id of this.peers.keys()) this.closePeer(id)
    this.update({ status, failure, speaking: false })
  }

  private syncPeers(): void {
    for (const id of this.peers.keys()) {
      if (!this.peerIds.has(id)) this.closePeer(id)
    }
    if (!this.active) return
    for (const id of this.peerIds) {
      // The lower room ID makes the offer, so simultaneous readiness cannot cause glare.
      if (this.role(id) !== 'offerer' || this.peers.has(id)) continue
      const peer = this.createPeer(id)
      if (peer) void this.queue(id, peer, () => this.sendDescription(id, peer, 'offer'))
    }
  }

  private createPeer(id: number): Peer | undefined {
    let connection: RTCPeerConnection | undefined
    try {
      connection = new RTCPeerConnection({ iceServers: [{ urls: stun }] })
      const stream = this.stream
      if (stream) {
        for (const track of stream.getAudioTracks()) connection.addTrack(track, stream)
      } else if (this.role(id) === 'offerer') {
        connection.addTransceiver('audio', { direction: 'recvonly' })
      }
    } catch {
      this.recordFailure('creation', id, connection)
      connection?.close()
      return
    }

    const peer: Peer = { connection, signals: Promise.resolve(), candidates: [], hasAudio: false }
    this.peers.set(id, peer)
    connection.onicecandidate = ({ candidate }) => {
      if (this.isCurrent(id, peer) && candidate) {
        const { candidate: value, sdpMid, sdpMLineIndex, usernameFragment } = candidate
        this.send(id, { type: 'candidate', candidate: value, sdpMid, sdpMLineIndex, usernameFragment })
      }
    }
    connection.ontrack = ({ track }) => {
      if (!this.isCurrent(id, peer) || track.kind !== 'audio') return
      peer.hasAudio = true
      this.options.onRemoteAudio(id, new MediaStream([track]))
    }
    const checkConnection = () => {
      if (!this.isCurrent(id, peer)) return
      if (peer.connection.connectionState === 'failed' || peer.connection.iceConnectionState === 'failed') {
        this.recordFailure('connection', id, peer.connection)
        this.closePeer(id)
      }
    }
    connection.onconnectionstatechange = checkConnection
    connection.oniceconnectionstatechange = checkConnection
    return peer
  }

  private queue(id: number, peer: Peer, operation: () => Promise<void>): Promise<void> {
    peer.signals = peer.signals.then(async () => {
      if (this.isCurrent(id, peer)) await operation()
    }).catch(() => {
      if (this.isCurrent(id, peer)) {
        this.recordFailure('negotiation', id, peer.connection)
        this.closePeer(id)
      }
    })
    return peer.signals
  }

  private async sendDescription(id: number, peer: Peer, type: 'offer' | 'answer'): Promise<void> {
    const { connection } = peer
    const description = type === 'offer' ? await connection.createOffer() : await connection.createAnswer()
    if (!this.isCurrent(id, peer)) return
    if (!description.sdp) throw new Error('Missing local description')
    await connection.setLocalDescription(description)
    if (this.isCurrent(id, peer)) this.send(id, { type, sdp: description.sdp })
  }

  private send(id: number, signal: VoiceSignal): void {
    this.options.sendSignal(id, signal)
    this.sent[signal.type]++
  }

  private async addCandidate(connection: RTCPeerConnection, candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await connection.addIceCandidate(candidate)
    } catch {
      // A stale or invalid candidate must not tear down the rest of the negotiation.
    }
  }

  private isCurrent(id: number, peer: Peer): boolean {
    return this.active && this.peers.get(id) === peer
  }

  private role(id: number): PeerRole {
    return this.options.localId < id ? 'offerer' : 'answerer'
  }

  private recordFailure(kind: PeerFailure, id: number, connection?: RTCPeerConnection): void {
    this.failures[kind]++
    this.lastFailure = `Last failure · ${kind} · ${describePeer(this.role(id), connection)}`
  }

  private closePeer(id: number): void {
    const peer = this.peers.get(id)
    if (!peer) return
    this.peers.delete(id)
    const { connection } = peer
    connection.onicecandidate = null
    connection.ontrack = null
    connection.onconnectionstatechange = null
    connection.oniceconnectionstatechange = null
    connection.close()
    if (peer.hasAudio) this.options.onRemoteAudio(id, null)
  }

  private startMeter(stream: MediaStream): void {
    const shared = this.options.audioContext
    let context: AudioContext | undefined
    let source: MediaStreamAudioSourceNode | undefined
    try {
      context = shared ?? new AudioContext()
      source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      // Leave the analyser disconnected from the speakers. This is only a local indicator.
      source.connect(analyser)
      if (!shared && context.state === 'suspended') void context.resume().catch(() => {})
      const samples = new Float32Array(analyser.fftSize)
      let lastSpeech = -Infinity
      const timer = setInterval(() => {
        if (this.current.muted) {
          lastSpeech = -Infinity
          return
        }
        analyser.getFloatTimeDomainData(samples)
        let energy = 0
        for (const sample of samples) energy += sample * sample
        const now = performance.now()
        if (Math.sqrt(energy / samples.length) >= 0.025) lastSpeech = now
        const speaking = lastSpeech === now || (this.current.speaking && now - lastSpeech < 200)
        if (speaking !== this.current.speaking) this.update({ speaking })
      }, 50)
      this.stopMeter = () => {
        clearInterval(timer)
        source?.disconnect()
        if (!shared) void context?.close().catch(() => {})
      }
    } catch {
      source?.disconnect()
      if (!shared) void context?.close().catch(() => {})
    }
  }

  private update(patch: Partial<VoiceState>): void {
    const next = { ...this.current, ...patch }
    if (next.status === this.current.status && next.muted === this.current.muted &&
        next.speaking === this.current.speaking && next.failure === this.current.failure) return
    this.current = next
    this.options.onState(next)
  }
}
