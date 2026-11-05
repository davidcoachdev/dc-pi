# Verificación del DC Super-Agent

Un turno de Pi con `exit 0` solo completa T3. El runner ejecuta después la verificación determinista en el worktree, sin interpretar afirmaciones del LLM. Solo devuelve `ok: true` y completa T4 si los comandos aplicables terminan con código cero.

## Selección de comandos

- Lee `package.json` del worktree después del turno.
- Selecciona pnpm (`pnpm-lock.yaml`), bun (`bun.lock`/`bun.lockb`), yarn (`yarn.lock`) o npm (`package-lock.json`/`npm-shrinkwrap.json`). Sin lockfile usa npm; lockfiles de gestores distintos bloquean por ambigüedad.
- Ejecuta `run typecheck` si está definido y `run test` (o `run test:unit` si no existe `test`). No instala dependencias.
- Rechaza scripts vacíos, el placeholder `no test specified` y scripts que empiezan con `echo`, `true`, `exit` o `:`. Esta comprobación detecta placeholders comunes, no demuestra la calidad de los tests ni analiza arbitrariamente scripts shell.
- Sin comandos aplicables, con manifiesto ilegible, o ante cualquier comando fallido, falla cerrado. Repositorios no Node necesitan revisión humana; no hay adaptadores ni configuración adicional.

T4 conserva comando y exit code; `result.verification.commands` conserva argumentos, stdout, stderr y exit code separados del turno de Pi. `result.exitCode` sigue siendo el de Pi: quien decide la entrega debe comprobar **`result.ok`**, no solo `exitCode`. Si Pi falla no se ejecutan pruebas, T3 falla y T4 permanece pendiente. Cada intento invalida un T4 anterior.

## Configuración efímera preparada

El runner acepta el subconjunto mínimo del plan existente en `preparedAgent`:

```ts
const result = await dcWorkerRunner.executeAutonomousLlmSession({
  worktreePath: task.worktreePath,
  taskSlug: task.taskSlug,
  issueNumber: task.issueNumber,
  issueTitle: task.issueTitle,
  issueBody,
  preparedAgent: plan, // agentFilePath, tools, effectiveEffort, fullModelRef
});
if (!result.ok) {
  // Registrar fallo y terminar SIN llamar a deliverIssue.
}
```

El runner elimina el frontmatter del Markdown generado y pasa solo el cuerpo a `--append-system-prompt`, la lista exacta a `--tools` (o `--no-tools` si está vacía), el esfuerzo a `--thinking` y la referencia completa de Taxi a `--model`. No añade herramientas para satisfacer promesas del prompt. Una definición inválida lanza error y debe entrar en el manejo de fallos del manager.

El daemon-manager pasa el plan preparado completo mediante `preparedAgent` y no entrega cuando `ok` es falso. El resultado fallido de verificación informa el comando y exit code reales (o la razón por la que no hubo verificación), no presenta Pi exit 0 como causa del fallo.

## Historial del Taxi

El manager captura `startedAt` al comenzar el ciclo y `endedAt` al entrar en el cleanup final. Reutiliza `cleanupEphemeralAgent` para liberar el Taxi y registrar el estado: solo `deliveryRes.ok` permite `completed`; un worker fallido, una entrega `{ ok: false }` o una excepción registran `failed` con el error observado. El cleanup se invoca una vez por plan preparado. El aviso de bloqueo no promete reintentos: continuar es una acción manual.

## Pruebas enfocadas

Las pruebas ejercitan `executeAutonomousLlmSession` con ejecución de comandos sustituida, sin Pi real ni publicación. El test público del manager usa receptor/dispatcher reales con Git temporal y sustituye worker/entrega/cleanup; comprueba plan transmitido, duración con reloj controlado, fallos y un único lanzamiento ante deliveries duplicadas. Requiere pasar `--experimental-test-module-mocks` directamente a `node`: Node rechaza este flag en `NODE_OPTIONS`. Desde un checkout desechable con HOME/XDG/PI aislados, compilar y ejecutar:

```sh
npm run build
node --experimental-test-module-mocks --test --test-force-exit .test-build/test/dc-super-agent-daemon.test.js .test-build/test/dc-super-agent-execution.test.js
```

Los tests de comandos directos siguen usando Node real. Cada archivo aísla HOME/XDG/PI antes de importar los singletons y cierra su base de colaboradores al finalizar. Usar un checkout desechable exclusivo por worker para no compartir la salida `.test-build/`.
