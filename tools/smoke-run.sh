# Sourced by tools/release.sh and tools/domain.sh. run_smoke <url> <log> <evidence dir>
#
# One net-smoke run, its result lines shown. A browser page crash (NET SMOKE BROWSER CRASHED)
# is the machine failing, not the game or the network: the whole smoke restarts once, fresh,
# in a new room. Two crashes in one release fail it. SYN3H_CRASH_COUNT names a file holding
# the release's crash count, so release.sh and the domain check it runs share one budget.
# SYN3H_CRASH_CAP (default 2) is how many crashes that budget allows.
run_smoke() {
  _url=$1 _log=$2 _evidence=$3 _attempt=0
  : "${SYN3H_CRASH_COUNT:=$(mktemp /tmp/syn3h-crash-count.XXXXXX)}"
  export SYN3H_CRASH_COUNT
  while :; do
    _attempt=$((_attempt + 1))
    _dir="$_evidence"; [ "$_attempt" -eq 1 ] || _dir="$_evidence-restart"
    SYN3H_SHOT_EVIDENCE_DIR="$_dir" node tools/net-smoke.mjs "$_url" >"$_log" 2>&1
    grep -E "^(FAIL|RETRY|NET SMOKE)" "$_log" || true
    grep -q "^NET SMOKE OK" "$_log" && return 0
    grep -q "^NET SMOKE BROWSER CRASHED" "$_log" || return 1
    _crashes=$(( $(cat "$SYN3H_CRASH_COUNT" 2>/dev/null || echo 0) + 1 ))
    echo "$_crashes" >"$SYN3H_CRASH_COUNT"
    if [ "$_crashes" -ge "${SYN3H_CRASH_CAP:-2}" ]; then
      echo "BROWSER CRASHED $_crashes times in this release: the machine running the checks is failing, not the game" >&2
      return 2
    fi
    echo "Browser crashed (not a game or network failure); restarting the whole smoke, fresh."
    cp "$_log" "$_log.crashed"
  done
}
