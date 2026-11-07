/**
 * test/dc-ice.test.ts — Test suite for IDSD Intent, Context & Expectations (ICE) Gate in DC Studio.
 * Based on Kapil Viren Ahuja's ICE framework & Google SDLC agentic verification.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateIceIntent,
  type IceIntent,
  type IceValidationResult,
} from "../src/features/dc-ice/index.ts";

test("dc-ice: valida exitosamente un Intent canónico bien formado (ejemplo Ahuja)", () => {
  const validIntent: IceIntent = {
    goal: "Build a microservice that handles the user-facing product catalog.",
    constraints: [
      "Support 1,000 concurrent monthly active users at peak.",
      "p99 latency under 200 milliseconds on read endpoints.",
      "99.99% uptime against the published SLO.",
      "WCAG 2.1 AA on any user-facing surface this service exposes.",
      "OWASP ASVS Level 2 on every endpoint.",
    ],
    failureConditions: [
      "Build fails.",
      "Unit test coverage drops below 90%.",
      "Lint reports any errors.",
      "Sonar quality gate fails on coverage, duplication, or security hotspots.",
      "A secret appears in the source.",
      "API contract changes without a version bump.",
    ],
    manualBrake: {
      whoNeedsThis: "End-users browsing catalog and our mobile frontend team; without it users cannot search or purchase.",
      costIfOneWeekDevs: true,
      refusalOwner: "Lead Architect / Product Owner",
    },
  };

  const result: IceValidationResult = validateIceIntent(validIntent);
  assert.equal(result.valid, true, "El intent canónico debe ser válido");
  assert.equal(result.errors.length, 0, "No debe tener errores");
  assert.ok(result.intent, "Debe retornar el intent normalizado");
});

test("dc-ice: rechaza Goal con conjunciones copulativas ('and', 'y') que unen múltiples objetivos", () => {
  const invalidIntent = {
    goal: "Build a microservice that handles the catalog and cart checkout funnel.",
    constraints: [
      "p99 latency under 200ms.",
      "99.9% uptime against SLO.",
      "Support 500 concurrent users.",
    ],
    failureConditions: [
      "Build fails.",
      "Unit tests fail.",
      "Lint reports errors.",
    ],
    manualBrake: {
      whoNeedsThis: "E-commerce shoppers.",
      costIfOneWeekDevs: true,
      refusalOwner: "Tech Lead",
    },
  };

  const result = validateIceIntent(invalidIntent);
  assert.equal(result.valid, false, "Debe rechazar objetivos con 'and' que unen múltiples metas");
  assert.ok(
    result.errors.some((e) => e.includes("conjunción") || e.includes("and") || e.includes("atómico")),
    `Error esperado sobre conjunción, recibido: ${result.errors.join(", ")}`,
  );
});

test("dc-ice: rechaza Goal que viola el test de 2 implementaciones fijando tecnología o arquitectura interna", () => {
  const invalidIntent = {
    goal: "Build a Go microservice using gRPC with PostgreSQL and Redis behind Envoy sidecar.",
    constraints: [
      "p99 latency under 200ms.",
      "99.9% uptime against SLO.",
      "Support 500 concurrent users.",
    ],
    failureConditions: [
      "Build fails.",
      "Unit tests fail.",
      "Lint reports errors.",
    ],
    manualBrake: {
      whoNeedsThis: "Backend team.",
      costIfOneWeekDevs: true,
      refusalOwner: "Tech Lead",
    },
  };

  const result = validateIceIntent(invalidIntent);
  assert.equal(result.valid, false, "Debe rechazar fijar stacks concretos en el Goal (violación del test de 2 implementaciones)");
  assert.ok(
    result.errors.some((e) => e.includes("Context") || e.includes("implementación") || e.includes("tecnología")),
    `Error esperado sobre tecnología en Goal, recibido: ${result.errors.join(", ")}`,
  );
});

test("dc-ice: rechaza Intent con menos de 3 constraints o con exceso de sobre-especificación (> 7)", () => {
  const tooFew = {
    goal: "Expose healthcheck endpoint.",
    constraints: ["p99 under 50ms."],
    failureConditions: ["Build fails.", "Tests fail.", "Lint errors."],
    manualBrake: {
      whoNeedsThis: "Ops monitoring.",
      costIfOneWeekDevs: true,
      refusalOwner: "SRE Lead",
    },
  };

  const resultFew = validateIceIntent(tooFew);
  assert.equal(resultFew.valid, false);
  assert.ok(resultFew.errors.some((e) => e.includes("3 a 5") || e.includes("al menos 3")));

  const tooMany = {
    goal: "Expose healthcheck endpoint.",
    constraints: [
      "Constraint 1",
      "Constraint 2",
      "Constraint 3",
      "Constraint 4",
      "Constraint 5",
      "Constraint 6",
      "Constraint 7",
      "Constraint 8",
    ],
    failureConditions: ["Build fails.", "Tests fail.", "Lint errors."],
    manualBrake: {
      whoNeedsThis: "Ops monitoring.",
      costIfOneWeekDevs: true,
      refusalOwner: "SRE Lead",
    },
  };

  const resultMany = validateIceIntent(tooMany);
  assert.equal(resultMany.valid, false);
  assert.ok(resultMany.errors.some((e) => /máximo 7|sobre-especificación/i.test(e)));
});

test("dc-ice: detecta inversión de roles (Failure Condition colada como Constraint)", () => {
  const invertedIntent = {
    goal: "Create invoice export service.",
    constraints: [
      "Support PDF format.",
      "Unit test coverage must stay above 90%.", // Esta es una Failure Condition post-output
      "Export finishes in under 2 seconds.",
    ],
    failureConditions: [
      "Build fails.",
      "Secrets in code.",
      "Lint fails.",
    ],
    manualBrake: {
      whoNeedsThis: "Finance team.",
      costIfOneWeekDevs: true,
      refusalOwner: "Head of Finance",
    },
  };

  const result = validateIceIntent(invertedIntent);
  assert.ok(
    result.warnings.some((w) => w.includes("Failure Condition") || w.includes("coverage") || w.includes("eval")),
    "Debe advertir que el coverage pertenece a Failure Conditions, no a Constraints",
  );
});

test("dc-ice: rechaza Freno Manual inválido (sin dueño de negativa o sin justificación de necesidad)", () => {
  const noOwner = {
    goal: "Build customer notifications stream.",
    constraints: [
      "Deliver in under 1 second.",
      "At-least-once delivery guarantee.",
      "Encrypted in transit with TLS 1.3.",
    ],
    failureConditions: [
      "Build fails.",
      "Unit tests fail.",
      "Unencrypted payloads found.",
    ],
    manualBrake: {
      whoNeedsThis: "Nobody in particular, just experimenting.",
      costIfOneWeekDevs: false,
      refusalOwner: "", // Vacío
    },
  };

  const result = validateIceIntent(noOwner);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("dueño") || e.includes("refusalOwner")));
  assert.ok(result.errors.some((e) => e.includes("whoNeedsThis") || e.includes("experimento")));
});

test("dc-ice: herramienta dc_ice_validate ejecuta validación y retorna estructura Markdown", async () => {
  const tools: Record<string, any> = {};
  const mockPi: any = {
    registerTool: (t: any) => {
      tools[t.name] = t;
    },
  };

  const { registerDcIceTools } = await import("../src/features/dc-ice/tools/dc-ice-tools.ts");
  registerDcIceTools(mockPi);

  assert.ok(tools.dc_ice_validate, "Debe registrar dc_ice_validate");

  // Valid intent execution
  const resValid = await tools.dc_ice_validate.execute("id1", {
    intent: {
      goal: "Expose product reviews endpoint.",
      constraints: ["p99 latency under 100ms.", "99.9% uptime SLO.", "WCAG 2.1 AA accessible."],
      failureConditions: ["Build fails.", "Coverage drops below 90%.", "Secrets found."],
      manualBrake: {
        whoNeedsThis: "Mobile shoppers wanting user feedback.",
        costIfOneWeekDevs: true,
        refusalOwner: "Catalog Lead",
      },
    },
  });

  assert.equal(resValid.isError, false);
  assert.ok(resValid.content[0].text.includes("APROBADO"));

  // Invalid intent execution
  const resInvalid = await tools.dc_ice_validate.execute("id2", {
    intent: {
      goal: "Do everything and something else.",
      constraints: ["Only one constraint"],
      failureConditions: ["Build fails"],
      manualBrake: {
        whoNeedsThis: "nobody",
        costIfOneWeekDevs: false,
        refusalOwner: "",
      },
    },
  });

  assert.equal(resInvalid.isError, true);
  assert.ok(resInvalid.content[0].text.includes("RECHAZADO"));
});

test("dc-ice: dcIceExtension registra comando /dc-ice y herramienta dc_ice_validate", async () => {
  const commands: Record<string, any> = {};
  const tools: Record<string, any> = {};
  const mockPi: any = {
    registerCommand: (name: string, c: any) => {
      commands[name] = c;
    },
    registerTool: (t: any) => {
      tools[t.name] = t;
    },
  };

  const { dcIceExtension } = await import("../src/features/dc-ice/dc-ice-extension.ts");
  dcIceExtension(mockPi);

  assert.ok(commands["dc-ice"], "Debe registrar comando dc-ice");
  assert.ok(tools.dc_ice_validate, "Debe registrar herramienta dc_ice_validate");
});

