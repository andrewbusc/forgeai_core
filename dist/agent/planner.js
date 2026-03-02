import { randomUUID } from "node:crypto";
import path from "node:path";
import { collectFiles } from "../lib/fs-utils.js";
import { agentPlanSchema, agentStepSchema, withAgentPlanCapabilities, withAgentStepCapabilities } from "./types.js";
function parseRequestTimeoutMs(value, fallbackMs) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1_000) {
        return fallbackMs;
    }
    return Math.floor(parsed);
}
const defaultPlannerTimeoutMs = parseRequestTimeoutMs(process.env.DEEPRUN_PLANNER_TIMEOUT_MS, 120_000);
const planResponseSchemaLiteral = `{
  "goal": "string",
  "steps": [
    {
      "id": "step-1",
      "type": "analyze | modify | verify",
      "tool": "read_file | write_file | apply_patch | list_files | run_preview_container | fetch_runtime_logs",
      "mutates": "boolean (true for modify steps, false/omit otherwise)",
      "input": {}
    }
  ]
}`;
const correctionResponseSchemaLiteral = `{
  "id": "runtime-correction-1",
  "type": "modify",
  "tool": "write_file | apply_patch",
  "mutates": true,
  "input": {}
}`;
const correctionStepSchema = agentStepSchema.refine((step) => step.type === "modify" && (step.tool === "write_file" || step.tool === "apply_patch"), "Correction step must be a modify step that uses write_file or apply_patch.");
function getProviderConfig(providerId) {
    if (providerId === "openai") {
        const apiKey = process.env.OPENAI_API_KEY || "";
        const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
        const defaultModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY is not configured.");
        }
        return { apiKey, baseUrl, defaultModel };
    }
    if (providerId === "openrouter") {
        const apiKey = process.env.OPENROUTER_API_KEY || "";
        const baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
        const defaultModel = process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini";
        if (!apiKey) {
            throw new Error("OPENROUTER_API_KEY is not configured.");
        }
        return { apiKey, baseUrl, defaultModel };
    }
    throw new Error(`Unsupported planner provider: ${providerId}`);
}
function parseJsonPayload(input) {
    if (typeof input === "object" && input && !Array.isArray(input)) {
        return input;
    }
    if (typeof input !== "string") {
        throw new Error("Planner returned unsupported response format.");
    }
    const trimmed = input.trim();
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const raw = fenceMatch?.[1] ?? trimmed;
    return JSON.parse(raw);
}
function buildFallbackPlan(goal) {
    return withAgentPlanCapabilities({
        goal,
        steps: [
            {
                id: "step-1",
                type: "analyze",
                tool: "list_files",
                input: {
                    path: ".",
                    maxEntries: 120
                }
            },
            {
                id: "step-2",
                type: "analyze",
                tool: "read_file",
                input: {
                    path: "README.md"
                }
            }
        ]
    });
}
function trimLogPayload(value, maxLength = 12_000) {
    if (value.length <= maxLength) {
        return value;
    }
    return value.slice(value.length - maxLength);
}
function buildMemoryContextBlock(memory) {
    if (!memory) {
        return "No project memory available.";
    }
    try {
        return JSON.stringify(memory, null, 2);
    }
    catch {
        return "Project memory present but failed to serialize.";
    }
}
function buildFailureReportBlock(input) {
    if (!input || !Array.isArray(input.failures) || input.failures.length === 0) {
        return "No structured failure report available.";
    }
    try {
        return JSON.stringify({
            summary: input.summary,
            failures: input.failures.slice(0, 20)
        }, null, 2);
    }
    catch {
        return "Structured failure report present but could not be serialized.";
    }
}
function buildCorrectionConstraintBlock(input) {
    if (!input) {
        return "No explicit correction constraint provided.";
    }
    try {
        return JSON.stringify(input, null, 2);
    }
    catch {
        return "Correction constraint present but could not be serialized.";
    }
}
function buildCorrectionClusterLines(profile) {
    const clusters = Array.isArray(profile.clusters) ? profile.clusters : [];
    if (!clusters.length) {
        return ["- none (legacy correction profile without cluster breakdown)"];
    }
    return clusters.map((cluster) => {
        switch (cluster.type) {
            case "architecture_contract": {
                const segments = ["- architecture_contract"];
                if (Array.isArray(cluster.modules) && cluster.modules.length) {
                    segments.push(`modules=${cluster.modules.join(", ")}`);
                }
                if (Array.isArray(cluster.missingLayers) && cluster.missingLayers.length) {
                    segments.push(`missingLayers=${cluster.missingLayers.join(", ")}`);
                }
                if (Array.isArray(cluster.unknownLayerFiles) && cluster.unknownLayerFiles.length) {
                    segments.push(`unknownLayerFiles=${cluster.unknownLayerFiles.join(", ")}`);
                }
                return segments.join(" | ");
            }
            case "dependency_cycle": {
                const cyclePreview = Array.isArray(cluster.cycles) && cluster.cycles.length ? ` | cycles=${cluster.cycles.slice(0, 2).join(" || ")}` : "";
                return `- dependency_cycle${cyclePreview}`;
            }
            case "runtime_middleware_api":
                return `- runtime_middleware_api${cluster.message ? ` | message=${cluster.message}` : ""}`;
            case "layer_boundary_violation": {
                const segments = ["- layer_boundary_violation"];
                if (Array.isArray(cluster.files) && cluster.files.length) {
                    segments.push(`files=${cluster.files.join(", ")}`);
                }
                return segments.join(" | ");
            }
            case "import_resolution_error": {
                const segments = ["- import_resolution_error"];
                if (Array.isArray(cluster.files) && cluster.files.length) {
                    segments.push(`files=${cluster.files.join(", ")}`);
                }
                if (Array.isArray(cluster.imports) && cluster.imports.length) {
                    segments.push(`imports=${cluster.imports.join(", ")}`);
                }
                return segments.join(" | ");
            }
            case "test_contract_gap": {
                const segments = ["- test_contract_gap"];
                if (Array.isArray(cluster.modules) && cluster.modules.length) {
                    segments.push(`modules=${cluster.modules.join(", ")}`);
                }
                return segments.join(" | ");
            }
            case "typecheck_failure":
            case "build_failure":
            case "test_failure":
                return `- ${cluster.type}`;
            default:
                return `- ${String(cluster.type || "unknown_cluster")}`;
        }
    });
}
function isMicroPrimaryCluster(cluster) {
    return (cluster.type === "layer_boundary_violation" ||
        cluster.type === "import_resolution_error" ||
        cluster.type === "test_contract_gap");
}
function isMicroAuxiliaryCluster(cluster) {
    return (cluster.type === "typecheck_failure" ||
        cluster.type === "build_failure" ||
        cluster.type === "test_failure");
}
function collectMicroRepairScope(profile) {
    const clusters = Array.isArray(profile.clusters) ? profile.clusters : [];
    return clusters.filter((cluster) => isMicroPrimaryCluster(cluster) || isMicroAuxiliaryCluster(cluster));
}
function normalizeMicroAllowedFilePath(value) {
    const normalized = value.replaceAll("\\", "/").trim();
    if (!normalized) {
        return null;
    }
    // Reject validation/temp/build artifacts outright.
    if (normalized.includes("/.deeprun/") ||
        normalized.includes("/dist/") ||
        normalized.includes("/node_modules/")) {
        return null;
    }
    let candidate = normalized;
    if (!candidate.startsWith("src/")) {
        const srcSegmentIndex = candidate.lastIndexOf("/src/");
        if (srcSegmentIndex < 0) {
            return null;
        }
        candidate = candidate.slice(srcSegmentIndex + 1);
    }
    candidate = candidate.replace(/^\/+/, "");
    if (!candidate.startsWith("src/")) {
        return null;
    }
    if (candidate.startsWith("src/.deeprun") ||
        candidate.includes("/.deeprun/") ||
        candidate.includes("/dist/") ||
        candidate.includes("/node_modules/")) {
        return null;
    }
    return candidate;
}
function extractModuleNameFromSrcPath(value) {
    const normalized = value.replaceAll("\\", "/");
    const match = normalized.match(/^src\/modules\/([^/]+)/);
    if (!match?.[1]) {
        return null;
    }
    return match[1].trim() || null;
}
function addCanonicalModuleRepairSurface(files, moduleName) {
    const trimmed = moduleName.trim();
    if (!trimmed) {
        return;
    }
    // Keep scoped expansion bounded to the same module.
    files.add(`src/modules/${trimmed}/tests`);
    files.add(`src/modules/${trimmed}/service`);
    files.add(`src/modules/${trimmed}/repository`);
    files.add(`src/modules/${trimmed}/controller`);
    files.add(`src/modules/${trimmed}/dto`);
    files.add(`src/modules/${trimmed}/schema`);
}
function addResolvedImportTargets(files, sourceFile, importTarget) {
    const sourceNormalized = normalizeMicroAllowedFilePath(sourceFile);
    if (!sourceNormalized) {
        return;
    }
    const target = importTarget.replaceAll("\\", "/").trim();
    if (!target) {
        return;
    }
    const resolvedCandidates = new Set();
    if (target.startsWith(".")) {
        const baseDir = path.posix.dirname(sourceNormalized);
        resolvedCandidates.add(path.posix.normalize(path.posix.join(baseDir, target)));
    }
    else {
        resolvedCandidates.add(target);
    }
    for (const candidate of resolvedCandidates) {
        const normalizedCandidateRaw = normalizeMicroAllowedFilePath(candidate);
        if (!normalizedCandidateRaw) {
            continue;
        }
        let normalizedCandidate = normalizedCandidateRaw;
        const infraLiftMatch = normalizedCandidateRaw.match(/^src\/modules\/(db|middleware|config|errors|lib|types)\/(.+)$/i);
        if (infraLiftMatch?.[1] && infraLiftMatch?.[2]) {
            normalizedCandidate = `src/${infraLiftMatch[1]}/${infraLiftMatch[2]}`;
        }
        if (normalizedCandidate.endsWith(".js")) {
            files.add(normalizedCandidate.replace(/\.js$/, ".ts"));
            continue;
        }
        files.add(normalizedCandidate);
    }
}
function collectMicroAllowedFiles(profile) {
    const files = new Set();
    for (const cluster of Array.isArray(profile.clusters) ? profile.clusters : []) {
        if (cluster.type === "layer_boundary_violation") {
            for (const file of Array.isArray(cluster.files) ? cluster.files : []) {
                if (typeof file === "string" && file.trim()) {
                    const normalizedPath = normalizeMicroAllowedFilePath(file);
                    if (normalizedPath) {
                        files.add(normalizedPath);
                        const moduleName = extractModuleNameFromSrcPath(normalizedPath);
                        if (moduleName) {
                            addCanonicalModuleRepairSurface(files, moduleName);
                        }
                    }
                }
            }
            for (const edge of Array.isArray(cluster.edges) ? cluster.edges : []) {
                const edgeTarget = typeof edge?.target === "string" ? edge.target : "";
                const normalizedTarget = normalizeMicroAllowedFilePath(edgeTarget);
                if (!normalizedTarget) {
                    continue;
                }
                files.add(normalizedTarget);
                const targetModule = extractModuleNameFromSrcPath(normalizedTarget);
                if (targetModule) {
                    addCanonicalModuleRepairSurface(files, targetModule);
                }
            }
            continue;
        }
        if (cluster.type === "import_resolution_error") {
            const importTargets = Array.isArray(cluster.imports) ? cluster.imports.filter((value) => typeof value === "string") : [];
            const sourceFiles = Array.isArray(cluster.files) ? cluster.files.filter((value) => typeof value === "string") : [];
            for (const file of sourceFiles) {
                const normalizedPath = normalizeMicroAllowedFilePath(file);
                if (normalizedPath) {
                    files.add(normalizedPath);
                }
            }
            for (const sourceFile of sourceFiles) {
                for (const importTarget of importTargets) {
                    addResolvedImportTargets(files, sourceFile, importTarget);
                }
            }
            continue;
        }
        if (cluster.type === "test_contract_gap") {
            for (const moduleName of Array.isArray(cluster.modules) ? cluster.modules : []) {
                if (typeof moduleName !== "string" || !moduleName.trim()) {
                    continue;
                }
                addCanonicalModuleRepairSurface(files, moduleName);
            }
        }
    }
    return Array.from(files).sort();
}
function structuredCorrectionMode(profile) {
    if (profile.plannerModeOverride === "architecture_reconstruction") {
        return "architecture_reconstruction";
    }
    if (profile.architectureCollapse) {
        return "architecture_reconstruction";
    }
    const clusters = Array.isArray(profile.clusters) ? profile.clusters : [];
    const hasMicroPrimaryCluster = clusters.some((cluster) => isMicroPrimaryCluster(cluster));
    return hasMicroPrimaryCluster ? "micro_targeted" : "single";
}
function buildValidationCorrectionPrompt(input) {
    const architectureModules = Array.isArray(input.correctionProfile.architectureModules)
        ? input.correctionProfile.architectureModules.filter((value) => typeof value === "string" && value.trim())
        : [];
    const architectureModuleLine = architectureModules.length
        ? `Architecture violations affect modules: ${architectureModules.join(", ")}.`
        : "No architecture module list was extracted.";
    const clusterLines = buildCorrectionClusterLines(input.correctionProfile);
    return [
        "You are repairing a deeprun Canonical Backend implementation after validation failure.",
        `Original feature request: ${input.originalIntent}`,
        `Validation summary: ${input.validationSummary}`,
        `Primary correction reason: ${input.correctionProfile.reason ?? "unknown"}`,
        `Blocking count: ${String(input.correctionProfile.blockingCount)}`,
        architectureModuleLine,
        "Detected failure clusters (resolve ALL of these in one correction pass):",
        ...clusterLines,
        "Canonical backend contract requirements:",
        "- Keep the canonical stack and structure (TypeScript, Fastify, Prisma, Vitest, ESM).",
        "- Do not switch frameworks or module systems.",
        "- Do not introduce cross-module service imports that violate module isolation.",
        "- Preserve canonical module layering rules and required directories/tests.",
        "- Reconstruct incomplete or invalid module structures fully if needed; do not leave partial modules.",
        "- Remove dependency cycles and runtime integration API mismatches (e.g. incorrect Prisma middleware API usage).",
        "- Import paths must resolve from the current file location. For files already under src/, do NOT add an extra '/src/' segment in relative imports.",
        "- Relative import depth examples in canonical backend:",
        "- From src/modules/<module>/controller/* to src/errors/* use '../../../errors/<file>.js' (NOT '../../errors/<file>.js').",
        "- From src/modules/<module>/service/* to src/errors/* use '../../../errors/<file>.js'.",
        "- From src/modules/<module>/repository/* to src/db/prisma.ts use '../../../db/prisma.js'.",
        "- From src/modules/<module>/tests/* to src/db/prisma.ts use '../../../db/prisma.js' (NOT '../../../src/db/prisma.js').",
        "- If code imports a module-local dto/ or schema/ file, create or repair that dto/ or schema/ file in the same module.",
        "- Example: importing '../dto/project-dto.js' from src/modules/project/service/project-service.ts requires src/modules/project/dto/project-dto.ts to exist.",
        "- Only import real infrastructure entrypoints under src/db (for example src/db/prisma.ts). Do NOT invent domain files under src/db such as src/db/audit-log.ts.",
        "- Domain-specific files like audit-log belong in the same module under controller/, service/, repository/, schema/, dto/, or tests/.",
        "- Before finalizing, verify every local relative import points to an existing file in the edited tree.",
        "- Ensure typecheck, build, tests, and boot succeed after the correction.",
        "- Make the smallest deterministic changes needed to pass validation, but prefer cohesive rewrites over oscillating patches."
    ].join("\n");
}
function buildStructuralResetCorrectionPrompt(input) {
    const architectureModules = Array.isArray(input.correctionProfile.architectureModules)
        ? input.correctionProfile.architectureModules.filter((value) => typeof value === "string" && value.trim())
        : [];
    const clusterLines = buildCorrectionClusterLines(input.correctionProfile);
    const targetModules = architectureModules.length ? architectureModules.join(", ") : "affected modules";
    return [
        "You are performing Phase 1 of a deeprun Canonical Backend correction: structural_reset.",
        `Original feature request: ${input.originalIntent}`,
        `Validation summary: ${input.validationSummary}`,
        `Blocking count: ${String(input.correctionProfile.blockingCount)}`,
        `Target modules for structural reconstruction: ${targetModules}.`,
        "Detected failure clusters:",
        ...clusterLines,
        "Phase 1 goal: restore canonical module architecture and dependency graph only.",
        "Requirements:",
        "- Remove non-canonical files/layouts in affected modules when necessary.",
        "- Recreate canonical module directories exactly: controller/, service/, repository/, schema/, dto/, tests/.",
        "- Create minimal stubs/placeholders if needed so architecture validation can pass.",
        "- Do NOT implement full audit logging logic yet.",
        "- Do NOT introduce cross-module imports.",
        "- Break circular dependencies if present.",
        "- Keep framework/module system unchanged (TypeScript, Fastify, Prisma, Vitest, ESM).",
        "- Prefer structural scaffolding and import cleanup over feature behavior changes."
    ].join("\n");
}
function buildFeatureReintegrationCorrectionPrompt(input) {
    const architectureModules = Array.isArray(input.correctionProfile.architectureModules)
        ? input.correctionProfile.architectureModules.filter((value) => typeof value === "string" && value.trim())
        : [];
    const clusterLines = buildCorrectionClusterLines(input.correctionProfile);
    const targetModules = architectureModules.length ? architectureModules.join(", ") : "affected modules";
    return [
        "You are performing Phase 2 of a deeprun Canonical Backend correction: feature_reintegration.",
        `Original feature request: ${input.originalIntent}`,
        `Validation summary (from previous failed validation): ${input.validationSummary}`,
        `Blocking count: ${String(input.correctionProfile.blockingCount)}`,
        `Target modules: ${targetModules}.`,
        "Detected failure clusters to resolve holistically:",
        ...clusterLines,
        "Phase 2 goal: implement and reintegrate the requested feature inside the canonical structure from Phase 1.",
        "Requirements:",
        "- Do NOT modify module structure created in phase 1 unless absolutely required to satisfy canonical layout.",
        "- The canonical backend module structure MUST contain only these layer directories inside each module: controller/, service/, repository/, schema/, dto/, tests/.",
        "- Do NOT create new layer directories such as routes/, middleware/, handlers/, or utils/ as module layers.",
        "- If routing logic is needed, place it in controller/.",
        "- If any unknown layer directory exists in target modules, remove it and move logic into canonical layers.",
        "- The canonical backend layer dependency rules are:",
        "- controller may import: service, schema, dto.",
        "- service may import: repository, schema, dto.",
        "- repository may import: db.",
        "- db may not import any module layer.",
        "- Forbidden: db importing service.",
        "- Forbidden: repository importing service.",
        "- Forbidden: controller importing db.",
        "- Forbidden: cross-module direct service imports.",
        "- Module tests under src/modules/<module>/tests must import only that same module's service layer when exercising service behavior.",
        "- Do NOT satisfy service-layer test requirements by importing another module's service into a module's tests.",
        "- If a middleware is needed, it must not violate the dependency matrix.",
        "- Do not import service from db layer.",
        "- Implement audit logging feature logic using canonical layering only.",
        "- No circular imports.",
        "- No direct service imports across modules.",
        "- Fix import path resolution issues (especially ESM .js import paths after build output).",
        "- Import paths must resolve from the current file location. For files already under src/, do NOT add an extra '/src/' segment in relative imports.",
        "- Relative import depth examples in canonical backend:",
        "- From src/modules/<module>/controller/* to src/errors/* use '../../../errors/<file>.js' (NOT '../../errors/<file>.js').",
        "- From src/modules/<module>/service/* to src/errors/* use '../../../errors/<file>.js'.",
        "- From src/modules/<module>/repository/* to src/db/prisma.ts use '../../../db/prisma.js'.",
        "- From src/modules/<module>/tests/* to src/db/prisma.ts use '../../../db/prisma.js' (NOT '../../../src/db/prisma.js').",
        "- If code imports a module-local dto/ or schema/ file, create or repair that dto/ or schema/ file in the same module.",
        "- Example: importing '../dto/project-dto.js' from src/modules/project/service/project-service.ts requires src/modules/project/dto/project-dto.ts to exist.",
        "- Only import real infrastructure entrypoints under src/db (for example src/db/prisma.ts). Do NOT invent domain files under src/db such as src/db/audit-log.ts.",
        "- Domain-specific files like audit-log belong in the same module under controller/, service/, repository/, schema/, dto/, or tests/.",
        "- Before finalizing, verify every local relative import points to an existing file in the edited tree.",
        "- Ensure typecheck, build, Vitest tests, and /health boot succeed.",
        "- Preserve framework/module system and package scripts."
    ].join("\n");
}
function buildDebtResolutionCorrectionPrompt(input) {
    const debtTargets = Array.isArray(input.correctionProfile.debtTargets)
        ? input.correctionProfile.debtTargets.filter((entry) => typeof entry?.path === "string" && entry.path.trim())
        : [];
    const debtLines = debtTargets.length
        ? debtTargets.map((entry) => {
            const summary = entry.exportsSummary && typeof entry.exportsSummary === "object"
                ? JSON.stringify(entry.exportsSummary)
                : null;
            return summary ? `- ${entry.path} exports=${summary}` : `- ${entry.path}`;
        })
        : ["- none recorded"];
    return [
        "You are performing a deeprun Canonical Backend follow-up correction: debt_resolution.",
        `Original feature request: ${input.originalIntent}`,
        `Validation status before debt paydown: ${input.validationSummary}`,
        "Stub debt targets to replace with real implementations:",
        ...debtLines,
        "Requirements:",
        "- Replace provisional stub modules with real canonical module-local DTO/schema/implementation files where possible.",
        "- Preserve any import-resolution fix that already made validation pass.",
        "- Do NOT widen scope beyond the recorded stub targets and directly dependent module-local files.",
        "- Keep canonical module layering intact.",
        "- If a stub cannot be fully replaced, improve it into the narrowest real shape implied by its imports and surrounding contracts.",
        "- Re-run the same validation surface and leave the project in a non-provisional state."
    ].join("\n");
}
function buildTypecheckRecipePrompt(input) {
    const clusterLines = buildCorrectionClusterLines(input.correctionProfile);
    return [
        "You are performing a deeprun deterministic correction recipe: typecheck_recipe.",
        `Original feature request: ${input.originalIntent}`,
        `Validation summary: ${input.validationSummary}`,
        `Blocking count: ${String(input.correctionProfile.blockingCount)}`,
        "Target failure clusters:",
        ...clusterLines,
        "Recipe constraints:",
        "- Prefer AST-local fixes for type mismatches, missing exports, and implicit any issues.",
        "- Do NOT broaden into architecture reconstruction.",
        "- Keep edits tightly scoped to the failing type surface.",
        "- Preserve runtime behavior unless required to satisfy the type contract."
    ].join("\n");
}
function buildBuildRecipePrompt(input) {
    const clusterLines = buildCorrectionClusterLines(input.correctionProfile);
    return [
        "You are performing a deeprun deterministic correction recipe: build_recipe.",
        `Original feature request: ${input.originalIntent}`,
        `Validation summary: ${input.validationSummary}`,
        `Blocking count: ${String(input.correctionProfile.blockingCount)}`,
        "Target failure clusters:",
        ...clusterLines,
        "Recipe constraints:",
        "- Fix bundler/import/config issues first.",
        "- Prefer resolver, path, or build-config corrections over feature rewrites.",
        "- Keep edits minimal and directly tied to the failing build surface.",
        "- Preserve canonical package scripts and module system."
    ].join("\n");
}
function buildTestRecipePrompt(input) {
    const clusterLines = buildCorrectionClusterLines(input.correctionProfile);
    return [
        "You are performing a deeprun deterministic correction recipe: test_recipe.",
        `Original feature request: ${input.originalIntent}`,
        `Validation summary: ${input.validationSummary}`,
        `Blocking count: ${String(input.correctionProfile.blockingCount)}`,
        "Target failure clusters:",
        ...clusterLines,
        "Recipe constraints:",
        "- Fix fixture, snapshot, or narrow contract issues before broader rewrites.",
        "- Keep test changes aligned with canonical module isolation rules.",
        "- Do NOT hide failures by weakening assertions without replacing the intended behavior."
    ].join("\n");
}
function buildMicroTargetedCorrectionPrompt(input, options) {
    const scopeLines = options.repairScope.length
        ? buildCorrectionClusterLines({ ...input.correctionProfile, clusters: options.repairScope })
        : ["- none"];
    const fileLines = options.allowedFiles.length ? options.allowedFiles.map((file) => `- ${file}`) : ["- none"];
    return [
        "You are performing a deeprun Canonical Backend correction: micro_targeted_repair.",
        `Original feature request: ${input.originalIntent}`,
        `Validation summary: ${input.validationSummary}`,
        `Blocking count: ${String(input.correctionProfile.blockingCount)}`,
        "Repair scope (fix all listed issues, but do not broaden scope):",
        ...scopeLines,
        "You may only modify these files/paths:",
        ...fileLines,
        "Constraints:",
        "- Do NOT restructure module folders.",
        "- Do NOT rename files.",
        "- Do NOT create new modules.",
        "- Do NOT modify unrelated files.",
        "- Fix only layer boundary violations, import path resolution issues, and missing validation-failure/service contract tests in scope.",
        "- If a scoped file imports a canonical module-local dto/ or schema/ file that does not exist, create or repair that missing file within the same module.",
        "- Module tests under src/modules/<module>/tests must import only that same module's service layer when exercising service behavior.",
        "- Do NOT satisfy service-layer test requirements by importing another module's service into a module's tests.",
        "- Do NOT introduce malformed import specifiers (e.g., trailing quotes).",
        "- Import paths must resolve from the current file location. For files already under src/, do NOT add an extra '/src/' segment in relative imports.",
        "- Relative import depth examples in canonical backend:",
        "- From src/modules/<module>/controller/* to src/errors/* use '../../../errors/<file>.js' (NOT '../../errors/<file>.js').",
        "- From src/modules/<module>/service/* to src/errors/* use '../../../errors/<file>.js'.",
        "- From src/modules/<module>/repository/* to src/db/prisma.ts use '../../../db/prisma.js'.",
        "- From src/modules/<module>/tests/* to src/db/prisma.ts use '../../../db/prisma.js' (NOT '../../../src/db/prisma.js').",
        "- Only import real infrastructure entrypoints under src/db (for example src/db/prisma.ts). Do NOT invent domain files under src/db such as src/db/audit-log.ts.",
        "- Domain-specific files like audit-log belong in the same module under controller/, service/, repository/, schema/, dto/, or tests/.",
        "- Before finalizing, verify every local relative import points to an existing file in the edited tree.",
        "- Preserve canonical module layering, framework, and package scripts.",
        "- Keep changes minimal and deterministic."
    ].join("\n");
}
export class AgentPlanner {
    async requestPlannerJson(input) {
        const providerConfig = getProviderConfig(input.providerId);
        const plannerTimeoutMs = parseRequestTimeoutMs(typeof input.plannerTimeoutMs === "number" ? String(input.plannerTimeoutMs) : undefined, defaultPlannerTimeoutMs);
        const response = await fetch(`${providerConfig.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${providerConfig.apiKey}`
            },
            body: JSON.stringify({
                model: input.model || providerConfig.defaultModel,
                temperature: 0,
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "system",
                        content: input.systemPrompt
                    },
                    {
                        role: "user",
                        content: input.userPrompt
                    }
                ]
            }),
            signal: AbortSignal.timeout(plannerTimeoutMs)
        });
        if (!response.ok) {
            const details = await response.text();
            throw new Error(`Planner request failed (${response.status}): ${details}`);
        }
        const payload = (await response.json());
        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error("Planner returned an empty response.");
        }
        return parseJsonPayload(content);
    }
    async plan(input) {
        if (input.providerId === "mock") {
            return agentPlanSchema.parse(buildFallbackPlan(input.goal));
        }
        const projectFiles = await collectFiles(input.projectRoot, 18, 1_600);
        const contextBlock = projectFiles.length
            ? projectFiles.map((file) => `FILE: ${file.path}\n${file.content}`).join("\n\n---\n\n")
            : "Project has no readable files yet.";
        const systemPrompt = [
            "You are deeprun Planner.",
            "Return STRICT JSON only. No markdown. No explanation.",
            "Output must match this exact schema:",
            planResponseSchemaLiteral,
            "Constraints:",
            "- Use only tools: read_file, write_file, apply_patch, list_files, run_preview_container, fetch_runtime_logs.",
            "- Keep 2 to 10 steps.",
            "- First step must be analyze and should usually be list_files or read_file.",
            "- Include at least one verify step for code-changing goals. Verify steps should use run_preview_container.",
            "- Use project memory (stack info, architecture summary, recent commits, recent agent runs) when relevant.",
            "- Input must be a plain JSON object for each step.",
            "- Use deterministic step ids: step-1, step-2, ...",
            "If you cannot produce a valid plan, return {}."
        ].join("\n");
        const memoryBlock = buildMemoryContextBlock(input.memory);
        const userPrompt = [
            `Goal: ${input.goal}`,
            `Project: ${input.project.name}`,
            "Project memory:",
            memoryBlock,
            "Project context:",
            contextBlock
        ].join("\n\n");
        const parsed = await this.requestPlannerJson({
            providerId: input.providerId,
            model: input.model,
            systemPrompt,
            userPrompt,
            plannerTimeoutMs: input.plannerTimeoutMs
        });
        return withAgentPlanCapabilities(agentPlanSchema.parse(parsed));
    }
    async planCorrection(input) {
        const hasArchitecturePressure = input.correctionProfile.architectureCollapse ||
            input.correctionProfile.clusters.some((cluster) => cluster.type === "architecture_contract" ||
                cluster.type === "layer_boundary_violation" ||
                cluster.type === "import_resolution_error" ||
                cluster.type === "test_contract_gap");
        if (input.correctionProfile.plannerModeOverride === "debt_resolution") {
            return withAgentPlanCapabilities(agentPlanSchema.parse({
                goal: input.originalIntent,
                steps: [
                    {
                        id: randomUUID(),
                        type: "modify",
                        tool: "ai_mutation",
                        mutates: true,
                        input: {
                            mode: "correction",
                            phase: "debt_resolution",
                            prompt: buildDebtResolutionCorrectionPrompt(input),
                            originalIntent: input.originalIntent,
                            validationSummary: input.validationSummary,
                            correctionProfile: input.correctionProfile,
                            contractReminder: "Debt resolution: replace provisional stub debt with canonical real implementations without regressing the already-passing validation surface."
                        }
                    }
                ]
            }));
        }
        if (input.correctionProfile.plannerModeOverride === "feature_reintegration") {
            return withAgentPlanCapabilities(agentPlanSchema.parse({
                goal: input.originalIntent,
                steps: [
                    {
                        id: randomUUID(),
                        type: "modify",
                        tool: "ai_mutation",
                        mutates: true,
                        input: {
                            mode: "correction",
                            phase: "feature_reintegration",
                            prompt: buildFeatureReintegrationCorrectionPrompt(input),
                            originalIntent: input.originalIntent,
                            validationSummary: input.validationSummary,
                            correctionProfile: input.correctionProfile,
                            contractReminder: "Escalated feature reintegration: replace stalled micro-targeted fixes with a cohesive wiring and implementation pass."
                        }
                    }
                ]
            }));
        }
        if (!hasArchitecturePressure && input.correctionProfile.clusters.some((cluster) => cluster.type === "typecheck_failure")) {
            return withAgentPlanCapabilities(agentPlanSchema.parse({
                goal: input.originalIntent,
                steps: [
                    {
                        id: randomUUID(),
                        type: "modify",
                        tool: "ai_mutation",
                        mutates: true,
                        input: {
                            mode: "correction",
                            phase: "typecheck_recipe",
                            prompt: buildTypecheckRecipePrompt(input),
                            originalIntent: input.originalIntent,
                            validationSummary: input.validationSummary,
                            correctionProfile: input.correctionProfile,
                            contractReminder: "Typecheck recipe: prefer narrow, type-directed repairs before broader planner-driven rewrites."
                        }
                    }
                ]
            }));
        }
        if (!hasArchitecturePressure && input.correctionProfile.clusters.some((cluster) => cluster.type === "build_failure")) {
            return withAgentPlanCapabilities(agentPlanSchema.parse({
                goal: input.originalIntent,
                steps: [
                    {
                        id: randomUUID(),
                        type: "modify",
                        tool: "ai_mutation",
                        mutates: true,
                        input: {
                            mode: "correction",
                            phase: "build_recipe",
                            prompt: buildBuildRecipePrompt(input),
                            originalIntent: input.originalIntent,
                            validationSummary: input.validationSummary,
                            correctionProfile: input.correctionProfile,
                            contractReminder: "Build recipe: repair resolver/config/build breakage first; avoid broader feature churn."
                        }
                    }
                ]
            }));
        }
        if (!hasArchitecturePressure && input.correctionProfile.clusters.some((cluster) => cluster.type === "test_failure")) {
            return withAgentPlanCapabilities(agentPlanSchema.parse({
                goal: input.originalIntent,
                steps: [
                    {
                        id: randomUUID(),
                        type: "modify",
                        tool: "ai_mutation",
                        mutates: true,
                        input: {
                            mode: "correction",
                            phase: "test_recipe",
                            prompt: buildTestRecipePrompt(input),
                            originalIntent: input.originalIntent,
                            validationSummary: input.validationSummary,
                            correctionProfile: input.correctionProfile,
                            contractReminder: "Test recipe: repair fixtures, snapshots, and narrow behavioral contracts before broader rewrites."
                        }
                    }
                ]
            }));
        }
        const mode = structuredCorrectionMode(input.correctionProfile);
        if (mode === "architecture_reconstruction") {
            return withAgentPlanCapabilities(agentPlanSchema.parse({
                goal: input.originalIntent,
                steps: [
                    {
                        id: randomUUID(),
                        type: "modify",
                        tool: "ai_mutation",
                        mutates: true,
                        input: {
                            mode: "correction",
                            phase: "structural_reset",
                            prompt: buildStructuralResetCorrectionPrompt(input),
                            originalIntent: input.originalIntent,
                            validationSummary: input.validationSummary,
                            correctionProfile: input.correctionProfile,
                            contractReminder: "Phase 1 structural reset: canonical module layout and dependency graph first; no feature logic reintegration yet."
                        }
                    },
                    {
                        id: randomUUID(),
                        type: "modify",
                        tool: "ai_mutation",
                        mutates: true,
                        input: {
                            mode: "correction",
                            phase: "feature_reintegration",
                            prompt: buildFeatureReintegrationCorrectionPrompt(input),
                            originalIntent: input.originalIntent,
                            validationSummary: input.validationSummary,
                            correctionProfile: input.correctionProfile,
                            contractReminder: "Phase 2 feature reintegration: keep phase-1 module structure intact while implementing logic/tests and fixing build/runtime/test issues."
                        }
                    }
                ]
            }));
        }
        if (mode === "micro_targeted") {
            const allowedFiles = collectMicroAllowedFiles(input.correctionProfile);
            const repairScope = collectMicroRepairScope(input.correctionProfile);
            if (allowedFiles.length && repairScope.length) {
                return withAgentPlanCapabilities(agentPlanSchema.parse({
                    goal: input.originalIntent,
                    steps: [
                        {
                            id: randomUUID(),
                            type: "modify",
                            tool: "ai_mutation",
                            mutates: true,
                            input: {
                                mode: "correction",
                                phase: "micro_targeted_repair",
                                prompt: buildMicroTargetedCorrectionPrompt(input, {
                                    allowedFiles,
                                    repairScope
                                }),
                                allowedFiles,
                                repairScope,
                                originalIntent: input.originalIntent,
                                validationSummary: input.validationSummary,
                                correctionProfile: input.correctionProfile,
                                contractReminder: "Micro-targeted repair: keep module structure stable and modify only the explicitly scoped files/paths."
                            }
                        }
                    ]
                }));
            }
        }
        const prompt = buildValidationCorrectionPrompt(input);
        return withAgentPlanCapabilities(agentPlanSchema.parse({
            goal: input.originalIntent,
            steps: [
                {
                    id: randomUUID(),
                    type: "modify",
                    tool: "ai_mutation",
                    mutates: true,
                    input: {
                        mode: "correction",
                        prompt,
                        originalIntent: input.originalIntent,
                        validationSummary: input.validationSummary,
                        correctionProfile: input.correctionProfile,
                        contractReminder: "Canonical backend module layering and isolation rules must be preserved while fixing validation failures."
                    }
                }
            ]
        }));
    }
    async planRuntimeCorrection(input) {
        if (input.providerId === "mock") {
            throw new Error("Runtime correction is unavailable with provider 'mock'.");
        }
        const projectFiles = await collectFiles(input.projectRoot, 20, 1_400);
        const contextBlock = projectFiles.length
            ? projectFiles.map((file) => `FILE: ${file.path}\n${file.content}`).join("\n\n---\n\n")
            : "Project has no readable files yet.";
        const systemPrompt = [
            "You are deeprun Runtime Fix Planner.",
            "Return STRICT JSON only. No markdown. No explanation.",
            "Return exactly one step object matching this schema:",
            correctionResponseSchemaLiteral,
            "Hard constraints:",
            "- type must be modify.",
            "- tool must be write_file or apply_patch.",
            "- Perform the smallest code change likely to fix startup/runtime errors.",
            "- Prefer apply_patch when possible over write_file.",
            "- Use project memory context when choosing fixes.",
            "- Prefer structured failure diagnostics over raw logs when both are provided.",
            "- Respect correction constraint limits exactly (allowedPathPrefixes, maxFiles, maxTotalDiffBytes, intent guidance).",
            "- Do not emit analyze/verify tools.",
            "If you cannot produce a valid correction step, return {}."
        ].join("\n");
        const memoryBlock = buildMemoryContextBlock(input.memory);
        const failureReportBlock = buildFailureReportBlock(input.failureReport);
        const constraintBlock = buildCorrectionConstraintBlock(input.correctionConstraint);
        const userPrompt = [
            `Goal: ${input.goal}`,
            `Project: ${input.project.name}`,
            `Correction attempt: ${input.attempt}`,
            `Failed verify step id: ${input.failedStepId}`,
            "Correction constraint:",
            constraintBlock,
            "Structured failure report:",
            failureReportBlock,
            "Recent runtime logs (tail):",
            trimLogPayload(input.runtimeLogs || ""),
            "Project memory:",
            memoryBlock,
            "Project context:",
            contextBlock
        ].join("\n\n");
        const parsed = await this.requestPlannerJson({
            providerId: input.providerId,
            model: input.model,
            systemPrompt,
            userPrompt,
            plannerTimeoutMs: input.plannerTimeoutMs
        });
        const maybeStep = parsed && typeof parsed === "object" && !Array.isArray(parsed) && "step" in parsed
            ? parsed.step
            : parsed;
        return withAgentStepCapabilities(correctionStepSchema.parse(maybeStep));
    }
}
