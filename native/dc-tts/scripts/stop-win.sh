#!/usr/bin/env bash
set -euo pipefail

PID_FILE="/tmp/dc-tts-win.pid"

if [[ -f "${PID_FILE}" ]]; then
  PID="$(cat "${PID_FILE}")"
  if kill -0 "${PID}" 2>/dev/null; then
    kill "${PID}" 2>/dev/null || true
  fi
  rm -f "${PID_FILE}"
fi

pkill -f "dc-tts-win" 2>/dev/null || true
echo "[dc-tts] Daemon stopped."
