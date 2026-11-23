#!/bin/sh
# Attach hostnames to the game's Worker, redirect-only hostnames, and their rollbacks. Kept apart
# from release.sh so a release can never touch a domain by accident. Runbooks: docs/CUTOVER.md
# (syn3h.com, 14 November 2026) and docs/MIRA-CUTOVER.md (mira.cc).
#
#   tools/domain.sh export [--zone <zone>]
#       save the zone's DNS records, its redirect and page rules, and the Worker's attached
#       Custom Domains, under ../Syn3h-stable/dns/<time>-<zone>/. Every changing step needs one
#       from the last two hours.
#   tools/domain.sh attach <host> --owner-approved [--dry-run]
#       attach one hostname to the Worker through the Custom Domains API. No deploy: the code
#       serving players does not change. Removes exactly the exported A, AAAA or CNAME records at
#       that hostname first (a Custom Domain cannot share its name with them), and fails loudly if
#       any hostname attached before is missing afterwards.
#   tools/domain.sh check <host>
#       certificate, HTTP 200 at /, WebSocket upgrade at /ws, every previously attached host still
#       attached and serving, then net-smoke (or the short public check). For www.mira.cc: its
#       redirect to mira.cc.
#   tools/domain.sh rollback <export-dir> <host>... [--dry-run]
#       detach hostnames that attach added (never one attached before the export) and restore
#       their exported records.
#   tools/domain.sh redirect-www --owner-approved [--dry-run]           (mira.cc only)
#       a proxied placeholder record at www.mira.cc and one Single Redirect rule sending it to
#       https://mira.cc with path and query kept, 302. Running it again changes nothing.
#   tools/domain.sh redirect-www-rollback <export-dir> [--dry-run]     (mira.cc only)
#   tools/domain.sh clean-parking --confirm-delete [--dry-run]          (mira.cc only)
#       delete the registrar's imported parking records at *.mira.cc and www.mira.cc.
#   tools/domain.sh restore <export-dir> <name>... [--dry-run]
#       recreate the exported A, AAAA and CNAME records at those names (undoes clean-parking).
#
# Zones: syn3h.com (the default) and mira.cc, picked by --zone or SYN3H_DOMAIN_ZONE, or else the
# zone of the host named. --dry-run prints each changing API call instead of making it; reads
# still happen when a token is present, and come from the export when it is not. The token is
# never printed. Only A, AAAA and CNAME records at the named hosts are ever removed or restored:
# MX, TXT and every other record are never touched.
set -eu
cd "$(dirname "$0")/.."
. tools/cloudflare-token.sh
. tools/smoke-run.sh
REPO="$(pwd)"
API=https://api.cloudflare.com/client/v4
WORKER=syn3h
ZONES="syn3h.com mira.cc"
# Never a Custom Domain: it would serve the game on a second origin (its own storage and invites).
REDIRECT_ONLY=www.mira.cc
CANONICAL=mira.cc
# Cloudflare's documented address for a proxied hostname with no origin ("originless setups").
PLACEHOLDER=100::
RULE_DESC="www.mira.cc to mira.cc"
STORE="${SYN3H_DOMAIN_STORE:-$(cd .. && pwd)/Syn3h-stable}"

die() { printf '\nDOMAIN FAILED: %s\n' "$*" >&2; exit 1; }
command -v jq >/dev/null || die "jq is required"

# cf METHOD PATH [JSON]: call the API, fail on success=false, print the JSON.
cf() {
  out="$(cf_curl -sS -X "$1" "$API$2" -H 'Content-Type: application/json' ${3:+--data "$3"})"
  printf '%s' "$out" | jq -e '.success == true' >/dev/null 2>&1 || { printf '%s\n' "$out" >&2; return 1; }
  printf '%s' "$out"
}
# change METHOD PATH [JSON]: a call that changes something. A dry run prints it (to standard
# error, so callers capturing the answer still see it) and answers with a stand-in.
DRY=""
change() {
  if [ -n "$DRY" ]; then
    printf 'DRY RUN: %s %s%s\n' "$1" "$API$2" "${3:+ $3}" >&2
    printf '{"success":true,"result":{"id":"dry-run","rules":[{"id":"dry-run","description":"%s"}]}}' "$RULE_DESC"
    return 0
  fi
  cf "$@"
}
# Reads need the token; a dry run without one reads the export instead.
live() { [ -z "$DRY" ] || cf_has_token; }
# answer <host>: "<status> <redirect address>" for https://<host>/, or failure (certificate or
# connection).
answer() { curl -sS -o /dev/null --max-time 20 -w '%{http_code} %{redirect_url}' "https://$1/" 2>/dev/null; }
# ws_upgrade <host>: the room server accepts a WebSocket at /ws (101). curl then waits for frames
# until --max-time, so its exit status is ignored and only the status line counts.
ws_upgrade() {
  code="$(curl -s -o /dev/null --http1.1 --max-time 5 -w '%{http_code}' -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "https://$1/ws?room=cutover-check" 2>/dev/null || true)"
  [ "$code" = 101 ]
}
web_records() { jq -c --arg h "$1" '[.result[] | select(.name == $h and (.type == "A" or .type == "AAAA" or .type == "CNAME"))]' "$2"; }
record_body() { jq -c '{type, name, content, proxied, ttl, comment}'; }

# Tests source the functions above without running a command (tools/secret-env.test.mjs).
[ -z "${SYN3H_DOMAIN_LIB:-}" ] || return 0

cmd="${1:-}"; [ $# -gt 0 ] && shift
ZONE_NAME="${SYN3H_DOMAIN_ZONE:-}"; APPROVED=""; CONFIRMED=""; REST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --zone) [ $# -ge 2 ] || die "--zone needs a zone"; ZONE_NAME="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --owner-approved) APPROVED=1; shift ;;
    --confirm-delete) CONFIRMED=1; shift ;;
    --*) die "unknown option $1" ;;
    *) REST="$REST $1"; shift ;;
  esac
done
# No globbing: a record name such as *.mira.cc must reach the script as written.
set -f
# shellcheck disable=SC2086
set -- $REST
set +f
if [ -z "$ZONE_NAME" ]; then
  case "$cmd" in
    attach|check) [ $# -ge 1 ] && ZONE_NAME="${1#www.}" ;;
    rollback|restore|redirect-www-rollback) [ $# -ge 1 ] && ZONE_NAME="${1##*/}" && ZONE_NAME="${ZONE_NAME#*-*-}" ;;
    redirect-www|clean-parking) ZONE_NAME=mira.cc ;;
  esac
fi
ZONE_NAME="${ZONE_NAME:-syn3h.com}"
case " $ZONES " in *" $ZONE_NAME "*) ;; *) die "refusing zone $ZONE_NAME: only $ZONES" ;; esac
case "$cmd" in check|'') ;; *) [ -n "$DRY" ] || cf_has_token || die "no Cloudflare token: put it in $SYN3H_CLOUDFLARE_TOKEN_FILE or set CLOUDFLARE_API_TOKEN" ;; esac

in_zone() { case "$1" in "$ZONE_NAME"|"www.$ZONE_NAME") return 0 ;; esac; return 1; }
need_host_in_zone() { in_zone "$1" || die "refusing host $1: only $ZONE_NAME and www.$ZONE_NAME"; }
mira_only() { [ "$ZONE_NAME" = mira.cc ] || die "$cmd is for the mira.cc zone only"; }
# The newest export of this zone; changing steps need one from the last two hours.
fresh_export() {
  EXPORT="$(ls -d "$STORE"/dns/*-"$ZONE_NAME" 2>/dev/null | tail -1)"
  [ -n "$EXPORT" ] && { [ -n "$DRY" ] || [ -n "$(find "$EXPORT" -maxdepth 0 -mmin -120)" ]; } \
    || die "no export of $ZONE_NAME from the last two hours: run tools/domain.sh export --zone $ZONE_NAME first"
}
given_export() {
  EXPORT="${1:-}"
  [ -f "$EXPORT/records.json" ] || die "give the export directory (from tools/domain.sh export)"
  z="$(jq -r '.result[0].zone_name // empty' "$EXPORT/records.json")"
  [ -z "$z" ] || [ "$z" = "$ZONE_NAME" ] || die "$EXPORT holds $z, not $ZONE_NAME"
}
# Each read fails (status 1) when the API call fails, never by answering with nothing.
zone_id() {
  if live; then j="$(cf GET "/zones?name=$ZONE_NAME")" || return 1; printf '%s' "$j" | jq -er '.result[0].id'
  else jq -r '.result[0].zone_id // "{zone_id}"' "$EXPORT/records.json" 2>/dev/null || echo '{zone_id}'; fi
}
account_id() {
  if live; then j="$(cf GET "/zones?name=$ZONE_NAME")" || return 1; printf '%s' "$j" | jq -er '.result[0].account.id'
  else echo '{account_id}'; fi
}
# Hostnames attached to the Worker: live, or as exported.
attached() {
  if live; then j="$(cf GET "/accounts/$A/workers/domains?service=$WORKER")" || return 1; printf '%s' "$j" | jq -r '.result[].hostname' | sort
  else jq -r --arg s "$WORKER" '.result[] | select(.service == $s) | .hostname' "$EXPORT/worker-domains.json" | sort; fi
}
exported_attached() { jq -r --arg s "$WORKER" '.result[] | select(.service == $s) | .hostname' "$1/worker-domains.json" | sort; }
# The zone's records now (or as exported, in a dry run without a token).
current_records() {
  if live; then cf GET "/zones/$Z/dns_records?per_page=5000" > "$1"; else cp "$EXPORT/records.json" "$1"; fi
}
# Fail loudly if any host in $1 (a list) is no longer attached. With a second argument, a failed
# read of the list only warns: release.sh's short check must not fail a release on a transient API
# error. A list that was read and lacks a host is always fatal.
still_attached() {
  if ! now="$(attached)"; then
    [ -n "${2:-}" ] || die "could not read the Worker's domains from the API"
    echo "WARNING: could not read the Worker's domains from the API; attachment of $(printf '%s ' $1)not verified" >&2
    return 0
  fi
  for h in $1; do
    printf '%s\n' "$now" | grep -qx "$h" || die "LOST: $h is no longer attached to $WORKER. Re-attach it now: tools/domain.sh attach $h --owner-approved"
  done
  echo "Still attached: $(printf '%s ' $1)"
}
restore_records() { # <export> <name>...
  ex="$1"; shift
  for n in "$@"; do
    web_records "$n" "$ex/records.json" | jq -c '.[]' | while read -r rec; do
      echo "Restoring $(printf '%s' "$rec" | jq -r '"\(.type) \(.name) -> \(.content)"')"
      change POST "/zones/$Z/dns_records" "$(printf '%s' "$rec" | record_body)" >/dev/null \
        || echo "  (could not restore; it may already exist: check the dashboard)"
    done
  done
}

case "$cmd" in
export)
  if [ -n "$DRY" ]; then echo "DRY RUN: export only reads; it would save $ZONE_NAME's records, rules and the Worker's domains under $STORE/dns/<time>-$ZONE_NAME"; exit 0; fi
  Z="$(zone_id)" && [ "$Z" != null ] || die "zone $ZONE_NAME not visible to this token"
  A="$(account_id)" || die "could not read the account from the API"
  DIR="$STORE/dns/$(date +%Y%m%d-%H%M%S)-$ZONE_NAME"
  mkdir -p "$DIR"
  cf GET "/zones/$Z/dns_records?per_page=5000" > "$DIR/records.json"
  cf_curl -sS "$API/zones/$Z/dns_records/export" > "$DIR/zone.bind"
  cf GET "/accounts/$A/workers/domains" > "$DIR/worker-domains.json"
  # Optional: the token may not be allowed to read them.
  cf GET "/zones/$Z/rulesets/phases/http_request_dynamic_redirect/entrypoint" > "$DIR/redirect-rules.json" 2>/dev/null || echo "(no redirect rules, or not readable with this token)"
  cf GET "/zones/$Z/pagerules" > "$DIR/pagerules.json" 2>/dev/null || echo "(page rules not readable with this token)"
  echo "Saved $DIR"
  echo "Attached to $WORKER now: $(exported_attached "$DIR" | tr '\n' ' ')"
  echo "Web records (the only kind any step removes or restores):"
  for h in "$ZONE_NAME" "www.$ZONE_NAME" "*.$ZONE_NAME"; do web_records "$h" "$DIR/records.json" | jq -r '.[] | "  \(.type) \(.name) -> \(.content) proxied=\(.proxied) ttl=\(.ttl)"'; done
  echo "Mail and other records (never touched): $(jq '[.result[] | select(.type == "MX" or .type == "TXT")] | length' "$DIR/records.json") MX/TXT"
  ;;

attach)
  [ $# -eq 1 ] || die "attach one hostname at a time"
  H="$1"; need_host_in_zone "$H"
  [ "$H" != "$REDIRECT_ONLY" ] || die "refusing $H: it must only redirect to $CANONICAL (tools/domain.sh redirect-www), never serve the game"
  [ -n "$APPROVED" ] || die "attaching a domain needs the owner's explicit word; then pass --owner-approved"
  fresh_export
  Z="$(zone_id)" || die "could not read zone $ZONE_NAME from the API"; A="$(account_id)" || die "could not read the account from the API"
  echo "Zone $ZONE_NAME ($Z), export $EXPORT"
  BEFORE="$(attached)" || die "could not read the Worker's domains from the API"
  echo "Attached before: $(printf '%s ' $BEFORE)"
  if printf '%s\n' "$BEFORE" | grep -qx "$H"; then echo "$H is already attached; nothing to do."; exit 0; fi
  # Only records that were exported may be removed, and only if they are still as exported.
  NOW_FILE="$(mktemp)"; current_records "$NOW_FILE"
  REMOVE="$(web_records "$H" "$EXPORT/records.json")"
  [ "$(web_records "$H" "$NOW_FILE" | jq -c 'map(.id) | sort')" = "$(printf '%s' "$REMOVE" | jq -c 'map(.id) | sort')" ] \
    || die "the records at $H changed since $EXPORT: export again"
  rm -f "$NOW_FILE"
  printf '%s' "$REMOVE" | jq -r '.[] | "\(.id) \(.type) \(.name) \(.content)"' | while read -r rid rtype rname rcontent; do
    echo "Removing $rtype $rname -> $rcontent (saved in $EXPORT/records.json)"
    change DELETE "/zones/$Z/dns_records/$rid" >/dev/null
  done
  BODY="$(jq -cn --arg h "$H" --arg s "$WORKER" --arg z "$Z" '{hostname: $h, service: $s, zone_id: $z}')"
  echo "Attaching $H to $WORKER"
  if ! OUT="$(change PUT "/accounts/$A/workers/domains" "$BODY")"; then
    echo "Attach failed: restoring the records just removed."
    restore_records "$EXPORT" "$H"
    die "attach of $H failed and its records were restored"
  fi
  if [ -z "$DRY" ]; then printf '%s' "$OUT" > "$EXPORT/attached-$H.json"; fi
  if [ -n "$DRY" ]; then echo "DRY RUN: then check that $(printf '%s ' $BEFORE)$H are all attached"; exit 0; fi
  still_attached "$BEFORE $H"
  echo "ATTACH OK: $H serves the Worker $WORKER. Next: tools/domain.sh check $H"
  echo "Roll back with: tools/domain.sh rollback $EXPORT $H"
  ;;

check)
  H="${1:-}"; need_host_in_zone "$H"
  SHORT="${SYN3H_SHORT_CHECK:-}"
  if [ "$H" = "$REDIRECT_ONLY" ]; then
    PROBE="/?room=redirect-check&v=26.11.1503"
    got="$(curl -sS -o /dev/null --max-time 20 -w '%{http_code} %{redirect_url}' "https://$H$PROBE")" || die "https://$H/ failed (certificate or connection)"
    [ "$got" = "302 https://$CANONICAL$PROBE" ] || [ "$got" = "301 https://$CANONICAL$PROBE" ] || die "https://$H$PROBE answered \"$got\", not a redirect to https://$CANONICAL$PROBE"
    echo "Redirect ok, certificate verified: https://$H$PROBE -> $got"
    exit 0
  fi
  # A host serves the game (200), or, once its zone sends players to mira.cc (docs/MIRA-CUTOVER.md),
  # redirects there and stays attached only for its socket. curl verifies the certificate: a bad
  # one fails the request rather than answering.
  i=0
  until got="$(answer "$H")" && case "$got" in "200 "*|30[12]" https://$CANONICAL/"*) true ;; *) false ;; esac; do
    i=$((i + 1)); [ "$i" -le 60 ] || die "https://$H/ answered \"$got\""; sleep 5
  done
  case "$got" in
    "200 "*) echo "HTTPS ok, certificate verified: https://$H/" ;;
    *) echo "Redirect ok, certificate verified: https://$H/ -> ${got#* }" ;;
  esac
  ws_upgrade "$H" || die "wss://$H/ws did not upgrade"
  echo "WSS ok: upgrade to /ws on $H"
  # Every host attached in the newest export of either zone must still be attached, and must
  # serve the game or redirect to mira.cc with its socket still answering.
  PREV=""
  for z in $ZONES; do e="$(ls -d "$STORE"/dns/*-"$z" 2>/dev/null | tail -1)"; [ -z "$e" ] || [ ! -f "$e/worker-domains.json" ] || PREV="$PREV $(exported_attached "$e" | tr '\n' ' ')"; done
  PREV="$(printf '%s\n' $PREV | sort -u)"
  if [ -n "$PREV" ]; then
    if ! cf_has_token; then echo "(no token: attachment of $(printf '%s ' $PREV)not verified, only that they answer)"
    elif A="$(account_id)"; then still_attached "$PREV" ${SHORT:+lenient}
    elif [ -n "$SHORT" ]; then echo "WARNING: could not read the account from the API; attachment of $(printf '%s ' $PREV)not verified" >&2
    else die "could not read the account from the API"; fi
    for p in $PREV; do
      [ "$p" = "$H" ] && continue
      c="$(answer "$p")" || true
      case "$c" in
        "200 "*) echo "Still serving: https://$p/" ;;
        30[12]" https://$CANONICAL/"*) ws_upgrade "$p" || die "https://$p/ redirects to $CANONICAL but wss://$p/ws did not upgrade: pages left open there would lose their room"
          echo "Still attached for its socket: https://$p/ redirects to $CANONICAL, wss://$p/ws upgrades" ;;
        *) die "https://$p/, attached before, answered \"$c\"" ;;
      esac
    done
  fi
  case "$got" in "200 "*) ;; *) echo "CHECK OK: $H redirects to $CANONICAL and keeps its socket; no game to smoke-test there."; exit 0 ;; esac
  if [ -n "${SYN3H_SHORT_CHECK:-}" ]; then
    # After a release's production deploy: the short public check (tools/public-check.mjs).
    run_public_check "https://$H/" /tmp/syn3h-domain-check.log || die "public check failed on $H"
  else
    SHOT_PARENT="$(mktemp -d "/tmp/syn3h-shot-domain-$H.XXXXXX")" || die "could not reserve domain evidence directory"
    echo "Shot evidence: $SHOT_PARENT/evidence (https://$H/)"
    run_smoke "https://$H/" /tmp/syn3h-domain-check.log "$SHOT_PARENT/evidence" || die "net-smoke failed on $H"
  fi
  ;;

rollback)
  given_export "${1:-}"; shift
  [ $# -gt 0 ] || die "name at least one host"
  for h in "$@"; do need_host_in_zone "$h"; done
  KEEP="$(exported_attached "$EXPORT")"
  for h in "$@"; do
    printf '%s\n' "$KEEP" | grep -qx "$h" && die "refusing to detach $h: it was attached before $EXPORT; rollback only undoes attach"
  done
  Z="$(zone_id)" || die "could not read zone $ZONE_NAME from the API"; A="$(account_id)" || die "could not read the account from the API"
  for h in "$@"; do
    if live; then IDS="$(cf GET "/accounts/$A/workers/domains?hostname=$h" | jq -r --arg s "$WORKER" '.result[] | select(.service == $s) | .id')"
    else IDS="$(jq -r '.result.id // empty' "$EXPORT/attached-$h.json" 2>/dev/null || true)"; IDS="${IDS:-{domain_id}}"; fi
    for did in $IDS; do
      echo "Detaching $h ($did)"
      change DELETE "/accounts/$A/workers/domains/$did" >/dev/null
    done
    restore_records "$EXPORT" "$h"
  done
  [ -n "$DRY" ] || { [ -z "$KEEP" ] || still_attached "$KEEP"; }
  echo "ROLLBACK DONE:$(printf ' %s' "$@") detached and their exported records restored."
  ;;

redirect-www)
  mira_only
  [ -n "$APPROVED" ] || die "redirect-www changes the mira.cc zone; pass --owner-approved"
  fresh_export
  Z="$(zone_id)" || die "could not read zone $ZONE_NAME from the API"
  NOW_FILE="$(mktemp)"; current_records "$NOW_FILE"
  WWW="$(web_records "$REDIRECT_ONLY" "$NOW_FILE")"; rm -f "$NOW_FILE"
  STATE="$EXPORT/redirect-www.json"; [ -f "$STATE" ] || echo '{}' > "$STATE"
  if [ "$(printf '%s' "$WWW" | jq --arg p "$PLACEHOLDER" '[.[] | select(.type == "AAAA" and .content == $p and .proxied == true)] | length')" -gt 0 ]; then
    echo "Placeholder record at $REDIRECT_ONLY already there."
  elif [ "$(printf '%s' "$WWW" | jq 'length')" -gt 0 ]; then
    die "$REDIRECT_ONLY still has other records ($(printf '%s' "$WWW" | jq -r '[.[] | "\(.type) \(.content)"] | join(", ")')): run tools/domain.sh clean-parking first"
  else
    REC="$(jq -cn --arg n "$REDIRECT_ONLY" --arg c "$PLACEHOLDER" '{type: "AAAA", name: $n, content: $c, proxied: true, ttl: 1, comment: "No origin: redirects to mira.cc (tools/domain.sh redirect-www)"}')"
    echo "Creating proxied AAAA $REDIRECT_ONLY -> $PLACEHOLDER (no origin; Cloudflare answers it)"
    REC_OUT="$(change POST "/zones/$Z/dns_records" "$REC")"
    if [ -z "$DRY" ]; then jq --arg id "$(printf '%s' "$REC_OUT" | jq -r '.result.id')" '.record_id = $id' "$STATE" > "$STATE.tmp"; mv "$STATE.tmp" "$STATE"; fi
  fi
  RULE="$(jq -cn --arg host "$REDIRECT_ONLY" --arg to "https://$CANONICAL" --arg d "$RULE_DESC" '{
    description: $d,
    expression: ("(http.host eq \"" + $host + "\")"),
    action: "redirect",
    action_parameters: { from_value: { status_code: 302, preserve_query_string: true,
      target_url: { expression: ("concat(\"" + $to + "\", http.request.uri.path)") } } } }')"
  if live; then ENTRY="$(cf GET "/zones/$Z/rulesets/phases/http_request_dynamic_redirect/entrypoint" 2>/dev/null || true)"
  else ENTRY="$(cat "$EXPORT/redirect-rules.json" 2>/dev/null || true)"; fi
  RID="$(printf '%s' "$ENTRY" | jq -r '.result.id // empty' 2>/dev/null || true)"
  if [ -n "$RID" ] && printf '%s' "$ENTRY" | jq -e --arg d "$RULE_DESC" '.result.rules // [] | any(.description == $d)' >/dev/null; then
    echo "Redirect rule \"$RULE_DESC\" already there."
  elif [ -n "$RID" ]; then
    echo "Adding the rule \"$RULE_DESC\" to the zone's redirect rules ($RID)"
    RULE_OUT="$(change POST "/zones/$Z/rulesets/$RID/rules" "$RULE")"
  else
    echo "Creating the zone's redirect rules with \"$RULE_DESC\""
    RULE_OUT="$(change POST "/zones/$Z/rulesets" "$(jq -cn --argjson r "$RULE" '{name: "redirects", kind: "zone", phase: "http_request_dynamic_redirect", rules: [$r]}')")"
  fi
  if [ -z "$DRY" ] && [ -n "${RULE_OUT:-}" ]; then
    jq --argjson o "$RULE_OUT" --arg d "$RULE_DESC" '.ruleset_id = $o.result.id | .rule_id = ([$o.result.rules[] | select(.description == $d) | .id][0])' "$STATE" > "$STATE.tmp"
    mv "$STATE.tmp" "$STATE"
  fi
  [ -z "$DRY" ] || { echo "DRY RUN: then expect https://$REDIRECT_ONLY/?room=x to answer 302 to https://$CANONICAL/?room=x"; exit 0; }
  i=0
  until got="$(curl -s -o /dev/null --max-time 20 -w '%{http_code} %{redirect_url}' "https://$REDIRECT_ONLY/?room=redirect-check")" && [ "$got" = "302 https://$CANONICAL/?room=redirect-check" ]; do
    i=$((i + 1)); [ "$i" -le 24 ] || die "https://$REDIRECT_ONLY/ answered \"$got\" after two minutes; undo with tools/domain.sh redirect-www-rollback $EXPORT"
    sleep 5
  done
  echo "REDIRECT OK: https://$REDIRECT_ONLY/ -> https://$CANONICAL/ (302, path and query kept). Undo with: tools/domain.sh redirect-www-rollback $EXPORT"
  ;;

redirect-www-rollback)
  mira_only
  given_export "${1:-}"
  STATE="$EXPORT/redirect-www.json"
  Z="$(zone_id)" || die "could not read zone $ZONE_NAME from the API"
  RID="$(jq -r '.ruleset_id // empty' "$STATE" 2>/dev/null || true)"; RULE_ID="$(jq -r '.rule_id // empty' "$STATE" 2>/dev/null || true)"
  REC_ID="$(jq -r '.record_id // empty' "$STATE" 2>/dev/null || true)"
  [ -n "$RID$REC_ID" ] || [ -n "$DRY" ] || die "$STATE records nothing that redirect-www created"
  [ -z "$RULE_ID" ] || { echo "Deleting the redirect rule $RULE_ID"; change DELETE "/zones/$Z/rulesets/$RID/rules/$RULE_ID" >/dev/null; }
  [ -z "$REC_ID" ] || { echo "Deleting the placeholder record $REC_ID"; change DELETE "/zones/$Z/dns_records/$REC_ID" >/dev/null; }
  [ -z "$DRY" ] || [ -n "$RID$REC_ID" ] || echo "DRY RUN: nothing recorded in $STATE to undo"
  echo "REDIRECT-WWW ROLLED BACK: $REDIRECT_ONLY no longer redirects (restore parking records with tools/domain.sh restore $EXPORT $REDIRECT_ONLY if wanted)."
  ;;

clean-parking)
  mira_only
  fresh_export
  Z="$(zone_id)" || die "could not read zone $ZONE_NAME from the API"
  TARGETS="$(jq -c --arg p "$PLACEHOLDER" '[.result[] | select((.name == "*.mira.cc" or .name == "www.mira.cc") and (.type == "A" or .type == "AAAA" or .type == "CNAME") and .content != $p)]' "$EXPORT/records.json")"
  [ "$(printf '%s' "$TARGETS" | jq 'length')" -gt 0 ] || { echo "No parking records at *.mira.cc or www.mira.cc in $EXPORT."; exit 0; }
  echo "Parking records to delete (saved in $EXPORT/records.json):"
  printf '%s' "$TARGETS" | jq -r '.[] | "  \(.type) \(.name) -> \(.content) proxied=\(.proxied) id=\(.id)"'
  [ -n "$CONFIRMED" ] || die "read the list above, then run again with --confirm-delete"
  if live; then
    NOW_FILE="$(mktemp)"; current_records "$NOW_FILE"
    for rid in $(printf '%s' "$TARGETS" | jq -r '.[].id'); do jq -e --arg id "$rid" 'any(.result[]; .id == $id)' "$NOW_FILE" >/dev/null || die "record $rid is gone since $EXPORT: export again"; done
    rm -f "$NOW_FILE"
  fi
  for rid in $(printf '%s' "$TARGETS" | jq -r '.[].id'); do change DELETE "/zones/$Z/dns_records/$rid" >/dev/null; echo "Deleted $rid"; done
  echo "CLEAN-PARKING DONE. Undo with: tools/domain.sh restore $EXPORT '*.mira.cc' www.mira.cc"
  ;;

restore)
  given_export "${1:-}"; shift
  [ $# -gt 0 ] || die "name at least one record name"
  for n in "$@"; do case "$n" in "$ZONE_NAME"|*".$ZONE_NAME") ;; *) die "refusing $n: not in $ZONE_NAME" ;; esac; done
  Z="$(zone_id)" || die "could not read zone $ZONE_NAME from the API"
  restore_records "$EXPORT" "$@"
  ;;

*)
  sed -n '2,35p' "$0"; exit 2 ;;
esac
