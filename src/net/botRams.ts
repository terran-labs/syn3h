/**
 * Bot-on-bot contact, on the host (the only client that simulates both bots): which pairs began
 * touching this step, one report per contact, spaced like a person's rams.
 *
 * `enabled` follows the room's welcome (`botRams`): an older room does not know a ram reported
 * for a bot and would credit the host's own player with it, so nothing is reported until the
 * room says it understands.
 */
export interface BotRamReport { bot: number; other: number }

export class BotRamReporter {
  enabled = false
  private readonly pairs = new Map<string, { touching: boolean; at: number }>()
  constructor(private readonly repeat: number) {}

  /**
   * One physics step. `bots` are the host's live bots with their speeds; `touching(a, b)` says
   * whether two of them are in contact. Returns the new contacts, the faster bot as the rammer.
   */
  step<T>(now: number, bots: readonly (readonly [number, T, number])[], touching: (a: T, b: T) => boolean): BotRamReport[] {
    const out: BotRamReport[] = []
    if (!this.enabled) { this.pairs.clear(); return out }
    for (let i = 0; i < bots.length; i++) for (let j = i + 1; j < bots.length; j++) {
      const [idA, a, speedA] = bots[i], [idB, b, speedB] = bots[j]
      const key = `${idA}:${idB}`, now_ = touching(a, b), was = this.pairs.get(key)
      if (now_ && !was?.touching && now - (was?.at ?? -Infinity) > this.repeat) {
        out.push(speedA >= speedB ? { bot: idA, other: idB } : { bot: idB, other: idA })
        this.pairs.set(key, { touching: true, at: now })
      } else this.pairs.set(key, { touching: now_, at: was?.at ?? -Infinity })
    }
    return out
  }
}
