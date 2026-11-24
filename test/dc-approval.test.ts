import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { DcApprovalCoordinator } from "../src/features/dc-approval/core/dc-approval-coordinator.ts";
import { DcApprovalPanel } from "../src/features/dc-approval/views/dc-approval-modal.ts";
import type { ApprovalOutcome } from "../src/features/dc-approval/core/dc-approval-types.ts";
import { CollaboratorsDatabase } from "../src/features/dc-agents/daemon/dc-collaborators-db.ts";
import {
  DcIssueDispatcher,
  buildIssueGrantScope,
  type GitHubIssuePayload,
} from "../src/features/dc-agents/daemon/dc-issue-dispatcher.ts";

const dummyTheme: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

test("dc-approval-coordinator: ciclo de vida Allowed-Once unitario y seguro", () => {
  const coordinator = new DcApprovalCoordinator();

  const req = coordinator.createRequest("bash", "Modificar /etc/hosts", "Resolución local", "/etc/hosts");
  assert.ok(req.id.startsWith("req-"));
  assert.equal(req.toolName, "bash");
  assert.equal(coordinator.hasGrant(req.id), false);

  // Otorgar permiso unitario
  coordinator.grantOnce(req.id);
  assert.equal(coordinator.hasGrant(req.id), true);

  // Primer consumo: exitoso y revoca de inmediato
  const firstConsume = coordinator.consumeGrant(req.id);
  assert.equal(firstConsume, true);
  assert.equal(coordinator.hasGrant(req.id), false);

  // Segundo intento en la misma solicitud: denegado (Allowed-Once real)
  const secondConsume = coordinator.consumeGrant(req.id);
  assert.equal(secondConsume, false);
});

test("DcApprovalPanel: navegación por teclado y selección interactiva", () => {
  let finalOutcome: ApprovalOutcome | undefined = undefined;

  const req = {
    id: "req-test-1",
    action: "Escalar a danger-full-access",
    toolName: "bash",
    reason: "Instalación de paquetes de sistema",
    timestamp: Date.now(),
  };

  const panel = new DcApprovalPanel(req, dummyTheme, (outcome) => {
    finalOutcome = outcome;
  });

  // Render inicial
  const lines = panel.render(80);
  assert.ok(lines.some((l) => l.includes("ELEVACIÓN DE PRIVILEGIOS")));
  assert.ok(lines.some((l) => l.includes("Aceptar una sola vez")));

  // Navegación con tecla derecha
  panel.handleInput("right");
  // Presionar Enter sobre "Rechazar"
  panel.handleInput("enter");
  assert.equal(finalOutcome, "rejected");

  // Escape cancela
  panel.handleInput("escape");
  assert.equal(finalOutcome, "cancelled");

  // Tecla numérica "1" aprueba de una
  panel.handleInput("1");
  assert.equal(finalOutcome, "allowed-once");

  // Tecla numérica "3" cancela
  panel.handleInput("3");
  assert.equal(finalOutcome, "cancelled");

  // Mouse click en botón
  const lines2 = panel.render(68);
  const btnRowIdx = lines2.length - 1;
  const res = panel.handleMouse({
    type: "click",
    button: "left",
    x: 2,
    y: btnRowIdx,
    screenX: 2,
    screenY: btnRowIdx,
    width: 68,
    height: 10,
    shift: false,
    alt: false,
    ctrl: false,
  });
  assert.deepEqual(res, { handled: true, render: true });
  assert.equal(finalOutcome, "allowed-once");
});

function createTempRepoFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dc-approval-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  git("add", ".");
  git("commit", "-m", "init");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");

  const repo = {
    repoRoot: root,
    owner: "fixture",
    repo: path.basename(root),
    fullNwo: `fixture/${path.basename(root)}`,
    remoteUrl: "https://github.com/fixture/repo.git",
  };

  const makePayload = (issueNumber: number, login: string, title = `Issue #${issueNumber}`): GitHubIssuePayload => ({
    action: "opened",
    issue: {
      number: issueNumber,
      title,
      body: "fixture body",
      user: { login },
      html_url: `https://github.com/${repo.fullNwo}/issues/${issueNumber}`,
    },
    repository: {
      name: repo.repo,
      full_name: repo.fullNwo,
      owner: { login: repo.owner },
      html_url: `https://github.com/${repo.fullNwo}`,
    },
  });

  const cleanup = () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };

  return { root, repo, makePayload, cleanup };
}

test("dc-approval-coordinator: grants acotados, expiración y revocación sin fugas en activeGrants", () => {
  const coordinator = new DcApprovalCoordinator();
  const req = coordinator.createRequest("GitHub Issue Webhook", "Dispatch", "Pending author", "issue-42");
  const scope = "issue:fixture/repo#42:alice";

  coordinator.grantOnce(req.id, { scope });
  assert.equal(coordinator.getActiveGrantCount(), 1);
  assert.equal(coordinator.hasGrant(req.id, "issue:fixture/repo#99:alice"), false);
  assert.equal(coordinator.consumeGrant(req.id, "issue:fixture/repo#99:alice"), false);
  assert.equal(coordinator.getActiveGrantCount(), 1, "Un ámbito incorrecto no debe consumir ni autorizar");

  assert.equal(coordinator.consumeGrant(req.id, scope), true);
  assert.equal(coordinator.hasGrant(req.id), false);
  assert.equal(coordinator.getActiveGrantCount(), 0);
  assert.equal(coordinator.consumeGrant(req.id, scope), false);

  // Expiración sin timers colgados
  coordinator.grantOnce("req-ttl", { ttlMs: 1_000 });
  assert.equal(coordinator.getActiveGrantCount(), 1);
  assert.equal(coordinator.pruneExpired(Date.now() + 5_000), 1);
  assert.equal(coordinator.getActiveGrantCount(), 0);
  assert.equal(coordinator.hasGrant("req-ttl"), false);

  // TTL <= 0 no deja fugas
  coordinator.grantOnce("req-zero", { ttlMs: 0 });
  assert.equal(coordinator.getActiveGrantCount(), 0);

  // Revocación explícita limpia activeGrants
  coordinator.grantOnce("req-revoke");
  assert.equal(coordinator.getActiveGrantCount(), 1);
  assert.equal(coordinator.revokeGrant("req-revoke"), true);
  assert.equal(coordinator.getActiveGrantCount(), 0);
});

test("S3: scoped grant rejects unscoped hasGrant/consumeGrant and succeeds with matching scope", () => {
  const coordinator = new DcApprovalCoordinator();
  const req = coordinator.createRequest("GitHub Issue Webhook", "Dispatch", "Scoped defense-in-depth", "issue-77");
  const scope = "issue:fixture/repo#77:bob";

  coordinator.grantOnce(req.id, { scope });

  // Unscoped caller must NOT match or consume a scoped grant
  assert.equal(coordinator.hasGrant(req.id), false);
  assert.equal(coordinator.consumeGrant(req.id), false);
  assert.equal(coordinator.getActiveGrantCount(), 1, "Unscoped consumeGrant must leave scoped grant intact");

  // Scoped caller with matching scope succeeds and consumes the grant once
  assert.equal(coordinator.hasGrant(req.id, scope), true);
  assert.equal(coordinator.consumeGrant(req.id, scope), true);
  assert.equal(coordinator.getActiveGrantCount(), 0);
  assert.equal(coordinator.consumeGrant(req.id, scope), false);
});

test("CRIT-03: allowed-once consume grant en DcApprovalCoordinator, no persiste ALLOW y re-solicita en siguiente dispatch", async () => {
  const fixture = createTempRepoFixture();
  const db = new CollaboratorsDatabase(":memory:");
  const coordinator = new DcApprovalCoordinator();
  const consumeCalls: Array<{ id: string; scope?: string; result: boolean }> = [];
  const origConsume = coordinator.consumeGrant.bind(coordinator);
  coordinator.consumeGrant = (requestId: string, expectedScope?: string) => {
    const result = origConsume(requestId, expectedScope);
    consumeCalls.push({ id: requestId, scope: expectedScope, result });
    return result;
  };

  const dispatcher = new DcIssueDispatcher({
    approvalCoordinator: coordinator,
    collaboratorsDb: db,
  });

  try {
    let capturedRequestId = "";
    const first = await dispatcher.dispatchIssue(
      fixture.makePayload(101, "once-author", "Fix puntual"),
      fixture.repo,
      undefined,
      async (author, issueNum, _title, requestId) => {
        capturedRequestId = requestId;
        coordinator.grantOnce(requestId, { scope: buildIssueGrantScope(fixture.repo.fullNwo, issueNum, author) });
        return "allowed-once";
      },
    );

    assert.ok(first, "allowed-once debe autorizar el despacho puntual");
    assert.equal(first.issueNumber, 101);
    assert.equal(consumeCalls.length, 1, "Debe invocar consumeGrant exactamente una vez");
    assert.equal(consumeCalls[0]?.id, capturedRequestId);
    assert.equal(consumeCalls[0]?.result, true);
    assert.equal(coordinator.getActiveGrantCount(), 0, "activeGrants debe quedar vacío tras consumir");
    assert.equal(coordinator.hasGrant(capturedRequestId), false);
    assert.equal(db.getCollaborator("once-author")?.status, "PENDING", "allowed-once NO debe persistir ALLOW en SQLite");

    // Siguiente issue del mismo autor sin re-aprobación -> rechazado
    const secondWithoutPrompt = await dispatcher.dispatchIssue(
      fixture.makePayload(102, "once-author", "Segundo issue sin permiso"),
      fixture.repo,
    );
    assert.equal(secondWithoutPrompt, null, "Sin re-aprobación debe bloquear el siguiente issue");
    assert.equal(coordinator.getActiveGrantCount(), 0);

    // Siguiente issue con callback -> debe volver a solicitar aprobación y respetar denied
    let reprompted = false;
    const secondDenied = await dispatcher.dispatchIssue(
      fixture.makePayload(102, "once-author", "Segundo issue rechazado"),
      fixture.repo,
      undefined,
      async (_author, issueNum, _title, requestId) => {
        reprompted = true;
        assert.equal(issueNum, 102);
        // Incluso si existía un grant previo para este requestId, denied debe revocarlo sin fugas
        coordinator.grantOnce(requestId);
        return "denied";
      },
    );
    assert.equal(reprompted, true, "Debe re-solicitar aprobación para el siguiente issue");
    assert.equal(secondDenied, null);
    assert.equal(coordinator.getActiveGrantCount(), 0, "denied no debe dejar grants en activeGrants");
    assert.equal(db.getCollaborator("once-author")?.status, "PENDING");

    await dispatcher.cleanupDispatch(fixture.repo.fullNwo, 101);
  } finally {
    db.close();
    fixture.cleanup();
  }
});

test("CRIT-03: allowed-permanent persiste ALLOW en SQLite y habilita despachos futuros sin re-prompt", async () => {
  const fixture = createTempRepoFixture();
  const db = new CollaboratorsDatabase(":memory:");
  const coordinator = new DcApprovalCoordinator();
  const dispatcher = new DcIssueDispatcher({
    approvalCoordinator: coordinator,
    collaboratorsDb: db,
  });

  try {
    const first = await dispatcher.dispatchIssue(
      fixture.makePayload(201, "trusted-dev", "Feature permanente"),
      fixture.repo,
      undefined,
      async () => "allowed-permanent",
    );

    assert.ok(first, "allowed-permanent debe autorizar el despacho");
    assert.equal(db.getCollaborator("trusted-dev")?.status, "ALLOW", "allowed-permanent debe persistir ALLOW en SQLite");
    assert.equal(coordinator.getActiveGrantCount(), 0, "allowed-permanent no debe dejar grants en activeGrants");

    let reprompted = false;
    const second = await dispatcher.dispatchIssue(
      fixture.makePayload(202, "trusted-dev", "Segundo feature ya permitido"),
      fixture.repo,
      undefined,
      async () => {
        reprompted = true;
        return "denied";
      },
    );
    assert.ok(second, "Autor con ALLOW permanente debe despachar sin re-aprobación");
    assert.equal(reprompted, false);

    await dispatcher.cleanupDispatch(fixture.repo.fullNwo, 201);
    await dispatcher.cleanupDispatch(fixture.repo.fullNwo, 202);
  } finally {
    db.close();
    fixture.cleanup();
  }
});

