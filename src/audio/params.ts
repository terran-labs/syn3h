import { defineParam } from '../../shared/params'

const mix = (id: string, label: string, value: number) => defineParam({
  id: `audio.${id}`, label, group: 'Audio', scope: 'client', default: value, min: 0, max: 1, step: 0.01,
})
export const masterVolume = mix('master', 'Master volume', 0.8)
export const musicVolume = mix('music', 'Music volume', 0.22)
export const effectsVolume = mix('effects', 'Effects volume', 0.7)
export const engineVolume = mix('engine', 'Engine volume', 0.24)
export const dirtVolume = mix('dirt', 'Ground rumble', 0.22)
/** The tyres scrubbing in a real slide. Its own slider since 16 November 2026; it was under Engine volume as a pitched squeal. */
export const slipVolume = mix('slip', 'Tyre slip volume', 0.3)
export const windVolume = mix('wind', 'Wind volume', 0.4)
export const muted = defineParam({ id: 'audio.muted', label: 'Mute audio', group: 'Audio', scope: 'client', default: false })
/**
 * iPhone and iPad: a page's Web Audio is "ambient" by default and goes silent when the ring/silent
 * switch is on, with no sign of why. On, the game declares itself as playback (unlock.ts), so it
 * is heard on silent, and other apps' music pauses while it plays. Off, it mixes with the
 * player's own music and obeys the switch. Added 17 November 2026; the owner decides the default.
 */
export const playOnSilent = defineParam({ id: 'audio.playOnSilent', label: 'Play when the phone is on silent', group: 'Audio', scope: 'client', default: true })
export const crossfade = defineParam({ id: 'audio.crossfade', label: 'Music fade in (s)', group: 'Audio', scope: 'client', default: 2, min: 0.1, max: 8, step: 0.1 })
export const engineIdle = defineParam({ id: 'audio.engineIdle', label: 'Engine idle (Hz)', group: 'Audio', scope: 'client', default: 36, min: 20, max: 70, step: 1 })
export const engineRange = defineParam({ id: 'audio.engineRange', label: 'Engine pitch range', group: 'Audio', scope: 'client', default: 95, min: 20, max: 180, step: 1 })

export const worldVolume = mix('world', 'World ambience', 0.45)
export const cuesVolume = mix('cues', 'Game and UI cues', 0.5)
export const remoteVolume = mix('remote', 'Other vehicles', 0.65)

// The adaptive score's slow build and its theremin lead (src/audio/score/arc.ts). In the Audio
// group so they sit under Sound, Advanced.
/** Seconds of play for the music to build from its bare opening (pads and drone) to its full arc. */
export const scoreBuildTime = defineParam({ id: 'audio.buildTime', label: 'Music build time (s)', group: 'Audio', scope: 'client', default: 300, min: 30, max: 1200, step: 10 })
/** The theremin lead's level at night, where it is most at home. 1 was the level before 16 November 2026. */
export const leadVolume = mix('lead', 'Theremin level', 0.5)
/** Share of the night level the lead keeps in full daylight. Dusk and dawn ease between the two. */
export const leadDaylight = mix('leadDay', 'Theremin by day', 0.25)
/** The lead in the lobby. 0 keeps it silent there. */
export const leadLobby = mix('leadLobby', 'Theremin in the lobby', 0)
