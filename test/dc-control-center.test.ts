import test from "node:test";
import assert from "node:assert/strict";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { CollaboratorsDatabase, getCollaboratorsDatabase } from "../src/features/dc-agents/daemon/dc-collaborators-db.ts";
import { DcIssueDispatcher } from "../src/features/dc-agents/daemon/dc-issue-dispatcher.ts";
import { DcControlCenterPanel } from "../src/features/dc-agents/views/dc-control-center-modal.ts";

const dummyTheme: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

test("CollaboratorsDatabase: persistencia en memoria, seeds y toggles", () => {
  const db = new CollaboratorsDatabase(":memory:");

  // Seed inicial: davidcoachdev (OWNER) en estado ALLOW
  const owner = db.getCollaborator("davidcoachdev");
  assert.ok(owner);
  assert.equal(owner?.status, "ALLOW");
  assert.equal(owner?.role, "OWNER");

  // Agregar nuevo colaborador
  db.setCollaborator("alice", "ALLOW", "CONTRIBUTOR", "Dev senior");
  const alice = db.getCollaborator("alice");
  assert.ok(alice);
  assert.equal(alice?.status, "ALLOW");

  // Toggle status: ALLOW -> BLOCK -> PENDING -> ALLOW
  const status1 = db.toggleCollaboratorStatus("alice");
  assert.equal(status1, "BLOCK");
  assert.equal(db.getCollaborator("alice")?.status, "BLOCK");

  const status2 = db.toggleCollaboratorStatus("alice");
  assert.equal(status2, "PENDING");

  const status3 = db.toggleCollaboratorStatus("alice");
  assert.equal(status3, "ALLOW");

  // Listar
  const list = db.listCollaborators();
  assert.equal(list.length, 2);

  // Logs forenses
  const logs = db.getRecentLogs(10);
  assert.ok(logs.length >= 2);
  assert.ok(logs.some((l) => l.category === "SECURITY"));

  db.close();
});

test("DcIssueDispatcher: Doble Validación Soberana bloquea autores no permitidos y solicita elevación", async () => {
  const dispatcher = new DcIssueDispatcher();
  const repoIdentity = {
    owner: "davidcoachdev",
    repo: "dc-pi",
    fullNwo: "davidcoachdev/dc-pi",
    repoRoot: process.cwd(),
    remoteUrl: "https://github.com/davidcoachdev/dc-pi.git",
  };

  const collabDb = new CollaboratorsDatabase(":memory:");
  const { getCollaboratorsDatabase } = await import("../src/features/dc-agents/daemon/dc-collaborators-db.ts");
  // Asegurar que el usuario de prueba esté limpio en estado PENDING o no existente
  getCollaboratorsDatabase().setCollaborator("hacker-test-user", "PENDING", "EXTERNAL");

  // 1. Autor desconocido sin callback de autorización -> PENDING y BLOQUEADO
  const randomIssueNum = 1000 + Math.floor(Math.random() * 9000);
  const unknownPayload = {
    action: "opened",
    issue: {
      number: randomIssueNum,
      title: "Issue malicioso o desconocido",
      body: "Haz algo no autorizado",
      user: { login: "hacker-test-user" },
      html_url: `https://github.com/davidcoachdev/dc-pi/issues/${randomIssueNum}`,
    },
    repository: {
      name: "dc-pi",
      full_name: "davidcoachdev/dc-pi",
      owner: { login: "davidcoachdev" },
      html_url: "https://github.com/davidcoachdev/dc-pi",
    },
  };

  let progressMsg = "";
  const resBlocked = await dispatcher.dispatchIssue(
    unknownPayload,
    repoIdentity,
    (msg) => { progressMsg = msg; },
  );

  assert.equal(resBlocked, null, "Debe rechazar la ejecución si no está en ALLOW");
  assert.ok(progressMsg.includes("bloqueado"));

  // 2. Autor desconocido con autorización interactiva humana -> PERMITIDO
  let requestedAuthor = "";
  const resApproved = await dispatcher.dispatchIssue(
    unknownPayload,
    repoIdentity,
    undefined,
    async (author, issueNum) => {
      requestedAuthor = author;
      assert.equal(issueNum, randomIssueNum);
      return true; // Humano aprueba en la ventana interactiva
    },
  );

  assert.equal(requestedAuthor, "hacker-test-user");
  assert.ok(resApproved, "Debe despachar si el usuario lo autorizó");
  assert.equal(resApproved?.issueNumber, randomIssueNum);

  // Limpiar dispatch
  await dispatcher.cleanupDispatch("davidcoachdev/dc-pi", randomIssueNum);
});

test("DcControlCenterPanel: renderizado de 3 pestañas y navegación interactiva", () => {
  let doneCalled = false;
  let renderRequested = false;

  const panel = new DcControlCenterPanel(
    dummyTheme,
    () => { doneCalled = true; },
    () => { renderRequested = true; },
  );

  assert.equal(panel.getActiveTab(), "worktrees");

  // Render inicial (Pestaña 1: Worktrees)
  const lines1 = panel.render(80);
  assert.ok(lines1.some((l) => l.includes("Worktrees & ODD")));

  // Cambiar a Pestaña 2: Colaboradores (tecla '2')
  panel.handleInput("2");
  assert.equal(panel.getActiveTab(), "collaborators");
  const lines2 = panel.render(80);
  assert.ok(lines2.some((l) => l.includes("Colaboradores (Seguridad)")));
  assert.ok(lines2.some((l) => l.includes("davidcoachdev")));

  // Cambiar a Pestaña 3: Audit Log (tecla '3')
  panel.handleInput("3");
  assert.equal(panel.getActiveTab(), "audit");
  const lines3 = panel.render(80);
  assert.ok(lines3.some((l) => l.includes("Audit Log Forense")));

  // Conmutación con Tab
  panel.handleInput("\t");
  assert.equal(panel.getActiveTab(), "worktrees");

  // Escape cierra el panel
  panel.handleInput("escape");
  assert.equal(doneCalled, true);

  // Espacio conmuta colaboradores en Pestaña 2
  panel.handleInput("2");
  assert.equal(panel.getActiveTab(), "collaborators");
  const db = getCollaboratorsDatabase();
  db.setCollaborator("test-user-toggle", "ALLOW", "CONTRIBUTOR");
  const beforeToggle = db.getCollaborator("test-user-toggle");
  assert.equal(beforeToggle?.status, "ALLOW");

  const toggled = db.toggleCollaboratorStatus("test-user-toggle");
  assert.equal(toggled, "BLOCK");

  // Navegación con flechas izquierda y derecha (← y →)
  panel.handleInput("1");
  assert.equal(panel.getActiveTab(), "worktrees");
  panel.handleInput("\x1b[C"); // flecha derecha -> collaborators
  assert.equal(panel.getActiveTab(), "collaborators");
  panel.handleInput("\x1b[C"); // flecha derecha -> audit
  assert.equal(panel.getActiveTab(), "audit");
  panel.handleInput("\x1b[D"); // flecha izquierda -> collaborators
  assert.equal(panel.getActiveTab(), "collaborators");

  // Ctrl+Flechas (secuencias ANSI xterm \x1b[1;5C y \x1b[1;5D)
  panel.handleInput("\x1b[1;5C"); // Ctrl+Right -> audit
  assert.equal(panel.getActiveTab(), "audit");
  panel.handleInput("\x1b[1;5D"); // Ctrl+Left -> collaborators
  assert.equal(panel.getActiveTab(), "collaborators");

  // Revertir a ALLOW
  getCollaboratorsDatabase().setCollaborator("davidcoachdev", "ALLOW", "OWNER");
});
