import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceSession, type VoiceSessionOptions } from '../../src/voice/VoiceSession'

class Track extends EventTarget {
  kind = 'audio'
  enabled = true
  readyState = 'live'
  stop = vi.fn(() => { this.readyState = 'ended' })
}

class Stream {
  constructor(private tracks: Track[]) {}
  getTracks = () => this.tracks
  getAudioTracks = () => this.tracks
}

class Peer {
  static instances: Peer[] = []

  signalingState = 'stable'
  remoteDescription?: RTCSessionDescriptionInit
  ontrack: ((event: { track: Track }) => void) | null = null
  constructor() { Peer.instances.push(this) }
  addTrack = vi.fn()
  close = vi.fn()
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'offer-sdp' }))
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'answer-sdp' }))
  setLocalDescription = vi.fn(async (sdp: RTCSessionDescriptionInit) => {
    this.signalingState = sdp.type === 'offer' ? 'have-local-offer' : 'stable'
  })
  setRemoteDescription = vi.fn(async (sdp: RTCSessionDescriptionInit) => {
    this.remoteDescription = sdp
    this.signalingState = sdp.type === 'offer' ? 'have-remote-offer' : 'stable'
  })
  addIceCandidate = vi.fn(async (_candidate: RTCIceCandidateInit) => {
    if (!this.remoteDescription) throw new Error('Missing description')
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const offer = { type: 'offer', sdp: 'remote-offer' } as const
const answer = { type: 'answer', sdp: 'remote-answer' } as const
const ice = { type: 'candidate', candidate: 'remote-ice', sdpMid: '0' } as const

describe('VoiceSession', () => {
  let track: Track
  let getUserMedia: ReturnType<typeof vi.fn<() => Promise<Stream>>>
  const sessions: VoiceSession[] = []

  function setup(localId = 1, extra: Partial<VoiceSessionOptions> = {}) {
    const sendSignal = vi.fn()
    const onRemoteAudio = vi.fn()
    const onState = vi.fn()
    const session = new VoiceSession({ localId, sendSignal, onRemoteAudio, onState, ...extra })
    sessions.push(session)
    return { session, sendSignal, onRemoteAudio, onState }
  }

  beforeEach(() => {
    Peer.instances = []
    track = new Track()
    getUserMedia = vi.fn(async () => new Stream([track]))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('RTCPeerConnection', Peer)
    vi.stubGlobal('MediaStream', Stream)
    vi.stubGlobal('AudioContext', undefined)
  })

  afterEach(() => {
    for (const session of sessions.splice(0)) session.dispose()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('ignores peer updates and incoming signals while off', async () => {
    const { session, sendSignal } = setup(2)
    session.setPeers([1, 3])
    await session.receiveSignal(1, offer)
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(Peer.instances).toHaveLength(0)
    expect(sendSignal).not.toHaveBeenCalled()
  })

  it('keeps device identifiers and network addresses out of the screenshot readout', async () => {
    const { session } = setup()
    Object.assign(track, { getSettings: () => ({
      deviceId: 'private device', groupId: 'private group', echoCancellation: true,
      noiseSuppression: false, autoGainControl: true, sampleRate: 48_000,
    }) })
    await session.enable()
    session.setPeers([2])
    Object.assign(Peer.instances[0], { getStats: async () => new Map<string, object>([
      ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
      ['pair', { type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote' }],
      ['local', { type: 'local-candidate', candidateType: 'host', address: '192.0.2.1' }],
      ['remote', { type: 'remote-candidate', candidateType: 'relay', address: '192.0.2.2' }],
    ]) })
    expect(session.micSettings()).toEqual({
      echoCancellation: true, noiseSuppression: false, autoGainControl: true, sampleRate: 48_000,
    })
    expect(await session.selectedCandidateTypes()).toEqual([{ local: 'host', remote: 'relay' }])
  })

  it('stops a late capture after leaving without changing the new voice state', async () => {
    const { session, sendSignal } = setup()
    const first = deferred<Stream>()
    const laterTrack = new Track()
    getUserMedia.mockReturnValueOnce(first.promise).mockResolvedValueOnce(new Stream([laterTrack]))
    session.setPeers([2])
    const request = session.enable()
    expect(session.enable()).toBe(request)
    await Promise.resolve()
    session.disable()
    expect(await session.enable()).toBe(true)
    first.resolve(new Stream([track]))
    expect(await request).toBe(false)
    expect(track.stop).toHaveBeenCalledOnce()
    expect(laterTrack.stop).not.toHaveBeenCalled()
    expect(session.state.status).toBe('live')
    expect(sendSignal).not.toHaveBeenCalled()
    session.dispose()
    expect(laterTrack.stop).toHaveBeenCalledOnce()
    expect(await session.enable()).toBe(false)
  })

  it('retries a denied microphone request only on explicit enable', async () => {
    const { session } = setup()
    getUserMedia.mockRejectedValueOnce(new Error('denied'))
    expect(await session.enable()).toBe(false)
    expect(session.state.status).toBe('error')
    expect(Peer.instances).toHaveLength(0)
    expect(await session.enable()).toBe(true)
  })

  it('mutes the actual sender track, including mute chosen during permission', async () => {
    const { session } = setup()
    session.setPeers([2])
    const request = session.enable()
    session.setMuted(true)
    expect(await request).toBe(true)
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const [peer] = Peer.instances
    expect(peer.addTrack).toHaveBeenCalledWith(track, expect.any(Stream))
    expect(track.enabled).toBe(false)
    session.setMuted(false)
    expect(track.enabled).toBe(true)
  })

  it('answers only an eligible lower ID and buffers early ICE until SDP is applied', async () => {
    const { session, sendSignal } = setup(2)
    await session.enable()
    await session.receiveSignal(1, offer)
    expect(Peer.instances).toHaveLength(0)
    session.setPeers([1])
    expect(Peer.instances).toHaveLength(0)
    await session.receiveSignal(1, ice)
    const [peer] = Peer.instances
    expect(peer.addIceCandidate).not.toHaveBeenCalled()
    await session.receiveSignal(1, offer)
    expect(peer.addIceCandidate).toHaveBeenCalledWith(expect.objectContaining({ candidate: 'remote-ice' }))
    expect(sendSignal).toHaveBeenCalledWith(1, { type: 'answer', sdp: 'answer-sdp' })
  })

  it('makes one offer per eligible peer and detaches remote audio when removed', async () => {
    const { session, sendSignal, onRemoteAudio } = setup()
    await session.enable()
    session.setPeers([1, 2, 2])
    session.setPeers([2])
    await session.receiveSignal(2, answer)
    const [peer] = Peer.instances
    expect(Peer.instances).toHaveLength(1)
    expect(sendSignal).toHaveBeenCalledExactlyOnceWith(2, { type: 'offer', sdp: 'offer-sdp' })
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'remote-answer' })
    const ontrack = peer.ontrack!
    ontrack({ track: new Track() })
    expect(onRemoteAudio).toHaveBeenCalledWith(2, expect.any(Stream))
    session.setPeers([])
    expect(peer.close).toHaveBeenCalledOnce()
    expect(onRemoteAudio).toHaveBeenLastCalledWith(2, null)
    ontrack({ track: new Track() })
    expect(onRemoteAudio).toHaveBeenCalledTimes(2)
  })

  it('does not signal a stale offer after disabling voice', async () => {
    const { session, sendSignal } = setup()
    const pendingOffer = deferred<{ type: string; sdp: string }>()
    await session.enable()
    session.setPeers([2])
    const [peer] = Peer.instances
    peer.createOffer.mockReturnValueOnce(pendingOffer.promise)
    await Promise.resolve()
    expect(peer.createOffer).toHaveBeenCalledOnce()
    session.disable()
    pendingOffer.resolve({ type: 'offer', sdp: 'old-offer' })
    await Promise.resolve()
    expect(peer.setLocalDescription).not.toHaveBeenCalled()
    expect(sendSignal).not.toHaveBeenCalled()
    expect(peer.close).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('leaves live status and closes peers if the microphone disappears', async () => {
    const { session } = setup()
    await session.enable()
    session.setPeers([2])
    const [peer] = Peer.instances
    track.readyState = 'ended'
    track.dispatchEvent(new Event('ended'))
    expect(session.state.status).toBe('error')
    expect(peer.close).toHaveBeenCalledOnce()
  })

  it('shows input activity, clears it on mute, and leaves the shared audio context open', async () => {
    vi.useFakeTimers()
    const disconnect = vi.fn()
    const close = vi.fn()
    const sample = vi.fn((buffer: Float32Array) => { buffer.fill(0.25) })
    const context = {
      createMediaStreamSource: () => ({ connect: vi.fn(), disconnect }),
      createAnalyser: () => ({ fftSize: 32, getFloatTimeDomainData: sample }),
      close,
    } as unknown as AudioContext
    const { session } = setup(1, { audioContext: context })
    await session.enable()
    vi.advanceTimersToNextTimer()
    expect(session.state.speaking).toBe(true)
    session.setMuted(true)
    expect(session.state.speaking).toBe(false)
    vi.advanceTimersToNextTimer()
    expect(sample).toHaveBeenCalledOnce()
    session.disable()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(sample).toHaveBeenCalledOnce()
  })
})
