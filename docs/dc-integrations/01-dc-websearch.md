# DC WebSearch (`dc-websearch`) — Especificación de Integración

**Módulo:** `src/features/dc-websearch/` (o `src/integrations/dc-websearch/`)  
**Ecosistema:** DC Studio (`dc-pi`)  
**Inspiración:** Motor de búsqueda multi-fuente de `j0k3r-pi/extensions/websearch` (adaptado a la arquitectura y estándares de DC Studio).

---

## 1. Visión y Propósito

`dc-websearch` es el motor de búsqueda e investigación técnica profunda de DC Studio para Pi. 

A diferencia de las herramientas web estándar que realizan búsquedas genéricas por palabras clave, `dc-websearch` está diseñado para alimentar a los subagentes de desarrollo (`dc-researcher`, `dc-news-to-day`) mediante **4 cuadrantes especializados**:

1. **Búsqueda Web de Precisión (LLM-First)**: Exa como motor primario (orientado a código y contexto técnico) con failover automático a Parallel. Lector `dc_web_fetch` resistente a SSRF con sanitización `html-to-text`.
2. **Discusiones Técnicas y Comunidad (`dc_discussion_*`)**: Búsqueda e inspección atómica en Stack Overflow, Unix/Linux, Server Fault, GitHub Issues/PRs/Discussions, Dev.to y Hacker News (Algolia API).
3. **Investigación Académica y Especificaciones (`dc_research_*`)**: Consultas a arXiv, OpenAlex, Semantic Scholar, Crossref y Europe PMC, incluyendo exploración de grafos de citas (`dc_research_graph_get`).
4. **Inspección de Repositorios y Código Público (`dc_github_*`)**: Búsqueda de código público con Octokit o CLI `gh`, descarga precisa de archivos en ramas/tags específicos y lectura de release notes oficiales.

---

## 2. Arquitectura Conforme a las 10 Directivas de DC Studio

### Directiva 1: Desacoplamiento Estricto por Capas
```
src/features/dc-websearch/
├── core/                       # Tipos puros, interfaces y formateadores (Cero imports de Pi)
│   ├── dc-websearch-types.ts
│   ├── dc-websearch-normalizer.ts
│   └── dc-websearch-security.ts # Sanitización de secretos [REDACTED_SECRET] y validación anti-SSRF
├── providers/                  # Conectores HTTP nativos (Node 22 fetch)
│   ├── web/                    # Exa & Parallel clients
│   ├── discussions/            # StackExchange, GitHub (Octokit/gh), HackerNews, Dev.to
│   └── research/               # arXiv, OpenAlex, Semantic Scholar, Crossref
├── tools/                      # Registro y esquemas TypeBox de tools para Pi
│   ├── dc-tool-web.ts          # dc_web_search, dc_web_fetch
│   ├── dc-tool-discussions.ts  # dc_discussion_search, dc_discussion_get, dc_discussion_answers_get
│   ├── dc-tool-research.ts     # dc_research_search, dc_research_get, dc_research_graph_get
│   └── dc-tool-github.ts       # dc_github_code_search, dc_github_get
├── dc-websearch.ts             # Entrypoint de extensión Pi (registro de tools y comandos)
└── index.ts                    # Barril público de exportación
```

### Directiva 2: Persistencia Aislada
- **Ruta de configuración:** `~/.pi/agent/dc-studio/websearch.json`.
- Resuelto exclusivamente mediante `resolveDcConfigPath("websearch")`.
- **Estructura de configuración:**
  ```json
  {
    "github": {
      "provider": "api" // "api" | "gh"
    },
    "request": {
      "timeoutMs": 60000,
      "maxRetries": 1
    }
  }
  ```
- **Credenciales y Tokens:** Se leen **únicamente** desde variables de entorno (`EXA_API_KEY`, `PARALLEL_API_KEY`, `GITHUB_TOKEN`, `STACK_EXCHANGE_KEY`, `SEMANTIC_SCHOLAR_API_KEY`). Nunca se persisten tokens en JSON.

### Directiva 4: Notificaciones y Telemetría
- Fallbacks, límites de cuota y advertencias de conectividad se canalizan mediante `dcNotifier` hacia Herdr y la UI de Pi.

---

## 3. Catálogo de Herramientas Públicas (`tools`)

### A. Cuadrante Web
- `dc_web_search`: Búsqueda web filtrada por fecha (`afterDate`, `beforeDate`), dominios y modo (`fast`, `auto`, `deep`).
- `dc_web_fetch`: Descarga y limpia páginas HTML a Markdown/texto puro. Límite de 2 MB, protección contra bucles de redirección y bloqueo estricto de IPs privadas/locales (`127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`).

### B. Cuadrante Discusiones y Comunidad
- `dc_discussion_search`: Búsqueda agregada o filtrada en Stack Overflow, GitHub (issues/PRs/discussions) y Hacker News.
- `dc_discussion_get`: Obtiene una discusión o issue específico sin traer datos innecesarios.
- `dc_discussion_answers_get`: Obtiene específicamente las respuestas más votadas o aceptadas de Stack Exchange.
- `dc_discussion_comments_get`: Extrae hilos de comentarios y revisiones.

### C. Cuadrante Investigación
- `dc_research_search`: Búsqueda en arXiv, OpenAlex, Semantic Scholar y Crossref.
- `dc_research_get`: Descarga abstract, autores y metadata de un paper específico (DOI, arXiv ID).
- `dc_research_graph_get`: Trae referencias y citas cruzadas de un trabajo científico.

### D. Cuadrante GitHub
- `dc_github_code_search`: Búsqueda precisa de código en GitHub público devolviendo referencias `owner/repo:path`.
- `dc_github_get`: Descarga metadatos de repositorios, archivos exactos en un commit/rama o notas de versión (`releases`).

---

## 4. Estrategia de Implementación y Fases

1. **Fase 1 (Core Web & Discusiones)**: Implementar cliente de búsqueda web (Exa/Parallel fallback) y conectores de StackExchange/HackerNews.
2. **Fase 2 (GitHub & Code Search)**: Conector con Octokit y fallback a CLI `gh`.
3. **Fase 3 (Research Académico)**: Conectores con arXiv y OpenAlex.
4. **Fase 4 (Integración con Subagentes)**: Vincular las nuevas tools a `dc-researcher` y `dc-news-to-day`.
