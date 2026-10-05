# Troubleshooting y Diagnóstico de Fallos en e2e

## 1. El Archivo `.e2e/report.json`

Cuando una ejecución de `npx e2e run` falla, el runner genera un reporte estructurado en `.e2e/report.json`.

Contiene:
- `status`: `'passed' | 'failed' | 'timedout'`.
- `steps`: Array con cada acción efectuada, duración y estado.
- `error`: Objeto con código de error (`code`), mensaje y ubicación en el código fuente.
- `artifacts`: Rutas a capturas de pantalla tomadas al momento de la falla.

**Regla de ODD:** Antes de modificar un test roto, leer este archivo con la herramienta `read` para identificar la causa raíz exacta.

---

## 2. Códigos de Error Comunes y Soluciones

### `LOCATOR_NOT_FOUND`
- **Causa:** El elemento no apareció en el DOM o árbol de accesibilidad antes del timeout.
- **Acción:** Verificar si la acción anterior disparó una navegación o carga asíncrona; revisar si el nombre accesible (`name`) cambió o contiene espacios/mayúsculas inesperados.

### `LOCATOR_AMBIGUOUS`
- **Causa:** El selector coincide con más de un elemento en la pantalla actual.
- **Acción:** Restringir el selector especificando un rol más preciso, un contenedor padre o atributos adicionales.

### `REPLAY_STALE`
- **Causa:** El test corrió con `--strict-cache` o detectó que la pantalla grabada previamente en `.e2e/cache/` difiere de la UI actual de la app.
- **Acción:** Correr `npx e2e run --no-cache <archivo>` para permitir que el agente navegue la nueva versión de la UI y actualice la traza grabada.

### `APP_URL_REQUIRED`
- **Causa:** Se invocó `app.open('/ruta')` pero el target en `e2e.config.ts` no definió `app.url`.
- **Acción:** Configurar `url` en la sección `app` de `e2e.config.ts`.

### `POLICY_DENIED`
- **Causa:** El test o el agente intentó navegar a un esquema no permitido (como `file:`, `javascript:`, o URLs malformadas).
- **Acción:** Validar que las URLs utilicen protocolo `http:` o `https:`.
