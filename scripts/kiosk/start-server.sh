#!/usr/bin/env bash
# Статический сервер стенда (macOS / Linux).
# Запуск из корня репозитория или через абсолютный путь.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${MUSEUM_PORT:-8080}"
cd "$ROOT"
echo "Museum server: http://localhost:${PORT}  (root: $ROOT)"
exec python3 -m http.server "$PORT"
