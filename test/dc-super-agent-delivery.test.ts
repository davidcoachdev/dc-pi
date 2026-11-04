import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  dcWorkerRunner,
  updateWorktreeOddRoadmap,
} from "../src/features/dc-agents/daemon/dc-worker-runner.ts";
import { DcPrDelivery } from "../src/features/dc-agents/daemon/dc-pr-delivery.ts";

test("dc-worker-runner: runInWorktree ejecuta comandos y captura salida con código 0", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-worktree-test-"));

  try {
    const res = await dcWorkerRunner.runInWorktree(tmpDir, "node", ["-e", "console.log('hola superagente')"]);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "hola superagente");

    // Comando fallido captura stderr y exitCode != 0
    const failRes = await dcWorkerRunner.runInWorktree(tmpDir, "node", ["-e", "process.exit(2)"]);
    assert.equal(failRes.exitCode, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-worker-runner: updateWorktreeOddRoadmap actualiza estados y notas en spec markdown", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-odd-test-"));
  const tasksDir = path.join(tmpDir, "odd", "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });

  const taskSlug = "issue-42";
  const specFile = path.join(tasksDir, `${taskSlug}.md`);

  fs.writeFileSync(
    specFile,
    `# Issue #42: Feature de prueba\n\n## Tasks\nT1: Tarea Uno [pending]\nT2: Tarea Dos [pending]\nT3: Tarea Tres [pending]\n`,
    "utf8",
  );

  // 1. T1 -> done
  updateWorktreeOddRoadmap(tmpDir, taskSlug, "T1", "done", "Completada OK");
  let content = fs.readFileSync(specFile, "utf8");
  assert.ok(content.includes("✔ T1: Tarea Uno [done] (Completada OK)"));
  assert.ok(content.includes("T2: Tarea Dos [pending]"));

  // 2. T2 -> in_progress
  updateWorktreeOddRoadmap(tmpDir, taskSlug, "T2", "in_progress", "Escribiendo tests");
  content = fs.readFileSync(specFile, "utf8");
  assert.ok(content.includes("▶ T2: Tarea Dos [in_progress] (Escribiendo tests)"));

  // 3. T3 -> failed
  updateWorktreeOddRoadmap(tmpDir, taskSlug, "T3", "failed", "Fallo de compilación");
  content = fs.readFileSync(specFile, "utf8");
  assert.ok(content.includes("✖ T3: Tarea Tres [failed] (Fallo de compilación)"));

  // 4. Múltiples transiciones sobre la misma tarea (ej: T2 in_progress -> T2 done)
  updateWorktreeOddRoadmap(tmpDir, taskSlug, "T2", "done", "Tests pasados");
  content = fs.readFileSync(specFile, "utf8");
  assert.ok(content.includes("✔ T2: Tarea Dos [done] (Tests pasados)"));
  assert.ok(!content.includes("▶ T2"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("dc-worker-runner: initializeOddSpec preserva requerimiento verbatim y autor", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-spec-test-"));
  const taskSlug = "issue-77";

  dcWorkerRunner.initializeOddSpec({
    issueNumber: 77,
    issueTitle: "Ventana de admin",
    issueUrl: "https://github.com/test/repo/issues/77",
    taskSlug,
    worktreePath: tmpDir,
    branchName: "feat/issue-77",
    dispatchedAt: Date.now(),
    handle: {} as any,
  }, "@davidcoachdev", "Requerimiento original sin alterar");

  const specFile = path.join(tmpDir, "odd", "tasks", `${taskSlug}.md`);
  assert.ok(fs.existsSync(specFile));
  const content = fs.readFileSync(specFile, "utf8");
  assert.ok(content.includes("Creado por: @davidcoachdev"));
  assert.ok(content.includes("Requerimiento original sin alterar"));
  assert.ok(content.includes("✔ T1: Inicializar entorno y worktree aislado [done]"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("dc-pr-delivery: deliverIssue estructura y ejecuta el ciclo de entrega a GitHub", async () => {
  const delivery = new DcPrDelivery();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-delivery-test-"));

  try {
    // Si no es un repo git con remote origin, falla limpiamente sin lanzar excepciones no controladas
    const res = await delivery.deliverIssue({
      worktreePath: tmpDir,
      taskSlug: "issue-123",
      issueNumber: 123,
      issueTitle: "Test automatizado de PR",
      branchName: "feat/issue-123",
    });

    // En un directorio temporal plano sin git, git add o commit debe retornar error controlado
    assert.equal(res.ok, false);
    assert.ok(res.error);
    assert.ok(res.error?.includes("git"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
