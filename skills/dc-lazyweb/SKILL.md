---
name: dc-lazyweb
description: Trigger: lazyweb, referencias ui, diseñar ui, inspiracion ui, pricing page, onboarding flow, paywall, checkout ui, experimentos ab, patrones de diseño. Consulta +281k pantallas reales, flujos de producto y experimentos A/B de Lazyweb usando un becario efímero con el ladrillo de Lego 'lazyweb' sin ensuciar el contexto principal.
---

# DC Lazyweb — Evidencia Real de UI/UX y Conversión para Becarios

## Propósito

Proveer referencias empíricas de interfaces reales (+281,000 pantallas de productos como Stripe, Figma, Linear, Duolingo, Adidas, etc., flujos completos paso a paso y comparativas de experimentos A/B) antes de diseñar o refactorizar componentes frontend, páginas de precios, onboarding, paywalls o dashboards.

## Arquitectura de Higiene de Contexto (KISS)

- **La herramienta `dc_lazyweb_search` está aislada del orquestador padre** mediante `isolateSpecializedToolsForOrchestrator` para que consuma **0 tokens** en sesiones normales.
- **Acceso exclusivo mediante Becarios (`dc_ephemeral_agent_run`)**: Para consultar Lazyweb, despacha un subagente efímero incluyendo el ladrillo de Lego `toolBricks: ["lazyweb"]`.
- **Autogestión de Token Gratuito**: El cliente interno gestiona automáticamente `~/.lazyweb/lazyweb_mcp_token` (`chmod 0600`) vía HTTP JSON-RPC *stateless* sin instalar repositorios externos ni telemetría.

## Cómo Despachar un Becario con el Ladrillo `lazyweb`

```json
{
  "role": "ui-reference-scout",
  "toolBricks": ["lazyweb", "fs-read"],
  "behaviorBricks": ["read-only-analyst", "artifact-contract", "non-empty-response"],
  "task": "Usa dc_lazyweb_search (mode: 'screens' y 'flows') para buscar patrones reales de [componente/flujo en inglés]. Sintetiza la jerarquía visual, microcopy, CTAs y estructura recomendada para nuestro componente."
}
```

## Parámetros de `dc_lazyweb_search` (Dentro del Becario)

| Parámetro | Tipo | Uso |
| :--- | :--- | :--- |
| `mode` | `"screens" \| "flows" \| "experiments"` | `screens`: capturas web/móvil; `flows`: secuencias de pasos (onboarding/checkout); `experiments`: comparativas A/B. |
| `query` | `string` | Consulta en inglés (ej. `"pricing page toggle monthly annual"`, `"onboarding paywall"`). |
| `platform` | `"desktop" \| "mobile" \| "all"` | Filtro para `mode: "screens"`. |
| `company` | `string` (opcional) | Filtro de marca para `mode: "flows"` (ej. `"stripe"`, `"figma"`). |
| `limit` | `number` (1–10) | Cantidad de referencias (por defecto `5`). |
| `openPreview` | `boolean` (opcional) | **Bajo demanda**: Ponlo en `true` únicamente cuando el usuario pida ver/abrir las capturas en su visor gráfico `DcWindow` de Kitty (WSLg). |

## Reglas Operativas

1. **Traduce siempre la consulta (`query`) al inglés** al llamar a `dc_lazyweb_search`, ya que el corpus de Lazyweb está indexado en inglés.
2. **`openPreview: true` solo bajo demanda**: Actívalo cuando el usuario pida ver las imágenes o capturas; el cliente las descargará en `~/.cache/dc-lazyweb-preview/` y abrirá las ventanas de `DcWindow` en Kitty automáticamente.
3. **Trata los experimentos (`mode: "experiments"`) como hipótesis visuales**: El dataset de experimentos consiste en *screenshot-diffs* temporales, no en incrementos estadísticos garantizados.
