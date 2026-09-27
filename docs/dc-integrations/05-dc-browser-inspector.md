# DC Browser Inspector (`dc-browser`) — Especificación de Integración

**Módulo:** `src/features/dc-browser/`  
**Ecosistema:** DC Studio (`dc-pi`)  
**Inspiración:** Integración CDP de `j0k3r-pi/extensions/browser-screenshot`.

---

## 1. Visión y Propósito

`dc-browser` dota al subagente `dc-ui-visual-inspector` de **ojos reales**. 

En lugar de que el inspector de UI audite únicamente clases de CSS o código TSX de forma teórica, `dc-browser` se conecta a una instancia local de Google Chrome o Chromium en modo headless/debug (Chrome DevTools Protocol - CDP) en `http://localhost:9222` para:
- Navegar a la URL de desarrollo local (`http://localhost:3000`, `5173`, etc.).
- Esperar a que la página renderice (`Page.loadEventFired`).
- Tomar capturas de pantalla de alta resolución (viewport móvil y desktop).
- Inspeccionar el DOM renderizado y el CSS computado real.

---

## 2. Tools Expuestas

- `dc_browser_status`: Comprueba si hay un puerto CDP activo en el entorno.
- `dc_browser_navigate`: Navega a una URL http/https segura (bloqueando protocolos no autorizados como `file:` o `javascript:`).
- `dc_browser_screenshot`: Captura la pantalla completa o el viewport visible y guarda el PNG en la carpeta de auditoría temporal, devolviendo el resultado al agente.

---

## 3. Seguridad y Límites Estrictos
- Solo permite conexiones a URLs HTTP/HTTPS aprobadas.
- Timeout estricto de 30 segundos por operación con limpieza automática de conexiones WebSocket.
- Integración directa con el subagente `dc-ui-visual-inspector`.
