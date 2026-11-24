# Brand exports

The game uses the vector wordmark. `favicon.svg` and the four platform PNGs come from
`logoSvg` in `src/ui/brand/LogoMark.ts`, with no bitmap input. PNG fallbacks remain committed
for social crawlers and home-screen icons, so ordinary builds need no browser.

The exports are named by set: `BRAND_SET` in `src/ui/brand/LogoMark.ts` (now `mira3`) prefixes
the share card, the icons (including a maskable icon whose art is scaled into the safe circle for
launchers that mask to a shape), the favicon and the manifest, which `generate.ts` writes from the
same constant so it always lists its own set. Every frozen version loads the set that was current
when it shipped, from the same address: the oldest files without a prefix, then `mira-`, then
`mira2-`, then `mira3-`. `tools/frozen-versions.mjs prepare` refuses a release that changes any of them, and
`node tools/rename-to-mira.mjs --check` reports it before a build. A redrawn mark changes
`BRAND_SET`, reruns the generator and points `index.html` at the new names; it never changes the
bytes at an address a released version uses.

Regenerate explicitly:

```sh
tools/heavy.sh npx tsx tools/brand/generate.ts
```

This command requires installed Chrome. Set `MIRA_CHROME` to use another Chromium
executable. An optional output directory supports comparison without replacing fallbacks.
All rendering completes before any existing image is replaced. Browser launch, font or
render errors exit unsuccessfully and preserve the existing files. Each output is written
through a temporary file and renamed; filesystem errors during publication can still leave
a partially updated set, so review the diff before committing.

Two consecutive exports on the same browser produced identical bytes. Dimensions are
1200 by 630 for sharing, 512, 192 and 180 square for platform icons, and 32 square for the
SVG favicon. Output size is 1,070,193 bytes combined, down from 4,555,257 bytes including
the removed source bitmaps. This reduces deployed files by 3,485,064 bytes; it does not
establish a first-frame speed improvement because the unused source logos were not loaded.

The original tracing command accepts an external source image. Its committed path remains
the source of the wordmark; no original bitmap is needed for exports or builds.

## Proposal: frozen pages take their brand files from the archive

Not built. Today the deploy carries two sets of install files: the Syn3h icons at the old names
(`favicon.svg`, `manifest.webmanifest`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`,
`share.png`), which every frozen version loads from the same address, and the Mira ones at the
`mira-` names. That is why the bitmap allow list holds ten files instead of six.

**How.** Add `/brand/*` to `run_worker_first` in `wrangler.toml` and `wrangler.staging.toml`, so
those requests reach the Worker. `serveVersioned` in `server/worker.ts` already chooses a frozen
page's files by the `v` in its Referer for `build.json` and models; brand files would take the same
path: a request whose Referer carries `?v=<frozen version>` is answered from R2
(`v/<version>/brand/...`), every other request from this deployment's own assets. The old-name
files then leave `public/brand`, the allow list returns to six, and `REQUIRED_BITMAPS` in
`tools/check-shipped-assets.mjs` keeps only the `mira-` names. Every archived version already has
its own brand files in R2, so nothing needs uploading. `tests/ops/frozen-r2-routing.test.ts` gains
the cases, and `tools/frozen-versions.mjs check` must send the Referer when it fetches a frozen
page's brand files.

**What it costs.**
- Every brand request becomes a Worker invocation: about three to five per page load (icon,
  touch icon, manifest and its icons), on the Free plan's daily request allowance, and those
  responses vary on Referer, so they cache per referring address.
- A frozen page's brand files are R2 reads (Class B operations), a handful per frozen visit.
- Requests without a usable Referer get the current files. Browsers send a Referer for page
  subresources, but an installed home-screen icon refreshed later by the system, a crawler, or a
  browser with a strict referrer policy would get the Mira icon even for a frozen page. The share
  card is unaffected: frozen pages' `og:image` names an absolute address of their own.
- One more Worker path to keep tested, for a saving of about 400 KB of deploy and four tracked
  bitmaps.

**Recommendation.** Worth doing only if the allow list's ceiling matters more than the extra
Worker traffic; the current two-set arrangement costs nothing at run time.

