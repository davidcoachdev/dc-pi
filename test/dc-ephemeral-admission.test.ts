import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleLegoAgentPlan,
  validateBoundedWriterAdmission,
  prepareEphemeralAgent,
  cleanupEphemeralAgent,
  deriveSemanticSubagentName,
} from "../src/features/dc-agents/core/dc-ephemeral-manager.ts";
import {
  calibrateEffortForTask,
} from "../src/features/dc-agents/core/dc-effort-policy.ts";
import {
  DC_AGENT_ARCHETYPES,
  DC_ARCHETYPE_ALIASES,
  DC_BEHAVIOR_BRICKS,
} from "../src/features/dc-agents/core/dc-ephemeral-types.ts";

test("Bounded Writer Admission: rechaza subagentes de escritura sin '## Allowed edit surfaces'", () => {
  // 1. Tarea de escritura sin encabezado debe fallar
  const result = validateBoundedWriterAdmission(
    "Modifica src/auth.ts para agregar validación de JWT",
    undefined,
    ["read", "edit", "write"],
  );

  assert.equal(result.valid, false);
  assert.ok(result.reason?.includes("## Allowed edit surfaces"));
  assert.ok(result.reason?.includes("Error de Admisión de Worker"));

  // 2. Tarea de solo lectura no debe ser bloqueada aunque no tenga el encabezado
  const readOnlyResult = validateBoundedWriterAdmission(
    "Inspecciona el código de autenticación",
    undefined,
    ["read", "dc_codegraph_node"],
  );

  assert.equal(readOnlyResult.valid, true);

  // 3. Encabezado presente pero vacío debe fallar
  const emptySurfacesResult = validateBoundedWriterAdmission(
    "Corrige bug\n\n## Allowed edit surfaces\n\n## Siguiente Seccion\nTexto",
    undefined,
    ["edit"],
  );

  assert.equal(emptySurfacesResult.valid, false);
  assert.ok(emptySurfacesResult.reason?.includes("vacía"));

  // 4. Encabezado con rutas válidas debe ser aceptado y parsear las superficies
  const validResult = validateBoundedWriterAdmission(
    "Corrige bug en auth\n\n## Allowed edit surfaces\nsrc/auth/jwt.ts\n`src/auth/types.ts`\n- src/auth/utils.ts\n\n## Plan",
    undefined,
    ["write", "edit", "bash"],
  );

  assert.equal(validResult.valid, true);
  assert.deepEqual(validResult.surfaces, [
    "src/auth/jwt.ts",
    "src/auth/types.ts",
    "src/auth/utils.ts",
  ]);

  // 5. Bypass explícito [mock-unbounded]
  const bypassResult = validateBoundedWriterAdmission(
    "Test mock [mock-unbounded]",
    undefined,
    ["edit"],
  );
  assert.equal(bypassResult.valid, true);
  assert.deepEqual(bypassResult.surfaces, ["*"]);
});

test("Bounded Writer Admission: prepareEphemeralAgent lanza excepción si falta la delimitación", () => {
  assert.throws(
    () => {
      prepareEphemeralAgent(
        {
          task: "Reescribe el handler HTTP",
          toolPreset: "worker",
        },
        {
          sessionId: "test-sess-fail-admission",
          pid: process.pid,
        },
      );
    },
    (err: any) => {
      return (
        err instanceof Error &&
        err.message.includes("Allowed edit surfaces")
      );
    },
  );
});

test("Blindaje del Verificador: calibrateEffortForTask fuerza 'high' y bloquea esfuerzo bajo o nulo", () => {
  // 1. Preset verifier con effort explícito 'low' debe ser elevado a 'high'
  const effort1 = calibrateEffortForTask(
    "Ejecuta suite de pruebas",
    "verifier",
    "low",
  );
  assert.equal(effort1, "high");

  // 2. Preset verifier con effort 'off' debe ser elevado a 'high'
  const effort2 = calibrateEffortForTask(
    "Verifica tests de integración",
    "verifier",
    "off",
  );
  assert.equal(effort2, "high");

  // 3. Tarea con palabras clave de verificación independiente y effort 'low' debe elevarse a 'high'
  const effort3 = calibrateEffortForTask(
    "Auditoría y verificación independiente de tests",
    undefined,
    "low",
  );
  assert.equal(effort3, "high");

  // 4. Tarea ordinaria no verificadora con effort 'low' se respeta como 'low'
  const effort4 = calibrateEffortForTask(
    "Descarga audio de YouTube",
    "youtube",
    "low",
  );
  assert.equal(effort4, "low");
});

test("Review Lenses (4R Specialization): los 4 arquetipos de lentes están registrados con sus directivas", () => {
  const expectedLenses = [
    "dc-lens-risk",
    "dc-lens-resilience",
    "dc-lens-readability",
    "dc-lens-reliability",
  ] as const;

  for (const lens of expectedLenses) {
    const def = DC_AGENT_ARCHETYPES[lens];
    assert.ok(def, `Arquetipo ${lens} debe estar definido en DC_AGENT_ARCHETYPES`);
    assert.equal(def.name, lens);
    assert.ok(def.behaviorBricks.includes("read-only-analyst"));
    assert.ok(def.behaviorBricks.includes("artifact-contract"));
    assert.ok(def.behaviorBricks.includes("non-empty-response"));
    assert.ok(!def.toolBricks.includes("fs-write" as any), `${lens} debe ser de solo lectura sin herramientas de escritura`);
  }

  // Comprobar alias con prefijo dc-
  assert.equal(DC_ARCHETYPE_ALIASES["dc-lens-risk"], "dc-lens-risk");
  assert.equal(DC_ARCHETYPE_ALIASES["dc-lens-resilience"], "dc-lens-resilience");
  assert.equal(DC_ARCHETYPE_ALIASES["dc-lens-readability"], "dc-lens-readability");
  assert.equal(DC_ARCHETYPE_ALIASES["dc-lens-reliability"], "dc-lens-reliability");

  // Comprobar ensamblaje de plan con arquetipo dc-lens-risk
  const plan = assembleLegoAgentPlan({
    task: "Auditar persistencia y migraciones",
    archetype: "dc-lens-risk",
  });

  assert.equal(plan.archetype, "dc-lens-risk");
  assert.equal(plan.defaultEffort, "high");
  assert.ok(plan.tools.includes("read"));
  assert.ok(plan.tools.includes("dc_owasp_query"));
  assert.ok(!plan.tools.includes("edit"));

  // Comprobar derivación semántica de nombre
  const agentName = deriveSemanticSubagentName({
    task: "Auditar riesgo",
    archetype: "dc-lens-risk",
  });
  assert.ok(agentName.startsWith("dc-sub-lens-"));
});

test("Behavior Brick 'clean-sandbox': registrado en DC_BEHAVIOR_BRICKS", () => {
  assert.ok(DC_BEHAVIOR_BRICKS["clean-sandbox"]);
  assert.ok(DC_BEHAVIOR_BRICKS["clean-sandbox"].includes("mktemp -d"));
  assert.ok(DC_BEHAVIOR_BRICKS["clean-sandbox"].includes("invariantes"));
});
