# V2 observation structure, first implementation stage

Source prepared for review only. Tests are written and unrun. No collector or semantic
observation validator is implemented, and no measurement becomes eligible.

The exact envelope types are in tools/performance-release/observation-v2.d.ts. Import
`validateV2Envelope` from observation-v2.mjs with evidence, separately reviewed Expectations
and a separately supplied coordinator-verified blob manifest. It always returns
`qualified: false`, `promotion: blocked`, `status: unsupported/not-qualified` and names
semantic-observation-validation as unsupported. `structureValid` reports only structural
integrity. The existing comparison API explicitly rejects v2 as unsupported. Historical
v1 comparison/rendering is otherwise unchanged; the future release gate must require v2
when observation qualification becomes available.

## Explicit graph boundary

Each artifact has exactly schemaVersion, kind, payload, references and blobs. Payload
contains runId and records. Records are finite JSON retained for later semantic checks;
they are not interpreted or accepted as measured facts at this stage. All observation
graph edges live in references and all external blob dependencies live in blobs, rather
than being guessed by recursively searching arbitrary protocol records. Subsequent
semantic validators must bind any payload references to these declared dependencies.
This normalizes the earlier proposal's optional runtime observationEvidence field into
the common explicit references array.

Every run, including A/A calibration, requires exactly the eight named root kinds.
Artifact keys hash the entire canonical artifact. Run hashes include observation roots.
Global run IDs must be unique. References must resolve to the stated kind and owner;
cross-run references, cycles, duplicate edges, unknown owners and orphan artifacts fail.
All blob dependencies must be present with the exact size in the separately verified
manifest. Supplying a claimed verified manifest inside evidence does not authorize it.
The coordinator remains responsible for hashing actual blob bytes.

Policy, fixture and calibration contents bind to their trusted expectation hashes.
Observation policy binds its reviewed allowed frozen inventory digest and a distinct
list of fixture-required fetched resources. Carried historical builds may belong to
the allowed inventory without being required startup requests. This stage neither
expands that required subset nor validates resource-fetch semantics. Runtime policy
carries opaque reviewed deployment-manifest digests; it does not define or finalize
artifact configuration or the no-rebundle path.

Structural checks deliberately do not validate startup feasibility, transfer byte
semantics, actual resource identity, frame timing, cache proof, physical conditions,
process closure, benchmark precision or production policy thresholds. Those remain
unsupported regardless of structural success. Hash integrity is not observation trust.

## Prepared tests and proposed command

Cases cover every required kind, artifact and run hash tampering, policy binding,
missing references/blobs, blob size mismatches, duplicate run IDs, cross-run roots and
nested references, graph cycles/orphans, valid same-run references, malformed JSON,
unchanged historical v1 rendering and permanently blocked v2 measurement qualification.
No tests were executed for this stage.

Proposed command, only after explicit test allocation:

```sh
/Users/vtn/dev/Syn3h/tools/heavy.sh node --test --test-concurrency=2 tools/performance-release/index.test.mjs tools/performance-release/observation-v2.test.mjs
```

No server, browser, build or benchmark is part of that proposed command.
