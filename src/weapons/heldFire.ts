/**
 * A held fire button as intent (the owner, 19 November 2026): "If I'm holding my cursor button
 * with a weapon with a cooldown, such as Plasma Thunder, it should start its charge as soon as
 * it is eligible rather than me needing to release the mouse button and then click again."
 *
 * `held` is true while the button is down with the gear in hand: a held button means "fire as
 * soon as you can". A gear reads it, not the raw button: while it is true and the gear becomes
 * ready, the gear acts as if the press had happened then. That includes a gear coming into hand
 * with the button already down, as it always did. What ends it:
 *  - letting go of the button. The input layer already lets go of it for a lost window focus
 *    or pointer lock, an open menu or panel, and the chat field taking the keys (Input.poll,
 *    Shell), and the touch Tag button's Cancel ring lets go of it too;
 *  - the gear leaving the hand: an intent for one gear never fires it after the player has left
 *    it, and a half-built charge is not carried across (the gear lets it go as before);
 *  - clear(), for a cancelled charge or carry: it stays ended until the button is let go and
 *    pressed again.
 *
 * Players only: a bot's gear keeps its own press logic, unchanged. Client input only: nothing
 * here is sent, and a gear's action is sent exactly as a pressed one always was.
 */
export class HeldFire {
  /** Set by clear(): the button must be let go before it counts again. */
  private blocked = false
  /** The button down with this gear in hand (and not since cleared). */
  held = false

  /** One step: the raw button and whether this gear is in hand. Returns `held`'s edges. */
  step(button: boolean, inHand: boolean): { pressed: boolean; released: boolean } {
    const before = this.held
    if (!button) this.blocked = false
    this.held = button && inHand && !this.blocked
    return { pressed: this.held && !before, released: before && !this.held }
  }

  /** End the intent now; the button must be let go and pressed again to start the next. */
  clear(): void { this.held = false; this.blocked = true }
}
