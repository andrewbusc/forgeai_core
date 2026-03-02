# Canonical State Machine

This document is authoritative for DeepRun lifecycle transitions. It is generated from `src/agent/lifecycle-graph.ts`, and tests fail if the checked-in doc drifts from the canonical graph data.

## Agent Lifecycle Run State Machine

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> cancelled
  queued --> failed
  queued --> running
  running --> cancelled
  running --> complete
  running --> correcting
  running --> failed
  running --> optimizing
  running --> validating
  correcting --> cancelled
  correcting --> failed
  correcting --> running
  correcting --> validating
  optimizing --> cancelled
  optimizing --> complete
  optimizing --> failed
  optimizing --> running
  optimizing --> validating
  validating --> cancelled
  validating --> complete
  validating --> failed
  validating --> optimizing
  validating --> running
  complete --> [*]
  failed --> queued
  cancelled --> queued
```

| State | Allowed Transitions |
| --- | --- |
| `queued` | `cancelled`, `failed`, `running` |
| `running` | `cancelled`, `complete`, `correcting`, `failed`, `optimizing`, `validating` |
| `correcting` | `cancelled`, `failed`, `running`, `validating` |
| `optimizing` | `cancelled`, `complete`, `failed`, `running`, `validating` |
| `validating` | `cancelled`, `complete`, `failed`, `optimizing`, `running` |
| `complete` | `(terminal)` |
| `failed` | `queued` |
| `cancelled` | `queued` |

Notes:
- Resume is explicit: only failed and cancelled runs may transition back to queued.
- Terminal states are complete, failed, and cancelled.

## Durable Run Job State Machine

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> claimed
  claimed --> complete
  claimed --> failed
  claimed --> running
  running --> claimed
  running --> complete
  running --> failed
  complete --> [*]
  failed --> [*]
```

| State | Allowed Transitions |
| --- | --- |
| `queued` | `claimed` |
| `claimed` | `complete`, `failed`, `running` |
| `running` | `claimed`, `complete`, `failed` |
| `complete` | `(terminal)` |
| `failed` | `(terminal)` |

Notes:
- running -> claimed is the lease-expiry reclaim edge.
- complete and failed are terminal job outcomes.
