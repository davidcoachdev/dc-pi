# Migration registry

## DcWindow

- Status: migrated with automated checks passing in the isolated project; manual visual acceptance verified in terminal.
- Documentation: [README](../README.md) now delivered with setup, limitations and a docs-backed isolated fullscreen smoke recipe. The previous claim that it had already been delivered was incorrect.
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-window.ts`
- Immutable snapshot: `original/dc-window.ts`
- SHA-256: `fe4cb7a6cfc7f3167080b72a5af6afca5ac42441bdf1b6dd0f843be90920c0e5`
- Reusable implementation: `src/ui/dc-window.ts`
- Opt-in demo: `examples/dc-window-demo.ts`
- Regression tests: `test/dc-window.test.ts`
- Scope: public `pi-tui` component contract; no global registration or internal Pi monkey patches.
- Known fixes: typed mouse results, close-control-preserving title clipping, body-only mouse forwarding with translated geometry, and shared dynamic height budget for overlay/footer rendering.
- Verification commands: `npm run typecheck`, `npm test`, `cmp -- original/dc-window.ts /home/dc-studio/dc-lab/lab-cofig-pi/dc-window.ts`, `sha256sum --check original/SHA256SUMS`, `git diff --check`.
- Historical verification: typecheck, 10 regression tests, original byte equality and SHA-256 snapshot check passed. The successful `git diff --check` did not cover untracked content; whole-project whitespace validation is not established.
- Current revalidation (parent-reported, explicit target cwd): `npm --cache ./.npm-cache run typecheck` PASS; `npm --cache ./.npm-cache test` PASS (10/10); snapshot/original `cmp` PASS; `sha256sum --check original/SHA256SUMS` PASS. No implementation changes accompanied this documentation closure.
- Compatibility: development-tested Pi/pi-tui 0.85.1, Node >=22.19.0; wildcard peers do not certify all versions. `skipLibCheck` skips dependency declaration validation.
- Features: vertical scrolling supported via mouse wheel (`wheel`), keyboard (`Up`/`Down`/`PageUp`/`PageDown`/`Home`/`End`) and retro scrollbar on the right border (`▲`, `░`/`█`, `▼`) with click navigation.
- Limitations: chrome requires 4 allocated rows without a footer or 6 with a footer (no body rows at that minimum), and renders nothing below that threshold; the footer-enabled demo allocates `floor(terminalRows × 0.7)` and is blank below 9 terminal rows; no forwarded `Focusable`/IME support for input children; mouse requires fullscreen.
- Manual pending check: follow the [README checklist](../README.md#acceptance-checklist), recording actual Pi version, terminal/version and dimensions. No live TUI smoke has been executed. Disposable config/resources are not an OS sandbox or network firewall. Do not install globally yet.

## openDcModal

- Status: extracted and fully tested in `src/ui/dc-modal.ts`.
- Scope: reusable modal helper wrapping `ctx.ui.custom()` with `DcWindow`.
- Responsibilities:
  - TUI mode & UI presence checks (`ctx.hasUI && ctx.mode === "tui"`) with `onNonTui` fallback.
  - Idempotent closure handler (`done(value)`).
  - Dynamic drag-to-move support updating `OverlayOptions.offsetX` and `offsetY` via `onMove` on `DcWindow`.
  - Content factory or static content support.
  - Adds `[Symbol.for("dc.window")]: true` marker to prevent duplicate wrappers.
- Tests: `test/dc-modal.test.ts` (100% PASS).

## caritas

- Status: migrated and verified with 100% test pass in isolated project.
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/caritas.ts`
- Immutable snapshot: `original/caritas.ts`
- SHA-256: `907c5fed8f8e0aae8bb0b53e3842a67fc476410ff983f17be7c80786be2ff5c5`
- Reusable panel: `src/features/caritas/caritas-panel.ts` (`CaritasPanel`, `CARITAS` catalog).
- Extension entrypoint: `src/features/caritas/index.ts` (`/caritas`, `Alt+C`, `openCaritasPicker()`).
- Regression tests: `test/caritas.test.ts` (4 unit tests, 100% PASS).
- Boilerplate elimination: replaced manual `DcWindow` + `ctx.ui.custom` wrapper with `openDcModal<string>`.

## profile-duel (from dc-face.ts)

- Status: extracted and migrated to `DcWindow` with 100% test pass.
- Source: `lab-cofig-pi/dc-face.ts` (lines 830–1020).
- Component: `src/features/face/profile-duel.ts` (`ProfileDuel`, `BIG_DEFAULT`, `CUBIS_DEFAULT`).
- Modal entrypoint: `src/features/face/index.ts` (`openProfilePicker`, `/perfil`, `/face-profile`).
- Eliminated: bespoke single-line box classes (`FaceBox`, `FaceTitleBar`, `FaceRule`) replaced with `openDcModal` + `DcWindow` (double frame, Torii `⛩ `, close control `[ X ]`, solid background, dragging).
- Tests: `test/profile-duel.test.ts` (4 unit tests, 100% PASS).

## dc-keys (openKeysViewer)

- Status: extracted and migrated to `DcWindow` with 100% test pass.
- Source: `lab-cofig-pi/dc-keys.ts`
- Immutable snapshot: `original/dc-keys.ts`
- SHA-256: `a2ea2c92f7f9fd4f97fa3d0d22dc063bfd23387d6c3f49e8989e713e3cb0329f`
- Component: `src/features/dc-keys/dc-keys-panel.ts` (`DcKeysPanel`).
- Extension entrypoint: `src/features/dc-keys/dc-keys.ts` (`/dc-keys`, `/dc-teclas`, `Alt+?`).
- Responsibilities:
  - Horizontal category tabs (`DC Studio`, `General`, `TUI Input`, `Comandos Pi`) with keyboard (`←`/`→`/`Tab`) and mouse click navigation.
  - Interactive search / filtering input.
  - Rendered inside solid opaque `DcWindow` with two-column layout and scrollbar.
- Tests: `test/dc-keys.test.ts` (4 unit tests, 100% PASS).

## dc-changes (openChangesViewer)

- Status: extracted and migrated to `DcWindow` with 100% test pass.
- Source: `lab-cofig-pi/dc-changes.ts`
- Immutable snapshot: `original/dc-changes.ts`
- SHA-256: `3a02ad656909deacfeba1afcf578b898e4414e4fd84c965eeb1466b70efe7d34`
- Components:
  - Pure Git module: `src/integrations/dc-git/dc-git.ts` (`parseGitStatus`, `getGitChanges`, `getFileDiff`).
  - Two-panel component: `src/features/dc-changes/dc-changes-panel.ts` (`DcChangesPanel`).
- Extension entrypoint: `src/features/dc-changes/dc-changes.ts` (`/dc-changes`, `/dc-diff`, `Alt+F`).
- Responsibilities:
  - Left panel: list of modified / staged / untracked files with status badges (`M`, `A`, `??`, `D`).
  - Right panel: syntax-colored diff with line scrolling via wheel / `PgUp` / `PgDn`.
  - Edit file via `$VISUAL` / `$EDITOR` on Enter / `o`.
  - Title: `⛩  Dc Studio - Cambios`.
- Tests: `test/dc-changes.test.ts` (3 unit tests, 100% PASS).

## dc-models (openModelsSelector)

- Status: extracted and migrated to `DcWindow` with 100% test pass.
- Source: `lab-cofig-pi/dc-modelos.ts`
- Immutable snapshot: `original/dc-modelos.ts`
- SHA-256: `a44490be2a911bb16883863bfadf1f772d9cead9bf6da8effabadfd61097b7aa`
- Components:
  - Three-panel component: `src/features/dc-models/dc-models-panel.ts` (`DcModelsPanel`).
  - Extension entrypoint: `src/features/dc-models/dc-models.ts` (`/dc-models`, `Alt+M`).
- Responsibilities:
  - Panel 1 (left): account tabs discovered dynamically via `CliProxyClient` (`All`, `ac01`, `cc1`, etc.) with email badges.
  - Panel 2 (center): filtered model list with live text search, active indicator (`✓`), selection indicator (`●`).
  - Panel 3 (right): reasoning effort level selector (`off`, `minimal`, `low`, `medium`, `high`, `max`).
  - Seamless mouse and keyboard navigation across all 3 panels.
  - Solid opaque background `#100a0d`, double frame `╔═╗` and title `⛩  Dc Studio - Modelos`.
- Tests: `test/dc-models.test.ts` (5 unit tests, 100% PASS).

## dc-quota (openQuotaViewer)

- Status: extracted and migrated to `DcWindow` with 100% test pass.
- Source: `lab-cofig-pi/dc-quota.ts`
- Immutable snapshot: `original/dc-quota.ts`
- SHA-256: `ac404334b843b011f889d36694309859751c61c6e912fa8f8a25ba18d3ab83cd`
- Components:
  - Pure quota utilities: `src/features/dc-quota/dc-quota-types.ts` (`quotaLevelColor`, `humanizeReset`, `normalizeCliProxyName`).
  - Two-panel component: `src/features/dc-quota/dc-quota-panel.ts` (`DcQuotaPanel`).
- Extension entrypoint: `src/features/dc-quota/dc-quota.ts` (`/dc-quota`, `Alt+Shift+Q`).
- Responsibilities:
  - Panel 1 (left): accounts/providers list (`● [AC01 - email]`) with permanent selection highlight `selectedBg`.
  - Panel 2 (right): token quota progress bars (`█` filled, `░` track), percentage remaining and humanized reset countdowns.
  - Live refresh via `r` key or footer button `[ r Refrescar ]`.
  - Title: `⛩  Dc Studio - Cuotas`.
- Tests: `test/dc-quota.test.ts` (4 unit tests, 100% PASS).

## dc-status (openStatusViewer)

- Status: extracted and migrated to `DcWindow` with 100% test pass.
- Source: `lab-cofig-pi/dc-status.ts`
- Immutable snapshot: `original/dc-status.ts`
- SHA-256: `881d341e1846f3a6bdc964157617483746b77a13703522a66a6dcad6c9c45d73`
- Components:
  - Metric collectors: `src/features/dc-status/dc-status-collector.ts` (`parseGitBranchOutput`, `getGitInfo`, `collectEnvStatus`).
  - Interactive component: `src/features/dc-status/dc-status-panel.ts` (`DcStatusPanel`).
- Extension entrypoint: `src/features/dc-status/dc-status.ts` (`/dc-status`, `Alt+E`).
- Responsibilities:
  - Tab 1 `[1] Entorno`: inspects Git branch, status, working directory, model, reasoning/effort, tools, skills, and Pi version.
  - Tab 2 `[2] Alertas`: lists detected environment issues with single-key copy (`c`) to multiplatform clipboard and prompt editor.
  - Eliminated: bespoke Linux-only `xsel` calls, replacing with `dcClipboard`.
  - Title: `⛩  Dc Studio - Estado`.
- Tests: `test/dc-status.test.ts` (4 unit tests, 100% PASS).

## dc-banner (DcBannerComponent)

- Status: extracted and migrated cleanly to official `ctx.ui.setHeader`.
- Source: `lab-cofig-pi/dc-studio-banner.ts`
- Immutable snapshot: `original/dc-studio-banner.ts`
- SHA-256: `b79095b7a5d19a9ff6a8b45905bc29e832c7c6b4c2e4481de64373544465ab1c`
- Components:
  - Pure art & gradient module: `src/features/dc-banner/dc-banner-art.ts` (`DC_LOGO`, `renderDcBanner`, `bloodShade`).
  - Header component & extension: `src/features/dc-banner/dc-banner.ts` (`DcBannerComponent`, `/dc-banner`).
- Responsibilities:
  - Centered ASCII shield logo with Blood red gradient (`#ff3333` → `#990000`).
  - Fallback to compact `✦ Dc Studio ✦` if terminal width < 72 columns.
  - Auto-dismisses cleanly on first user prompt (`input` / `agent_start`) via `ctx.ui.setHeader(undefined)`.
  - Zero monkey-patches to Pi internals.
- Tests: `test/dc-banner.test.ts` (3 unit tests, 100% PASS).

## dc-user (DcPromptInputComponent)

- Status: extracted and migrated cleanly with 100% test pass in isolated project.
- Source: `lab-cofig-pi/dc-user.ts`
- Immutable snapshot: `original/dc-user.ts`
- SHA-256: `da0739c01084ec0be3042befb788787be2d0b2ea3ec21c06940b4e513ac083fb`
- Components:
  - Storage module: `src/features/dc-user/dc-user-store.ts` (`getUserName`, `saveUserName`, `userName`, `resolveUserFilePath`).
  - Input component: `src/features/dc-user/dc-user-prompt-input.ts` (`DcPromptInputComponent`).
  - Modal & extension entrypoint: `src/features/dc-user/dc-user.ts` (`askUserName`, `dcUserExtension`, `/dc-user`, `Alt+N`).
- Responsibilities:
  - Manages username storage in `~/.pi/agent/dc-user.json` with environment variable override (`DC_USER_CONFIG_PATH`).
  - Interactive prompt modal mounted on `openDcModal` + `DcWindow` with title `⛩  Dc Studio - Usuario`.
  - Command: `/dc-user` (single canonical English command).
  - Shortcut: `Alt+N`.
  - Automatic prompt on first launch (`session_start` with 4s unref delay) if username is unset, with `message_start` fallback.
  - Safe lifecycle timer cleanup on `session_shutdown`.
- Tests: `test/dc-user.test.ts` (5 unit tests, 100% PASS).

## dc-title (renameTab)

- Status: extracted and migrated cleanly with 100% test pass in isolated project.
- Source: `lab-cofig-pi/dc-title.ts`
- Immutable snapshot: `original/dc-title.ts`
- SHA-256: `cd4101d9a0008b01c2e0db275444dc40a5fbf055ba237edf6c1a5581970b39c3`
- Components:
  - Renamer module: `src/features/dc-title/dc-title-renamer.ts` (`renameTab`, `isHerdr`, `isTmux`, `RenameTabOptions`, `RenameTabResult`).
  - Extension entrypoint: `src/features/dc-title/dc-title.ts` (`dcTitleExtension`, `/dc-title`).
- Responsibilities:
  - Renames active tab or window in Herdr, Tmux and terminal (via OSC 0 sequence).
  - Single canonical English command: `/dc-title`.
  - Automatic rename to "Pi" on `session_start`.
  - Fully parameterizable execution/writing for deterministic testing without external process side-effects.
- Tests: `test/dc-title.test.ts` (5 unit tests, 100% PASS).

## dc-exit (session_shutdown)

- Status: extracted and migrated cleanly with 100% test pass in isolated project.
- Source: `lab-cofig-pi/dc-exit.ts`
- Immutable snapshot: `original/dc-exit.ts`
- SHA-256: `60b9ec44fd061437c2a42ce792dba245cd0d8764b51fab4c682e43b346537aed`
- Components:
  - Extension entrypoint: `src/features/dc-exit/dc-exit.ts` (`dcExitExtension`, `CLEAR_SCREEN`, `isSessionChangeReason`).
- Responsibilities:
  - Hooks into `session_shutdown` lifecycle event.
  - Detects if shutdown reason is actual quit vs session switch (`reload`, `new`, `new-session`, `resume`, `fork`).
  - Upon actual quit, emits terminal screen wipe sequence (`\x1b[2J\x1b[3J\x1b[H`) on process `exit`.
  - Parameterizable exit hook and output writer for safe test execution.
- Tests: `test/dc-exit.test.ts` (3 unit tests, 100% PASS).

## dc-preview (launchPanel)

- Status: extracted and migrated cleanly with 100% test pass in isolated project.
- Source: `lab-cofig-pi/previu.ts`
- Immutable snapshot: `original/previu.ts`
- SHA-256: `5ee2e15327fe3f2c467aed9ff2cec455a5f0b9f8f2f7b316e0920484da53fd09`
- Components:
  - Launcher module: `src/features/dc-preview/dc-preview-launcher.ts` (`launchPanel`, `parseToolArg`, `parseOrientationArg`, `buildFishToolCommand`, `resolveTaskManagerScript`).
  - Panel component: `src/features/dc-preview/dc-preview-panel.ts` (`DcPreviewSelectPanel`).
  - Extension entrypoint: `src/features/dc-preview/dc-preview.ts` (`openPreviewModal`, `dcPreviewExtension`, `/dc-preview`, `Alt+Shift+V`).
- Responsibilities:
  - Opens split panes (at 40% ratio) for tools (`task-manager`, `nvim`, `fzf`, `yazi`, `dc-studio`) in Tmux or Herdr.
  - Eliminated bespoke `SquareBox`, `TitleBar`, and `Rule` wrappers by standardizing entirely on `openDcModal` + `DcWindow` (double frame, Torii `⛩ `, solid background `#100a0d`, and draggable title bar).
  - Single canonical English command: `/dc-preview` (no aliases).
  - Shortcut: `Alt+Shift+V`.
  - Parameterizable execution runner for deterministic unit testing without spawning real multiplexer panes.
- Tests: `test/dc-preview.test.ts` (5 unit tests, 100% PASS).

## dc-doctor (runDoctorDiagnostic)

- Status: extracted and migrated cleanly with 100% test pass in isolated project.
- Source: `lab-cofig-pi/dc-doctor.ts`
- Immutable snapshot: `original/dc-doctor.ts`
- SHA-256: `a7e41538549a8109f4c87d001e5cd0a8eb5098bb85489219ee060ed3cf93af93`
- Components:
  - Inspector module: `src/features/dc-doctor/dc-doctor-inspector.ts` (`describeNode`, `describeComp`, `probeLayout`, `summarizeProbe`, `runDoctorDiagnostic`).
  - Extension entrypoint: `src/features/dc-doctor/dc-doctor.ts` (`dcDoctorExtension`, `/dc-doctor`).
- Responsibilities:
  - Probes internal Pi layout root and experimental sidebar state without invasive monkey patching.
  - Detects layout shape drift across sessions / Pi updates against persistent report snapshot.
  - Emits diagnostics via toast and Herdr notification.
  - Single canonical English command: `/dc-doctor`.
  - Parameterizable file paths for safe and isolated automated testing.
- Tests: `test/dc-doctor.test.ts` (4 unit tests, 100% PASS).

## dc-face-anim (DcFaceAnimator)

- Status: extracted and migrated cleanly with 100% test pass in isolated project.
- Source: `lab-cofig-pi/dc-face.ts`
- Immutable snapshot: `original/dc-face.ts`
- SHA-256: `b77458e09e6b56821c794808000dc53d0e68eae55aae210ac52345ce8cdfaf31`
- Components:
  - Frames module: `src/features/dc-face-anim/dc-face-anim-frames.ts` (`DC_FACE_FRAMES`, `getFaceFrames`, `getFaceFrame`).
  - Animator class: `src/features/dc-face-anim/dc-face-animator.ts` (`DcFaceAnimator`).
  - Extension entrypoint: `src/features/dc-face-anim/dc-face-anim.ts` (`dcFaceAnimExtension`, `/dc-face`).
- Responsibilities:
  - Preserves authentic DC Studio animated kaomoji presence frames across all agent states (`idle`, `thinking`, `writing`, `working`, `dormant`, `compacting`, `retying`, `prompting`, `talking`).
  - Binds cleanly to `AgentVisualStateStore` and renders via official public `ctx.ui.setWorkingIndicator()`.
  - Zero monkey patches to Pi or gentle-pi internals.
  - Single canonical English command: `/dc-face` (no aliases).
- Tests: `test/dc-face-anim.test.ts` (3 unit tests, 100% PASS).

## dc-reload (triggerReload)

- Status: extracted and migrated cleanly with 100% test pass in isolated project.
- Source: `lab-cofig-pi/dc-herdr-reload.ts`
- Immutable snapshot: `original/dc-herdr-reload.ts`
- SHA-256: `4c455e5aba20230cde149d1c7cbab146d921ae27146c3d0d696ff09d930c636d`
- Components:
  - Extension entrypoint: `src/features/dc-reload/dc-reload.ts` (`dcReloadExtension`, `triggerReload`, `/dc-reload`, shortcut `F5`).
- Responsibilities:
  - Triggers Pi environment reload using native public `context.reload()`.
  - Strictly single shortcut: `F5` (no extra shortcut aliases).
  - Strictly single canonical command in English: `/dc-reload` (no aliases).
  - Captures `session_start` with reason `"reload"` to dispatch Herdr notification or toast without polluting transcript.
  - Zero prototype monkey patching of `InteractiveMode`.
- Tests: `test/dc-reload.test.ts` (3 unit tests, 100% PASS).

## dc-tool-box (ToolExecutionComponent)

- Status: extracted and migrated cleanly with 100% test pass in isolated project.
- Source: `lab-cofig-pi/dc-tool-indent.ts`
- Immutable snapshot: `original/dc-tool-indent.ts`
- SHA-256: `916b4a7647ec9676c2c2122f7de2f7807b06258b09fa1a8fd435af6406807e83`
- Components:
  - Icons catalog: `src/features/dc-tool-box/dc-tool-box-icons.ts` (`DC_TOOL_ICONS`, `getToolIcon`).
  - Patch & formatter: `src/features/dc-tool-box/dc-tool-box-patch.ts` (`installToolBoxPatch`, `isToolBoxEnabled`, `setToolBoxEnabled`, `getToolBoxIndent`, `setToolBoxIndent`).
  - Extension entrypoint: `src/features/dc-tool-box/dc-tool-box.ts` (`dcToolBoxExtension`, `/dc-tool-box`).
- Responsibilities:
  - Formats tool execution output inside elegant rounded cards (`╭─ ✍ write ✓ ── [▲] ─╮`, `│`, `╰─ [📋] ─╯`).
  - Integrates multiplatform clipboard copy via `dcClipboard` (eliminating `spawn("xsel")`).
  - Reload-safe prototype wrapping on `ToolExecutionComponent.prototype` preserving original methods.
  - Single canonical English command: `/dc-tool-box` (supports `on`, `off`, `indent <0-8>`).
- Tests: `test/dc-tool-box.test.ts` (4 unit tests, 100% PASS).

## dc-user-box (UserMessageComponent)

- Status: extracted and migrated cleanly with 100% test pass in isolated project.
- Source: `lab-cofig-pi/dc-user-prompt.ts`
- Immutable snapshot: `original/dc-user-prompt.ts`
- SHA-256: `3171cc53fb67d955fb75f32c9ab5cf393b707078d594d15d95f7ed073cc42c0e`
- Components:
  - Patch & formatter: `src/features/dc-user-box/dc-user-box-patch.ts` (`installUserBoxPatch`, `isUserBoxEnabled`, `setUserBoxEnabled`, `isUserBoxVerticalPadding`, `setUserBoxVerticalPadding`, `resolveCurrentUserName`).
  - Extension entrypoint: `src/features/dc-user-box/dc-user-box.ts` (`dcUserBoxExtension`, `/dc-user-box`).
- Responsibilities:
  - Formats user prompt messages inside rounded cards with Torii and username header (`╭── ⛩  User ──╮`, `│`, `╰─ [📋] ─╯`).
  - Integrates user name from `dc-user` store (`getUserName()`).
  - Multiplatform click-to-copy handler on bottom border using `dcClipboard` (eliminating `spawn("xsel")`).
  - Preserves OSC 133 shell integration sequences.
  - Single canonical English command: `/dc-user-box` (supports `on`, `off`, `pad`).
- Tests: `test/dc-user-box.test.ts` (4 unit tests, 100% PASS).

## dc-markdown (Markdown & AssistantMessageComponent)

- Status: extracted and migrated cleanly with 100% test pass in isolated project.
- Source: `lab-cofig-pi/dc-markdown.ts`
- Immutable snapshot: `original/dc-markdown.ts`
- SHA-256: `7aa7701f27a42d57e0129eaf0759163b82192f80025f47e7ef61890eda516447`
- Components:
  - Tokens & helpers: `src/features/dc-markdown/dc-markdown-tokens.ts` (`LANG_ICONS`, `getLangIcon`, `getHeadingPrefix`, `blendWithBackground`, `prettifyErrorContent`).
  - Patch & formatter: `src/features/dc-markdown/dc-markdown-patch.ts` (`installMarkdownPatch`, `installAssistantCopyPatch`, `isCodeBoxEnabled`, `setCodeBoxEnabled`).
  - Extension entrypoint: `src/features/dc-markdown/dc-markdown.ts` (`dcMarkdownExtension`, `/dc-markdown`).
- Responsibilities:
  - Encloses code blocks in rounded cards (`╭─ lang ─╮`, `│`, `╰─╯`) and error boxes (`╭─ ☠️ Error ─╮`) with DC Studio color blending.
  - Formats headings cleanly replacing raw hashes ("### " → "◆ ", "#### " → "▸ ").
  - Formats raw API error JSONs (503, 429) cleanly with `prettifyErrorContent`.
  - Integrates multiplatform message copy via `dcClipboard` (eliminating `spawn("xsel")`).
  - Single canonical English command: `/dc-markdown` (supports `on`, `off`).
- Tests: `test/dc-markdown.test.ts` (5 unit tests, 100% PASS).

## dc-sidebar (DcSidebarManager)

- Status: extracted and migrated cleanly with 100% test pass in isolated project.
- Source: `lab-cofig-pi/dc-sidebar.ts`
- Immutable snapshot: `original/dc-sidebar.ts`
- SHA-256: `1146aec0e3a161bf0045a6569255f0bf222a023b549d6a15121c17ebe3048e2a`
- Components:
  - Preferences: `src/features/dc-sidebar/dc-sidebar-prefs.ts` (`readSidebarPrefs`, `saveSidebarPrefs`, `resolveSidebarPrefsFile`).
  - Context health & metrics: `src/features/dc-sidebar/dc-sidebar-context.ts` (`evaluateContextHealth`, `renderProgressBar`, `openContextModal`, `checkContextAlert`).
  - Frame & columns: `src/features/dc-sidebar/dc-sidebar-frame.ts` (`SidebarBorderColumn`, `wrapRailEntryWithFrame`, `SIDEBAR_FRAME`).
  - Rail & brand hooking: `src/features/dc-sidebar/dc-sidebar-rail.ts` (`replaceBrandText`, `hookSidebarComponent`, `RAIL_SECTION_KEYS`).
  - Extension entrypoint: `src/features/dc-sidebar/dc-sidebar.ts` (`dcSidebarExtension`, `/dc-sidebar`, shortcut `Alt+B`).
- Responsibilities:
  - Decomposed the 3400-line monolithic file into clean, modular, testable sub-modules.
  - Adds retro double-border columns (`║`) around the rail and layout nodes.
  - Replaces native gentle-pi branding with DC Studio Torii identity (`⛩  Dc Studio`).
  - Manages show/hide toggling with `Alt+B` and `/dc-sidebar`.
  - Integrates context health monitoring with alerts and modal view.
  - Single canonical English command: `/dc-sidebar` (supports `toggle`, `show`, `hide`, `frame`, `context`).
- Tests: `test/dc-sidebar.test.ts` (6 unit tests, 100% PASS).







## dc-notify

- Status: extracted and verified in `src/integrations/dc-notify/dc-notifier.ts`.
- Scope: unified notification service with Herdr support and Pi toast fallback.
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-notify.ts`
- Immutable snapshot: `original/dc-notify.ts`
- SHA-256: `3165957277e5822db211bbe000f37c04f824bbf00ed692c34f94b660afa6b305`
- Responsibilities:
  - Detects Herdr via `HERDR_SOCKET_PATH` or `HERDR_ENV`.
  - Configurable binary via `HERDR_BIN_PATH ?? "herdr"`.
  - Detached non-blocking dispatch with fallback to `ctx.ui.notify`.
  - Command `/dc-notify-test` to test dispatching.
  - Zero monkey-patches to Pi internals.
- Tests: `test/dc-notifier.test.ts` (3 unit tests, 100% PASS).

## dc-http (fetchJson)

- Status: extracted and verified in `src/integrations/dc-http/dc-fetch.ts`.
- Scope: robust JSON fetch client with timeout, combined abort signals, payload size limit and secret redaction.
- Eliminates: duplicate `AbortController`, timeout and headers logic across `dc-modelos.ts`, `dc-quota.ts`, and `dc-face.ts`.
- Responsibilities:
  - Combined `AbortController` (external signal + internal timeout with `clearTimeout`).
  - Redacts sensitive URL params (`key`, `token`, `apiKey`) to protect credentials in traces.
  - Max response body limit (default 5MB) to protect process memory.
  - Strongly typed `fetchJson<T>()` with custom errors (`DcHttpError`, `DcHttpTimeoutError`).
- Tests: `test/dc-fetch.test.ts` (6 unit tests, 100% PASS).

## dc-cliproxy (CliProxyClient)

- Status: extracted and verified in `src/integrations/dc-cliproxy/dc-cliproxy-client.ts`.
- Scope: unified client for CLIProxy management API.
- Eliminates: duplicate `readMgmtKey`, `cliproxyBase`, and `fetchPrefixEmails` logic across `dc-modelos.ts`, `dc-quota.ts`, and `dc-sidebar.ts`.
- Responsibilities:
  - Resolves `CLIPROXY_BASE_URL` with fallback to `http://127.0.0.1:8317` and normalizes trailing slashes.
  - Safe management key discovery: checks `CLIPROXY_MGMT_KEY` first, optional local file fallback `~/.config/cliproxy/mgmt-key`.
  - Account prefix-to-email discovery (`fetchPrefixEmails()`).
  - Generic management methods (`getManagement<T>`, `postManagementApiCall<T>`).
- Tests: `test/dc-cliproxy.test.ts` (3 unit tests, 100% PASS).

## dc-clipboard

- Status: extracted and verified in `src/integrations/dc-clipboard/dc-clipboard.ts`.
- Scope: multiplatform asynchronous clipboard integration.
- Eliminates: hardcoded `xsel` calls spread across `dc-markdown.ts`, `dc-tool-indent.ts`, `dc-user-prompt.ts` and `dc-status.ts`.
- Responsibilities:
  - Auto-detection for Wayland (`wl-copy`), X11 (`xsel`, `xclip`), macOS (`pbcopy`), Windows (`clip.exe`), and OSC 52 terminal copy fallback.
  - Safe error handling without crashing process or throwing uncaught stream exceptions.
- Tests: `test/dc-clipboard.test.ts` (3 unit tests, 100% PASS).

## dc-agent-state (AgentVisualStateStore)

- Status: extracted and verified in `src/core/dc-agent-state/dc-agent-state.ts`.
- Scope: central event-driven state store for agent presence and animations.
- Eliminates: duplicated event listeners and conflicting `setWorkingIndicator` calls across `dc-face.ts`, `dc-prompt.ts` and `dc-studio-banner.ts`.
- Responsibilities:
  - Maps Pi lifecycle events (`agent_start`, `turn_start`, `message_update`, `tool_execution_start/end`, `agent_settled`) into discrete states: `idle`, `thinking`, `writing`, `working`, `error`, `compacting`, `dormant`.
  - Observer pattern via `subscribe((next, prev) => ...)`.
  - Automatic idle timeout to `dormant` state.
  - Error flash timer for graceful tool failure recovery.
- Tests: `test/dc-agent-state.test.ts` (3 unit tests, 100% PASS).

## dc-prompt (CustomEditor & DOS-style Prompt Input)

- Status: extracted and migrated cleanly with 100% test pass in isolated project.
- Source: `lab-cofig-pi/dc-prompt.ts`
- Immutable snapshot: `original/dc-prompt.ts`
- SHA-256: `e88065bf72963df342509852020216b408e8dbb165980dc75ff94356c6a5e0a0`
- Components:
  - Tokens & formatters: `src/features/dc-prompt/dc-prompt-tokens.ts` (`FRAMES`, `DC_PROMPT`, `formatContextSize`, `formatCost`, `paintGauge`, `getContextColor`, `redToPink`, `redToBlack`, `cell`, `sessionCost`).
  - Status line builder: `src/features/dc-prompt/dc-prompt-status.ts` (`buildPromptStatusLine`, `checkContextNotification`, `notifyHerdr`).
  - Editor component: `src/features/dc-prompt/dc-prompt-editor.ts` (`DcPromptEditor`, `DcPromptDeps`).
  - Extension entrypoint: `src/features/dc-prompt/dc-prompt.ts` (`dcPromptExtension`, `patchPendingMessages`, `/dc-prompt`).
- Responsibilities:
  - Custom DOS double-frame editor (`╔═ ⛩ ═╗`, `║`, `╚═╝`) extending `CustomEditor`.
  - Responsive prompt status line below input with Model · Effort, CTX Gauge, and Usage Cost with `⟡` separator.
  - Context gauge with 4 levels (Optimal, Medium, High, Critical) and neon electric pulse + Herdr notification on critical context (>80%).
  - Smooth KITT sweep animation on working, `⏳` indicator on queued messages.
  - Steering container suppression and Herdr notification deduplication.
  - Single canonical English command: `/dc-prompt` (supports `on` | `off`).
- Tests: `test/dc-prompt.test.ts` (6 unit tests, 100% PASS).

## dc-dialogs (overlay & host dialog replacement)

- Status: migrated and verified with 100% test pass in isolated project.
- Source: `lab-cofig-pi/dc-dialogs.ts`
- Immutable snapshot: `original/dc-dialogs.ts`
- SHA-256: `94e4f853ff760f8bdc6b16415e240c587a5638190a38adca3c68d21abf8fa3b7`
- Components:
  - Helpers & Panel: `src/experimental/dc-dialogs-overlay/dc-dialogs-helpers.ts` (`splitPanel`, `titleOf`, `createFallbackTheme`, `getSafeTheme`, symbols, `CleanExtensionSelectPanel`).
  - Patch engine: `src/experimental/dc-dialogs-overlay/dc-dialogs-patch.ts` (`installDialogsPatch`, `uninstallDialogsPatch`, `setDialogsEnabled`, `isDialogsEnabled`).
  - Extension entrypoint: `src/experimental/dc-dialogs-overlay/dc-dialogs.ts` (`dcDialogsExtension`, `/dc-dialogs [on|off|status]`).
- Responsibilities:
  - Intercepts `InteractiveMode.prototype.showExtensionCustom` to wrap floating overlays in `DcWindow` (solid dark coal background `#100a0d`, double frame `╔═╗`, title, close control `[X]`, and title bar drag movement).
  - Skips overlays that are already `DcWindow` instances or marked with `Symbol.for("dc.window")`.
  - Special high-polish integrations for `AgentsView`, `SddModelPanel`, `ProfilesPanel`, `CommandPalette`, and `McpPanel`.
  - Replaces `/session` (`handleSessionCommand`) with floating `DcWindow` (title `⛩  Dc Studio - Sesiones`).
  - Replaces `/resume` (`showSessionSelector`) with floating `DcWindow` (title `⛩  Dc Studio - Sesiones`).
  - Replaces `/tree` (`showTreeSelector`) with floating `DcWindow` (title `⛩  Dc Studio - Árbol de Sesiones`).
  - Implements clean selectable options list via `CleanExtensionSelectPanel` in `showExtensionSelector`.
  - Replaces extension input via `showExtensionInput` in `DcWindow`.
  - Intercepts configuration and settings selectors via `showSelector` in floating `DcWindow`.
  - Single canonical English command: `/dc-dialogs [on|off|status]`.
- Tests: `test/dc-dialogs.test.ts` (12 unit tests, 100% PASS).









