// Starting on a device that cannot draw, and other start failures (src/core/graphicsSupport.ts,
// showStartFailure in diagnostics.ts). Bugs caught: a raw exception shown to the player as the
// message; a Reload offered where reloading cannot help; the WebGL 2 check holding a context
// or throwing on a browser that refuses it.
import { describe, expect, it, vi } from 'vitest'
import { canCreateWebGL2, NoGraphicsError, startFailure, webgpuUsable } from '../../src/core/graphicsSupport'
import { PhysicsLoadError } from '../../src/core/physicsWasm'
import { type NoticeDocument, showStartFailure } from '../../src/core/diagnostics'

const RAW = "Cannot read properties of null (reading 'getSupportedExtensions')"

describe('startFailure', () => {
  it('tells a device with nothing to draw with what it can do, without a reload', () => {
    for (const failure of [startFailure(new NoGraphicsError('no WebGL 2 context'), { rendererStarted: false, webgl2: true }), startFailure(new TypeError(RAW), { rendererStarted: false, webgl2: false })]) {
      expect(failure.kind).toBe('no-graphics')
      expect(failure.reload).toBe(false)
      expect(failure.steps.join(' ')).toMatch(/hardware acceleration/)
      expect(failure.steps.join(' ')).toMatch(/Chrome, Edge, Safari or Firefox/)
      expect(failure.text).not.toMatch(/getSupportedExtensions|null|Error/)
    }
  })
  it('gives any other failure a plain sentence and a reload, the raw error only as details', () => {
    for (const graphics of [{ rendererStarted: true, webgl2: false }, { rendererStarted: false, webgl2: true }]) {
      const failure = startFailure(new TypeError(RAW), graphics)
      expect(failure.kind).toBe('failed')
      expect(failure.reload).toBe(true)
      expect(failure.text).not.toContain(RAW)
      expect(failure.details).toBe(`TypeError: ${RAW}`)
    }
  })
})

describe('startFailure for the physics engine', () => {
  it('keeps its own message, written for the player, and puts the cause in details', () => {
    const failure = startFailure(new PhysicsLoadError('HTTP 404'), { rendererStarted: true, webgl2: true })
    expect(failure).toMatchObject({ kind: 'failed', reload: true, text: 'The physics engine could not be loaded. Check your connection and reload.', details: 'PhysicsLoadError: HTTP 404' })
  })
})

describe('canCreateWebGL2', () => {
  const doc = (context: () => unknown) => ({ createElement: () => ({ getContext: context }) as unknown as HTMLCanvasElement })
  it('is false when the browser gives no context or throws', () => {
    expect(canCreateWebGL2(doc(() => null))).toBe(false)
    expect(canCreateWebGL2(doc(() => { throw new Error('blocked') }))).toBe(false)
    expect(canCreateWebGL2(undefined)).toBe(false)
  })
  it('is true when it can, and releases the context it made', () => {
    const loseContext = vi.fn()
    expect(canCreateWebGL2(doc(() => ({ getExtension: () => ({ loseContext }) })))).toBe(true)
    expect(loseContext).toHaveBeenCalledTimes(1)
  })
  it('counts a real or fallback WebGPU adapter as usable, and nothing else', () => {
    expect(webgpuUsable('available')).toBe(true)
    expect(webgpuUsable('fallback')).toBe(true)
    for (const probe of ['missing', 'timeout', 'rejected', 'unsupported'] as const) expect(webgpuUsable(probe)).toBe(false)
  })
})

describe('showStartFailure', () => {
  function fakeDocument() {
    type Node = { id: string; tag: string; textContent: string | null; style: { cssText: string }; attrs: Record<string, string>; children: Node[]; listeners: (() => void)[] }
    const make = (tag: string): Node & Record<string, unknown> => {
      const node = { id: '', tag, textContent: null as string | null, style: { cssText: '' }, attrs: {} as Record<string, string>, children: [] as Node[], listeners: [] as (() => void)[],
        setAttribute(name: string, value: string) { node.attrs[name] = value }, append(...n: Node[]) { node.children.push(...n) }, addEventListener(_t: string, l: () => void) { node.listeners.push(l) } }
      return node
    }
    const fatal = make('div'); fatal.id = 'fatal'
    const doc = { body: { append: () => {} }, getElementById: (id: string) => (id === 'fatal' ? fatal : null), createElement: make }
    const text = (n: Node): string => [n.textContent ?? '', ...n.children.map(text)].join(' ')
    return { doc: doc as unknown as NoticeDocument, fatal, text }
  }
  it('shows the device message with steps and details, and no button', () => {
    const { doc, fatal, text } = fakeDocument()
    expect(showStartFailure(startFailure(new TypeError(RAW), { rendererStarted: false, webgl2: false }), doc)).toBe(true)
    expect(fatal.attrs['data-failure']).toBe('no-graphics')
    expect(fatal.children.map(c => c.tag)).toEqual(['p', 'ul', 'details'])
    expect(fatal.children[0].textContent).not.toContain(RAW)
    expect(text(fatal)).toContain(RAW)
  })
  it('offers a reload for any other failure', () => {
    const { doc, fatal } = fakeDocument()
    const reload = vi.fn()
    showStartFailure(startFailure(new Error('physics failed'), { rendererStarted: true, webgl2: true }), doc, reload)
    expect(fatal.children.map(c => c.tag)).toEqual(['p', 'button', 'details'])
    fatal.children[1].listeners[0]()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
