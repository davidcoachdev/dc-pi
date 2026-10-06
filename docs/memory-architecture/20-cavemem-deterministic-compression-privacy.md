# 20 - Cavemem: Compresión Determinista Offline y Privacidad

- **Fuente:** Repositorio oficial `JuliusBrussee/cavemem` (Julius Brussee, TypeScript/Biome).
- **Core:** Compresión gramatical determinista offline (~75% menos tokens de prosa, código intacto).
- **URL:** https://github.com/JuliusBrussee/cavemem

---

## 1. Resumen y Filosofía
Cavemem parte de una premisa radical: *"¿Por qué el agente olvida cuando puede recordar?"*. En lugar de depender de llamadas lentas y caras a LLMs para comprimir recuerdos, implementa un motor de compresión gramatical offline determinista (Caveman Grammar) que recorta el relleno conversacional preservando los identificadores técnicos byte a byte.

## 2. El Pipeline de Compresión Determinista (Sin LLM)
```text
input ➔ tokenize ➔ [tokens preservados | prosa] ➔ transformar prosa ➔ unir ➔ salida
```

### A. Lo que se preserva byte a byte (Intocable):
- Bloques de código (triple comilla).
- Código inline (`variable`, `fn()`).
- URLs y rutas de archivos (`src/core/auth.ts`).
- Identificadores (`snake_case`, `camelCase`, `kebab-case`).
- Versiones (`v1.2.3`), fechas (`2026-10-06`) y números (`401`, `5000`).
- Encabezados Markdown (`#`, `##`).

### B. Lo que se poda en la prosa:
- Palabras de cortesía, rodeos y relleno (*"por favor tener en cuenta que"*, *"con el fin de proceder a"*).
- Artículos y muletillas gramaticales innecesarias.
- **Resultado:** Ahorro medido de entre **40% y 75% de tokens** de forma 100% determinista, instantánea (<5ms) y a costo cero de API.

## 3. Barrera de Privacidad (`<private>...</private>`)
Cualquier fragmento marcado dentro de etiquetas `<private>...</private>` se elimina quirúrgicamente en la frontera de escritura antes de tocar el almacenamiento local o los archivos Markdown. Además, soporta exclusión por globs de directorios (`.env`, `secrets/*`).

## 4. Recuperación Progresiva en 3 Pasos
Para evitar inundar el context window:
1. `search`: Devuelve listas compactas de títulos y coincidencias.
2. `timeline`: Muestra la secuencia temporal de las notas adyacentes.
3. `get_observations`: Recupera el cuerpo completo únicamente para los IDs seleccionados.

## 5. Qué adoptamos en DC Studio (`dc-sentinel`)
- **Compresor Offline de Prosa en `dc-sentinel`:** Reducir un 50% el tamaño de las notas de bitácora antes de inyectarlas en el contexto, sin gastar llamadas a LLMs y preservando las rutas de código intactas.
- **Filtro de Privacidad `<private>`:** Purgar cualquier dato sensible envuelto en esa etiqueta.
- **Recuperación Progresiva:** La ventana TUI y las tools muestran primero tarjetas compactas y solo cargan el detalle bajo demanda.
