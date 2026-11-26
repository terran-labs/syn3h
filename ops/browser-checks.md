# Browser checks

Run the default browser core for each release. Use named checks when changing their area, or `--all` for an intentional UI sweep. For a check marked C in [the inventory](browser-check-inventory.csv), its next edit must replace the brittle assertions with the listed player invariant or delete the check. A changed layout, label or tuning value alone is no reason to update an expected value.

The UI runner reads [the shared list](browser-core.json) in order. The release core also includes one transport interruption through the proxy in `tools/reconnect-check.mjs` and the production asset gate in `tools/runtime-assets-check.mjs`. Each standalone script documents its setup. Release tiers should invoke the asset gate once.

The November 26 inventory uses main at `8b44e5a6` as its historical baseline. The decision column records the approved disposition, including retired scripts so they can be traced. A, B, C and D in the audit column record the original core, on-demand, rewrite and delete recommendations. X marks protected checks and files outside the audit. The historical discovery and duration columns describe the old runner. Durations are median passing wall times from available logs and include server startup.
