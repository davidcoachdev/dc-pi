---
name: dc-tech-intel-briefing
description: "Orquesta la investigación de novedades tecnológicas, lanzamientos y tendencias en DC Studio. Delega la investigación al subagente dc-news-to-day y convierte los informes a audio mediante dc-audio. Trigger: noticias tech, novedades de IA, lanzamientos, resumen semanal o briefing de audio."
license: MIT
metadata:
  author: dc-studio
  version: "1.0"
---

# DC Tech Intel Briefing

## Misión
Investigar, compilar y entregar informes ejecutivos de alta fidelidad sobre novedades en inteligencia artificial, desarrollo de software, open source y tecnología, con soporte de síntesis hablada en audio.

## Flujo de Trabajo

1. **Definir Alcance del Briefing**:
   - Tema o tecnologías a cubrir (ej: lanzamientos de modelos, updates de TypeScript/Node, frameworks).
   - Ventana de tiempo (ej: últimas 24 horas, última semana).
   - Formato requerido: Texto narrativo, audio (.wav) o ambos.

2. **Delegación a `dc-news-to-day`**:
   - Invocar al subagente `dc-news-to-day` con la consigna de investigación.
   - El subagente consulta Hacker News, GitHub releases y YouTube con `dc_websearch` y `dc_youtube_*`.
   - Genera dos artefactos en `./noticias/YYYY-MM-DD-<tema>/`:
     - `report.md`: Redacción fluida en español, estilo narrativo, sin tablas complejas ni bullets excesivos.
     - `sources.md`: Auditoría de fuentes y nivel de confianza.

3. **Conversión a Audio (Opcional)**:
   - Si el usuario solicitó audio o se requiere un briefing hablado, ejecutar la herramienta `dc_markdown_to_audio`:
     ```json
     {
       "path": "./noticias/YYYY-MM-DD-<tema>/report.md",
       "language": "es",
       "speed": 160
     }
     ```
   - Informar al usuario la ruta del archivo `.wav` generado para reproducción.
