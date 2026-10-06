# Referencia Completa de Skills de DC Studio (`skills/`)

**Ecosistema:** DC Studio (`dc-pi`)  
**Alcance:** `skills/*` (12 skills empaquetadas y declaradas en `package.json`)  

Las skills de `dc-pi` codifican estándares de arquitectura, flujos de trabajo de ingeniería, automatización E2E, contratos de documentación y aseguramiento de calidad. Se sincronizan de forma recursiva e idempotente hacia `~/.pi/agent/skills/` en cada arranque de sesión (`syncDcSkills`) y se exponen nativamente en el manifiesto `"pi": { "skills": ["./skills"] }`.

---

## 1. Índice Rápido de las 12 Skills

| Skill | Categoría | Triggers Principales | Propósito Clave |
| :--- | :--- | :--- | :--- |
| **`dc-pi-architecture`** | Arquitectura | `dc-pi`, `arquitectura dc`, `directivas dc` | Aplica las 10 Directivas Obligatorias de modularidad, persistencia aislada, notificaciones y rendimiento en `dc-pi`. |
| **`dc-pi-extension-authoring`**| Desarrollo Pi | `crear extension`, `nueva tool de pi`, `ui de pi` | Guía técnica para construir extensiones, tools y ventanas modales con `DcWindow` y `openDcModal`. |
| **`dc-anti-overengineering`** | Ingeniería | `planificación`, `refactorización`, `arquitectura` | Impone **KISS** y **YAGNI** estrictos (Regla de Tres antes de abstraer, cero código especulativo). |
| **`dc-planned-workflow`** | Flujo de Trabajo| `flujo planificado`, `planned workflow`, `por fases`| Orquesta el pipeline cerrado de 4 fases (`Discovery -> Planning -> Apply -> Verify`) en `openspec/changes/<slug>/`. |
| **`dc-artifact-contracts`** | Contratos | `formato de artefactos`, `plantilla de discovery` | Define las plantillas canónicas de Markdown para `discovery.md`, `plan.md`, `apply.md` y `verify.md`. |
| **`dc-project-documentation`** | Documentación | `adr`, `documentacion de producto`, `onboarding` | Organiza la documentación técnica y de producto con 10 contratos especializados en `references/owners/`. |
| **`dc-e2e-testing`** | Testing & QA | `e2e`, `test e2e`, `tester-army`, `testing mobile` | Automatización y ejecución de pruebas E2E híbridas (Web y Mobile) por CLI sin sobrecarga de MCP. |
| **`acceptance-contract`** | Testing & QA | `acceptance contract`, `criterios ejecutables`, `qa code`| Genera scripts binarios deterministas (`exit 0` / `exit 1`) en `qa/acceptance/` para validar entregas. |
| **`qa-human-recipe`** | Testing & QA | `qa recipe`, `guia de pruebas`, `receta qa` | Genera guías paso a paso de verificación manual para revisores humanos en PRs e issues. |
| **`ui-visual-inspector`** | Frontend & UI | `visual inspect`, `pixel perfect`, `revisar diseño` | Audita layouts frontend, responsive (375px / 1440px), Tailwind y fidelidad visual mediante capturas headless. |
| **`pr-review-triage`** | Colaboración | `pr review`, `triage pr`, `comentarios pr` | Inspecciona, clasifica y prioriza comentarios de revisión de Pull Requests usando un subagente de solo lectura. |
| **`dc-tech-intel-briefing`** | Investigación | `noticias tech`, `novedades de IA`, `briefing audio`| Orquesta la investigación tecnológica con `dc-news-to-day` y su conversión opcional a audio WAV con `dc-audio`. |

---

## 2. Detalle de Skills con Referencias Anexas

### A. `dc-e2e-testing` (`skills/dc-e2e-testing/`)
Diseñada para ejecutar pruebas End-to-End deterministas y agénticas desde la terminal sin contaminar el contexto del LLM con árboles de accesibilidad gigantes.
* **Referencias incluidas:**
  * `references/setup.md`: Instalación, inicialización de entorno y configuración de navegadores/emuladores.
  * `references/writing-tests.md`: Sintaxis de pasos, selectores resilientes y aserciones.
  * `references/troubleshooting.md`: Diagnóstico de fallos de red, timeouts y capturas de evidencia.

### B. `dc-project-documentation` (`skills/dc-project-documentation/`)
Gobierna cómo y dónde documentar decisiones de ingeniería y producto sin inflar archivos innecesarios.
* **Referencias incluidas:**
  * `references/document-contract.md`: Contrato maestro de estructura documental.
  * `references/owners/architecture-definition.md`: Diseño de arquitectura de sistemas.
  * `references/owners/technical-decisions.md`: Plantilla y ciclo de vida de ADRs (*Architecture Decision Records*).
  * `references/owners/existing-project-onboarding.md`: Guía de aterrizaje en repositorios existentes.
  * `references/owners/product-discovery.md`, `product-definition.md`, `product-validation.md`: Ciclo de producto.
  * `references/owners/requirements-definition.md`, `delivery-planning.md`, `startup-documentation.md`: Requisitos y entregas.

### C. Pipeline Planificado (`dc-planned-workflow` + `dc-artifact-contracts`)
Alternativa formal a ODD para features de gran escala que requieren trazabilidad documental completa antes de escribir código:
1. **Fase 1 (`Discovery`):** Delegada a `dc-phase-discovery` -> Produce `openspec/changes/<slug>/discovery.md`.
2. **Fase 2 (`Planning`):** Delegada a `dc-phase-planning` -> Produce `openspec/changes/<slug>/plan.md`.
3. **Fase 3 (`Apply`):** Delegada a `dc-phase-apply` -> Ejecuta cambios y produce `openspec/changes/<slug>/apply.md`.
4. **Fase 4 (`Verify`):** Delegada a `dc-phase-verify` -> Valida tests/contratos y produce `openspec/changes/<slug>/verify.md`.
