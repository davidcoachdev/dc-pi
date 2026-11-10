import test from "node:test";
import assert from "node:assert/strict";
import {
  PRNG,
  integer,
  boolean,
  string,
  array,
  record,
  check,
  assertProperty,
  FuzzMutator,
  fuzzInProcess,
  fuzzWithWatchdog
} from "../src/testing/adversarial/index.ts";

test("Adversarial Testing Engine: PRNG Mulberry32 determinism", () => {
  const seed = 123456789;
  const rng1 = new PRNG(seed);
  const rng2 = new PRNG(seed);

  const seq1 = [rng1.nextUint32(), rng1.nextInt(1, 100), rng1.nextFloat(), rng1.boolean()];
  const seq2 = [rng2.nextUint32(), rng2.nextInt(1, 100), rng2.nextFloat(), rng2.boolean()];

  assert.deepEqual(seq1, seq2, "Misma semilla debe producir exactamente la misma secuencia seudoaleatoria");
});

test("PBT: Invariante de conmutatividad matemática pasa limpiamente", () => {
  assertProperty(
    record({
      a: integer(-1000, 1000),
      b: integer(-1000, 1000)
    }),
    ({ a, b }) => {
      assert.equal(a + b, b + a, "Suma debe ser conmutativa");
    },
    { numRuns: 100 }
  );
});

test("PBT: Invariante de idempotencia en sanitización de strings", () => {
  function sanitize(str: string): string {
    return str.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  }

  assertProperty(
    string({ minLength: 0, maxLength: 30 }),
    (val) => {
      const run1 = sanitize(val);
      const run2 = sanitize(run1);
      assert.equal(run2, run1, "La sanitización debe ser estrictamente idempotente");
    },
    { numRuns: 100 }
  );
});

test("PBT Shrinking: Reduce un fallo a su contraejemplo atómico mínimo", () => {
  // Invariante intencionalmente falsa: afirmamos que ningún número es >= 42
  const result = check(
    integer(0, 1000),
    (n) => n < 42,
    { numRuns: 100, seed: 9999 }
  );

  assert.equal(result.ok, false, "Debe detectar la violación de la propiedad");
  if (!result.ok) {
    // Gracias al algoritmo de bisección hacia 0, el menor entero >= 42 es exactamente 42
    assert.equal(result.counterexample, 42, `El contraejemplo mínimo debe ser 42, recibido: ${result.counterexample}`);
    assert.ok(result.shrinkSteps > 0, "Debe haber aplicado pasos de reducción");
  }
});

test("PBT Shrinking: Reduce un array con condición a longitud mínima", () => {
  // Falla si el array tiene 3 o más elementos y contiene un número negativo
  const result = check(
    array(integer(-100, 100), { minLength: 0, maxLength: 20 }),
    (arr) => {
      const hasNegative = arr.some(n => n < 0);
      if (arr.length >= 3 && hasNegative) {
        return false;
      }
      return true;
    },
    { numRuns: 200, seed: 4242 }
  );

  assert.equal(result.ok, false, "Debe encontrar el caso que viola la propiedad");
  if (!result.ok) {
    assert.equal(result.counterexample.length, 3, "El shrinking debe reducir la longitud del array al mínimo (3)");
    assert.ok(result.counterexample.some(n => n < 0), "Debe contener el elemento negativo desencadenante");
  }
});

test("Fuzzing: FuzzMutator aplica operadores Havoc y diccionario hostil", () => {
  const rng = new PRNG(8888);
  const mutator = new FuzzMutator();
  const original = Buffer.from("test_payload_12345");

  const mutated = mutator.mutate(original, rng, 4);
  assert.notDeepEqual(mutated, original, "La mutación debe alterar el buffer");

  const strMutated = mutator.mutateString("sample_string", rng);
  assert.ok(typeof strMutated === "string", "mutateString debe retornar una cadena válida");
});

test("Fuzzing In-Process: Tolera entradas masivas deformadas sin crashear en parser seguro", () => {
  function safeParser(data: Buffer, str: string) {
    // Parser seguro: no debe explotar con tipos de datos inválidos
    try {
      JSON.parse(str);
    } catch {
      // Manejado correctamente
    }
  }

  const crash = fuzzInProcess(safeParser, {
    iterations: 300,
    seed: 5555,
    initialCorpus: ['{"key": "value"}', '{"items": [1,2,3]}']
  });

  assert.equal(crash, null, "Un parser protegido no debe generar crashes no controlados");
});

test("Fuzzing In-Process: Detecta y aísla excepciones no controladas", () => {
  function buggyParser(data: Buffer, str: string) {
    if (str.includes("__proto__")) {
      throw new TypeError("Vulnerabilidad de Prototype Pollution disparada");
    }
  }

  const crash = fuzzInProcess(buggyParser, {
    iterations: 500,
    seed: 7777,
    initialCorpus: ["init"]
  });

  assert.ok(crash !== null, "Debe atrapar el crash");
  if (crash) {
    assert.equal(crash.type, "CRASH_EXCEPTION");
    assert.ok(crash.error?.includes("Prototype Pollution"), "Debe capturar el error exacto");
  }
});

test("Fuzzing Watchdog: Detecta bucle infinito o ReDoS en Worker Thread sin congelar el test runner", async () => {
  // Script que simula un ReDoS / ciclo infinito cuando detecta una palabra clave
  const infiniteLoopScript = `
    function targetFn(buf, str) {
      if (str.includes("loop")) {
        while (true) {} // Congelamiento forzado de V8
      }
    }
  `;

  const crash = await fuzzWithWatchdog(infiniteLoopScript, {
    iterations: 20,
    timeoutMs: 150,
    initialCorpus: ["loop_seed"]
  });

  assert.ok(crash !== null, "El Watchdog debe interceptar el congelamiento");
  if (crash) {
    assert.equal(crash.type, "CPU_HANG_TIMEOUT");
    assert.ok(crash.error?.includes("Watchdog triggered"), "Debe reportar que el Watchdog terminó el worker");
  }
});
