import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const rootPackagePath = resolve(workspaceRoot, "package.json");
const rootPackage = await readJson(rootPackagePath);
const currentVersion = rootPackage.version;
const nextVersion = args.version ?? bumpVersion(currentVersion, args.bump ?? "patch");

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(nextVersion)) {
  throw new Error(`Invalid semver version: ${nextVersion}`);
}

const releaseTag = `v${nextVersion}`;
const releaseNotes = args.notes || getCommitSummary();

await updatePackageVersions(nextVersion);
await updateChangelog(releaseTag, releaseNotes);

console.log(`Prepared ${releaseTag}`);

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--version") {
      parsed.version = rawArgs[++index];
      continue;
    }

    if (arg === "--bump") {
      parsed.bump = rawArgs[++index];
      continue;
    }

    if (arg === "--notes") {
      parsed.notes = rawArgs[++index];
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (parsed.version && parsed.bump) {
    throw new Error("Use either --version or --bump, not both");
  }

  if (parsed.bump && !["patch", "minor", "major"].includes(parsed.bump)) {
    throw new Error("--bump must be patch, minor, or major");
  }

  return parsed;
}

function bumpVersion(version, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Cannot auto-bump non-standard version: ${version}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

async function updatePackageVersions(version) {
  const packagePaths = [
    "package.json",
    "apps/desktop/package.json",
    "apps/server/package.json",
    "packages/shared/package.json"
  ];

  for (const packagePath of packagePaths) {
    const fullPath = resolve(workspaceRoot, packagePath);
    const packageJson = await readJson(fullPath);
    packageJson.version = version;

    if (packageJson.dependencies?.["@remote-control/shared"]) {
      packageJson.dependencies["@remote-control/shared"] = version;
    }

    await writeJson(fullPath, packageJson);
  }

  const packageLockPath = resolve(workspaceRoot, "package-lock.json");
  const packageLock = await readJson(packageLockPath);
  packageLock.version = version;
  packageLock.packages[""].version = version;
  packageLock.packages["apps/desktop"].version = version;
  packageLock.packages["apps/desktop"].dependencies["@remote-control/shared"] = version;
  packageLock.packages["apps/server"].version = version;
  packageLock.packages["apps/server"].dependencies["@remote-control/shared"] = version;
  packageLock.packages["packages/shared"].version = version;
  await writeJson(packageLockPath, packageLock);
}

async function updateChangelog(releaseTag, notes) {
  const changelogPath = resolve(workspaceRoot, "CHANGELOG.md");
  const existing = await readTextIfExists(changelogPath);
  const date = process.env.RELEASE_DATE ?? new Date().toISOString().slice(0, 10);
  const entry = [
    `## ${releaseTag} - ${date}`,
    "",
    ...formatNotes(notes),
    ""
  ].join("\n");

  const normalizedExisting = existing.trim();
  const nextContent = normalizedExisting.startsWith("# Changelog")
    ? normalizedExisting.replace("# Changelog", `# Changelog\n\n${entry}`)
    : `# Changelog\n\n${entry}${normalizedExisting ? `\n${normalizedExisting}` : ""}`;

  await writeFile(changelogPath, `${nextContent.trim()}\n`, "utf8");
}

function formatNotes(notes) {
  const lines = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^-+\s*/, ""))
    .map((line) => `- ${line}`);

  return lines.length > 0 ? lines : ["- No user-facing changes listed."];
}

function getCommitSummary() {
  const previousTag = spawnSync("git", ["describe", "--tags", "--abbrev=0"], {
    cwd: workspaceRoot,
    encoding: "utf8"
  });

  const range = previousTag.status === 0
    ? [`${previousTag.stdout.trim()}..HEAD`]
    : [];

  const log = spawnSync("git", ["log", "--pretty=format:%s", ...range], {
    cwd: workspaceRoot,
    encoding: "utf8"
  });

  if (log.status !== 0 || !log.stdout.trim()) {
    return "No user-facing changes listed.";
  }

  return log.stdout;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readTextIfExists(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}
