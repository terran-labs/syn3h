import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import vectors from './qr-vectors.json'
import { encodeQr } from '../../src/ui/QrCode'
it('matches independent Nayuki byte-mode M matrices across versions and masks', () => {
  for(const vector of vectors) {
    const code=encodeQr(vector.text,vector.mask)
    expect(code.version).toBe(vector.version)
    const matrix=code.modules.map(row=>row.map(Number).join('')).join('')
    expect(createHash('sha256').update(matrix).digest('hex')).toBe(vector.sha256)
  }
})
it('supports 100-character invite URLs and refuses oversized data', () => {
  expect(encodeQr('https://example.test/?room='+'x'.repeat(74)).version).toBe(6)
  expect(()=>encodeQr('x'.repeat(300))).toThrow(RangeError)
  expect(()=>encodeQr('hello',8)).toThrow(RangeError)
})
