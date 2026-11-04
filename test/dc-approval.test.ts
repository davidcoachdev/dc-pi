import test from "node:test";
import assert from "node:assert/strict";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { DcApprovalCoordinator } from "../src/features/dc-approval/core/dc-approval-coordinator.ts";
import { DcApprovalPanel } from "../src/features/dc-approval/views/dc-approval-modal.ts";
import type { ApprovalOutcome } from "../src/features/dc-approval/core/dc-approval-types.ts";

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

