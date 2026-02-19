function splitLines(content) {
    if (content === null) {
        return [];
    }
    return content.split("\n");
}
function selectDiffHeaders(path, before, after) {
    if (before === null && after !== null) {
        return { from: "/dev/null", to: `b/${path}` };
    }
    if (before !== null && after === null) {
        return { from: `a/${path}`, to: "/dev/null" };
    }
    return { from: `a/${path}`, to: `b/${path}` };
}
export function buildUnifiedDiffPreview(input) {
    const beforeLines = splitLines(input.before);
    const afterLines = splitLines(input.after);
    const headers = selectDiffHeaders(input.path, input.before, input.after);
    const lines = [];
    lines.push(`--- ${headers.from}`);
    lines.push(`+++ ${headers.to}`);
    lines.push(`@@ -1,${beforeLines.length} +1,${afterLines.length} @@`);
    for (const line of beforeLines) {
        lines.push(`-${line}`);
    }
    for (const line of afterLines) {
        lines.push(`+${line}`);
    }
    return lines.join("\n");
}
