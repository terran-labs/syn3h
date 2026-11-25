/** shared/device.ts: one device module for analytics and the players card. Each test names its bug. */
import { describe, expect, it } from 'vitest'
import { cleanDeviceLabel, DEVICE_LABELS, deviceClass, deviceLabel, deviceModel } from '../../shared/device'

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
  pixel: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
  tab: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
  cros: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
}

describe('device', () => {
  // Bug: an iPad (whose Safari claims to be a Mac) counted as a desktop, or a phone as a tablet.
  it('classifies and labels the common cases, iPadOS included', () => {
    expect([deviceLabel(UA.iphone, 5), deviceClass(UA.iphone, true, 5)]).toEqual(['iPhone', 'phone'])
    expect([deviceLabel(UA.ipadDesktop, 5), deviceClass(UA.ipadDesktop, true, 5)]).toEqual(['iPad', 'tablet'])
    expect([deviceLabel(UA.ipadDesktop, 0), deviceClass(UA.ipadDesktop, false, 0)]).toEqual(['Mac', 'desktop'])
    expect([deviceLabel(UA.pixel, 5), deviceClass(UA.pixel, true, 5)]).toEqual(['Android phone', 'phone'])
    expect([deviceLabel(UA.tab, 5), deviceClass(UA.tab, true, 5)]).toEqual(['Android tablet', 'tablet'])
    expect(deviceLabel(UA.win, 0)).toBe('Windows')
    expect(deviceLabel(UA.cros, 0)).toBe('ChromeOS')
    expect(deviceLabel(UA.linux, 0)).toBe('Linux')
    expect(deviceLabel('', 0)).toBe('Device')
  })

  // Bug: a server trusting free text sent as a device label.
  it('allowlists labels', () => {
    for (const l of DEVICE_LABELS) expect(cleanDeviceLabel(l)).toBe(l)
    for (const bad of ['iPhone 16 Pro', 'Quentin', '', 7]) expect(cleanDeviceLabel(bad)).toBeUndefined()
  })

  // Bug: a model guessed for Apple devices, or a long or odd string shown.
  it('asks Android for its model and keeps only a short plain name', async () => {
    const android = (model: string) => ({ userAgent: UA.pixel, userAgentData: { getHighEntropyValues: async () => ({ model }) } })
    expect(await deviceModel(android(' Pixel 9 '))).toBe('Pixel 9')
    expect(await deviceModel(android('<b>x</b>'))).toBeUndefined()
    expect(await deviceModel(android('x'.repeat(30)))).toBeUndefined()
    expect(await deviceModel({ userAgent: UA.iphone, userAgentData: { getHighEntropyValues: async () => ({ model: 'iPhone' }) } })).toBeUndefined()
    expect(await deviceModel({ userAgent: UA.pixel, userAgentData: { getHighEntropyValues: async () => { throw new Error('denied') } } })).toBeUndefined()
  })
})
