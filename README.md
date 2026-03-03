# deeprun

**A deterministic governance layer for AI-assisted CI workflows.**

## The Problem

AI-generated code in CI can:
- Pass locally but fail unpredictably in production
- Retry indefinitely without clear failure boundaries
- Produce nondeterministic artifacts across runs
- Drift silently across tool upgrades

deeprun enforces:
- Bounded correction with hard limits
- Deterministic execution identity
- Machine-readable PASS/FAIL decisions
- Replayable governance results

## Where It Sits

```
AI Tool → deeprun → CI Pipeline → Deploy
```

Or as a CI gate:

```
Pull Request → deeprun (governance gate) → CI status check → Merge
```

deeprun validates AI-generated code before it reaches your pipeline.

## Quick Start

### Installation

```bash
git clone https://github.com/andrewbusc/_deeprun.git
cd _deeprun
npm install
npm run build
```

### Setup

1. Start the server:
```bash
npm run dev
```

2. In a new terminal, initialize CLI session:
```bash
npm run deeprun -- init --api http://127.0.0.1:3000 --email user@example.com --password password
```

3. Generate a backend:
```bash
npm run deeprun -- bootstrap "Build SaaS backend with auth"
npm run deeprun -- validate --strict-v1-ready
```

### Add to CI

```yaml
- name: deeprun Governance Gate
  run: |
    npm install
    npm run build
    npm run deeprun -- gate --strict-v1-ready
```

### Example Output

```json
{
  "decision": "FAIL",
  "reasonCodes": ["RUN_VALIDATION_FAILED"],
  "executionIdentityHash": "fff55f87868878e82470cf2b8ca6a5dd7c9a24c1a57eb1a7bef2bf071bd5d3e3",
  "artifacts": ["validation-report.json"],
  "correctionAttempts": 3,
  "maxCorrectionsReached": true
}
```

If the decision is `PASS`, the code is safe to deploy.

## What v1 Does

✅ Blocks unsafe AI-assisted PRs  
✅ Produces deterministic governance decisions  
✅ Emits structured artifacts and execution trace  
✅ Runs on-premises (no external dependencies)  
✅ Enforces architectural contracts on generated code  
✅ Validates Docker builds and health checks  

## What v1 Does NOT Do

❌ Distributed orchestration  
❌ Parallel graph execution  
❌ Planner auto-branching  
❌ CI pipeline replacement  

deeprun is a governance layer, not a CI system.

## Use Cases

**1. AI-Generated Backend Validation**
```bash
# After running init
npm run deeprun -- bootstrap "Build SaaS backend with auth"
npm run deeprun -- validate --strict-v1-ready
```

**2. CI Gate for AI-Assisted PRs**
```yaml
on: pull_request
jobs:
  governance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install && npm run build
      - run: npm run deeprun -- gate --strict-v1-ready
```

**3. Reliability Benchmarking**
```bash
npm run benchmark:reliability -- --iterations 10 --min-pass-rate 0.95
```

## Core Concepts

### Deterministic Execution Identity

Every run produces a frozen execution identity hash. Same input → same hash → same decision.

### Bounded Correction

AI correction attempts are hard-limited. No infinite retry loops.

### Machine-Readable Decisions

All governance decisions are structured JSON with reason codes, not prose.

### Replayable Governance

Execution traces can be replayed to verify decision integrity.

## Installation & Setup

See [docs/installation.md](docs/installation.md) for detailed setup instructions.

For operators: [docs/operator-guide.md](docs/operator-guide.md)

## Architecture

deeprun enforces a canonical backend architecture contract. Generated backends must:
- Boot without manual edits
- Pass all validation gates (light → heavy → v1-ready)
- Build successfully in Docker
- Return 200 from `/health` endpoint

See [docs/contracts/](docs/contracts/) for detailed specifications.

## CLI Commands

```bash
npm run deeprun -- init                    # Initialize session
npm run deeprun -- bootstrap <prompt>      # Generate backend + start run
npm run deeprun -- status                  # Check run status
npm run deeprun -- validate                # Run validation gates
npm run deeprun -- promote                 # Deploy to production
```

Full CLI reference: [docs/cli.md](docs/cli.md)

## CI Integration

deeprun provides GitHub Actions workflows:
- **CI Gate**: Type checking, tests, validation
- **V1 Ready Gate**: Docker build + health check
- **Reliability Benchmark**: Pass rate measurement

See [.github/workflows/](.github/workflows/) for examples.

## Reliability Metrics

deeprun measures a single north star metric:

**% of generated backends that deploy and boot without human edits**

Run the benchmark:

```bash
npm run benchmark:reliability
```

## Design Principles

### Execution Contract Immutability

The execution contract is frozen at v1. Changes require new major version.

### Correction Policy Enforcement

Correction attempts are classified, bounded, and auditable.

### Graph Governance

Execution graphs have deterministic identity. Drift is detectable.

### Fail-Fast Boot Sequence

Runtime compatibility is validated before the HTTP server starts.

## Development

```bash
git clone https://github.com/yourusername/deeprun.git
cd deeprun
npm install
npm run dev
```

Run tests:

```bash
npm run test:ci
npm run test:v1-ready
```

## License

MIT

## Status

v1.0.0 - Production Ready

All critical blockers resolved. System enforces runtime compatibility, schema migrations are idempotent, and error handling is production-hardened.
