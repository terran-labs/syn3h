/**
 * The bots' characters. A bot is shown as "Temolin"; its hidden role is its job ("Dust Clerk"), drawn from the
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

/**
 * Words in a bot's role, to the voice that suits them. Bot names come from src/ui/data/names.ts
 * ("Mibiwise Glacier Courier", "Welowick Junior Ponderer"); the job word decides first, then
 * the other words of the role. Keep this in step with that vocabulary when it grows.
 */
const ROLE_VOICES: Record<VoiceId, readonly string[]> = {
  inspector: ['Inspector', 'Monitor', 'Officer', 'Spotter', 'Minder', 'Caretaker', 'Bolt', 'Rivet', 'Gasket', 'Valve', 'Hinge', 'Grommet', 'Sprocket', 'Spanner', 'Widget', 'Ladder'],
  clerk: ['Clerk', 'Notary', 'Registrar', 'Archivist', 'Librarian', 'Accountant', 'Counter', 'Sorter', 'Liaison', 'Dispatcher', 'Steward', 'Consultant', 'Translator', 'Dust', 'Sundial', 'Acting', 'Deputy'],
  pilot: ['Pilot', 'Navigator', 'Courier', 'Scout', 'Envoy', 'Spare', 'Chief', 'Senior', 'Compass', 'Sextant', 'Waypoint', 'Detour', 'Beacon', 'Gust', 'Breeze'],
  probe: ['Probe', 'Snack', 'Taster', 'Biscuit', 'Teacup', 'Kettle', 'Thermos', 'Noodle', 'Gardener', 'Botanist', 'Pollen', 'Moss', 'Lichen', 'Sock', 'Doodle'],
  marshal: ['Marshal', 'Cone', 'Keeper', 'Herder', 'Sweeper', 'Wrangler', 'Doorman', 'Pylon', 'Lantern', 'Retired', 'Former'],
  moon: ['Moon', 'Orbit', 'Comet', 'Nebula', 'Satellite', 'Asteroid', 'Zenith', 'Apogee', 'Starlight', 'Meteor', 'Ponderer', 'Whisperer', 'Static', 'Echo', 'Ozone', 'Mist', 'Fog', 'Forecaster', 'Lost', 'Probably'],
  auditor: ['Auditor', 'Surveyor', 'Curator', 'Collector', 'Rust', 'Basalt', 'Quartz', 'Pumice', 'Mica', 'Shale', 'Cobble', 'Fossil', 'Gravel', 'Pebble', 'Crater', 'Glacier', 'Canyon', 'Dune', 'Geyser', 'Magnet'],
  intern: ['Intern', 'Apprentice', 'Hull', 'Junior', 'Assistant', 'Enthusiast', 'Admirer', 'Juggler', 'Tinkerer', 'Fixer', 'Mender', 'Tuner', 'Honorary', 'Visiting', 'Part-time', 'Puzzle', 'Wobble', 'Rainbow'],
}
const WORD_VOICE = new Map<string, VoiceId>()
/** Every role word that has a voice, lower case. */
export const ROLE_WORDS: ReadonlySet<string> = new Set(Object.values(ROLE_VOICES).flat().map((w) => w.toLowerCase()))
for (const v of Object.keys(ROLE_VOICES) as VoiceId[]) for (const w of ROLE_VOICES[v]) if (!WORD_VOICE.has(w.toLowerCase())) WORD_VOICE.set(w.toLowerCase(), v)

/** The voice for a bot's display name: its job word, then the rest of its role, then a hash. */
export function voiceFor(name: string): VoiceId {
  for (const v of VOICE_IDS) if (name.endsWith(VOICES[v].job)) return v
  const words = name.split(/\s+/).slice(1).map((w) => w.toLowerCase())
  for (let i = words.length - 1; i >= 0; i--) { const v = WORD_VOICE.get(words[i]); if (v) return v }
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return VOICE_IDS[h % VOICE_IDS.length]
}

/** The short name a bot is called by: its first word, "Temolin". */
export function shortName(name: string): string {
  return name.split(' ')[0] || name
}
