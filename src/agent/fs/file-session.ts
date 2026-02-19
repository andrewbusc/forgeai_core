import { promises as fs } from "node:fs";
import path from "node:path";
import { createAutoCommit, readCurrentCommitHash } from "../../lib/git-versioning.js";
import { pathExists, readTextFile, safeResolvePath, writeTextFile } from "../../lib/fs-utils.js";
import { buildUnifiedDiffPreview } from "./diff-engine.js";
import {
  AppliedStepRecord,
  FileSessionCommitMeta,
  FileSessionOptions,
  FileValidationResult,
  NormalizedFileSessionOptions,
  ProposedFileChange,
  StagedFileChange,
  contentHash,
  proposedFileChangeSchema
} from "./types.js";
import { validateStagedChanges } from "./validator.js";

interface FileReadResult {
  path: string;
  exists: boolean;
  content: string | null;
  contentHash: string | null;
}

interface StepBackup {
  existed: boolean;
  content: string | null;
  contentHash: string | null;
}

interface ActiveStepTransaction {
  stepId: string;
  stepIndex: number;
  stagedChanges: Map<string, StagedFileChange>;
  applied: boolean;
  backups: Map<string, StepBackup> | null;
}

const defaultOptions: NormalizedFileSessionOptions = {
  maxFilesPerStep: 15,
  maxTotalDiffBytes: 400_000,
  maxFileBytes: 1_500_000,
  allowEnvMutation: false,
  restrictedPathPrefixes: []
};

function normalizeOptions(options: FileSessionOptions | undefined): NormalizedFileSessionOptions {
  const maxFilesPerStep = Number(options?.maxFilesPerStep);
  const maxTotalDiffBytes = Number(options?.maxTotalDiffBytes);
  const maxFileBytes = Number(options?.maxFileBytes);

  return {
    maxFilesPerStep:
      Number.isFinite(maxFilesPerStep) && maxFilesPerStep > 0
        ? Math.floor(maxFilesPerStep)
        : defaultOptions.maxFilesPerStep,
    maxTotalDiffBytes:
      Number.isFinite(maxTotalDiffBytes) && maxTotalDiffBytes > 0
        ? Math.floor(maxTotalDiffBytes)
        : defaultOptions.maxTotalDiffBytes,
    maxFileBytes:
      Number.isFinite(maxFileBytes) && maxFileBytes > 0 ? Math.floor(maxFileBytes) : defaultOptions.maxFileBytes,
    allowEnvMutation: options?.allowEnvMutation === true,
    restrictedPathPrefixes: (options?.restrictedPathPrefixes || []).filter((entry) => entry.trim().length > 0)
  };
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength);
}

function buildStepCommitMessage(meta: FileSessionCommitMeta): string {
  const summary = meta.summary ? ` :: ${truncateText(meta.summary, 80)}` : "";
  return `agentRunId=${meta.agentRunId} stepIndex=${meta.stepIndex} stepId=${meta.stepId}${summary}`;
}

export class FileSession {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly options: NormalizedFileSessionOptions;
  readonly appliedSteps: AppliedStepRecord[] = [];
  readonly workingTreeSnapshot = new Map<string, string | null>();

  private _baseCommitHash: string | null;
  private _currentCommitHash: string | null;
  private currentStep: ActiveStepTransaction | null = null;
  private lastCommittedDiffs: StagedFileChange[] = [];

  private constructor(input: {
    projectId: string;
    projectRoot: string;
    baseCommitHash: string | null;
    options: NormalizedFileSessionOptions;
  }) {
    this.projectId = input.projectId;
    this.projectRoot = path.resolve(input.projectRoot);
    this._baseCommitHash = input.baseCommitHash;
    this._currentCommitHash = input.baseCommitHash;
    this.options = input.options;
  }

  static async create(input: {
    projectId: string;
    projectRoot: string;
    baseCommitHash?: string | null;
    options?: FileSessionOptions;
  }): Promise<FileSession> {
    const baseCommitHash =
      input.baseCommitHash === undefined ? await readCurrentCommitHash(input.projectRoot) : input.baseCommitHash;

    return new FileSession({
      projectId: input.projectId,
      projectRoot: input.projectRoot,
      baseCommitHash,
      options: normalizeOptions(input.options)
    });
  }

  get baseCommitHash(): string | null {
    return this._baseCommitHash;
  }

  get currentCommitHash(): string | null {
    return this._currentCommitHash;
  }

  getLastCommittedDiffs(): StagedFileChange[] {
    return [...this.lastCommittedDiffs];
  }

  beginStep(stepId: string, stepIndex: number): void {
    if (this.currentStep) {
      throw new Error(`Cannot begin step '${stepId}' while step '${this.currentStep.stepId}' is still active.`);
    }

    this.currentStep = {
      stepId,
      stepIndex,
      stagedChanges: new Map<string, StagedFileChange>(),
      applied: false,
      backups: null
    };
  }

  async read(relativePath: string): Promise<FileReadResult> {
    const normalized = normalizeRelativePath(relativePath);
    const staged = this.currentStep?.stagedChanges.get(normalized);

    if (staged) {
      const exists = staged.type !== "delete";
      const content = staged.type === "delete" ? null : staged.newContent || null;
      return {
        path: normalized,
        exists,
        content,
        contentHash: content === null ? null : contentHash(content)
      };
    }

    const absolutePath = safeResolvePath(this.projectRoot, normalized);
    const disk = await this.readFromDisk(absolutePath);
    this.workingTreeSnapshot.set(normalized, disk.contentHash);

    return {
      path: normalized,
      exists: disk.exists,
      content: disk.content,
      contentHash: disk.contentHash
    };
  }

  async stageChange(change: ProposedFileChange): Promise<StagedFileChange> {
    const step = this.requireActiveStep();
    if (step.applied) {
      throw new Error(`Cannot stage additional changes after step '${step.stepId}' has been applied.`);
    }

    const parsed = proposedFileChangeSchema.parse(change);
    const normalizedPath = normalizeRelativePath(parsed.path);
    const absolutePath = safeResolvePath(this.projectRoot, normalizedPath);
    const prior = step.stagedChanges.get(normalizedPath);

    const existing = prior
      ? {
          exists: prior.previousContent !== null,
          content: prior.previousContent,
          contentHash: prior.previousContentHash
        }
      : await this.readFromDisk(absolutePath);

    if (parsed.type === "create") {
      if (existing.exists) {
        throw new Error(`Cannot create '${normalizedPath}' because it already exists.`);
      }
      if (typeof parsed.newContent !== "string") {
        throw new Error(`Create change for '${normalizedPath}' is missing newContent.`);
      }
    }

    if (parsed.type === "update") {
      if (!existing.exists || existing.content === null || !existing.contentHash) {
        throw new Error(`Cannot update '${normalizedPath}' because the file does not exist.`);
      }
      if (!parsed.oldContentHash) {
        throw new Error(`Update change for '${normalizedPath}' requires oldContentHash.`);
      }
      if (parsed.oldContentHash !== existing.contentHash) {
        throw new Error(
          `Optimistic lock failed for '${normalizedPath}'. Expected ${parsed.oldContentHash}, found ${existing.contentHash}.`
        );
      }
      if (typeof parsed.newContent !== "string") {
        throw new Error(`Update change for '${normalizedPath}' is missing newContent.`);
      }
    }

    if (parsed.type === "delete") {
      if (!existing.exists || existing.content === null || !existing.contentHash) {
        throw new Error(`Cannot delete '${normalizedPath}' because the file does not exist.`);
      }
      if (parsed.oldContentHash && parsed.oldContentHash !== existing.contentHash) {
        throw new Error(
          `Delete optimistic lock failed for '${normalizedPath}'. Expected ${parsed.oldContentHash}, found ${existing.contentHash}.`
        );
      }
    }

    const nextContent = parsed.type === "delete" ? null : parsed.newContent || null;
    const diffPreview = buildUnifiedDiffPreview({
      path: normalizedPath,
      before: existing.content,
      after: nextContent
    });

    const staged: StagedFileChange = {
      path: normalizedPath,
      type: parsed.type,
      newContent: parsed.newContent,
      oldContentHash: parsed.oldContentHash,
      absolutePath,
      previousContent: existing.content,
      previousContentHash: existing.contentHash,
      nextContentHash: nextContent === null ? null : contentHash(nextContent),
      diffPreview,
      diffBytes: Buffer.byteLength(diffPreview, "utf8")
    };

    step.stagedChanges.set(normalizedPath, staged);
    this.workingTreeSnapshot.set(normalizedPath, staged.nextContentHash);

    return staged;
  }

  getStagedDiffs(): StagedFileChange[] {
    const step = this.requireActiveStep();
    return Array.from(step.stagedChanges.values()).sort((a, b) => a.path.localeCompare(b.path));
  }

  validateStep(): FileValidationResult {
    const step = this.requireActiveStep();
    const stagedChanges = Array.from(step.stagedChanges.values());
    const result = validateStagedChanges({
      projectRoot: this.projectRoot,
      stagedChanges,
      config: this.options
    });

    if (!result.ok) {
      const message = result.issues.map((issue) => issue.message).join(" | ");
      throw new Error(`Step validation failed: ${message}`);
    }

    return result;
  }

  async applyStepChanges(): Promise<void> {
    const step = this.requireActiveStep();
    if (step.applied) {
      return;
    }

    const stagedChanges = this.getStagedDiffs();
    if (stagedChanges.length === 0) {
      throw new Error(`Step '${step.stepId}' has no staged changes to apply.`);
    }

    for (const staged of stagedChanges) {
      const currentDisk = await this.readFromDisk(staged.absolutePath);
      if (currentDisk.contentHash !== staged.previousContentHash) {
        throw new Error(
          `File lock check failed for '${staged.path}'. Expected ${staged.previousContentHash || "null"}, found ${currentDisk.contentHash || "null"}.`
        );
      }
    }

    const backups = new Map<string, StepBackup>();
    for (const staged of stagedChanges) {
      backups.set(staged.path, {
        existed: staged.previousContent !== null,
        content: staged.previousContent,
        contentHash: staged.previousContentHash
      });
    }

    try {
      for (const staged of stagedChanges) {
        if (staged.type === "delete") {
          await fs.rm(staged.absolutePath, { force: true });
        } else {
          await writeTextFile(staged.absolutePath, staged.newContent || "");
        }
      }
    } catch (error) {
      await this.restoreBackups(backups, stagedChanges);
      throw error;
    }

    step.applied = true;
    step.backups = backups;
  }

  async applyStep(): Promise<void> {
    await this.applyStepChanges();
  }

  async commitStep(meta: FileSessionCommitMeta): Promise<string | null> {
    const step = this.requireActiveStep();
    if (meta.stepId !== step.stepId || meta.stepIndex !== step.stepIndex) {
      throw new Error(
        `Commit metadata does not match active step. Active=${step.stepId}:${step.stepIndex}, Provided=${meta.stepId}:${meta.stepIndex}.`
      );
    }

    if (!step.applied) {
      await this.applyStepChanges();
    }

    const stagedChanges = this.getStagedDiffs();
    let commitHash: string | null = null;

    try {
      commitHash = await createAutoCommit(this.projectRoot, buildStepCommitMessage(meta));
    } catch (error) {
      if (step.backups) {
        await this.restoreBackups(step.backups, stagedChanges).catch(() => undefined);
      }
      throw error;
    }

    this._currentCommitHash = commitHash || this._currentCommitHash;
    this._baseCommitHash = this._currentCommitHash;
    this.lastCommittedDiffs = stagedChanges;
    this.appliedSteps.push({
      stepId: step.stepId,
      stepIndex: step.stepIndex,
      commitHash,
      filePaths: stagedChanges.map((entry) => entry.path),
      committedAt: new Date().toISOString()
    });

    this.currentStep = null;
    return commitHash;
  }

  async abortStep(): Promise<void> {
    const step = this.currentStep;
    if (!step) {
      return;
    }

    const stagedChanges = Array.from(step.stagedChanges.values());

    if (step.applied && step.backups) {
      await this.restoreBackups(step.backups, stagedChanges);
    }

    for (const staged of stagedChanges) {
      this.workingTreeSnapshot.set(staged.path, staged.previousContentHash);
    }

    this.currentStep = null;
  }

  async rollbackToBase(): Promise<void> {
    if (this.currentStep) {
      await this.abortStep();
    }

    if (this.appliedSteps.length > 0) {
      throw new Error("rollbackToBase for committed steps is not available in v1.");
    }
  }

  async clear(): Promise<void> {
    await this.abortStep();
    this.lastCommittedDiffs = [];
  }

  private requireActiveStep(): ActiveStepTransaction {
    if (!this.currentStep) {
      throw new Error("No active step. Call beginStep(stepId, stepIndex) before staging changes.");
    }
    return this.currentStep;
  }

  private async readFromDisk(absolutePath: string): Promise<{ exists: boolean; content: string | null; contentHash: string | null }> {
    const exists = await pathExists(absolutePath);
    if (!exists) {
      return {
        exists: false,
        content: null,
        contentHash: null
      };
    }

    const content = await readTextFile(absolutePath);
    return {
      exists: true,
      content,
      contentHash: contentHash(content)
    };
  }

  private async restoreBackups(backups: Map<string, StepBackup>, stagedChanges: StagedFileChange[]): Promise<void> {
    for (const staged of stagedChanges) {
      const backup = backups.get(staged.path);
      if (!backup) {
        continue;
      }

      if (backup.existed) {
        await writeTextFile(staged.absolutePath, backup.content || "");
      } else {
        await fs.rm(staged.absolutePath, { force: true });
      }

      this.workingTreeSnapshot.set(staged.path, backup.contentHash);
    }
  }
}
