---
name: dc-adversarial-testing
description: "Trigger: adversarial testing, testing adversarial, revision adversarial, property based testing, pbt, fuzzing, fuzzer, invariantes, contraejemplo, red team, auditoria de codigo, robustez. Metodología y arnés nativo de 3 capas para pruebas de robustez extrema: revisión adversarial multi-agente, PBT con shrinking e invariantes matemáticas, y fuzzing mutacional masivo con watchdog anti-hangs."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

# DC Studio - Protocolo de Testing Adversarial y Robustez Extrema

Este protocolo establece el estándar de ingeniería para validar software crítico en DC Studio, eliminando el **sesgo de autor (*confirmation bias*)** mediante tres capas complementarias de verificación:

1. **Revisión Adversarial (Separación de Roles / Multi-agente)**
2. **Property-Based Testing (PBT) con Shrinking Integrado**
3. **Fuzzing Mutacional Masivo con Watchdog Anti-Hangs**

---

## 1. Activación y Reglas Innegociables

### Cuándo Activar
* **Componentes de Alto Riesgo**: Parsers (Markdown, AST, JSON, binarios), serializadores, middleware de sanitización, guards de seguridad, transformaciones de estado y algoritmos matemáticos/criptográficos.
* **Antes de Mergear a `master`/`main`**: En cualquier feature que introduzca lógica compleja de decisión o contratos de datos externos.
* **Al Diseñar Nuevas Suites de Pruebas**: Cuando las pruebas unitarias basadas en ejemplos estáticos (*Example-Based*) no garanticen la ausencia de contraejemplos en los límites.

### Reglas Duras (Hard Rules)
1. **Desacoplamiento Cognitivo**: La entidad que escribe el código nunca debe ser la que valide los escenarios límite. El auditor adversarial opera en un **Fresh Context Loop** sin acceso a las justificaciones o racionalizaciones del autor.
2. **Cero Dependencias Externas**: El arnés utiliza exclusivamente los motores nativos del proyecto (`src/testing/adversarial/`), basados en Mulberry32 y Rose Trees.
3. **Reproducibilidad Absoluta**: Todo fallo en PBT o Fuzzing debe reportar la **semilla seudoaleatoria (`seed`)** y el **contraejemplo mínimo (*shrunk counterexample*)**. Una prueba que falla sin semilla reproducible es un defecto de instrumentación.
4. **Protección del Event Loop**: Todo fuzzing susceptible a expresiones regulares catastróficas (*ReDoS*) o ciclos no acotados debe ejecutarse en el arnés con Worker Thread y Watchdog (`fuzzWithWatchdog`).

---

## 2. Los Tres Enfoques Operativos

### Enfoque 1: Revisión Adversarial Multi-Agente (Red Team)

#### Principio
Aislar el `git diff` y la especificación del contrato, entregándolos a un subagente efímero configurado con una personalidad hostil y escéptica, cuyo único objetivo es encontrar contraejemplos, condiciones de carrera o desbordamientos.

#### Protocolo de Ejecución
Invocar al subagente mediante `dc_ephemeral_agent_run` con la siguiente receta:

```ts
await dc_ephemeral_agent_run({
  role: "dc-adversarial-tester",
  effort: "high",
  mode: "task",
  toolBricks: ["fs-read", "code-search"],
  behaviorBricks: ["adversarial-skeptic", "security-first"],
  seedContext: `
    ## Especificación del Contrato
    [Pegar la especificación formal o S# de ODD]

    ## Diff Bajo Prueba
    [Pegar git diff estricto sin explicaciones del autor]
  `,
  task: `
    Actúa como un atacante y auditor de seguridad de software.
    Tu objetivo es REFUTAR la validez del diff suministrado.
    Analiza:
    1. Entradas nulas, vacías, desbordamientos numéricos y arrays gigantes.
    2. Vectores de inyección (Prototype Pollution, Path Traversal, ReDoS).
    3. Condiciones de carrera, inconsistencias de estado o excepciones no controladas.
    Emite un reporte con:
    - [Vulnerabilidad / Fallo Lógico]
    - [Contraejemplo Concreto]
    - [Nivel de Severidad: Crítico / Alto / Medio]
  `
});
```

---

### Enfoque 2: Property-Based Testing (PBT) con Motor Nativo

#### Principio
En lugar de escribir casos de prueba puntuales (`f(2) === 4`), se definen **invariantes universales** ($\forall x \in \text{Dominio}: P(f(x)) = \text{true}$) y se generan cientos de entradas aleatorias estructuradas. Si se rompe la regla, el motor reduce iterativamente hasta el contraejemplo mínimo (*Shrinking*).

#### Catálogo Canónico de Invariantes
* **Idempotencia**: Aplicar la operación $N$ veces deja el sistema en el mismo estado que aplicarla una vez.
  $$\forall x: f(f(x)) \equiv f(x)$$
* **Reversibilidad / Round-trip**: Serializar y deserializar retorna el objeto original.
  $$\forall x: \text{decode}(\text{encode}(x)) \equiv x$$
* **Conmutatividad**: El orden de los operandos no altera el resultado.
  $$\forall a, b: f(a, b) \equiv f(b, a)$$
* **Conservación de Invariantes Estructurales**: Propiedades que deben conservarse independientemente de la mutación.
  $$\forall xs: \text{longitud}(\text{sort}(xs)) \equiv \text{longitud}(xs)$$
* **Equivalencia de Oráculo**: Una versión optimizada o refactorizada debe producir idéntico resultado que una versión simple de referencia.
  $$\forall x: f_{\text{rapida}}(x) \equiv f_{\text{referencia}}(x)$$

#### Plantilla de Código (Node.js Test Runner)
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { assertProperty, integer, string, array, record } from "../../src/testing/adversarial/index.ts";

test("PBT: Invariante de Idempotencia en formateador", () => {
  assertProperty(
    string({ minLength: 0, maxLength: 100 }),
    (input) => {
      const unaVez = formatearTexto(input);
      const dosVeces = formatearTexto(unaVez);
      assert.equal(dosVeces, unaVez, "La función debe ser idempotente");
    },
    { numRuns: 200 }
  );
});
```

---

### Enfoque 3: Fuzzing Masivo y Watchdog Anti-Hangs

#### Principio
Bombardear las fronteras del sistema (parsers, receptores de APIs, deserializadores) con mutaciones destructivas a nivel de byte y tokens hostiles para detectar excepciones no controladas o congelamientos de CPU.

#### Vectores de Ataque Inyectados por el Fuzzer Nativo
* **Corrupción de memoria/strings**: Bit flips, sobrescritura aleatoria, supresión e inserción de bytes.
* **Prototype Pollution**: `__proto__`, `constructor`, `prototype`.
* **C-Strings & Inyecciones**: Bytes nulos `\0`, escapes ANSI malformados, rutas `../../etc/passwd`.
* **Anomalías IEEE-754**: `NaN`, `Infinity`, `9007199254740992` (MAX_SAFE_INTEGER + 1), `-0`.
* **ReDoS**: Cadenas largas con repeticiones diseñadas para provocar backtracking exponencial.

#### Plantilla de Código
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { fuzzInProcess } from "../../src/testing/adversarial/index.ts";

test("Fuzzing: Parser robusto ante entradas deformadas", () => {
  const crash = fuzzInProcess(
    (buf, str) => {
      // El parser jamás debe lanzar TypeError, unhandledRejection o tumbar el proceso
      parserCritico(str);
    },
    { iterations: 2000, initialCorpus: ["{\"clave\": 123}", ""] }
  );

  assert.equal(crash, null, `El parser crasheó en la iteración ${crash?.iteration}: ${crash?.error}`);
});
```

---

## 3. Matriz de Decisión: Qué Técnica Aplicar

| Tipo de Componente | Enfoque Primario | Enfoque Secundario |
| :--- | :--- | :--- |
| **Parsers / Deserializadores** | Fuzzing Masivo (`fuzzInProcess`) | PBT Round-trip (`decode(encode(x)) === x`) |
| **Guards de Seguridad / Sanitizadores** | Revisión Adversarial (Red Team) | Fuzzing con diccionario hostil |
| **Transformaciones / Reducers de Estado** | PBT (Idempotencia / Conservación) | Revisión Adversarial |
| **Expresiones Regulares Complejas** | Fuzzing con Watchdog (`fuzzWithWatchdog`) | PBT con strings aleatorios |
| **Algoritmos Criptográficos / Hashing** | PBT (Oráculo / Reversibilidad) | Pruebas unitarias de vectores NIST |

---

## 4. Criterios de Aceptación y Reporte

Para considerar una tarea auditada bajo este protocolo:
1. Las suites PBT y Fuzzing deben correr limpias bajo `node --test` con código de salida `0`.
2. Si el auditor adversarial detectó vulnerabilidades, el agente implementador debe corregirlas y presentar una nueva prueba determinista (PBT o Fuzzer) que impida su regresión futura.
3. Se debe cerrar el reporte de auditoría con la línea estricta de riesgo: `Risk: none` o `Risk: item N (razón)`.
