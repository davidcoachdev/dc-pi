# 04 - Zettelkasten: Notas Atómicas y la Regla de los 10 Años (Rubén Loan)

- **Fuente:** Video de Rubén Loan: *"Tomar Notas de esta forma me ha Cambiado la Vida | Zettelkasten con Notion"*.
- **Metodología:** Sistema de cajas de notas de Niklas Luhmann (autor de 70 libros y 400 papers).
- **URL:** https://www.youtube.com/watch?v=2rV13AhSHgs

---

## 1. Resumen y Metodología
Rubén Loan explica cómo el consumo pasivo de información destruye el conocimiento a menos que pase por un proceso activo de procesamiento, atomicidad y reflexión. Zettelkasten divide las notas en Efímeras (fleeting), de Literatura (extractos con fuente) y Permanentes (zettels atómicos enlazados).

## 2. Principios de Oro para Agentes de Software
- **Principio de Atomicidad:** Una sola idea o decisión técnica por nota. Prohibido mezclar en un párrafo la configuración de base de datos con un arreglo de UI.
- **La Regla de los 10 Años (Autocontención Total):** Si volvés a leer la nota dentro de una década sin tener el libro (o el chat original) enfrente, debés entender exactamente qué se decidió, en qué contexto y por qué motivo.
- **Zero-Copy / Síntesis en Lenguaje Propio:** Copiar y pegar citas literales o stack traces crudos no es memoria; el agente debe digerir el síntoma y escribir la regla con sus propias palabras.
- **El Paso Obligatorio de Reflexión:** Acumular logs es información muerta; solo se vuelve conocimiento permanente cuando se reflexiona sobre las conexiones con notas previas.

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- Cada nota de bitácora en `docs/chronicle/` debe ser atómica (1 nota = 1 decisión o lección).
- Obligatoriedad de autocontención ("Prueba de los 6 meses"): contexto completo de qué archivo, qué función y qué efecto produce el cambio.
- Prohibición de stack traces gigantes en la bitácora: digestión obligatoria a reglas y patrones.
