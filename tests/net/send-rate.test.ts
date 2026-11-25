/**
 * Launch safety, 25 November 2026: a full room must never ask Cloudflare for more than its
 * per-room request limit (src/net/params.ts). A room over the limit can get overload errors for
 * everyone in it.
 */
import { describe, expect, it } from 'vitest'
import { params } from '../../shared/params'
import { MAX_ROOM_PLAYERS } from '../../shared/protocol'
import { botCount } from '../../src/bots/params'
import { MAX_SEND_RATE, MAX_STATE_STREAMS, ROOM_REQUESTS_PER_SECOND, STATE_SHARE, netSendRate } from '../../src/net/params'

describe('the send rate ceiling', () => {
  it('keeps a full room with the most bots, every client at the ceiling, inside its share of the limit', () => {
    const streams = MAX_ROOM_PLAYERS + Number(botCount.def.max)
    expect(MAX_STATE_STREAMS).toBe(streams)
    expect(netSendRate.def.max).toBe(MAX_SEND_RATE)
    expect(streams * MAX_SEND_RATE).toBeLessThanOrEqual(ROOM_REQUESTS_PER_SECOND * STATE_SHARE)
    // The default sits under the ceiling: lowering the ceiling never changed what most players send.
    expect(netSendRate.def.default).toBeLessThanOrEqual(MAX_SEND_RATE)
  })

  it('clamps a value above the ceiling (an old setting of 60) instead of refusing it', () => {
    const before = netSendRate.value
    params.set(netSendRate.def.id, 60)
    expect(netSendRate.value).toBe(MAX_SEND_RATE)
    params.set(netSendRate.def.id, before)
  })
})
