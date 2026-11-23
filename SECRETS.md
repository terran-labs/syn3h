# Secrets

Where each credential lives. Never put a value here, in a commit, a log, a note or a message.

| Name | Location | Scope | Issuer | Expiry |
| --- | --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | `~/.config/syn3h/cloudflare-token` (outside the repository, mode 600, one line) | Workers deploy and rollback for the account; DNS and Workers Routes for syn3h.com and mira.cc, and both zones' redirect rules. <!-- rename-keep --> The full permission table is in `docs/CUTOVER.md`, "Access". | The owner | None |

`tools/release.sh`, `tools/rollback.sh` and `tools/domain.sh` load the Cloudflare token from
its file through `tools/cloudflare-token.sh` when `CLOUDFLARE_API_TOKEN` is unset. To pass it
by hand, read it straight into the one command that needs it:

```sh
CLOUDFLARE_API_TOKEN="$(tr -d '\n' < ~/.config/syn3h/cloudflare-token)" tools/release.sh ...
```

Only the owner reissues it: replace the file's one line.
