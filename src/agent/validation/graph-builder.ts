import { promises as fs } from "node:fs";
import path from "node:path";
import { ArchitectureContract, architectureContractV1 } from "./contract.js";
import { collectProductionFiles } from "./collect-files.js";
import { detectLayer, resolveRelativeImportTarget } from "./path-utils.js";
import { GraphBuildResult, GraphEdge, GraphNode, ValidationViolation } from "./types.js";

const importRegex = /\bimport\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]/g;
const exportFromRegex = /\bexport\s+[^"'`]+?\s+from\s+["'`]([^"'`]+)["'`]/g;
const requireRegex = /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

function collectImportSpecifiers(source: string): string[] {
  const values: string[] = [];
  for (const regex of [importRegex, exportFromRegex, requireRegex]) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while (true) {
      match = regex.exec(source);
      if (!match) {
        break;
      }

      const raw = (match[1] || "").trim();
      if (raw.length > 0) {
        values.push(raw);
      }
    }
  }
  return values;
}

function isExternalDependencyImport(specifier: string): boolean {
  if (specifier.startsWith("node:")) {
    return true;
  }

  if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
    return false;
  }

  if (specifier.startsWith("/") || specifier.startsWith("./") || specifier.startsWith("../")) {
    return false;
  }

  return true;
}

function isPathAliasLike(specifier: string, sourceRoot: string): boolean {
  if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
    return true;
  }

  return specifier.startsWith(`${sourceRoot}/`);
}

function summarizeCycle(cycle: string[]): string {
  return cycle.join(" -> ");
}

function detectCycles(nodes: GraphNode[], edges: GraphEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  const nodeIds = new Set<string>(nodes.map((entry) => entry.id));

  for (const node of nodes) {
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      continue;
    }

    adjacency.get(edge.from)?.push(edge.to);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const dedupe = new Set<string>();

  function dfs(nodeId: string): void {
    visiting.add(nodeId);
    stack.push(nodeId);

    for (const next of adjacency.get(nodeId) || []) {
      if (visiting.has(next)) {
        const startIndex = stack.lastIndexOf(next);
        if (startIndex >= 0) {
          const cycle = stack.slice(startIndex).concat(next);
          const key = summarizeCycle(cycle);
          if (!dedupe.has(key)) {
            dedupe.add(key);
            cycles.push(cycle);
          }
        }
        continue;
      }

      if (!visited.has(next)) {
        dfs(next);
      }
    }

    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id);
    }
  }

  return cycles;
}

export class GraphBuilder {
  private readonly projectRoot: string;
  private readonly contract: ArchitectureContract;

  constructor(input: { projectRoot: string; contract?: ArchitectureContract }) {
    this.projectRoot = path.resolve(input.projectRoot);
    this.contract = input.contract || architectureContractV1;
  }

  async build(): Promise<GraphBuildResult> {
    const violations: ValidationViolation[] = [];
    const files = await collectProductionFiles(this.projectRoot);
    const existingFiles = new Set(files.map((entry) => path.resolve(entry.absolutePath)));
    const absoluteToRelative = new Map<string, string>();
    for (const file of files) {
      absoluteToRelative.set(path.resolve(file.absolutePath), file.relativePath);
    }

    const nodes: GraphNode[] = [];
    const nodeById = new Map<string, GraphNode>();

    for (const file of files) {
      const detection = detectLayer(file.relativePath, this.contract);
      const node: GraphNode = {
        id: file.relativePath,
        absolutePath: file.absolutePath,
        relativePath: file.relativePath,
        moduleName: detection.moduleName,
        layer: detection.layer
      };

      nodes.push(node);
      nodeById.set(node.id, node);

      if (detection.unknownLayer && this.contract.rules.unknownLayer.enabled) {
        violations.push({
          ruleId: this.contract.rules.unknownLayer.id,
          severity: this.contract.rules.unknownLayer.severity,
          file: file.relativePath,
          message: `Unknown layer folder '${detection.unknownLayer}'.`
        });
      }
    }

    const edges: GraphEdge[] = [];

    for (const file of files) {
      let source = "";
      try {
        source = await fs.readFile(file.absolutePath, "utf8");
      } catch (error) {
        violations.push({
          ruleId: "GRAPH.READ_ERROR",
          severity: "error",
          file: file.relativePath,
          message: `Could not read source file: ${String((error as Error).message || error)}`
        });
        continue;
      }

      const imports = collectImportSpecifiers(source);
      for (const importPath of imports) {
        if (this.contract.enforceRelativeImportsOnly && !importPath.startsWith(".")) {
          const aliasLike = isPathAliasLike(importPath, this.contract.sourceRoot);
          if (aliasLike && this.contract.disallowPathAliases && this.contract.rules.nonRelativeImport.enabled) {
            violations.push({
              ruleId: this.contract.rules.nonRelativeImport.id,
              severity: this.contract.rules.nonRelativeImport.severity,
              file: file.relativePath,
              target: importPath,
              message: `Alias import '${importPath}' is not allowed by contract.`
            });
          }

          if (!aliasLike && !isExternalDependencyImport(importPath) && this.contract.rules.nonRelativeImport.enabled) {
            violations.push({
              ruleId: this.contract.rules.nonRelativeImport.id,
              severity: this.contract.rules.nonRelativeImport.severity,
              file: file.relativePath,
              target: importPath,
              message: `Non-relative project import '${importPath}' is not allowed by contract.`
            });
          }

          continue;
        }

        const targetAbsolute = resolveRelativeImportTarget({
          fromAbsolutePath: file.absolutePath,
          importPath,
          existingFiles
        });

        if (!targetAbsolute) {
          if (this.contract.rules.missingImportTarget.enabled) {
            violations.push({
              ruleId: this.contract.rules.missingImportTarget.id,
              severity: this.contract.rules.missingImportTarget.severity,
              file: file.relativePath,
              target: importPath,
              message: `Missing import target for '${importPath}'.`
            });
          }
          continue;
        }

        const targetRelative = absoluteToRelative.get(path.resolve(targetAbsolute));
        if (!targetRelative) {
          continue;
        }

        edges.push({
          from: file.relativePath,
          to: targetRelative,
          importPath
        });
      }
    }

    for (const edge of edges) {
      const sourceNode = nodeById.get(edge.from);
      const targetNode = nodeById.get(edge.to);

      if (!sourceNode || !targetNode) {
        continue;
      }

      if (this.contract.rules.layerMatrix.enabled && sourceNode.layer && targetNode.layer) {
        const allowed = this.contract.layerMatrix[sourceNode.layer] || [];
        if (!allowed.includes(targetNode.layer)) {
          violations.push({
            ruleId: this.contract.rules.layerMatrix.id,
            severity: this.contract.rules.layerMatrix.severity,
            file: sourceNode.relativePath,
            target: targetNode.relativePath,
            message: `Layer '${sourceNode.layer}' cannot import layer '${targetNode.layer}'.`
          });
        }
      }

      if (
        this.contract.moduleIsolation.enabled &&
        this.contract.moduleIsolation.disallowCrossModuleImports &&
        this.contract.rules.moduleIsolation.enabled &&
        sourceNode.moduleName &&
        targetNode.moduleName &&
        sourceNode.moduleName !== targetNode.moduleName
      ) {
        violations.push({
          ruleId: this.contract.rules.moduleIsolation.id,
          severity: this.contract.rules.moduleIsolation.severity,
          file: sourceNode.relativePath,
          target: targetNode.relativePath,
          message: `Cross-module import from '${sourceNode.moduleName}' to '${targetNode.moduleName}' is not allowed.`
        });
      }
    }

    const cycles = detectCycles(nodes, edges);
    if (this.contract.rules.cycleDependency.enabled) {
      for (const cycle of cycles) {
        const cycleStart = cycle[0] || "unknown";
        violations.push({
          ruleId: this.contract.rules.cycleDependency.id,
          severity: this.contract.rules.cycleDependency.severity,
          file: cycleStart,
          message: `Circular dependency detected: ${summarizeCycle(cycle)}`
        });
      }
    }

    return {
      nodes,
      edges,
      cycles,
      violations
    };
  }
}
