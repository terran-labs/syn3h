# Sourced by tools/release.sh, tools/rollback.sh and tools/domain.sh after they cd to the repo.
#
# The Cloudflare token is never exported. It is read once into an unexported shell variable,
# from CLOUDFLARE_API_TOKEN if the caller set it or else from the owner's token file (outside the
# repo, mode 600, one line; docs/CUTOVER.md, "Access"), and CLOUDFLARE_API_TOKEN is then removed
# from the environment. Only the commands that talk to Cloudflare get it, one at a time:
#
#   with_cf_token node "$WRANGLER" deploy ...   the token is in this command's environment only
#   cf_curl -sS "$API/..."                      curl with the Authorization header read from
#                                               standard input, so the token is never in an argv
#
# so nothing else a release starts (Chrome, node checks, vite, wrangler dev --local) inherits it.
# On 17 Nov 2026 smoke Chromes inherited the exported token and wrote it into crash dumps.
# Never print the value. (tools/domain.sh has its own `cf`, an API helper built on cf_curl.)
MIRA_CLOUDFLARE_TOKEN_FILE="${MIRA_CLOUDFLARE_TOKEN_FILE:-$HOME/.config/syn3h/cloudflare-token}"
_mira_cf_token="${CLOUDFLARE_API_TOKEN:-}"
if [ -z "$_mira_cf_token" ] && [ -r "$MIRA_CLOUDFLARE_TOKEN_FILE" ]; then
  _mira_cf_token="$(tr -d '\r\n' < "$MIRA_CLOUDFLARE_TOKEN_FILE")"
fi
unset CLOUDFLARE_API_TOKEN
cf_has_token() { [ -n "$_mira_cf_token" ]; }
with_cf_token() { CLOUDFLARE_API_TOKEN="$_mira_cf_token" "$@"; }
# printf is a shell builtin: the header line goes down the pipe, never into a process's argv.
cf_curl() { printf 'Authorization: Bearer %s\n' "$_mira_cf_token" | curl -H @- "$@"; }
