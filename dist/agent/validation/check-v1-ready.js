import path from "node:path";
import { spawn } from "node:child_process";
import { runLightProjectValidation } from "./project-validator.js";
function runCommand(command, args, cwd) {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });
        child.on("close", (code) => {
            const exitCode = Number.isInteger(code) ? Number(code) : 1;
            resolve({
                ok: exitCode === 0,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode
            });
        });
    });
}
async function runTypeCheck(target) {
    const result = await runCommand("npm", ["run", "check"], target);
    if (result.ok) {
        return {
            id: "typecheck",
            status: "pass",
            message: "TypeScript check passed."
        };
    }
    return {
        id: "typecheck",
        status: "fail",
        message: "TypeScript check failed.",
        details: {
            exitCode: result.exitCode,
            stderr: result.stderr || undefined
        }
    };
}
async function runArchitectureCheck(target) {
    const result = await runLightProjectValidation(target);
    if (result.ok) {
        return {
            id: "architecture",
            status: "pass",
            message: "Architecture contract passed.",
            details: {
                warnings: result.warningCount
            }
        };
    }
    return {
        id: "architecture",
        status: "fail",
        message: "Architecture contract failed.",
        details: {
            blockingCount: result.blockingCount,
            warningCount: result.warningCount,
            violations: result.violations.slice(0, 25)
        }
    };
}
async function main() {
    const target = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
    const checks = [];
    checks.push(await runTypeCheck(target));
    checks.push(await runArchitectureCheck(target));
    const failed = checks.filter((check) => check.status === "fail");
    const verdict = failed.length === 0 ? "YES" : "NO";
    const payload = {
        target,
        verdict,
        ok: verdict === "YES",
        checks
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (verdict !== "YES") {
        process.exitCode = 1;
    }
}
main().catch((error) => {
    process.stdout.write(`${JSON.stringify({
        verdict: "NO",
        ok: false,
        error: error instanceof Error ? error.message : String(error)
    }, null, 2)}\n`);
    process.exitCode = 1;
});
