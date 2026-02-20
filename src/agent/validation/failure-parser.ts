export type ValidationFailureKind = "typescript" | "test" | "boot" | "migration" | "dependency" | "unknown";

export interface ValidationFailure {
  sourceCheckId: string;
  kind: ValidationFailureKind;
  code?: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  excerpt?: string;
}

function trimTail(value: string, maxLength = 6_000): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(normalized.length - maxLength);
}

function firstLocation(value: string): { file?: string; line?: number; column?: number } {
  const match = value.match(/([^\s()]+?\.(?:ts|tsx|js|jsx|mjs|cjs)):(\d+):(\d+)/);
  if (!match) {
    return {};
  }

  return {
    file: match[1],
    line: Number(match[2]),
    column: Number(match[3])
  };
}

function dedupeFailures(failures: ValidationFailure[]): ValidationFailure[] {
  const seen = new Set<string>();
  const next: ValidationFailure[] = [];

  for (const failure of failures) {
    const key = [
      failure.sourceCheckId,
      failure.kind,
      failure.code || "",
      failure.file || "",
      String(failure.line || ""),
      String(failure.column || ""),
      failure.message
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    next.push(failure);
  }

  return next;
}

function parseTypeScriptFailures(sourceCheckId: string, value: string): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const filePattern = /([^()\n]+?\.(?:ts|tsx|js|jsx|mts|cts))\((\d+),\s*(\d+)\):\s*error\s+(TS\d+):\s*([^\n]+)/g;

  let match: RegExpExecArray | null = null;
  while (true) {
    match = filePattern.exec(value);
    if (!match) {
      break;
    }

    failures.push({
      sourceCheckId,
      kind: "typescript",
      code: match[4],
      file: match[1],
      line: Number(match[2]),
      column: Number(match[3]),
      message: match[5].trim(),
      excerpt: match[0].trim()
    });
  }

  if (!failures.length) {
    const generalPattern = /error\s+(TS\d+):\s*([^\n]+)/g;
    while (true) {
      match = generalPattern.exec(value);
      if (!match) {
        break;
      }
      failures.push({
        sourceCheckId,
        kind: "typescript",
        code: match[1],
        message: match[2].trim(),
        excerpt: match[0].trim()
      });
    }
  }

  return failures;
}

function parseTestFailures(sourceCheckId: string, value: string): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  const failingNamePattern = /^✖\s+(.+)$/gm;
  let match: RegExpExecArray | null = null;
  while (true) {
    match = failingNamePattern.exec(value);
    if (!match) {
      break;
    }

    const message = match[1].trim();
    if (!message || message === "failing tests:") {
      continue;
    }

    failures.push({
      sourceCheckId,
      kind: "test",
      message,
      excerpt: match[0].trim()
    });
  }

  const failSuitePattern = /^\s*FAIL\s+([^\n]+)$/gm;
  while (true) {
    match = failSuitePattern.exec(value);
    if (!match) {
      break;
    }

    failures.push({
      sourceCheckId,
      kind: "test",
      message: `Test suite failed: ${match[1].trim()}`,
      excerpt: match[0].trim()
    });
  }

  const assertionPattern = /(AssertionError[^\n]*|Expected[^\n]*to[^\n]*)/g;
  while (true) {
    match = assertionPattern.exec(value);
    if (!match) {
      break;
    }

    failures.push({
      sourceCheckId,
      kind: "test",
      message: match[1].trim(),
      excerpt: match[0].trim()
    });
  }

  const loc = firstLocation(value);
  if (failures.length && loc.file) {
    failures[0] = {
      ...failures[0],
      ...loc
    };
  }

  return failures;
}

function parseBootFailures(sourceCheckId: string, value: string): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const errorPattern = /^Error:\s+([^\n]+)$/gm;
  let match: RegExpExecArray | null = null;

  while (true) {
    match = errorPattern.exec(value);
    if (!match) {
      break;
    }

    failures.push({
      sourceCheckId,
      kind: "boot",
      message: match[1].trim(),
      excerpt: match[0].trim()
    });
  }

  const codeMatch = value.match(/\bcode:\s*['"]([^'"]+)['"]/);
  if (codeMatch && failures.length) {
    failures[0] = {
      ...failures[0],
      code: codeMatch[1]
    };
  }

  const loc = firstLocation(value);
  if (failures.length && loc.file) {
    failures[0] = {
      ...failures[0],
      ...loc
    };
  }

  return failures;
}

function parseMigrationFailures(sourceCheckId: string, value: string): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  const codePattern = /\b(P\d{4})\b/g;
  let match: RegExpExecArray | null = null;
  const codes = new Set<string>();
  while (true) {
    match = codePattern.exec(value);
    if (!match) {
      break;
    }
    codes.add(match[1]);
  }

  const relevantLines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /migrat|prisma|schema|database|sql/i.test(line));

  if (codes.size || relevantLines.length) {
    const summary = relevantLines[0] || "Migration command failed.";
    failures.push({
      sourceCheckId,
      kind: "migration",
      code: Array.from(codes)[0],
      message: summary,
      excerpt: trimTail(relevantLines.slice(0, 8).join("\n") || value, 2_000)
    });
  }

  return failures;
}

function parseDependencyFailures(sourceCheckId: string, value: string): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const line = value
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => /ERESOLVE|EAI_AGAIN|ENOTFOUND|No matching version found|npm ERR!/i.test(entry));

  if (line) {
    const codeMatch = line.match(/\b(ERESOLVE|EAI_AGAIN|ENOTFOUND|E\d+)\b/i);
    failures.push({
      sourceCheckId,
      kind: "dependency",
      code: codeMatch ? codeMatch[1] : undefined,
      message: line,
      excerpt: trimTail(value)
    });
  }

  return failures;
}

export function parseCommandFailures(input: {
  sourceCheckId: string;
  combined: string;
  stderr?: string;
  stdout?: string;
}): ValidationFailure[] {
  const text = [input.combined || "", input.stderr || "", input.stdout || ""].filter(Boolean).join("\n");
  const source = input.sourceCheckId;
  let parsed: ValidationFailure[] = [];

  if (source === "typecheck" || source === "build") {
    parsed = parseTypeScriptFailures(source, text);
  } else if (source === "tests") {
    parsed = parseTestFailures(source, text);
  } else if (source === "boot") {
    parsed = parseBootFailures(source, text);
  } else if (source === "migration") {
    parsed = parseMigrationFailures(source, text);
  } else if (source === "install") {
    parsed = parseDependencyFailures(source, text);
  }

  parsed = dedupeFailures(parsed);
  if (parsed.length > 0) {
    return parsed.slice(0, 20);
  }

  if (!text.trim()) {
    return [];
  }

  return [
    {
      sourceCheckId: source,
      kind: "unknown",
      message: `${source} command failed.`,
      excerpt: trimTail(text)
    }
  ];
}
