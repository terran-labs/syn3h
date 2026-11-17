/**
 * Format of the bot line data. Edit the lines in the sibling files; this only says what
 * shape they take and which slots each key may use.
 *
 * A pool is a list of templates per voice, plus `any` for lines every voice can say. When a
 * bot speaks from a pool it picks from its own voice's lines and the `any` lines together,
 * its own counted twice, so voices stay distinct but never run dry.
 *
 * Template syntax (src/bots/banter/grammar.ts):
 *   {me}       the speaker's short name ("Temolin")
 *   {role}     the speaker's role, the rest of its name ("Glacier Courier")
 *   {you}      the bot or player being answered
 *   {subj}     the bot the line is about (the stuck one, the one who spotted something)
 *   {player}   the player concerned (who asked, who jumped, who arrived)
 *   {critter}  the imagined animal of this exchange, the same in every line of it
 *   {feature}  a real thing nearby: "the lava vent", "the summit", "the shore", "the end of the road"
 *   {activity} what the addressee is doing, as a phrase: "cruising the road", "sightseeing"
 *   {count}    an ordinal for callbacks: "third"
 *   {sea}      "lava" or "water", whichever this world's sea is
 *   {planet}   the planet's look in a word: "volcanic", "desert", "icy"...
 *   {kind}     the player's vehicle: "buggy", "jet", "hovercraft"
 *   {@frag}    a fragment from fragments.ts, e.g. {@rock}, {@form}, {@reg}
 *   [a|b|c]    an inline choice
 *
 * Content rules: friendly, clever, a little absurd. Nothing violent (no killing, dying,
 * weapons, blood, crashing "into" anyone on purpose), cruel, sexual, political, or about
 * real people or brands. Never punch down at the player; jokes at the bots' own expense are
 * welcome. Lines stay under 140 characters. The tests check every generated line.
 */
import type { VoiceId } from '../voices'

export type Pool = Partial<Record<VoiceId | 'any', readonly string[]>>
export type Pools = Record<string, Pool>
