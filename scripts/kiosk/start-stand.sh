#!/usr/bin/env bash
# Полный автозапуск стенда: сервер + пауза + Chrome kiosk (macOS).
# Добавьте в «Системные настройки → Основные → Объекты входа» или launchd.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
"$DIR/start-server.sh" &
SERVER_PID=$!
sleep 2
"$DIR/start-chrome-kiosk.sh" || true
wait "$SERVER_PID"
