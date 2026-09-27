# DC Model Hierarchy Picker (`dc-models` Upgrade) — Especificación de Integración

**Módulo:** `src/features/dc-models/`  
**Ecosistema:** DC Studio (`dc-pi`)  
**Inspiración:** Selector jerárquico de `j0k3r-pi/extensions/j0k3r-model-picker`.

---

## 1. Visión y Propósito

El selector actual de modelos muestra un listado plano que se vuelve inmanejable cuando se utiliza **CLIProxyAPI** con decenas de cuentas o proveedores combinados (Google Antigravity, OpenAI personal, OpenCode, DeepSeek, etc.).

Esta mejora transforma el selector de modelos de DC Studio en una interfaz de navegación fluida con **jerarquía de 3 niveles**:

```
[ Proveedor / Protocolo ]  ➡️  [ Cuenta / Fabricante ]  ➡️  [ Modelo y Nivel de Razonamiento ]
   (ej: cliproxyapi)             (ej: account-dev-2)            (ej: gemini-2.5-pro / high)
   (ej: openai)                  (ej: personal-team)            (ej: gpt-5.4 / low)
```

---

## 2. Arquitectura Visual (`DcWindow` + Tabs)

A diferencia de la implementación simple de joker, en DC Studio aprovechamos nuestros componentes nativos de alto impacto:
- **`DcWindow`** centrado y responsivo con bordes limpios y título dinámico.
- **`DcTabs`** para alternar rápidamente entre proveedores (CLIProxyAPI, OpenAI, Anthropic, Custom).
- Navegación con flechas del teclado (`↑` `↓` `←` `→`), filtro por texto en tiempo real y confirmación con `Enter`.
- Integración directa con `pi.setModel()` y persistencia de modelo favorito por proyecto en `~/.pi/agent/dc-studio/models.json`.

---

## 3. Heurística de Agrupación Inteligente

1. **Modelos con prefijo o barra (`provider/account/model` o `provider/model`)**:
   - `cliproxyapi/team-ai/gemini-2.5-flash` ➡️ Proveedor: `cliproxyapi`, Cuenta: `team-ai`, Modelo: `gemini-2.5-flash`.
2. **Modelos planos de fabricantes**:
   - Se agrupan por familia: `qwen*` ➡️ Qwen / Alibaba, `claude*` ➡️ Anthropic, `gpt*` ➡️ OpenAI.
