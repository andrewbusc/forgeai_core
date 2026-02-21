export const recognizedLayers = [
  "controller",
  "service",
  "repository",
  "schema",
  "dto",
  "entity",
  "middleware",
  "errors",
  "config",
  "db"
] as const;

export type RecognizedLayer = (typeof recognizedLayers)[number];

export interface RuleDefinition {
  id: string;
  enabled: boolean;
  severity: "error" | "warning";
}

export interface ArchitectureContract {
  version: string;
  sourceRoot: string;
  modulesRoot: string;
  recognizedLayers: readonly RecognizedLayer[];
  allowedTopLevelDirs: readonly string[];
  enforceRelativeImportsOnly: boolean;
  disallowPathAliases: boolean;
  collectAllViolations: boolean;
  moduleIsolation: {
    enabled: boolean;
    disallowCrossModuleImports: boolean;
  };
  rules: {
    unknownLayer: RuleDefinition;
    pathAliasConfig: RuleDefinition;
    nonRelativeImport: RuleDefinition;
    missingImportTarget: RuleDefinition;
    cycleDependency: RuleDefinition;
    layerMatrix: RuleDefinition;
    moduleIsolation: RuleDefinition;
    controllerNoPrismaImport: RuleDefinition;
    serviceNoRequestImport: RuleDefinition;
    noRawErrorThrow: RuleDefinition;
    securityHelmet: RuleDefinition;
    securityRateLimit: RuleDefinition;
    securityCorsWildcard: RuleDefinition;
    securityInputValidation: RuleDefinition;
    securityEnvValidation: RuleDefinition;
    securityPasswordHashing: RuleDefinition;
    securityJwtSecretValidation: RuleDefinition;
  };
  layerMatrix: Record<RecognizedLayer, readonly RecognizedLayer[]>;
}

export const architectureContractV1: ArchitectureContract = {
  version: "v1",
  sourceRoot: "src",
  modulesRoot: "src/modules",
  recognizedLayers,
  allowedTopLevelDirs: ["modules", "middleware", "errors", "config", "db"],
  enforceRelativeImportsOnly: true,
  disallowPathAliases: true,
  collectAllViolations: true,
  moduleIsolation: {
    enabled: true,
    disallowCrossModuleImports: true
  },
  rules: {
    unknownLayer: {
      id: "ARCH.UNKNOWN_LAYER",
      enabled: true,
      severity: "error"
    },
    pathAliasConfig: {
      id: "IMPORT.PATH_ALIAS_CONFIG",
      enabled: true,
      severity: "error"
    },
    nonRelativeImport: {
      id: "IMPORT.NON_RELATIVE",
      enabled: true,
      severity: "error"
    },
    missingImportTarget: {
      id: "IMPORT.MISSING_TARGET",
      enabled: true,
      severity: "error"
    },
    cycleDependency: {
      id: "GRAPH.CYCLE",
      enabled: true,
      severity: "error"
    },
    layerMatrix: {
      id: "ARCH.LAYER_MATRIX",
      enabled: true,
      severity: "error"
    },
    moduleIsolation: {
      id: "ARCH.MODULE_ISOLATION",
      enabled: true,
      severity: "error"
    },
    controllerNoPrismaImport: {
      id: "AST.CONTROLLER_NO_PRISMA_IMPORT",
      enabled: true,
      severity: "error"
    },
    serviceNoRequestImport: {
      id: "AST.SERVICE_NO_REQUEST_IMPORT",
      enabled: true,
      severity: "error"
    },
    noRawErrorThrow: {
      id: "AST.NO_RAW_ERROR_THROW",
      enabled: true,
      severity: "error"
    },
    securityHelmet: {
      id: "SEC.HELMET_REQUIRED",
      enabled: true,
      severity: "error"
    },
    securityRateLimit: {
      id: "SEC.RATE_LIMIT_REQUIRED",
      enabled: true,
      severity: "error"
    },
    securityCorsWildcard: {
      id: "SEC.CORS_WILDCARD_FORBIDDEN",
      enabled: true,
      severity: "error"
    },
    securityInputValidation: {
      id: "SEC.INPUT_VALIDATION_REQUIRED",
      enabled: true,
      severity: "error"
    },
    securityEnvValidation: {
      id: "SEC.ENV_VALIDATION_REQUIRED",
      enabled: true,
      severity: "error"
    },
    securityPasswordHashing: {
      id: "SEC.PASSWORD_HASHING_REQUIRED",
      enabled: true,
      severity: "error"
    },
    securityJwtSecretValidation: {
      id: "SEC.JWT_SECRET_VALIDATION_REQUIRED",
      enabled: true,
      severity: "error"
    }
  },
  layerMatrix: {
    controller: ["service", "schema", "dto", "entity", "errors", "config", "middleware"],
    service: ["service", "repository", "schema", "dto", "entity", "errors", "config"],
    repository: ["repository", "db", "schema", "dto", "entity", "errors", "config"],
    schema: ["schema", "dto", "entity", "errors", "config"],
    dto: ["dto", "schema", "entity", "errors", "config"],
    entity: ["entity", "errors", "config"],
    middleware: ["middleware", "service", "schema", "dto", "entity", "errors", "config"],
    errors: ["errors", "config"],
    config: ["config"],
    db: ["db", "config", "errors"]
  }
};
