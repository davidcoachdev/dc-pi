# DC Git Sync Awareness (`dc-git-sync`) — Especificación de Integración

**Módulo:** `src/features/dc-git-sync/`  
**Ecosistema:** DC Studio (`dc-pi`)  
**Inspiración:** Hook `before_agent_start` de `j0k3r-pi/extensions/git-sync-awareness`.

---

## 1. Visión y Propósito

`dc-git-sync` es un guardián de sincronización de Git no invasivo. Su objetivo es evitar que el agente comience a planificar, editar o refactorizar sobre una rama de trabajo que está **desactualizada respecto al remoto** o que tiene **divergencia no resuelta**.

Al iniciar una sesión o en el primer turno de trabajo (Turn 1), `dc-git-sync` realiza un chequeo pasivo en milisegundos y, si detecta commits pendientes de push, commits entrantes sin mergear o desincronización con el upstream, inyecta un diagnóstico claro tanto en la interfaz visual de DC Studio como en el contexto inicial del agente.

---

## 2. Arquitectura Conforme a DC Studio

```
src/features/dc-git-sync/
├── core/
│   ├── dc-git-sync-types.ts      # Interfaces de diagnóstico (behind/ahead, diverged, clean)
│   └── dc-git-sync-inspector.ts  # Comandos de inspección git (rev-parse, fetch dry-run, status)
├── dc-git-sync.ts                # Hook de ExtensionAPI (session_start, before_agent_start)
└── index.ts                      # Exportación pública
```

### Directivas Aplicadas:
- **Directiva 6 (Cero Polling)**: Se ejecuta una única vez por turno en `before_agent_start` o cuando el usuario dispara el comando `/dc-git-sync`. No corre bucles de fondo.
- **Directiva 5 (Git Seguro)**: Estrictamente de **solo lectura**. No ejecuta `git pull`, `git merge`, ni `git fetch` destructivos. Si hace fetch remoto, usa timeouts estrictos (máx 3s) y nunca muta el árbol de trabajo.
- **Directiva 4 (Notificaciones)**: Si hay desincronización crítica (ej. la rama remota avanzó 10 commits), notifica mediante `dcNotifier` y muestra un badge en `dc-sidebar`.
