import { CARD_CLOSE } from '../cardClose'
import { SENTENCE_LIMIT } from './reportText'

/** Report a bug's glyph: a beetle in the pause bar's line (24 px box, stroked; Foreman's choice A). */
export const REPORT_ICON = 'M12 9.2c2.6 0 4.4 2.4 4.4 5.3S14.6 19.8 12 19.8s-4.4-2.4-4.4-5.3S9.4 9.2 12 9.2ZM9.4 9.8a2.6 2.6 0 0 1 5.2 0M12 12.4v7.2M10.4 7.3 9 5.2M13.6 7.3 15 5.2M7.6 13.4H4.4M16.4 13.4h3.2M8 17.2l-2.8 1.6M16 17.2l2.8 1.6'

/**
 * The sheet's markup. Every action is a native button or input, in reading order, so Tab
 * reaches each and Enter or Space presses it (tests/ui/reportBug.test.ts holds this).
 */
export function reportSheetHtml(): string {
  return `<header><h2 id="report-title" tabindex="-1">Report a bug</h2><button type="button" class="card-close report-close" aria-label="Close" data-tip="Close">${CARD_CLOSE}</button></header>
  <div class="report-body">
    <div class="report-shot"><img class="report-thumb" alt="Screenshot of the game as it was paused"><span class="report-shot-wait">Capturing the view</span></div>
    <button type="button" class="panel-action report-save">Save picture</button>
    <label class="report-label" for="report-what">What happened? <span>Optional</span></label>
    <input id="report-what" class="report-what" type="text" maxlength="${SENTENCE_LIMIT}" autocomplete="off" enterkeyhint="done" placeholder="My buggy fell through the hill">
    <label class="report-label" for="report-text">What will be posted</label>
    <textarea id="report-text" class="report-text" rows="4" readonly></textarea>
    <p class="report-how"></p>
    <div class="report-actions"><button type="button" class="panel-action report-discord">Post in Discord</button><button type="button" class="panel-action report-github">Open a GitHub issue</button></div>
    <p class="report-status" role="status" aria-live="polite"></p>
  </div>`
}
