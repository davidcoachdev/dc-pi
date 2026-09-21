# DC Face — Subsistema de Caritas y Presencia Animada

Este subsistema gestiona la presencia visual, kaomojis de una línea, carotas grandes ASCII y animaciones reactivas del agente en DC Studio.

## Estructura Modular

```
src/features/dc-face/
├── art/                      # Catálogo extensible de caras
│   ├── dcdev.ts              # Perfil 'dcdev' (orgánico, wavy, corazón)
│   ├── cubis.ts              # Perfil 'cubis' (boxy / robot)
│   ├── mini.ts               # Mini-caritas de 1 línea para terminales bajas y Bottom Bar
│   ├── painter.ts            # Coloreado semántico ANSI (paintBigLine)
│   └── index.ts              # Registro dinámico (registerFaceProfile, listFaceProfiles)
├── core/
│   ├── dc-face-types.ts      # Tipos, Modos, constantes (BIG_FACE_MIN_ROWS = 46)
│   ├── dc-face-prefs.ts      # Persistencia en ~/.pi/agent/dc-face.json
│   └── dc-face-bridge.ts     # Cliente HTTP polling bridge TTS (:9877)
├── views/
│   └── dc-profile-duel.ts    # Modal ProfileDuel sobre openDcModal + DcWindow
├── dc-face.ts                # Extensión de Pi (/dc-face, Alt+C, animación)
└── index.ts                  # Exportaciones públicas
```

## Agregar una Nueva Carita

Para sumar un nuevo perfil (ej: `neko`):
1. Crear `src/features/dc-face/art/neko.ts` con su matriz de frames (default, dormir, pensar, etc.).
2. En `src/features/dc-face/art/index.ts`, registrarlo con `registerFaceProfile(NEKO_PROFILE)`.
3. Para la evolución del selector a 3 o más columnas dinámicas, consultar el documento [RFC N-Way Profiles](../../../odd/tasks/face-profiles-n-way-rfc.md).
