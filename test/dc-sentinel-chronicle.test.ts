import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { listChronicleFiles } from "../src/features/dc-sentinel/core/dc-sentinel-recorder.ts";

const LIMIT = 256 * 1024;
function fixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dc-chronicle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "docs", "chronicle");
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir };
}

test("chronicle preserves complete text, metadata and descending names up to the limit", t => {
  const { root, dir } = fixture(t);
  fs.writeFileSync(path.join(dir, "a.md"), "# Bitácora\n");
  fs.writeFileSync(path.join(dir, "z.md"), "x".repeat(LIMIT));
  fs.writeFileSync(path.join(dir, "ignored.txt"), "ignored");
  const files = listChronicleFiles(root);
  assert.deepEqual(files.map(f => f.name), ["z.md", "a.md"]);
  assert.equal(files[0].content.length, LIMIT);
  assert.equal(files[1].content, "# Bitácora\n");
  assert.equal(files[1].sizeBytes, Buffer.byteLength("# Bitácora\n"));
  assert.equal(files[1].fullPath, path.join(dir, "a.md"));
  assert.match(files[1].updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.deepEqual(listChronicleFiles(path.join(root, "missing")), []);
});

test("chronicle lists oversized files without loading content or changing bytes", t => {
  const { root, dir } = fixture(t);
  const file = path.join(dir, "large.md");
  const bytes = Buffer.alloc(LIMIT + 1, 120);
  fs.writeFileSync(file, bytes);
  const before = fs.statSync(file);
  const [item] = listChronicleFiles(root);
  assert.equal(item.name, "large.md");
  assert.equal(item.sizeBytes, LIMIT + 1);
  assert.equal(item.content, "");
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(fs.statSync(file).mtimeMs, before.mtimeMs);
});

test("chronicle rejects symlinks, non-files and invalid text without hiding valid entries", t => {
  const { root, dir } = fixture(t);
  fs.writeFileSync(path.join(dir, "valid.md"), "valid");
  fs.writeFileSync(path.join(root, "outside.md"), "outside");
  fs.symlinkSync(path.join(root, "outside.md"), path.join(dir, "link.md"));
  fs.symlinkSync(path.join(root, "missing"), path.join(dir, "broken.md"));
  fs.mkdirSync(path.join(dir, "directory.md"));
  fs.writeFileSync(path.join(dir, "nul.md"), Buffer.from([65, 0, 66]));
  fs.writeFileSync(path.join(dir, "invalid.md"), Buffer.from([0xff]));
  assert.deepEqual(listChronicleFiles(root).map(f => f.name), ["valid.md"]);
  assert.equal(fs.readFileSync(path.join(root, "outside.md"), "utf8"), "outside");
});

test("chronicle refuses symlinked ancestor directories but accepts a project root alias", t => {
  const { root, dir } = fixture(t);
  fs.writeFileSync(path.join(dir, "valid.md"), "valid");
  const alias = path.join(root, "alias");
  fs.symlinkSync(root, alias, "dir");
  assert.equal(listChronicleFiles(alias)[0]?.content, "valid");
  fs.renameSync(path.join(root, "docs"), path.join(root, "real-docs"));
  fs.symlinkSync(path.join(root, "real-docs"), path.join(root, "docs"), "dir");
  assert.deepEqual(listChronicleFiles(root), []);
});
