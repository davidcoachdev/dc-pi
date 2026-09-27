import { test } from "node:test";
import assert from "node:assert/strict";
import { isRootPath, classifyShellCommand } from "../src/features/dc-scan-guard/dc-scan-guard.ts";
import { checkNodeVersion } from "../src/features/dc-doctor/dc-doctor-env.ts";
import { generateCheckpointId, untrackedFromStatus } from "../src/features/dc-checkpoint/dc-checkpoint.ts";

test("isRootPath correctly detects dangerous filesystem roots", () => {
  assert.equal(isRootPath("/"), true);
  assert.equal(isRootPath("~"), true);
  assert.equal(isRootPath("/c"), true);
  assert.equal(isRootPath("C:"), true);
  assert.equal(isRootPath("C:\\"), true);
  assert.equal(isRootPath("$HOME"), true);
  assert.equal(isRootPath("%USERPROFILE%"), true);

  // Scoped paths are safe
  assert.equal(isRootPath("./src"), false);
  assert.equal(isRootPath("src/components"), false);
  assert.equal(isRootPath("/home/dc-studio/project"), false);
  assert.equal(isRootPath("C:\\Users\\Project"), false);
});

test("classifyShellCommand blocks root-rooted scans and allows scoped scans", () => {
  const dangerous1 = classifyShellCommand("find / -maxdepth 12 -type d -iname '*test*'");
  assert.equal(dangerous1.block, true);
  assert.match(dangerous1.reason!, /dc-scan-guard/);

  const dangerous2 = classifyShellCommand("grep -r 'api_key' ~/");
  assert.equal(dangerous2.block, true);

  const dangerous3 = classifyShellCommand("cd src && rg 'function' /");
  assert.equal(dangerous3.block, true);

  const safe1 = classifyShellCommand("find src -name '*.ts'");
  assert.equal(safe1.block, false);

  const safe2 = classifyShellCommand("grep -rn 'TODO' ./src");
  assert.equal(safe2.block, false);

  const safe3 = classifyShellCommand("git status");
  assert.equal(safe3.block, false);
});

test("checkNodeVersion detects supported node version", () => {
  const result = checkNodeVersion("v22.19.0", "20.6.0");
  assert.equal(result.ok, true);

  const failResult = checkNodeVersion("v18.0.0", "20.6.0");
  assert.equal(failResult.ok, false);
});

test("checkpoint helpers format correctly", () => {
  const id = generateCheckpointId(new Date("2026-09-26T14:30:00Z"));
  assert.ok(id.startsWith("20260926-"));

  const status = " M src/index.ts\n?? new-file.txt\n?? another.md";
  const untracked = untrackedFromStatus(status);
  assert.deepEqual(untracked, ["new-file.txt", "another.md"]);
});
