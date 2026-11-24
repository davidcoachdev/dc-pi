import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import { isRootPath, classifyShellCommand, classifyNativeToolScan, GUARDED_TOOLS } from "../src/features/dc-scan-guard/dc-scan-guard.ts";
import { handleToolCall, guardOutputSpill, DcAntiLoopGuard, canonicalizeArguments } from "../src/features/dc-scan-guard/index.ts";
import { checkNodeVersion } from "../src/features/dc-doctor/dc-doctor-env.ts";
import { createCheckpoint, generateCheckpointId, untrackedFromStatus } from "../src/features/dc-checkpoint/dc-checkpoint.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

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
    input: { path: os.homedir(), pattern: "cmd/gentle-ai" },
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
  const dangerousFindP = classifyShellCommand("find -P / -name '*.env'");
  assert.equal(dangerousFindP.block, true);

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

  const rmSlashStarStar = classifyShellCommand("rm -fr /**");
  assert.equal(rmSlashStarStar.block, true);

  // Classify strings only: no shell command is executed. Keep HOME whitespace-free
  // because the current classifier splits shell tokens on whitespace.
  const originalHome = process.env.HOME;
  let rmConcreteHome: ReturnType<typeof classifyShellCommand>;
  try {
    process.env.HOME = "/dc-scan-guard-fixture-home";
    rmConcreteHome = classifyShellCommand(`rm -rf ${os.homedir()}`);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
  assert.equal(process.env.HOME, originalHome);
  assert.equal(rmConcreteHome.block, true);
  assert.match(rmConcreteHome.reason!, /destructivo/);

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

test("createCheckpoint preserves untracked files and single-quotes paths in restore.sh", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-checkpoint-test-"));
  try {
    spawnSync("git", ["init"], { cwd: tmpDir, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "test@dc-studio.local"], { cwd: tmpDir, encoding: "utf8" });
    spawnSync("git", ["config", "user.name", "DC Test"], { cwd: tmpDir, encoding: "utf8" });

    const trackedFile = path.join(tmpDir, "tracked.txt");
    fs.writeFileSync(trackedFile, "base content\n", "utf8");
    spawnSync("git", ["add", "tracked.txt"], { cwd: tmpDir, encoding: "utf8" });
    spawnSync("git", ["commit", "-m", "initial"], { cwd: tmpDir, encoding: "utf8" });

    // Modify tracked file and create an untracked file
    fs.writeFileSync(trackedFile, "modified content\n", "utf8");
    const untrackedRel = "notes/new-untracked.txt";
    const untrackedAbs = path.join(tmpDir, untrackedRel);
    fs.mkdirSync(path.dirname(untrackedAbs), { recursive: true });
    fs.writeFileSync(untrackedAbs, "untracked payload\n", "utf8");

    const res = createCheckpoint("safe-snap", tmpDir, new Date("2026-11-17T10:00:00Z"));
    assert.equal(res.ok, true);
    assert.equal(res.dirty, true);
    assert.ok(res.untracked.length > 0);
    assert.match(res.head, /^[0-9a-f]{7,64}$/i);

    // Verify untracked file was archived inside checkpoint/untracked/
    const archivedUntracked = path.join(res.dir, "untracked", untrackedRel);
    assert.equal(fs.existsSync(archivedUntracked), true, "Untracked file must be preserved inside checkpoint/untracked/");
    assert.equal(fs.readFileSync(archivedUntracked, "utf8"), "untracked payload\n");

    // Verify restore.sh uses single quotes and restores both tracked and untracked files
    const restoreSh = fs.readFileSync(path.join(res.dir, "restore.sh"), "utf8");
    assert.ok(restoreSh.includes(`git reset --hard '${res.head}'`), "restore.sh should single-quote head hash");
    assert.ok(restoreSh.includes(`'${path.join(res.dir, "diff.patch")}'`), "restore.sh should single-quote diff.patch path");

    // Corrupt working tree & delete untracked file, then run restore.sh
    fs.writeFileSync(trackedFile, "corrupted\n", "utf8");
    fs.unlinkSync(untrackedAbs);
    const restoreRun = spawnSync("bash", [path.join(res.dir, "restore.sh")], { cwd: tmpDir, encoding: "utf8" });
    assert.equal(restoreRun.status, 0, `restore.sh failed: ${restoreRun.stderr}`);
    assert.equal(fs.readFileSync(trackedFile, "utf8"), "modified content\n");
    assert.equal(fs.existsSync(untrackedAbs), true, "restore.sh should restore archived untracked files");
    assert.equal(fs.readFileSync(untrackedAbs, "utf8"), "untracked payload\n");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-scan-guard: normaliza segmentos de punto (/., /./, ///, ~/.) e inspecciona subshells inline y dc_ptc_run", () => {
  assert.equal(GUARDED_TOOLS.has("dc_ptc_run"), true);

  assert.equal(isRootPath("/."), true);
  assert.equal(isRootPath("/./"), true);
  assert.equal(isRootPath("/.."), true);
  assert.equal(isRootPath("///"), true);
  assert.equal(isRootPath("~/."), true);
  assert.equal(isRootPath("~/./"), true);
  assert.equal(isRootPath("$HOME/."), true);
  assert.equal(isRootPath("."), false);
  assert.equal(isRootPath("./src"), false);

  assert.equal(classifyShellCommand("rm -rf /.").block, true);
  assert.equal(classifyShellCommand("rm -rf /./").block, true);
  assert.equal(classifyShellCommand("rm -rf /..").block, true);
  assert.equal(classifyShellCommand("rm -rf ///").block, true);
  assert.equal(classifyShellCommand("rm -rf ~/.").block, true);

  // Subshells inline
  assert.equal(classifyShellCommand('sh -c "rm -rf /"').block, true);
  assert.equal(classifyShellCommand("bash -c 'rm -rf /./'").block, true);
  assert.equal(classifyShellCommand('python3 -c "import os; os.system(\'rm -rf /\')"').block, true);
  assert.equal(classifyShellCommand('python3 -c "import shutil; shutil.rmtree(\'/\')"').block, true);
  assert.equal(classifyShellCommand('node -e "require(\'child_process\').execSync(\'rm -rf /\')"').block, true);
  assert.equal(classifyShellCommand('node -e "require(\'fs\').rmSync(\'/\', { recursive: true })"').block, true);
  assert.equal(classifyShellCommand('node -e "console.log(42)"').block, false);

  // Inspección de dc_ptc_run
  assert.equal(classifyNativeToolScan("dc_ptc_run", { code: "pi.bash('rm -rf /./')" }).block, true);
  assert.equal(classifyNativeToolScan("dc_ptc_run", { code: "pi.fs.read('../../etc/passwd')" }).block, true);
  assert.equal(classifyNativeToolScan("dc_ptc_run", { code: "pi.fs.read('/etc/passwd')" }).block, true);
  assert.equal(classifyNativeToolScan("dc_ptc_run", { code: "return pi.fs.read('package.json')" }).block, false);
  assert.equal(handleToolCall({ toolName: "dc_ptc_run", input: { code: "pi.bash('rm -rf /')" } })?.block, true);
});

test("dc-scan-guard handleToolCall: bloquea dc_ptc_run malicioso y edit/write sobre credenciales sensibles, permitiendo uso normal en workspace", () => {
  // dc_ptc_run malicioso (raíz, credenciales, escape de sandbox)
  assert.equal(handleToolCall({ toolName: "dc_ptc_run", input: { code: "return pi.fs.read('~/.ssh/id_rsa')" } })?.block, true);
  assert.equal(handleToolCall({ toolName: "dc_ptc_run", input: { code: "return pi.fs.list('/')" } })?.block, true);
  assert.equal(handleToolCall({ toolName: "dc_ptc_run", input: { code: "return fs.readFileSync('/etc/passwd', 'utf8')" } })?.block, true);
  assert.equal(handleToolCall({ toolName: "dc_ptc_run", input: { code: "return process.env" } })?.block, true);
  assert.equal(handleToolCall({ toolName: "dc_ptc_run", input: { code: "return execSync('id')" } })?.block, true);
  assert.equal(handleToolCall({ toolName: "dc_ptc_run", input: { code: "return require('node:fs')" } })?.block, true);
  assert.equal(handleToolCall({ toolName: "dc_ptc_run", input: { code: "return await import('node:fs')" } })?.block, true);

  // dc_ptc_run normal permitido
  assert.equal(handleToolCall({ toolName: "dc_ptc_run", input: { code: "const pkg = JSON.parse(pi.fs.read('package.json')); return pkg.name;" } }), undefined);

  // edit / write sobre credenciales sensibles bloqueados
  const editSsh = handleToolCall({
    toolName: "edit",
    input: { path: "~/.ssh/id_rsa", oldText: "a", newText: "b" },
  });
  assert.equal(editSsh?.block, true);
  assert.match(editSsh!.reason, /credential-protection/);

  const writeSsh = handleToolCall({
    toolName: "write",
    input: { path: "~/.ssh/id_rsa", content: "injected" },
  });
  assert.equal(writeSsh?.block, true);
  assert.match(writeSsh!.reason, /credential-protection/);

  const editAws = handleToolCall({
    toolName: "edit",
    input: { path: "~/.aws/credentials", oldText: "a", newText: "b" },
  });
  assert.equal(editAws?.block, true);
  assert.match(editAws!.reason, /credential-protection/);

  const writeAws = handleToolCall({
    toolName: "write",
    input: { file: "~/.aws/credentials", content: "injected" },
  });
  assert.equal(writeAws?.block, true);
  assert.match(writeAws!.reason, /credential-protection/);

  // Uso normal en workspace permitido
  assert.equal(
    handleToolCall({ toolName: "edit", input: { path: "src/index.ts", oldText: "a", newText: "b" } }),
    undefined,
  );
  assert.equal(
    handleToolCall({ toolName: "write", input: { path: "src/normal-file.ts", content: "export const ok = true;\n" } }),
    undefined,
  );
  assert.equal(
    handleToolCall({ toolName: "read", input: { path: "package.json" } }),
    undefined,
  );
});

test("dc-anti-loop-guard: normaliza whitespace trivial y detecta bucles alternantes A->B->A->B sin romper ediciones legítimas", () => {
  assert.equal(
    canonicalizeArguments({ command: "  git   status \n" }),
    canonicalizeArguments({ command: "git status" }),
  );

  const guard = new DcAntiLoopGuard({ warnThreshold: 3, blockThreshold: 5 });
  assert.equal(guard.evaluate("bash", { command: "git status" }).allow, true);
  assert.equal(guard.evaluate("bash", { command: "git diff" }).allow, true);
  assert.equal(guard.evaluate("bash", { command: "  git   status " }).allow, true);
  const step4 = guard.evaluate("bash", { command: "git   diff\n" });
  assert.ok(step4.warning, "El cuarto paso del ciclo A->B->A->B debe emitir advertencia o bloqueo");
  const step5 = guard.evaluate("bash", { command: "git status" });
  assert.equal(step5.allow, false);
  assert.equal(step5.blocked, true);

  // Ediciones multi-paso legítimas con pruebas intercaladas no deben bloquearse
  guard.reset();
  for (let i = 1; i <= 6; i++) {
    const editRes = guard.evaluate("edit", { path: `src/file-${i}.ts`, oldText: "a", newText: "b" });
    assert.equal(editRes.allow, true);
    const testRes = guard.evaluate("bash", { command: "npm test" });
    assert.equal(testRes.allow, true);
  }
});

test("dc-spill-guard: acota headChars y tailChars cuando headChars + tailChars >= originalLength evitando negativos y duplicación", () => {
  const text = "0123456789"; // len 10
  const res = guardOutputSpill(text, { maxChars: 8, headChars: 6, tailChars: 6 });
  assert.equal(res.truncated, true);
  assert.ok(!res.text.includes("se omitieron -"), "omittedCount nunca debe ser negativo");
  assert.ok(!res.text.includes("012345") || !res.text.includes("456789"), "No debe duplicar caracteres solapados");

  // Con defaults (head=35000, tail=15000) pero maxChars pequeño (500) sobre cadena de 1000 chars
  const medium = "H".repeat(500) + "T".repeat(500);
  const resDefault = guardOutputSpill(medium, { maxChars: 500 });
  assert.equal(resDefault.truncated, true);
  assert.ok(!resDefault.text.includes("se omitieron -"), "omittedCount nunca debe ser negativo con defaults");
});

