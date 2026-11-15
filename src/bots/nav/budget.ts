/**
 * A route planning budget shared by every mind that plans on one navigator.
 *
 * A ground route search is A* over the coarse grid: a few hundred to a few thousand
 * expansions to a reachable place, up to MAX_EXPANSIONS to prove a place unreachable, and
 * more on a cold cache because edge costs are computed as they are first met. Minds used to
 * search whenever they liked, and they like to at the same moment: every mind chooses on its
 * first step after a drop, choosing can test several places, and route refreshes then repeat
 * in lockstep every few seconds. Measured on the real island with eight minds (tests/bots/
 * route-budget.test.ts), that was six searches in one 20 ms step every four seconds.
 *
 * The budget allows SEARCHES_PER_STEP searches per fixed step across all minds. A mind that
 * is refused keeps what it has (its current route, or its current activity while it is still
 * deciding the next) and asks again next step. That spreads the burst over a few steps, a
 * tenth of a second at most for a full fleet, which nobody can see in how a vehicle drives.
 *
 * It needs no clock and no hook in the game loop: a step is over when a mind that has
 * already stepped steps again. Same minds, same order, same budget: still deterministic.
 * Aircraft routes are straight lines with no search and are not budgeted. Callers that must
 * have a route at once (races) call the navigator directly and are not budgeted either.
 */
import type { Navigator } from '../pilot/types'

/** Ground route searches allowed per fixed step, shared by every mind on one navigator. */
export const SEARCHES_PER_STEP = 1

export class PlanningBudget {
  private readonly stepped = new Set<object>()
  private used = 0
  /** Searches granted since this budget was made, for tests. */
  granted = 0

  /** Call at the start of each mind's step. A mind seen twice means a new step has begun. */
  enter(mind: object): void {
    if (this.stepped.has(mind)) { this.stepped.clear(); this.used = 0 }
    this.stepped.add(mind)
  }

  /** Spend one search from this step's budget. False when it is spent: ask again next step. */
  take(): boolean {
    if (this.used >= SEARCHES_PER_STEP) return false
    this.used++; this.granted++
    return true
  }
}

const budgets = new WeakMap<Navigator, PlanningBudget>()

/** The one budget for every mind sharing this navigator. */
export function planningBudget(navigator: Navigator): PlanningBudget {
  let budget = budgets.get(navigator)
  if (!budget) { budget = new PlanningBudget(); budgets.set(navigator, budget) }
  return budget
}
