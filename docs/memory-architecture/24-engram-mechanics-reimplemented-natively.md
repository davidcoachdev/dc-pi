# 24 - Mecánicas Internas de Engram: Reimplementación Nativa Soberana

- **Fuente:** Auditoría forense al schema y motor interno de Engram v3.0 (`~/.engram/engram.db` y `gentle-engram`).
- **Objetivo:** Reimplementar sus mejores mecanismos algorítmicos en TypeScript nativo para `dc-sentinela`, sin depender del binario ni de la app externa.

---

## 1. El Mecanismo de Topic Keys y Contador de Revisiones (`topic_key`)
En la tabla `observations` de Engram, el campo `topic_key` resuelve la fragmentación de la memoria:
* **El Problema:** Si el agente anota en el turno 3 *"Auth usa JWT"*, en el turno 12 *"Auth agrega refresh token"* y en el turno 25 *"Auth valida expiración"*, un sistema ingenuo crea 3 notas desconectadas.
* **La Solución de Engram:** Todas comparten el `topic_key: "auth-strategy"`.
  * La base de datos no duplica: ejecuta un **upsert semántico**.
  * Incrementa `revision_count` (Versión 1 ➔ Versión 2 ➔ Versión 3).
  * Actualiza `last_seen_at`.
  * Preserva la estabilidad temática del conocimiento.

## 2. Hash Normalizado y Contador de Duplicados (`normalized_hash`)
* Cuando se genera una observación, se calcula un hash del contenido normalizado (minúsculas, espacios colapsados, puntuación filtrada).
* Si el agente intenta guardar una lección idéntica que ya existía:
  * No crea una fila nueva ni gasta espacio.
  * Incrementa `duplicate_count` (+1) y refresca `last_seen_at`.
  * Esto sirve además como indicador empírico de refuerzo: una lección con `duplicate_count: 5` tiene alta frecuencia en el proyecto.

## 3. SQLite FTS5 con Tokenizador `trigram` y Triggers SQL Automáticos
En lugar del tokenizador de palabras estándar (`unicode61`), Engram usa **`tokenize='trigram'`**:
* **Por qué trigram es vital para programadores:**
  Los tokenizadores de palabras comunes fallan cuando buscás subcadenas dentro de identificadores de código (como buscar `Token` o `Auth` dentro de `verifySessionToken`). El tokenizador trigrama divide el texto en bloques de 3 caracteres, permitiendo búsquedas de subcadenas exactas y tolerantes a errores dentro de nombres de funciones, archivos y variables.
* **Triggers SQL a nivel de Base de Datos:**
  El índice FTS5 se mantiene sincronizado mediante triggers automáticos en SQLite (`AFTER INSERT`, `AFTER UPDATE`, `BEFORE DELETE`). Cero código boilerplate en TypeScript; la base de datos se encarga de la integridad.

## 4. El Motor de Relaciones y Juicios (`memory_relations`)
Engram modela las conexiones y contradicciones en una tabla formal de relaciones:
* **Tipos de relación:** `related`, `compatible`, `scoped`, `conflicts_with`, `supersedes`, `not_conflict`.
* Cada relación guarda `confidence` (0.0 a 1.0), `evidence` (citas de texto) y `reason` (por qué se llegó a ese veredicto).
* Esto implementa el mecanismo formal para que una decisión nueva invalide y reemplace (`supersedes`) a una vieja con respaldo de auditoría.

## 5. Memorias Ancladas (`pinned = 1`) y Soft-Delete
* **`pinned: 1`:** Permite fijar directivas maestras que jamás pueden ser podadas ni afectadas por algoritmos de decaimiento temporal.
* **`deleted_at`:** Ninguna memoria se borra físicamente por defecto. Cuando el usuario presiona `[d]` en la TUI, se estampa la fecha de borrado lógico, permitiendo auditoría y recuperación instantánea (`Undo`).

---

## 6. Qué Reimplementamos Nativamente en `dc-sentinela` (TypeScript Puro)
1. **Tabla de notas con `topic_key` y `revision_count`** en `dc-sentinela/.cache/sentinel.db`.
2. **Índice FTS5 con `trigram` y triggers SQL nativos** usando `node:sqlite`.
3. **Deduplicación por `normalized_hash`** para no inflar la base de datos.
4. **Tabla de relaciones `supersedes` y `conflicts_with`** para resolver contradicciones.
5. **Flags `pinned` y `deleted_at`** para control humano en la ventana TUI.
