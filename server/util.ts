/**
 * Room names come from URLs and the start screen; turn them into short, boring slugs so they
 * are safe as keys and "My Room" and "my-room" meet in the same place.
 */
export function roomName(raw: string | null | undefined): string {
  const s = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return s || 'lobby'
}
