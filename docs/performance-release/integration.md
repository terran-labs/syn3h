# Integrating the pure report module

Import from `tools/performance-release/index.mjs`. No functions start processes or access
the filesystem or network. The release coordinator owns loading artifacts, deriving
trusted expectations, verifying archived bytes, writing outputs and publishing.

```js
import { compareEvidence, renderPerformance, renderChart, canonicalJson } from
  './performance-release/index.mjs'

// expected comes from the frozen release manifest and separately approved policy.
const report = compareEvidence(evidence, expected)
const markdown = renderPerformance(report, { version, assetBaseUrl })
const svg = renderChart(report)
// Write canonicalJson(report) under report.assets.report and svg under assets.chart.
// Embed the same markdown string in notes and any actual release PR.
// Block ordinary performance acceptance unless report.promotion === 'eligible'.
```

Do not load a supplied report and trust its status. Always call `compareEvidence` with
original evidence and trusted expectations. No exception input exists in this API.
An exception is a separately reviewed coordinator action that retains the failed or
unavailable comparison and its reason in public notes.

`validateEvidence` returns structured issues without throwing for malformed submissions.
`compareEvidence` returns a blocked report for invalid input when the gate supplies valid
expectations. `renderPerformance` rejects a mismatched candidate version or a non-HTTPS
asset base. The gate must verify the asset base is immutable and that every link resolves;
HTTPS syntax alone does not prove either property.

The report and chart names hash computed report content before adding the two derived
names. To reproduce that identity, omit `assets.report` and `assets.chart` from the report
and hash its canonical JSON. Raw files contain canonical run payloads without
`rawSha256`. Fixture and calibration files contain their canonical embedded payloads.
The full submitted evidence must also be retained by the coordinator so the report can
be recomputed. The report records its evidence and policy hashes.

The SVG has one consistent zero-based axis for each metric across scenes and phases.
The Markdown table includes the same values, rounded to three decimal places for display;
full precision remains in JSON. The chart is source-generated documentation only.
Actual GitHub rendering and immutable asset HTTP checks remain publication acceptance
work, not established by the synthetic tests.

Run the synthetic tests only in an authorized slot:

```sh
/Users/vtn/dev/Syn3h/tools/heavy.sh node --test --test-concurrency=2 tools/performance-release/index.test.mjs
```

The tests import only Node built-ins and existing pure helpers. Their generated inputs
are explicitly synthetic. Passing them validates report logic, not game frame rate,
GPU cost, production policy thresholds, collector accuracy or first-baseline readiness.
