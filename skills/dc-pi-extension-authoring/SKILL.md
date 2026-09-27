---
name: dc-pi-extension-authoring
description: "Guía técnica para diseñar, construir y mantener extensiones nativas y herramientas de Pi bajo la arquitectura de DC Studio. Trigger: crear extension, nueva tool de pi, hooks de ciclo de vida, registrar comando, ui de pi o refactorizar extension."
license: MIT
metadata:
  author: dc-studio
  version: "1.0"
---

# DC Pi Extension Authoring Guide

Guía oficial para crear y mantener extensiones de Pi en el ecosistema DC Studio (`dc-pi`).

## 1. Estructura Estándar de una Extensión (`src/features/<nombre>/`)
```text
src/features/dc-<feature>/
├── core/                       # Lógica pura, cálculos, clientes y tipos (Cero imports de Pi)
│   ├── dc-<feature>-types.ts
│   └── dc-<feature>-engine.ts
├── tools/                      # (Opcional) Herramientas invocables por el LLM
│   └── dc-<feature>-tools.ts
├── dc-<feature>.ts             # Punto de entrada de la extensión (registra hooks y comandos)
└── index.ts                    # Exportación limpia hacia src/index.ts
```

## 2. Ciclo de Vida y Hooks Principales (`ExtensionAPI`)
- `session_start`: Inicialización de estado al abrir una sesión o recargar con `/reload`.
- `before_agent_start`: Inyección de contexto previo al turno del modelo (usado en `dc-date` y `dc-git-sync`).
- `session_shutdown`: Limpieza de timers, sockets o archivos temporales.

## 3. Registro de Herramientas (`pi.registerTool`)
- Nombre con prefijo `dc_` (ej: `dc_api_rest`, `dc_pdf_extract`).
- Esquema de parámetros mediante TypeBox o JSON Schema estricto.
- Retorno obligatorio de formato `{ content: [{ type: "text", text: "..." }], details: { ... } }`.
- Control de volumen: Truncar respuestas gigantescas para proteger el context window del modelo.

## 4. Interfaces Gráficas con `DcWindow` y `openDcModal`
- Usar siempre `openDcModal` para heredar el marco doble, glifo `⛩ `, soporte de arrastre y el cerrojo global anti-ventanas encimadas.
- Usar `paddingX: 0` cuando el panel calcule columnas internas de borde a borde.
- Usar `DcSearchInput` para barras de búsqueda con autoscroll horizontal y ancho fijo.
