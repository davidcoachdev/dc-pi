import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  DcWorktreeManager,
  sanitizeBranchSlug,
} from "../src/features/dc-agents/core/dc-worktree-manager.ts";

test("sanitizeBranchSlug strips illegal git branch characters and normalizes", () => {
  assert.equal(sanitizeBranchSlug("fix: header overflow (mobile)"), "fix-header-overflow-mobile");
  assert.equal(sanitizeBranchSlug("  Feat/New_Feature!  "), "feat-new_feature");
  assert.equal(sanitizeBranchSlug("---test---"), "test");
  assert.equal(sanitizeBranchSlug(""), "task");
  assert.equal(sanitizeBranchSlug("###$$$@@@"), "task");
});

test("DcWorktreeManager creates, symlinks and cleanly disposes a real Git worktree", async () => {
  // 1. Preparar un repositorio Git de prueba en un directorio temporal aislado
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-worktree-test-"));
  const repoRoot = path.join(tempDir, "main-repo");
  fs.mkdirSync(repoRoot, { recursive: true });

  execFileSync("git", ["init", "-b", "master", repoRoot], { stdio: "ignore" });
  execFileSync("git", ["-C", repoRoot, "config", "user.name", "Tester"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoRoot, "config", "user.email", "tester@test.local"], { stdio: "ignore" });

  // Crear archivo inicial y commit para que HEAD sea válido
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# Test Repo\n", "utf8");
  execFileSync("git", ["-C", repoRoot, "add", "README.md"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoRoot, "commit", "-m", "initial commit"], { stdio: "ignore" });

  // Crear node_modules dummy en el repo padre
  const parentNodeModules = path.join(repoRoot, "node_modules");
  fs.mkdirSync(parentNodeModules, { recursive: true });
  fs.writeFileSync(path.join(parentNodeModules, "package.json"), "{}", "utf8");

  // 2. Instanciar manager y crear worktree
  const manager = new DcWorktreeManager();
  const customWorktreeDir = path.join(tempDir, "worker-task-1");

  const handle = await manager.createForTask({
    repoRoot,
    taskId: "task-uuid-12345678",
    taskSlug: "fix-auth-token",
    baseBranch: "master",
    customWorktreeDir,
    useSymlinkNodeModules: true,
  });

  try {
    assert.equal(handle.taskId, "task-uuid-12345678");
    assert.equal(handle.taskSlug, "fix-auth-token");
    assert.equal(handle.branchName, "feat/fix-auth-token-taskuuid");
    assert.equal(handle.worktreePath, customWorktreeDir);
    assert.equal(fs.existsSync(customWorktreeDir), true);

    // Verificar que el symlink de node_modules existe en el worktree
    const worktreeNodeModules = path.join(customWorktreeDir, "node_modules");
    assert.equal(fs.existsSync(worktreeNodeModules), true);
    assert.equal(fs.lstatSync(worktreeNodeModules).isSymbolicLink(), true);

    // Verificar que el worktree está en la rama correcta
    const currentBranch = execFileSync(
      "git",
      ["-C", customWorktreeDir, "branch", "--show-current"],
      { encoding: "utf8" }
    ).trim();
    assert.equal(currentBranch, "feat/fix-auth-token-taskuuid");

    // Verificar que un cambio en el worktree no afecta al repo padre
    fs.writeFileSync(path.join(customWorktreeDir, "NEW_FILE.txt"), "isolated content\n", "utf8");
    assert.equal(fs.existsSync(path.join(repoRoot, "NEW_FILE.txt")), false);
  } finally {
    // 3. Ejecutar limpieza
    await handle.dispose();
  }

  // 4. Validar que la carpeta del worktree fue removida y limpiada
  assert.equal(handle.isCleanedUp, true);
  assert.equal(fs.existsSync(customWorktreeDir), false);

  // Limpiar directorio temporal
  fs.rmSync(tempDir, { recursive: true, force: true });
});
