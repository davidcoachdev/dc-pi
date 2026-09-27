---
name: dc-anti-overengineering
description: "Aplica estrictamente las directivas KISS y YAGNI en DC Studio. Previene sobreingeniería, abstracciones prematuras, factories innecesarias y código especulativo. Trigger: planificación, refactorización, arquitectura, revisión de código o diseño de soluciones."
license: MIT
metadata:
  author: dc-studio
  version: "1.0"
---

# DC Anti-Overengineering (KISS & YAGNI)

## Principio Rector
En DC Studio construimos **la solución suficiente más simple posible**. No resolvemos problemas hipotéticos que no existen hoy. Cada línea de código, clase o abstracción debe justificar su existencia contra un requerimiento real e inmediato.

## Reglas Obligatorias

1. **YAGNI Estricto (You Aren't Gonna Need It)**:
   - Prohibido agregar código, parámetros o configuraciones "por si acaso en el futuro".
   - Si una función solo se usa en un lugar, no crees una fábrica genérica ni una jerarquía de clases abstractas.
   - Si un objeto plano (`interface` o `Record`) resuelve el problema, no crees una clase con getters, setters y builders.

2. **KISS (Keep It Simple, Straightforward)**:
   - Preferí código lineal, legible y directo sobre patrones de diseño sofisticados innecesarios.
   - Desacoplá responsabilidades (Directiva 1 de DC Studio), pero mantén cada capa lo más delgada posible.
   - Menos líneas de código bien testeadas equivalen a menor superficie de bugs y menor deuda técnica.

3. **Cuándo Crear una Abstracción**:
   - Creá una abstracción **únicamente** cuando se repita la misma lógica en 3 o más lugares independientes (Regla de Tres), nunca antes.
   - Si una dependencia externa cambia, aislarla con un adapter delgado, no con un framework interno.

4. **Validación durante Implementación**:
   - ¿Esta solución requiere más de un archivo para un cambio conceptual simple? Si la respuesta es sí, detenete y simplificá.
   - ¿El usuario pidió esta flexibilidad extra? Si no la pidió, eliminala.
