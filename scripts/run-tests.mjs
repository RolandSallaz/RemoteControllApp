import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const searchRoots = ["apps", "packages"];
const coverageSourceRoots = [
  "apps/desktop/src/main",
  "apps/desktop/src/preload",
  "apps/server/src",
  "packages/shared/src"
];
const testFiles = [];
const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, "..");
const args = process.argv.slice(2);
const coverageEnabled = args.includes("--coverage");
const requestedTestFiles = args.filter((arg) => !arg.startsWith("--"));

if (requestedTestFiles.length > 0) {
  testFiles.push(...requestedTestFiles.map((filePath) => resolve(workspaceRoot, filePath)));
} else {
  for (const root of searchRoots) {
    await collectTestFiles(root);
  }
}

if (testFiles.length === 0) {
  console.log("No test files found.");
  process.exit(0);
}

const tsxCli = join(workspaceRoot, "node_modules", "tsx", "dist", "cli.mjs");
const coverageDirectory = join(workspaceRoot, "coverage", "v8");
if (coverageEnabled) {
  await rm(coverageDirectory, { recursive: true, force: true });
  await mkdir(coverageDirectory, { recursive: true });
}

const nodeArgs = [
  ...(coverageEnabled ? getCoverageNodeArgs() : []),
  tsxCli,
  "--tsconfig",
  "tsconfig.base.json",
  "--test",
  "--test-concurrency=1",
  ...getOptionalTestRunnerArgs(),
  ...testFiles
];

const child = spawn(process.execPath, nodeArgs, {
  env: {
    ...process.env,
    ...(coverageEnabled ? { NODE_V8_COVERAGE: coverageDirectory } : {})
  },
  stdio: "inherit"
});

child.on("close", async (code, signal) => {
  if (signal) {
    console.error(`Test runner stopped by ${signal}`);
    process.exit(1);
  }

  if (coverageEnabled) {
    try {
      await writeCoverageSummary(coverageDirectory);
    } catch (error) {
      console.error(`Failed to summarize coverage: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  process.exit(code ?? 1);
});

async function collectTestFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "out") {
        continue;
      }

      await collectTestFiles(path);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      testFiles.push(path);
    }
  }
}

function getCoverageNodeArgs() {
  return [
    "--experimental-test-coverage",
    "--test-coverage-exclude=**/*.test.ts",
    "--test-coverage-exclude=**/dist/**",
    "--test-coverage-exclude=**/out/**",
    "--test-coverage-exclude=**/backend/**",
    "--test-coverage-exclude=**/release/**",
    "--test-coverage-exclude=**/release-*/**",
    "--test-coverage-exclude=coverage/**",
    "--test-coverage-include=apps/desktop/src/main/**/*.ts",
    "--test-coverage-include=apps/desktop/src/preload/**/*.ts",
    "--test-coverage-include=apps/server/src/**/*.ts",
    "--test-coverage-include=packages/shared/src/**/*.ts"
  ];
}

function getOptionalTestRunnerArgs() {
  return supportsNodeCliFlag("--test-isolation=none") ? ["--test-isolation=none"] : [];
}

function supportsNodeCliFlag(flag) {
  const probe = spawnSync(process.execPath, [flag, "-e", "0"], {
    stdio: "ignore"
  });

  return probe.status === 0;
}

async function writeCoverageSummary(coverageDirectory) {
  const sourceFiles = await collectCoverageSourceFiles();
  const summaries = new Map(
    sourceFiles.map((filePath) => [
      pathToFileURL(filePath).href,
      {
        file: toWorkspaceRelativePath(filePath),
        bytesCovered: 0,
        totalBytes: 0,
        coveredFunctions: 0,
        totalFunctions: 0
      }
    ])
  );

  const coverageFiles = await readdir(coverageDirectory, { withFileTypes: true });
  for (const entry of coverageFiles) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const content = await readFile(join(coverageDirectory, entry.name), "utf8");
    const report = JSON.parse(content);
    for (const script of report.result ?? []) {
      if (typeof script.url !== "string" || !summaries.has(script.url)) {
        continue;
      }

      const summary = summaries.get(script.url);
      if (!summary) {
        continue;
      }

      const filePath = fileURLToPath(script.url);
      const fileContent = await readFile(filePath, "utf8");
      const intervals = [];
      const functions = new Map();

      for (const fn of script.functions ?? []) {
        const firstRange = fn.ranges?.[0];
        const isModuleWrapper = Boolean(
          firstRange
          && firstRange.startOffset === 0
          && firstRange.endOffset >= fileContent.length
          && fn.functionName === ""
        );
        if (isModuleWrapper) {
          continue;
        }

        const functionKey = `${fn.functionName}:${firstRange?.startOffset ?? 0}:${firstRange?.endOffset ?? 0}`;
        const covered = (fn.ranges ?? []).some((range) => range.count > 0);
        functions.set(functionKey, (functions.get(functionKey) ?? false) || covered);

        for (const range of fn.ranges ?? []) {
          if (range.count > 0 && Number.isInteger(range.startOffset) && Number.isInteger(range.endOffset)) {
            intervals.push([range.startOffset, range.endOffset]);
          }
        }
      }

      summary.totalBytes = fileContent.length;
      summary.bytesCovered = Math.max(summary.bytesCovered, getCoveredLength(intervals, fileContent.length));
      summary.totalFunctions = Math.max(summary.totalFunctions, functions.size);
      summary.coveredFunctions = Math.max(
        summary.coveredFunctions,
        [...functions.values()].filter(Boolean).length
      );
    }
  }

  const rows = [...summaries.values()]
    .map((summary) => ({
      ...summary,
      bytePercent: summary.totalBytes === 0 ? 100 : (summary.bytesCovered / summary.totalBytes) * 100,
      functionPercent: summary.totalFunctions === 0 ? 100 : (summary.coveredFunctions / summary.totalFunctions) * 100
    }))
    .sort((a, b) => a.bytePercent - b.bytePercent || a.file.localeCompare(b.file));

  const totalBytes = rows.reduce((sum, row) => sum + row.totalBytes, 0);
  const totalCoveredBytes = rows.reduce((sum, row) => sum + row.bytesCovered, 0);
  const totalFunctions = rows.reduce((sum, row) => sum + row.totalFunctions, 0);
  const totalCoveredFunctions = rows.reduce((sum, row) => sum + row.coveredFunctions, 0);

  const totals = {
    files: rows.length,
    bytesCovered: totalCoveredBytes,
    totalBytes,
    bytePercent: totalBytes === 0 ? 100 : (totalCoveredBytes / totalBytes) * 100,
    coveredFunctions: totalCoveredFunctions,
    totalFunctions,
    functionPercent: totalFunctions === 0 ? 100 : (totalCoveredFunctions / totalFunctions) * 100
  };

  const summaryJsonPath = join(workspaceRoot, "coverage", "summary.json");
  const summaryTextPath = join(workspaceRoot, "coverage", "summary.txt");
  const summaryJson = {
    totals,
    files: rows
  };
  const summaryText = formatCoverageSummary(rows, totals);

  await writeFile(summaryJsonPath, `${JSON.stringify(summaryJson, null, 2)}\n`, "utf8");
  await writeFile(summaryTextPath, summaryText, "utf8");
  console.log(summaryText);
}

async function collectCoverageSourceFiles() {
  const files = [];
  for (const root of coverageSourceRoots) {
    await walkCoverageSourceTree(resolve(workspaceRoot, root), files);
  }

  return files;
}

async function walkCoverageSourceTree(directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkCoverageSourceTree(path, files);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      && !entry.name.endsWith(".d.ts")
      && !entry.name.endsWith(".test.ts")
    ) {
      files.push(path);
    }
  }
}

function getCoveredLength(intervals, sourceLength) {
  if (intervals.length === 0) {
    return 0;
  }

  const normalized = intervals
    .map(([start, end]) => [Math.max(0, start), Math.min(sourceLength, end)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);

  let coveredLength = 0;
  let currentStart = normalized[0][0];
  let currentEnd = normalized[0][1];

  for (let index = 1; index < normalized.length; index += 1) {
    const [start, end] = normalized[index];
    if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
      continue;
    }

    coveredLength += currentEnd - currentStart;
    currentStart = start;
    currentEnd = end;
  }

  coveredLength += currentEnd - currentStart;
  return coveredLength;
}

function toWorkspaceRelativePath(filePath) {
  return filePath.slice(workspaceRoot.length + 1).replace(/\\/g, "/");
}

function formatCoverageSummary(rows, totals) {
  const lines = [
    "",
    "Coverage Summary",
    "File | Byte % | Func %",
    "--- | ---: | ---:"
  ];

  for (const row of rows) {
    lines.push(`${row.file} | ${row.bytePercent.toFixed(1)} | ${row.functionPercent.toFixed(1)}`);
  }

  lines.push("--- | ---: | ---:");
  lines.push(`TOTAL (${totals.files} files) | ${totals.bytePercent.toFixed(1)} | ${totals.functionPercent.toFixed(1)}`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}
