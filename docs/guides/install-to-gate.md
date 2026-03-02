# Install To Gate

This is the shortest supported path from clone to a blocking governance decision.

## 1. Install

```bash
git clone <your-repo-url> deeprun
cd deeprun
npm ci
```

## 2. Configure

Set the minimum runtime environment:

```bash
export DATABASE_URL='postgres://user:pass@127.0.0.1:5432/deeprun'
export DATABASE_SSL=disable
export DEEPRUN_WORKSPACE_ROOT=/absolute/path/to/workspace
export PORT=3000
```

If you want model-backed generation, also set your provider key.

## 3. Start The API

```bash
npm run dev
```

Wait for `GET /api/health` to return `200`.

## 4. Start A Worker

In a second shell:

```bash
export NODE_ID=compute-node-01
export NODE_ROLE=compute
npm run worker:agent-jobs
```

## 5. Initialize The CLI Session

```bash
npm run deeprun -- \
  init \
  --api http://127.0.0.1:3000 \
  --email you@example.com \
  --password 'Password123!' \
  --name 'Your Name' \
  --org 'Your Org' \
  --workspace 'Your Workspace'
```

## 6. Run A Queued Build

```bash
npm run deeprun -- \
  run "Build backend change" \
  --engine kernel \
  --provider mock \
  --profile ci \
  --wait \
  --project-name "Integration Project"
```

The run command prints `PROJECT_ID=` and `RUN_ID=` lines. Keep both values.

## 7. Produce The Governance Decision

```bash
npm run deeprun -- \
  gate \
  --project <PROJECT_ID> \
  --run <RUN_ID> \
  --output .deeprun/governance-decision.json
```

For the strict readiness gate:

```bash
npm run deeprun -- \
  gate \
  --project <PROJECT_ID> \
  --run <RUN_ID> \
  --strict-v1-ready \
  --output .deeprun/governance-decision.json
```

## 8. Consume Only The Decision File

Your CI logic should read only:

- `decision`
- `reasonCodes`
- `contract.hash`

Artifacts are diagnostic and optional.

Example:

```bash
node -e 'const fs=require("node:fs"); const d=JSON.parse(fs.readFileSync(".deeprun/governance-decision.json","utf8")); process.exit(d.decision==="PASS"?0:1)'
```

## Stable Failure Codes

Common reason codes you should branch on:

- `RUN_NOT_COMPLETE`
- `RUN_NOT_VALIDATED`
- `RUN_VALIDATION_FAILED`
- `RUN_V1_READY_FAILED`
- `UNSUPPORTED_CONTRACT`
- `EXECUTION_CONTRACT_MISSING`

## Public Fresh-Install Proof

This repo also ships public integration proofs that use only the public CLI/API path:

```bash
npm run integration:fresh-gate -- --api http://127.0.0.1:3000 --mode pass --output .deeprun/fresh-integration/pass.json
npm run integration:fresh-gate -- --api http://127.0.0.1:3000 --mode fail --output .deeprun/fresh-integration/fail.json
```

Those scripts are intended for CI and validate the decision payload without reading logs.
