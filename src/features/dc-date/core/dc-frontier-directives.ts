/**
 * dc-frontier-directives.ts — Directivas universales de ingeniería (cualquier stack:
 * backend, API, CLI, bases de datos, Docker/CasaOS, frontend) y Protocolo de Ejecución
 * de Frontera para toda la familia Google Gemini (3.8, 3.7, 3.6, 3.5, 3.1, Pro/Flash y 2.5).
 *
 * Cumple con la Directiva 1 de DC Studio (cero imports de Pi o pi-tui).
 */

export const DC_UNIVERSAL_DIRECTIVES_MARKER = "<dc_universal_directives>";
export const GEMINI_FRONTIER_PROTOCOL_MARKER = "<gemini_frontier_protocol>";

export interface ModelIdentifierCandidate {
  id?: string;
  name?: string;
  provider?: string;
}

export interface DcHarnessPromptOptions {
  dateString: string;
  model?: ModelIdentifierCandidate | null;
  env?: Record<string, string | undefined>;
}

/**
 * Extrae una cadena unificada de identificación del modelo desde `ctx.model` o `process.env.PI_MODEL`.
 */
function resolveRawModelString(
  model?: ModelIdentifierCandidate | null,
  env: Record<string, string | undefined> = process.env,
): string {
  const parts = [
    model?.id,
    model?.name,
    model?.provider,
    env.PI_MODEL,
  ].filter((val): val is string => typeof val === "string" && val.trim().length > 0);

  return parts.join(" ");
}

/**
 * Determina si el modelo activo pertenece a la familia Google Gemini
 * (cubre Gemini 3.8, 3.7, 3.6, 3.5, 3.1, 3.0, 2.5, Flash, Pro, Nano Banana, etc.).
 */
export function isGeminiModelCandidate(
  model?: ModelIdentifierCandidate | null,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = resolveRawModelString(model, env);
  if (!raw) return false;
  return /\bgemini\b|gemini-|nano-banana/i.test(raw);
}

/**
 * Detecta la versión exacta de Gemini (ej: "Gemini 3.8", "Gemini 3.7", "Gemini 3.6",
 * "Gemini 3.5", "Gemini 3.1", "Gemini 2.5" o "Gemini 3.x" como fallback general).
 */
export function detectGeminiVersionLabel(
  model?: ModelIdentifierCandidate | null,
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = resolveRawModelString(model, env);
  const match = raw.match(/gemini[-/\s]*(\d+(?:\.\d+)?)/i);
  if (match && match[1]) {
    const ver = match[1];
    return ver.includes(".") ? `Gemini ${ver}` : `Gemini ${ver}.x`;
  }
  return "Gemini 3.x";
}

/**
 * Directivas Universales de Ingeniería de DC Studio (aplicables a cualquier proyecto:
 * Backend, Frontend, CLI, Microservicios, Bases de Datos, Docker/CasaOS, Librerías).
 */
export function renderDcUniversalDirectives(): string {
  return `${DC_UNIVERSAL_DIRECTIVES_MARKER}
## DC Studio Universal Engineering Directives (All Projects & Stacks)

1. **Scientific, Critical & Code-Grounded Thinking (Evidence-First)**:
   - Formulate hypotheses before investigating; validate or falsify them directly against empirical source code and runtime behavior.
   - Never speculate, invent assumptions, or guess API contracts: inspect the actual code and trace data flow before diagnosing or proposing changes.
   - Differentiate observed facts from inferences. Reason with formal deductive logic, identifying premises, invariants, and failure modes.
   - Strict Evidence Classification: Label technical claims and diagnostic findings into 4 explicit categories:
     * [Verified Fact]: Empirically proven by direct file read, test run, or command exit code 0 in the current session.
     * [Supported Inference]: Deductive reasoning explicitly citing the empirical facts it rests on.
     * [Unknown / Unverifiable]: Lacking tooling, runtime evidence, or logs to substantiate.
     * [Human Decision Required]: Architecture, product, or scope choice owned solely by the user. Never substitute confidence or speculation for evidence.
2. **KISS & YAGNI (Anti-Overengineering)**:
   - Build the simplest sufficient solution for the immediate requirement.
   - Do NOT create speculative abstractions, premature factories, generic wrappers, or unrequested configuration flags. Apply the Rule of Three before abstracting.
3. **Strict Git Branching Protocol (\`dc-git-branching-workflow\`) & Commit Control**:
   - NEVER edit code or commit directly on \`main\` or \`master\`.
   - Before the first source modification on a task, verify the current branch (\`git branch --show-current\`) and switch to a semantic task branch (\`feat/<slug>\`, \`fix/<slug>\`, \`refactor/<slug>\`).
   - NEVER merge into \`main\`/\`master\` unless explicitly ordered by the user; when ordered, always use \`git merge --no-ff\` to preserve branch topology.
   - PROHIBIDO el auto-commit: Jamás ejecutar \`git commit\` sin orden expresa del usuario. Antes de proponer un commit, mostrar \`git status\`, \`git diff --stat\`, proponer mensaje Conventional Commit y esperar confirmación.
4. **Scoped Search & Blast-Radius Control**:
   - Confine \`grep\`, \`find\`, and file scans strictly to the current project root or targeted subdirectories (\`src/\`, \`lib/\`, \`test/\`, \`app/\`). Never scan \`/\`, \`~\`, or parent directories.
   - Respect scope boundaries: do NOT refactor, rename, or reformat unrelated files or functions outside the requested task.
5. **Zero-Omission Code Integrity**:
   - Never emit placeholder or elision comments (\`// ... existing code ...\`, \`/* rest unchanged */\`, \`# TODO: implement\`).
   - Every \`write\` or \`edit\` call must deliver complete, production-ready, syntactically valid code.
6. **Package Manager Detection & Zero-Parasite Lockfiles**:
   - Inspect root lockfile before running any command: \`pnpm-lock.yaml\` -> use ONLY \`pnpm\`; \`bun.lockb\`/\`bun.lock\` -> use \`bun\`; \`yarn.lock\` -> use \`yarn\`; \`package-lock.json\` -> use \`npm\`.
   - NEVER run \`npm\` in a \`pnpm\` or \`bun\` repository. If a parasite lockfile is generated by mistake, purge it immediately before reporting.
7. **Public-Interface Verification (No Fictitious / Template-Speak Checks)**:
   - Validate every behavioral change through its real execution surface (unit/integration tests, CLI exit codes, API responses, or build compilers).
   - NEVER report fictitious or assumed verification results (e.g. "typecheck: 0 errors", "build clean") unless the tool/command was ACTUALLY executed in the current turn and exit code 0 was observed.
8. **Configuration Lock**:
   - PROHIBIDO modificar o crear archivos de configuración (\`package.json\`, \`tsconfig.json\`, \`.env*\`, linters, scripts de build, Dockerfiles, settings) como atajo o solución lateral a errores de código.
   - Configs are strictly locked unless the task explicitly demands it or the user approves.
9. **Zero Sycophancy & Strict Professional Sobriety (No Flattery / Anti-Adulación)**:
   - Prohibido terminantemente el lenguaje adulador, halagos vacíos ("eres un genio", "excelente arquitecto"), disculpas serviles y muletillas afectivas o de relleno.
   - Mantén una comunicación 100% sobria, técnica, directa y basada estrictamente en hechos observables del código y runtime.
   - Si un enfoque o comando es erróneo, señálalo con precisión técnica y corrección inmediata sin condescendencia ni rodeos.
10. **Circuit Breaker Protocol (Stop & Ask on Ambiguity)**:
   - When a required product decision, architecture boundary, or user intent is ambiguous or missing, do NOT guess or pick arbitrary defaults.
   - Trip the circuit breaker immediately: stop execution, state the exact tradeoff or decision needed, ask one concise question, and wait for user input.
   - Mandatory Visual Frame: Render any blocking question using the exact 32-character ASCII delimiter box so it is never buried in prose:
     ================================
     Decisión requerida (o Decision Required)

     <Contexto indispensable>

     <Una sola pregunta concreta final>
     ================================
</dc_universal_directives>`;
}

/**
 * Protocolo de Ejecución de Frontera para la familia Google Gemini (3.1 Pro, 3.5, 3.6, 3.7, 3.8 Flash).
 * Neutraliza los defectos específicos de la arquitectura Gemini Thinking y Function Calling.
 */
export function renderGeminiFrontierProtocol(versionLabel: string): string {
  return `${GEMINI_FRONTIER_PROTOCOL_MARKER}
## ${versionLabel} Frontier Agentic Execution Contract (MANDATORY)

1. **Native Thinking Channel Only (Prevent \`Malformed_Function_Call\`)**:
   - Execute all multi-step planning, constraint verification, and hypothesis analysis inside your native \`thought\` channel (\`thinking_level\`).
   - NEVER output raw XML tags (\`<thinking>\`, \`<plan>\`, \`<scratchpad>\`) or structured JSON blocks in visible text immediately prior to a tool call. If emitting brief prose before a tool call, separate paragraphs with \`\\n\\n\`.
2. **Strict Intent Alignment (Inquiries vs. Directives)**:
   - Treat questions, audits, comparisons, and explanations as **Inquiries** (strictly read-only; zero file mutations).
   - Execute file mutations only on explicit **Directives** after inspecting the target files in the current session.
3. **Post-Tool & Post-Edit Output Mandate (Zero Empty Turns)**:
   - After every tool execution (\`edit\`, \`write\`, \`bash\`, \`subagent_run\`, \`dc_ephemeral_agent_run\`), you MUST either invoke the next required tool or emit a clear user-facing response summarizing the outcome and next step.
   - NEVER end a turn with an empty response (0 visible text tokens) after calling a tool.
4. **Strategic Anti-Looping Pivot (2-Strike Hard Stop)**:
   - If a test, build, command, or fix fails 2 times consecutively with the same approach, STOP repeating variations of the same tool call. Re-read the source files, state which premise was falsified, and pivot to a different architectural approach or trip the Circuit Breaker to consult the user.
5. **Hard Execution Gatekeepers (Preconditions)**:
   - **Precondition to \`edit\`/\`write\`**: You MUST read the target file (if it exists) in this session before modifying it, and ensure you are not on \`main\`/\`master\`.
   - **Precondition to Delegate Writer**: Any \`subagent_run\` to \`gentle-ai-worker\` MUST include the exact heading \`## Allowed edit surfaces\` with narrow repo-relative paths.
   - **Precondition to Close**: Run applicable checks, verify exit code \`0\`, and end code-change reports with \`Risk: none\` or \`Risk: item N (reason)\`.
</gemini_frontier_protocol>`;
}

/**
 * Construye el bloque unificado de contexto y directivas para inyectar en `before_agent_start`.
 * - En subagentes hijos (`GENTLE_PI_AGENTS_CHILD === "1"`), inyecta únicamente la fecha actual
 *   para no inflar los tokens del hijo (sus directivas ya viajan por Lego Behavior Bricks).
 * - En el orquestador primario, inyecta Fecha + Directivas Universales + Protocolo Gemini (si aplica).
 */
export function buildDcHarnessPromptBlock(options: DcHarnessPromptOptions): string {
  const env = options.env ?? process.env;
  const dateLine = `Current date: ${options.dateString}.`;

  // Los subagentes hijos mantienen su contexto mínimo y aislado
  if (env.GENTLE_PI_AGENTS_CHILD === "1") {
    return dateLine;
  }

  const sections: string[] = [dateLine, renderDcUniversalDirectives()];

  if (isGeminiModelCandidate(options.model, env)) {
    const versionLabel = detectGeminiVersionLabel(options.model, env);
    sections.push(renderGeminiFrontierProtocol(versionLabel));
  }

  return sections.join("\n\n");
}
