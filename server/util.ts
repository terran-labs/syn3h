/** Room names come from URLs; keep them short and boring so they are safe as keys. */
export function roomName(raw: string | null | undefined): string {
  const s = (raw ?? '').trim().toLowerCase()
  return /^[a-z0-9_-]{1,32}$/.test(s) ? s : 'lobby'
}
