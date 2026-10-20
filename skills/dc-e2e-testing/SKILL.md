---
name: dc-e2e-testing
description: "Trigger: e2e, test e2e, end-to-end, testing agentico, correr e2e, pruebas de navegacion, tester-army e2e, automatizar navegador, testing mobile e2e. Automatización y ejecución de pruebas E2E híbridas (agentic + deterministic) en Web y Mobile usando el runner e2e de TesterArmy sin MCP ni sobrecarga de contexto."
license: MIT
metadata:
  author: dc-studio
  version: "1.0"
---

# dc-e2e-testing: Pruebas End-to-End Híbridas (Web & Mobile)

Esta skill define el protocolo de DC Studio para diseñar, configurar y ejecutar pruebas end-to-end utilizando el runner **`e2e`** ([tester-army/e2e](https://github.com/tester-army/e2e)). 

## Filosofía DC Studio: Cero MCP, 100% Terminal y Determinismo

1. **Sin intermediarios MCP:** Toda interacción, diagnóstico y ejecución se realiza a través de las herramientas nativas de terminal (`bash`) y manipulación de archivos (`read`, `write`, `edit`).
2. **Replay Cache como Primera Opción:** Los tests agenticos (`agent.act`, `agent.assert`) graban trazas deterministas (`trace-1`). En ejecuciones posteriores corren sin consumir tokens de LLM hasta que la interfaz cambie.
3. **Selectores Semánticos antes que IA:** Siempre que un elemento sea predecible, usar selectores accesibles (`screen.getByRole`, `screen.getByText`, `expect(...)`). Reservar el agente para flujos exploratorios o recorridos complejos.

---

## 1. Detección y Pre-requisitos de Entorno

Antes de correr o crear pruebas, validar el proyecto:

```bash
# 1. Verificar si el proyecto tiene e2e instalado
npm ls e2e || pnpm ls e2e || bun pm ls e2e

# 2. Si no está inicializado, scaffolding guiado con el CLI
npx e2e init

# 3. Para aplicaciones Web, asegurar navegadores de Playwright instalados
npx e2e-web install chromium
```

---

## 2. Configuración Canónica (`e2e.config.ts`)

La configuración debe mantenerse simple (KISS):

```ts
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
// Para mobile usar: import { mobile } from '@e2e-dev/mobile';

export default {
  targets: [
    {
      name: 'web-app',
      engine: web(),
      app: {
        url: 'http://127.0.0.1:3000',
        command: { executable: 'pnpm', args: ['dev'], log: '.e2e/logs/app.log' },
      },
    },
  ],
  // Opcional: configurar modelo para pasos agent.* si no hay caché previa
  agents: {
    default: {
      model: 'openai/gpt-4o-mini', // o tu provider del AI SDK
      system: 'Eres un agente QA exhaustivo y determinista.',
    },
  },
} satisfies E2EConfig;
```

---

## 3. Autoría de Tests (`tests/**/*.e2e.ts`)

Separar claramente las intenciones del agente de las aserciones duras:

```ts
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('usuario completa flujo crítico de compra', async ({ app, agent, screen, browser }) => {
  // Navegación base
  await app.open('/checkout');

  // Acción agentica (el modelo conduce la UI o reproduce la traza en caché)
  await agent.act('selecciona el método de pago con tarjeta y completa los datos de prueba');

  // Aserción semántica agentica
  await agent.assert('el resumen del pedido muestra el descuento de bienvenida aplicado');

  // Aserciones deterministas estrictas (inmediatas y sin coste de tokens)
  await expect(screen.getByRole('button', { name: 'Confirmar Pedido' })).toBeEnabled();
  await screen.getByRole('button', { name: 'Confirmar Pedido' }).click();

  await expect(browser).toHaveURL('/checkout/success');
  await expect(screen.getByRole('heading', { level: 1 })).toHaveText('¡Gracias por tu compra!');
});
```

---

## 4. Ejecución desde Terminal

Usar siempre la herramienta `bash` invocando el CLI local:

| Comando | Propósito |
| :--- | :--- |
| `npx e2e run` | Ejecuta toda la suite en modo headless. |
| `npx e2e run tests/login.e2e.ts` | Ejecuta un archivo de prueba específico. |
| `npx e2e run --headed` | Muestra la ventana del navegador en vivo para depuración visual. |
| `npx e2e run --no-cache` | Fuerza al LLM a resolver los pasos `agent.*` sin usar el replay cache. |
| `npx e2e run --strict-cache` | Falla inmediatamente si una traza está desactualizada (`REPLAY_STALE`). |
| `npx e2e explore --goal "..."` | Modo exploratorio autónomo para cazar bugs y descubrir rutas. |

---

## 5. Diagnóstico y Auto-Reparación de Fallos

Cuando un comando `npx e2e run` falla:

1. **No inventar suposiciones:** Leer el informe estructurado generado por el runner en `.e2e/report.json`.
2. **Revisar el error taxonomy:**
   - `LOCATOR_NOT_FOUND`: El elemento cambió de texto, rol o no renderizó a tiempo.
   - `LOCATOR_AMBIGUOUS`: Hay múltiples elementos con el mismo accessible name. Usar filtros adicionales.
   - `REPLAY_STALE`: La UI cambió de forma respecto a la grabación previa. Correr con `--no-cache` para regrabar.
   - `POLICY_DENIED`: Intento de navegación a un esquema prohibido (`file:`, `javascript:`).
3. **Inspeccionar capturas:** Si hubo fallas visuales, revisar los artefactos en `.e2e/artifacts/`.

---

## 6. Heurísticas para Testing Móvil (Mindset Artemis)

Al autorar o depurar flujos en dispositivos Android (reales o emulados), seguir las reglas probadas de ingeniería móvil derivadas de Google ARTEMIS:

1. **Filosofía "Dynamic-First, Coordinate-Fallback":**
   - Siempre priorizar selectores semánticos dinámicos (`accessibility-id`, texto, roles o etiquetas accesibles) para resistir cambios de layout y densidad de píxeles.
   - Usar coordenadas relativas o absolutas únicamente como fallback secundario (patrón *Try-Catch Fallback*) cuando los elementos carecen de árbol accesible (ej: Flutter Canvas, WebViews o renderers gráficos).
2. **Compensación de Latencia en Exploración vs. Determinismo en Código:**
   - Durante la exploración agentica interactiva, el modelo introduce latencia natural de inferencia (~3-5s en modelos Flash, ~25-30s en modelos de razonamiento profundo).
   - En el código final de prueba (`.e2e.ts`), esa latencia del agente desaparece: se deben implementar esperas explícitas deterministas (`waitFor`, estados de carga, transiciones de pantalla) sin relying en retrasos artificiales.
3. **Aislamiento por Dispositivo y Mutex:**
   - Cada dispositivo físico o emulador debe ser direccionado mediante su serial ADB (`adb -s <serial>`).
   - Nunca asumir un solo dispositivo conectado: ejecutar `adb devices -l` antes de iniciar la suite móvil para verificar autorización (`device` vs `unauthorized`/`offline`).
4. **Diagnóstico Sistemático antes de Conjeturar:**
   - Ante fallos de conexión o UI congelada en móvil, no reintentar a ciegas: verificar la conectividad de ADB, limpiar procesos colgados (`kill-server`) y revisar `logcat` enfocado en los crashes de la aplicación objetivo.

---

## Referencias Detalladas

Para directivas específicas de sintaxis y depuración avanzada, consultar los documentos en `references/`:
- [references/setup.md](references/setup.md): Configuración avanzada de `e2e.config.ts`, puertos dinámicos y secretos.
- [references/writing-tests.md](references/writing-tests.md): Catálogo completo de locators, matchers y fixtures.
- [references/troubleshooting.md](references/troubleshooting.md): Diccionario de errores y estrategias de resolución.
