/**
 * A held fire button as intent (the owner, 19 November 2026): "If I'm holding my cursor button
 * with a weapon with a cooldown, such as Plasma Thunder, it should start its charge as soon as
 * it is eligible rather than me needing to release the mouse button and then click again."
 *
 * `held` is true from a press made with the gear in hand until that press ends. A gear reads
 * it, not the raw button: while it is true and the gear becomes ready, the gear acts as if the
 * press had happened then. What ends it:
 *  - letting go of the button. The input layer already lets go of it for a lost window focus
 *    or pointer lock, an open menu or panel, and the chat field taking the keys (Input.poll,
 *    Shell), and the touch Tag button's Cancel ring lets go of it too;
 *  - the gear leaving the hand. Coming back to it with the button still down does not count as
 *    a press: only a new press does;
 *  - clear(), for a cancelled charge or carry.
 *
 * Players only: a bot's gear keeps its own press logic, unchanged. Client input only: nothing
 * here is sent, and a gear's action is sent exactly as a pressed one always was.
 */
export class HeldFire {
  private was = false
  /** Pressed with this gear in hand and held since. */
  held = false

  /** One step: the raw button and whether this gear is in hand. Returns `held`'s edges. */
  step(button: boolean, inHand: boolean): { pressed: boolean; released: boolean } {
    const before = this.held
    const press = button && !this.was
    this.was = button
    if (!button || !inHand) this.held = false
    else if (press) this.held = true
    return { pressed: this.held && !before, released: before && !this.held }
  }

  /** End the intent now; a new press starts the next. */
  clear(): void { this.held = false }
}
