#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${WSL_BRIDGE_PORT:-9876}"
HTTP_PORT="${DC_TTS_HTTP_PORT:-9877}"
BIN_DIR="${HOME}/.pi/agent/dc-studio/bin"
PID_FILE="/tmp/dc-tts-win.pid"
LOG_FILE="/tmp/dc-tts-win.log"

mkdir -p "${BIN_DIR}"
rm -f /mnt/c/Windows/Temp/dc-tts-win.exe 2>/dev/null || true

bash "${ROOT_DIR}/scripts/stop-win.sh" >/dev/null 2>&1 || true

echo "[dc-tts] Building static Go binaries (${BIN_DIR}/dc-tts and ${BIN_DIR}/dc-tts-win)..."
cd "${ROOT_DIR}"
CGO_ENABLED=0 go build -ldflags="-s -w" -o "${BIN_DIR}/dc-tts" ./cmd/dc-tts
CGO_ENABLED=0 go build -ldflags="-s -w" -o "${BIN_DIR}/dc-tts-win" ./cmd/dc-tts-win
ln -sf "${BIN_DIR}/dc-tts" /tmp/dc-tts 2>/dev/null || true

echo "[dc-tts] Starting daemon on 127.0.0.1:${PORT} (HTTP 127.0.0.1:${HTTP_PORT})..."
nohup "${BIN_DIR}/dc-tts-win" -addr "127.0.0.1:${PORT}" -http "127.0.0.1:${HTTP_PORT}" >"${LOG_FILE}" 2>&1 </dev/null &
echo $! >"${PID_FILE}"

for _ in $(seq 1 30); do
  if "${BIN_DIR}/dc-tts" status --host 127.0.0.1 --port "${PORT}" >/dev/null 2>&1; then
    echo "[dc-tts] Tunnel READY on 127.0.0.1:${PORT} (PID $(cat "${PID_FILE}"))"
    "${BIN_DIR}/dc-tts" status --host 127.0.0.1 --port "${PORT}"
    exit 0
  fi
  sleep 0.2
done

echo "[dc-tts] ERROR: Daemon did not become ready. Log output:" >&2
tail -n 20 "${LOG_FILE}" >&2 || true
exit 1
