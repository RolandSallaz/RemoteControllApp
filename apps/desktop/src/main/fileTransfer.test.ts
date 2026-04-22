import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { createUniqueFilePath, isReservedWindowsFileName, sanitizeFileName } from "./fileTransfer.js";

test("sanitizeFileName strips traversal, invalid characters and reserved names", () => {
  assert.equal(sanitizeFileName("../secret.txt"), "remote-control-file.bin");
  assert.equal(sanitizeFileName(" report<>:\"/\\\\|?*.txt "), "___.txt");
  assert.equal(sanitizeFileName("con.txt"), "remote-control-file.bin");
  assert.equal(sanitizeFileName("normal-file.txt"), "normal-file.txt");
});

test("isReservedWindowsFileName recognizes reserved stems", () => {
  assert.equal(isReservedWindowsFileName("AUX"), true);
  assert.equal(isReservedWindowsFileName("LPT1.txt"), true);
  assert.equal(isReservedWindowsFileName("notes.txt"), false);
});

test("createUniqueFilePath allocates unique suffixes without overwriting files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "remote-control-transfer-"));

  try {
    const first = await createUniqueFilePath(directory, "report.txt");
    const second = await createUniqueFilePath(directory, "report.txt");

    assert.match(first, /report\.txt$/);
    assert.match(second, /report \(1\)\.txt$/);
    assert.notEqual(first, second);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
