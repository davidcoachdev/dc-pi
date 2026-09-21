# RFC: Selector N-way Dinámico de Perfiles de Carita (3 o más caras en art/)

**Estado:** Propuesta de arquitectura futura (RFC)  
**Ubicación:** `odd/tasks/face-profiles-n-way-rfc.md`  
**Módulos relacionados:** `src/features/dc-face/art/`, `src/features/dc-face/views/dc-profile-duel.ts`

---

## 1. Contexto y Motivación

Actualmente el sistema de caritas de DC Studio cuenta con dos perfiles oficiales:
- `dcdev`: Estilo orgánico con pelo ondulado (`~`), ojos de corazón (`♥`) y marco curvo.
- `cubis`: Estilo robot / boxy geométrico con esquinas `┌─┐`.

El selector modal actual (`ProfileDuel`) está diseñado en un duelo de 2 columnas (`0 | 1`) lado a lado en una ventana de 62 columnas.

Con la nueva carpeta modular `src/features/dc-face/art/` y el registro extensible `registerFaceProfile()`, es trivial agregar un 3er o 4to perfil (ejemplo: `neko.ts`, `cyber.ts`, `retro.ts`). Este documento especifica cómo evolucionará la interfaz de selección para soportar N caras sin romper el diseño.

---

## 2. Especificación del Layout N-way

### Caso 1: 3 Caras en Terminal Estándar (Ancho ≥ 78 columnas)

Cada celda de cara mide unas 22 columnas de ancho visible:
- **Ancho por columna:** `colW = Math.max(20, Math.floor((inner - (N - 1) * 3) / N))`
- Para 3 caras: `22 + 1 (│) + 22 + 1 (│) + 22 = 68 cols` útiles.
- La ventana `DcWindow` se abre con ancho dinámico: `width = Math.min(100, N * 24 + 6)`.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ⛩  Dc Studio - Selector de Perfiles                                  [ X ] │
╠════════════════════════════════════════════════════════════════════════════╣
│      │~    ▲▲▲▲▲    ~│      │  ▲▲▲▲▲▲▲  ▲▲▲▲▲▲▲  │      │     /\_/\      │
│      │══║  ♥  ║═══║ │      │  ║  ♥  ║  ║  ♥  ║  │      │    ( o.o )     │
│             ╩               │          ╩         │             > ^ <       │
│                             │                    │                         │
│           ◉ dcdev           │       ○ cubis      │         ○ neko          │
╠════════════════════════════════════════════════════════════════════════════╣
│ ←→ elegir  ·  Enter usar  ·  Esc cerrar                           [ Usar ] │
└────────────────────────────────────────────────────────────────────────────┘
```

#### Reglas de Renderizado:
1. Las líneas divisorias verticales `│` se generan en loop mediante `cells.join(` ${div} `)`.
2. Las líneas vacías de padding (arriba, entre cara y etiqueta, y abajo) mantienen las barras `│` en las columnas exactas, garantizando continuidad vertical de arriba a abajo.
3. El footer nativo de `DcWindow` permanece inalterado:
   - Izquierda: `←→ elegir  ·  Enter usar  ·  Esc cerrar`
   - Derecha: `[ Usar ]`

---

### Caso 2: 4 o más Caras (o Terminal Angosta < 75 columnas)

Si el número de perfiles supera 3 o la terminal no tiene ancho suficiente para renderizarlos en paralelo, se activa uno de los dos patrones responsivos:

#### Patrón A: Carrusel de Duelo (Viewport deslizante de 2 en 2)
- Mantiene la ventana clásica de 60 cols.
- Muestra 2 caras a la vez, con indicadores de navegación en los extremos:
  `[ ◀ ] [ Cara N ] │ [ Cara N+1 ] [ ▶ ]`
- Con `←` y `→` se desliza el carrusel circularmente.

#### Patrón B: Paginación por Pestañas (`DcTabs`)
- Utiliza la primitiva `DcTabs` de `src/ui/dc-tabs.ts` arriba del cuerpo:
  `[ 1 dcdev ]  [ 2 cubis ]  [ 3 neko ]  [ 4 cyber ]`
- Muestra la cara seleccionada grande en el centro o un duelo de 2 caras según la pestaña activa.

---

## 3. Plan de Implementación Futuro

1. Generalizar `ProfileDuel` en `ProfilePicker`:
   - Cambiar `selected: 0 | 1` por `selectedIndex: number` (`0..profiles.length - 1`).
   - Reemplazar las llamadas directas a `BIG_DEFAULT` y `CUBIS_DEFAULT` por `listFaceProfiles()`.
2. Soportar navegación circular:
   - `Left`: `(selected - 1 + N) % N`
   - `Right` o `Tab`: `(selected + 1) % N`
3. Clic con el mouse:
   - Calcular la columna clickeada con base en `event.x / (colW + 1)`.
4. El footer nativo `[ Usar ]` confirma `listFaceProfiles()[selectedIndex].id`.
