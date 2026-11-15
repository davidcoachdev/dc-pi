# Fix: the dc-mobile viewer shows nothing

`[4] MOBILE` → `[Abrir visor]` opens a Kitty window that stays empty forever. The window is a real image surface (`kitten icat`), but nothing in the open path ever produces a frame: `openLiveViewer(serial)` only points the child script at `~/.cache/dc-mobile/<serial>/latest.png`, and only `dc_mobile_screen_inspect` ever writes that file. With no prior inspect, the child waits on a file that no writer creates.

## Specs

- **S1** Opening the viewer must show the device screen and keep it fresh on its own while the window stays open, with no further action from the user.
- **S2** Frames must be produced by a process outside the TUI: no adb call inside `render()`, and no timer (`setInterval`/`setTimeout`) in the extension process. The sidebar card contract in `skills/dc-mobile-testing/SKILL.md` stays true.
- **S3** The capture rate is bounded: one capture at a time, a missed tick is skipped rather than queued, and the cadence never exceeds what `adb exec-out screencap -p` costs (measured 0.75 s on a live 1080x2400 device). Frame files must not accumulate: the viewer reuses `latest.png` and removes its own older frames.
- **S4** When the capture cannot succeed, the window must say why in text (`adb`, `offline`, exit status, stderr first line). A blank window with a silent failure is the defect being fixed; the current child only checks spawn-level errors and ignores a nonzero `kitten icat` status.
- **S5** The sidebar card viewer line must report real freshness from the frame file: `último frame hace Ns` computed from the frame's mtime, `sin frames` only when no frame file exists, `abierto (pid N)` only while the tracked pid is alive.
- **S6** Closing the window stops the capture loop and leaves no orphan `adb` process.
- **S7** No regression: `dc_mobile_screen_inspect` keeps writing `frame-<ts>.png` and `latest.png` exactly as before, the existing viewer open path still accepts an explicit frame file, and the current test suites stay green.

## Tasks

- **T1** — Child script owns the capture loop: serial, frame path and adb binary arrive as arguments; one capture at a time, skip a tick while the previous one runs, atomic write of `latest.png`, bounded frame retention, text errors in the window, clean exit. `S1,S3,S4,S6`
- **T2** — `core/dc-mobile-viewer.ts` passes serial/frame/adb to the script, validates adb availability up front, and returns a failure reason that reaches the card log instead of a discarded spawn error. `S2,S4,S7`
- **T3** — Card viewer line reads frame freshness from the frame file mtime. `S5`
- **T4** — Tests: viewer argument mapping and failure reason with an injected spawn, card freshness from mtime, plus a regression test for the pre-existing explicit-frame open path. `S3,S5,S7`
- **T5** — Docs: skill and README say the viewer streams about one frame per second from adb and that it needs a connected device. `S1`

## Log

- **L1** (owner, verbatim): «bueno esta super pero cuando abreo el visor no me muestra nada» + «sigue».
- **L2** (evidence, orchestrador): causa raíz verificada por lectura de código: `views/dc-mobile-sidebar-card.ts:213` llama `openLiveViewer(serial)` sin frame; `core/dc-mobile-viewer.ts:199-210` sólo construye la ruta `latest.png`; el único productor de frames es `tools/dc-mobile-tools.ts:190-191`; `scripts/dc-mobile-viewer.mjs:71-72` dibuja «esperando frame...» cuando el archivo no existe.
- **L3** (evidence, orquestador): `~/.cache/dc-mobile/192.168.100.222_34661/` (serial activo) está vacío — sin `latest.png`. `adb devices -l` reporta ese serial `device`; `adb -s <serial> exec-out screencap -p` devuelve PNG válido 1080x2400 en 0.75 s. Sesión en Wayland (`WAYLAND_DISPLAY=wayland-0`), así que el `linux_display_server=wayland` de `viewer.ts:27` no es la causa.
- **L4** (frontera de rebanada, orquestador): T1-T5 suman ~590 líneas y van en un solo commit porque son un mismo comportamiento: la corrección, los tests que la prueban y la documentación del visor. Prueba funcional del bucle: el script hijo ejecutado contra el serial real escribió un PNG 1080x2400 válido y, sin TTY, dibujó `kitten icat falló (exit 1)`; sin procesos adb huérfanos al salir.
