# Adaptive score

The default music of Syn3h. Nothing in it is a recording: a seeded composer writes the
music one sixteenth note at a time and a fixed Web Audio graph plays it. It ships as code
in the first bundle and costs no download.

| File | What it is |
|---|---|
| `Composer.ts` | Pure music theory. Seed and mood in, notes and drum hits out. No Web Audio, so it runs in unit tests. |
| `ScoreSynth.ts` | The instruments: pads, drone, choir, arpeggio, bass, drums, bells, riser, impact, hall and delay. |
| `Score.ts` | The conductor. Smooths game state into a mood and schedules the composer's output ahead of the audio clock. |
| `demo.ts`, `/score.html` | The lab. Every mood input has a slider and there is a button per scene. |

## What the game feeds it

| Game state | Where it comes from | What it does to the music |
|---|---|---|
| Speed, throttle | the local vehicle | Intensity: arpeggio, then bass and kick, then a half-time low drum; tempo rises from 60 to 100 |
| Tag beams | beams sent and landed near the listener, being tagged | Heat that decays over about nine seconds; raises intensity and turns the harmony dark |
| Altitude, height above ground | the local vehicle | Lift: choir, brighter filters, the sequencer line an octave up, dorian harmony |
| Lava nearby | `lavaProximity` | Phrygian harmony, a growling bass when it is also intense |
| Submersion | vehicle below `liquidHeightAt` | A lowpass on the whole mix, engine and effects included, and a bigger hall |
| Match | `Shell.setMatchState` | Holding the hill is triumph (bells and choir forward), a contested hill is tension |
| World seed | `worldSeed`, or `audio.score.seed` | Key, chord progressions, arpeggio shapes and melody |

The harmony changes mode at the next chord boundary, at most two bars away, and lands the
change with a sub drop.

## The slow build

Since 16 November 2026 the score opens bare (pads, drone and a picked chord) and builds over
`audio.buildTime` seconds of play (300 by default): the sequencer at about half a minute,
bass and drums after a minute and a half, the build section at 0.35 of the way, the theme at
0.55 when the lead is present enough, the climb and release at 0.8. Before, the score opened
on a release and the full mix arrived within five seconds. The lobby stays in the bare
opening and never climbs. The theremin lead follows the world's hour now (`currentHour()`, the day clock): a
quarter of its level by day, its full level at night, eased across dusk and dawn, and silent
in the lobby. Its controls are under Sound, Advanced: Music build time, Theremin level,
Theremin by day, Theremin in the lobby. `tests/audio/score-build.mjs` measures the build.

Since 17 November 2026 (the owner: "more ambient and celestial") the lobby has no plucked
string, bell or telemetry beep. Glass tones take their place: a sine pair beating slowly, an
octave and a faint twelfth, swelling in over 1.2 s, once or twice a chord, with more shimmer
and hall. In play the picked chord and the rest are unchanged. The lobby's levels are the
`audio.score.lobby*` parameters, and `audio.score.lobbyPluck` brings the old lobby back for
comparison. `tools/lobby-audio-render.mjs` renders the lobby and the opening offline, with a
loudness and spectrum summary.

## The arc

A steady texture never raises a hair, so sections of eight bars follow a six-part cycle:

| Section | What happens |
|---|---|
| theme | The world's theme is stated on the theremin. Each seed has one theme of four phrases and it never changes, so its return is recognised. |
| still | The melody rests. Pads, drone and pulse only. |
| build | The bass holds the dominant under moving chords. A string section enters on the beat. |
| climb | The strings double their pace, the theme's rising phrase repeats, an endless-rise tone and a noise swell grow, the choir opens its mouth, a drum roll, then half a bar where only the hall's tail is left. |
| release | The key lifts a minor third and turns to the major (the relative major of a natural minor key). The full theme returns an octave up on brass and theremin, with organ, bell and the women of the choir, about 4 dB above the climb. A dark mood keeps its release in the minor. |
| afterglow | The major lingers; only the theme's closing phrase is heard. |

Every second chord arrives with its third suspended and resolves a bar later.

Play can jump the arc, once the build has reached the climb. `Score.cue('surge')` starts the last two bars of a climb, so a release
lands a few seconds later. Taking off does this by itself (after 1.2 s of real flight), a
capture does it through `accent`, and a win brings the release at once. Surges are at least
40 seconds apart: a release that comes too often stops meaning anything.

## Instruments that are more than oscillators

| Instrument | Technique | File |
|---|---|---|
| Plucked strings | Physical modelling (Karplus-Strong) | `pluck.worklet.js` |
| Choir | Twenty glottal-pulse singers through five formants that move from "oo" to "ah" | `choir.worklet.js` |
| Shimmer | Granular octave-up cascade into the hall | `shimmer.worklet.js` |
| Bell | Modal synthesis: eight inharmonic partials | `ScoreSynth.ts` |
| Pipe organ | Additive: drawbar harmonics in one periodic wave | `ScoreSynth.ts` |
| Endless rise | Shepard and Risset: eight octave-spaced sines under a fixed envelope | `ScoreSynth.ts` |

The worklets are plain JavaScript because the browser loads them as modules. Each loads on
its own; if one fails the score plays on without it (the choir falls back to filtered saws).

## Cost, and the lighter tier

Measured with `node tests/audio/score-load.mjs` on the busiest passage (a release in a full
chase), on an M-series Mac that was loaded by other work, so the figures are probably high:

| Configuration | Share of one core | At 4x slower | At 6x slower |
|---|---|---|---|
| Full, convolution hall (default) | 13.5% | 54% | 81% |
| Full, algorithmic hall (`audio.score.networkHall`) | 9.3% | 37% | 56% |
| Lighter (`audio.score.lite`) | 7.7% | 31% | 46% |
| Not sounding (a recording selected, or faded out) | 0.03% | | |

The scaled columns are arithmetic, not measurements: nothing here has been run on a phone.
Chrome's CPU throttle does not slow the audio thread, so its zero underruns prove nothing.

Why it costs what it does:
- **The graph runs whether or not it is heard.** About two thirds of the cost is a hundred
  oscillators, the hall and the worklets ticking over; the notes add little. So the graph is
  unplugged from the output whenever the score is silent, and idle voices (the oscillator
  choirs once the sung choir loads, the endless rise, the low brass) are unplugged too. An
  unconnected Web Audio node is not computed.
- **The convolution hall** is a third of the total (5.0% for 5.5 s). `hall.worklet.js` is a
  feedback delay network that does the same job for 1.2%, and its tail can lengthen at a
  release. It is an option until it has been judged by ear against the convolution.
- **The choir** tabulates its glottal pulse and skips a section that is not singing.

`audio.score.lite` builds a cheaper set of instruments: no sung choir (filtered saws stand
in), no shimmer, halo or endless rise, fewer oscillators, and the algorithmic hall. The music
is the same. No graphics level sets it (a phone gets the full score unless strained); it is a
setting, and the score sets it itself for the rest of the session after two strained readings in a row from the browser's audio counters, where a
browser has them: `renderCapacity` (an underrun ratio over 0.01 or a load over 75%), or
`playbackStats`, polled every 2 s (2 or more new underrun events). Chrome 157 has
`playbackStats` and not `renderCapacity`. The step-down is a crossfade: the full set fades out
over 0.4 s as the lighter set fades in over 0.6 s. Copy diagnostics has a Music line with the
tier, whether the step-down fired and the underrun count; `tests/audio/score-stepdown.test.ts`
pins the rule. A known wrinkle: both counters feed one count, so in a browser that had both,
one bad window could count twice and step down at once. No browser we target ships
`renderCapacity`, so it cannot happen today; the fix is one line, polling `playbackStats` only
when `renderCapacity` is absent.

**Silencing idle sections (measured 20 November 2026, not built).** Sleeping the instruments a
passage leaves silent was to be built only if the lighter tier, which drops most of them, saved
2 points of a core or more in play. It saves 1.46 to 1.57 points while driving and 2.4 to 2.8
parked or in the lobby, so it was not built. If it is ever wanted, the cheapest subset is the
rise bank, the tag voices and the drum one-shots.

## Tuning

`audio.score.energy`, `audio.score.tempo`, `audio.score.reverb` and `audio.score.seed` are in
the parameter registry under "Adaptive score". Layer thresholds are in `levels()` and
`Composer.step`; instrument levels are in `ScoreSynth.setLevels`.

## Checks

```sh
npx vitest run tests/audio/score.test.ts          # composer: in key, deterministic, layers
SYN3H_NO_ROOM_SERVER=1 npx vite --port 5188 &     # then, in real Chromium:
node tests/audio/score-render.mjs                 # renders each scene offline, measures it,
                                                  # writes WAVs to tests/audio/artifacts
node tests/audio/score-game.mjs                   # the score inside the game
```

The render check cannot tell whether the music is good, only that it is audible, unclipped,
stereo and that each input moves it the right way. Judge it by ear in the lab.
