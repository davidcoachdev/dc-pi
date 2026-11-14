import test from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { parseGitHubRepoNwo, resolveCurrentRepoIdentity } from "../src/features/dc-agents/daemon/dc-repo-resolver.ts";
import { DcConflictGuard } from "../src/features/dc-agents/daemon/dc-conflict-guard.ts";
import { DcControlReceiver } from "../src/features/dc-agents/daemon/dc-control-receiver.ts";
import { DcIssueDispatcher, type GitHubIssuePayload } from "../src/features/dc-agents/daemon/dc-issue-dispatcher.ts";
import { handleToolCall } from "../src/features/dc-scan-guard/index.ts";
import { dcConflictGuard } from "../src/features/dc-agents/daemon/dc-conflict-guard.ts";

test("dc-repo-resolver: parseGitHubRepoNwo extrae owner/repo limpiamente", () => {
  assert.deepEqual(parseGitHubRepoNwo("https://github.com/davidcoachdev/dc-pi.git"), {
    owner: "davidcoachdev",
    repo: "dc-pi",
    fullNwo: "davidcoachdev/dc-pi",
  });

  assert.deepEqual(parseGitHubRepoNwo("git@github.com:davidcoachdev/dc-tts.git"), {
    owner: "davidcoachdev",
    repo: "dc-tts",
    fullNwo: "davidcoachdev/dc-tts",
  });

  assert.deepEqual(parseGitHubRepoNwo("https://github.com/myorg/awesome-project"), {
    owner: "myorg",
    repo: "awesome-project",
    fullNwo: "myorg/awesome-project",
  });

  assert.equal(parseGitHubRepoNwo("https://gitlab.com/other/repo"), null);
  assert.equal(parseGitHubRepoNwo(""), null);
});

test("dc-repo-resolver: resolveCurrentRepoIdentity detecta dinámicamente el repo actual", (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "dc-repo-identity-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const nested = path.join(repo, "src", "nested");
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(resolveCurrentRepoIdentity(nested), null, "Non-Git directories have no repo identity");

  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  git("init", "--quiet");
  assert.equal(resolveCurrentRepoIdentity(nested), null, "A repo without origin has no remote identity");

  const remoteUrl = "https://github.com/fixture-owner/portable-repo.git";
  git("remote", "add", "origin", remoteUrl);
  assert.deepEqual(resolveCurrentRepoIdentity(nested), {
    owner: "fixture-owner",
    repo: "portable-repo",
    fullNwo: "fixture-owner/portable-repo",
    repoRoot: fs.realpathSync(repo),
    remoteUrl,
  });

  git("remote", "set-url", "origin", "https://gitlab.com/fixture-owner/portable-repo.git");
  assert.equal(resolveCurrentRepoIdentity(nested), null, "Non-GitHub origins are rejected");
});

test("dc-conflict-guard: reserva y detecta colisiones de archivos", () => {
  const guard = new DcConflictGuard();

  // Reserva de tarea A
  const resA = guard.reserveFiles(["src/ui/dc-window.ts", "src/ui/dc-modal.ts"], "issue-8", "Ventana de admin");
  assert.equal(resA.ok, true);

  // Consulta de conflicto
  const check = guard.checkFileConflict("src/ui/dc-window.ts");
  assert.ok(check);
  assert.equal(check?.taskId, "issue-8");

  // Tarea B intenta tocar el mismo archivo -> Conflicto detectado
  const resB = guard.reserveFiles(["src/ui/dc-window.ts"], "issue-9", "Otro issue");
  assert.equal(resB.ok, false);
  assert.equal(resB.conflicts?.length, 1);
  assert.equal(resB.conflicts?.[0]?.taskId, "issue-8");

  // Liberación de tarea A
  guard.releaseTask("issue-8");
  assert.equal(guard.checkFileConflict("src/ui/dc-window.ts"), undefined);

  // Tarea B ahora sí puede reservar
  const resBRetry = guard.reserveFiles(["src/ui/dc-window.ts"], "issue-9", "Otro issue");
  assert.equal(resBRetry.ok, true);
});

test("receiver authenticates before parsing or deduplication and requires repository and event identity", async () => {
  let calls = 0;
  const receiver = new DcControlReceiver({ port: 0, expectedRepoNwo: "org/repo",
    capability: "test-capability", onIssueOpened: () => { calls++; } });
  const port = await receiver.start();
  const send = async (token: string, payload: unknown, event = "issues") => {
    const response = await fetch(`http://127.0.0.1:${port}/github-webhook${token}`, {
      method: "POST", headers: { "x-github-event": event, "x-github-delivery": "same-id" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
    return { code: response.status, body: await response.text() };
  };
  const payload = { action: "opened", issue: { number: 1 }, repository: { full_name: "org/repo" } };
  try {
    const malformed = await new Promise<{ code: number | undefined; body: string }>((resolve, reject) => {
      const request = http.request({ hostname: "127.0.0.1", port, method: "POST", path: "http://[",
        headers: { "x-github-delivery": "same-id" } }, response => {
        let body = "";
        response.on("data", chunk => { body += chunk; });
        response.on("end", () => resolve({ code: response.statusCode, body }));
      });
      request.on("error", reject); request.end();
    });
    assert.equal(malformed.code, 400);
    assert.ok(!malformed.body.includes("test-capability"));
    assert.equal((await send("", "not json")).code, 401);
    assert.equal((await send("?capability=wrong", payload)).code, 401);
    assert.equal((await send("?capability=test-capability", { ...payload, repository: {} })).code, 403);
    assert.equal((await send("?capability=test-capability", { ...payload, repository: { full_name: "bad/repo" } })).code, 403);
    assert.equal(calls, 0);
    assert.match((await send("?capability=test-capability", { ...payload, zen: "hello" }, "ping")).body, /pong/);
    const ignored = await send("?capability=test-capability", payload, "push");
    assert.match(ignored.body, /ignored_event/);
    assert.equal(calls, 0);
    const accepted = await send("?capability=test-capability", payload);
    assert.equal(accepted.code, 202);
    assert.equal(calls, 1);
    assert.match((await send("?capability=test-capability", payload)).body, /ignored_duplicate/);
  } finally { await receiver.stop(); }
});

test("dc-webhook-receiver: levanta servidor loopback, procesa webhook y deduplica entregas", async () => {
  let receivedIssue: any = null;

  const receiver = new DcControlReceiver({
    port: 4599,
    capability: "test-capability",
    expectedRepoNwo: "davidcoachdev/dc-pi",
    onIssueOpened: (payload) => {
      receivedIssue = payload;
    },
  });

  const port = await receiver.start();
  assert.equal(receiver.isRunning(), true);
  assert.equal(port, 4599);

  const samplePayload: GitHubIssuePayload = {
    action: "opened",
    issue: {
      number: 8,
      title: "prueba de contexto",
      body: "quiero una ventana para administrar las ventanas",
      user: { login: "davidcoachdev" },
      html_url: "https://github.com/davidcoachdev/dc-pi/issues/8",
    },
    repository: {
      name: "dc-pi",
      full_name: "davidcoachdev/dc-pi",
      owner: { login: "davidcoachdev" },
      html_url: "https://github.com/davidcoachdev/dc-pi",
    },
  };

  // Enviar POST HTTP al receptor local
  await new Promise<void>((resolve, reject) => {
    const data = JSON.stringify(samplePayload);
    const req = http.request(
      `http://127.0.0.1:${port}/github-webhook?capability=test-capability`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "issues",
          "X-GitHub-Delivery": "delivery-uuid-1",
        },
      },
      (res) => {
        assert.equal(res.statusCode, 202);
        resolve();
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });

  assert.ok(receivedIssue);
  assert.equal(receivedIssue.issue.number, 8);
  assert.equal(receivedIssue.issue.title, "prueba de contexto");

  // Enviar misma entrega (deduplicación por delivery ID)
  await new Promise<void>((resolve, reject) => {
    const data = JSON.stringify(samplePayload);
    const req = http.request(
      `http://127.0.0.1:${port}/github-webhook?capability=test-capability`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "issues",
          "X-GitHub-Delivery": "delivery-uuid-1", // Mismo delivery ID
        },
      },
      (res) => {
        let respBody = "";
        res.on("data", (chunk) => { respBody += chunk; });
        res.on("end", () => {
          assert.equal(res.statusCode, 200);
          assert.ok(respBody.includes("ignored_duplicate"));
          resolve();
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });

  await receiver.stop();
  assert.equal(receiver.isRunning(), false);
});

test("dc-scan-guard: bloquea herramientas edit/write sobre archivos reservados por conflict guard", () => {
  dcConflictGuard.clear();
  dcConflictGuard.reserveFiles(["src/core/secret.ts"], "issue-8", "Issue #8");

  // Edición de un archivo no reservado -> permitido
  const unreserved = handleToolCall({
    toolName: "edit",
    input: { path: "src/ui/dc-window.ts" },
  });
  assert.equal(unreserved, undefined);

  // 1. Relativo + edit -> BLOQUEADO
  const blockedRelEdit = handleToolCall({
    toolName: "edit",
    input: { path: "src/core/secret.ts" },
  });
  assert.ok(blockedRelEdit);
  assert.equal(blockedRelEdit?.block, true);
  assert.ok(blockedRelEdit?.reason.includes("dc-conflict-guard"));
  assert.ok(blockedRelEdit?.reason.includes("Issue #8"));

  // 2. Relativo + write -> BLOQUEADO
  const blockedRelWrite = handleToolCall({
    toolName: "write",
    input: { path: "src/core/secret.ts" },
  });
  assert.ok(blockedRelWrite);
  assert.equal(blockedRelWrite?.block, true);
  assert.ok(blockedRelWrite?.reason.includes("dc-conflict-guard"));

  // 3. Absoluto + edit -> BLOQUEADO
  const absolutePath = path.resolve(process.cwd(), "src/core/secret.ts");
  const blockedAbsEdit = handleToolCall({
    toolName: "edit",
    input: { path: absolutePath },
  });
  assert.ok(blockedAbsEdit);
  assert.equal(blockedAbsEdit?.block, true);
  assert.ok(blockedAbsEdit?.reason.includes("dc-conflict-guard"));

  // 4. Absoluto + write -> BLOQUEADO
  const blockedAbsWrite = handleToolCall({
    toolName: "write",
    input: { path: absolutePath },
  });
  assert.ok(blockedAbsWrite);
  assert.equal(blockedAbsWrite?.block, true);
  assert.ok(blockedAbsWrite?.reason.includes("dc-conflict-guard"));

  dcConflictGuard.clear();
});

