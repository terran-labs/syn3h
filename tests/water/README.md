# Water verification

Water features default on. Explicit off settings remain valid, volcanic recipes keep lava,
and dry planets omit the sea. The old `water=1` shortcut also changes the sea type, so it
must never run unconditionally during normal entry.

Run every test and browser command through the integration checkout's `tools/heavy.sh`.
Use at most two test workers and queue one heavy job per lane.

- `npm run typecheck`
- `npx vitest run tests/water --maxWorkers=2`
- `node tools/water/normal-entry.mjs BASE OUT`: fresh lobby entry, enabled defaults,
  volcanic/alpine/Moon recipes, and explicit off. No water activation URL.
- `node tools/water/audit.mjs BASE OUT MODE [VEHICLE]`: modes `wake`, `wind`, `mist`,
  `falls`, `current`, and `vehicle`. Vehicle mode settles the craft, then holds forward
  for the hovercraft and tank or lift for the jet. Reports and screenshots go to OUT.
- `WATER_HEADED=1 node tools/water/audit.mjs BASE OUT falls`: a real window, with sheet
  visibility toggled off/on/off for GPU-completion timing and draw counts. Treat differences
  smaller than the two baseline runs' variation as inconclusive.

The wake check holds the buggy at a known speed and waterline to isolate rendering. It
does not establish natural planing behavior. The buoyancy tests exercise sinking, planing,
seabed driving and wing escape separately. The river capture applies no driving input.
The jet's hover controller can hold it above water; a stationary jet is not a sinking test.

Falling sheets are visual arcs above the existing river surface. Their trajectory follows
gravity; banks, shallow slopes and excessive launch speeds reject a sheet. Each drop gets
at most one sheet, with at most 66 vertices. Geometry rebuilds when gravity or the river
speed cap changes. Liquid queries and vehicle force equations are unchanged.
