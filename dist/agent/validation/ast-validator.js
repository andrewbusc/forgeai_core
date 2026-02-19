import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { architectureContractV1 } from "./contract.js";
import { collectProductionFiles } from "./collect-files.js";
import { detectLayer } from "./path-utils.js";
function getScriptKind(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".tsx") {
        return ts.ScriptKind.TSX;
    }
    if (ext === ".jsx") {
        return ts.ScriptKind.JSX;
    }
    if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
        return ts.ScriptKind.JS;
    }
    return ts.ScriptKind.TS;
}
function lineAt(sourceFile, pos) {
    return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}
function toImportSpecs(sourceFile) {
    const specs = [];
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) {
            continue;
        }
        const moduleSpecifier = statement.moduleSpecifier;
        if (!ts.isStringLiteral(moduleSpecifier)) {
            continue;
        }
        const importedNames = [];
        const clause = statement.importClause;
        if (clause?.name) {
            importedNames.push(clause.name.text);
        }
        if (clause?.namedBindings) {
            if (ts.isNamespaceImport(clause.namedBindings)) {
                importedNames.push(clause.namedBindings.name.text);
            }
            else if (ts.isNamedImports(clause.namedBindings)) {
                for (const element of clause.namedBindings.elements) {
                    importedNames.push(element.name.text);
                }
            }
        }
        specs.push({
            module: moduleSpecifier.text,
            importedNames
        });
    }
    return specs;
}
function isPrismaLikeImport(moduleSpecifier) {
    const normalized = moduleSpecifier.trim().toLowerCase();
    if (normalized === "@prisma/client") {
        return true;
    }
    return normalized.includes("prisma");
}
function isRequestOrResponseName(name) {
    const normalized = name.trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    if (normalized === "request" ||
        normalized === "response" ||
        normalized === "reply" ||
        normalized === "fastifyrequest" ||
        normalized === "fastifyreply" ||
        normalized === "incomingmessage" ||
        normalized === "serverresponse" ||
        normalized === "nextfunction") {
        return true;
    }
    return normalized.endsWith("request") || normalized.endsWith("response") || normalized.endsWith("reply");
}
function isServiceHttpImport(spec) {
    if (spec.importedNames.some((name) => isRequestOrResponseName(name))) {
        return true;
    }
    const moduleName = spec.module.toLowerCase();
    if (moduleName === "fastify" || moduleName === "express" || moduleName === "node:http") {
        return spec.importedNames.length > 0;
    }
    return false;
}
function isRawErrorThrowExpression(expression) {
    if (!expression) {
        return false;
    }
    if (ts.isParenthesizedExpression(expression)) {
        return isRawErrorThrowExpression(expression.expression);
    }
    if (!ts.isCallExpression(expression) && !ts.isNewExpression(expression)) {
        return false;
    }
    const callee = expression.expression;
    if (ts.isIdentifier(callee)) {
        return callee.text === "Error";
    }
    if (ts.isPropertyAccessExpression(callee)) {
        return callee.name.text === "Error";
    }
    return false;
}
export async function runAstValidation(projectRoot, contract = architectureContractV1) {
    const root = path.resolve(projectRoot);
    const files = await collectProductionFiles(root);
    const violations = [];
    for (const file of files) {
        let sourceText = "";
        try {
            sourceText = await fs.readFile(file.absolutePath, "utf8");
        }
        catch (error) {
            violations.push({
                ruleId: "AST.READ_ERROR",
                severity: "error",
                file: file.relativePath,
                message: `Could not read source file: ${String(error.message || error)}`
            });
            continue;
        }
        const sourceFile = ts.createSourceFile(file.relativePath, sourceText, ts.ScriptTarget.Latest, true, getScriptKind(file.absolutePath));
        const layerInfo = detectLayer(file.relativePath, contract);
        const imports = toImportSpecs(sourceFile);
        if (layerInfo.layer === "controller" && contract.rules.controllerNoPrismaImport.enabled) {
            for (const spec of imports) {
                if (!isPrismaLikeImport(spec.module)) {
                    continue;
                }
                violations.push({
                    ruleId: contract.rules.controllerNoPrismaImport.id,
                    severity: contract.rules.controllerNoPrismaImport.severity,
                    file: file.relativePath,
                    target: spec.module,
                    message: `Controller layer must not import Prisma ('${spec.module}').`
                });
            }
        }
        if (layerInfo.layer === "service" && contract.rules.serviceNoRequestImport.enabled) {
            for (const spec of imports) {
                if (!isServiceHttpImport(spec)) {
                    continue;
                }
                violations.push({
                    ruleId: contract.rules.serviceNoRequestImport.id,
                    severity: contract.rules.serviceNoRequestImport.severity,
                    file: file.relativePath,
                    target: spec.module,
                    message: `Service layer must not import request/response types ('${spec.module}').`
                });
            }
        }
        if (contract.rules.noRawErrorThrow.enabled) {
            const visit = (node) => {
                if (ts.isThrowStatement(node) && isRawErrorThrowExpression(node.expression)) {
                    violations.push({
                        ruleId: contract.rules.noRawErrorThrow.id,
                        severity: contract.rules.noRawErrorThrow.severity,
                        file: file.relativePath,
                        message: `Raw Error throw is not allowed (line ${lineAt(sourceFile, node.getStart(sourceFile))}).`
                    });
                }
                ts.forEachChild(node, visit);
            };
            visit(sourceFile);
        }
    }
    return violations;
}
