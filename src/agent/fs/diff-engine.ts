function splitLines(content: string | null): string[] {
  if (content === null) {
    return [];
  }

  return content.split("\n");
}

function selectDiffHeaders(path: string, before: string | null, after: string | null): { from: string; to: string } {
  if (before === null && after !== null) {
    return { from: "/dev/null", to: `b/${path}` };
  }

  if (before !== null && after === null) {
    return { from: `a/${path}`, to: "/dev/null" };
  }

  return { from: `a/${path}`, to: `b/${path}` };
}

export function buildUnifiedDiffPreview(input: { path: string; before: string | null; after: string | null }): string {
  const beforeLines = splitLines(input.before);
  const afterLines = splitLines(input.after);
  const headers = selectDiffHeaders(input.path, input.before, input.after);

  const lines: string[] = [];
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

