# Governance Decision Contract

The governance decision payload is the external blocking authority contract for CI and release orchestration. CI should consume this payload like a compiler result: read one file, branch on `decision`, optionally inspect `reasonCodes`, and never scrape logs for pass/fail.

## Schema

Current schema version: `2`

```json
{
  "decisionSchemaVersion": 2,
  "decisionHash": "sha256(payloadWithoutHash)",
  "decision": "PASS | FAIL",
  "reasonCodes": ["stable_reason_code"],
  "reasons": [
    {
      "code": "stable_reason_code",
      "message": "optional",
      "details": {}
    }
  ],
  "runId": "uuid",
  "contract": {
    "schemaVersion": 1,
    "hash": "sha256",
    "determinismPolicyVersion": 1,
    "plannerPolicyVersion": 1,
    "correctionRecipeVersion": 1,
    "validationPolicyVersion": 1,
    "randomnessSeed": "forbidden:no-random-branching"
  },
  "artifactRefs": [
    {
      "kind": "string",
      "path": "string",
      "contentType": "optional",
      "sessionId": "optional"
    }
  ]
}
```

## Decision Hash

`decisionHash = sha256(canonicalJson(payloadWithoutHash))`

Canonical JSON rules:

- object keys are recursively sorted
- arrays preserve order
- the hash is computed before adding `decisionHash` to the payload

The same payload must always produce the same `decisionHash`.

## Reason Codes

Stable machine-readable codes currently include:

- `EXECUTION_CONTRACT_MISSING`
- `UNSUPPORTED_CONTRACT`
- `RUN_NOT_COMPLETE`
- `RUN_NOT_VALIDATED`
- `RUN_VALIDATION_FAILED`
- `RUN_COMMIT_UNPINNED`
- `RUN_V1_READY_NOT_RUN`
- `RUN_V1_READY_FAILED`

CI should prefer `reasonCodes[]` for gating and routing. The richer `reasons[]` objects exist for audits and UI.

## Decision Rule

`PASS` means the run is externally promotable under the requested governance mode.

`FAIL` means the pipeline must stop based only on the decision payload.

The CI contract is intentionally narrow:

- branch on `decision`
- optionally match on `reasonCodes`
- optionally pin on `contract.hash`
- do not parse stdout/stderr for pass/fail

## API

Authenticated endpoint:

- `POST /api/projects/:projectId/governance/decision`

Body:

```json
{
  "runId": "uuid",
  "strictV1Ready": false
}
```

## CLI

```bash
deeprun gate --project <projectId> --run <runId> [--strict-v1-ready] [--output <path>]
```

Behavior:

- emits the JSON payload to stdout
- writes the same payload to `--output` when provided
- always persists the authoritative content-addressed file under:
  - `.deeprun/decisions/<decisionHash>.json`
  - `.deeprun/decisions/latest.json` as a convenience pointer
- exits `0` on `PASS`
- exits `1` on `FAIL`

CI logic should ignore the CLI process output for correctness and read the decision file only.
