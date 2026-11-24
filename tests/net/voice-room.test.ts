import { describe, expect, it } from 'vitest'
import { Room, type Peer } from '../../server/room'
import { roomName } from '../../server/util'
import { BOT_ID_BASE, PROTOCOL_VERSION, type ServerMessage } from '../../shared/protocol'
import { DEFAULT_VOICE_CHANNEL, MAX_VOICE_SDP_BYTES, type VoiceChannel, voiceOn } from '../../shared/voice'

class TestPeer implements Peer {
  messages: ServerMessage[] = []
  voiceReady = false
  voiceChannel: VoiceChannel = DEFAULT_VOICE_CHANNEL

  send(data: string | Uint8Array): void {
    if (typeof data === 'string') this.messages.push(JSON.parse(data))
  }

  close(): void {}

  setVoiceState(ready: boolean, channel: VoiceChannel): void {
    this.voiceReady = ready
    this.voiceChannel = channel
  }

  all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.messages.filter((msg) => msg.type === type) as Extract<ServerMessage, { type: T }>[]
  }

  get id(): number {
    return this.all('welcome').at(-1)!.id
  }
}

function fixture(name = 'voice-test') {
  let now = 100_000
  let room = new Room(name, { now: () => now })
  const send = (peer: TestPeer, msg: object) => room.receive(peer, JSON.stringify(msg))
  const join = (resume?: string) => {
    const peer = new TestPeer()
    room.connect(peer)
    send(peer, { type: 'hello', v: PROTOCOL_VERSION, name: 'Driver', params: {}, resume })
    return peer
  }
  const ready = (peer: TestPeer, enabled = true) => send(peer, { type: 'voice-ready', enabled })
  const channel = (peer: TestPeer, channel: unknown) => send(peer, { type: 'voice-channel', channel })
  const ping = (peer: TestPeer) => send(peer, { type: 'ping', t: 0 })
  const signal = { type: 'offer', sdp: 'v=0\r\n' }
  const offer = (from: TestPeer, to: number) => send(from, { type: 'voice-signal', to, signal })
  const switchVoice = (peer: TestPeer, value: boolean) => send(peer, { type: 'param', id: voiceOn.def.id, value })
  const wake = (peers: TestPeer[]) => {
    const previous = room
    room = new Room(name, { now: () => now })
    room.restore(previous.snapshot())
    for (const peer of peers) room.adopt(peer, previous.info(peer)!, previous.token(peer), peer.voiceReady, peer.voiceChannel)
  }
  return { join, send, ready, channel, offer, ping, signal, switchVoice, wake, advance: (ms: number) => { now += ms }, disconnect: (peer: TestPeer) => room.disconnect(peer) }
}

describe('room voice', () => {
  it.each([null, '  LoBbY  ', '!!!'])('rejects voice in a public room reached through %s', (name) => {
    const f = fixture(roomName(name))
    const a = f.join(), b = f.join()
    expect(a.all('welcome')[0].voice).toBeUndefined()
    f.ready(a)
    f.ready(b)
    f.offer(a, b.id)
    f.channel(a, 'global')
    expect(a.voiceChannel).toBe('spatial')
    expect(b.all('voice-channel')).toHaveLength(0)
    expect(b.all('voice-ready')).toHaveLength(0)
    expect(b.all('voice-signal')).toHaveLength(0)
  })

  it('requires mutual opt-in, admits only two players and targets the real pair', () => {
    const f = fixture()
    const a = f.join(), b = f.join(), c = f.join()
    expect(a.all('welcome')[0].voice).toBe(true)
    f.ready(a)
    f.offer(a, b.id)
    f.offer(b, a.id)
    expect(b.all('voice-ready')).toHaveLength(0)
    expect(a.all('voice-signal')).toHaveLength(0)
    expect(b.all('voice-signal')).toHaveLength(0)

    f.ready(b)
    expect(a.all('voice-ready')).toEqual([{ type: 'voice-ready', from: b.id, enabled: true }])
    expect(b.all('voice-ready')).toEqual([{ type: 'voice-ready', from: a.id, enabled: true }])
    f.ready(c)
    expect(c.all('voice-full')).toHaveLength(1)
    f.offer(c, a.id)
    f.offer(a, c.id)
    f.offer(a, BOT_ID_BASE)
    f.offer(a, a.id)
    f.send(a, { type: 'voice-signal', to: b.id, from: c.id, signal: { ...f.signal, extra: 'drop me' } })
    expect(b.all('voice-signal')).toEqual([{ type: 'voice-signal', from: a.id, signal: f.signal }])
    expect(a.all('voice-signal')).toHaveLength(0)
    expect(c.all('voice-signal')).toHaveLength(0)

    f.ready(b, false)
    f.offer(a, b.id)
    expect(b.all('voice-signal')).toHaveLength(1)
    expect(a.all('voice-ready').at(-1)).toEqual({ type: 'voice-ready', from: b.id, enabled: false })
    f.ready(c)
    expect(a.all('voice-ready').at(-1)).toEqual({ type: 'voice-ready', from: c.id, enabled: true })
  })

  it('keeps readiness and signals inside each named room even when player ids match', () => {
    const first = fixture('voice-first'), second = fixture('voice-second')
    const a = first.join(), b = first.join()
    const c = second.join(), d = second.join()
    expect([a.id, b.id]).toEqual([c.id, d.id])

    first.ready(a)
    second.ready(d)
    first.offer(a, d.id)
    second.offer(d, a.id)
    for (const peer of [a, b, c, d]) {
      expect(peer.all('voice-ready')).toHaveLength(0)
      expect(peer.all('voice-signal')).toHaveLength(0)
    }

    first.ready(b)
    second.ready(c)
    first.offer(a, b.id)
    expect(b.all('voice-signal')).toEqual([{ type: 'voice-signal', from: a.id, signal: first.signal }])
    for (const peer of [c, d]) expect(peer.all('voice-signal')).toHaveLength(0)

    first.ready(a, false)
    expect(d.all('voice-ready')).toEqual([{ type: 'voice-ready', from: c.id, enabled: true }])
    second.offer(d, c.id)
    expect(c.all('voice-signal')).toEqual([{ type: 'voice-signal', from: d.id, signal: second.signal }])
    expect(a.all('voice-signal')).toHaveLength(0)
  })

  it('syncs each speaker channel only to opted-in peers and attributes changes to the real sender', () => {
    const f = fixture()
    const a = f.join(), b = f.join(), spectator = f.join()
    const otherRoom = fixture('other-voice-room')
    const c = otherRoom.join(), d = otherRoom.join()
    otherRoom.ready(c)
    otherRoom.ready(d)

    f.channel(b, 'global')
    f.ready(a)
    f.channel(a, 'global')
    expect(b.all('voice-channel')).toHaveLength(0)
    f.ready(b)

    expect(b.messages.filter(msg => msg.type === 'voice-ready' || msg.type === 'voice-channel')).toEqual([
      { type: 'voice-ready', from: a.id, enabled: true },
      { type: 'voice-channel', from: a.id, channel: 'global' },
    ])
    expect(a.all('voice-channel')).toEqual([{ type: 'voice-channel', from: b.id, channel: 'spatial' }])

    f.channel(a, 'GLOBAL')
    f.channel(a, { channel: 'spatial' })
    f.channel(a, 'global')
    f.channel(spectator, 'global')
    expect(b.all('voice-channel')).toHaveLength(1)
    f.send(a, { type: 'voice-channel', channel: 'spatial', from: spectator.id })
    expect(b.all('voice-channel').at(-1)).toEqual({ type: 'voice-channel', from: a.id, channel: 'spatial' })
    expect(spectator.all('voice-channel')).toHaveLength(0)
    expect(c.all('voice-channel')).toEqual([{ type: 'voice-channel', from: d.id, channel: 'spatial' }])
    expect(d.all('voice-channel')).toEqual([{ type: 'voice-channel', from: c.id, channel: 'spatial' }])
  })

  it('bounds repeated speaker channel changes and resets on opt-out or host disable', () => {
    const f = fixture()
    const a = f.join(), b = f.join()
    f.ready(a)
    f.ready(b)
    for (let i = 0; i < 100; i++) f.channel(a, i % 2 ? 'spatial' : 'global')
    expect(b.all('voice-channel').length).toBeGreaterThan(1)
    expect(b.all('voice-channel').length).toBeLessThan(101)
    f.ready(a, false)
    expect(a.voiceChannel).toBe('spatial')

    f.advance(2_000)
    f.ready(a)
    expect(b.all('voice-channel').at(-1)).toEqual({ type: 'voice-channel', from: a.id, channel: 'spatial' })
    f.channel(a, 'global')
    f.channel(b, 'global')
    f.switchVoice(a, false)
    f.channel(b, 'global')
    expect(a.voiceChannel).toBe('spatial')
    expect(b.voiceChannel).toBe('spatial')
  })

  it('drops malformed and oversized signals while accepting browser ICE fields', () => {
    const f = fixture()
    const a = f.join(), b = f.join()
    f.ready(a)
    f.ready(b)
    for (const signal of [
      null,
      { type: 'answer', sdp: 6 },
      { type: 'offer', sdp: 'v=0\r\n' + 'é'.repeat(MAX_VOICE_SDP_BYTES / 2) },
      { type: 'candidate', candidate: 'candidate:test', sdpMLineIndex: -1 },
      { type: 'candidate', candidate: 'candidate:test', usernameFragment: {} },
      { type: 'candidate', candidate: 'candidate:' + 'x'.repeat(2_000) },
    ]) f.send(a, { type: 'voice-signal', to: b.id, signal })
    expect(b.all('voice-signal')).toHaveLength(0)
    const signal = { type: 'candidate', candidate: 'candidate:test', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: null }
    f.send(a, { type: 'voice-signal', to: b.id, signal })
    expect(b.all('voice-signal')).toEqual([{ type: 'voice-signal', from: a.id, signal }])
  })

  it('bounds sustained signaling per sender and accepts opt-out even during a flood', () => {
    const f = fixture()
    const a = f.join(), b = f.join()
    f.ready(a)
    f.ready(b)
    for (let i = 0; i < 100; i++) f.offer(a, b.id)
    const relayed = b.all('voice-signal').length
    expect(relayed).toBeGreaterThan(0)
    expect(relayed).toBeLessThan(100)
    f.advance(1_001)
    f.offer(a, b.id)
    expect(b.all('voice-signal')).toHaveLength(relayed + 1)
    for (let i = 0; i < 100; i++) f.ping(a)
    f.ready(a, false)
    expect(b.all('voice-ready').at(-1)).toEqual({ type: 'voice-ready', from: a.id, enabled: false })
    f.offer(b, a.id)
    expect(a.all('voice-signal')).toHaveLength(0)
  })

  it('preserves host disablement through guest resets and requires fresh opt-in on reenable', () => {
    const f = fixture()
    const a = f.join(), b = f.join()
    f.ready(a)
    f.ready(b)
    f.switchVoice(b, false)
    expect(b.all('param').at(-1)).toMatchObject({ id: voiceOn.def.id, value: true, from: 0 })
    f.offer(a, b.id)
    expect(b.all('voice-signal')).toHaveLength(1)
    f.switchVoice(a, false)
    f.send(b, { type: 'reset' })
    expect(b.all('reset').at(-1)?.params[voiceOn.def.id]).toBe(false)
    f.ready(a)
    f.ready(b)
    f.offer(a, b.id)
    expect(b.all('voice-signal')).toHaveLength(1)
    f.switchVoice(a, true)
    f.offer(a, b.id)
    expect(b.all('voice-signal')).toHaveLength(1)
  })

  it('keeps consent and channel through hibernation and resets them on reconnect', () => {
    const f = fixture()
    const a = f.join('test-resume-token-for-a'), b = f.join()
    f.ready(a)
    f.ready(b)
    f.channel(a, 'global')
    f.wake([a, b])
    f.ready(b, false)
    f.ready(b)
    expect(b.all('voice-channel').at(-1)).toEqual({ type: 'voice-channel', from: a.id, channel: 'global' })
    f.offer(b, a.id)
    expect(a.all('voice-signal')).toHaveLength(1)
    f.disconnect(a)
    expect(b.all('voice-ready').at(-1)).toEqual({ type: 'voice-ready', from: a.id, enabled: false })
    const resumed = f.join('test-resume-token-for-a')
    expect(resumed.id).toBe(a.id)
    f.offer(b, resumed.id)
    expect(resumed.all('voice-signal')).toHaveLength(0)
    f.ready(resumed)
    expect(b.all('voice-channel').at(-1)).toEqual({ type: 'voice-channel', from: resumed.id, channel: 'spatial' })
    f.offer(b, resumed.id)
    expect(resumed.all('voice-signal')).toHaveLength(1)
  })
})
