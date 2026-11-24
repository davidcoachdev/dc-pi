import test from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { parseGitHubRepoNwo, resolveCurrentRepoIdentity } from "../src/features/dc-agents/daemon/dc-repo-resolver.ts";
import { DcConflictGuard } from "../src/features/dc-agents/daemon/dc-conflict-guard.ts";
import { DcControlReceiver } from "../src/features/dc-agents/daemon/dc-control-receiver.ts";
import { DcGitHubGateway } from "../src/features/dc-agents/daemon/dc-github-gateway.ts";
import { DcControlDaemonManager, isValidRepoNwo } from "../src/features/dc-agents/daemon/dc-control-daemon-manager.ts";
import { DcIssueDispatcher, type GitHubIssuePayload } from "../src/features/dc-agents/daemon/dc-issue-dispatcher.ts";
import { handleToolCall } from "../src/features/dc-scan-guard/index.ts";
import { dcConflictGuard } from "../src/features/dc-agents/daemon/dc-conflict-guard.ts";

function signGitHubWebhook(secret: string, body: string | Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

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
  const webhookSecret = "test-hmac-secret";
  const receiver = new DcControlReceiver({
    port: 0,
    expectedRepoNwo: "org/repo",
    webhookSecret,
    onIssueOpened: () => { calls++; },
  });
  const port = await receiver.start();
  const send = async (
    payload: unknown,
    opts?: { event?: string; signature?: string | null; query?: string },
  ) => {
    const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
    const headers: Record<string, string> = {
      "x-github-event": opts?.event ?? "issues",
      "x-github-delivery": "same-id",
    };
    if (opts?.signature === undefined) {
      headers["x-hub-signature-256"] = signGitHubWebhook(webhookSecret, rawBody);
    } else if (opts.signature !== null) {
      headers["x-hub-signature-256"] = opts.signature;
    }
    const response = await fetch(`http://127.0.0.1:${port}/github-webhook${opts?.query ?? ""}`, {
      method: "POST",
      headers,
      body: rawBody,
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
    assert.ok(!malformed.body.includes(webhookSecret));
    // Missing HMAC signature rejected with 401 before JSON parse / dedup
    assert.equal((await send("not json", { signature: null })).code, 401);
    // Malformed HMAC signature rejected with 401
    assert.equal((await send(payload, { signature: "sha256=bad" })).code, 401);
    // Valid format but wrong HMAC digest rejected with 401 before JSON parse / dedup
    assert.equal((await send("not json", { signature: `sha256=${"0".repeat(64)}` })).code, 401);
    assert.equal((await send(payload, { signature: `sha256=${"0".repeat(64)}` })).code, 401);
    // Query-string ?capability= is actively rejected with 401
    assert.equal((await send(payload, { query: `?capability=${webhookSecret}` })).code, 401);
    // Valid HMAC checks repository identity
    assert.equal((await send({ ...payload, repository: {} })).code, 403);
    assert.equal((await send({ ...payload, repository: { full_name: "bad/repo" } })).code, 403);
    assert.equal(calls, 0);
    assert.match((await send({ ...payload, zen: "hello" }, { event: "ping" })).body, /pong/);
    const ignored = await send(payload, { event: "push" });
    assert.match(ignored.body, /ignored_event/);
    assert.equal(calls, 0);
    // Previous rejected requests must NOT have poisoned delivery deduplication
    const accepted = await send(payload);
    assert.equal(accepted.code, 202);
    assert.equal(calls, 1);
    assert.match((await send(payload)).body, /ignored_duplicate/);
  } finally { await receiver.stop(); }
});

test("dc-control-receiver: levanta servidor loopback, procesa webhook con HMAC y deduplica entregas", async () => {
  let receivedIssue: any = null;
  const webhookSecret = "loopback-hmac-secret";

  const receiver = new DcControlReceiver({
    port: 4599,
    webhookSecret,
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

  // Enviar POST HTTP al receptor local con X-Hub-Signature-256
  await new Promise<void>((resolve, reject) => {
    const data = JSON.stringify(samplePayload);
    const req = http.request(
      `http://127.0.0.1:${port}/github-webhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "issues",
          "X-GitHub-Delivery": "delivery-uuid-1",
          "X-Hub-Signature-256": signGitHubWebhook(webhookSecret, data),
        },
      },
      (res) => {
        assert.equal(res.statusCode, 202);
        res.resume();
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
      `http://127.0.0.1:${port}/github-webhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "issues",
          "X-GitHub-Delivery": "delivery-uuid-1", // Mismo delivery ID
          "X-Hub-Signature-256": signGitHubWebhook(webhookSecret, data),
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

test("dc-github-gateway: rechaza payload >5 MB con un único 413 sin ERR_HTTP_HEADERS_SENT", async (t) => {
  const webhookSecret = "oversized-hmac-secret";
  const serverErrors: Error[] = [];
  const uncaughtErrors: Error[] = [];
  const onUncaught = (err: Error) => {
    uncaughtErrors.push(err);
  };
  process.on("uncaughtException", onUncaught);
  t.after(() => {
    process.off("uncaughtException", onUncaught);
  });

  const gateway = new DcGitHubGateway({
    port: 0,
    webhookSecret,
    expectedRepoNwo: "org/repo",
    onError: (err) => serverErrors.push(err),
  });

  const port = await gateway.start();
  t.after(async () => {
    await gateway.stop();
  });

  const oversizedBody = Buffer.alloc(5 * 1024 * 1024 + 512 * 1024, 0x61); // 5.5 MiB
  const signature = signGitHubWebhook(webhookSecret, oversizedBody);

  const result = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
    let settled = false;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/github-webhook",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "issues",
          "X-GitHub-Delivery": "oversized-delivery-1",
          "X-Hub-Signature-256": signature,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk.toString("utf8");
        });
        res.on("end", () => {
          if (!settled) {
            settled = true;
            resolve({ statusCode: res.statusCode, body });
          }
        });
      },
    );

    req.on("error", (err: any) => {
      // EPIPE/ECONNRESET en el cliente al abortar subida tras 413 es normal en HTTP/1.1
      if (err?.code === "EPIPE" || err?.code === "ECONNRESET") {
        return;
      }
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    // Enviar en múltiples chunks para ejercitar múltiples eventos `data` tras cruzar los 5 MB
    const chunkSize = 256 * 1024;
    for (let offset = 0; offset < oversizedBody.length; offset += chunkSize) {
      if (req.destroyed) break;
      req.write(oversizedBody.subarray(offset, offset + chunkSize));
    }
    if (!req.destroyed) {
      req.end();
    }
  });

  await new Promise((r) => setTimeout(r, 50));

  assert.equal(result.statusCode, 413);
  assert.equal(result.body, "Payload Too Large");
  assert.equal(serverErrors.length, 0, "No debe registrar errores del servidor");
  assert.equal(
    uncaughtErrors.some((e: any) => e?.code === "ERR_HTTP_HEADERS_SENT"),
    false,
    "Nunca debe lanzar ERR_HTTP_HEADERS_SENT en respuestas 413",
  );

  // El gateway debe seguir atendiendo solicitudes válidas después del 413
  const pingBody = JSON.stringify({ zen: "still alive", repository: { full_name: "org/repo" } });
  const pingRes = await fetch(`http://127.0.0.1:${port}/github-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "ping",
      "X-Hub-Signature-256": signGitHubWebhook(webhookSecret, pingBody),
    },
    body: pingBody,
  });
  assert.equal(pingRes.status, 200);
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

test("dc-control-daemon-manager: stop() valida fullNwo contra inyección, usa execFileSync(gh) y no ejecuta pkill global", async (t) => {
  const tempBin = fs.mkdtempSync(path.join(os.tmpdir(), "dc-daemon-bin-"));
  const originalPath = process.env.PATH || "";
  t.after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(tempBin, { recursive: true, force: true });
  });

  const pkillMarker = path.join(tempBin, "pkill-called.txt");
  const injectMarker = path.join(tempBin, "injected.txt");
  const ghLogFile = path.join(tempBin, "gh-args.log");

  const pkillScript = path.join(tempBin, "pkill");
  fs.writeFileSync(pkillScript, `#!/bin/sh\necho "$@" >> "${pkillMarker}"\nexit 0\n`, { mode: 0o755 });

  const ghScript = path.join(tempBin, "gh");
  fs.writeFileSync(
    ghScript,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${ghLogFile}"\nif [ "$1" = "api" ] && [ "$2" = "repos/davidcoachdev/dc-pi/hooks" ]; then\n  echo "98765"\nfi\nexit 0\n`,
    { mode: 0o755 },
  );

  process.env.PATH = `${tempBin}:${originalPath}`;

  const manager = new DcControlDaemonManager();
  let killedSignal: string | undefined;
  (manager as any).tunnelProcess = {
    pid: 999991,
    killed: false,
    kill(sig: string) {
      killedSignal = sig;
      this.killed = true;
      return true;
    },
  };
  (manager as any).currentRepo = {
    owner: "davidcoachdev",
    repo: "dc-pi",
    fullNwo: `davidcoachdev/dc-pi; touch "${injectMarker}"`,
  };

  await manager.stop();

  assert.equal(killedSignal, "SIGTERM", "Debe terminar únicamente el proceso de túnel rastreado");
  assert.equal(fs.existsSync(pkillMarker), false, "Nunca debe ejecutar pkill global");
  assert.equal(fs.existsSync(injectMarker), false, "Nunca debe interpolar fullNwo en un shell");
  assert.equal(fs.existsSync(ghLogFile), false, "No debe invocar gh si fullNwo no cumple el formato owner/repo");

  // Validar rechazo de segmentos de path traversal (`..` / `.`) manteniendo `.` válido en nombres de repo
  assert.equal(isValidRepoNwo("davidcoachdev/dc-pi"), true);
  assert.equal(isValidRepoNwo("davidcoachdev/.github"), true);
  assert.equal(isValidRepoNwo("davidcoachdev/dc-pi.js"), true);
  for (const invalidNwo of ["foo/..", "../bar", "../evil", "foo/../bar", "./bar", "foo/."]) {
    assert.equal(isValidRepoNwo(invalidNwo), false, `Debe rechazar repo NWO inválido: ${invalidNwo}`);
    (manager as any).currentRepo = { owner: "foo", repo: "bar", fullNwo: invalidNwo };
    await manager.stop();
    assert.equal(fs.existsSync(ghLogFile), false, `stop() nunca debe invocar gh para ${invalidNwo}`);
  }

  // Ahora con un fullNwo válido debe usar execFileSync("gh", [...]) y borrar los hooks numéricos devueltos
  (manager as any).currentRepo = {
    owner: "davidcoachdev",
    repo: "dc-pi",
    fullNwo: "davidcoachdev/dc-pi",
  };
  await manager.stop();

  assert.equal(fs.existsSync(pkillMarker), false, "Nunca debe ejecutar pkill global");
  assert.equal(fs.existsSync(ghLogFile), true, "Debe invocar gh para limpiar hooks del repo válido");
  const ghCalls = fs.readFileSync(ghLogFile, "utf8").trim().split("\n");
  assert.equal(ghCalls.length, 2);
  assert.match(ghCalls[0]!, /^api repos\/davidcoachdev\/dc-pi\/hooks --jq /);
  assert.equal(ghCalls[1], "api repos/davidcoachdev/dc-pi/hooks/98765 -X DELETE");
});

test("dc-control-daemon-manager: start() pasa --secret a gh webhook forward sin ?capability= en --url y autentica HMAC end-to-end", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dc-daemon-start-argv-"));
  const tempBin = path.join(tempRoot, "bin");
  const repoDir = path.join(tempRoot, "repo");
  fs.mkdirSync(tempBin, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });

  const originalPath = process.env.PATH || "";
  const originalSecret = process.env.DC_GITHUB_WEBHOOK_SECRET;
  const originalGhEnvSecret = process.env.GH_WEBHOOK_SECRET;
  const testSecret = "super-secret-hmac-key-0123456789abcdef0123456789abcdef0123456789";
  process.env.DC_GITHUB_WEBHOOK_SECRET = testSecret;
  delete process.env.GH_WEBHOOK_SECRET;

  const ghArgvLog = path.join(tempRoot, "gh-spawn-argv.log");
  const ghEnvLog = path.join(tempRoot, "gh-spawn-env.log");
  const ghScript = path.join(tempBin, "gh");
  fs.writeFileSync(
    ghScript,
    `#!/bin/sh\nif [ "$1" = "webhook" ] && [ "$2" = "forward" ]; then\n  printf '%s\\n' "$@" > "${ghArgvLog}"\n  printf '%s' "\${GH_WEBHOOK_SECRET:-}" > "${ghEnvLog}"\n  printf 'Error: simulated stderr with %s\\n' "${testSecret}" >&2\n  sleep 5\nfi\nexit 0\n`,
    { mode: 0o755 },
  );

  execFileSync("git", ["-C", repoDir, "init", "--quiet"]);
  execFileSync("git", ["-C", repoDir, "remote", "add", "origin", "https://github.com/davidcoachdev/dc-pi.git"]);

  const errorLogs: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    errorLogs.push(args.map(String).join(" "));
  });

  process.env.PATH = `${tempBin}:${originalPath}`;
  const manager = new DcControlDaemonManager();
  t.mock.method(manager, "executeIssue", async () => {});

  t.after(async () => {
    await manager.stop();
    process.env.PATH = originalPath;
    if (originalSecret === undefined) {
      delete process.env.DC_GITHUB_WEBHOOK_SECRET;
    } else {
      process.env.DC_GITHUB_WEBHOOK_SECRET = originalSecret;
    }
    if (originalGhEnvSecret === undefined) {
      delete process.env.GH_WEBHOOK_SECRET;
    } else {
      process.env.GH_WEBHOOK_SECRET = originalGhEnvSecret;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const status = await manager.start({ cwd: repoDir } as any);
  assert.equal(status.running, true);
  assert.equal(status.tunnelActive, true);

  // Esperar brevemente a que el script stub `gh` vuelque sus argumentos, env y stderr
  for (let i = 0; i < 40 && (!fs.existsSync(ghArgvLog) || !fs.existsSync(ghEnvLog) || errorLogs.length === 0); i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(fs.existsSync(ghArgvLog), true, "El proceso gh webhook forward debe haberse invocado");

  const spawnedArgs = fs.readFileSync(ghArgvLog, "utf8").trim().split("\n");
  assert.equal(spawnedArgs[0], "webhook");
  assert.equal(spawnedArgs[1], "forward");
  assert.equal(spawnedArgs[2], "--repo=davidcoachdev/dc-pi");

  const urlArg = spawnedArgs.find((a) => a.startsWith("--url="));
  assert.ok(urlArg, "Debe incluir --url=");
  assert.equal(urlArg, `--url=http://127.0.0.1:${status.port}/github-webhook`);
  assert.equal(urlArg.includes("?capability="), false, "Nunca debe embeber ?capability= en --url");
  assert.equal(spawnedArgs.some((a) => a.includes("?capability=")), false, "Nunca debe pasar ?capability= en argv");

  const secretArg = spawnedArgs.find((a) => a.startsWith("--secret="));
  assert.equal(secretArg, `--secret=${testSecret}`, "Debe pasar --secret=<secret> para que GitHub firme X-Hub-Signature-256");
  const passedSecret = secretArg!.slice("--secret=".length);
  assert.equal(fs.readFileSync(ghEnvLog, "utf8"), "", "No debe pasar la variable muerta GH_WEBHOOK_SECRET");

  // Verificación end-to-end del gateway HTTP usando el secreto pasado a `gh webhook forward`
  const targetUrl = urlArg.slice("--url=".length);
  const issueBody = JSON.stringify({
    action: "opened",
    issue: { number: 42, title: "HMAC e2e", body: "body", user: { login: "davidcoachdev" } },
    repository: { full_name: "davidcoachdev/dc-pi" },
  });

  const unsignedRes = await fetch(targetUrl, {
    method: "POST",
    headers: { "x-github-event": "issues", "x-github-delivery": "e2e-unsigned" },
    body: issueBody,
  });
  const unsignedText = await unsignedRes.text();
  assert.equal(unsignedRes.status, 401);
  assert.equal(unsignedText.includes(testSecret), false);

  const badSigRes = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "x-github-event": "issues",
      "x-github-delivery": "e2e-badsig",
      "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
    },
    body: issueBody,
  });
  const badSigText = await badSigRes.text();
  assert.equal(badSigRes.status, 401);
  assert.equal(badSigText.includes(testSecret), false);

  const queryCapRes = await fetch(`${targetUrl}?capability=${testSecret}`, {
    method: "POST",
    headers: {
      "x-github-event": "issues",
      "x-github-delivery": "e2e-cap",
      "x-hub-signature-256": signGitHubWebhook(passedSecret, issueBody),
    },
    body: issueBody,
  });
  const queryCapText = await queryCapRes.text();
  assert.equal(queryCapRes.status, 401);
  assert.equal(queryCapText.includes(testSecret), false);

  const signedRes = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "x-github-event": "issues",
      "x-github-delivery": "e2e-signed",
      "x-hub-signature-256": signGitHubWebhook(passedSecret, issueBody),
    },
    body: issueBody,
  });
  const signedText = await signedRes.text();
  assert.equal(signedRes.status, 202);
  assert.equal(signedText.includes(testSecret), false);

  // Nunca filtrar el secreto en getStatus() ni en logs de stderr
  assert.equal(JSON.stringify(manager.getStatus()).includes(testSecret), false);
  assert.ok(errorLogs.length > 0, "Debe registrar el error simulado de stderr");
  assert.equal(errorLogs.join("\n").includes(testSecret), false, "stderr redactado nunca debe filtrar webhookSecret");
  assert.equal(errorLogs.join("\n").includes("[REDACTED]"), true);
});


