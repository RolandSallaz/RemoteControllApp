import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const packageJsonPath = resolve(desktopRoot, "package.json");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const version = packageJson.version;
const releaseTag = process.env.RELEASE_TAG ?? `v${version}`;
const artifactsRoot = resolve(desktopRoot, "release-artifacts", releaseTag);

const releaseSources = [
  { name: "server", dir: resolve(desktopRoot, "release-server") },
  { name: "client", dir: resolve(desktopRoot, "release-client") }
];

await rm(artifactsRoot, { recursive: true, force: true });
await mkdir(artifactsRoot, { recursive: true });

const copiedFiles = [];

for (const source of releaseSources) {
  const entries = await readdir(source.dir, { withFileTypes: true });
  const assets = entries.filter((entry) => {
    if (!entry.isFile()) {
      return false;
    }

    const name = entry.name.toLowerCase();
    return name.endsWith(".exe") || name.endsWith(".yml") || name.endsWith(".blockmap");
  });

  if (assets.length === 0) {
    throw new Error(`No release assets found in ${source.dir}`);
  }

  for (const asset of assets) {
    const sourcePath = join(source.dir, asset.name);
    const targetPath = join(artifactsRoot, asset.name);
    await cp(sourcePath, targetPath);

    const content = await readFile(targetPath);
    copiedFiles.push({
      channel: source.name,
      file: asset.name,
      size: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex")
    });
  }
}

const checksums = copiedFiles
  .map((file) => `${file.sha256}  ${file.file}`)
  .join("\n");

await writeFile(join(artifactsRoot, "SHA256SUMS.txt"), `${checksums}\n`, "utf8");
await writeFile(
  join(artifactsRoot, "manifest.json"),
  `${JSON.stringify({ releaseTag, version, files: copiedFiles }, null, 2)}\n`,
  "utf8"
);

console.log(`Prepared release artifacts in ${artifactsRoot}`);
