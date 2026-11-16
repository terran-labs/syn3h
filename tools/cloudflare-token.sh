# Sourced by tools/release.sh, tools/rollback.sh and tools/domain.sh after they cd to the repo.
# When CLOUDFLARE_API_TOKEN is unset, load it from the owner's token file (outside the repo,
# mode 600, one line; docs/CUTOVER.md, "Access"). Never print the value.
SYN3H_CLOUDFLARE_TOKEN_FILE="${SYN3H_CLOUDFLARE_TOKEN_FILE:-$HOME/.config/syn3h/cloudflare-token}"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -r "$SYN3H_CLOUDFLARE_TOKEN_FILE" ]; then
  CLOUDFLARE_API_TOKEN="$(tr -d '\r\n' < "$SYN3H_CLOUDFLARE_TOKEN_FILE")"
  export CLOUDFLARE_API_TOKEN
fi
