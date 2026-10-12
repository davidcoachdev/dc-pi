# 📋 Especificación de Evolución & Backlog de Arquitectura: `dc-pi`
## Inspiraciones, Evaluaciones Críticas y Adaptaciones (Ecosistema CinloDev -> DC Studio)

* **Fecha de Creación:** 9 de Octubre de 2026
* **Ubicación Canónica de Trabajo:** `/home/dc-studio/dc-lab/dc-projects/dc-pi`
* **Autor / Coordinación:** el Gentleman & David (DC Studio)
* **Objetivo:** Registrar las decisiones de diseño, ideas a evaluar y especificaciones técnicas para evolucionar `dc-pi` en su propio repositorio sin contaminar otros laboratorios ni apresurar código.

---

## 🔗 Fuentes de Referencia e Investigación (Benchmarks Externos)

Para consultar o auditar las implementaciones de referencia originales en cualquier momento, estas son las fuentes exactas y ubicaciones inspeccionadas:

### 1. `pi-sdd-profiles` (Gestor de perfiles y sincronización atómica)
* **Repositorio Remoto:** [`https://github.com/CinloDev/pi-sdd-profiles`](https://github.com/CinloDev/pi-sdd-profiles) (v1.0.0, commit `43d3226`)
* **Fork Local / Copia de Auditoría:** `/home/dc-studio/dc-lab/lab-35-cinlo-repo/target-repo`
* **Archivos Clave de Referencia:**
  - `src/sync.ts`: Motor de sincronización atómica con `applyProfileToConfig`, `reconcileProfileWithFile` y escrituras `.tmp` + `renameSync`.
  - `src/watcher.ts`: Observador con debounce de 200 ms y bandera `isReconciling` para vigilar `subagents.json`.
  - `src/modal.ts`: Componente TUI Miller Columns de 3 paneles y selector master-detail de modelos de 2 columnas.
  - `src/models-resolver.ts`: Descubrimiento de modelos en Pi y mapeo de capacidades de esfuerzo (`thinkingLevelMap`).
* **Informes de Auditoría de Referencia:**
  - Informe Técnico Completo: `/home/dc-studio/dc-lab/lab-35-cinlo-repo/reports/auditoria-profunda-pi-sdd-profiles.md`
  - Informe de Seguridad & Threat Modeling: `/home/dc-studio/dc-lab/lab-35-cinlo-repo/reports/auditoria-seguridad-pi-sdd-profiles.md`
  - Issue en GitHub: [CinloDev/pi-sdd-profiles#43](https://github.com/CinloDev/pi-sdd-profiles/issues/43)
  - PR con Informes: [CinloDev/pi-sdd-profiles#42](https://github.com/CinloDev/pi-sdd-profiles/pull/42)

---

### 2. `pi-cinlodev-cute` (Suite visual, Sidebar Tabs & Prompt Editor)
* **Repositorio Remoto:** [`https://github.com/CinloDev/pi-cinlodev-cute`](https://github.com/CinloDev/pi-cinlodev-cute)
* **Archivos Clave de Referencia:**
  - `src/editor.ts`: Envoltorio dinámico del prompt editor con borde reactivo al `thinkingLevel` (`Shift+Tab`) y cálculo de safety margin para clipping (`╗`).
  - `src/sidebar.ts`: Barra de pestañas lateral (`CUTE_SIDEBAR_TABS`) con navegación por mouse wheel y clics por coordenadas X/Y (`1:MAIN` a `5:TREE`).
  - `src/cute-transcript.ts`: Agrupamiento visual inteligente de llamadas consecutivas de herramientas (`bash`, `write`, `mem_*`).

---

### 3. `pi-task-manager` (Telemetría de tokens y gestión de fases)
* **Repositorio Remoto:** [`https://github.com/CinloDev/pi-task-manager`](https://github.com/CinloDev/pi-task-manager)
* **Concepto de Referencia:**
  - Registro de tokens (entrada, salida, caché y razonamiento) discriminados por tarea y subagente.
  - Almacenamiento limpio en `.pi/task-manager.json` (`Zero Repo Pollution`).
  - *(Nota DC Studio: Se descarta la compilación web/HTML de este repo; se adopta únicamente la telemetría para mostrarla en modal flotante TUI nativo).*

---

### 4. `dc-sentinel` (Patrón Canónico de Referencia Propio en `dc-pi`)
* **Ubicación en el código:** `/home/dc-studio/dc-lab/dc-projects/dc-pi/src/features/dc-sentinel/`
* **Archivos de Referencia:**
  - `views/dc-sentinel-modal.ts`: Implementación de pestañas con corchetes (`[ ● 1:HISTORIAL ]`), atajos directos por teclado (`1`, `2`, `3`) y detección precisa de clics en la barra superior. Es la referencia visual directa para adaptar `dc-sidebar`.

---

## 🧭 Principios Directivos de Diseño (Filosofía DC Studio)

1. **Terminal Pura & Cero Dependencia Web:**
   No se levantarán navegadores, servidores web locales ni archivos HTML estáticos para dashboards. Toda la información, telemetría y gestión de tareas debe suceder dentro de la TUI en ventanas modales flotantes nativas (`tui.custom` con overlay).
2. **Identidad Visual DC-Sangre:**
   Respetar la paleta de colores canónica: contrastes altos, rojo sangre (`#800000` a `#ff3333`), negro obsidiana, bordes estructurados y estilo de tabs idéntico al diseñado para la pantalla de **Sentinel** (`dc-sentinel`).
3. **Preservación del Ruteo Dinámico de la Flota de Taxis:**
   Cualquier mecanismo de perfiles o configuraciones no debe sobreescribir ni rigidizar el sistema de arriendo dinámico de cuentas de `dc-taxis.json`.

---

## 📌 Los 4 Ejes Técnicos a Evaluar e Implementar en `dc-pi`

---

### EJE 1: Sidebar Multi-Tab al Estilo Sentinel (`dc-sidebar`)
* **Estado:** **Aprobado para diseño e implementación.**
* **Módulos afectados:** `src/features/dc-sidebar/`, `src/features/dc-sidebar/views/`, `src/features/dc-sidebar/components/`
* **Referencia Visual:** `src/features/dc-sentinel/views/dc-sentinel-modal.ts`
* **Diagnóstico actual:**
  El sidebar actual de `dc-pi` es un stack vertical lineal (`DcVStack`) que agrupa:
  - Tarjeta de Estado (Git, Branch, Changes, RDD, Engram, Quotas, Flota de Taxis).
  - Tarjeta de Tareas (`todo` card).
  - Tarjeta de Subagentes vivos.
  - Tarjeta de Contexto de tokens.
  
  Cuando el proyecto tiene tareas largas o múltiples subagentes en ejecución, el alto del rail se satura y obliga a scrollear o comprime los componentes.

* **Diseño Propuesto (Patrón Sentinel Tabs):**
  Incorporar una barra superior de pestañas en `dc-sidebar-header.ts` con la estética y atajos de `dc-sentinel-modal`:
  ```text
  ╔═ [1:STATUS] ── [2:PLAN] ── [3:SENTINEL] ── [4:MEM] ═╗
  ```
  - **Navegación:**
    - Clics con mouse directo sobre los tabs (detección de coordenadas X/Y).
    - Rueda del mouse sobre la barra de tabs para ciclar adelante/atrás.
    - Atajos rápidos de teclado contextuales o comandos.
  - **Definición de Pestañas:**
    1. **`[1:STATUS]` (Operaciones & Métricas):**
       - Proyecto y Git (Branch, Changes `[↗]` con apertura a `dc-changes`).
       - Flota de Taxis activa (cuentas arrendadas en tiempo real).
       - Semáforos de cuotas y consumo de modelos.
    2. **`[2:PLAN]` (Fases & Tareas a Pantalla Completa en Rail):**
       - Ocupa todo el alto disponible del sidebar hasta el footer.
       - Despliegue jerárquico de fases (`S#`), progreso porcentual y checkboxes interactivos para tildar tareas con click o barra espaciadora.
    3. **`[3:SENTINEL]` (Vigilancia, Base de Datos & Notas):**
       - Resumen de la base de datos `sentinel-*.db` del proyecto.
       - Alertas activas de escaneos de seguridad y anomalías detectadas.
       - Acceso directo al visor completo (`openSentinelViewer`).
    4. **`[4:MEM]` (Memoria Persistente & Handoff):**
       - Estado del daemon local de Engram (`localhost:7437`).
       - Observaciones recientes vinculadas al proyecto.
       - Previsualización compacta del handoff activo de sesión.

---

### EJE 2: Telemetría de Tokens y Fases en Ventana Flotante TUI (`dc-plan` / Anti-Web)
* **Estado:** **Aprobado para diseñar a fondo en terminal.**
* **Módulo afectado:** `src/features/dc-plan/`
* **Referencia Conceptual:** `CinloDev/pi-task-manager` (telemetría de tokens) + `src/features/dc-changes/` (modal TUI con split view)
* **Diferencia Crítica con `pi-task-manager`:**
  Cinlo utiliza un comando que compila un archivo HTML y lo abre en el navegador web del sistema. En DC Studio **se rechaza tajantemente la vía web** para mantener la experiencia 100% autocontenida en la terminal.
* **Propuesta TUI Nativa (Modal Centrado):**
  - Crear un visor modal flotante interactivo (`openPlanTelemetryModal`) accesible mediante `/dc-plan telemetry` (o atajo dedicado como `Ctrl+Shift+J` o `Alt+J`):
    - **Panel Izquierdo (Kanban & Fases):** Árbol de especificaciones y tareas (`odd/tasks/` o `tasks.md`), agrupadas por estado (`pending`, `in_progress`, `completed`, `blocked`).
    - **Panel Derecho (HUD de Telemetría Pura de Terminal):**
      - Desglose de tokens consumidos: entrada (prompt), salida (completion), lectura/escritura de caché, y razonamiento (`thinking`).
      - Tokens acumulados por el orquestador principal vs. cada subagente efímero de la Flota de Taxis.
      - Costo acumulado estimado en USD.
      - Commits de Git vinculados automáticamente a cada tarea concluida.
    - **Persistencia Limpia (`Zero Repo Pollution`):** Si se persiste estado enriquecido de telemetría de tareas, hacerlo exclusivamente en `.pi/task-telemetry.json` sin ensuciar el git del proyecto con páginas web o archivos temporales de gran tamaño.

---

### EJE 3: Conmutación de Perfiles vs. Flota de Taxis (`dc-models` & `dc-agents`)
* **Estado:** **Bajo evaluación y análisis conceptual profundo.**
* **Módulos afectados:** `src/features/dc-models/`, `src/features/dc-agents/`, `src/features/dc-sidebar/providers/dc-profile-provider.ts`
* **Referencia Externa:** `CinloDev/pi-sdd-profiles/src/sync.ts` (mecanismo de reconciliación atómica)
* **Análisis Crítico:**
  - `pi-sdd-profiles` utiliza perfiles rígidos (asigna modelos estáticos por nombre de subagente en `subagents.json`).
  - `dc-pi` ya cuenta con:
    1. `dc-models`: Conmutador rápido del modelo de sesión (`/dc-models` o `Alt+M`).
    2. Flota de Taxis (`dc-taxis.json`): Asignación y arrendamiento dinámico de cuentas (`ac01`, `ac02`, `cin82`, etc.) por arquetipo o rol (`dc-researcher`, `dc-analyst`, `dc-worker`).
    3. `dc-profile-provider.ts`: Lectura básica de `profiles.json` de Gentle-Pi en el sidebar.
  - **Punto a resolver a fondo:**
    Evitar crear una capa redundante que pelee con la Flota de Taxis.
  - **Hipótesis de Solución ("Modos Operativos de Flota"):**
    En vez de "perfiles de subagentes estáticos", implementar **Presets de Operación de DC Studio**:
    - *Modo Rápido / Economía:* Orquestador Flash + Taxis orientados a velocidad/costo mínimo.
    - *Modo Arquitectura & Auditoría:* Orquestador Frontier (Sonnet 3.7 / Opus / O3) + Taxis de alta capacidad de razonamiento.
    - *Modo Offline / Local:* Orquestador y taxis apuntando a instancias locales (Ollama/vLLM).
    - Al cambiar de modo, se sincroniza atómicamente la configuración base y se actualiza el indicador en el Sidebar sin desarmar la lógica de leases de los taxis.

---

### EJE 4: Auditoría y Refuerzo del Prompt Editor Reactivo (`dc-prompt`)
* **Estado:** **Implementado en base; pendiente de revisión y pulido fino.**
* **Módulo afectado:** `src/features/dc-prompt/dc-prompt-editor.ts`
* **Referencia de Comparación:** `CinloDev/pi-cinlodev-cute/src/editor.ts`
* **Diagnóstico actual:**
  - `dc-pi` ya cuenta con wrapping del editor de comandos y borde dinámico.
* **Puntos a revisar a fondo en el repo:**
  - Comprobar la reactividad exacta al alternar el esfuerzo de razonamiento (`thinkingLevel`) en caliente (`Shift+Tab` o `/thinking`).
  - Validar que los tonos del marco adopten perfectamente la jerarquía del tema activo `Dc-Sangre`:
    - *Thinking Off / Minimal:* Rojo sangre profundo / apagado (`#800000`).
    - *Thinking Medium:* Carmesí activo (`#ff3333`).
    - *Thinking High / Max:* Rojo fuego brillante (`#ff6666`) con indicador de alerta de consumo de tokens.
  - Verificar que no existan bugs de clipping visual o desbordamiento de columnas en terminales angostas (safety margin en el caracter de cierre `╗`).

---

## 🛠️ Plan de Trabajo al Iniciar Sesión en `dc-pi`

Cuando nos movamos al workspace `/home/dc-studio/dc-lab/dc-projects/dc-pi`:

1. **Paso 1 (Prioritario):** Iniciar con el **EJE 1** creando la rama `feat/sidebar-sentinel-tabs` para construir la barra de pestañas en `dc-sidebar`.
2. **Paso 2:** Analizar el código de `dc-plan` para el **EJE 2** (diseño del modal flotante TUI de telemetría y tareas).
3. **Paso 3:** Revisar `dc-prompt-editor.ts` para el **EJE 4** asegurando que la reactividad al thinking level esté 100% pulida.
4. **Paso 4:** Debatir y definir el diseño final del **EJE 3** (Presets de Operación vs. Flota de Taxis).
