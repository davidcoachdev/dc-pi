# 18 - Memvid: Smart Frames Inmutables y Time-Travel Debugging

- **Fuente:** Repositorio oficial `memvid/memvid` (Rust core).
- **Benchmark:** Latencia P50 de 0.025ms y P99 de 0.075ms.
- **URL:** https://github.com/memvid/memvid

---

## 1. Resumen y Filosofía
Memvid abandona los conceptos tradicionales de bases de datos y se inspira en el video digital: organiza la memoria como una secuencia continua de **Smart Frames inmutables y append-only** protegidos por un WAL embebido.

## 2. Hallazgos Clave
- **Smart Frames:** Cada hecho es un fotograma inmutable con timestamp, secuencia y checksum. Las escrituras jamás sobreescriben datos anteriores, garantizando seguridad absoluta contra fallos y corrupción.
- **Time-Travel Debugging:** Permite rebobinar o reproducir la memoria a cualquier punto en el tiempo (*"¿Qué sabía el agente el lunes antes de aplicar el cambio X?"*).
- **Cápsula de Archivo Único:** Todo el contenido, índices y metadatos se empaquetan en un único archivo portable.

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- Modelo de fotogramas secuenciales inmutables (append-only).
- Capacidad de **Time-Travel en la ventana TUI**: poder desplazarse con flechas `← / →` para ver la película de decisiones tomadas antes de un commit o incidente.
- Cápsula local autocontenida por proyecto (Directiva 2 de DC Studio).
