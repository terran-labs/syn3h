/**
 * The device module (src/core/device.ts, shared/device.ts). Bugs caught: an iPad shown as a Mac;
 * a model guessed where no browser gives one; free text from a client shown as a device; the
 * phone/tablet/desktop rule disagreeing between the roster and analytics.
 */
import { describe, expect, it } from 'vitest'
import { cleanDeviceLabel, cleanDeviceModel, deviceClassSync, deviceLabelSync, deviceModel } from '../../src/core/device'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
const PIXEL = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari'
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'
const IPADOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome'

describe('the device', () => {
  it('tells phones, tablets and desktops apart, as analytics always did', () => {
    expect(deviceClassSync(IPHONE, true, 5)).toBe('phone')
    expect(deviceClassSync(PIXEL, true, 5)).toBe('phone')
    expect(deviceClassSync(IPAD, true, 5)).toBe('tablet')
    expect(deviceClassSync(IPADOS, true, 5)).toBe('tablet')
    expect(deviceClassSync(MAC, false, 0)).toBe('desktop')
  })
  it('labels what the browser can support, an iPadOS "Mac" as an iPad', () => {
    expect(deviceLabelSync(IPHONE, true, 5)).toBe('iPhone')
    expect(deviceLabelSync(IPAD, true, 5)).toBe('iPad')
    expect(deviceLabelSync(IPADOS, true, 5)).toBe('iPad')
    expect(deviceLabelSync(MAC, false, 0)).toBe('Mac')
    expect(deviceLabelSync(PIXEL, true, 5)).toBe('Android phone')
    expect(deviceLabelSync('Mozilla/5.0 (Linux; Android 15; SM-X710) Safari', true, 5)).toBe('Android tablet')
    expect(deviceLabelSync('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome', false, 0)).toBe('Windows PC')
    expect(deviceLabelSync('Mozilla/5.0 (X11; CrOS x86_64 15000.0.0) Chrome', false, 0)).toBe('Chromebook')
    expect(deviceLabelSync('Mozilla/5.0 (X11; Linux x86_64) Firefox', false, 0)).toBe('Linux PC')
  })
  it('asks for a model only on Android, and never guesses one', async () => {
    const hints = (model: string) => ({ getHighEntropyValues: async () => ({ model }) })
    expect(await deviceModel({ userAgent: PIXEL, userAgentData: hints('Pixel 9') })).toBe('Pixel 9')
    expect(await deviceModel({ userAgent: IPHONE, userAgentData: hints('iPhone 18 Pro') })).toBeUndefined()
    expect(await deviceModel({ userAgent: PIXEL })).toBeUndefined()
    expect(await deviceModel({ userAgent: PIXEL, userAgentData: hints('<script>') })).toBeUndefined()
  })
  it('keeps only the fixed words and a strict model from whatever a client sends', () => {
    expect(cleanDeviceLabel('iPhone')).toBe('iPhone')
    for (const bad of ['iPhone 18 Pro', 'hacker', '', 5, null]) expect(cleanDeviceLabel(bad)).toBeUndefined()
    expect(cleanDeviceModel(' Pixel 9 ')).toBe('Pixel 9')
    for (const bad of ['x', 'a'.repeat(30), 'Pixel<9>', 'Pixel\n9', 42]) expect(cleanDeviceModel(bad)).toBeUndefined()
  })
})
