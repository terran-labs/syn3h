#!/bin/sh
# A second vantage point for a release: the short public check (tools/public-check.mjs) run from
# a GitHub-hosted machine against the public site (.github/workflows/public-check.yml), so a
# failure on the release machine's own route to Cloudflare can be told apart from a failure of
# the site. Report only: it never fails or rolls back a release, and always exits 0.
#
#   tools/vantage.sh <version tag, e.g. v26.11.2300> [url, default https://mira.cc/]
#
# The Orchestrator runs it in the record step, right after pushing main and the tags. It passes
# the version tag as the workflow's `ref`, so the hosted machine checks out that release's own
# checker even if main has moved on; started from tools/release.sh before the push, it used to
# run the previous release's checker against the new page (docs/NAMES.md). It only starts and
# reads the workflow: no push, no secrets. MIRA_SKIP_VANTAGE=1 skips it; MIRA_VANTAGE_WAIT (or
# the older SYN3H_VANTAGE_WAIT) caps the wait, default 1200 s.
. "$(dirname "$0")/lib/legacy-env.sh" # legacy environment names, see docs/NAMES.md
set -u
cd "$(dirname "$0")/.."
CALVER="${1:-}"; URL="${2:-https://mira.cc/}"
case "$CALVER" in v[0-9]*.[0-9]*.[0-9]*) ;; *) echo "usage: tools/vantage.sh <version tag, e.g. v26.11.2300> [url]" >&2; exit 2 ;; esac
LOG="/tmp/mira-vantage-$CALVER"
vantage() {
  [ -z "${MIRA_SKIP_VANTAGE:-}" ] || { echo "VANTAGE: skipped (MIRA_SKIP_VANTAGE)"; return 0; }
  command -v gh >/dev/null 2>&1 || { echo "VANTAGE: skipped (gh is not installed)"; return 0; }
  _since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  gh workflow run public-check.yml -f version="$CALVER" -f url="${URL:-https://mira.cc/}" -f ref="$CALVER" >"$LOG-vantage.log" 2>&1 \
    || { echo "VANTAGE: skipped (could not start the GitHub check; see $LOG-vantage.log)"; return 0; }
  _run=""; _tries=0
  while [ -z "$_run" ] && [ "$_tries" -lt 12 ]; do
    sleep 5; _tries=$((_tries + 1))
    _run="$(gh run list --workflow public-check.yml --event workflow_dispatch --limit 5 --json databaseId,createdAt \
      -q "[.[] | select(.createdAt >= \"$_since\")][0].databaseId" 2>/dev/null || true)"
  done
  [ -n "$_run" ] || { echo "VANTAGE: skipped (the GitHub run did not appear within a minute)"; return 0; }
  # Polled, never watched: on 18 Nov 2026 a hosted run stuck "in progress" for 36 minutes and
  # `gh run watch` held the accepted release open with it. At most MIRA_VANTAGE_WAIT seconds
  # (default 1200); a run still going then is reported as such, and the release ends.
  # Done means a conclusion, not only "completed": GitHub can report a run completed a moment
  # before its conclusion, and release-91 printed that empty conclusion as if it were a result.
  _deadline=$(( $(date +%s) + ${MIRA_VANTAGE_WAIT:-1200} )); _status=""; _conclusion=""
  # Asked at least once, however short the wait.
  while :; do
    _state="$(gh run view "$_run" --json status,conclusion -q '.status + " " + .conclusion' 2>/dev/null || true)"
    _status="${_state%% *}"; _conclusion="${_state#* }"; [ "$_conclusion" != "$_state" ] || _conclusion=""
    [ "$_status" = completed ] && [ -n "$_conclusion" ] && break
    [ "$(date +%s)" -lt "$_deadline" ] || break
    sleep 15
  done
  _url="https://github.com/terran-labs/syn3h/actions/runs/$_run"
  if [ "$_status" != completed ]; then
    echo "VANTAGE: GitHub public check of $CALVER still running (${_status:-status unknown}) after ${MIRA_VANTAGE_WAIT:-1200} s, not waited for; no result yet: $_url"
  elif [ -z "$_conclusion" ]; then
    echo "VANTAGE: GitHub public check of $CALVER completed but GitHub reported no result within ${MIRA_VANTAGE_WAIT:-1200} s; no result yet: $_url"
  else
    echo "VANTAGE: GitHub public check of $CALVER from a hosted machine: $_conclusion $_url"
  fi
}
vantage || true
exit 0
