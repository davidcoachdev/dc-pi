#!/usr/bin/env bash
set -euo pipefail

smoke_root=$(mktemp -d /tmp/dc-window-smoke.XXXXXX)
mkdir -p "$smoke_root/work" "$smoke_root/agent" "$smoke_root/sessions"
printf '{"tui.editor.cursorWordRight":["alt+right","ctrl+right"],"tui.editor.cursorWordLeft":["alt+left","ctrl+left"]}\n' > "$smoke_root/agent/keybindings.json"
printf 'Smoke temporaries at: %s\n' "$smoke_root"
cd "$smoke_root/work"

exec env -u PI_PACKAGE_DIR -u PI_TUI_WRITE_LOG \
  PI_CODING_AGENT_DIR="$smoke_root/agent" \
  PI_CODING_AGENT_SESSION_DIR="$smoke_root/sessions" \
  PI_OFFLINE=1 PI_TELEMETRY=0 \
  node /home/linuxbrew/.linuxbrew/opt/pi-coding-agent/libexec/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js \
  --no-session --session-dir "$smoke_root/sessions" \
  --no-approve --no-extensions --no-skills --no-prompt-templates \
  --no-themes --no-context-files --no-tools \
  --tui-mode fullscreen --use-theme dark \
  -e /home/dc-studio/.pi/agent/git/github.com/Gentleman-Programming/gentle-pi/extensions/gentle-ai.ts \
  -e /home/dc-studio/.pi/agent/git/github.com/Gentleman-Programming/gentle-pi/extensions/gentle-shell.ts \
  -e /home/dc-studio/.pi/agent/git/github.com/Gentleman-Programming/gentle-pi/extensions/gentle-todo.ts \
  -e /home/dc-studio/.pi/agent/git/github.com/Gentleman-Programming/gentle-pi/extensions/gentle-agents.ts \
  -e /home/dc-studio/dc-lab/dc-projects/dc-pi/src/index.ts \
  -e /home/dc-studio/dc-lab/dc-projects/dc-pi/examples/dc-window-demo.ts
