# Proof Pack Benchmark Contract

The proof-pack benchmark artifact is the machine-readable benchmark contract for DeepRun. Consumers should treat it as the authoritative benchmark result bundle, not scrape logs for pass/fail.

## Payload

The benchmark writes a JSON payload with:

- `proofPackSchemaVersion`
- `startedAt`
- `finishedAt`
- `git.sha`
- `config`
- `steps[]`
- `summary`
- `proofPackHash`

## Hashing

`proofPackHash = sha256(canonicalJson(payloadWithoutHash))`

Rules:

- keys are sorted lexicographically during canonicalization
- arrays preserve order
- `proofPackHash` is computed before adding `proofPackHash` to the payload
- identical payloads must produce identical hashes

## Persistence

The benchmark persists:

- canonical benchmark-local copy:
  - `.deeprun/benchmarks/<timestamp>-<sha>/proof-pack.json`
- content-addressed authoritative copy:
  - `.deeprun/benchmarks/proof-packs/<proofPackHash>.json`
- convenience pointer:
  - `.deeprun/benchmarks/proof-packs/latest.json`

The content-addressed copy is authoritative. The timestamped copy exists to keep the benchmark-local artifact bundle self-contained.

## CI Rule

CI may upload all benchmark artifacts, but any machine decision about benchmark success should be derived from:

- `summary.ok`
- `summary.failedSteps`
- `proofPackHash`

and not from stdout/stderr parsing.
