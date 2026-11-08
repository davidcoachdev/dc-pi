import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "dc-delivery-home-"));
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = path.join(home, "xdg");
process.env.PI_CODING_AGENT_DIR = path.join(home, "pi");
const { dcWorkerRunner, updateWorktreeOddRoadmap } = await import("../src/features/dc-agents/daemon/dc-worker-runner.ts");
const { DcPrDelivery } = await import("../src/features/dc-agents/daemon/dc-pr-delivery.ts");
const { getCollaboratorsDatabase } = await import("../src/features/dc-agents/daemon/dc-collaborators-db.ts");
test.after(() => {
  getCollaboratorsDatabase().close();
  fs.rmSync(home, { recursive: true, force: true });
});

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

  const originalRun = dcWorkerRunner.runInWorktree;
  const calls: string[] = [];
  dcWorkerRunner.runInWorktree = async (_cwd, command, args) => {
    calls.push(`${command} ${args.join(" ")}`);
    return { stdout: "", stderr: "isolated git failure", exitCode: 1 };
  };
  try {
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
    assert.deepEqual(calls, ["git add ."]);
  } finally {
    dcWorkerRunner.runInWorktree = originalRun;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-pr-delivery: sincronización preventiva con origin/baseBranch y generación de PR enriquecido", async () => {
  const delivery = new DcPrDelivery();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-delivery-test-"));

  const originalRun = dcWorkerRunner.runInWorktree;
  const calls: string[] = [];
  let capturedPrBody = "";

  dcWorkerRunner.runInWorktree = async (_cwd, command, args) => {
    const fullCmd = `${command} ${args.join(" ")}`;
    calls.push(fullCmd);

    if (command === "git" && args[0] === "add") return { stdout: "", stderr: "", exitCode: 0 };
    if (command === "git" && args[0] === "commit") return { stdout: "[feat 1234567] commit", stderr: "", exitCode: 0 };
    if (command === "git" && args[0] === "fetch") return { stdout: "", stderr: "", exitCode: 0 };
    if (command === "git" && args[0] === "merge") return { stdout: "Already up to date.", stderr: "", exitCode: 0 };
    if (command === "git" && args[0] === "diff") return { stdout: " src/index.ts | 10 ++++++++++\n 1 file changed, 10 insertions(+)", stderr: "", exitCode: 0 };
    if (command === "git" && args[0] === "rev-parse") return { stdout: "a1b2c3d4e5f6\n", stderr: "", exitCode: 0 };
    if (command === "git" && args[0] === "push") return { stdout: "branch pushed", stderr: "", exitCode: 0 };
    if (command === "gh" && args[0] === "pr" && args[1] === "create") {
      const bodyIndex = args.indexOf("--body");
      if (bodyIndex !== -1) capturedPrBody = args[bodyIndex + 1];
      return { stdout: "https://github.com/davidcoachdev/dc-pi/pull/99\n", stderr: "", exitCode: 0 };
    }
    if (command === "gh" && args[0] === "issue" && args[1] === "comment") {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    return { stdout: "", stderr: "", exitCode: 0 };
  };

  try {
    const res = await delivery.deliverIssue({
      worktreePath: tmpDir,
      taskSlug: "issue-99",
      issueNumber: 99,
      issueTitle: "Implementar nuevo endpoint",
      branchName: "feat/issue-99",
      baseBranch: "master",
      issueBody: "Por favor implementar endpoint /api/v1/metrics con tests.",
      verificationEvidence: "- `npm run typecheck`: exit 0\n- `npm run test`: exit 0",
    });

    assert.equal(res.ok, true);
    assert.equal(res.prUrl, "https://github.com/davidcoachdev/dc-pi/pull/99");
    assert.equal(res.prNumber, 99);
    assert.equal(res.commitHash, "a1b2c3d");

    // Verificar que el flujo incluye fetch y merge de origin/master antes del push
    assert.ok(calls.includes("git fetch origin master"));
    assert.ok(calls.includes("git merge origin/master --no-edit"));
    assert.ok(calls.includes("git push -u origin feat/issue-99"));

    // Verificar que el cuerpo del PR usa la plantilla enriquecida
    assert.ok(capturedPrBody.includes("# task/issue-99: Implementar nuevo endpoint"));
    assert.ok(capturedPrBody.includes("Closes #99"));
    assert.ok(capturedPrBody.includes("Contexto original del Issue"));
    assert.ok(capturedPrBody.includes("Por favor implementar endpoint /api/v1/metrics"));
    assert.ok(capturedPrBody.includes("src/index.ts | 10 ++++++++++"));
    assert.ok(capturedPrBody.includes("Evidencia de Verificación Determinista"));
    assert.ok(capturedPrBody.includes("npm run typecheck"));
    assert.ok(capturedPrBody.includes("Estrategia de merge"));
    assert.ok(capturedPrBody.includes("--no-ff"));
  } finally {
    dcWorkerRunner.runInWorktree = originalRun;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-pr-delivery: aborta y detiene la entrega de forma segura ante conflictos en merge", async () => {
  const delivery = new DcPrDelivery();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-delivery-conflict-test-"));

  const originalRun = dcWorkerRunner.runInWorktree;
  const calls: string[] = [];

  dcWorkerRunner.runInWorktree = async (_cwd, command, args) => {
    const fullCmd = `${command} ${args.join(" ")}`;
    calls.push(fullCmd);

    if (command === "git" && args[0] === "add") return { stdout: "", stderr: "", exitCode: 0 };
    if (command === "git" && args[0] === "commit") return { stdout: "[feat 1234567] commit", stderr: "", exitCode: 0 };
    if (command === "git" && args[0] === "fetch") return { stdout: "", stderr: "", exitCode: 0 };
    if (command === "git" && args[0] === "merge" && args[1] === "origin/master") {
      return { stdout: "Auto-merging file.ts\nCONFLICT (content): Merge conflict in file.ts", stderr: "", exitCode: 1 };
    }
    if (command === "git" && args[0] === "merge" && args[1] === "--abort") {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    return { stdout: "", stderr: "", exitCode: 0 };
  };

  try {
    const res = await delivery.deliverIssue({
      worktreePath: tmpDir,
      taskSlug: "issue-100",
      issueNumber: 100,
      issueTitle: "Tarea con conflicto de ramas",
      branchName: "feat/issue-100",
      baseBranch: "master",
    });

    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("Conflicto detectado con origin/master"));
    assert.ok(calls.includes("git merge origin/master --no-edit"));
    assert.ok(calls.includes("git merge --abort"));

    // Prohibido hacer push o abrir PR si hubo conflicto
    assert.equal(calls.some(c => c.startsWith("git push")), false);
    assert.equal(calls.some(c => c.startsWith("gh pr create")), false);
  } finally {
    dcWorkerRunner.runInWorktree = originalRun;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-pr-delivery: integración de upstream activa re-verificación y actualiza evidencia fresca", async () => {
  const delivery = new DcPrDelivery();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-delivery-reverify-test-"));

  const originalRun = dcWorkerRunner.runInWorktree;
  const originalVerify = dcWorkerRunner.verifyWorktree;
  let reverifyCalled = false;
  let capturedPrBody = "";
  let revParseCount = 0;

  dcWorkerRunner.verifyWorktree = async () => {
    reverifyCalled = true;
    return {
      ok: true,
      commands: [
        { command: "npm", args: ["run", "typecheck"], stdout: "", stderr: "", exitCode: 0 },
        { command: "npm", args: ["run", "test"], stdout: "", stderr: "", exitCode: 0 },
      ],
    };
  };

  dcWorkerRunner.runInWorktree = async (_cwd, command, args) => {
    if (command === "git" && args[0] === "add") return { stdout: "", stderr: "", exitCode: 0 };
    if (command === "git" && args[0] === "commit") return { stdout: "[feat 1234567] commit", stderr: "", exitCode: 0 };
    if (command === "git" && args[0] === "fetch") return { stdout: "", stderr: "", exitCode: 0 };
    if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
      revParseCount++;
      // Primer rev-parse antes del merge: hash A
      if (revParseCount === 1) return { stdout: "1111111111111111111111111111111111111111\n", stderr: "", exitCode: 0 };
      // Segundo rev-parse después del merge: hash B (upstream integrado)
      return { stdout: "2222222222222222222222222222222222222222\n", stderr: "", exitCode: 0 };
    }
    if (command === "git" && args[0] === "merge") return { stdout: "Merge made by the 'ort' strategy.", stderr: "", exitCode: 0 };
    if (command === "git" && args[0] === "diff") return { stdout: " src/index.ts | 2 +-\n", stderr: "", exitCode: 0 };
    if (command === "git" && args[0] === "push") return { stdout: "", stderr: "", exitCode: 0 };
    if (command === "gh" && args[0] === "pr" && args[1] === "create") {
      const bodyIndex = args.indexOf("--body");
      if (bodyIndex !== -1) capturedPrBody = args[bodyIndex + 1];
      return { stdout: "https://github.com/davidcoachdev/dc-pi/pull/101\n", stderr: "", exitCode: 0 };
    }
    if (command === "gh" && args[0] === "issue") return { stdout: "", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  try {
    const res = await delivery.deliverIssue({
      worktreePath: tmpDir,
      taskSlug: "issue-101",
      issueNumber: 101,
      issueTitle: "Tarea con cambios nuevos en master",
      branchName: "feat/issue-101",
      baseBranch: "master",
      verificationEvidence: "- `npm run test`: exit 0 (pre-merge)",
    });

    assert.equal(res.ok, true);
    assert.equal(reverifyCalled, true, "verifyWorktree debió haberse ejecutado al cambiar el hash de HEAD");
    assert.ok(capturedPrBody.includes("post-merge"), "El cuerpo del PR debe reflejar la evidencia de la re-verificación post-merge");
    assert.equal(res.commitHash, "2222222");
  } finally {
    dcWorkerRunner.runInWorktree = originalRun;
    dcWorkerRunner.verifyWorktree = originalVerify;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
