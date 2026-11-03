import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import { isRootPath, classifyShellCommand, classifyNativeToolScan } from "../src/features/dc-scan-guard/dc-scan-guard.ts";
import { handleToolCall, guardOutputSpill, DcAntiLoopGuard } from "../src/features/dc-scan-guard/index.ts";
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

  // User home directory itself is a dangerous root
  assert.equal(isRootPath(os.homedir()), true);

  // Scoped paths are safe
  assert.equal(isRootPath("./src"), false);
  assert.equal(isRootPath("src/components"), false);
  assert.equal(isRootPath("/home/dc-studio/project"), false);
  assert.equal(isRootPath("C:\\Users\\Project"), false);
});

test("classifyNativeToolScan and handleToolCall block root scans on grep and find", () => {
  // 1. classifyNativeToolScan directo
  const blockedGrep = classifyNativeToolScan("grep", { path: os.homedir(), pattern: "test" });
  assert.equal(blockedGrep.block, true);
  assert.match(blockedGrep.reason!, /dc-scan-guard/);

  const blockedFind = classifyNativeToolScan("find", { path: "~", pattern: "*" });
  assert.equal(blockedFind.block, true);

  const safeGrep = classifyNativeToolScan("grep", { path: "src/", pattern: "test" });
  assert.equal(safeGrep.block, false);

  // 2. handleToolCall hook en pi
  const eventGrepBlocked = handleToolCall({
    toolName: "grep",
    input: { path: "/home/dc-studio", pattern: "cmd/gentle-ai" },
  });
  assert.ok(eventGrepBlocked?.block);
  assert.match(eventGrepBlocked.reason, /dc-scan-guard/);

  const eventFindBlocked = handleToolCall({
    toolName: "find",
    input: { path: "/", pattern: "*.ts" },
  });
  assert.ok(eventFindBlocked?.block);

  const eventGrepAllowed = handleToolCall({
    toolName: "grep",
    input: { path: "src/features", pattern: "dc-agents" },
  });
  assert.equal(eventGrepAllowed, undefined);
});

test("classifyShellCommand blocks root-rooted scans and allows scoped scans", () => {
  const dangerous1 = classifyShellCommand("find / -maxdepth 12 -type d -iname '*test*'");
  assert.equal(dangerous1.block, true);
  assert.match(dangerous1.reason!, /dc-scan-guard/);

  // find con flags de symlinks (-H, -L, -P)
  const dangerousFindH = classifyShellCommand("find -H / -type f");
  assert.equal(dangerousFindH.block, true);
  const dangerousFindL = classifyShellCommand("find -L ~/ -name '*.key'");
  assert.equal(dangerousFindL.block, true);

  const dangerous2 = classifyShellCommand("grep -r 'api_key' ~/");
  assert.equal(dangerous2.block, true);

  // grep con variantes de flag larga
  const dangerousGrepDir = classifyShellCommand("grep --directories=recurse 'token' /");
  assert.equal(dangerousGrepDir.block, true);
  const dangerousGrepDirSpace = classifyShellCommand("grep --directories recurse 'secret' ~/");
  assert.equal(dangerousGrepDirSpace.block, true);
  const dangerousGrepRec = classifyShellCommand("grep --recursive 'secret' /");
  assert.equal(dangerousGrepRec.block, true);

  const dangerous3 = classifyShellCommand("cd src && rg 'function' /");
  assert.equal(dangerous3.block, true);

  const safe1 = classifyShellCommand("find src -name '*.ts'");
  assert.equal(safe1.block, false);

  const safe2 = classifyShellCommand("grep -rn 'TODO' ./src");
  assert.equal(safe2.block, false);

  const safe3 = classifyShellCommand("git status");
  assert.equal(safe3.block, false);
});

test("classifyShellCommand blocks destructive rm -rf on roots and global wildcards (dual-encoding)", () => {
  const rmRoot = classifyShellCommand("rm -rf /");
  assert.equal(rmRoot.block, true);
  assert.match(rmRoot.reason!, /destructivo/);

  const rmLongRec = classifyShellCommand("rm --recursive /");
  assert.equal(rmLongRec.block, true);
  assert.match(rmLongRec.reason!, /destructivo/);

  const rmHome = classifyShellCommand("rm -rf ~");
  assert.equal(rmHome.block, true);

  const rmDollarHome = classifyShellCommand("rm -rf $HOME");
  assert.equal(rmDollarHome.block, true);

  const rmSlashStar = classifyShellCommand("rm -fr /*");
  assert.equal(rmSlashStar.block, true);

  const rmWildcardRoot = classifyShellCommand("rm -rf /home/dc-studio");
  assert.equal(rmWildcardRoot.block, true);

  // Safe scoped removals
  const safeRmBuild = classifyShellCommand("rm -rf .test-build");
  assert.equal(safeRmBuild.block, false);

  const safeRmFile = classifyShellCommand("rm -f temp.txt");
  assert.equal(safeRmFile.block, false);

  const safeRmDir = classifyShellCommand("rm -rf ./tmp/cache");
  assert.equal(safeRmDir.block, false);
});

test("classifyShellCommand and classifyNativeToolScan block sensitive credential theft", () => {
  // Shell command credential theft attempts
  const sshCat = classifyShellCommand("cat ~/.ssh/id_rsa");
  assert.equal(sshCat.block, true);
  assert.match(sshCat.reason!, /credential-protection/);

  const awsGrep = classifyShellCommand("grep -i key ~/.aws/credentials");
  assert.equal(awsGrep.block, true);

  const ghToken = classifyShellCommand("cat ~/.config/gh/hosts.yml");
  assert.equal(ghToken.block, true);

  // Native tool read/grep credential protection
  const nativeReadSsh = handleToolCall({
    toolName: "read",
    input: { path: "/home/dc-studio/.ssh/id_ed25519" },
  });
  assert.equal(nativeReadSsh?.block, true);
  assert.match(nativeReadSsh!.reason, /credential-protection/);

  const nativeGrepAws = handleToolCall({
    toolName: "grep",
    input: { path: "~/.aws" },
  });
  assert.equal(nativeGrepAws?.block, true);

  // Safe non-credential reads
  const safeNativeRead = handleToolCall({
    toolName: "read",
    input: { path: "src/index.ts" },
  });
  assert.equal(safeNativeRead, undefined);
});

test("guardOutputSpill: trunca contenidos masivos preservando head, tail y marcador de contexto", () => {
  const shortText = "Texto breve y normal de salida.";
  const shortResult = guardOutputSpill(shortText);
  assert.equal(shortResult.truncated, false);
  assert.equal(shortResult.text, shortText);

  // Cadena gigante simulada
  const bigText = "HEAD_INICIO_" + "A".repeat(80000) + "_TAIL_FIN";
  const bigResult = guardOutputSpill(bigText, {
    maxChars: 1000,
    headChars: 300,
    tailChars: 200,
  });

  assert.equal(bigResult.truncated, true);
  assert.ok(bigResult.text.startsWith("HEAD_INICIO_"));
  assert.ok(bigResult.text.endsWith("_TAIL_FIN"));
  assert.ok(bigResult.text.includes("dc-spill-guard: se omitieron"));
  assert.equal(bigResult.originalLength, bigText.length);
});

test("DcAntiLoopGuard: detecta llamadas idénticas y bloquea bucles tras umbral", () => {
  const guard = new DcAntiLoopGuard({ warnThreshold: 3, blockThreshold: 5 });

  const call1 = guard.evaluate("bash", { command: "git status" });
  assert.equal(call1.allow, true);
  assert.equal(call1.repeatCount, 1);

  const call2 = guard.evaluate("bash", { command: "git status" });
  assert.equal(call2.allow, true);
  assert.equal(call2.repeatCount, 2);

  // Umbral 3: genera advertencia pero aún permite
  const call3 = guard.evaluate("bash", { command: "git status" });
  assert.equal(call3.allow, true);
  assert.equal(call3.repeatCount, 3);
  assert.ok(call3.warning && call3.warning.includes("Llamada repetida"));

  const call4 = guard.evaluate("bash", { command: "git status" });
  assert.equal(call4.allow, true);
  assert.equal(call4.repeatCount, 4);

  // Umbral 5: Bloqueo duro contra el bucle
  const call5 = guard.evaluate("bash", { command: "git status" });
  assert.equal(call5.allow, false);
  assert.equal(call5.blocked, true);
  assert.ok(call5.warning && call5.warning.includes("Se bloqueó la ejecución"));

  // Cambio de herramienta o argumento reinicia la racha
  const callOther = guard.evaluate("bash", { command: "npm test" });
  assert.equal(callOther.allow, true);
  assert.equal(callOther.repeatCount, 1);
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
