/** This page's release channel (shared/channel.ts): 'beta' on beta.mira.cc and workers.dev addresses. */
import { channelOf, type Channel } from '../../shared/channel'
export { channelOf, type Channel }
export function channel(): Channel {
  try { return typeof location === 'undefined' ? 'production' : channelOf(location.hostname) } catch { return 'production' }
}
