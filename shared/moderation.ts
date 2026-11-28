/**
 * Who may eject or mute whom for everyone (the owner, 25 November 2026; the Foreman's ruling).
 * One rule, here, used by the room server to enforce and by the client to word what it offers.
 *
 * A creator (the server-granted role, feat/creator-badge) may in any room. A host may only in a
 * private room or a parallel universe: in a public world the host is merely whoever arrived first,
 * and on a busy day that stranger must not be able to eject or silence everyone. Nobody acts on
 * themselves, and nobody acts on a creator. Bot removal and personality changes belong to the current host.
 */
export type RoomKind = 'public' | 'universe' | 'private'
export interface Moderator { id: number; host: boolean; role?: 'creator'; bot?: boolean }
export type ModerationReason = 'creator' | 'host-bot' | 'host-private' | 'not-host' | 'public-world' | 'self' | 'target-creator' | 'unknown'

export function botManagement(host: boolean): { ok: boolean; reason: ModerationReason } {
  return host ? { ok: true, reason: 'host-bot' } : { ok: false, reason: 'not-host' }
}

export function canModerate(actor: Moderator | undefined, target: Moderator | undefined, kind: RoomKind): { ok: boolean; reason: ModerationReason } {
  if (!actor || !target || actor.bot) return { ok: false, reason: 'unknown' }
  if (actor.id === target.id) return { ok: false, reason: 'self' }
  if (target.role === 'creator') return { ok: false, reason: 'target-creator' }
  if (actor.role === 'creator') return { ok: true, reason: 'creator' }
  if (kind === 'public') return { ok: false, reason: 'public-world' }
  return actor.host ? { ok: true, reason: 'host-private' } : { ok: false, reason: 'not-host' }
}
