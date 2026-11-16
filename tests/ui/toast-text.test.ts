/** Toasts stay one line on a phone: a long room name would wrap across the readouts. */
import { expect, it } from 'vitest'
import { joinedText, middleTruncate } from '../../src/ui/toastText'

it('says "Joined as" in the public room and names any other room', () => {
  expect(joinedText('lobby', 'Zimipel')).toBe('Joined as Zimipel')
  expect(joinedText('race-night', 'Zimipel')).toBe('Joined room race-night as Zimipel')
})

it('cuts long room names from the middle, keeping both ends', () => {
  const short = middleTruncate('touch-aim-portrait-1794854727804')
  expect(short).toHaveLength(20)
  expect(short.startsWith('touch-aim')).toBe(true)
  expect(short.endsWith('4727804')).toBe(true)
  expect(short).toContain('…')
  expect(middleTruncate('lobby')).toBe('lobby')
})
