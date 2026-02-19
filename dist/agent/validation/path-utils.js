import path from "node:path";
const codeFileExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
export function normalizeToPosix(value) {
    return value.replaceAll("\\", "/");
}
export function isCodeFile(filePath) {
    return codeFileExtensions.has(path.extname(filePath).toLowerCase());
}
export function isTestFilePath(relativePath) {
    const normalized = normalizeToPosix(relativePath).toLowerCase();
    if (normalized.includes("/__tests__/") || normalized.includes("/tests/")) {
        return true;
    }
    return /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(normalized);
}
export function toProjectRelativePath(projectRoot, absolutePath) {
    return normalizeToPosix(path.relative(path.resolve(projectRoot), path.resolve(absolutePath)));
}
export function detectLayer(relativePath, contract) {
    const normalized = normalizeToPosix(relativePath);
    const parts = normalized.split("/").filter(Boolean);
    if (parts[0] !== contract.sourceRoot) {
        return {
            moduleName: null,
            layer: null,
            unknownLayer: null
        };
    }
    const sourcePathRemainder = parts.slice(1);
    if (!sourcePathRemainder.length) {
        return {
            moduleName: null,
            layer: null,
            unknownLayer: null
        };
    }
    const first = sourcePathRemainder[0];
    if (first === "modules") {
        const moduleName = sourcePathRemainder[1] || null;
        const maybeLayer = sourcePathRemainder[2] || null;
        if (!maybeLayer) {
            return {
                moduleName,
                layer: null,
                unknownLayer: null
            };
        }
        if (contract.recognizedLayers.includes(maybeLayer)) {
            return {
                moduleName,
                layer: maybeLayer,
                unknownLayer: null
            };
        }
        return {
            moduleName,
            layer: null,
            unknownLayer: maybeLayer
        };
    }
    if (first.includes(".")) {
        return {
            moduleName: null,
            layer: null,
            unknownLayer: null
        };
    }
    if (contract.recognizedLayers.includes(first)) {
        return {
            moduleName: null,
            layer: first,
            unknownLayer: null
        };
    }
    if (contract.allowedTopLevelDirs.includes(first)) {
        return {
            moduleName: null,
            layer: null,
            unknownLayer: null
        };
    }
    return {
        moduleName: null,
        layer: null,
        unknownLayer: first
    };
}
function resolveWithKnownExtensions(candidateWithoutExtension) {
    const ext = path.extname(candidateWithoutExtension).toLowerCase();
    if (ext) {
        const base = candidateWithoutExtension.slice(0, -ext.length);
        const extensionCandidates = ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".jsx"
            ? [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]
            : [ext];
        return extensionCandidates.map((candidateExt) => `${base}${candidateExt}`);
    }
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
    const candidates = extensions.map((ext) => `${candidateWithoutExtension}${ext}`);
    for (const ext of extensions) {
        candidates.push(path.join(candidateWithoutExtension, `index${ext}`));
    }
    return candidates;
}
export function resolveRelativeImportTarget(input) {
    const resolvedBase = path.resolve(path.dirname(input.fromAbsolutePath), input.importPath);
    const candidates = resolveWithKnownExtensions(resolvedBase);
    for (const candidate of candidates) {
        const normalized = path.resolve(candidate);
        if (input.existingFiles.has(normalized)) {
            return normalized;
        }
    }
    return null;
}
