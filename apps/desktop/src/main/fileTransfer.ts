import { writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export function sanitizeFileName(name: string): string {
  const fallbackName = "remote-control-file.bin";
  const normalizedName = name.normalize("NFKC").replace(/\\/g, "/");
  const hasTraversalSegment = normalizedName
    .split("/")
    .some((segment) => segment === "." || segment === "..");

  if (hasTraversalSegment) {
    return fallbackName;
  }

  const cleaned = basename(normalizedName)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.includes("..") || isReservedWindowsFileName(cleaned)) {
    return fallbackName;
  }

  return cleaned.slice(0, 180);
}

export function isReservedWindowsFileName(name: string): boolean {
  const stem = name.split(".")[0]?.toLowerCase();
  if (!stem) {
    return true;
  }

  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(stem);
}

export async function createUniqueFilePath(directory: string, fileName: string): Promise<string> {
  const extension = extname(fileName);
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;

  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0
      ? join(directory, fileName)
      : join(directory, `${baseName} (${index})${extension}`);

    try {
      await writeFile(candidate, new Uint8Array(), { flag: "wx" });
      return candidate;
    } catch {
      // try next suffix
    }
  }

  throw new Error(`Could not allocate file path for ${fileName}`);
}
