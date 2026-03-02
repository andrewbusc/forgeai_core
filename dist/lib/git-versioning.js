import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { ensureDir, pathExists } from "./fs-utils.js";
const execFile = promisify(execFileCb);
let cachedGitAvailability = {
    checked: false,
    available: false
};
async function execGit(cwd, args, options = {}) {
    const result = await execFile("git", args, {
        cwd,
        maxBuffer: 4 * 1024 * 1024
    }).catch((error) => {
        if (options.allowFailure) {
            return {
                stdout: error.stdout ?? "",
                stderr: error.stderr ?? "",
                exitCode: 1
            };
        }
        throw new Error(`Git command failed: git ${args.join(" ")}\n${error.message}`);
    });
    return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: "exitCode" in result ? result.exitCode : 0
    };
}
export async function isGitAvailable() {
    if (cachedGitAvailability.checked) {
        return cachedGitAvailability.available;
    }
    try {
        await execFile("git", ["--version"]);
        cachedGitAvailability = { checked: true, available: true };
    }
    catch {
        cachedGitAvailability = { checked: true, available: false };
    }
    return cachedGitAvailability.available;
}
async function isGitRepo(projectDir) {
    try {
        await fs.access(path.join(projectDir, ".git"));
        return true;
    }
    catch {
        return false;
    }
}
export async function ensureGitRepo(projectDir) {
    if (!(await isGitAvailable())) {
        throw new Error("Git is not installed or unavailable on this host.");
    }
    await ensureDir(projectDir);
    if (await isGitRepo(projectDir)) {
        return;
    }
    await execGit(projectDir, ["init", "-b", "main"], { allowFailure: true });
    if (!(await isGitRepo(projectDir))) {
        await execGit(projectDir, ["init"]);
    }
    await execGit(projectDir, ["config", "user.name", process.env.GIT_AUTHOR_NAME || "deeprun Builder"]);
    await execGit(projectDir, ["config", "user.email", process.env.GIT_AUTHOR_EMAIL || "builder@local.dev"]);
}
function sanitizeRunIdentifier(value) {
    return value
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "");
}
function buildDefaultRunBranch(runId) {
    const safe = sanitizeRunIdentifier(runId) || "run";
    return `run/${safe.slice(0, 100)}`;
}
function buildDefaultWorktreePath(projectDir, runId) {
    return path.join(projectDir, ".deeprun", "worktrees", sanitizeRunIdentifier(runId) || "run");
}
async function hasPendingChanges(projectDir) {
    const result = await execGit(projectDir, ["status", "--porcelain"]);
    return result.stdout.trim().length > 0;
}
export async function isWorktreeDirty(projectDir) {
    await ensureGitRepo(projectDir);
    const result = await execGit(projectDir, ["status", "--porcelain"], {
        allowFailure: true
    });
    if (result.exitCode !== 0) {
        return false;
    }
    return result.stdout.trim().length > 0;
}
export async function createAutoCommit(projectDir, message) {
    await ensureGitRepo(projectDir);
    if (!(await hasPendingChanges(projectDir))) {
        return null;
    }
    await execGit(projectDir, ["add", "-A"]);
    await execGit(projectDir, ["commit", "-m", message, "--no-gpg-sign"]);
    const result = await execGit(projectDir, ["rev-parse", "--short", "HEAD"]);
    return result.stdout.trim();
}
export async function readCurrentCommitHash(projectDir) {
    await ensureGitRepo(projectDir);
    const result = await execGit(projectDir, ["rev-parse", "--short", "HEAD"], {
        allowFailure: true
    });
    const stderr = result.stderr.toLowerCase();
    if (stderr.includes("unknown revision") ||
        stderr.includes("bad revision") ||
        stderr.includes("ambiguous argument") ||
        stderr.includes("does not have any commits yet")) {
        return null;
    }
    const value = result.stdout.trim();
    return value || null;
}
async function readRefHash(projectDir, ref) {
    const result = await execGit(projectDir, ["rev-parse", "--verify", ref], {
        allowFailure: true
    });
    if (result.exitCode !== 0) {
        return null;
    }
    const value = result.stdout.trim();
    return value || null;
}
async function readCurrentBranch(projectDir) {
    const result = await execGit(projectDir, ["rev-parse", "--abbrev-ref", "HEAD"], {
        allowFailure: true
    });
    if (result.exitCode !== 0) {
        return null;
    }
    const value = result.stdout.trim();
    return value || null;
}
export async function readCurrentBranchName(projectDir) {
    await ensureGitRepo(projectDir);
    return readCurrentBranch(projectDir);
}
async function ensureHeadCommit(projectDir) {
    let hash = await readCurrentCommitHash(projectDir);
    if (hash) {
        return hash;
    }
    hash = await createAutoCommit(projectDir, "deeprun: bootstrap repository");
    if (hash) {
        return hash;
    }
    await execGit(projectDir, ["commit", "--allow-empty", "-m", "deeprun: bootstrap repository", "--no-gpg-sign"]);
    const resolved = await readCurrentCommitHash(projectDir);
    if (!resolved) {
        throw new Error("Unable to establish a base commit for repository.");
    }
    return resolved;
}
async function removeWorktreeIfExists(projectDir, worktreePath) {
    if (!(await pathExists(worktreePath))) {
        return;
    }
    await execGit(projectDir, ["worktree", "remove", "--force", worktreePath], {
        allowFailure: true
    });
    await fs.rm(worktreePath, { recursive: true, force: true });
}
export async function ensureRunWorktree(input) {
    await ensureGitRepo(input.projectDir);
    const runBranch = input.runBranch?.trim() || buildDefaultRunBranch(input.runId);
    const worktreePath = path.resolve(input.worktreePath || buildDefaultWorktreePath(input.projectDir, input.runId));
    const desiredBaseCommit = input.baseCommitHash || (await ensureHeadCommit(input.projectDir));
    const existingBranchHash = await readRefHash(input.projectDir, runBranch);
    if (!existingBranchHash) {
        await execGit(input.projectDir, ["branch", runBranch, desiredBaseCommit]);
    }
    const effectiveBaseCommit = existingBranchHash || desiredBaseCommit;
    let reuseExistingWorktree = false;
    if (await pathExists(worktreePath)) {
        const isWorktreeResult = await execGit(worktreePath, ["rev-parse", "--is-inside-work-tree"], {
            allowFailure: true
        });
        const currentBranch = isWorktreeResult.exitCode === 0 ? await readCurrentBranch(worktreePath) : null;
        reuseExistingWorktree = isWorktreeResult.exitCode === 0 && currentBranch === runBranch;
    }
    if (!reuseExistingWorktree) {
        await removeWorktreeIfExists(input.projectDir, worktreePath);
        await ensureDir(path.dirname(worktreePath));
        await execGit(input.projectDir, ["worktree", "prune"], { allowFailure: true });
        await execGit(input.projectDir, ["worktree", "add", "--force", worktreePath, runBranch]);
    }
    const currentCommitHash = await readCurrentCommitHash(worktreePath);
    return {
        runBranch,
        worktreePath,
        baseCommitHash: effectiveBaseCommit,
        currentCommitHash
    };
}
export async function resetWorktreeToCommit(projectDir, ref) {
    await ensureGitRepo(projectDir);
    await execGit(projectDir, ["reset", "--hard", ref]);
    await execGit(projectDir, ["clean", "-fd"]);
    return readCurrentCommitHash(projectDir);
}
export async function withIsolatedWorktree(input, runner) {
    await ensureGitRepo(input.projectDir);
    const root = path.join(input.projectDir, ".deeprun", "validation");
    await ensureDir(root);
    const isolatedRoot = await fs.mkdtemp(path.join(root, `${input.prefix || "check"}-`));
    const ref = input.ref?.trim() || (await ensureHeadCommit(input.projectDir));
    await execGit(input.projectDir, ["worktree", "add", "--detach", isolatedRoot, ref]);
    try {
        return await runner(isolatedRoot);
    }
    finally {
        await execGit(input.projectDir, ["worktree", "remove", "--force", isolatedRoot], {
            allowFailure: true
        });
        await fs.rm(isolatedRoot, { recursive: true, force: true });
    }
}
export async function listCommits(projectDir, limit = 40) {
    await ensureGitRepo(projectDir);
    const format = ["%H", "%h", "%an", "%ae", "%aI", "%s"].join("%x1f") + "%x1e";
    const result = await execGit(projectDir, ["log", `--max-count=${limit}`, `--pretty=format:${format}`], { allowFailure: true });
    if (result.stderr.includes("does not have any commits yet")) {
        return [];
    }
    return result.stdout
        .split("\x1e")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
        const [hash, shortHash, author, email, date, subject] = entry.split("\x1f");
        return {
            hash,
            shortHash,
            author,
            email,
            date,
            subject
        };
    });
}
export async function readDiff(projectDir, fromRef, toRef) {
    await ensureGitRepo(projectDir);
    const from = fromRef || "HEAD~1";
    const to = toRef || "HEAD";
    const result = await execGit(projectDir, ["diff", `${from}..${to}`], { allowFailure: true });
    if (result.stderr.includes("unknown revision") || result.stderr.includes("bad revision")) {
        const showResult = await execGit(projectDir, ["show", "--pretty=format:", to], {
            allowFailure: true
        });
        return {
            from,
            to,
            diff: showResult.stdout || showResult.stderr || ""
        };
    }
    return {
        from,
        to,
        diff: result.stdout || result.stderr || ""
    };
}
