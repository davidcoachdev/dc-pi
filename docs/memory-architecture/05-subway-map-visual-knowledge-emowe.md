# 05 - La Metáfora del Metro: Visualización y Conectividad (Emowe)

- **Fuente:** Video de Emowe: *"Cómo tomar notas para siempre | Método Zettelkasten explicado con ejemplos visuales"*.
- **Concepto Rector:** El Mapa del Metro Subterráneo para la navegación del conocimiento.
- **URL:** https://www.youtube.com/watch?v=XsAKJLWunOM

---

## 1. Resumen y Metáfora Visual
Emowe traduce la notación compleja de Luhmann a una metáfora accesible e intuitiva:
- **Líneas de metro de colores:** Son las líneas temáticas de conocimiento (secuencias lógicas de notas sobre un área específica).
- **Paradas de metro:** Son las notas atómicas individuales.
- **Estaciones de transbordo (paradas compartidas):** Son las notas donde dos temas se cruzan (por ejemplo, matemáticas y astronomía). Permiten cambiar de contexto y saltar de una línea a otra.
- **Acceso no secuencial:** Podés entrar a la red en cualquier parada sin tener que recorrer toda la línea desde la cabecera.

## 2. Impacto en Interfaces para Desarrolladores
Una bitácora de software no puede ser un scroll infinito de texto cronológico. Debe estructurarse como un plano de transporte interconectado donde el desarrollador puede seguir un hilo temático o saltar de un subsistema a otro a través de decisiones que conectan áreas.

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- **Diseño de la Ventana TUI (`openSentinelViewer`):**
  - Panel lateral con **Líneas de Metro Temáticas por Colores**:
    - 🔴 L1: Arquitectura y Core
    * 🟡 L2: Seguridad y Auth
    * 🟢 L3: Persistencia y Storage
    * 🟣 L4: Subagentes y Tareas
    * ⚒ L5: Procedimientos y Fixes
  - **Estaciones de Transbordo Interactivas:** Al navegar una nota con `Enter`, saltar directamente a la línea conectada para entender el impacto lateral.
