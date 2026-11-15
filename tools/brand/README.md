# Brand exports

The game uses the vector wordmark. `favicon.svg` and the four platform PNGs come from
`logoSvg` in `src/ui/brand/LogoMark.ts`, with no bitmap input. PNG fallbacks remain committed
for social crawlers and home-screen icons, so ordinary builds need no browser.

Regenerate explicitly:

```sh
tools/heavy.sh npx tsx tools/brand/generate.ts
```

This command requires installed Chrome. Set `SYN3H_CHROME` to use another Chromium
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
