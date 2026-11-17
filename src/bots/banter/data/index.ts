/** Every line pool, merged. Keys are unique across files; a test checks no file shadows another. */
import { EVENTS } from './events'
import { IDLE } from './idle'
import { REQUESTS } from './requests'
import { RESCUE } from './rescue'
import type { Pools } from './types'

export const POOL_FILES: Record<string, Pools> = { idle: IDLE, events: EVENTS, requests: REQUESTS, rescue: RESCUE }
export const POOLS: Pools = { ...IDLE, ...EVENTS, ...REQUESTS, ...RESCUE }
