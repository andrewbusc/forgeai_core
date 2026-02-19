import type { RecognizedLayer } from "./contract.js";

export type ViolationSeverity = "error" | "warning";

export interface ValidationViolation {
  ruleId: string;
  severity: ViolationSeverity;
  file: string;
  target?: string;
  message: string;
}

export interface SourceFileEntry {
  absolutePath: string;
  relativePath: string;
}

export interface GraphNode {
  id: string;
  absolutePath: string;
  relativePath: string;
  moduleName: string | null;
  layer: RecognizedLayer | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  importPath: string;
}

export interface GraphBuildResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: string[][];
  violations: ValidationViolation[];
}
