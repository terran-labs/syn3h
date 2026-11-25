import { expect, it } from 'vitest'
import { communityLinks } from '../../src/ui/communityLinks'

it('leaves Discord out until an invite is configured', () => {
  expect(communityLinks('  ').map(({ href, label }) => [href, label])).toEqual([
    ['https://github.com/terran-labs/syn3h', 'Mira on GitHub'],
    ['https://terranlabs.com', 'Terran Labs'],
  ])
})

it('puts the configured Discord invite first and keeps Terran Labs as text', () => {
  const invite = 'https://discord.gg/test-fixture'
  const [discord, github, studio] = communityLinks(invite)
  expect(discord).toMatchObject({ href: invite, label: 'Join the Mira community on Discord' })
  expect(discord?.icon).toContain('<path')
  expect(github?.icon).toContain('<path')
  expect(studio).toEqual({ href: 'https://terranlabs.com', label: 'Terran Labs', text: 'terranlabs.com' })
})

it('uses the permanent Mira invite by default', () => {
  expect(communityLinks()[0]?.href).toBe('https://discord.gg/dxTFZRM')
})
