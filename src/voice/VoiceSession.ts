export type VoiceSignal =
  | { type: 'offer' | 'answer'; sdp: string }
  | ({ type: 'candidate'; candidate: string } & RTCIceCandidateInit)

export interface VoiceState {
  readonly status: 'off' | 'requesting' | 'live' | 'error'
  readonly muted: boolean
  readonly speaking: boolean
}

export interface VoiceSessionOptions {
  localId: number
  sendSignal(peerId: number, signal: VoiceSignal): void
  onRemoteAudio(peerId: number, stream: MediaStream | null): void
  onState(state: VoiceState): void
  audioContext?: AudioContext
}

interface Peer {
  connection: RTCPeerConnection
  signals: Promise<void>
  candidates: RTCIceCandidateInit[]
  hasAudio: boolean
}

const stun = 'stun:stun.l.google.com:19302'
const maxPendingCandidates = 64

/** One session per room connection. Only enable() requests microphone access. */
export class VoiceSession {
  private current: VoiceState = { status: 'off', muted: false, speaking: false }
  private disposed = false
  private generation = 0
  private pending?: Promise<boolean>
  private stream?: MediaStream
  private peerIds = new Set<number>()
  private peers = new Map<number, Peer>()
  private stopMeter?: () => void

  constructor(private readonly options: VoiceSessionOptions) {}

  get state(): VoiceState { return this.current }

  enable(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    if (this.stream) return Promise.resolve(true)
    if (this.pending) return this.pending

    const generation = ++this.generation
    const request = Promise.resolve().then(() => this.capture(generation))
    this.pending = request
    this.update({ status: 'requesting' })
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
    if (this.disposed) return
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
    if (!this.stream || !this.peerIds.has(id)) return Promise.resolve()
    const initiator = this.options.localId < id
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
      if (typeof RTCPeerConnection !== 'function') throw new Error('WebRTC unavailable')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      if (generation !== this.generation) {
        for (const track of stream.getTracks()) track.stop()
        return false
      }

      this.stream = stream
      const tracks = stream.getAudioTracks()
      if (!tracks.some(track => track.readyState === 'live')) throw new Error('Microphone unavailable')
      for (const track of tracks) {
        track.enabled = !this.current.muted
        track.addEventListener('ended', () => {
          if (this.stream === stream && tracks.every(track => track.readyState === 'ended')) {
            this.reset('error')
          }
        }, { once: true })
      }

      this.pending = undefined
      this.startMeter(stream)
      this.update({ status: 'live' })
      this.syncPeers()
      return generation === this.generation
    } catch {
      if (generation === this.generation) this.reset('error')
      return false
    }
  }

  private reset(status: 'off' | 'error'): void {
    ++this.generation
    this.pending = undefined
    const stream = this.stream
    this.stream = undefined
    this.peerIds.clear()
    for (const track of stream?.getTracks() ?? []) track.stop()
    this.stopMeter?.()
    this.stopMeter = undefined
    for (const id of this.peers.keys()) this.closePeer(id)
    this.update({ status, speaking: false })
  }

  private syncPeers(): void {
    for (const id of this.peers.keys()) {
      if (!this.peerIds.has(id)) this.closePeer(id)
    }
    if (!this.stream) return
    for (const id of this.peerIds) {
      // The lower room ID makes the offer, so simultaneous readiness cannot cause glare.
      if (this.options.localId >= id || this.peers.has(id)) continue
      const peer = this.createPeer(id)
      if (peer) void this.queue(id, peer, () => this.sendDescription(id, peer, 'offer'))
    }
  }

  private createPeer(id: number): Peer | undefined {
    const stream = this.stream
    if (!stream) return
    let connection: RTCPeerConnection | undefined
    try {
      connection = new RTCPeerConnection({ iceServers: [{ urls: stun }] })
      for (const track of stream.getAudioTracks()) connection.addTrack(track, stream)
    } catch {
      connection?.close()
      return
    }

    const peer: Peer = { connection, signals: Promise.resolve(), candidates: [], hasAudio: false }
    this.peers.set(id, peer)
    connection.onicecandidate = ({ candidate }) => {
      if (this.isCurrent(id, peer) && candidate) {
        const { candidate: value, sdpMid, sdpMLineIndex, usernameFragment } = candidate
        this.options.sendSignal(id, { type: 'candidate', candidate: value, sdpMid, sdpMLineIndex, usernameFragment })
      }
    }
    connection.ontrack = ({ track }) => {
      if (!this.isCurrent(id, peer) || track.kind !== 'audio') return
      peer.hasAudio = true
      this.options.onRemoteAudio(id, new MediaStream([track]))
    }
    connection.onconnectionstatechange = () => {
      if (this.isCurrent(id, peer) && peer.connection.connectionState === 'failed') this.closePeer(id)
    }
    return peer
  }

  private queue(id: number, peer: Peer, operation: () => Promise<void>): Promise<void> {
    peer.signals = peer.signals.then(async () => {
      if (this.isCurrent(id, peer)) await operation()
    }).catch(() => {
      if (this.isCurrent(id, peer)) this.closePeer(id)
    })
    return peer.signals
  }

  private async sendDescription(id: number, peer: Peer, type: 'offer' | 'answer'): Promise<void> {
    const { connection } = peer
    const description = type === 'offer' ? await connection.createOffer() : await connection.createAnswer()
    if (!this.isCurrent(id, peer)) return
    await connection.setLocalDescription(description)
    if (this.isCurrent(id, peer) && description.sdp) {
      this.options.sendSignal(id, { type, sdp: description.sdp })
    }
  }

  private async addCandidate(connection: RTCPeerConnection, candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await connection.addIceCandidate(candidate)
    } catch {
      // A stale or invalid candidate must not tear down the rest of the negotiation.
    }
  }

  private isCurrent(id: number, peer: Peer): boolean {
    return !!this.stream && this.peers.get(id) === peer
  }

  private closePeer(id: number): void {
    const peer = this.peers.get(id)
    if (!peer) return
    this.peers.delete(id)
    const { connection } = peer
    connection.onicecandidate = null
    connection.ontrack = null
    connection.onconnectionstatechange = null
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
        next.speaking === this.current.speaking) return
    this.current = next
    this.options.onState(next)
  }
}
