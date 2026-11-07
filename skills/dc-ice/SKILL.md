---
name: dc-ice
description: "Marco de Desarrollo Dirigido por Intención (IDSD / ICE Gate). Previene el colapso de Spec-Driven Development separando Intent, Context y Expectations con freno manual innegociable. Trigger: intent, ice, idsd, nueva tarea, validar spec, freno manual, requirements, alcance, arquitectura."
license: MIT
metadata:
  author: dc-studio
  version: "1.0"
---

# DC ICE Gate — Intent-Driven Software Development (IDSD)

Basado en las directivas de **Kapil Viren Ahuja** (*"De Spec-Driven Development a Intent-Driven Software Development"*) y el *whitepaper* de **Google Cloud AI** (*"The New SDLC With Vibe Coding"*).

## La Tesis Central: La Separación en 3 Capas

El colapso de *Spec-Driven Development* (SDD) ocurre cuando un solo documento intenta ser el "qué", el "cómo", la arquitectura y las pruebas al mismo tiempo. IDSD desacopla estas 3 capas:

```
┌────────────────────────────────────────────────────────┐
│ 1. INTENT (Propiedad del Humano)                       │
│    Goal + Constraints + Failure Conditions             │
│    + Freno Manual (Manual Brake)                       │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 2. CONTEXT (Propiedad del Harness / dc-pi)             │
│    Repositorio, estándares, stack y dependencias       │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 3. EXPECTATIONS (Contrato Evaluable Binario)           │
│    Tests deterministas, evals y suites de verificación │
└────────────────────────────────────────────────────────┘
```

---

## Anatomía de un Intent Válido

Un Intent en DC Studio consta de cuatro partes obligatorias:

### 1. El Objetivo (Goal)
- **Regla:** Exactamente una sola oración concisa en lenguaje de negocio.
- **Sin conjunciones:** Prohibido usar "and" o "y" uniendo múltiples metas. Si necesitas una conjunción, tienes dos metas pretendiendo ser una. Divídelas en dos Intents atómicos.
- **Test de las 2 implementaciones:** ¿Dos arquitecturas completamente distintas podrían satisfacer este objetivo? Si la respuesta es no (porque fija Express, Go, Redis o rutas de archivos), has escrito una implementación disfrazada de meta. Esos detalles pertenecen al **Context**.

### 2. Restricciones Direccionales (Constraints)
- **Cantidad:** Entre 3 y 5 cualidades (máximo 7). Superar 7 es sobre-especificación SDD.
- **Lenguaje:** Cualidades no funcionales de negocio / SLOs (ej. latencia p99 < 200ms, soporte de 1.000 MAU concurrentes, WCAG 2.1 AA, OWASP ASVS Nivel 2).
- **Prohibido:** No dictan librerías internas (`"use redis"`, `"wrap with envoy"`). Las herramientas pertenecen al Context; la elección concreta le pertenece al agente implementador.

### 3. Condiciones de Rechazo (Failure Conditions)
- **Cantidad:** Entre 3 y 5 comprobaciones binarias post-output.
- **Naturaleza:** Observables por scripts, linters y suites de tests sin pedir opinión humana (ej. `"Build fails"`, `"Coverage drops below 90%"`, `"Lint reports errors"`, `"Secrets in source code"`).
- **Inversión de roles:** No mezcles métricas de cobertura o compilación en las Constraints. Esas son Failure Conditions que el validador audita después.

### 4. El Freno Manual (Manual Brake)
Antes de gastar un solo token de implementación, todo Intent debe responder:
1. **¿Quién necesita esto y qué se rompe en el mundo real si nunca existe?** Si la respuesta honesta es "nadie", se clasifica como experimento descartable, no como tarea de producción.
2. **¿Lo construiríamos si costara 1 semana de desarrolladores senior en lugar de una tarde de tokens baratos?** Filtro contra el *Carry Debt* (inventario innecesario).
3. **¿Quién tiene la autoridad explícita de decir "NO"?** Nombra la persona o rol responsable. Una decisión sin dueño de negativa es una trampa.

---

## Uso de la Herramienta y Comando

### Comando en Pi:
```bash
/dc-ice <ruta/a/intent.json>
```

### Herramienta Agéntica:
```json
{
  "tool": "dc_ice_validate",
  "args": {
    "intent": {
      "goal": "Build a microservice that handles the user-facing product catalog.",
      "constraints": [
        "Support 1,000 concurrent monthly active users at peak.",
        "p99 latency under 200 milliseconds on read endpoints.",
        "99.99% uptime against the published SLO.",
        "OWASP ASVS Level 2 on every endpoint."
      ],
      "failureConditions": [
        "Build fails.",
        "Unit test coverage drops below 90%.",
        "Lint reports any errors.",
        "A secret appears in the source."
      ],
      "manualBrake": {
        "whoNeedsThis": "End users browsing catalog; without it product discovery breaks.",
        "costIfOneWeekDevs": true,
        "refusalOwner": "Lead Architect"
      }
    }
  }
}
```
