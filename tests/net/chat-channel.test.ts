/**
 * What a screen shows and sends. The panel draws only what ChatChannel says to show, and
 * draws it with textContent (checked in the browser by tools/chat-check.mjs).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatChannel } from '../../src/net/chat'
import { BOT_ID_BASE } from '../../shared/protocol'
import { chatHideBots, chatOn, chatShow } from '../../shared/chat'
import { params } from '../../shared/params'
import { Input } from '../../src/core/Input'

let sent: object[]
let channel: ChatChannel
let connected = true

beforeEach(() => {
  sent = []
  connected = true
  channel = new ChatChannel({
    selfId: () => 1, nameOf: (id) => `P${id}`, colorOf: () => '#ffffff', connected: () => connected,
    send: (m) => sent.push(m),
  }, () => 0)
})
afterEach(() => {
  channel.dispose()
  for (const p of [chatShow, chatHideBots, chatOn]) params.set(p.def.id, p.def.default)
})

const line = (from: number, text: string) => channel.receive({ type: 'chat', from, text, t: 0 })

describe('chat channel', () => {
  it('a muted player\'s lines are not shown, before or after the mute', () => {
    const shown: string[] = []
    channel.onShow((l) => shown.push(l.text))
    line(2, 'before')
    channel.mute(2)
    line(2, 'after')
    line(3, 'other')
    expect(shown).toEqual(['before', 'other'])
    expect(channel.visible().map((l) => l.text)).toEqual(['other'])
    channel.mute(2, false)
    expect(channel.visible().map((l) => l.text)).toEqual(['before', 'after', 'other'])
  })

  it('chat off for this player stops showing and sending', () => {
    params.set(chatShow.def.id, false)
    const shown: string[] = []
    channel.onShow((l) => shown.push(l.text))
    line(2, 'hidden')
    expect(shown).toEqual([])
    expect(channel.send('hello')).toBe(false)
    expect(sent).toEqual([])
  })

  it('chat off for the room stops sending', () => {
    params.set(chatOn.def.id, false, 'remote')
    expect(channel.send('hello')).toBe(false)
    expect(sent).toEqual([])
    expect(channel.canSend()).toMatchObject({ ok: false })
  })

  it('hide bot chatter hides bots but not people, and the bots still hear people', () => {
    params.set(chatHideBots.def.id, true)
    const heard: string[] = []
    channel.onHear((l) => heard.push(l.text))
    line(BOT_ID_BASE + 1, 'I found a rock')
    line(2, 'follow me')
    expect(channel.visible().map((l) => l.text)).toEqual(['follow me'])
    expect(heard).toEqual(['I found a rock', 'follow me'])
  })

  it('text is kept as text: markup is not interpreted or removed', () => {
    line(2, '<img src=x onerror=alert(1)> <b>hi</b>')
    expect(channel.visible()[0].text).toBe('<img src=x onerror=alert(1)> <b>hi</b>')
  })

  it('sends only cleaned, non-empty text', () => {
    expect(channel.send('   ')).toBe(false)
    expect(channel.send('  hi​ ')).toBe(true)
    expect(sent).toEqual([{ type: 'chat', text: 'hi' }])
  })
})

describe('typing in chat', () => {
  it('suspends every driving input while the field has focus, and restores it after', () => {
    // Node has no DOM: the listener's "typed into a field?" checks need the classes to exist.
    class Field {}
    vi.stubGlobal('HTMLInputElement', Field); vi.stubGlobal('HTMLTextAreaElement', Field)
    const target = new EventTarget() as unknown as Window
    const input = new Input(target)
    const key = (type: string, code: string) => target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }))
    key('keydown', 'KeyW')
    expect(input.poll().y).toBe(1)
    input.typing = true
    expect(input.poll().y).toBe(0)
    input.external.x = 1
    input.mouseFire = true
    const s = input.poll()
    expect([s.x, s.fire]).toEqual([0, false])
    expect(input.held('KeyW')).toBe(false)
    key('keydown', 'KeyD')
    input.typing = false
    input.external.x = 0; input.mouseFire = false
    // Keys pressed while typing do not drive afterwards.
    expect(input.poll().x).toBe(0)
    key('keydown', 'KeyW')
    expect(input.poll().y).toBe(1)
    vi.unstubAllGlobals()
  })
})
