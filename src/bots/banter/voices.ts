/**
 * The bots' characters. A bot's name ends in its job ("Temolin Dust Clerk"), drawn from the
 * world seed, so every client agrees who is who. Each job is a voice: its own vocabulary,
 * running jokes and way of taking a request. The lines themselves are in data/.
 */

export type VoiceId = 'inspector' | 'clerk' | 'pilot' | 'probe' | 'marshal' | 'moon' | 'auditor' | 'intern'

export interface Voice {
  id: VoiceId
  /** The job word in the bot's name. */
  job: string
  /** One line for the owner tuning this: who they are. */
  bible: string
  /** 0..1: how readily they say yes to a request. */
  agreeable: number
  /** Seconds they always need before acting on a request ("one moment"). */
  delay: number
  /** Chance they bargain before agreeing. */
  haggle: number
  /** Chance they do the opposite of what was asked, once in a while. */
  contrary: number
  /** 0..1: how hard it is to pull them away from a player they are with (rescue conflict). */
  loyalty: number
  /** Relative share of idle talk. */
  chatty: number
  /** 0..1: baseline accident-proneness, used to pick the session's walking hazard. */
  clumsy: number
}

export const VOICES: Record<VoiceId, Voice> = {
  inspector: { id: 'inspector', job: 'Bolt Inspector', bible: 'Anxious safety inspector. Counts bolts, grades every hazard, would like everyone to slow down, please.', agreeable: 0.55, delay: 0, haggle: 0.15, contrary: 0, loyalty: 0.4, chatty: 1, clumsy: 0.1 },
  clerk: { id: 'clerk', job: 'Dust Clerk', bible: 'Bureaucrat. Cites regulations with sub-clauses, needs a form for everything, files dust.', agreeable: 0.6, delay: 4, haggle: 0.35, contrary: 0, loyalty: 0.5, chatty: 1, clumsy: 0.15 },
  pilot: { id: 'pilot', job: 'Spare Pilot', bible: 'Braggart who is only the spare. Insists they meant to do it. Academy stories nobody asked for.', agreeable: 0.7, delay: 0, haggle: 0.2, contrary: 0.1, loyalty: 0.3, chatty: 1.2, clumsy: 0.55 },
  probe: { id: 'probe', job: 'Snack Probe', bible: 'Earnest and food-minded. Rates terrain by flavour, sincerely kind, always peckish.', agreeable: 0.8, delay: 0, haggle: 0.1, contrary: 0, loyalty: 0.6, chatty: 1, clumsy: 0.3 },
  marshal: { id: 'marshal', job: 'Cone Marshal', bible: 'Deadpan traffic marshal. Short sentences. Thinks most problems need a cone.', agreeable: 0.5, delay: 0, haggle: 0.05, contrary: 0.05, loyalty: 0.8, chatty: 0.6, clumsy: 0.05 },
  moon: { id: 'moon', job: 'Junior Moon', bible: 'Conspiracy theorist about the moon, while being a moon in training. Suspicious of the sky.', agreeable: 0.5, delay: 0, haggle: 0.15, contrary: 0.25, loyalty: 0.3, chatty: 1.1, clumsy: 0.35 },
  auditor: { id: 'auditor', job: 'Rust Auditor', bible: 'Very into rocks. Grades minerals, audits rust, will stop anything for a nice basalt.', agreeable: 0.55, delay: 2, haggle: 0.2, contrary: 0, loyalty: 0.45, chatty: 1, clumsy: 0.2 },
  intern: { id: 'intern', job: 'Hull Intern', bible: 'Overly sincere intern. Thrilled by everything, asks for feedback, learning so much.', agreeable: 0.95, delay: 0, haggle: 0, contrary: 0, loyalty: 0.7, chatty: 1.1, clumsy: 0.6 },
}

export const VOICE_IDS = Object.keys(VOICES) as VoiceId[]

/** The voice for a bot's display name, by its job; a name without one gets a voice from its hash. */
export function voiceFor(name: string): VoiceId {
  for (const v of VOICE_IDS) if (name.endsWith(VOICES[v].job)) return v
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return VOICE_IDS[h % VOICE_IDS.length]
}

/** The short name a bot is called by: its first word, "Temolin". */
export function shortName(name: string): string {
  return name.split(' ')[0] || name
}
