# Sourced by tools/release.sh, tools/rollback.sh and tools/domain.sh after they cd to the repo.
#
# The Cloudflare token is never exported. It is read once into an unexported shell variable,
# from CLOUDFLARE_API_TOKEN if the caller set it or else from the owner's token file (outside the
# repo, mode 600, one line; docs/CUTOVER.md, "Access"), and CLOUDFLARE_API_TOKEN is then removed
# from the environment. Only the commands that talk to Cloudflare get it, one at a time:
#
#   cf node "$WRANGLER" deploy ...   # the token is in this command's environment only
#   cf_token                          # prints it, for a curl header inside this script only
#
# so nothing else a release starts (Chrome, node checks, vite, wrangler dev --local) inherits it.
# On 17 Nov 2026 smoke Chromes inherited the exported token and wrote it into crash dumps.
# Never print the value.
SYN3H_CLOUDFLARE_TOKEN_FILE="${SYN3H_CLOUDFLARE_TOKEN_FILE:-$HOME/.config/syn3h/cloudflare-token}"
_syn3h_cf_token="${CLOUDFLARE_API_TOKEN:-}"
if [ -z "$_syn3h_cf_token" ] && [ -r "$SYN3H_CLOUDFLARE_TOKEN_FILE" ]; then
  _syn3h_cf_token="$(tr -d '\r\n' < "$SYN3H_CLOUDFLARE_TOKEN_FILE")"
fi
unset CLOUDFLARE_API_TOKEN
cf_token() { printf '%s' "$_syn3h_cf_token"; }
cf_has_token() { [ -n "$_syn3h_cf_token" ]; }
cf() { CLOUDFLARE_API_TOKEN="$_syn3h_cf_token" "$@"; }
