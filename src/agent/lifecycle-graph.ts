import type { AgentRunLifecycleStatus } from "./run-state-types.js";
import type { AgentRunJobStatus } from "./types.js";

export interface StateTransitionGraph<State extends string> {
  readonly id: string;
  readonly title: string;
  readonly states: readonly State[];
  readonly initialState: State;
  readonly terminalStates: readonly State[];
  readonly transitions: Readonly<Record<State, readonly State[]>>;
  readonly notes?: readonly string[];
}

export const lifecycleRunGraph: StateTransitionGraph<AgentRunLifecycleStatus> = {
  id: "agent-lifecycle-run",
  title: "Agent Lifecycle Run State Machine",
  states: ["queued", "running", "correcting", "optimizing", "validating", "complete", "failed", "cancelled"],
  initialState: "queued",
  terminalStates: ["complete", "failed", "cancelled"],
  transitions: {
    queued: ["running", "cancelled", "failed"],
    running: ["correcting", "optimizing", "validating", "failed", "complete", "cancelled"],
    correcting: ["running", "validating", "failed", "cancelled"],
    optimizing: ["running", "validating", "failed", "complete", "cancelled"],
    validating: ["running", "optimizing", "failed", "complete", "cancelled"],
    complete: [],
    failed: ["queued"],
    cancelled: ["queued"]
  },
  notes: [
    "Resume is explicit: only failed and cancelled runs may transition back to queued.",
    "Terminal states are complete, failed, and cancelled."
  ]
};

export const runJobGraph: StateTransitionGraph<AgentRunJobStatus> = {
  id: "agent-run-job",
  title: "Durable Run Job State Machine",
  states: ["queued", "claimed", "running", "complete", "failed"],
  initialState: "queued",
  terminalStates: ["complete", "failed"],
  transitions: {
    queued: ["claimed"],
    claimed: ["running", "complete", "failed"],
    running: ["claimed", "complete", "failed"],
    complete: [],
    failed: []
  },
  notes: [
    "running -> claimed is the lease-expiry reclaim edge.",
    "complete and failed are terminal job outcomes."
  ]
};

export function isAllowedStateTransition<State extends string>(
  graph: StateTransitionGraph<State>,
  current: State,
  next: State
): boolean {
  return graph.transitions[current].includes(next);
}

function sortStates<State extends string>(states: readonly State[]): State[] {
  return [...states].sort((left, right) => left.localeCompare(right, "en-US"));
}

function renderMermaid<State extends string>(graph: StateTransitionGraph<State>): string {
  const lines: string[] = ["stateDiagram-v2", `  [*] --> ${graph.initialState}`];

  for (const from of graph.states) {
    const nextStates = sortStates(graph.transitions[from]);
    if (nextStates.length === 0 && graph.terminalStates.includes(from)) {
      lines.push(`  ${from} --> [*]`);
      continue;
    }

    for (const next of nextStates) {
      lines.push(`  ${from} --> ${next}`);
    }
  }

  return lines.join("\n");
}

function renderTransitionTable<State extends string>(graph: StateTransitionGraph<State>): string {
  const lines = ["| State | Allowed Transitions |", "| --- | --- |"];

  for (const state of graph.states) {
    const next = sortStates(graph.transitions[state]);
    lines.push(`| \`${state}\` | ${next.length > 0 ? next.map((entry) => `\`${entry}\``).join(", ") : "\`(terminal)\`"} |`);
  }

  return lines.join("\n");
}

function renderSection<State extends string>(graph: StateTransitionGraph<State>): string {
  const lines = [`## ${graph.title}`, "", "```mermaid", renderMermaid(graph), "```", "", renderTransitionTable(graph)];

  if (graph.notes && graph.notes.length > 0) {
    lines.push("", "Notes:");
    for (const note of graph.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}

export function renderCanonicalStateMachineMarkdown(): string {
  return [
    "# Canonical State Machine",
    "",
    "This document is authoritative for DeepRun lifecycle transitions. It is generated from `src/agent/lifecycle-graph.ts`, and tests fail if the checked-in doc drifts from the canonical graph data.",
    "",
    renderSection(lifecycleRunGraph),
    "",
    renderSection(runJobGraph),
    ""
  ].join("\n");
}
