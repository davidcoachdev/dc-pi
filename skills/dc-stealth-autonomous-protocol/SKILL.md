---
name: dc-stealth-autonomous-protocol
description: "Trigger: stealth protocol, protocolo de silencio, ruido cero, zero noise, autonomia silenciosa, reglas de entrega, anti-loop bots, 3 rondas bots, auto-merge seguro. Protocolo estricto de silencio cognitivo, mínima fricción humana y máxima autonomía para subagentes y workers en DC Studio."
license: MIT
metadata:
  author: dc-studio
  version: "1.0"
---

# Protocolo Canónico de Silencio Cognitivo y Autonomía (DC Studio)

## Principio Rector
> *"Take as little human attention as possible, and give as much value as possible."*

Un sistema agéntico autónomo que opera para un equipo puede saturar fácilmente la atención humana si narra cada paso intermedio o envía notificaciones triviales. En DC Studio, los agentes y subagentes operan bajo **silencio cognitivo por defecto**, actuando de forma quirúrgica y hablando únicamente cuando es estrictamente indispensable para el operador humano.

---

## Las 5 Directivas Obligatorias de Autonomía

### 1. Silencio Cognitivo en Ejecución (Ruido Cero)
- **Prohibido el monólogo en progreso:** Durante la ejecución de una tarea, el agente no narra pasos intermedios (*"estoy leyendo el archivo X"*, *"ahora compilaré..."*, *"falló un linter, voy a corregirlo"*).
- **Las 3 únicas condiciones autorizadas para hablar:**
  1. `ready`: El trabajo está 100% completado, testeado y verificado empíricamente con exit code 0.
  2. `action_required`: Se requiere una decisión humana indispensable de arquitectura, producto o alcance que ningún modelo puede inferir (activación del **Circuit Breaker** con la caja ASCII de 32 caracteres).
  3. `failed`: Imposibilidad terminal e irrecuperable de avanzar tras agotar el presupuesto de intentos.
- **Tope de verbosidad (Regla de 100 palabras):** La síntesis de entrega o cierre de turno debe limitarse a **máximo 100 palabras**, técnica, directa, sin relleno ni frases de cortesía serviles.

---

### 2. Techo Anti-Bucle de 3 Rondas contra Bots / CI
- Cuando se interactúa con pipelines de integración continua (CI), linters automatizados o revisores de IA externos (CodeRabbit, SonarQube, GitHub Actions, Dependabot):
  - **Presupuesto máximo:** **3 intentos de corrección** por tarea o PR.
  - Si tras la tercera iteración el linter o bot sigue fallando o solicitando cambios contradictorios, el agente **debe detenerse de inmediato**.
  - Está terminantemente prohibido entrar en bucles de feedback infinitos entre inteligencias artificiales. Se dispara el Circuit Breaker para consultar al humano.

---

### 3. Resolución Silenciosa de Comentarios de PR
- Cuando un agente o worker corrige una observación o sugerencia aprobada en un Pull Request:
  - **Resuelve el hilo en GitHub silenciosamente** utilizando la API de GraphQL:
    ```bash
    gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<THREAD_ID>"}) { clientMutationId } }'
    ```
  - **Prohibido el spam:** No publicar comentarios redundantes del tipo *"Listo, solucionado en el commit abc123"*. La resolución del hilo y el commit en la rama son la única evidencia necesaria.
  - Si una sugerencia de un revisor debe ser rechazada, se escribe **una sola frase factual y técnica** explicando el motivo en el hilo correspondiente y se procede.

---

### 4. Evidencia Visual Obligatoria para UI (Before & After)
- Si un cambio o PR modifica componentes visuales, hojas de estilo (CSS/Tailwind) o layouts:
  - El agente **tiene prohibido marcar la tarea como `ready`** a menos que adjunte evidencia visual real de **Before y After** en la descripción o reporte de entrega.
  - La evidencia debe capturarse mediante `ui-visual-inspector`, el canvas de `gentle-design` o snapshots headless.
  - Si el componente es nuevo y no tiene estado previo, se documenta la captura renderizada en los viewports móvil (375px) y escritorio (1440px).

---

### 5. Blindaje de Auto-Merge y Git Seguro
- **Prohibición de auto-aprobación:** El agente jamás puede auto-aprobarse un PR bajo su misma identidad o credencial.
- **Límite de tamaño para merges automáticos:** Cambios que superen **200 líneas totales** (`additions + deletions`) requieren aprobación humana explícita previa al merge.
- **Invarianza del commit head:** Toda operación de merge automatizada debe incluir el flag de validación de head exacto (ej. `--match-head-commit` en `gh pr merge`), garantizando que nadie haya introducido commits desfasados entre la aprobación y la integración.
- **Invarianza de Mandatos:** Toda tarea delegada sella un mandato con la directiva, versión de política y alcance autorizado. Si la tarea se suspende o reanuda tras horas o días, el agente revalida si la autorización sigue vigente antes de escribir código.
