import path from "node:path";
import { rm } from "node:fs/promises";
import { ensureDir, writeTextFile } from "../lib/fs-utils.js";
import { workspacePath } from "../lib/workspace.js";
import { getTemplate } from "../templates/catalog.js";
import type { ProjectTemplateId } from "../types.js";

const allowedTemplateIds: ProjectTemplateId[] = [
  "canonical-backend",
  "saas-web-app",
  "agent-workflow",
  "chatbot"
];

interface PrepareOptions {
  outputPath: string;
  templateId: ProjectTemplateId;
  clean: boolean;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: npm run prepare:v1-ready-target -- [options]",
      "",
      "Options:",
      "  --output <path>      Target directory to scaffold (default: DEEPRUN_WORKSPACE_ROOT/.deeprun/v1-ready-target)",
      "  --template <id>      Template id (default: canonical-backend)",
      "  --clean <bool>       Remove target directory before scaffold (default: true)",
      "  --help               Show this help message",
      "",
      `Allowed templates: ${allowedTemplateIds.join(", ")}`
    ].join("\n") + "\n"
  );
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseOptions(argv: string[]): PrepareOptions {
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
      continue;
    }

    options[key] = "true";
  }

  const templateIdRaw = options.template || "canonical-backend";
  if (!allowedTemplateIds.includes(templateIdRaw as ProjectTemplateId)) {
    throw new Error(`Unsupported template '${templateIdRaw}'.`);
  }

  const outputPath = path.resolve(options.output || workspacePath(".deeprun", "v1-ready-target"));

  return {
    outputPath,
    templateId: templateIdRaw as ProjectTemplateId,
    clean: parseBool(options.clean, true)
  };
}

async function scaffoldTarget(options: PrepareOptions): Promise<string> {
  if (options.clean) {
    await rm(options.outputPath, { recursive: true, force: true });
  }

  await ensureDir(options.outputPath);
  const template = getTemplate(options.templateId);

  for (const [relativePath, content] of Object.entries(template.starterFiles).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const absolutePath = path.join(options.outputPath, relativePath);
    await writeTextFile(absolutePath, content);
  }

  return options.outputPath;
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    printHelp();
    return;
  }

  const options = parseOptions(process.argv.slice(2));
  const targetPath = await scaffoldTarget(options);
  process.stdout.write(`${targetPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`prepare-v1-ready-target failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
