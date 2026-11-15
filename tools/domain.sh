#!/bin/sh
# Move syn3h.com hostnames onto the released Worker, and back. Kept apart from release.sh so a
# release can never touch the domain by accident. Runbook: docs/CUTOVER.md.
#
#   tools/domain.sh export                         save the zone's DNS (and redirect rules)
#   tools/domain.sh attach release-<n> <host>... --owner-approved
#                                                  point the hosts at that release's Worker
#   tools/domain.sh check <host>                   HTTPS, WSS upgrade, net-smoke
#   tools/domain.sh rollback <export-dir> <host>...
#                                                  detach the hosts and restore their records
#
# Hosts must be syn3h.com or www.syn3h.com. Needs CLOUDFLARE_API_TOKEN (see docs/CUTOVER.md for
# its permissions). Only A, AAAA and CNAME records at the named hosts are ever removed or
# restored: MX, TXT and every other name are never touched.
set -eu
cd "$(dirname "$0")/.."
REPO="$(pwd)"
ZONE_NAME=syn3h.com
STORE="$(cd .. && pwd)/Syn3h-stable"
API=https://api.cloudflare.com/client/v4
WRANGLER="$REPO/node_modules/wrangler/bin/wrangler.js"

die() { printf '\nDOMAIN FAILED: %s\n' "$*" >&2; exit 1; }
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || die "set CLOUDFLARE_API_TOKEN"
command -v jq >/dev/null || die "jq is required"

# cf METHOD PATH [JSON]: call the API, fail on success=false, print the JSON.
cf() {
  out="$(curl -sS -X "$1" "$API$2" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' ${3:+--data "$3"})"
  printf '%s' "$out" | jq -e '.success == true' >/dev/null 2>&1 || { printf '%s\n' "$out" >&2; return 1; }
  printf '%s' "$out"
}
zone_id() { cf GET "/zones?name=$ZONE_NAME" | jq -r '.result[0].id'; }
account_id() { cf GET "/zones?name=$ZONE_NAME" | jq -r '.result[0].account.id'; }
check_hosts() {
  for h in "$@"; do
    case "$h" in "$ZONE_NAME"|"www.$ZONE_NAME") ;; *) die "refusing host $h: only $ZONE_NAME and www.$ZONE_NAME" ;; esac
  done
  [ $# -gt 0 ] || die "name at least one host"
}
# The web records at a host: the only records this script ever deletes or restores.
web_records() { jq -c --arg h "$1" '[.result[] | select(.name == $h and (.type == "A" or .type == "AAAA" or .type == "CNAME"))]' "$2"; }

cmd="${1:-}"; [ $# -gt 0 ] && shift
case "$cmd" in
export)
  Z="$(zone_id)"; [ -n "$Z" ] && [ "$Z" != null ] || die "zone $ZONE_NAME not visible to this token"
  DIR="$STORE/dns/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$DIR"
  cf GET "/zones/$Z/dns_records?per_page=5000" > "$DIR/records.json"
  curl -sS "$API/zones/$Z/dns_records/export" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" > "$DIR/zone.bind"
  # Redirect rules and page rules explain today's apex to www redirect. Optional: the token may
  # not be allowed to read them.
  cf GET "/zones/$Z/rulesets/phases/http_request_dynamic_redirect/entrypoint" > "$DIR/redirect-rules.json" 2>/dev/null || echo "(redirect rules not readable with this token)"
  cf GET "/zones/$Z/pagerules" > "$DIR/pagerules.json" 2>/dev/null || echo "(page rules not readable with this token)"
  echo "Saved $DIR"
  echo "Records at the web hosts (the only ones attach may remove):"
  for h in "$ZONE_NAME" "www.$ZONE_NAME"; do web_records "$h" "$DIR/records.json" | jq -r '.[] | "  \(.type) \(.name) -> \(.content) proxied=\(.proxied) ttl=\(.ttl)"'; done
  echo "Mail and other records (never touched): $(jq '[.result[] | select(.type == "MX" or .type == "TXT")] | length' "$DIR/records.json") MX/TXT"
  ;;

attach)
  REL="${1:-}"; [ $# -gt 0 ] && shift
  APPROVED=""; HOSTS=""
  for a in "$@"; do
    if [ "$a" = "--owner-approved" ]; then APPROVED=1; else HOSTS="$HOSTS $a"; fi
  done
  # shellcheck disable=SC2086
  set -- $HOSTS
  check_hosts "$@"
  [ -n "$APPROVED" ] || die "the cutover needs the owner's explicit word in his thread; then pass --owner-approved"
  LINE="$(awk -F'\t' -v r="$REL" '$1 == r' "$STORE/releases.tsv" 2>/dev/null | tail -1)"
  [ -n "$LINE" ] || die "$REL is not in $STORE/releases.tsv: release it to workers.dev and check it first"
  ID="$(printf '%s' "$LINE" | cut -f7)"
  DEST="$STORE/$ID"
  EXPORT="$(ls -d "$STORE"/dns/* 2>/dev/null | tail -1)"
  [ -n "$EXPORT" ] && [ -n "$(find "$EXPORT" -maxdepth 0 -mmin -120)" ] || die "no DNS export from the last two hours: run tools/domain.sh export first"
  echo "Release $REL (frozen copy $ID), DNS export $EXPORT"
  Z="$(zone_id)"
  # Remove the conflicting web records ourselves, visibly. Without this, a non interactive
  # wrangler deploy silently overrides them (override_existing_dns_record).
  for h in "$@"; do
    web_records "$h" "$EXPORT/records.json" | jq -r '.[] | "\(.id) \(.type) \(.name) \(.content)"' | while read -r rid rtype rname rcontent; do
      echo "Removing $rtype $rname -> $rcontent"
      cf DELETE "/zones/$Z/dns_records/$rid" >/dev/null || echo "  (already gone)"
    done
  done
  # Same Worker, same code and Durable Objects as the release; this only adds Custom Domains.
  # workers_dev stays on so the workers.dev address keeps working.
  { echo "workers_dev = true"; cat "$DEST/wrangler.toml"; for h in "$@"; do printf '\n[[routes]]\npattern = "%s"\ncustom_domain = true\n' "$h"; done; } > "$DEST/wrangler.domain.toml"
  echo "Deploying $REL with Custom Domains:$HOSTS"
  if ! (cd "$DEST" && node "$WRANGLER" deploy -c wrangler.domain.toml --message "$REL on$HOSTS" </dev/null) > "/tmp/syn3h-domain-attach.log" 2>&1; then
    cat /tmp/syn3h-domain-attach.log
    echo "Deploy failed: restoring the records just removed."
    "$REPO/tools/domain.sh" rollback "$EXPORT" "$@"
    die "attach failed and was rolled back"
  fi
  cat /tmp/syn3h-domain-attach.log
  for h in "$@"; do "$REPO/tools/domain.sh" check "$h" || die "$h failed its checks: consider tools/domain.sh rollback $EXPORT$HOSTS"; done
  echo "ATTACH OK:$HOSTS now serve $REL. Roll back with: tools/domain.sh rollback $EXPORT$HOSTS"
  ;;

check)
  H="${1:-}"; check_hosts "$H"
  i=0
  until code="$(curl -s -o /dev/null -w '%{http_code}' "https://$H/")" && [ "$code" = 200 ]; do
    i=$((i + 1)); [ "$i" -le 60 ] || die "https://$H/ answered $code"; sleep 5
  done
  echo "HTTPS ok: https://$H/"
  node -e '
    const WebSocket = require(process.argv[2] + "/node_modules/ws")
    const ws = new WebSocket("wss://" + process.argv[1] + "/ws?room=cutover-check")
    const t = setTimeout(() => { console.error("WSS: no upgrade in 10 s"); process.exit(1) }, 10000)
    ws.on("open", () => { clearTimeout(t); console.log("WSS ok: upgrade to /ws"); ws.close(); process.exit(0) })
    ws.on("error", (e) => { console.error("WSS failed: " + e.message); process.exit(1) })
  ' "$H" "$REPO"
  node tools/net-smoke.mjs "https://$H/" 2>&1 | grep -E "^(FAIL|NET SMOKE)" | tee /tmp/syn3h-domain-check.log
  grep -q "^NET SMOKE OK" /tmp/syn3h-domain-check.log || die "net-smoke failed on $H"
  ;;

rollback)
  EXPORT="${1:-}"; [ $# -gt 0 ] && shift
  [ -f "$EXPORT/records.json" ] || die "give the export directory (from tools/domain.sh export)"
  check_hosts "$@"
  Z="$(zone_id)"; A="$(account_id)"
  for h in "$@"; do
    # Detach the Custom Domain; Cloudflare removes the record it created.
    for did in $(cf GET "/accounts/$A/workers/domains?hostname=$h" | jq -r '.result[].id'); do
      echo "Detaching Custom Domain $h ($did)"
      cf DELETE "/accounts/$A/workers/domains/$did" >/dev/null
    done
    web_records "$h" "$EXPORT/records.json" | jq -c '.[] | {type, name, content, proxied, ttl, comment}' | while read -r rec; do
      echo "Restoring $(printf '%s' "$rec" | jq -r '"\(.type) \(.name) -> \(.content)"')"
      cf POST "/zones/$Z/dns_records" "$rec" >/dev/null || echo "  (could not restore; it may already exist: check the dashboard)"
    done
  done
  echo "ROLLBACK DONE:$* are back on their exported records. Certificates made for the Custom"
  echo "Domain stay under SSL/TLS > Edge Certificates; they are harmless and can be deleted later."
  ;;

*)
  sed -n '2,15p' "$0"; exit 2 ;;
esac
