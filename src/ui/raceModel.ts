import type { RaceState } from '../../shared/protocol'
import { wrapDelta } from '../../shared/wrap'

export interface RaceRole { id: number; host: boolean; connected: boolean }
export interface RacePosition { x: number; z: number; heading: number }

/** Room timestamps use seconds; wire durations use milliseconds. Never infer a new phase. */
export function raceSeconds(race: Readonly<RaceState>, roomNow: number): number {
  return Math.ceil(Math.max(0, race.remainingMs - Math.max(0, roomNow - race.updatedAt) * 1000) / 1000)
}
export function raceView(race: Readonly<RaceState>, role: Readonly<RaceRole>, roomNow: number) {
  const active = race.phase === 'countdown' || race.phase === 'running'
  const participant = race.participants.find(p => p.id === role.id)
  const seconds = raceSeconds(race, roomNow)
  const status = race.phase === 'countdown' ? (seconds ? `Starts in ${seconds}` : 'Waiting for start')
    : race.phase === 'running' ? (seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} left` : 'Waiting for result')
    : race.phase === 'finished' ? (race.winnerName ? `${race.winnerName} wins` : 'Race finished')
    : `Race cancelled${race.reason ? `: ${race.reason}` : ''}`
  return { status, active, leave: role.connected && active && participant?.status === 'racing',
    cancel: role.connected && active && role.host,
    role: participant?.status === 'racing' ? 'Racing' : participant?.status === 'withdrawn' ? 'You left' : 'Watching' }
}
/** Nearest wrapped destination, relative to the same heading used by the minimap. */
export function raceDirection(race: Readonly<RaceState>, self: RacePosition, size: number) {
  const dx = wrapDelta(self.x, race.destination.x, size), dz = wrapDelta(self.z, race.destination.z, size)
  return { metres: Math.round(Math.hypot(dx, dz)), degrees: Math.atan2(dx, -dz) * 180 / Math.PI + self.heading * 180 / Math.PI }
}
