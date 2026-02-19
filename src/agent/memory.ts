import path from "node:path";
import { collectFiles, pathExists, readTextFile } from "../lib/fs-utils.js";
import { ProjectArchitectureSummary } from "./types.js";

interface PackageJsonLite {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface MemoryAnalysisResult {
  architectureSummary: ProjectArchitectureSummary;
  stackInfo: Record<string, unknown>;
}

function asDependencySet(pkg: PackageJsonLite | null): Set<string> {
  return new Set([
    ...Object.keys(pkg?.dependencies || {}),
    ...Object.keys(pkg?.devDependencies || {})
  ]);
}

function hasAny(values: Set<string>, keys: string[]): boolean {
  return keys.some((key) => values.has(key));
}

function detectFramework(deps: Set<string>, fileSet: Set<string>): string {
  if (deps.has("next")) {
    return "Next.js";
  }
  if (deps.has("@nestjs/core")) {
    return "NestJS";
  }
  if (deps.has("express")) {
    return "Express";
  }
  if (deps.has("fastify")) {
    return "Fastify";
  }
  if (deps.has("koa")) {
    return "Koa";
  }
  if (deps.has("hono")) {
    return "Hono";
  }
  if (deps.has("react") && deps.has("vite")) {
    return "React + Vite";
  }
  if (deps.has("react")) {
    return "React";
  }
  if (deps.has("vue")) {
    return "Vue";
  }
  if (deps.has("svelte")) {
    return "Svelte";
  }
  if (fileSet.has("src/server.ts")) {
    return "Node Server";
  }
  return "Unknown";
}

function detectDatabase(deps: Set<string>, fileSet: Set<string>): string {
  if (deps.has("prisma") || fileSet.has("prisma/schema.prisma")) {
    return "Prisma";
  }
  if (hasAny(deps, ["drizzle-orm", "drizzle-kit"])) {
    return "Drizzle";
  }
  if (deps.has("pg")) {
    return "Postgres";
  }
  if (hasAny(deps, ["mysql2", "mysql"])) {
    return "MySQL";
  }
  if (hasAny(deps, ["mongodb", "mongoose"])) {
    return "MongoDB";
  }
  if (hasAny(deps, ["sqlite3", "better-sqlite3"])) {
    return "SQLite";
  }
  return "Unknown";
}

function detectAuth(deps: Set<string>, fileSet: Set<string>): string {
  if (hasAny(deps, ["next-auth", "@auth/core"])) {
    return "NextAuth";
  }
  if (deps.has("jsonwebtoken")) {
    return "JWT";
  }
  if (deps.has("passport")) {
    return "Passport";
  }
  if (deps.has("@clerk/nextjs")) {
    return "Clerk";
  }
  if (hasAny(deps, ["@supabase/supabase-js", "@supabase/ssr"])) {
    return "Supabase Auth";
  }

  for (const file of fileSet) {
    if (/auth|login|session|token|jwt/i.test(file)) {
      return "Custom Auth";
    }
  }

  return "None detected";
}

function detectPayment(deps: Set<string>, fileSet: Set<string>): string {
  if (deps.has("stripe")) {
    return "Stripe";
  }
  if (deps.has("paddle-sdk")) {
    return "Paddle";
  }
  if (hasAny(deps, ["paypal-rest-sdk", "@paypal/checkout-server-sdk"])) {
    return "PayPal";
  }
  if (hasAny(deps, ["braintree", "braintree-web"])) {
    return "Braintree";
  }
  if (hasAny(deps, ["@lemonsqueezy/lemonsqueezy.js"])) {
    return "LemonSqueezy";
  }

  for (const file of fileSet) {
    if (/billing|payment|checkout|stripe|subscription/i.test(file)) {
      return "Custom Payment";
    }
  }

  return "None detected";
}

function detectLanguages(filePaths: string[]): string[] {
  const extensions = new Set(filePaths.map((value) => path.extname(value).toLowerCase()));
  const languages: string[] = [];

  if (extensions.has(".ts") || extensions.has(".tsx")) {
    languages.push("TypeScript");
  }
  if (extensions.has(".js") || extensions.has(".jsx")) {
    languages.push("JavaScript");
  }
  if (extensions.has(".sql")) {
    languages.push("SQL");
  }
  if (extensions.has(".prisma")) {
    languages.push("Prisma");
  }
  if (!languages.length) {
    languages.push("Unknown");
  }

  return languages;
}

async function detectPackageManager(projectRoot: string): Promise<string> {
  const checks: Array<[string, string]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"]
  ];

  for (const [relative, manager] of checks) {
    if (await pathExists(path.join(projectRoot, relative))) {
      return manager;
    }
  }

  return "unknown";
}

async function readPackageJsonLite(projectRoot: string): Promise<PackageJsonLite | null> {
  const packageJsonPath = path.join(projectRoot, "package.json");

  if (!(await pathExists(packageJsonPath))) {
    return null;
  }

  try {
    const parsed = JSON.parse(await readTextFile(packageJsonPath)) as PackageJsonLite;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function detectKeyFiles(projectRoot: string, filePaths: string[]): Promise<string[]> {
  const candidates = [
    "package.json",
    "README.md",
    ".env.example",
    "src/server.ts",
    "src/index.ts",
    "src/main.ts",
    "src/app.ts",
    "src/routes.ts",
    "src/lib/auth.ts",
    "src/lib/project-store.ts",
    "prisma/schema.prisma"
  ];

  const selected: string[] = [];

  for (const relative of candidates) {
    if (selected.length >= 14) {
      break;
    }

    if (await pathExists(path.join(projectRoot, relative))) {
      selected.push(relative);
    }
  }

  for (const file of filePaths) {
    if (selected.length >= 14) {
      break;
    }

    if (selected.includes(file)) {
      continue;
    }

    if (/server|app|index|auth|route|stripe|billing|payment|db|database|schema|prisma/i.test(file)) {
      selected.push(file);
    }
  }

  return selected;
}

function collectDependencyMatches(deps: Set<string>, keys: string[]): string[] {
  return keys.filter((key) => deps.has(key));
}

export async function analyzeProjectForMemory(projectRoot: string): Promise<MemoryAnalysisResult> {
  const pkg = await readPackageJsonLite(projectRoot);
  const dependencies = asDependencySet(pkg);
  const files = await collectFiles(projectRoot, 260, 200);
  const filePaths = files.map((entry) => entry.path);
  const fileSet = new Set(filePaths);

  const framework = detectFramework(dependencies, fileSet);
  const database = detectDatabase(dependencies, fileSet);
  const auth = detectAuth(dependencies, fileSet);
  const payment = detectPayment(dependencies, fileSet);
  const keyFiles = await detectKeyFiles(projectRoot, filePaths);
  const packageManager = await detectPackageManager(projectRoot);

  const stackInfo: Record<string, unknown> = {
    runtime: "node",
    packageManager,
    languages: detectLanguages(filePaths),
    frameworkHints: framework === "Unknown" ? [] : [framework],
    databaseHints: database === "Unknown" ? [] : [database],
    authHints: auth === "None detected" ? [] : [auth],
    paymentHints: payment === "None detected" ? [] : [payment],
    scripts: Object.keys(pkg?.scripts || {}).slice(0, 20),
    dependencySignals: {
      database: collectDependencyMatches(dependencies, [
        "prisma",
        "drizzle-orm",
        "drizzle-kit",
        "pg",
        "mysql2",
        "mongoose",
        "mongodb",
        "sqlite3",
        "better-sqlite3"
      ]),
      auth: collectDependencyMatches(dependencies, [
        "jsonwebtoken",
        "passport",
        "next-auth",
        "@auth/core",
        "@clerk/nextjs",
        "@supabase/supabase-js"
      ]),
      payment: collectDependencyMatches(dependencies, [
        "stripe",
        "paddle-sdk",
        "@paypal/checkout-server-sdk",
        "braintree",
        "@lemonsqueezy/lemonsqueezy.js"
      ])
    }
  };

  return {
    architectureSummary: {
      framework,
      database,
      auth,
      payment,
      keyFiles
    },
    stackInfo
  };
}
