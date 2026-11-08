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
  assert.ok(lines1.some((l) => l.includes("[1] Central")));

  // Cambiar a Pestaña 2: Colaboradores (tecla '2')
  panel.handleInput("2");
  assert.equal(panel.getActiveTab(), "collaborators");
  const lines2 = panel.render(80);
  assert.ok(lines2.some((l) => l.includes("[2] Colaboradores")));
  assert.ok(lines2.some((l) => l.includes("davidcoachdev")));

  // Cambiar a Pestaña 3: Audit Log (tecla '3')
  panel.handleInput("3");
  assert.equal(panel.getActiveTab(), "audit");
  const lines3 = panel.render(80);
  assert.ok(lines3.some((l) => l.includes("Audit Log") || l.includes("Forense")));

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

test("DcControlCenterPanel: interfaz Central con Decisiones, Tareas, Resumen, Acciones e Input", () => {
  let doneCalled = false;
  let renderRequested = false;

  const panel = new DcControlCenterPanel(
    dummyTheme,
    () => { doneCalled = true; },
    () => { renderRequested = true; },
  );

  // Demo fixtures remain available only after explicit opt-in.
  panel.setSimulatedMode(true);
  panel.handleInput("j");
  const lines = panel.render(140);
  const text = lines.join("\n");

  // 1. Cabecera superior con estado de Central y modo
  assert.ok(text.includes("0 trabajando"), "Debe contar solo tareas de demostración activas");
  assert.ok(text.includes("CENTRAL"), "Debe incluir el título CENTRAL");
  assert.ok(text.includes("MODO PRUEBA"), "Debe indicar el modo de prueba");
  assert.ok(text.includes("GitHub: sincronización no consultada"), "No debe inventar sincronización");

  // 2. Columna izquierda: 1 DECISIONES, 2 TAREAS, 3 HECHO HOY
  assert.ok(text.includes("1 DECISIONES"), "Debe contener sección 1 DECISIONES");
  assert.ok(text.includes("2 TAREAS"), "Debe contener sección 2 TAREAS");
  assert.ok(text.includes("3 HECHO HOY"), "Debe contener sección 3 HECHO HOY");
  assert.ok(text.includes("WibondConnect#3759"), "Debe listar el item de decisión WibondConnect#3759");

  // 3. Columna derecha: Detalles, RESUMEN y Acciones
  assert.ok(text.includes("Decisiones »"), "Debe mostrar breadcrumb");
  assert.ok(text.includes("RESUMEN"), "Debe mostrar tarjeta RESUMEN");
  assert.ok(text.includes("Qué piden"), "Debe mostrar campo Qué piden");
  assert.ok(text.includes("Quién"), "Debe mostrar campo Quién");
  assert.ok(text.includes("Sugerido"), "Debe mostrar campo Sugerido");
  assert.ok(text.includes("acciones deshabilitadas"), "La demostración no ejecuta acciones");
  assert.ok(text.includes("responder") && text.includes("descartar pregunta"), "Debe mostrar acciones reales");
  assert.ok(!text.includes("Mañana 9:00"), "No debe prometer recordatorios inexistentes");

  // 4. Guía / Ayuda Bienvenido a Central
  assert.ok(text.includes("Bienvenido a Central"), "Debe mostrar bienvenida/guía Central");

  // 5. Barra inferior interactiva: escribile a central
  assert.ok(text.includes("Escribe a Central"), "Debe mostrar el prompt de texto");
  assert.ok(text.includes("/ para escribir"), "Debe mostrar hint / para escribir");

  // 6. Pie de página con atajos
  assert.ok(text.includes("responder") && text.includes("descartar") && text.includes("simulado"), "Debe mostrar atajos del pie");
});

test("DcControlCenterPanel: interacción de acciones [a], [n], [d], [o], modo input [/] y ayuda [?]", () => {
  let doneCalled = false;
  let renderRequested = false;

  const panel = new DcControlCenterPanel(
    dummyTheme,
    () => { doneCalled = true; },
    () => { renderRequested = true; },
  );

  panel.setSimulatedMode(true);
  // Navegación con j / k o flechas
  panel.handleInput("j");
  assert.ok(renderRequested);

  // Activar modo input con '/'
  assert.equal(panel.isInputActive(), false);
  panel.handleInput("/");
  assert.equal(panel.isInputActive(), true);

  // Escribir texto en input
  panel.handleInput("h");
  panel.handleInput("o");
  panel.handleInput("l");
  panel.handleInput("a");
  assert.equal(panel.getInputText(), "hola");

  // Backspace borra un carácter
  panel.handleInput("\x7f");
  assert.equal(panel.getInputText(), "hol");

  // Escape cancela modo input sin cerrar modal
  panel.handleInput("escape");
  assert.equal(panel.isInputActive(), false);
  assert.equal(doneCalled, false);

  // Acciones sobre el item: 'a' (Arreglar)
  const actionResA = panel.handleInput("a");
  assert.equal(actionResA, true);

  // 'd' (Posponer)
  const actionResD = panel.handleInput("d");
  assert.equal(actionResD, true);

  // 'n' (Descartar)
  const actionResN = panel.handleInput("n");
  assert.equal(actionResN, true);

  // '?' conmuta ayuda
  assert.equal(panel.isHelpActive(), false);
  panel.handleInput("?");
  assert.equal(panel.isHelpActive(), true);
  const helpLines = panel.render(100);
  assert.ok(helpLines.join("\n").includes("TECLAS Y ACCIONES"));

  // Escape cierra la ayuda
  panel.handleInput("escape");
  assert.equal(panel.isHelpActive(), false);
  assert.equal(doneCalled, false);

  // 'm' conmuta modo simulado
  const initialSim = panel.isSimulatedMode();
  panel.handleInput("m");
  assert.notEqual(panel.isSimulatedMode(), initialSim);

  // Clicking arbitrary detail content must never execute an action.
  panel.render(100);
  const mouseRes = panel.handleMouse({
    type: "click",
    button: "left",
    x: 45,
    y: 16,
  } as any);
  assert.equal(mouseRes, undefined);
});

